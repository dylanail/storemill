import { readFileSync } from 'node:fs'
import { listProducts } from '../domain/catalog.ts'
import { convertCents, minorUnitRate } from '../domain/regions.ts'
import { bundleFor } from '../domain/bundles.ts'
import { applyPromotions } from '../domain/promotions.ts'
import type { Page } from '../pages/store.ts'
import type { StoreView } from './render.ts'
import { minorDigits } from '../lib/money.ts'

const runtime = readFileSync(new URL('./imported-commerce.js', import.meta.url), 'utf8') + '\n' + readFileSync(new URL('./imported-responsive-media.js', import.meta.url), 'utf8')

/** Authenticated previews include drafts; public storefronts only expose published catalog fields. */
export function importedCommerceConfig(view: StoreView, page: Page) {
  const products = listProducts(view.db, view.store.id, { status: view.preview ? 'all' : 'published', limit: 250 }).filter(product => product.status !== 'archived').map(product => ({
    id: product.id, handle: product.handle, title: product.title, image: product.heroImage, defaultSourceId:product.metadata.sourceDefaultVariant||'',
    variants: product.variants.map(variant => ({
      id: variant.id, title: variant.title, options: variant.optionValues, image: variant.image,
      sourceId: product.metadata[`sourceVariant:${variant.id}`] || '',
      price: convertCents(variant.priceCents, view.region, view.store.currency),
      available: variant.inventory > 0 || variant.allowBackorder,
    })),
    bundle: (() => {
      const bundle = bundleFor(view.db, view.store.id, product.id)
      if (!bundle) return null
      return { id: bundle.id, currency: view.store.currency, tiers: bundle.tiers.flatMap(tier => product.variants.map(variant => {
        const unitCents = convertCents(variant.priceCents, view.region, view.store.currency)
        const subtotalCents = unitCents * tier.quantity
        const line = { productId: product.id, variantId: variant.id, title: product.title, variantTitle: variant.title, image: variant.image || product.heroImage, unitCents, quantity: tier.quantity }
        const discount = applyPromotions(view.db, view.store.id, [line], { subtotalCents, currencyRate: minorUnitRate(view.region, view.store.currency), regionId: view.region?.id })
        const baseSubtotal = variant.priceCents * tier.quantity
        const baseDiscount = applyPromotions(view.db, view.store.id, [{ ...line, unitCents: variant.priceCents }], { subtotalCents: baseSubtotal, currencyRate: 1, regionId: view.region?.id })
        return { quantity: tier.quantity, variantId: variant.id, totalCents: subtotalCents - discount.discountCents, baseTotalCents: baseSubtotal - baseDiscount.discountCents, compareAtTotalCents: tier.compareAtTotalCents !== undefined ? convertCents(tier.compareAtTotalCents, view.region, view.store.currency) : convertCents(variant.compareAtCents ?? variant.priceCents, view.region, view.store.currency) * tier.quantity }
      })) }
    })(),
  }))
  return {
    base: view.base, preview: view.preview, assetKind: view.store.kind, role: page.role, productId: page.productId, sourceUrl: page.sourceUrl,
    currency: view.totals?.currency || view.region?.currency || view.store.currency,
    minor: minorDigits(view.totals?.currency || view.region?.currency || view.store.currency),
    products,
  }
}

