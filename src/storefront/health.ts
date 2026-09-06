import { inspectHtml, attribute } from './health-dom.ts'
import type { Brand, Theme } from '../domain/types.ts'
import { getPage, homePage, type Page } from '../pages/store.ts'
import { gzipSync } from 'node:zlib'
import type { Db } from '../lib/db.ts'
import type { Store } from '../control/stores.ts'
import { environment } from '../control/stores.ts'
import { listProducts } from '../domain/catalog.ts'
import { listReviews, statsFor } from '../domain/reviews.ts'
import { companionsFor } from '../analytics/events.ts'
import { listPages } from '../pages/store.ts'
import * as view from './render.ts'
import type { StoreView } from './render.ts'
import { defaultRegion, listRegions } from '../domain/regions.ts'

/**
 * The site health report: accessibility and speed, measured on the pages as
 * they render, not on a checklist someone filled in. Each page is rendered
 * the way a visitor would get it and read back for the things a screen
 * reader, a keyboard and a slow connection trip on.
 */
export type Issue = { severity: 'error' | 'warn'; check: string; detail: string }

export type PageAudit = {
  path: string
  title: string
  bytes: number
  gzipBytes: number
  metrics: { images: number; lazyImages: number; scripts: number; externalScripts: number; externalStyles: number; fonts: number; inlineCssBytes: number; inlineJsBytes: number; headings: number; h1s: number; forms: number; iframes: number }
  issues: Issue[]
  score: number
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length
}

