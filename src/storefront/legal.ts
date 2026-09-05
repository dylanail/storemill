import { escapeHtml } from '../lib/http.ts'
import { json, type Db } from '../lib/db.ts'
import type { Store } from '../control/stores.ts'

/**
 * Generated legal pages.
 *
 * A privacy policy and terms of sale are written from what the store
 * actually does: which data it keeps (first-party analytics without a
 * cookie, order and email records), which processors it uses (the payment
 * provider, the email sender, the plugins installed), what the shipping,
 * returns and guarantee promises are, and who the merchant is. The owner
 * overrides the parts a template cannot know — the legal name, the address,
 * the contact — and the rest tracks the store as it changes.
 *
 * It is a policy that describes the store truthfully, not legal advice; the
 * page says so at the bottom.
 */
export type Legal = {
  company: string
  address: string
  email: string
  country: string
  returnsDays: number
  guaranteeDays: number
  /** Extra paragraphs the owner adds to either document. */
  privacyExtra: string
  termsExtra: string
  updatedAt: string
}

export function legalFor(db: Db, store: Store): Legal {
  const row = db.one<{ legal: string }>('SELECT legal FROM stores WHERE id = ?', store.id)
  const stored = json<Partial<Legal>>(row?.legal, {})
  return {
    company: stored.company || store.name,
    address: stored.address || '',
    email: stored.email || '',
    country: stored.country || (db.one<{ countries: string }>('SELECT countries FROM regions WHERE store_id = ? AND is_default = 1', store.id)?.countries ? (json<string[]>(db.one<{ countries: string }>('SELECT countries FROM regions WHERE store_id = ? AND is_default = 1', store.id)?.countries, [])[0] ?? '') : ''),
    returnsDays: stored.returnsDays ?? 30,
    guaranteeDays: stored.guaranteeDays ?? 30,
    privacyExtra: stored.privacyExtra ?? '',
    termsExtra: stored.termsExtra ?? '',
    updatedAt: stored.updatedAt ?? store.createdAt,
  }
}

export function saveLegal(db: Db, storeId: string, patch: Partial<Legal>) {
  const row = db.one<{ legal: string }>('SELECT legal FROM stores WHERE id = ?', storeId)
  const current = json<Partial<Legal>>(row?.legal, {})
  db.run('UPDATE stores SET legal = ? WHERE id = ?', JSON.stringify({ ...current, ...patch, updatedAt: new Date().toISOString() }), storeId)
}

type Facts = {
  processors: string[]
  hasStripe: boolean
  hasEmail: boolean
  hasReviews: boolean
  hasSubscriptions: boolean
  freeShippingAbove: string
  /** Advertising measurement actually installed on this store, by name. */
  pixels: string[]
}

function facts(db: Db, store: Store): Facts {
  const plugins = db.all<{ plugin_id: string }>('SELECT plugin_id FROM store_plugins WHERE store_id = ? AND enabled = 1', store.id).map((row) => row.plugin_id)
  const hasStripe = plugins.includes('stripe') || Boolean(process.env.STRIPE_SECRET_KEY)
  const subscriptions = db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND subscription != '{}' AND json_extract(subscription, '$.cadences') IS NOT NULL", store.id)?.c ?? 0
  const threshold = db.one<{ free_above_cents: number | null }>('SELECT s.free_above_cents FROM shipping_options s JOIN regions r ON r.id = s.region_id WHERE r.store_id = ? AND s.free_above_cents IS NOT NULL ORDER BY s.position LIMIT 1', store.id)
  const processors = [
    ...(hasStripe ? ['Stripe (payment processing)'] : []),
    ...(process.env.AMBORAS_SMTP_HOST || process.env.RESEND_API_KEY ? ['our email provider (order and account email)'] : []),
    ...plugins.filter((plugin) => !['stripe', 'product-reviews', 'upsells'].includes(plugin)).map((plugin) => `${plugin.replace(/-/g, ' ')} (integration you installed on the store)`),
  ]
  return {
    processors,
    hasStripe,
    hasEmail: true,
    hasReviews: plugins.includes('product-reviews') || (db.one<{ c: number }>('SELECT COUNT(*) c FROM reviews WHERE store_id = ?', store.id)?.c ?? 0) > 0,
    hasSubscriptions: subscriptions > 0,
    freeShippingAbove: threshold?.free_above_cents ? `${(threshold.free_above_cents / 100).toFixed(0)} ${store.currency}` : '',
    // The advertising pixels this store actually has installed. The Analytics
    // clause asserted cookie-free counting and "nothing is sold or shared for
    // advertising" on a page that was firing fbq('track','PageView') three
    // lines above it.
    pixels: plugins.filter((plugin) => ['meta-pixel', 'tiktok-pixel', 'ga4', 'google-ads', 'pinterest-tag', 'snap-pixel'].includes(plugin)).map((plugin) => PIXEL_NAMES[plugin] ?? plugin),
  }
}

