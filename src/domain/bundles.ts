import { json, now, type Db, type Row } from '../lib/db.ts'
import { escapeHtml } from '../lib/http.ts'
import { id } from '../lib/ids.ts'
import { format } from '../lib/money.ts'
import { getProduct } from './catalog.ts'
import { createPromotion, setPromotionStatus } from './promotions.ts'
import type { Product } from './types.ts'

/**
 * Quantity-break bundles, the way the Shopify apps do them.
 *
 * A bundle is a set of tiers on one product: buy 1, buy 2 and save, buy 3 and
 * save more with free shipping and a gift. The widget is what the customer
 * sees; the *truth* is a tiered promotion the cart engine enforces, so a
 * customer who edits quantities in the cart still pays the right price, and
 * a gift line is dropped the moment the tier that earned it is gone.
 */
export type BundleTier = {
  quantity: number
  /** Percent off the eligible units. 0 means full price. */
  discountPercent: number
  /** Explicit source package price divided by its quantity, in the store's minor units. */
  unitPriceCents?: number
  label: string
  badge?: string
  freeShipping?: boolean
  /** A variant id added at zero price when this tier is reached. */
  giftVariantId?: string
  giftLabel?: string
}

export type BundleStyle = { accent?: string; radius?: string; layout?: 'stacked' | 'row'; showPerUnit?: boolean; showCompare?: boolean }

export type Bundle = {
  id: string
  storeId: string
  productId: string
  title: string
  tiers: BundleTier[]
  style: BundleStyle
  promotionId: string | null
  status: 'active' | 'paused'
  createdAt: string
}

function rowToBundle(row: Row): Bundle {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    productId: row.product_id as string,
    title: row.title as string,
    tiers: json(row.tiers, [] as BundleTier[]),
    style: json(row.style, {} as BundleStyle),
    promotionId: (row.promotion_id as string | null) ?? null,
    status: row.status as Bundle['status'],
    createdAt: row.created_at as string,
  }
}

export function listBundles(db: Db, storeId: string): Bundle[] {
  return db.all('SELECT * FROM bundles WHERE store_id = ? ORDER BY created_at DESC', storeId).map(rowToBundle)
}

export function bundleFor(db: Db, storeId: string, productId: string): Bundle | null {
  const row = db.one("SELECT * FROM bundles WHERE store_id = ? AND product_id = ? AND status = 'active'", storeId, productId)
  return row ? rowToBundle(row) : null
}

export const DEFAULT_TIERS: BundleTier[] = [
  { quantity: 1, discountPercent: 0, label: 'Buy 1' },
  { quantity: 2, discountPercent: 15, label: 'Buy 2', badge: 'Most popular', freeShipping: true },
  { quantity: 3, discountPercent: 25, label: 'Buy 3', badge: 'Best value', freeShipping: true },
]

/**
 * Creating a bundle creates (or replaces) its enforcing promotions: one tiered
 * discount scoped to the product, plus a free-shipping rule for each tier that
 * promises it. Deleting the bundle disables them.
 */
