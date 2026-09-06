import type { ImportedProduct } from '../domain/ops.ts'
import type { Product } from '../domain/types.ts'

type Element = { attrs: string; inner: string; html: string; start: number; end: number }
export type ImportedOfferPlan = {
  product: ImportedProduct
  bindings: Array<{ elementId: string; sourceId: string; variantIndex: number; purchaseType: 'one-time' }>
  notes: string[]
}

const attribute = (attrs: string, name: string) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(attrs)?.slice(1).find((value) => value !== undefined) ?? ''
const classIs = (attrs: string, token: string) => attribute(attrs, 'class').split(/\s+/).includes(token)
const decode = (text: string) => text.replace(/&amp;/gi, '&').replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, ' ').trim()
const plain = (text: string) => decode(text.replace(/<[^>]*>/g, ' '))

function elements(html: string, accept: (attrs: string) => boolean): Element[] {
  const stack: Array<{ attrs: string; start: number; content: number }> = []
  const found: Element[] = []
  for (const match of html.matchAll(/<(\/?)div\b([^>]*)>/gi)) {
    if (!match[1]) stack.push({ attrs: match[2] ?? '', start: match.index, content: match.index + match[0].length })
    else {
      const open = stack.pop()
      if (open && accept(open.attrs)) found.push({ attrs: open.attrs, start: open.start, end: match.index + match[0].length, inner: html.slice(open.content, match.index), html: html.slice(open.start, match.index + match[0].length) })
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

/** Extract explicitly labelled one-time package prices from Funnelish offer tiles. No inferred/default price or recurring billing is created. */
export function planImportedOfferProduct(html: string, sourceUrl: string, options: { currency: string }): ImportedOfferPlan | null {
  const body = html.replace(/<(?:script|style)\b[\s\S]*?<\/(?:script|style)>/gi, '')
  const groups = elements(body, (attrs) => classIs(attrs, 'khOneOffer') || attribute(attrs, 'data-purchase-type') === 'one-time')
  if (!groups.length || !/^[A-Z]{3}$/.test(options.currency)) return null
  const gallery = elements(body, (attrs) => classIs(attrs, 'product-gallery'))[0]
  const galleryImages = (gallery?.inner.match(/<img\b[^>]*>/gi) ?? [])
  const productTitle = galleryImages.map((tag) => attribute(tag, 'alt')).find((value) => value.trim())
    || plain(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(body)?.[1] ?? '')
    || plain(/<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? '')
  if (!productTitle) return null
  const imageUrl = (raw: string) => {
    if (/^\/_uploads\//.test(raw)) return raw
    try { const url = new URL(decode(raw), sourceUrl); return /^https?:$/.test(url.protocol) ? url.toString() : '' } catch { return '' }
  }
  const images = [...new Set(galleryImages.map((tag) => imageUrl(attribute(tag, 'data-src') || attribute(tag, 'src'))).filter(Boolean))].slice(0, 24)
  const variants: ImportedProduct['variants'] = []
  const bindings: ImportedOfferPlan['bindings'] = []
  for (const group of groups) for (const tile of elements(group.inner, (attrs) => classIs(attrs, 'khOfferBox') || attribute(attrs, 'data-offer') === 'package')) {
    const elementId = attribute(tile.attrs, 'id')
    if (!elementId || bindings.some((binding) => binding.elementId === elementId)) continue
    let visible = tile.inner
    const hiddenElements = elements(visible, (attrs) => classIs(attrs, 'kh_none') || /(?:^|;)\s*display\s*:\s*none/i.test(attribute(attrs, 'style')))
    for (const hidden of hiddenElements.filter((element) => !hiddenElements.some((parent) => parent !== element && parent.start < element.start && parent.end > element.end)).sort((a, b) => b.start - a.start)) visible = visible.slice(0, hidden.start) + visible.slice(hidden.end)
    const text = plain(visible)
    const name = /\bBuy\s+\d+\s*\+\s*Get\s+\d+\s+FREE\b/i.exec(text)?.[0]
      || elements(visible, (attrs) => attribute(attrs, 'data-offer-title') !== '').map((element) => plain(element.inner))[0]
    const price = /(?:\$|USD\s*)\s*(\d{1,5}(?:,\d{3})*(?:\.\d{2}))(?!\d)/i.exec(text)?.[1]
    if (!name || !price || !['USD', 'CAD', 'AUD', 'NZD', 'SGD'].includes(options.currency)) continue
    const priceCents = Math.round(Number(price.replace(/,/g, '')) * 100)
    if (!Number.isSafeInteger(priceCents) || priceCents <= 0) continue
    const sourceId = `element:${elementId}`
    const tileImage = /<img\b[^>]*>/i.exec(tile.inner)?.[0] ?? ''
    const image = imageUrl(attribute(tileImage, 'data-src') || attribute(tileImage, 'src'))
    bindings.push({ elementId, sourceId, variantIndex: variants.length, purchaseType: 'one-time' })
    variants.push({ title: name, priceCents, sourceId, ...(image ? { image } : {}) })
  }
  if (!variants.length) return null
  const hasRecurring = elements(body, (attrs) => classIs(attrs, 'khSubOffer') || attribute(attrs, 'data-purchase-type') === 'subscription').length > 0
  return {
    product: { title: decode(productTitle), description: '', images, priceCents: variants[0]!.priceCents, currency: options.currency, variants, options: [], source: sourceUrl },
    bindings,
    notes: [`Extracted ${variants.length} explicitly priced one-time packages in ${options.currency}; each variant represents one complete package.`, ...(hasRecurring ? ['Subscription offers were not imported: the current checkout requires an explicitly configured recurring-payment flow.'] : [])],
  }
}

/** Add first-party product/variant references while preserving the source tile's layout and copy. */
export function bindImportedOfferProduct(html: string, plan: ImportedOfferPlan, product: Product): string {
  const byId = new Map(plan.bindings.map((binding) => [binding.elementId, binding]))
  return html.replace(/<div\b[^>]*>/gi, (tag) => {
    const binding = byId.get(attribute(tag, 'id'))
    if (!binding) return tag
    const variant = product.variants.find((entry) => product.metadata[`sourceVariant:${entry.id}`] === binding.sourceId) ?? product.variants[binding.variantIndex]
    if (!variant || variant.title !== plan.product.variants[binding.variantIndex]?.title || variant.priceCents !== plan.product.variants[binding.variantIndex]?.priceCents) return tag
    const cleaned = tag.replace(/\sdata-copy-(?:variant-id|product-id|purchase-type)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    return cleaned.replace(/>$/, ` data-copy-product-id="${product.id}" data-copy-variant-id="${variant.id}" data-copy-purchase-type="one-time">`)
  })
}
