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
  const images = [...html.matchAll(/<img\b([^>]*)>/gi)].map((match) => match[1] ?? '')
  const noAlt = images.filter((attrs) => !/\balt=/i.test(attrs)).length
  const lazyImages = images.filter((attrs) => /loading=["']lazy/i.test(attrs)).length
  const scripts = count(html, /<script\b/gi)
  const externalScripts = count(html, /<script\b[^>]*\ssrc=/gi)
  const externalStyles = count(html, /<link\b[^>]*rel=["']stylesheet/gi)
  const fonts = count(html, /fonts\.googleapis\.com\/css[^"']*family=/gi) + (html.match(/family=([^&"']+)/g)?.reduce((sum, part) => sum + part.split('|').length + (part.match(/&family=/g)?.length ?? 0), 0) ?? 0) * 0
  const families = [...html.matchAll(/family=([^&"']+)/g)].length
  const inlineCssBytes = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].reduce((sum, match) => sum + Buffer.byteLength(match[1] ?? ''), 0)
  const inlineJsBytes = [...html.matchAll(/<script\b(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)].reduce((sum, match) => sum + Buffer.byteLength(match[1] ?? ''), 0)
  const headings = [...html.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]))
  const h1s = headings.filter((level) => level === 1).length
  const forms = count(html, /<form\b/gi)
  const iframes = [...html.matchAll(/<iframe\b([^>]*)>/gi)].map((match) => match[1] ?? '')

  if (!/<html[^>]*\slang=/i.test(html)) issues.push({ severity: 'error', check: 'lang', detail: 'The document has no lang attribute; screen readers pick the wrong voice.' })
  if (!/<a[^>]+class=["'][^"']*skip[^"']*["'][^>]*href=["']#main/i.test(html) && !/<a[^>]+href=["']#main["'][^>]*class=["'][^"']*skip/i.test(html)) issues.push({ severity: 'warn', check: 'skip-link', detail: 'No skip link to the main content for keyboard users.' })
  if (!/<main\b/i.test(html)) issues.push({ severity: 'error', check: 'landmark', detail: 'No main landmark.' })
  if (noAlt) issues.push({ severity: 'error', check: 'alt', detail: `${noAlt} image${noAlt === 1 ? '' : 's'} without an alt attribute.` })
  if (h1s === 0) issues.push({ severity: 'error', check: 'h1', detail: 'No h1 on the page.' })
  if (h1s > 1) issues.push({ severity: 'warn', check: 'h1', detail: `${h1s} h1 headings; one is expected.` })
  let previous = 0
  for (const level of headings) {
    if (previous && level > previous + 1) { issues.push({ severity: 'warn', check: 'heading-order', detail: `Heading level jumps from h${previous} to h${level}.` }); break }
    previous = level
  }
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)]
  const unnamed = buttons.filter((match) => !/aria-label=|title=/i.test(match[1] ?? '') && !(match[2] ?? '').replace(/<[^>]+>/g, '').trim() && !/<img[^>]+alt=["'][^"']+/i.test(match[2] ?? '')).length
  if (unnamed) issues.push({ severity: 'error', check: 'button-name', detail: `${unnamed} button${unnamed === 1 ? '' : 's'} with no accessible name.` })
  const inputs = [...html.matchAll(/<(input|select|textarea)\b([^>]*)>/gi)].filter((match) => !/type=["'](hidden|submit|button|checkbox|radio)/i.test(match[2] ?? ''))
  const labelled = new Set([...html.matchAll(/<label\b[^>]*\sfor=["']([^"']+)["']/gi)].map((match) => match[1]))
  const unlabelled = inputs.filter((match) => {
    const attrs = match[2] ?? ''
    if (/aria-label=|aria-labelledby=|placeholder=|title=/i.test(attrs)) return false
    const inputId = /\sid=["']([^"']+)["']/i.exec(attrs)?.[1]
    return !(inputId && labelled.has(inputId))
  }).length
  if (unlabelled) issues.push({ severity: 'error', check: 'input-label', detail: `${unlabelled} form field${unlabelled === 1 ? '' : 's'} without a label.` })
  const untitledFrames = iframes.filter((attrs) => !/\stitle=/i.test(attrs)).length
  if (untitledFrames) issues.push({ severity: 'warn', check: 'iframe-title', detail: `${untitledFrames} iframe${untitledFrames === 1 ? '' : 's'} without a title.` })
  if (!/:focus-visible/i.test(html)) issues.push({ severity: 'warn', check: 'focus', detail: 'No visible focus style is defined.' })
  if (!/prefers-reduced-motion/i.test(html) && /animation|transition/i.test(html)) issues.push({ severity: 'warn', check: 'motion', detail: 'Animations run without honouring prefers-reduced-motion.' })
  if (/<a\b[^>]*>\s*<\/a>/i.test(html)) issues.push({ severity: 'error', check: 'link-name', detail: 'An empty link with no text.' })
  // Template residue: what the reference pages shipped by accident (docs/knowledge/reference-pages.md).
  const unconfirmed = (html.match(/\[confirm[^\]]*\]/gi) ?? []).length
  if (unconfirmed) issues.push({ severity: 'error', check: 'unconfirmed', detail: `${unconfirmed} "[confirm]" marker${unconfirmed === 1 ? '' : 's'} still on the page: a fact nobody supplied yet.` })
  const deadLinks = (html.match(/<a\b[^>]*href=["']#["']/gi) ?? []).length
  if (deadLinks) issues.push({ severity: 'warn', check: 'dead-link', detail: `${deadLinks} link${deadLinks === 1 ? '' : 's'} to "#" that go nowhere.` })
  if (/placeholder-image|placeholder\.png|\blorem ipsum\b/i.test(html)) issues.push({ severity: 'error', check: 'placeholder', detail: 'A placeholder image or lorem ipsum is on the page.' })
  if (/(?:^|[^\d])0 (?:people|customers|orders|bought|dog parents)/i.test(html.replace(/<[^>]+>/g, ' '))) issues.push({ severity: 'warn', check: 'zero-counter', detail: 'A counter reads zero ("0 bought…"); render a real number or nothing.' })
  const brand = input.brand ?? {}
  if (brand.primary && (brand.paper || true)) {
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
  if (externalScripts > 2) issues.push({ severity: 'warn', check: 'scripts', detail: `${externalScripts} external scripts; each is a round trip before the page is interactive.` })
  if (externalStyles > 1) issues.push({ severity: 'warn', check: 'styles', detail: `${externalStyles} external stylesheets block rendering.` })
  if (families > 2) issues.push({ severity: 'warn', check: 'fonts', detail: `${families} font families requested; two is plenty.` })
  if (images.length > 2 && lazyImages < images.length - 2) issues.push({ severity: 'warn', check: 'lazy', detail: `${images.length - lazyImages} images load eagerly; only the ones above the fold should.` })
  if (inlineJsBytes > 80_000) issues.push({ severity: 'warn', check: 'js', detail: `${Math.round(inlineJsBytes / 1024)}KB of inline script.` })
  if (!/<meta[^>]+name=["']viewport/i.test(html)) issues.push({ severity: 'error', check: 'viewport', detail: 'No viewport meta; the page will not scale on a phone.' })

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
export function auditStore(db: Db, store: Store, opts: { environment?: 'draft' | 'live' } = {}): { pages: PageAudit[]; score: number; environment: 'draft' | 'live' } {
  const kind = opts.environment ?? (store.status === 'live' ? 'live' : 'draft')
  const env = environment(db, store.id, kind)
  const audited = Object.keys(env.brand).length ? { ...store, brand: env.brand } : store
  const current: StoreView = { db, store: audited, env, base: kind === 'live' ? `/s/${store.slug}` : `/preview/${store.slug}`, preview: false, cart: null, totals: null, region: defaultRegion(db, store.id), regions: listRegions(db, store.id) }
  const products = listProducts(db, store.id, { status: 'published', limit: 3 })
  const brand = { ...(audited.brand.primary ? { primary: audited.brand.primary } : {}), ...(audited.brand.paper ? { paper: audited.brand.paper } : {}), ...(audited.brand.ink ? { ink: audited.brand.ink } : {}) }
  const pages: PageAudit[] = []
  const safely = (path: string, title: string, render: () => string) => {
    try {
      pages.push(auditHtml(render(), { path, title, brand }))
    } catch (error) {
      pages.push({ path, title, bytes: 0, gzipBytes: 0, metrics: { images: 0, lazyImages: 0, scripts: 0, externalScripts: 0, externalStyles: 0, fonts: 0, inlineCssBytes: 0, inlineJsBytes: 0, headings: 0, h1s: 0, forms: 0, iframes: 0 }, issues: [{ severity: 'error', check: 'render', detail: `Could not render: ${error instanceof Error ? error.message : String(error)}` }], score: 0 })
    }
  }
  safely('/', 'Home', () => view.home(current, { featured: listProducts(db, store.id, { status: 'published', limit: 6 }), collections: [] }))
  for (const product of products) {
    safely(`/products/${product.handle}`, product.title, () => view.productPage(current, { product, stats: statsFor(db, store.id, product.id), reviews: listReviews(db, store.id, { productId: product.id, status: 'approved', limit: 6 }), companions: companionsFor(db, store.id, product.id).map((companionId) => products.find((entry) => entry.id === companionId)).filter((entry): entry is (typeof products)[number] => Boolean(entry)) }))
  }
  for (const page of listPages(db, store.id).filter((page) => page.status === 'published').slice(0, 8)) {
    safely(`/pages/${page.handle}`, page.title, () => (page.mode === 'html' ? view.htmlPage(current, page) : view.blockPage(current, page)))
  }
  const score = pages.length ? Math.round(pages.reduce((sum, page) => sum + page.score, 0) / pages.length) : 0
  return { pages, score, environment: kind }
}
