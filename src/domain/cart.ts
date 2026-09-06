import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { bundleFor, tierFor } from './bundles.ts'
import { getProduct, getVariant } from './catalog.ts'
import { applyPromotions } from './promotions.ts'
import { convertCents, defaultRegion, getRegion, minorUnitRate, rateFor } from './regions.ts'
import type { Address, LineItem, Totals } from './types.ts'

export type CheckoutAdvertising = { url:string; ip:string; userAgent:string; fbp?:string; fbc?:string; ttp?:string; ttclid?:string }
export type CheckoutDraft = { preview?: boolean; email?: string; name?: string; phone?: string; address?: Address; marketing?: boolean; advertising?:CheckoutAdvertising }

export type Cart = {
  id: string
  storeId: string
  email: string
  items: LineItem[]
  discountCode: string
  regionId: string | null
  orderId: string | null
  shippingOptionId: string
  paymentIntentId: string
  checkout: CheckoutDraft
  createdAt: string
  updatedAt: string
}

function rowToCart(row: Row): Cart {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    email: row.email as string,
    items: json(row.items, [] as LineItem[]),
    discountCode: row.discount_code as string,
    regionId: (row.region_id as string | null) ?? null,
    orderId: (row.order_id as string | null) ?? null,
    shippingOptionId: (row.shipping_option_id as string) ?? '',
    paymentIntentId: (row.payment_intent_id as string) ?? '',
    checkout: json(row.checkout, {} as CheckoutDraft),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function getCart(db: Db, storeId: string, cartId: string): Cart | null {
  const row = db.one('SELECT * FROM carts WHERE id = ? AND store_id = ?', cartId, storeId)
  return row ? rowToCart(row) : null
}

export function createCart(db: Db, storeId: string, regionId?: string, options: { preview?: boolean } = {}): Cart {
  const cartId = id('cart')
  const timestamp = now()
  const region = regionId ? getRegion(db, storeId, regionId) : defaultRegion(db, storeId)
  db.insert('carts', {
    id: cartId,
    store_id: storeId,
    email: '',
    items: [],
    discount_code: '',
    region_id: region?.id ?? null,
    order_id: null,
    checkout: options.preview ? { preview: true } : {},
    created_at: timestamp,
    updated_at: timestamp,
  })
  return getCart(db, storeId, cartId) as Cart
}

export function setCartRegion(db: Db, storeId: string, cartId: string, regionId: string): Cart {
  const cart = getCart(db, storeId, cartId)
  const region = getRegion(db, storeId, regionId)
  if (!cart || !region) throw new Error('No such cart or region')
  db.update('carts', cart.id, { region_id: region.id, shipping_option_id: '', updated_at: now() })
  return getCart(db, storeId, cart.id) as Cart
}

/** A trusted server-side price override is used by configured order bumps. */
export function addToCart(db: Db, storeId: string, cartId: string, variantId: string, quantity = 1, source?: string, unitCents?: number): Cart {
  const cart = getCart(db, storeId, cartId) ?? createCart(db, storeId)
  const variant = getVariant(db, storeId, variantId)
  if (!variant) throw new Error(`No variant ${variantId}`)
  const product = getProduct(db, storeId, variant.productId)
  if (!product || product.status !== 'published' && !(cart.checkout.preview && product.status === 'draft')) throw new Error('That product is not available')

  const items = [...cart.items]
  const existing = items.find((item) => item.variantId === variantId && !item.giftOf)
  if (existing) existing.quantity += quantity
  else {
    items.push({
      variantId,
      productId: product.id,
      title: product.title,
      variantTitle: variant.title,
      image: variant.image || product.heroImage,
      unitCents: unitCents ?? variant.priceCents,
      quantity,
      ...(source ? { source } : {}),
    })
  }
  db.update('carts', cart.id, { items: reconcileGifts(db, storeId, items), updated_at: now() })
  return getCart(db, storeId, cart.id) as Cart
}

export function setQuantity(db: Db, storeId: string, cartId: string, variantId: string, quantity: number): Cart {
  const cart = getCart(db, storeId, cartId)
  if (!cart) throw new Error('No cart')
  const items = cart.items
    .map((item) => (item.variantId === variantId && !item.giftOf ? { ...item, quantity } : item))
    .filter((item) => item.quantity > 0)
  db.update('carts', cart.id, { items: reconcileGifts(db, storeId, items), updated_at: now() })
  return getCart(db, storeId, cart.id) as Cart
}

/**
 * Bundle gifts are derived, never stored as a decision. After any change to
 * the lines, every product with a bundle is checked: if its paid quantity
 * earns a tier with a gift, the gift line exists at zero; if not, it does not.
 * A customer cannot keep the gift by dropping the second glove in the cart.
 */
export function reconcileGifts(db: Db, storeId: string, items: LineItem[]): LineItem[] {
  const paid = items.filter((item) => !item.giftOf)
  const kept = [...paid]
  const byProduct = new Map<string, number>()
  for (const item of paid) byProduct.set(item.productId, (byProduct.get(item.productId) ?? 0) + item.quantity)
  for (const [productId, quantity] of byProduct) {
    const bundle = bundleFor(db, storeId, productId)
    if (!bundle) continue
    const tier = tierFor(bundle, quantity)
    if (!tier?.giftVariantId) continue
    const variant = getVariant(db, storeId, tier.giftVariantId)
    const product = variant ? getProduct(db, storeId, variant.productId) : null
    if (!variant || !product) continue
    kept.push({
      variantId: variant.id,
      productId: product.id,
      title: product.title,
      variantTitle: `${variant.title} — free gift`,
      image: variant.image || product.heroImage,
      unitCents: 0,
      quantity: 1,
      source: 'bundle-gift',
      giftOf: productId,
    })
  }
  for (const item of paid) {
    const owner = getProduct(db, storeId, item.productId)
    let giftIds: unknown
    try { giftIds = JSON.parse(owner?.metadata['includedGifts:' + item.variantId] || '[]') } catch { continue }
    if (!Array.isArray(giftIds)) continue
    for (const giftId of new Set(giftIds.slice(0, 30))) {
      if (typeof giftId !== 'string') continue
      const variant = getVariant(db, storeId, giftId), product = variant ? getProduct(db, storeId, variant.productId) : null
      if (!variant || !product || product.metadata.sourcePurpose !== 'gift' || variant.priceCents !== 0) continue
      if (kept.some(line => line.giftOf === item.productId && line.variantId === giftId)) continue
      kept.push({variantId:variant.id,productId:product.id,title:product.title,variantTitle:variant.title+' — included',image:variant.image||product.heroImage,unitCents:0,quantity:item.quantity,source:'package-gift',giftOf:item.productId})
    }
  }
  return kept
}

export function setShipping(db: Db, storeId: string, cartId: string, shippingOptionId: string): Cart {
  const cart = getCart(db, storeId, cartId)
  if (!cart) throw new Error('No cart')
  db.update('carts', cart.id, { shipping_option_id: shippingOptionId, updated_at: now() })
  return getCart(db, storeId, cart.id) as Cart
}

export function saveCheckoutDraft(db: Db, storeId: string, cartId: string, draft: CheckoutDraft): Cart {
  const cart = getCart(db, storeId, cartId)
  if (!cart) throw new Error('No cart')
  db.update('carts', cart.id, { checkout: { ...cart.checkout, ...draft }, email: draft.email ?? cart.email, updated_at: now() })
  return getCart(db, storeId, cart.id) as Cart
}

export function attachPaymentIntent(db: Db, storeId: string, cartId: string, paymentIntentId: string) {
  db.run('UPDATE carts SET payment_intent_id = ?, updated_at = ? WHERE id = ? AND store_id = ?', paymentIntentId, now(), cartId, storeId)
}

export function applyCode(db: Db, storeId: string, cartId: string, code: string): Cart {
  const cart = getCart(db, storeId, cartId)
  if (!cart) throw new Error('No cart')
  db.update('carts', cart.id, { discount_code: code.trim().toUpperCase(), updated_at: now() })
  return getCart(db, storeId, cart.id) as Cart
}

/**
 * One calculation, used by the cart drawer, the checkout, the order that gets
 * written, and the free-shipping-gap upsell. There is no second implementation
 * of pricing anywhere in the platform — that is how the drawer and the receipt
 * are guaranteed to agree.
 */
export function totals(db: Db, storeId: string, cart: Cart, opts: { isFirstOrder?: boolean } = {}): Totals {
  const region = cart.regionId ? getRegion(db, storeId, cart.regionId) : defaultRegion(db, storeId)
  const currency = region?.currency ?? 'USD'
  const sourceCurrency = db.one<{ currency: string }>('SELECT currency FROM stores WHERE id = ?', storeId)?.currency ?? 'USD'
  const localizedItems = cart.items.map((item) => ({ ...item, unitCents: convertCents(item.unitCents, region, sourceCurrency) }))
  const subtotalCents = localizedItems.reduce((sum, item) => sum + item.unitCents * item.quantity, 0)
  const promo = applyPromotions(db, storeId, localizedItems, {
    code: cart.discountCode,
    subtotalCents,
    regionId: region?.id,
    currencyRate: minorUnitRate(region, sourceCurrency),
    ...(opts.isFirstOrder === undefined ? {} : { isFirstOrder: opts.isFirstOrder }),
  })
  const discounted = Math.max(0, subtotalCents - promo.discountCents)
  const rate = rateFor(region, discounted, promo.freeShipping, cart.shippingOptionId || undefined)
  const shippingCents = cart.items.length ? rate.amountCents : 0
  const taxCents = Math.round(discounted * (region?.taxRate ?? 0))
  return {
    subtotalCents,
    discountCents: promo.discountCents,
    shippingCents,
    taxCents,
    totalCents: discounted + shippingCents + taxCents,
    currency,
    appliedPromotions: promo.applied,
    freeShippingGapCents: cart.items.length ? rate.gapCents : null,
    shippingOptionId: rate.optionId,
    shippingName: rate.name,
  }
}
