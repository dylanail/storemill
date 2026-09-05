import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { createHash } from 'node:crypto'
import { createProduct, getProduct, listProducts } from './catalog.ts'
import type { Product } from './types.ts'

/**
 * A funnel, the way Funnelish lays one out:
 *
 *   ad → advertorial → offer page → checkout (+ order bump) → upsell → downsell → thank you
 *
 * The advertorial and the offer are pages. The checkout, the upsell, the
 * downsell and the thank-you page are built in and read this record for what
 * to offer. A store has one *active* funnel per product; the checkout finds
 * the funnel through the products in the cart.
 */
export type Offer = { variantId?: string; discountPercent?: number; headline?: string; text?: string }
export type Bump = { variantId?: string; label?: string; text?: string; priceCents?: number; enabled?: boolean }

export type Funnel = {
  id: string
  storeId: string
  name: string
  productId: string
  advertorialPageId: string
  offerPageId: string
  bump: Bump
  upsell: Offer
  downsell: Offer
  thankyou: { headline?: string; showRelated?: boolean; showTracking?: boolean }
  status: 'active' | 'paused'
  /** Funnels in the same group split the traffic that arrives at /go/:group by weight. */
  testGroup: string
  weight: number
  createdAt: string
  updatedAt: string
}

function rowToFunnel(row: Row): Funnel {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    name: row.name as string,
    productId: row.product_id as string,
    advertorialPageId: row.advertorial_page_id as string,
    offerPageId: row.offer_page_id as string,
    bump: json(row.bump, {}),
    upsell: json(row.upsell, {}),
    downsell: json(row.downsell, {}),
    thankyou: json(row.thankyou, {}),
    status: row.status as Funnel['status'],
    testGroup: (row.test_group as string) ?? '',
    weight: (row.weight as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function listFunnels(db: Db, storeId: string): Funnel[] {
  return db.all('SELECT * FROM funnels WHERE store_id = ? ORDER BY created_at DESC', storeId).map(rowToFunnel)
}

export function getFunnel(db: Db, storeId: string, funnelId: string): Funnel | null {
  const row = db.one('SELECT * FROM funnels WHERE id = ? AND store_id = ?', funnelId, storeId)
  return row ? rowToFunnel(row) : null
}

/** The active funnel for any product in the cart, first match wins. */
export function funnelForProducts(db: Db, storeId: string, productIds: string[]): Funnel | null {
  for (const productId of productIds) {
    const row = db.one("SELECT * FROM funnels WHERE store_id = ? AND product_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1", storeId, productId)
    if (row) return rowToFunnel(row)
  }
  const any = db.one("SELECT * FROM funnels WHERE store_id = ? AND product_id = '' AND status = 'active' ORDER BY updated_at DESC LIMIT 1", storeId)
  return any ? rowToFunnel(any) : null
}

export function upsertFunnel(db: Db, storeId: string, input: Partial<Omit<Funnel, 'id' | 'storeId' | 'createdAt' | 'updatedAt'>> & { id?: string; name: string }): Funnel {
  const existing = input.id ? getFunnel(db, storeId, input.id) : null
  const timestamp = now()
  const values = {
    name: input.name,
    product_id: input.productId ?? existing?.productId ?? '',
    advertorial_page_id: input.advertorialPageId ?? existing?.advertorialPageId ?? '',
    offer_page_id: input.offerPageId ?? existing?.offerPageId ?? '',
    bump: { ...(existing?.bump ?? {}), ...(input.bump ?? {}) },
    upsell: { ...(existing?.upsell ?? {}), ...(input.upsell ?? {}) },
    downsell: { ...(existing?.downsell ?? {}), ...(input.downsell ?? {}) },
    thankyou: { showRelated: true, showTracking: true, ...(existing?.thankyou ?? {}), ...(input.thankyou ?? {}) },
    status: input.status ?? existing?.status ?? 'active',
    test_group: input.testGroup ?? existing?.testGroup ?? '',
    weight: Math.max(0, Math.round(input.weight ?? existing?.weight ?? 0)),
    updated_at: timestamp,
  }
  if (existing) {
    db.update('funnels', existing.id, values)
    return getFunnel(db, storeId, existing.id) as Funnel
  }
  const funnelId = id('fun')
  db.insert('funnels', { id: funnelId, store_id: storeId, ...values, created_at: timestamp })
  return getFunnel(db, storeId, funnelId) as Funnel
}

export function deleteFunnel(db: Db, storeId: string, funnelId: string): boolean {
  return Number(db.run('DELETE FROM funnels WHERE id = ? AND store_id = ?', funnelId, storeId).changes) > 0
}

/**
 * Shipping protection is the order bump every dropshipping checkout runs. It
 * is a real hidden product so the line, the order and the refund all work the
 * same way as anything else; it just never appears in the catalog.
 */
export function ensureShippingProtection(db: Db, storeId: string, priceCents = 299): Product {
  const existing = listProducts(db, storeId, { includeHidden: true, limit: 1000 }).find((product) => product.metadata.kind === 'shipping-protection')
  if (existing) return existing
  return createProduct(db, storeId, {
    title: 'Shipping protection',
    subtitle: 'If it is lost, stolen or damaged in transit, we replace it.',
    description: 'Covers loss, theft and damage in transit. One click to a replacement, no claims form.',
    status: 'published',
    metadata: { hidden: 'true', kind: 'shipping-protection' },
    variants: [{ title: 'Per order', priceCents, inventory: 1_000_000, allowBackorder: true }],
  })
}

export type ResolvedBump = { variantId: string; product: Product; label: string; text: string; priceCents: number }

export function resolveBump(db: Db, storeId: string, funnel: Funnel | null): ResolvedBump | null {
  // `enabled: false` was honoured here and written by nothing, so a merchant
  // who did not want to sell shipping protection had no way to stop the
  // checkout offering it — the fallback below invents the product when there
  // is no funnel at all.
  const bump = funnel?.bump ?? {}
  if (bump.enabled === false) return null
  let product: Product | null = null
  let variantId = bump.variantId ?? ''
  if (variantId) {
    const row = db.one<{ product_id: string }>('SELECT product_id FROM variants WHERE id = ? AND store_id = ?', variantId, storeId)
    product = row ? getProduct(db, storeId, row.product_id) : null
  }
  if (!product) {
    product = ensureShippingProtection(db, storeId, bump.priceCents ?? 299)
    variantId = product.variants[0]?.id ?? ''
  }
  const variant = product.variants.find((entry) => entry.id === variantId) ?? product.variants[0]
  if (!variant) return null
  return {
    variantId: variant.id,
    product,
    label: bump.label ?? (product.metadata.kind === 'shipping-protection' ? 'Protect my order' : `Add ${product.title}`),
    text: bump.text ?? product.subtitle ?? '',
    priceCents: bump.priceCents ?? variant.priceCents,
  }
}

export type ResolvedOffer = { product: Product; variantId: string; priceCents: number; discountPercent: number; headline: string; text: string }

export function resolveOffer(db: Db, storeId: string, offer: Offer | undefined, fallback: () => { product: Product; variantId: string } | null, defaultDiscount: number): ResolvedOffer | null {
  let product: Product | null = null
  let variantId = offer?.variantId ?? ''
  if (variantId) {
    const row = db.one<{ product_id: string }>('SELECT product_id FROM variants WHERE id = ? AND store_id = ?', variantId, storeId)
    product = row ? getProduct(db, storeId, row.product_id) : null
  }
  if (!product) {
    const picked = fallback()
    if (!picked) return null
    product = picked.product
    variantId = picked.variantId
  }
  const variant = product.variants.find((entry) => entry.id === variantId) ?? product.variants[0]
  if (!variant) return null
  const discount = offer?.discountPercent ?? defaultDiscount
  return {
    product,
    variantId: variant.id,
    priceCents: variant.priceCents,
    discountPercent: discount,
    headline: offer?.headline ?? `Add ${product.title} to this order for ${discount}% off?`,
    text: offer?.text ?? product.subtitle ?? product.description.split('. ')[0] ?? '',
  }
}

/* --------------------------------------------------------------- split tests */

/**
 * A funnel split test. Every funnel in a group with a weight above zero is in
 * it; a visitor arriving at /go/:group is assigned one by a hash of the
 * storefront's visitor cookie and the group, so they see the same funnel every
 * time — the analytics session would have re-rolled them at midnight — and the
 * entry is an event so each funnel's sessions can be followed to the cart and
 * the order.
 */
export function pickFunnel(db: Db, storeId: string, group: string, visitorKey: string): Funnel | null {
  const live = listFunnels(db, storeId).filter((funnel) => funnel.testGroup === group && funnel.status === 'active' && funnel.weight > 0)
  if (!live.length) return null
  const total = live.reduce((sum, funnel) => sum + funnel.weight, 0)
  const hash = parseInt(createHash('sha256').update(`${visitorKey}|${group}`).digest('hex').slice(0, 8), 16)
  let point = hash % total
  for (const funnel of live) {
    point -= funnel.weight
    if (point < 0) return funnel
  }
  return live[0] ?? null
}

export function funnelGroups(db: Db, storeId: string): string[] {
  return [...new Set(listFunnels(db, storeId).map((funnel) => funnel.testGroup).filter(Boolean))]
}

export type FunnelStats = { funnelId: string; name: string; weight: number; sessions: number; carts: number; purchases: number; revenueCents: number; revenuePerSessionCents: number }

/** Per-funnel numbers from the sessions that entered it. Decided on revenue per session, not conversion alone. */
export function funnelStats(db: Db, storeId: string, group: string): FunnelStats[] {
  return listFunnels(db, storeId)
    .filter((funnel) => funnel.testGroup === group)
    .map((funnel) => {
      // Bounded by when the session entered this funnel: a shopper who bought
      // last week and entered the funnel today is not a conversion for it.
      const entered = db.all<{ session_id: string; at: string }>(
        "SELECT session_id, MIN(created_at) at FROM analytics_events WHERE store_id = ? AND type = 'funnel.enter' AND json_extract(meta, '$.funnelId') = ? GROUP BY session_id",
        storeId,
        funnel.id,
      )
      const blank = { funnelId: funnel.id, name: funnel.name, weight: funnel.weight, sessions: 0, carts: 0, purchases: 0, revenueCents: 0, revenuePerSessionCents: 0 }
      if (!entered.length) return blank
      const after = entered.map(() => '(session_id = ? AND created_at >= ?)').join(' OR ')
      const params = entered.flatMap((row) => [row.session_id, row.at])
      const carts = db.one<{ c: number }>(`SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'cart.add' AND (${after})`, storeId, ...params)?.c ?? 0
      const bought = db.one<{ c: number; total: number | null }>(`SELECT COUNT(DISTINCT session_id) c, SUM(amount_cents) total FROM analytics_events WHERE store_id = ? AND type = 'checkout.complete' AND (${after})`, storeId, ...params)
      const revenue = bought?.total ?? 0
      return { ...blank, sessions: entered.length, carts, purchases: bought?.c ?? 0, revenueCents: revenue, revenuePerSessionCents: Math.round(revenue / entered.length) }
    })
}

/**
 * Where a funnel starts: its advertorial if it has one, else its offer page,
 * else the product.
 *
 * Only published pages count. Every page generator here writes drafts by
 * default, so a funnel wired to one sent paid traffic to a URL the storefront
 * answers with a 404 — the most expensive 404 a dropshipper can serve.
 */
export function funnelEntry(db: Db, storeId: string, funnel: Funnel): string {
  const page = (pageId: string) => (pageId ? db.one<{ handle: string }>("SELECT handle FROM pages WHERE store_id = ? AND id = ? AND status = 'published'", storeId, pageId)?.handle : undefined)
  const advertorial = page(funnel.advertorialPageId)
  if (advertorial) return `/pages/${advertorial}`
  const offer = page(funnel.offerPageId)
  if (offer) return `/pages/${offer}`
  const product = funnel.productId ? db.one<{ handle: string }>('SELECT handle FROM products WHERE store_id = ? AND id = ?', storeId, funnel.productId)?.handle : undefined
  return product ? `/products/${product}` : '/'
}

/**
 * The step after this page in its funnel, if it is in one.
 *
 * The advertorial's next step is the offer page; the offer page's is the
 * checkout. Returns null when the page is not a funnel step, or when the step
 * it points at is not published.
 */
export function funnelNextFor(db: Db, storeId: string, pageId: string): string | null {
  const funnel = listFunnels(db, storeId).find((entry) => entry.advertorialPageId === pageId || entry.offerPageId === pageId)
  if (!funnel) return null
  if (funnel.advertorialPageId === pageId) {
    const offer = funnel.offerPageId
      ? db.one<{ handle: string }>("SELECT handle FROM pages WHERE store_id = ? AND id = ? AND status = 'published'", storeId, funnel.offerPageId)?.handle
      : undefined
    return offer ? `/pages/${offer}` : '/checkout'
  }
  return '/checkout'
}
