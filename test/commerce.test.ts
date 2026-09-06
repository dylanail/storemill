import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createStore } from '../src/control/stores.ts'
import { createProduct, getVariant, listProducts } from '../src/domain/catalog.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'
import { createPromotion } from '../src/domain/promotions.ts'
import { addToCart, applyCode, createCart, totals } from '../src/domain/cart.ts'
import { cancelOrder, CheckoutError, completeCart, refundOrder } from '../src/domain/orders.ts'
import { upsertBundle } from '../src/domain/bundles.ts'
import { getOrder, recordUpsell, returnOrder } from '../src/domain/orders.ts'
import { install } from '../src/control/plugins.ts'
import { useStripeTransport } from '../src/payments/stripe.ts'
import { listTools } from '../src/agent/registry.ts'
import '../src/agent/tools/index.ts'

function shop() {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Test Store' })
  seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, {
    title: 'The Glove',
    status: 'published',
    variants: [{ title: '16oz', priceCents: 10000, inventory: 3 }],
  })
  return { db, store, product, variant: product.variants[0]! }
}

test('totals apply a percentage code and a free-shipping threshold together', () => {
  const { db, store, variant } = shop()
  createPromotion(db, store.id, { title: '10% off', kind: 'percentage', value: 10, code: 'TEN' })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 3)
  applyCode(db, store.id, cart.id, 'TEN')
  const amounts = totals(db, store.id, { ...cart, discountCode: 'TEN' })
  assert.equal(amounts.subtotalCents, 30000)
  assert.equal(amounts.discountCents, 3000)
  // 27000 clears the 20000 free-shipping threshold seeded with the region.
  assert.equal(amounts.shippingCents, 0)
  assert.equal(amounts.totalCents, 27000)
})

test('the checkout charges for delivery unless a free-shipping promotion actually paid for it', () => {
  // It decided by matching the promotion's title against /shipping/i: a
  // "Shipping protection bundle" zeroed the delivery charge, and a real
  // free-shipping promotion someone had named "Delivery on us" did not.
  const { db, store, variant } = shop()
  createPromotion(db, store.id, { title: 'Shipping protection bundle', kind: 'percentage', value: 5, code: 'PROTECT' })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1)
  applyCode(db, store.id, cart.id, 'PROTECT')
  const misleading = totals(db, store.id, { ...cart, discountCode: 'PROTECT' })
  assert.equal(misleading.appliedPromotions[0]?.kind, 'percentage', 'what a promotion is travels with it, not just what it is called')
  assert.ok(!misleading.appliedPromotions.some((promotion) => promotion.kind === 'free_shipping'))

  createPromotion(db, store.id, { title: 'Delivery on us', kind: 'free_shipping', automatic: true })
  const real = totals(db, store.id, addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1))
  assert.ok(real.appliedPromotions.some((promotion) => promotion.kind === 'free_shipping'), 'and a free-shipping promotion is one whatever it is named')
  assert.equal(real.shippingCents, 0)
})

test('the free-shipping gap is reported until the threshold is cleared', () => {
  const { db, store, variant } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1)
  const amounts = totals(db, store.id, cart)
  assert.equal(amounts.shippingCents, 900)
  assert.equal(amounts.freeShippingGapCents, 10000)
})

test('bogo discounts the cheapest qualifying units, not the dearest', () => {
  const { db, store, product } = shop()
  const cheap = createProduct(db, store.id, { title: 'Wrap', status: 'published', variants: [{ title: 'One', priceCents: 2000, inventory: 10 }] })
  createPromotion(db, store.id, { title: 'Buy 2 get 1', kind: 'bogo', rules: { buyQuantity: 2, getQuantity: 1 } })
  let cart = addToCart(db, store.id, createCart(db, store.id).id, product.variants[0]!.id, 2)
  cart = addToCart(db, store.id, cart.id, cheap.variants[0]!.id, 1)
  const amounts = totals(db, store.id, cart)
  assert.equal(amounts.discountCents, 2000)
})

test('a tiered promotion picks the highest tier the quantity reaches', () => {
  const { db, store, variant } = shop()
  createPromotion(db, store.id, {
    title: 'Buy more',
    kind: 'tiered',
    rules: { tiers: [{ quantity: 2, percent: 10 }, { quantity: 3, percent: 20 }] },
  })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 3)
  assert.equal(totals(db, store.id, cart).discountCents, 6000)
})

test('a first-order-only promotion is skipped for a returning customer', () => {
  const { db, store, variant } = shop()
  createPromotion(db, store.id, { title: 'Welcome', kind: 'percentage', value: 10, code: 'WELCOME10', rules: { firstOrderOnly: true } })
  const first = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1)
  applyCode(db, store.id, first.id, 'WELCOME10')
  assert.equal(totals(db, store.id, { ...first, discountCode: 'WELCOME10' }, { isFirstOrder: true }).discountCents, 1000)
  assert.equal(totals(db, store.id, { ...first, discountCode: 'WELCOME10' }, { isFirstOrder: false }).discountCents, 0)
})

