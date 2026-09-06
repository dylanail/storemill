import { listProducts } from '../domain/catalog.ts'
import { bundleFor } from '../domain/bundles.ts'
import { totals } from '../domain/cart.ts'
import { escapeHtml } from '../lib/http.ts'
import { format } from '../lib/money.ts'
import type { StoreView } from './render.ts'

/** Checkout choices use owned catalog prices and the same promotions as the final payment. */
export function funnelSelection(view: StoreView): string {
  if (view.store.kind !== 'funnel' || !view.cart) return ''
  const cart = view.cart
  const options = listProducts(view.db, view.store.id, { status: view.preview ? 'all' : 'published', limit: 250 }).filter(product => product.status !== 'archived' && !product.metadata.hidden&&(!view.checkoutProductId||product.id===view.checkoutProductId)).flatMap(product => {
    const bundle = bundleFor(view.db, view.store.id, product.id)
    return product.variants.flatMap(variant => {
      const quantities = [...new Set([1, ...(bundle?.tiers.map(tier => tier.quantity) ?? [])])].sort((a, b) => a - b)
      return quantities.map(quantity => {
        const available = variant.allowBackorder || variant.inventory >= quantity
        const chosen = cart.items.some(item => !item.giftOf && item.variantId === variant.id && item.quantity === quantity)
        const line = { productId: product.id, variantId: variant.id, title: product.title, variantTitle: variant.title, image: variant.image || product.heroImage, unitCents: variant.priceCents, quantity }
        const quote = totals(view.db, view.store.id, { ...cart, items: [line] })
        const label = product.title + (variant.title && !/^(default|default title)$/i.test(variant.title) ? ` — ${variant.title}` : '') + (quantity > 1 ? ` × ${quantity}` : '')
        return `<label class="funnel-choice"><input type="radio" name="funnelPackage" value="${escapeHtml(variant.id)}:${quantity}" data-funnel-variant="${escapeHtml(variant.id)}" data-funnel-quantity="${quantity}" ${chosen ? 'checked' : ''} ${available ? '' : 'disabled'}><span>${escapeHtml(label)}${available ? '' : ' (sold out)'}</span><strong>${format(quote.subtotalCents - quote.discountCents, quote.currency, view.region?.locale)}</strong></label>`
      })
    })
  })
  return `<style data-funnel-selection-style>[data-funnel-selection]{border:0;padding:0;margin:0 0 24px;min-width:0}[data-funnel-selection] legend{font-size:20px;font-weight:600;margin-bottom:12px}.funnel-choice{display:flex!important;align-items:center!important;gap:12px!important;padding:14px!important;margin:8px 0!important;border:1px solid #8886;border-radius:8px;cursor:pointer;min-width:0}.funnel-choice:has(input:checked){border-color:currentColor;background:#8881}.funnel-choice input{flex:0 0 18px!important;width:18px!important;height:18px!important;min-height:18px!important;margin:0!important}.funnel-choice span{flex:1;min-width:0;overflow-wrap:anywhere}.funnel-choice strong{white-space:nowrap}[data-funnel-error]{color:#b3261e;font-size:14px}</style><fieldset data-funnel-selection><legend>Choose your package</legend>${options.join('') || '<p>No packages are available yet.</p>'}<p data-funnel-error role="status" aria-live="polite">${cart.items.length ? '' : options.length ? 'Select a package to continue.' : ''}</p></fieldset>`
}
