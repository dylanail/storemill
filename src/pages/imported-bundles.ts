import { listBundles, upsertBundle, type Bundle } from '../domain/bundles.ts'
import { getProduct } from '../domain/catalog.ts'
import type { Product } from '../domain/types.ts'
import type { Db } from '../lib/db.ts'
import { escapeHtml } from '../lib/http.ts'
import { minorDigits } from '../lib/money.ts'
import { decodeMediaAttribute, mapMediaDocument } from './clone-media.ts'

export type ImportedBundlePlan = {
  sourceUrl: string
  sourceProductId: string
  sourceVariantId: string
  sourceUnitCents: number
  sourceCompareAtCents?: number
  currency: string
  title: string
  html: string
  css: string
  hostId: string
  tiers: Array<{ sourceId: string; quantity: number; totalCents: number; unitPriceCents: number; label: string; badge?: string }>
  notes: string[]
}

const bundlePattern = /<kaching-bundle\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/kaching-bundle>/gi
function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
  return decodeMediaAttribute(match?.[1] ?? match?.[2] ?? match?.[3] ?? '')
}
function jsonAttribute(tag: string, name: string): any {
  try { return JSON.parse(attribute(tag, name)) } catch { return null }
}
function jsonScript(html: string, name: string): any {
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!attribute(' ' + match[1], 'class').split(/\s+/).includes(name) && attribute(' ' + match[1], 'id') !== name) continue
    try { return JSON.parse(match[2]!) } catch { return null }
  }
  return null
}
function plain(html: string): string { return decodeMediaAttribute(html.replace(/<!--[\s\S]*?-->|<[^>]+>/g, '')).trim() }