test('checkout moves inventory, the customer record and the order together', () => {
  const { db, store, variant } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 2)
  const order = completeCart(db, store.id, cart.id, { email: 'buyer@example.com', name: 'Buyer' })
  assert.equal(order.totalCents, 20000)
  assert.equal(getVariant(db, store.id, variant.id)?.inventory, 1)
  const customer = db.one<{ orders_count: number; spend_cents: number }>('SELECT orders_count, spend_cents FROM customers WHERE store_id = ?', store.id)
  assert.equal(customer?.orders_count, 1)
  assert.equal(customer?.spend_cents, 20000)
})

test('completing the same cart twice returns the first order rather than charging again', () => {
  const { db, store, variant } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1)
  const first = completeCart(db, store.id, cart.id, { email: 'buyer@example.com' })
  const second = completeCart(db, store.id, cart.id, { email: 'buyer@example.com' })
  assert.equal(first.id, second.id)
  assert.equal(getVariant(db, store.id, variant.id)?.inventory, 2)
})

test('an oversell is refused and leaves inventory untouched', () => {
  const { db, store, variant } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 9)
  assert.throws(() => completeCart(db, store.id, cart.id, { email: 'buyer@example.com' }), CheckoutError)
  assert.equal(getVariant(db, store.id, variant.id)?.inventory, 3)
})

test('a partly reserved order rolls back every reservation it made', () => {
  const { db, store, product } = shop()
  const scarce = createProduct(db, store.id, { title: 'Scarce', status: 'published', variants: [{ title: 'Only', priceCents: 1000, inventory: 0 }] })
  let cart = addToCart(db, store.id, createCart(db, store.id).id, product.variants[0]!.id, 1)
  cart = addToCart(db, store.id, cart.id, scarce.variants[0]!.id, 1)
  assert.throws(() => completeCart(db, store.id, cart.id, { email: 'buyer@example.com' }), CheckoutError)
  assert.equal(getVariant(db, store.id, product.variants[0]!.id)?.inventory, 3)
})

test('cancelling an order returns its stock', () => {
  const { db, store, variant } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 2)
  const order = completeCart(db, store.id, cart.id, { email: 'buyer@example.com' })
  cancelOrder(db, store.id, order.id)
  assert.equal(getVariant(db, store.id, variant.id)?.inventory, 3)
})

test('refunds cannot exceed the order total', () => {
  const { db, store, variant } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1)
  const order = completeCart(db, store.id, cart.id, { email: 'buyer@example.com' })
  const partial = refundOrder(db, store.id, order.id, { amountCents: 4000 })
  assert.equal(partial.paymentStatus, 'partially_refunded')
  const full = refundOrder(db, store.id, order.id, {})
  assert.equal(full.paymentStatus, 'refunded')
  assert.equal(full.refunds.reduce((sum, refund) => sum + refund.amountCents, 0), order.totalCents)
  assert.throws(() => refundOrder(db, store.id, order.id, {}), /Nothing left to refund/)
})

test('a draft product cannot be added to a cart', () => {
  const { db, store } = shop()
  const draft = createProduct(db, store.id, { title: 'Hidden', status: 'draft', variants: [{ title: 'One', priceCents: 1000 }] })
  assert.throws(() => addToCart(db, store.id, createCart(db, store.id).id, draft.variants[0]!.id, 1), /not available/)
})

test('handles stay unique inside a store', () => {
  const { db, store } = shop()
  createProduct(db, store.id, { title: 'The Glove', variants: [{ title: 'a', priceCents: 1 }] })
  const handles = listProducts(db, store.id, {}).map((product) => product.handle)
  assert.equal(new Set(handles).size, handles.length)
})

test('a product that is also a bundle gift can still be bought', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Gifts', prompt: 'gifts' })
  seedDefaultRegion(db, store.id, 'USD')
  const glove = createProduct(db, store.id, { title: 'Glove', status: 'published', variants: [{ title: '16oz', priceCents: 5000, inventory: 50 }] })
  const wraps = createProduct(db, store.id, { title: 'Wraps', status: 'published', variants: [{ title: 'One', priceCents: 1200, inventory: 50 }] })
  const wrapVariant = wraps.variants[0]!
  upsertBundle(db, store.id, {
    productId: glove.id,
    tiers: [{ quantity: 2, discountPercent: 0, label: 'Two', giftVariantId: wrapVariant.id, giftLabel: 'Free wraps' }],
  })

  let cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 2)
  assert.ok(cart.items.some((item) => item.giftOf), 'the tier earned the gift')

  cart = addToCart(db, store.id, cart.id, wrapVariant.id, 3)
  const paid = cart.items.find((item) => item.variantId === wrapVariant.id && !item.giftOf)
  assert.ok(paid, 'adding the same product as a paid line is not swallowed by the gift line')
  assert.equal(paid.quantity, 3)
  assert.equal(paid.unitCents, 1200)
  assert.equal(cart.items.filter((item) => item.giftOf).length, 1, 'and the gift is still exactly one')
  assert.equal(totals(db, store.id, cart).subtotalCents, 2 * 5000 + 3 * 1200)
})