/** Strip copied payment executables and point forms at our store even before JavaScript initializes. */
export function protectImportedForms(html: string, base: string, options: { previewPaymentFields?: boolean } = {}): string {
  return html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, (tag, attrs: string) => /data-pb-|type=["']application\/(?:ld\+)?json["']/i.test(attrs) ? tag : '')
    .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<input\b(?=[^>]*\sname=["'](?:cardNumber|cardDate|cardSecurityCode|card_number|cvv)["'])[^>]*>/gi, (tag) => options.previewPaymentFields
      ? tag.replace(/\s(?:name|value|type|autocomplete|disabled|readonly|tabindex)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '').replace(/\s*\/?>(?=$)/, ' type="text" disabled readonly tabindex="-1" autocomplete="off" data-copy-payment-placeholder aria-disabled="true">')
      : '')
    .replace(/<iframe\b(?=[^>]*\ssrc=["'][^"']*(?:stripe|paypal|braintree|payments))[\s\S]*?<\/iframe>/gi, '')
    .replace(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi, (_match, attributes: string, body: string) => {
      const action = /\saction\s*=\s*(["'])(.*?)\1/i.exec(' ' + attributes)?.[2] || ''
      const path = (() => { try { return new URL(action, 'https://source.invalid').pathname } catch { return action } })()
      const message = /<(?:textarea)\b|name=["'](?:contact\[body\]|message|body)["']/i.test(body)
      const search = /(?:^|\/)search(?:\/|$)/i.test(path) || /role=["']search["']/.test(attributes) || /type=["']search["']/.test(body)
      const newsletter = !message && (/subscribe|newsletter/i.test(path + ' ' + attributes) || /name=["']form_type["'][^>]*value=["']customer["']|value=["']customer["'][^>]*name=["']form_type["']/.test(body))
      const route = search ? '/search' : /(?:^|\/)track(?:\/|$)/i.test(path) ? '/track' : message ? '/contact' : newsletter ? '/subscribe' : /(?:cart\/add|add-to-cart)/i.test(path) ? '/cart/add' : (/checkout|checkouts|payment/i.test(action) || /\bfk-card-payment-container\b/i.test(attributes)) ? '/checkout' : /\/cart\/(update|code)$/.test(path) ? path.slice(path.lastIndexOf('/cart/')) : '/contact'
      const method = route === '/search' || route === '/track' ? 'get' : 'post'
      const names: Record<string, string> = { 'contact[email]':'email', 'contact[name]':'name', 'contact[body]':'message', 'contact[phone]':'phone', search:'q', search_query:'q', number:'order', order_number:'order' }
      body = body.replace(/\sname=(["'])([^"']+)\1/gi, (match, quote: string, name: string) => names[name] ? ` name=${quote}${names[name]}${quote}` : match)
      attributes = attributes.replace(/\s(?:action|method)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      return `<form ${attributes} action="${base}${route}" method="${method}" data-copy-form="${route.slice(1)}" data-copy-original-action="${action.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}">${body}</form>`
    }).replace(/\sformaction\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

export function importedCommerceHtml(view: StoreView, page: Page, checkout?: { form: string; summary: string; express: string; error?: string }, scope: 'page' | 'sections' = 'page'): string {
  const config = JSON.stringify({ ...importedCommerceConfig(view, page), checkout, scope }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  return `<style data-owned-commerce>
[data-copy-hidden]{display:none!important}
[data-owned-checkout-column="summary"]{display:block!important;align-self:start!important}
[data-owned-checkout-layout]{display:grid!important;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr)!important;gap:32px!important;max-width:1180px!important;width:100%!important;box-sizing:border-box!important;margin-left:auto!important;margin-right:auto!important}[data-owned-checkout-column]{min-width:0!important;max-width:100%!important;width:auto!important;box-sizing:border-box!important;padding:24px!important;order:0!important}[data-owned-checkout-column] img{max-width:100%}[data-owned-checkout-column="summary"]::after{width:100%!important;max-width:100%!important;left:0!important;right:0!important}[data-owned-summary-details]>summary{padding:12px 0;cursor:pointer;font-weight:600}
@media(max-width:740px){[data-owned-checkout-layout]{grid-template-columns:minmax(0,1fr)!important;gap:0!important}[data-owned-checkout-column]{padding:16px!important}[data-owned-checkout-column="summary"]{order:-1!important}}
[data-copy-notice]{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#171717;color:#fff;padding:12px 18px;border-radius:8px;max-width:calc(100vw - 32px);font:15px/1.5 system-ui;box-shadow:0 8px 32px #0003}[data-copy-notice][hidden]{display:none!important}
[data-owned-cart-lines]{display:grid;gap:16px}[data-owned-cart-line]{display:grid;grid-template-columns:64px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 0;border-bottom:1px solid #8884}[data-owned-cart-line] img{width:64px;height:72px;object-fit:cover}[data-owned-cart-line] input{width:64px;min-height:44px;padding:6px;font:inherit}[data-owned-cart-line] button{min-width:44px;min-height:44px;cursor:pointer;font:inherit}[data-owned-cart-line] p{margin:4px 0}[data-owned-cart-line] .quantity{display:flex;align-items:center;width:auto;height:auto}[data-owned-cart-line] .cart-item__totals{display:grid;gap:4px;text-align:right}[data-owned-cart-line] .quantity button{border:1px solid #8884;background:transparent;color:inherit}[data-owned-cart-line] .quantity input{position:static;opacity:1;color:inherit;background:transparent;border:1px solid #8884;text-align:center}[data-copy-drawer-open] .drawer__inner{max-height:100dvh;overflow:auto}[data-copy-drawer-open] .cart-drawer__body{min-height:0;overflow-y:auto}[data-copy-drawer-open]{visibility:visible!important;opacity:1!important;transform:none!important;display:var(--copy-drawer-display,block)!important}[data-copy-drawer-open] .drawer__inner{transform:none!important;visibility:visible!important}
[data-owned-checkout] #checkout-form{display:block!important;position:static!important;float:none!important;width:100%!important;max-width:100%!important;min-width:0!important;height:auto!important;margin:0!important;padding:0!important;transform:none!important;columns:auto!important}
[data-owned-checkout] .co-block,[data-owned-checkout] .field,[data-owned-checkout] .two,[data-owned-checkout] .methods,[data-owned-checkout] .pay-demo,[data-owned-checkout] .pay-el,[data-owned-checkout] .express{position:static!important;float:none!important;width:auto!important;min-width:0!important;max-width:100%!important;height:auto!important;transform:none!important;columns:auto!important;box-sizing:border-box!important}
[data-owned-checkout] .co-block{display:block!important;margin:24px 0!important;padding:0!important}[data-owned-checkout] .field{display:block!important;margin:10px 0!important;padding:0!important}[data-owned-checkout] .two{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:12px!important;margin:0!important;padding:0!important}
[data-owned-checkout] input,[data-owned-checkout] select{position:static!important;float:none!important;transform:none!important;box-sizing:border-box!important;max-width:100%!important;margin:0!important}[data-owned-checkout] input[type=checkbox],[data-owned-checkout] input[type=radio]{width:18px!important;min-width:18px!important;max-width:18px!important;height:18px!important;min-height:18px!important;display:inline-block!important;flex:0 0 18px!important;appearance:auto!important;padding:0!important}
[data-owned-checkout] input:not([type=checkbox]):not([type=radio]):not([type=hidden]),[data-owned-checkout] select{display:block!important;width:100%!important;min-width:0!important;max-width:100%!important;height:48px!important;min-height:48px!important;line-height:1.5!important;font-size:16px!important;padding:10px 12px!important;letter-spacing:normal!important;color:#222!important;background:#fff!important;border:1px solid #8888!important;border-radius:6px!important;box-shadow:none!important}
[data-owned-checkout] .check,[data-owned-checkout] .method{display:flex!important;position:static!important;width:100%!important;white-space:normal!important;align-items:center!important;gap:10px!important;margin:12px 0!important;font-size:13px!important;line-height:1.5!important;padding:0!important}[data-owned-checkout] .micro{font-size:13px!important;text-align:left!important;line-height:1.5!important;white-space:normal!important;letter-spacing:normal!important;margin:8px 0!important}
[data-owned-checkout] h2{font-size:20px!important;text-align:left!important;line-height:1.4!important;letter-spacing:normal!important;margin:16px 0!important;position:static!important}[data-owned-checkout] .pay{display:block!important;position:static!important;width:100%!important;min-width:0!important;height:auto!important;line-height:1.4!important;white-space:normal!important;transform:none!important;margin:16px 0!important}
@media(max-width:600px){[data-owned-checkout] .two{grid-template-columns:minmax(0,1fr)!important}}
[data-owned-checkout] input[type=hidden]{display:none!important}[data-owned-checkout] .pay-demo .row{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;width:100%!important;margin:8px 0!important}[data-owned-checkout] .cards{display:inline-flex!important;flex-wrap:wrap!important;gap:6px!important;font-size:11px!important}[data-owned-checkout] .cards i{font-style:normal!important;border:1px solid #ddd!important;padding:3px 5px!important;border-radius:3px!important}[data-owned-checkout-summary] .code{display:flex!important;align-items:center!important;gap:8px!important;max-width:100%!important}[data-owned-checkout-summary] .code input,[data-owned-checkout-summary] .code button{height:48px!important;min-height:48px!important;max-height:48px!important;font-size:16px!important;line-height:1.5!important;position:static!important;float:none!important;margin:0!important;padding:10px 12px!important;box-sizing:border-box!important}[data-owned-checkout-summary] .code input{width:100%!important;min-width:0!important;max-width:100%!important}[data-owned-summary-details]>summary{display:flex;justify-content:space-between;gap:12px}
[data-owned-checkout]{font-family:inherit;box-sizing:border-box;max-width:100%;min-width:0}[data-owned-checkout] *{box-sizing:border-box}[data-owned-checkout] .field{margin:10px 0}[data-owned-checkout] input:not([type=checkbox]):not([type=radio]),[data-owned-checkout] select{display:block;width:100%;min-width:0;font:inherit;min-height:48px;border:1px solid #8888;border-radius:6px;padding:12px;background:#fff;color:#222}[data-owned-checkout] .two{display:grid;grid-template-columns:1fr 1fr;gap:12px}[data-owned-checkout] .co-block{margin:24px 0}[data-owned-checkout] .method,[data-owned-checkout] .check{display:flex;gap:10px;align-items:center;margin:12px 0}[data-owned-checkout] .method b{margin-left:auto}[data-owned-checkout] .pay{width:100%;min-height:52px;border:0;border-radius:6px;padding:14px;background:#171717;color:white;font:600 16px/1.4 inherit;cursor:pointer}[data-owned-checkout] .pay:disabled{opacity:.6}[data-owned-checkout] h2{font-size:20px;margin:16px 0}[data-owned-checkout] .micro{font-size:13px;line-height:1.5}[data-owned-checkout-summary] .lines{width:100%;border-collapse:collapse}[data-owned-checkout-summary] .thumb{display:block;position:relative;width:64px}[data-owned-checkout-summary] .thumb img{width:56px;height:64px;object-fit:cover}[data-owned-checkout-summary] .thumb b{position:absolute;right:0;top:0}[data-owned-checkout-summary] .totals>div{display:flex;justify-content:space-between;gap:12px;padding:8px 0}[data-owned-checkout-summary] .code{display:flex;gap:8px;margin:16px 0}[data-owned-checkout-summary] .code input{min-width:0;width:100%;padding:10px}[data-owned-checkout-summary] .code button{min-height:44px}[data-owned-checkout-summary] .grand{font-weight:700;border-top:1px solid #8884}[data-owned-checkout-summary]{min-width:0;max-width:100%}
@media(max-width:600px){[data-owned-checkout] .two{grid-template-columns:1fr}[data-owned-checkout] input,[data-owned-checkout] select{font-size:16px}[data-owned-cart-line]{grid-template-columns:52px minmax(0,1fr)}[data-owned-cart-line]>:last-child{grid-column:2}[data-owned-cart-line] img{width:52px;height:64px}}
</style><script data-owned-commerce>window.__COPY_COMMERCE=${config};\n${runtime}\n</script>`
}