export function upsertBundle(db: Db, storeId: string, input: { productId: string; title?: string; tiers?: BundleTier[]; style?: BundleStyle }): Bundle {
  const product = getProduct(db, storeId, input.productId)
  if (!product) throw new Error('No product with that id')
  const tiers = normalizeTiers(input.tiers?.length ? input.tiers : DEFAULT_TIERS)
  if (tiers.some(tier => tier.unitPriceCents !== undefined && product.variants.some(variant => tier.unitPriceCents! > variant.priceCents))) throw new Error('An exact bundle unit price cannot exceed a product variant price')
  const existing = db.one('SELECT * FROM bundles WHERE store_id = ? AND product_id = ?', storeId, product.id)
  const previous = existing ? rowToBundle(existing) : null

  return db.tx(() => {
    if (previous?.promotionId) setPromotionStatus(db, storeId, previous.promotionId, 'disabled')
    for (const row of db.all<{ id: string }>("SELECT id FROM promotions WHERE store_id = ? AND json_extract(rules, '$.bundleProductId') = ?", storeId, product.id)) {
      setPromotionStatus(db, storeId, row.id, 'disabled')
    }
    const discounted = tiers.filter((tier) => tier.discountPercent > 0 || tier.unitPriceCents !== undefined && product.variants.some(variant => tier.unitPriceCents! < variant.priceCents))
    let promotionId: string | null = null
    if (discounted.length) {
      promotionId = createPromotion(db, storeId, {
        title: `${product.title} bundle`,
        kind: 'tiered',
        automatic: true,
        rules: { productIds: [product.id], tiers: discounted.map((tier) => ({ quantity: tier.quantity, percent: tier.discountPercent, ...(tier.unitPriceCents !== undefined ? { unitPriceCents: tier.unitPriceCents } : {}) })), bundleProductId: product.id } as never,
      }).id
    }
    const shippingTier = tiers.find((tier) => tier.freeShipping)
    if (shippingTier) {
      createPromotion(db, storeId, {
        title: `${product.title} bundle — free shipping`,
        kind: 'free_shipping',
        automatic: true,
        rules: { productIds: [product.id], minQuantity: shippingTier.quantity, bundleProductId: product.id } as never,
      })
    }
    const bundleId = previous?.id ?? id('bnd')
    const values = {
      title: input.title ?? previous?.title ?? 'Bundle & save',
      tiers,
      style: { ...(previous?.style ?? {}), ...(input.style ?? {}) },
      promotion_id: promotionId,
      status: 'active',
    }
    if (previous) db.update('bundles', bundleId, values)
    else db.insert('bundles', { id: bundleId, store_id: storeId, product_id: product.id, ...values, created_at: now() })
    return rowToBundle(db.one('SELECT * FROM bundles WHERE id = ?', bundleId) as Row)
  })
}

export function removeBundle(db: Db, storeId: string, bundleId: string): boolean {
  const row = db.one('SELECT * FROM bundles WHERE id = ? AND store_id = ?', bundleId, storeId)
  if (!row) return false
  const bundle = rowToBundle(row)
  db.tx(() => {
    if (bundle.promotionId) setPromotionStatus(db, storeId, bundle.promotionId, 'disabled')
    for (const promo of db.all<{ id: string }>("SELECT id FROM promotions WHERE store_id = ? AND json_extract(rules, '$.bundleProductId') = ?", storeId, bundle.productId)) {
      setPromotionStatus(db, storeId, promo.id, 'disabled')
    }
    db.run('DELETE FROM bundles WHERE id = ?', bundleId)
  })
  return true
}

function normalizeTiers(tiers: BundleTier[]): BundleTier[] {
  for (const tier of tiers) if (tier.unitPriceCents !== undefined && (!Number.isSafeInteger(tier.quantity) || tier.quantity < 1 || !Number.isSafeInteger(tier.unitPriceCents) || tier.unitPriceCents <= 0)) throw new Error('Exact bundle tiers require a positive whole quantity and unit price')
  if (tiers.some(tier => tier.unitPriceCents !== undefined) && new Set(tiers.map(tier => tier.quantity)).size !== tiers.length) throw new Error('Exact bundle tiers require distinct quantities')
  return [...tiers]
    .filter((tier) => tier.quantity >= 1)
    .map((tier) => ({ ...tier, quantity: Math.round(tier.quantity), discountPercent: Math.max(0, Math.min(90, tier.discountPercent)) }))
    .sort((a, b) => a.quantity - b.quantity)
    .slice(0, 5)
}

/** The tier a quantity earns, or null below the first tier. */
export function tierFor(bundle: Bundle, quantity: number): BundleTier | null {
  return [...bundle.tiers].reverse().find((tier) => quantity >= tier.quantity) ?? null
}

/**
 * The widget. Radio cards, one per tier: label, badge, total, per-unit price,
 * savings against full price, and what the tier unlocks. It posts `quantity`
 * on the surrounding form, and its data attributes let the buy button show
 * the tier total without a round trip.
 */