test('an order bump is charged at the price the checkout printed, not the catalog price', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Bumps', prompt: 'bumps' })
  seedDefaultRegion(db, store.id, 'USD')
  const wraps = createProduct(db, store.id, { title: 'Wraps', status: 'published', variants: [{ title: 'One', priceCents: 2400, inventory: 50 }] })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, wraps.variants[0]!.id, 1, 'order-bump', 999)
  assert.equal(cart.items[0]?.unitCents, 999, 'the funnel sets the bump price')
  assert.equal(totals(db, store.id, cart).subtotalCents, 999)
})

test('a refund moves money wherever it is asked for, and a full refund covers the upsell charge too', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Refunds', prompt: 'refunds' })
  seedDefaultRegion(db, store.id, 'USD')
  install(db, store.id, 'stripe', { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz' })
  const calls: Array<Record<string, string>> = []
  useStripeTransport(async (path, init) => {
    if (path === '/v1/refunds') calls.push(Object.fromEntries(new URLSearchParams(init.body ?? '')))
    return { ok: true, status: 200, json: async () => ({ id: 're_1', status: 'succeeded' }) }
  })

  const product = createProduct(db, store.id, { title: 'Glove', status: 'published', variants: [{ title: '16oz', priceCents: 10_000, inventory: 10 }] })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, product.variants[0]!.id, 1)
  let order = completeCart(db, store.id, cart.id, { email: 'b@example.com', payment: { provider: 'stripe', status: 'captured', intentId: 'pi_original' } })
  const extra = createProduct(db, store.id, { title: 'Wraps', status: 'published', variants: [{ title: 'One', priceCents: 4_000, inventory: 10 }] })
  const line = { variantId: extra.variants[0]!.id, productId: extra.id, title: 'Wraps', variantTitle: 'One', image: '', unitCents: 4_000, quantity: 1, source: 'upsell' }
  order = recordUpsell(db, store.id, order.id, { offered: 'Wraps', accepted: true, line, amountCents: 4_000, paymentIntentId: 'pi_upsell' })
  assert.equal(order.totalCents, 14_900, 'goods, shipping, and the upsell charged after the fact')

  const tool = listTools().find((entry) => entry.name === 'refund_order')!
  const result = await tool.handler({ orderId: order.id }, { db, storeId: store.id, userId: user.id } as never)
  assert.match(result.summary, /through Stripe/, 'the assistant no longer says it refunded without doing it')

  assert.deepEqual(
    calls.map((call) => [call.payment_intent, call.amount]),
    [['pi_original', '10900'], ['pi_upsell', '4000']],
    'the upsell is charged on its own intent, so a full refund has to give both back',
  )
  assert.equal(getOrder(db, store.id, order.id)?.paymentStatus, 'refunded')
  useStripeTransport(null)
})

test('accepting the same return twice does not put the stock back twice', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Returns', prompt: 'returns' })
  seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, { title: 'Glove', status: 'published', variants: [{ title: '16oz', priceCents: 5_000, inventory: 10 }] })
  const variantId = product.variants[0]!.id
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variantId, 3)
  const order = completeCart(db, store.id, cart.id, { email: 'b@example.com' })
  assert.equal(getVariant(db, store.id, variantId)?.inventory, 7)

  returnOrder(db, store.id, order.id, 'changed mind')
  assert.equal(getVariant(db, store.id, variantId)?.inventory, 10)
  returnOrder(db, store.id, order.id, 'chased it again')
  assert.equal(getVariant(db, store.id, variantId)?.inventory, 10, 'a second return is a no-op, not three more in stock')
})

test('two automatic promotions cannot discount more than the cart is worth, and the lines add up', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Stack', prompt: 'stack' })
  seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, { title: 'Thing', status: 'published', variants: [{ title: 'One', priceCents: 10_000, inventory: 10 }] })
  createPromotion(db, store.id, { title: 'Sixty', kind: 'percentage', value: 60, automatic: true })
  createPromotion(db, store.id, { title: 'Another sixty', kind: 'percentage', value: 60, automatic: true })

  const cart = addToCart(db, store.id, createCart(db, store.id).id, product.variants[0]!.id, 1)
  const amounts = totals(db, store.id, cart)
  assert.equal(amounts.discountCents, 10_000, 'a cart can go to zero but no further')
  assert.equal(
    amounts.appliedPromotions.reduce((sum, entry) => sum + entry.amountCents, 0),
    amounts.discountCents,
    'and every line the totals block prints is the amount actually taken',
  )
  assert.equal(amounts.subtotalCents - amounts.discountCents, 0)
})