/** WCAG relative luminance from a hex colour. */
export function luminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  let value = match[1] as string
  if (value.length === 3) value = value.split('').map((char) => char + char).join('')
  const channel = (at: number) => {
    const c = parseInt(value.slice(at, at + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4)
}

export function contrast(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  const [light, dark] = la > lb ? [la, lb] : [lb, la]
  return Math.round(((light + 0.05) / (dark + 0.05)) * 100) / 100
}

export function auditHtml(html: string, input: { path: string; title?: string; brand?: { primary?: string; paper?: string; ink?: string } }): PageAudit {
  const issues: Issue[] = []
  const bytes = Buffer.byteLength(html, 'utf8')
  const gzipBytes = gzipSync(Buffer.from(html, 'utf8')).length
  const dom = inspectHtml(html), elements = (tag: string) => dom.nodes.filter(node => node.tagName === tag)
  const images = elements('img'), noAlt = images.filter(node => attribute(node,'alt') === undefined).length
  const lazyImages = images.filter(node => attribute(node,'loading')?.toLowerCase() === 'lazy').length
  const executable = elements('script').filter(node => !/^(application\/(ld\+)?json|importmap|speculationrules)$/i.test(attribute(node,'type') ?? ''))
  const scripts = executable.length, external = executable.filter(node => attribute(node,'src'))
  const externalScripts = external.length
  const blockingScripts = external.filter(node => attribute(node,'async') === undefined && attribute(node,'defer') === undefined && attribute(node,'type') !== 'module').length
  const styles = elements('link').filter(node => attribute(node,'rel')?.split(/\s+/).includes('stylesheet'))
  const externalStyles = styles.length
  const fontFamilies = new Set<string>()
  for (const node of styles) { try { const url = new URL(attribute(node,'href') ?? '', 'https://local.invalid'); if(url.hostname === 'fonts.googleapis.com') for(const family of url.searchParams.getAll('family')) for(const name of family.split('|')) fontFamilies.add(name.split(':')[0]!) } catch {} }
  const fonts = fontFamilies.size, families = fonts
  const inlineCssBytes = elements('style').reduce((sum,node) => sum + Buffer.byteLength((node.childNodes ?? []).map(child => child.value ?? '').join('')),0)
  const inlineJsBytes = executable.filter(node => !attribute(node,'src')).reduce((sum,node) => sum + Buffer.byteLength((node.childNodes ?? []).map(child => child.value ?? '').join('')),0)
  const headings = dom.nodes.filter(node => /^h[1-6]$/.test(node.tagName ?? '')).map(node => Number(node.tagName![1]))
  const h1s = headings.filter(level => level === 1).length
  const forms = elements('form').length, iframes = elements('iframe')

  if (!elements('html').some(node => attribute(node,'lang')?.trim())) issues.push({ severity: 'error', check: 'lang', detail: 'The document has no lang attribute; screen readers pick the wrong voice.' })
  const landmarks=dom.nodes.filter(node=>node.tagName==='main'||attribute(node,'role')==='main')
  const skipTargets=new Set(landmarks.map(node=>attribute(node,'id')).filter(Boolean))
  const hasSkip=elements('a').some(node=>{
    const href=attribute(node,'href')??''
    return href.startsWith('#') && href.length>1 && (skipTargets.has(href.slice(1)) || (/skip/i.test(dom.name(node)) && dom.nodes.some(target=>attribute(target,'id')===href.slice(1))))
  })
  if(!hasSkip)issues.push({severity:'warn',check:'skip-link',detail:'No skip link to the main content for keyboard users.'})
  if(!landmarks.length)issues.push({severity:'error',check:'landmark',detail:'No main landmark.'})
  if (noAlt) issues.push({ severity: 'error', check: 'alt', detail: `${noAlt} image${noAlt === 1 ? '' : 's'} without an alt attribute.` })
  if (h1s === 0) issues.push({ severity: 'error', check: 'h1', detail: 'No h1 on the page.' })
  if (h1s > 1) issues.push({ severity: 'warn', check: 'h1', detail: `${h1s} h1 headings; one is expected.` })
  let previous = 0
  for (const level of headings) {
    if (previous && level > previous + 1) { issues.push({ severity: 'warn', check: 'heading-order', detail: `Heading level jumps from h${previous} to h${level}.` }); break }
    previous = level
  }
  const unnamed = elements('button').filter(node => !dom.name(node)).length
  if (unnamed) issues.push({ severity: 'error', check: 'button-name', detail: `${unnamed} buttons have no accessible name.` })
  const inputs = dom.nodes.filter(node => ['input','select','textarea'].includes(node.tagName ?? '') && !['hidden','submit','button','image','reset'].includes(attribute(node,'type') ?? ''))
  const unlabelled = inputs.filter(node => !dom.name(node)).length
  if (unlabelled) issues.push({ severity: 'error', check: 'input-label', detail: `${unlabelled} form fields need an accessible label (placeholder text is not a persistent label).` })
  const untitledFrames = iframes.filter(node => !attribute(node,'title')?.trim()).length
  if (untitledFrames) issues.push({ severity: 'warn', check: 'iframe-title', detail: `${untitledFrames} frames need a descriptive title.` })
  if (!/:focus-visible/i.test(html)) issues.push({ severity: 'warn', check: 'focus', detail: 'No visible focus style is defined.' })
  if (!/prefers-reduced-motion/i.test(html) && /animation|transition/i.test(html)) issues.push({ severity: 'warn', check: 'motion', detail: 'Animations run without honouring prefers-reduced-motion.' })
  if (elements('a').some(node => attribute(node,'href') !== undefined && !dom.name(node))) issues.push({ severity: 'error', check: 'link-name', detail: 'An empty link with no text.' })
  // Template residue: what the reference pages shipped by accident (docs/knowledge/reference-pages.md).
  const unconfirmed = (dom.text.match(/\[confirm[^\]]*\]/gi) ?? []).length
  if (unconfirmed) issues.push({ severity: 'error', check: 'unconfirmed', detail: `${unconfirmed} "[confirm]" marker${unconfirmed === 1 ? '' : 's'} still on the page: a fact nobody supplied yet.` })
  const deadLinks = (html.match(/<a\b[^>]*href=["']#["']/gi) ?? []).length
  if (deadLinks) issues.push({ severity: 'warn', check: 'dead-link', detail: `${deadLinks} link${deadLinks === 1 ? '' : 's'} to "#" that go nowhere.` })
  if (/placeholder-image|placeholder\.png/i.test(images.map(node=>attribute(node,'src')).join(' ')) || /\blorem ipsum\b/i.test(dom.text)) issues.push({ severity: 'error', check: 'placeholder', detail: 'A placeholder image or lorem ipsum is on the page.' })
  if (/(?:^|[^\d])0 (?:people|customers|orders|bought|dog parents)/i.test(dom.text)) issues.push({ severity: 'warn', check: 'zero-counter', detail: 'A counter reads zero ("0 bought…"); render a real number or nothing.' })
  const brand = input.brand ?? {}
  if (brand.primary) {
    const onWhite = contrast('#ffffff', brand.primary)
    if (onWhite !== null && onWhite < 4.5) issues.push({ severity: 'warn', check: 'contrast', detail: `White text on the brand colour ${brand.primary} is ${onWhite}:1; buttons need 4.5:1.` })
    if (brand.paper) {
      const onPaper = contrast(brand.paper, brand.primary)
      if (onPaper !== null && onPaper < 3) issues.push({ severity: 'warn', check: 'contrast', detail: `The brand colour on the page background is ${onPaper}:1; large text needs 3:1.` })
    }
    if (brand.ink && brand.paper) {
      const body = contrast(brand.paper, brand.ink)
      if (body !== null && body < 4.5) issues.push({ severity: 'error', check: 'contrast', detail: `Body text is ${body}:1 against the background; 4.5:1 is required.` })
    }
  }

  if (gzipBytes > 120_000) issues.push({ severity: 'warn', check: 'weight', detail: `${Math.round(gzipBytes / 1024)}KB compressed; over 120KB slows the first paint on a phone.` })
  if (blockingScripts > 0) issues.push({ severity: 'warn', check: 'scripts', detail: `${blockingScripts} synchronous external scripts can block HTML parsing; review deferral and dependencies.` })
  if (externalStyles > 1) issues.push({ severity: 'warn', check: 'styles', detail: `${externalStyles} stylesheets may block rendering; consolidate duplicates and review critical CSS.` })
  if (families > 2) issues.push({ severity: 'warn', check: 'fonts', detail: `${families} font families requested; two is plenty.` })
  if (images.length > 2 && lazyImages < images.length - 2) issues.push({ severity: 'warn', check: 'lazy', detail: `${images.length - lazyImages} images load eagerly; only the ones above the fold should.` })
  if (inlineJsBytes > 80_000) issues.push({ severity: 'warn', check: 'js', detail: `${Math.round(inlineJsBytes / 1024)}KB of inline script.` })
  if (!elements('meta').some(node=>attribute(node,'name')?.toLowerCase()==='viewport')) issues.push({ severity: 'error', check: 'viewport', detail: 'No viewport meta; the page will not scale on a phone.' })

  const score = Math.max(0, 100 - issues.reduce((sum, issue) => sum + (issue.severity === 'error' ? 12 : 4), 0))
  return {
    path: input.path,
    title: input.title ?? (/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? input.path),
    bytes,
    gzipBytes,
    metrics: { images: images.length, lazyImages, scripts, externalScripts, externalStyles, fonts, inlineCssBytes, inlineJsBytes, headings: headings.length, h1s, forms, iframes: iframes.length },
    issues,
    score,
  }
}

/** Audits the live environment when there is one, and the draft before first publication. */
export function auditStore(db: Db, store: Store, opts: { environment?: 'draft' | 'live'; page?: Page; theme?: Theme; brand?: Brand; documents?: Map<string,string> } = {}): { pages: PageAudit[]; score: number; environment: 'draft' | 'live' } {
  const kind = opts.environment ?? (store.status === 'live' ? 'live' : 'draft')
  const env = environment(db, store.id, kind)
  if(opts.theme)env.theme=opts.theme
  if(opts.brand)env.brand=opts.brand
  const audited = Object.keys(env.brand).length ? { ...store, brand: env.brand } : store
  const current: StoreView = { db, store: audited, env, base: kind === 'live' ? `/s/${store.slug}` : `/preview/${store.slug}`, preview: false, cart: null, totals: null, region: defaultRegion(db, store.id), regions: listRegions(db, store.id) }
  const products = listProducts(db, store.id, { status: 'published', limit: 3 })
  const brand = { ...(audited.brand.primary ? { primary: audited.brand.primary } : {}), ...(audited.brand.paper ? { paper: audited.brand.paper } : {}), ...(audited.brand.ink ? { ink: audited.brand.ink } : {}) }
  const pages: PageAudit[] = []
  const safely = (path: string, title: string, render: () => string, imported = false) => {
    try {
      const document=render();opts.documents?.set(path,document)
      pages.push(auditHtml(document, { path, title, brand: imported || document.includes('data-pb-document') || (path.startsWith('/pages/') && (opts.page?.handle===path.slice(7) ? opts.page : getPage(db,store.id,path.slice(7)))?.mode==='html') ? {} : brand }))
    } catch (error) {
      pages.push({ path, title, bytes: 0, gzipBytes: 0, metrics: { images: 0, lazyImages: 0, scripts: 0, externalScripts: 0, externalStyles: 0, fonts: 0, inlineCssBytes: 0, inlineJsBytes: 0, headings: 0, h1s: 0, forms: 0, iframes: 0 }, issues: [{ severity: 'error', check: 'render', detail: `Could not render: ${error instanceof Error ? error.message : String(error)}` }], score: 0 })
    }
  }
  const home=homePage(db,store.id,{preview:kind==='draft'});const homeOverride=opts.page?.id===home?.id?opts.page:home
  safely('/', homeOverride?.title ?? 'Home', () => homeOverride ? (homeOverride.mode==='html'?view.htmlPage(current,homeOverride):view.blockPage(current,homeOverride)) : view.home(current, { featured: listProducts(db, store.id, { status: 'published', limit: 6 }), collections: [] }), homeOverride?.mode==='html')
  for (const product of products) {
    safely(`/products/${product.handle}`, product.title, () => view.productPage(current, { product, stats: statsFor(db, store.id, product.id), reviews: listReviews(db, store.id, { productId: product.id, status: 'approved', limit: 6 }), companions: companionsFor(db, store.id, product.id).map((companionId) => products.find((entry) => entry.id === companionId)).filter((entry): entry is (typeof products)[number] => Boolean(entry)) }))
  }
  for (const page of listPages(db, store.id).filter((page) => kind==='draft' || page.status === 'published').map(page=>opts.page?.id===page.id?opts.page:page)) {
    safely(`/pages/${page.handle}`, page.title, () => (page.mode === 'html' ? view.htmlPage(current, page) : view.blockPage(current, page)))
  }
  const score = pages.length ? Math.round(pages.reduce((sum, page) => sum + page.score, 0) / pages.length) : 0
  return { pages, score, environment: kind }
}