const PIXEL_NAMES: Record<string, string> = {
  'meta-pixel': 'Meta (Facebook and Instagram)',
  'tiktok-pixel': 'TikTok',
  ga4: 'Google Analytics',
  'google-ads': 'Google Ads',
  'pinterest-tag': 'Pinterest',
  'snap-pixel': 'Snap',
}

const e = escapeHtml
const paragraphs = (text: string) => text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean).map((part) => `<p>${e(part)}</p>`).join('')

/**
 * Shipping and returns, from how the store is actually configured.
 *
 * This was the one built-in policy page still hardcoded: every store served
 * the demo's fourteen-day build times, a currency-less "Free shipping over
 * 200" and a joke about boxing gear, from the footer of every page.
 */
export function shippingHtml(db: Db, store: Store): string {
  const legal = legalFor(db, store)
  const f = facts(db, store)
  const rates = db.all<{ name: string; amount_cents: number; free_above_cents: number | null; region: string; currency: string }>(
    `SELECT s.name, s.amount_cents, s.free_above_cents, r.name region, r.currency
     FROM shipping_options s JOIN regions r ON r.id = s.region_id
     WHERE r.store_id = ? ORDER BY r.is_default DESC, r.name, s.position`,
    store.id,
  )
  const windows = db
    .all<{ min: number | null; max: number | null; processing: number | null }>(
      `SELECT json_extract(supplier, '$.shippingDaysMin') min, json_extract(supplier, '$.shippingDaysMax') max,
              json_extract(supplier, '$.processingDays') processing
       FROM products WHERE store_id = ? AND status = 'published'`,
      store.id,
    )
    .filter((row) => row.min !== null && row.max !== null)
  const lead = windows.length
    ? (() => {
        const from = Math.min(...windows.map((row) => (row.processing ?? 0) + (row.min ?? 0)))
        const to = Math.max(...windows.map((row) => (row.processing ?? 0) + (row.max ?? 0)))
        return `<p>Orders are prepared and then shipped; most arrive ${from}–${to} days after you order. The estimate on each product page is the one for that product.</p>`
      })()
    : '<p>Delivery times are shown on each product page where they are known for that product.</p>'
  return `
<p><em>Last updated ${e(legal.updatedAt.slice(0, 10))}.</em></p>
<h3>What it costs</h3>
${rates.length
    ? `<table class="lines">${rates
        .map(
          (rate) =>
            `<tr><td>${e(rate.region)} — ${e(rate.name)}</td><td>${rate.amount_cents ? `${(rate.amount_cents / 100).toFixed(2)} ${e(rate.currency)}` : 'Free'}${rate.free_above_cents ? `, free over ${(rate.free_above_cents / 100).toFixed(0)} ${e(rate.currency)}` : ''}</td></tr>`,
        )
        .join('')}</table>`
    : '<p>Shipping is calculated at checkout.</p>'}
${f.freeShippingAbove ? `<p>Orders over ${e(f.freeShippingAbove)} ship free.</p>` : ''}
<h3>How long it takes</h3>
${lead}
<h3>Returns</h3>
<p>You may return an item within ${legal.returnsDays} days of delivery for a refund or exchange, as long as it is in the condition you received it. Where a product page states a ${legal.guaranteeDays}-day money-back guarantee, that guarantee applies as written there.</p>
${legal.email ? `<p>Start a return by emailing <a href="mailto:${e(legal.email)}">${e(legal.email)}</a>.</p>` : '<p>Start a return through the contact page.</p>'}
<p class="micro">This page is generated from the store's own shipping rates, delivery windows and returns window, and updates when they change.</p>`
}

