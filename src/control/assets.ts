import { sourceThemeFromHtml, fontFacesFromHtml } from '../pages/source-theme.ts'
import type { Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { relocateUploads } from '../lib/uploads.ts'
import { clonePage, localizeImageUrls, type CloneResult, type ImageLocalizationReport } from '../pages/clone.ts'
import { mergeImageReports, saveCopyReport } from '../pages/clone-report.ts'
import { canonicalPageUrl, copyUrlPriority, discoverPageLinks, inferCopiedPage, isCopyablePageUrl, isPaymentUrl, rewriteCopiedLinks, type CopyReport } from '../pages/site-copy.ts'
import { bindImportedOfferProduct, planImportedOfferProduct } from '../pages/imported-offers.ts'
import { installImportedBundle, planImportedBundle, repairImportedBundleHtml } from '../pages/imported-bundles.ts'
import { createPage, updatePage, type Page } from '../pages/store.ts'
import { seedDefaultRegion } from '../domain/regions.ts'
import { upsertFunnel } from '../domain/funnels.ts'
import { createFromImport, importProductFromUrl, type ImportedProduct } from '../domain/ops.ts'
import type { Brand, Product, Theme } from '../domain/types.ts'
import { seedTodos } from './todos.ts'
import { createStore, getStore, setTheme, updateStore, type Store } from './stores.ts'
import { setBuildMode, setSiteShape } from './build.ts'
import { addRedirect } from '../seo/schema.ts'

export type AssetKind = Store['kind']

export function createBlankAsset(db: Db, ownerId: string, input: { name: string; kind: AssetKind; currency?: string }): Store {
  const name = input.name.trim()
  if (name.length < 2) throw new Error('Give the asset a name')
  const currency = (input.currency ?? 'USD').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code')
  const store = createStore(db, ownerId, { name, kind: input.kind, currency, prompt: input.kind === 'funnel' ? `A conversion funnel for ${name}` : `An online store for ${name}` })
  seedDefaultRegion(db, store.id, currency)
  seedTodos(db, store.id)
  setBuildMode(db, store.id, 'own-product')
  setSiteShape(db, store.id, { shape: input.kind })
  setTheme(db, store.id, input.kind === 'funnel' ? { nav: [], sections: [] } : {}, { build: `Created blank ${input.kind}` })
  return store
}

export async function importAssetFromUrl(
  db: Db,
  ownerId: string,
  input: { url: string; name?: string; kind: AssetKind; currency?: string; additionalUrls?: string[]; maxPages?: number; fetchImpl?: typeof fetch; signal?: AbortSignal },
): Promise<{ store: Store; page: Page; pages: Page[]; products: Product[]; clone: CloneResult; report: CopyReport }> {
  stopIfAborted(input.signal)
  const url = input.url.trim()
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Paste a full URL starting with https://')
  const pendingId = id('import')
  const localizedImages = new Map<string, string>()
  const cloneOptions = {
    storeId: pendingId,
    keepScripts: false,
    localizedImages,
    stylesheetCache: new Map<string, string>(),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  }
  const additionalUrls = (input.additionalUrls ?? []).map((value) => value.trim()).filter(Boolean)
  if (additionalUrls.length > 100) throw new Error('Add up to 100 page links per copy')
  for (const value of additionalUrls) {
    if (!/^https?:\/\/[^\s]+$/i.test(value)) throw new Error(`Use a full https:// URL for each additional page: ${value}`)
  }
  const homeClone = await clonePage(url, cloneOptions)
  const documents: CloneResult[] = [homeClone]
  const report: CopyReport = { discovered: 1, copied: 1, complete: true, failed: [], remaining: [], externalSteps: [] }
  const maxPages = Number.isFinite(input.maxPages) ? Math.max(1, Math.min(100, Math.floor(input.maxPages as number))) : 50
  const origins = new Set([new URL(homeClone.sourceUrl).origin, ...additionalUrls.filter((value) => !isPaymentUrl(value)).map((value) => new URL(value).origin)])
  const queued: string[] = []
  const seen = new Set([canonicalPageUrl(homeClone.sourceUrl)])
  const requested = new Set(seen)
  const aliases = new Map<string, string>([[canonicalPageUrl(url), canonicalPageUrl(homeClone.sourceUrl)]])
  const enqueue = (value: string, explicit = false) => {
    const canonical = canonicalPageUrl(value)
    if (requested.has(canonical)) return
    const candidate = new URL(canonical)
    const step = inferCopiedPage(canonical, '', input.kind === 'funnel').role
    if (isPaymentUrl(canonical) || (!origins.has(candidate.origin) && ['checkout', 'upsell', 'downsell', 'thankyou'].includes(step))) {
      if (!report.externalSteps.includes(canonical)) report.externalSteps.push(canonical)
      return
    }
    if (!origins.has(candidate.origin) || !isCopyablePageUrl(canonical)) {
      if (explicit) report.failed.push({ url: canonical, reason: 'This is an action, payment-provider URL or unsupported document, not a readable page.' })
      return
    }
    requested.add(canonical)
    const fetchable = new URL(canonical)
    fetchable.pathname = new URL(value).pathname
    queued.push(fetchable.toString())
  }
  additionalUrls.forEach((value) => enqueue(value, true))
  for (const linked of homeClone.links ?? discoverPageLinks(homeClone.html, homeClone.sourceUrl)) enqueue(linked)
  while (queued.length && documents.length < maxPages) {
    queued.sort((a, b) => copyUrlPriority(a) - copyUrlPriority(b))
    const linked = queued.shift() as string
    if (seen.has(canonicalPageUrl(linked))) continue
    seen.add(canonicalPageUrl(linked))
    try {
      const document = await clonePage(linked, cloneOptions)
      const final = canonicalPageUrl(document.sourceUrl)
      if (!origins.has(new URL(final).origin) || isPaymentUrl(final)) {
        report.failed.push({ url: linked, reason: `Redirected outside the copied site to ${new URL(final).origin}.` })
        continue
      }
      aliases.set(canonicalPageUrl(linked), final)
      if (documents.some((entry) => canonicalPageUrl(entry.sourceUrl) === final)) continue
      seen.add(final)
      requested.add(final)
      documents.push(document)
      for (const discovered of document.links ?? discoverPageLinks(document.html, document.sourceUrl)) enqueue(discovered)
    } catch (error) {
      stopIfAborted(input.signal)
      report.failed.push({ url: linked, reason: error instanceof Error ? error.message : 'Could not read this page.' })
    }
  }
  report.copied = documents.length
  report.remaining = queued.filter((value) => !seen.has(canonicalPageUrl(value)))
  report.discovered = documents.length + report.failed.length + report.remaining.length
  report.complete = !report.failed.length && !report.remaining.length && !report.externalSteps.length
  for (const failure of report.failed) homeClone.notes.push(`Not copied: ${failure.url} — ${failure.reason}`)
  if (report.remaining.length) homeClone.notes.push(`${report.remaining.length} discovered pages remain after the ${maxPages}-page limit. Add their links in another copy or raise the limit.`)
  if (report.externalSteps.length) homeClone.notes.push(`${report.externalSteps.length} external checkout or funnel steps need review. Payment-provider sessions cannot be copied; connect the copied checkout to this store's Stripe account.`)
  homeClone.notes.push(`Copied ${documents.length} pages. Discovery follows readable links and declared next steps; add unlinked, protected or post-purchase step URLs explicitly.`)


  // A product page is more than HTML. Import Shopify's structured product JSON
  // (or schema/Open Graph as a fallback) so the cloned store has a purchasable
  // catalog entry, variants, and its full-size product media as owned uploads.
  const importedProducts: ImportedProduct[] = []
  const productImageReports: ImageLocalizationReport[] = []
  const productFetch = input.signal
    ? ((request: string | URL | Request, init?: RequestInit) => (input.fetchImpl ?? fetch)(request, { ...init, signal: input.signal })) as typeof fetch
    : input.fetchImpl ?? fetch
  const offerPlans = new Map(documents.map((document) => [canonicalPageUrl(document.sourceUrl), planImportedOfferProduct(document.html, document.sourceUrl, { currency: input.currency?.toUpperCase() || 'USD' })]))
  const productSources = [...new Set(documents.filter((document) => isProductUrl(document.sourceUrl) || offerPlans.get(canonicalPageUrl(document.sourceUrl)) || (document.hasProductData && !['cart', 'checkout', 'thankyou'].includes(inferCopiedPage(document.sourceUrl, document.html, input.kind === 'funnel').role))).map((document) => canonicalPageUrl(document.sourceUrl)))]
  for (const source of productSources) {
    try {
      const offerPlan = offerPlans.get(source)
      const imported = offerPlan?.product ?? await importProductFromUrl(source, productFetch)
      if (offerPlan) homeClone.notes.push(...offerPlan.notes)
      if (!imported.variants.length || imported.variants.some((variant) => !Number.isSafeInteger(variant.priceCents) || variant.priceCents <= 0)) throw new Error('No explicit purchasable price was found. Assign this page a product and price in the editor.')
      const remoteMedia = [...new Set([...imported.images, ...imported.variants.map((variant) => variant.image ?? '').filter(Boolean)])]
      const owned = await localizeImageUrls(remoteMedia, {
        storeId: pendingId,
        localizedImages,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
      }, source)
      productImageReports.push(owned.report)
      const mediaBySource = new Map(remoteMedia.map((remote, index) => [remote, owned.urls[index] ?? remote]))
      importedProducts.push({
        ...imported,
        source,
        images: imported.images.map((image) => mediaBySource.get(image) ?? image),
        variants: imported.variants.map((variant) => variant.image ? { ...variant, image: mediaBySource.get(variant.image) ?? variant.image } : variant),
      })
    } catch (error) {
      stopIfAborted(input.signal)
      homeClone.notes.push(`Saved the product page but could not create its catalog product from ${source}: ${error instanceof Error ? error.message : 'could not read it'}`)
    }
  }
  stopIfAborted(input.signal)
  const inferredName = homeClone.title.split(/\s+[|–—]\s+/)[0]?.trim() || new URL(homeClone.sourceUrl).hostname.replace(/^www\./, '')
  const store = createBlankAsset(db, ownerId, {
    name: input.name?.trim() || inferredName.slice(0, 80),
    kind: input.kind,
    currency: input.currency,
  })
  const clonedBrand = brandFromClone(homeClone.html)
  if (Object.keys(clonedBrand).length) updateStore(db, store.id, { brand: clonedBrand })
  relocateUploads(pendingId, store.id)
  const rehome = (value: string) => value.split(`/_uploads/${pendingId}/`).join(`/_uploads/${store.id}/`)
  const products = importedProducts.map((imported) => createFromImport(db, store.id, {
    ...imported,
    images: imported.images.map(rehome),
    variants: imported.variants.map((variant) => variant.image ? { ...variant, image: rehome(variant.image) } : variant),
  }, { asSupplier: false, status: 'draft' }))
  const productBySource = new Map(products.map((product, index) => [canonicalPageUrl(importedProducts[index]?.source ?? ''), product]))
  for (const [source, product] of productBySource) {
    try {
      const pathname = new URL(source).pathname
      if (pathname !== `/products/${product.handle}`) addRedirect(db, store.id, pathname, `/products/${product.handle}`)
    } catch { /* malformed source URLs were already rejected earlier */ }
  }
  // A one-product store often links to a longer canonical Shopify handle than
  // the short discovery URL. Both are the same offer, so keep every cloned
  // product CTA working instead of sending the merchant to their new 404.
  if (products.length === 1) {
    for (const pathname of productPathsFromClone(homeClone.html, homeClone.sourceUrl)) {
      if (pathname !== `/products/${products[0]?.handle}`) addRedirect(db, store.id, pathname, `/products/${products[0]?.handle}`)
    }
  }
  const pages = documents.map((document, index) => {
    const path = new URL(document.sourceUrl).pathname
    const product = productBySource.get(canonicalPageUrl(document.sourceUrl))
    const offerPlan = offerPlans.get(canonicalPageUrl(document.sourceUrl))
    let boundHtml = offerPlan && product ? bindImportedOfferProduct(document.html, offerPlan, product) : document.html
    try {
      const bundlePlan = planImportedBundle(document.html, document.sourceUrl)
      if (bundlePlan) {
        if (!product) throw new Error('Link the copied bundle to its imported product before enabling package purchases.')
        const installed = installImportedBundle(db, store.id, product.id, bundlePlan)
        const repaired = repairImportedBundleHtml(boundHtml, bundlePlan, installed)
        if (!repaired.changed) throw new Error(repaired.reason || 'The copied bundle could not be placed in its source position.')
        boundHtml = repaired.html
        document.notes.push(...installed.notes)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Bundle offers need review.'
      document.notes.push(reason)
      ;(report.interactionIssues ??= []).push({ url: document.sourceUrl, reason })
      report.complete = false
    }
    const created = createPage(db, store.id, {
      title: index === 0 ? input.kind === 'store' ? 'Imported home page' : 'Imported sales page' : document.title || path.split('/').filter(Boolean).at(-1) || 'Imported page',
      ...inferCopiedPage(document.sourceUrl, document.html, input.kind === 'funnel', index === 0),
      mode: 'html',
      rawHtml: boundHtml.split(`/_uploads/${pendingId}/`).join(`/_uploads/${store.id}/`),
      seo: { title: document.title, description: document.description },
      status: 'draft',
      sourceUrl: document.sourceUrl,
      ...(product ? { productId: product.id, handle: product.handle } : {}),
    })
    saveCopyReport(db, store.id, created.id, { images: document.imageReport ? JSON.parse(rehome(JSON.stringify(document.imageReport))) : undefined, capture: document.captureReport, notes: document.notes })
    return index === 0 && input.kind === 'store' ? updatePage(db, store.id, created.id, { isHome: true }) : created
  })
  const page = pages[0] as Page
  const routes = pages.map((created, index) => ({
    source: documents[index]?.sourceUrl ?? '',
    target: created.role === 'cart' ? '/cart' : created.role === 'checkout' ? '/checkout' : index === 0 && input.kind === 'store' ? '/' : `/pages/${created.handle}`,
  }))
  for (const [alias, final] of aliases) {
    const target = routes.find((route) => canonicalPageUrl(route.source) === final)?.target
    if (target) routes.push({ source: alias, target })
  }
  const clonedNavigation: Theme['nav'] = input.kind === 'store' ? navigationFromClone(homeClone.html, homeClone.sourceUrl, routes) : []
  pages.forEach((created) => updatePage(db, store.id, created.id, { rawHtml: rewriteCopiedLinks(created.rawHtml, created.sourceUrl, routes) }))
  if (input.kind === 'funnel') upsertFunnel(db, store.id, {
    name: `${store.name} funnel`,
    steps: pages.map(page => ({ pageId: page.id, label: page.title })),
    offerPageId: pages.find((created) => created.role === 'offer' || created.role === 'pdp')?.id ?? page.id,
    advertorialPageId: pages.find((created) => created.role === 'advertorial')?.id ?? '',
    productId: products.length === 1 ? products[0]?.id ?? '' : '',
    status: 'active',
  })
  report.images = mergeImageReports([...documents.map(document => document.imageReport), ...productImageReports])
  report.captureIssues = documents.flatMap(document => document.captureReport?.issues.map(reason => ({ url: document.sourceUrl, reason })) ?? [])
  // Test transports intentionally supply static fixtures; real copies must complete rendered capture too.
  if (!report.images.complete || (!input.fetchImpl && report.captureIssues.length)) report.complete = false
  const stylesheets = documents.reduce((sum, document) => sum + document.stylesheets, 0)
  const imagesLocalized = localizedImages.size
  db.update('stores', store.id, { reference_url: homeClone.sourceUrl })
  setTheme(db, store.id, clonedNavigation.length ? { nav: clonedNavigation } : {}, { build: `Cloned ${documents.length} pages and ${products.length} products from ${homeClone.sourceUrl}; ${stylesheets} stylesheets and ${imagesLocalized} images localized` })
  const freshPages = pages.map((created) => updatePage(db, store.id, created.id, {}))
  return {
    store: getStore(db, store.id) ?? { ...store, referenceUrl: homeClone.sourceUrl },
    page: freshPages[0] as Page,
    pages: freshPages,
    products,
    report,
    clone: { ...homeClone, report, imageReport: report.images, html: freshPages[0]?.rawHtml ?? homeClone.html, stylesheets, imagesLocalized, notes: [...new Set(documents.flatMap((document) => document.notes))] },
  }
}

function stopIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Clone cancelled', 'AbortError')
}

/**
 * Shopify themes expose their design system as CSS variables. Carry the
 * common palette and typography tokens into storemill so blocks extracted from
 * a clone immediately look like that site instead of the fallback theme.
 * Unknown themes simply return no values and keep the normal defaults.
 */
export function fontFamilyName(value: string): string | undefined {
  const clean = value.replace(/!important/gi, '').replace(/[;{}<>]/g, '').trim()
  if (!clean || /^(?:inherit|initial|unset|var\()/i.test(clean)) return undefined
  const first = clean.split(',')[0]?.trim().replace(/^["']|["']$/g, '').replace(/\+/g, ' ')
  if (!first || /^(?:serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif|cursive|fantasy)$/i.test(first)) return undefined
  if (/^(?:-apple-system|blinkmacsystemfont|segoe ui|arial|helvetica|verdana|tahoma|trebuchet ms|times(?: new roman)?|georgia|courier(?: new)?|sfmono-regular|menlo|monaco)$/i.test(first)) return undefined
  if (/(?:font awesome|material (?:icons|symbols)|iconfont|glyphicons)/i.test(first)) return undefined
  return first.slice(0, 80)
}

/** Every real family declared by an imported document, without CSS fallback stacks. */
export function fontFamiliesFromClone(html: string): string[] {
  const found = new Set<string>()
  const add = (value: string) => { const family = fontFamilyName(value); if (family) found.add(family) }
  for (const match of html.matchAll(/(?:font-family|--[a-z0-9_-]*font[a-z0-9_-]*)\s*:\s*([^;}]+)/gi)) add(match[1] ?? '')
  for (const match of html.matchAll(/[?&]family=([^:&"'<>]+)/gi)) add(decodeURIComponent((match[1] ?? '').replace(/\+/g, ' ')))
  return [...found].slice(0, 32)
}

function selectorFont(html: string, wanted: RegExp): string | undefined {
  for (const match of html.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!wanted.test(match[1] ?? '')) continue
    const family = /font-family\s*:\s*([^;}]+)/i.exec(match[2] ?? '')?.[1]
    const parsed = family ? fontFamilyName(family) : undefined
    if (parsed) return parsed
  }
  return undefined
}

export function brandFromClone(html: string): Partial<Brand> {
  const captured=sourceThemeFromHtml(html)
  if(Object.keys(captured).length) return { ...captured, sourceTheme:captured, fonts:fontFamiliesFromClone(html), fontFaces:fontFacesFromHtml(html) } as Partial<Brand>
  const variable = (...names: string[]) => {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const value = new RegExp(`--${escaped}\\s*:\\s*([^;}]+)`, 'i').exec(html)?.[1]?.trim()
      if (value) return value
    }
    return ''
  }
  const color = (value: string) => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1]
    if (hex) return `#${hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex}`.toLowerCase()
    const rgb = /^(?:rgb\()?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/i.exec(value)
    if (!rgb) return undefined
    const channels = rgb.slice(1).map(Number)
    if (channels.some((channel) => channel < 0 || channel > 255)) return undefined
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  }
  const primary = color(variable('color-base-accent-1', 'color-primary', 'primary', 'accent-color'))
  const secondary = color(variable('color-base-accent-2', 'color-secondary', 'secondary'))
  const paper = color(variable('color-base-background-1', 'color-background', 'background', 'paper'))
  const ink = color(variable('color-base-text', 'color-foreground', 'text-color', 'ink'))
  const declared = fontFamiliesFromClone(html)
  const displayFont = fontFamilyName(variable('font-heading-family', 'font-display-family', 'display-font'))
    ?? selectorFont(html, /(?:^|[\s,.>+~])(?:h1|h2|h3|\.heading|\.headline)(?:$|[\s,.#:[>+~])/i)
  const bodyFont = fontFamilyName(variable('font-body-family', 'body-font'))
    ?? selectorFont(html, /(?:^|[\s,>+~])body(?:$|[\s,.#:[>+~])/i)
  const fonts = [...new Set([displayFont, bodyFont, ...declared].filter((entry): entry is string => Boolean(entry)))]
  return { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}), ...(paper ? { paper } : {}), ...(ink ? { ink } : {}), ...(displayFont ? { displayFont } : {}), ...(bodyFont ? { bodyFont } : {}), ...(fonts.length ? { fonts } : {}) }
}

/** Read the useful, same-site links from a cloned header into the global menu. */
export function navigationFromClone(html: string, sourceUrl: string, routes: Array<{ source: string; target: string }> = []): Theme['nav'] {
  let origin = ''
  try { origin = new URL(sourceUrl).origin } catch { return [] }
  const routeBySource = new Map(routes.filter((route) => route.source).map((route) => [canonicalPageUrl(route.source), route.target]))
  const regions = [...html.matchAll(/<(?:nav|header)\b[^>]*>[\s\S]*?<\/(?:nav|header)>/gi)].map((match) => match[0] as string)
  const source = regions.length ? regions.join('\n') : html
  const nav: Theme['nav'] = []
  const seen = new Set<string>()
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? ''
    const rawHref = /\bhref\s*=\s*["']([^"']*)/i.exec(attrs)?.[1]?.replace(/&amp;/gi, '&').trim() ?? ''
    const fallback = /\b(?:aria-label|title)\s*=\s*["']([^"']*)/i.exec(attrs)?.[1] ?? ''
    const label = clonedText(match[2] ?? '') || clonedText(fallback)
    if (!rawHref || !label || label.length > 60 || /^(?:cart|search|log ?in|account)$/i.test(label)) continue
    let url: URL
    try { url = new URL(rawHref, sourceUrl) } catch { continue }
    if (url.origin !== origin) continue
    const canonical = canonicalPageUrl(url.toString())
    let href = routeBySource.get(canonical)
    if (!href && url.pathname === '/') href = '/'
    if (!href && /^\/(?:products|collections|pages|blogs)(?:\/|$)/.test(url.pathname)) href = `${url.pathname}${url.search}${url.hash}`
    if (!href || seen.has(href)) continue
    seen.add(href)
    nav.push({ label: href === '/' ? 'Home' : label.slice(0, 60), href: href.slice(0, 240) })
    if (nav.length === 8) break
  }
  return nav
}

function clonedText(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', trade: '™', reg: '®', copy: '©' }
  return value.replace(/<(?:style|script|svg)\b[\s\S]*?<\/(?:style|script|svg)>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match
    const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  }).replace(/\s+/g, ' ').trim()
}

export function productPathsFromClone(html: string, sourceUrl: string): string[] {
  let origin = ''
  try { origin = new URL(sourceUrl).origin } catch { return [] }
  const paths = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)/gi)) {
    try {
      const url = new URL((match[1] ?? '').replace(/&amp;/gi, '&'), sourceUrl)
      if (url.origin === origin && /^\/products\/[^/]+\/?$/i.test(url.pathname)) paths.add(url.pathname.replace(/\/$/, ''))
    } catch { /* malformed links do not belong in the redirect table */ }
  }
  return [...paths]
}

function isProductUrl(value: string): boolean {
  try { return /^\/products\/[^/]+\/?$/i.test(new URL(value).pathname) } catch { return false }
}