/** Read only an explicitly priced, one-time, single-variant source widget; never infer offers from marketing labels. */
export function planImportedBundle(html: string, sourceUrl: string, sourceMetadata = html): ImportedBundlePlan | null {
  const match = [...html.matchAll(bundlePattern)][0]
  if (!match) return null
  const widget = match[0]
  const blockTag = /<kaching-bundles-block\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(widget)?.[0] ?? ''
  const settings = jsonAttribute(blockTag, 'deal-block') ?? jsonScript(sourceMetadata, 'kaching-bundles-deal-block-settings')
  const product = jsonAttribute(blockTag, 'product') ?? jsonScript(sourceMetadata, 'kaching-bundles-product')
  const config = jsonAttribute(blockTag, 'config') ?? jsonScript(sourceMetadata, 'kaching-bundles-config')
  if (!settings || !product || !config) throw new Error('Bundle source settings were not captured. Reload the source widget before copying.')
  const currency = String(config.marketCurrencyCode ?? '').toUpperCase()
  const variants = product.variants
  if (!/^[A-Z]{3}$/.test(currency) || !Array.isArray(variants) || variants.length !== 1 || product.requiresSellingPlan || product.sellingPlans?.length) throw new Error('This source bundle needs manual mapping: only one-time, single-variant offers are supported automatically.')
  const variant = variants[0]
  if (!Number.isSafeInteger(variant.price) || variant.price <= 0 || variant.sellingPlans?.length) throw new Error('The source bundle does not have a verified one-time unit price.')
  const sourceCompareAtCents = Number.isSafeInteger(variant.compareAtPrice) && variant.compareAtPrice > variant.price ? variant.compareAtPrice as number : undefined
  if (!Array.isArray(settings.dealBars) || !settings.dealBars.length || settings.dealBars.length > 5) throw new Error('The source bundle has an unsupported number of tiers.')
  const notes: string[] = []
  const tiers: ImportedBundlePlan['tiers'] = settings.dealBars.map((bar: any) => {
    if (bar.dealBarType !== 'quantity-break' || bar.discountType !== 'specific' || bar.sellingPlanEnabled || bar.sellingPlanGid || bar.freeGifts?.length || bar.upsells?.length || bar.featuredProductGID || !Number.isSafeInteger(bar.quantity) || bar.quantity < 1 || bar.quantity > 999 || typeof bar.discountValue !== 'number') throw new Error('This bundle includes an unsupported subscription, gift, product mix or price rule. Review it before enabling purchases.')
    const totalCents = Math.round(bar.discountValue * 10 ** minorDigits(currency))
    if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || totalCents % bar.quantity || totalCents > variant.price * bar.quantity) throw new Error('The source bundle price cannot be represented as an exact discounted unit price.')
    const sourceId = String(bar.id)
    const rendered = new RegExp(`data-deal-bar-id=["']${sourceId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][\\s\\S]*?class=["']kaching-bundles__bar-price["'][^>]*>([\\s\\S]*?)<\\/div>`, 'i').exec(widget)
    const renderedAmount = rendered ? Number(plain(rendered[1]!).replace(/[^\d.-]/g, '')) : NaN
    if (!Number.isFinite(renderedAmount) || Math.round(renderedAmount * 10 ** minorDigits(currency)) !== totalCents) throw new Error(`The ${bar.title || 'bundle'} card's visible price differs from its source settings.`)
    const percentage = /(?:Extra|Save)\s*(\d+(?:\.\d+)?)%/i.exec(String(bar.label ?? ''))
    const actual = (1 - totalCents / (variant.price * bar.quantity)) * 100
    if (percentage && Math.abs(Number(percentage[1]) - actual) > 0.1) notes.push(`Source ${bar.title} label says ${percentage[1]}% while its explicit price is approximately ${actual.toFixed(2)}% below individual units. Preserved source copy; checkout enforces ${totalCents} ${currency} minor units for ${bar.quantity}.`)
    return { sourceId, quantity: bar.quantity, totalCents, unitPriceCents: totalCents / bar.quantity, label: String(bar.title ?? `Buy ${bar.quantity}`), ...(bar.badgeText ? { badge: String(bar.badgeText) } : {}) }
  })
  if (new Set(tiers.map(tier => tier.quantity)).size !== tiers.length) throw new Error('The source bundle has conflicting quantity tiers.')
  const css = [...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi)].find(style => /\bid=["']kaching-bundles-styles["']/i.test(style[0]))?.[0] ?? ''
  if (!css) throw new Error('The source bundle stylesheet was not captured. Copy again after the cards render.')
  const previous = html.slice(0, match.index)
  const hostId = [...previous.matchAll(/<div\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)].map(tag => attribute(tag[0], 'id')).filter(id => id.includes('kaching_bundles')).at(-1) ?? ''
  const clean = mapMediaDocument(widget, tag => {
    if (/^<kaching-bundles-block\b/i.test(tag)) return '<kaching-bundles-block data-instant-styles="none">'
    if (/^<kaching-bundle\b/i.test(tag)) return `<kaching-bundle data-copy-source-bundle="${escapeHtml(String(product.id))}">`
    return tag.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  }).replace(/<script\b[\s\S]*?<\/script>/gi, '')
  return { sourceUrl, sourceProductId: String(product.id), sourceVariantId: String(variant.id), sourceUnitCents: variant.price, ...(sourceCompareAtCents ? { sourceCompareAtCents } : {}), currency, title: String(settings.blockTitle ?? ''), html: clean, css, hostId, tiers, notes }
}

function verifyProduct(product: Product, plan: ImportedBundlePlan): void {
  if (product.variants.length !== 1 || product.variants[0]!.priceCents !== plan.sourceUnitCents) throw new Error('Link a single-variant product whose unit price matches the captured bundle before enabling it.')
  const sourceVariant = product.metadata[`sourceVariant:${product.variants[0]!.id}`]
  if (sourceVariant && sourceVariant !== plan.sourceVariantId) throw new Error('The selected product maps to a different source variant.')
}

/** Install only the reviewed catalog rule; page edits are returned to the caller for normal revision handling. */
export function installImportedBundle(db: Db, storeId: string, productId: string, plan: ImportedBundlePlan): { bundle: Bundle; html: string; css: string; notes: string[] } {
  const store = db.one<{ currency: string }>('SELECT currency FROM stores WHERE id = ?', storeId)
  const product = getProduct(db, storeId, productId)
  if (!store || !product || store.currency.toUpperCase() !== plan.currency) throw new Error('The copied bundle needs a matching product and store currency.')
  verifyProduct(product, plan)
  const compareAtCents = product.variants[0]!.compareAtCents || plan.sourceCompareAtCents
  const tiers = plan.tiers.map(tier => ({ quantity: tier.quantity, unitPriceCents: tier.unitPriceCents, ...(compareAtCents ? { compareAtTotalCents: compareAtCents * tier.quantity } : {}), discountPercent: 0, label: tier.label, ...(tier.badge ? { badge: tier.badge } : {}) }))
  const previous = listBundles(db, storeId).find(bundle => bundle.productId === productId)
  if (previous?.status === 'paused') throw new Error('This product has a paused bundle. Review it before enabling a copied offer.')
  if (previous && JSON.stringify(previous.tiers.map(({compareAtTotalCents, ...tier}) => tier)) !== JSON.stringify(tiers.map(({compareAtTotalCents, ...tier}) => tier))) throw new Error('This product already has different bundle rules. Review them before replacing the copied offer.')
  if (!product.variants[0]!.compareAtCents && plan.sourceCompareAtCents) db.update('variants', product.variants[0]!.id, { compare_at_cents: plan.sourceCompareAtCents })
  if (previous) {
    previous.tiers = previous.tiers.map(tier => ({ ...tier, ...(tier.compareAtTotalCents === undefined && compareAtCents ? { compareAtTotalCents: compareAtCents * tier.quantity } : {}) }))
    db.update('bundles', previous.id, { tiers: previous.tiers })
  }
  const bundle = previous ?? upsertBundle(db, storeId, { productId, title: plan.title, tiers })
  let html = mapMediaDocument(plan.html, tag => {
    if (/^<kaching-bundle\b/i.test(tag)) return tag.replace(/>$/, ` data-copy-bundle="${bundle.id}" data-copy-bundle-currency="${plan.currency}" data-copy-product-id="${product.id}" data-copy-variant-id="${product.variants[0]!.id}">`)
    const sourceId = attribute(tag, 'data-deal-bar-id')
    const tier = plan.tiers.find(tier => tier.sourceId === sourceId)
    return tier ? tag.replace(/>$/, ` data-copy-bundle-quantity="${tier.quantity}" data-copy-bundle-total="${tier.totalCents}">`) : tag
  })
  // The app's pre-load stylesheet hides its content until foreign JavaScript
  // runs. The captured loaded cards remain visible under our own runtime.
  html += '<style data-copy-bundle-visible>[data-copy-bundle] .kaching-bundles__block--loaded{display:block!important}</style>'
  return { bundle, html, css: plan.css, notes: plan.notes }
}

/** Replace the matching source widget/empty app host; do not guess a new location or replace surrounding edits. */
export function repairImportedBundleHtml(original: string, plan: ImportedBundlePlan, installed: { html: string; css: string }): { html: string; changed: boolean; reason?: string } {
  let matched = false
  let html = original.replace(bundlePattern, widget => {
    const sourceId = attribute(widget, 'product-id') || attribute(widget, 'data-copy-source-bundle')
    if (sourceId && sourceId !== plan.sourceProductId) return widget
    matched = true
    return installed.html.replace(/<style data-copy-bundle-visible>[\s\S]*?<\/style>$/, '')
  })
  if (!matched && plan.hostId) html = mapMediaDocument(html, tag => {
    if (attribute(tag, 'id') !== plan.hostId) return tag
    matched = true
    return tag + installed.html.replace(/<style data-copy-bundle-visible>[\s\S]*?<\/style>$/, '')
  })
  if (!matched) return { html: original, changed: false, reason: 'No matching source bundle widget or app host exists on this page.' }
  const style = /<style\b[^>]*\bid=["']kaching-bundles-styles["'][^>]*>[\s\S]*?<\/style>/i
  html = style.test(html) ? html.replace(style, installed.css) : html.replace(/<\/head>/i, `${installed.css}</head>`)
  if (!/<style\b[^>]*\bid=["']kaching-bundles-styles["']/i.test(html)) html = installed.css + html
  if (!/data-copy-bundle-visible/.test(html)) html += '<style data-copy-bundle-visible>[data-copy-bundle] .kaching-bundles__block--loaded{display:block!important}</style>'
  return { html, changed: html !== original }
}