export function privacyHtml(db: Db, store: Store): string {
  const legal = legalFor(db, store)
  const f = facts(db, store)
  const who = legal.company === store.name ? store.name : `${legal.company}, trading as ${store.name}`
  return `
<p><em>Last updated ${e(legal.updatedAt.slice(0, 10))}.</em></p>
<h3>Who we are</h3>
<p>${e(who)}${legal.address ? `, ${e(legal.address)}` : ''}${legal.country ? ` (${e(legal.country)})` : ''} runs this store.${legal.email ? ` Privacy questions go to <a href="mailto:${e(legal.email)}">${e(legal.email)}</a>.` : ' Privacy questions go through the contact page.'}</p>
<h3>What we collect and why</h3>
<ul>
<li><strong>Orders.</strong> Your name, email, shipping address and what you bought, kept so we can fulfil the order, answer questions about it and meet tax and accounting obligations.</li>
<li><strong>Payment.</strong> ${f.hasStripe ? 'Card details go directly to Stripe and never touch our servers; we keep the payment reference Stripe returns.' : 'Card details are handled by the payment provider shown at checkout and are not stored by us.'}</li>
<li><strong>Email.</strong> Order confirmations, shipping updates and, only if you ticked the box or signed up, marketing email you can leave with one click.${f.hasEmail ? ' Opens and clicks on those emails are counted.' : ''}</li>
<li><strong>Analytics.</strong> We count visits with a first-party, cookie-free method: a hash of your network address and browser that changes every day and cannot identify you across sites. We also record how far a page was scrolled, which sections were seen and which buttons were used, to improve the pages. ${
  f.pixels.length
    ? `This store also loads advertising measurement from ${e(f.pixels.join(', '))}, which set their own cookies and receive the pages you view and the orders you place so we can measure our advertising. Their own policies govern what they do with it, and your browser's tracking controls apply to them.`
    : 'Nothing is sold or shared for advertising.'
}</li>
${f.hasReviews ? '<li><strong>Reviews and questions.</strong> The name and text you submit with a review or a question are shown publicly with the product once approved.</li>' : ''}
${f.hasSubscriptions ? '<li><strong>Subscriptions.</strong> If you subscribe, we keep the schedule and the saved payment reference needed to charge each delivery until you cancel.</li>' : ''}
<li><strong>Cart.</strong> A cookie holds your cart id for thirty days so what you add is still there when you come back. It contains nothing else.</li>
</ul>
<h3>Who else sees it</h3>
<p>${f.processors.length ? `We share only what each needs with: ${e(f.processors.join('; '))}.` : 'We do not share personal data with third parties beyond the carrier that delivers your order.'} Carriers receive your name and address to deliver. Suppliers who ship on our behalf receive the same.</p>
<h3>Your choices</h3>
<ul>
<li>Ask for a copy of what we hold about you, ask us to correct it, or ask us to delete it, and we will within thirty days unless we must keep an order record for tax.</li>
<li>Leave marketing email with the link in any message.</li>
<li>Browse without a cookie; the cart cookie is only set when you add something.</li>
</ul>
<h3>Where it is kept</h3>
<p>Order and account records are kept on the servers this store runs on and with the processors named above, for as long as needed for the purposes above and then deleted or anonymised.</p>
<h3>Children</h3>
<p>This store is not directed at children under sixteen and we do not knowingly collect their data.</p>
${legal.privacyExtra ? paragraphs(legal.privacyExtra) : ''}
<p class="micro">This policy is generated from how the store is actually configured and updates when that changes. It describes our practices; it is not legal advice.</p>`
}

export function termsHtml(db: Db, store: Store): string {
  const legal = legalFor(db, store)
  const f = facts(db, store)
  return `
<p><em>Last updated ${e(legal.updatedAt.slice(0, 10))}.</em></p>
<h3>The seller</h3>
<p>Orders on this store are with ${e(legal.company)}${legal.address ? `, ${e(legal.address)}` : ''}.${legal.email ? ` Contact: <a href="mailto:${e(legal.email)}">${e(legal.email)}</a>.` : ''}</p>
<h3>Orders and prices</h3>
<p>Prices are shown in ${e(store.currency)} and include what they say they include; shipping and any tax are shown before you pay. An order is accepted when we confirm it by email. If a price was shown wrongly we will tell you before charging and you may cancel.</p>
<h3>Shipping</h3>
<p>Delivery estimates are shown on the product page and at checkout from the supplier's processing and transit times.${f.freeShippingAbove ? ` Shipping is free on orders over ${e(f.freeShippingAbove)}.` : ''} Risk passes to you on delivery.</p>
<h3>Returns and the guarantee</h3>
<p>You may return an item within ${legal.returnsDays} days of delivery for a refund or exchange as long as it is in the condition you received it. Where a product page states a ${legal.guaranteeDays}-day money-back guarantee, that guarantee applies as written there: if it does not do what the page says, tell us within ${legal.guaranteeDays} days and we refund the price.</p>
${f.hasSubscriptions ? '<h3>Subscriptions</h3><p>A subscription renews on the schedule you chose at the price shown when you subscribed, until you cancel from your order page or by email. Cancel before a renewal date and that delivery is not charged.</p>' : ''}
<h3>Bundles, upsells and codes</h3>
<p>Bundle prices, free gifts and post-purchase offers apply only as shown at the time of the order. A discount code applies to the items it says it applies to and cannot be combined with another code unless stated.</p>
<h3>Reviews and content</h3>
<p>Reviews and questions you submit may be shown on the store once approved and may be declined if they are not about the product. Claims on this store describe the product as we understand it; nothing here is medical advice.</p>
<h3>Liability</h3>
<p>Our liability for an order is limited to the amount you paid for it, except where the law does not allow that limit. Nothing here removes rights you have as a consumer where you live.</p>
${legal.termsExtra ? paragraphs(legal.termsExtra) : ''}
<p class="micro">These terms are generated from how the store is configured — its returns window, guarantee, shipping threshold and subscriptions — and update when those change. They are not legal advice.</p>`
}
