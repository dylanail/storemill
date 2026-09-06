import { json, now, type Db, type Row } from '../lib/db.ts'
import { escapeHtml } from '../lib/http.ts'
import { id } from '../lib/ids.ts'
import { format } from '../lib/money.ts'
import { getProduct } from './catalog.ts'
import { createPromotion, setPromotionStatus } from './promotions.ts'
import { quantityPrice, type QuantityMode } from './quantity-pricing.ts'
import { getVariant } from './catalog.ts'
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
  /** Exact total for the displayed pack, including prices that do not divide evenly. */
  totalPriceCents?: number
  /** Original displayed package total; does not change the payable price. */
  compareAtTotalCents?: number
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
  pricingMode?: QuantityMode
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
    pricingMode: row.pricing_mode === 'multiples' ? 'multiples' : 'bulk',
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
export function upsertBundle(db: Db, storeId: string, input: { productId: string; title?: string; tiers?: BundleTier[]; pricingMode?: QuantityMode; style?: BundleStyle }): Bundle {
  const product = getProduct(db, storeId, input.productId)
  if (!product) throw new Error('No product with that id')
  const tiers = normalizeTiers(input.tiers ?? DEFAULT_TIERS)
  if (tiers.some(tier => tier.unitPriceCents !== undefined && product.variants.some(variant => tier.unitPriceCents! > variant.priceCents))) throw new Error('An exact bundle unit price cannot exceed a product variant price')
  if (tiers.some(tier => tier.totalPriceCents !== undefined && tier.totalPriceCents > Math.min(...product.variants.map(v=>v.priceCents))*tier.quantity)) throw new Error('A pack price cannot exceed the regular price of its items')
  if (tiers.some(tier=>tier.giftVariantId&&!getVariant(db,storeId,tier.giftVariantId))) throw new Error('Choose a gift variant from this store')
  if (tiers.some(tier => tier.compareAtTotalCents !== undefined && (!Number.isSafeInteger(tier.compareAtTotalCents) || tier.compareAtTotalCents < (tier.totalPriceCents ?? (tier.unitPriceCents !== undefined ? tier.unitPriceCents * tier.quantity : Math.round(Math.min(...product.variants.map(v => v.priceCents)) * tier.quantity * (1 - tier.discountPercent / 100))))))) throw new Error('Original bundle totals must be whole minor units and at least the sale total')
  const existing = db.one('SELECT * FROM bundles WHERE store_id = ? AND product_id = ?', storeId, product.id)
  const previous = existing ? rowToBundle(existing) : null

  const pricingMode=input.pricingMode??previous?.pricingMode??'bulk'
  return db.tx(() => {
    if (previous?.promotionId) setPromotionStatus(db, storeId, previous.promotionId, 'disabled')
    for (const row of db.all<{ id: string }>("SELECT id FROM promotions WHERE store_id = ? AND json_extract(rules, '$.bundleProductId') = ?", storeId, product.id)) {
      setPromotionStatus(db, storeId, row.id, 'disabled')
    }
    const discounted = tiers.filter(tier=>product.variants.some(variant=>quantityPrice([tier],tier.quantity,variant.priceCents)<variant.priceCents*tier.quantity))
    let promotionId: string | null = null
    if (discounted.length) {
      promotionId = createPromotion(db, storeId, {
        title: `${product.title} bundle`,
        kind: 'tiered',
        automatic: true,
        rules: { productIds: [product.id], quantityMode: pricingMode, tiers: tiers.map((tier) => ({ quantity: tier.quantity, percent: tier.discountPercent, ...(tier.unitPriceCents !== undefined ? { unitPriceCents: tier.unitPriceCents } : {}), ...(tier.totalPriceCents !== undefined ? { totalPriceCents: tier.totalPriceCents } : {}) })), bundleProductId: product.id } as never,
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
      pricing_mode: pricingMode,
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
  if(!tiers.length||tiers.length>20)throw new Error('Add between 1 and 20 pricing tiers')
  tiers=tiers.map(tier=>({...tier,discountPercent:tier.discountPercent??0}))
  if(new Set(tiers.map(tier=>tier.quantity)).size!==tiers.length)throw new Error('Each tier needs a different quantity')
  for(const tier of tiers){
    if(!Number.isSafeInteger(tier.quantity)||tier.quantity<1||tier.quantity>999)throw new Error('Tier quantities must be whole numbers from 1 to 999')
    if(!Number.isFinite(tier.discountPercent)||tier.discountPercent<0||tier.discountPercent>100)throw new Error('Discount percentages must be between 0 and 100')
    for(const price of [tier.unitPriceCents,tier.totalPriceCents])if(price!==undefined&&(!Number.isSafeInteger(price)||price<=0))throw new Error('Enter a positive price for every priced tier')
    if(tier.unitPriceCents!==undefined&&tier.totalPriceCents!==undefined)throw new Error('Choose one price type for each tier')
  }
  return [...tiers].sort((a,b)=>a.quantity-b.quantity)
}

export function setBundleStatus(db:Db,storeId:string,bundleId:string,status:Bundle['status']):void {
  const bundle=listBundles(db,storeId).find(item=>item.id===bundleId)
  if(!bundle)throw new Error('No quantity offer with that id')
  if(status==='active'){upsertBundle(db,storeId,{...bundle});return}
  db.tx(()=>{
    db.run('UPDATE bundles SET status=? WHERE id=? AND store_id=?',status,bundleId,storeId)
    for(const row of db.all<{id:string}>("SELECT id FROM promotions WHERE store_id=? AND json_extract(rules,'$.bundleProductId')=?",storeId,bundle.productId))setPromotionStatus(db,storeId,row.id,'disabled')
  })
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
export function renderBundleWidget(bundle: Bundle, product: Product, currency: string, opts: { variantPriceCents?: number; locale?: string; currencyRate?: number } = {}): string {
  if(opts.currencyRate!==undefined){
    const rate=opts.currencyRate
    bundle={...bundle,tiers:bundle.tiers.map(t=>({...t,...(t.unitPriceCents!==undefined?{unitPriceCents:Math.round(t.unitPriceCents*rate)}:{}),...(t.totalPriceCents!==undefined?{totalPriceCents:Math.round(t.totalPriceCents*rate)}:{}),...(t.compareAtTotalCents!==undefined?{compareAtTotalCents:Math.round(t.compareAtTotalCents*rate)}:{})}))}
    product={...product,variants:product.variants.map(v=>({...v,priceCents:Math.round(v.priceCents*rate),compareAtCents:v.compareAtCents===null?null:Math.round(v.compareAtCents*rate)}))}
  }
  const unit = opts.variantPriceCents ?? Math.min(...product.variants.map((variant) => variant.priceCents))
  const style = bundle.style
  // One tier is pre-selected: the first one carrying a badge (that is what the
  // badge is for), else the first tier. Two `checked` radios would leave the
  // browser to pick, and it picks the last.
  const preselect = Math.max(0, bundle.tiers.findIndex((tier) => Boolean(tier.badge)))
  const rows = bundle.tiers.map((tier, index) => {
    const compare = tier.compareAtTotalCents ?? Math.max(...product.variants.map(v => v.compareAtCents || v.priceCents)) * tier.quantity
    const total = quantityPrice(bundle.tiers,tier.quantity,unit,bundle.pricingMode)
    const perUnit = Math.round(total / tier.quantity)
    const variantPrices=Object.fromEntries(product.variants.map(variant=>{
      const amount=quantityPrice(bundle.tiers,tier.quantity,variant.priceCents,bundle.pricingMode)
      const original=tier.compareAtTotalCents??(variant.compareAtCents||variant.priceCents)*tier.quantity
      return [variant.id,{total:format(amount,currency,opts.locale),compare:original>amount?format(original,currency,opts.locale):'',each:(amount%tier.quantity?'≈ ':'')+format(Math.round(amount/tier.quantity),currency,opts.locale)+' each'}]
    }))
    const perks = [tier.freeShipping ? 'Free shipping' : '', tier.giftVariantId ? `+ ${tier.giftLabel || 'free gift'}` : ''].filter(Boolean)
    const checked = index === preselect ? 'checked' : ''
    return `<label class="tier${tier.badge ? ' tier--hi' : ''}">
      <input type="radio" name="quantity" value="${tier.quantity}" data-total="${escapeHtml(format(total, currency, opts.locale))}" data-discount="${tier.discountPercent}" data-variant-prices="${escapeHtml(JSON.stringify(variantPrices))}" ${checked}>
      <span class="tier-main"><span class="tier-label">${escapeHtml(tier.label)}${tier.discountPercent ? ` <em>Save ${tier.discountPercent}%</em>` : ''}</span>
        ${perks.length ? `<span class="tier-perks">${perks.map((perk) => escapeHtml(perk)).join(' · ')}</span>` : ''}</span>
      <span class="tier-price"><b data-tier-total>${escapeHtml(format(total, currency, opts.locale))}</b>${style.showCompare !== false && compare > total ? `<s data-tier-compare>${escapeHtml(format(compare, currency, opts.locale))}</s>` : ''}${style.showPerUnit !== false && tier.quantity > 1 ? `<small data-tier-unit>${total%tier.quantity?'≈ ':''}${escapeHtml(format(perUnit, currency, opts.locale))} each</small>` : ''}</span>
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