export function renderBundleWidget(bundle: Bundle, product: Product, currency: string, opts: { variantPriceCents?: number; locale?: string } = {}): string {
  const unit = opts.variantPriceCents ?? Math.min(...product.variants.map((variant) => variant.priceCents))
  const style = bundle.style
  // One tier is pre-selected: the first one carrying a badge (that is what the
  // badge is for), else the first tier. Two `checked` radios would leave the
  // browser to pick, and it picks the last.
  const preselect = Math.max(0, bundle.tiers.findIndex((tier) => Boolean(tier.badge)))
  const rows = bundle.tiers.map((tier, index) => {
    const full = unit * tier.quantity
    const total = tier.unitPriceCents !== undefined ? Math.min(full, tier.unitPriceCents * tier.quantity) : Math.round(full * (1 - tier.discountPercent / 100))
    const perUnit = Math.round(total / tier.quantity)
    const perks = [tier.freeShipping ? 'Free shipping' : '', tier.giftVariantId ? `+ ${tier.giftLabel || 'free gift'}` : ''].filter(Boolean)
    const checked = index === preselect ? 'checked' : ''
    return `<label class="tier${tier.badge ? ' tier--hi' : ''}">
      <input type="radio" name="quantity" value="${tier.quantity}" data-total="${escapeHtml(format(total, currency, opts.locale))}" data-discount="${tier.discountPercent}" ${checked}>
      <span class="tier-main"><span class="tier-label">${escapeHtml(tier.label)}${tier.discountPercent ? ` <em>Save ${tier.discountPercent}%</em>` : ''}</span>
        ${perks.length ? `<span class="tier-perks">${perks.map((perk) => escapeHtml(perk)).join(' · ')}</span>` : ''}</span>
      <span class="tier-price"><b data-tier-total>${escapeHtml(format(total, currency, opts.locale))}</b>${style.showCompare !== false && tier.discountPercent ? `<s data-tier-compare>${escapeHtml(format(full, currency, opts.locale))}</s>` : ''}${style.showPerUnit !== false && tier.quantity > 1 ? `<small data-tier-unit>${escapeHtml(format(perUnit, currency, opts.locale))} each</small>` : ''}</span>
      ${tier.badge ? `<span class="tier-badge">${escapeHtml(tier.badge)}</span>` : ''}</label>`
  })
  return `<div class="bundle bundle--${escapeHtml(style.layout ?? 'stacked')}" style="${style.accent ? `--bundle-accent:${escapeHtml(style.accent)};` : ''}${style.radius ? `--bundle-radius:${escapeHtml(style.radius)};` : ''}">
    ${bundle.title ? `<div class="bundle-title">${escapeHtml(bundle.title)}</div>` : ''}${rows.join('')}</div>`
}

export const BUNDLE_CSS = `
.bundle{display:grid;gap:.5rem;margin:.6rem 0 1rem;--bundle-accent:var(--primary);--bundle-radius:var(--radius)}
.bundle-title{font:500 11px/1 var(--body);letter-spacing:.18em;text-transform:uppercase;color:var(--muted);margin-bottom:.2rem}
.bundle--row{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
.tier{position:relative;display:grid;grid-template-columns:auto 1fr auto;gap:.8rem;align-items:center;border:1.5px solid var(--line);border-radius:var(--bundle-radius);padding:.85rem .95rem;background:var(--raise);cursor:pointer;transition:border-color .15s}
.bundle--row .tier{grid-template-columns:auto 1fr;grid-template-rows:auto auto}
.tier:has(input:checked){border-color:var(--bundle-accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--bundle-accent) 18%,transparent)}
.tier input{width:auto;margin:0;accent-color:var(--bundle-accent)}
.tier-main{display:grid;gap:.15rem}
.tier-label{font-weight:600}
.tier-label em{font-style:normal;font-weight:500;color:var(--bundle-accent);margin-left:.3rem;font-size:.85em}
.tier-perks{font-size:.8rem;color:var(--muted)}
.tier-price{text-align:right;display:grid;gap:.05rem;font-variant-numeric:tabular-nums}
.tier-price b{font-size:1.05rem}.tier-price s{font-size:.8rem;color:var(--muted)}.tier-price small{font-size:.72rem;color:var(--muted)}
.tier-badge{position:absolute;top:-.6rem;right:.8rem;background:var(--bundle-accent);color:#fff;font:600 10px/1 var(--body);letter-spacing:.1em;text-transform:uppercase;padding:.3rem .55rem;border-radius:999px}
`
