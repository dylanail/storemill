import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createStore } from '../src/control/stores.ts'
import { install } from '../src/control/plugins.ts'
import { dispatchServerEvents, queueServerEvents } from '../src/analytics/server-events.ts'
import { captureAttribution, attributeOrder, attributionReport, kpis, sessionFor } from '../src/analytics/events.ts'
import { addToCart, createCart, totals } from '../src/domain/cart.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { createRegion, seedDefaultRegion } from '../src/domain/regions.ts'
import { completeCart, salesSummary } from '../src/domain/orders.ts'
import { createPromotion } from '../src/domain/promotions.ts'
import { ensureDefaultFlows, listFlows, runFlow } from '../src/email/flows.ts'
import { upsertCustomer } from '../src/domain/customers.ts'
import { cancelAssistantRequest, enqueueAssistantRequest, listAssistantQueue, recoverAssistantQueue } from '../src/agent/queue.ts'

function shop() {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Growth Store', currency: 'USD' })
  const region = seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, { title: 'Glove', status: 'published', variants: [{ title: 'One', priceCents: 10000, inventory: 20 }] })
  return { db, user, store, region, product, variant: product.variants[0]! }
}

test('Meta CAPI and TikTok web events leave through the durable outbox', async () => {
  const { db, store, product } = shop()
  install(db, store.id, 'meta-pixel', { pixelId: '12345678901', accessToken: 'meta-secret' })
  install(db, store.id, 'tiktok-pixel', { pixelId: 'CABC123456789', accessToken: 'tiktok-secret' })
  assert.equal(queueServerEvents(db, store.id, {
    eventId: 'order-1', type: 'checkout.complete', url: 'https://shop.example/thanks', ip: '127.0.0.1', userAgent: 'test',
    currency: 'USD', valueCents: 12500, productId: product.id, email: 'BUYER@EXAMPLE.COM', externalId: 'buyer-1',
  }), 2)
  assert.equal(queueServerEvents(db, store.id, {
    eventId: 'order-1', type: 'checkout.complete', url: 'https://shop.example/thanks', ip: '127.0.0.1', userAgent: 'test',
  }), 0, 'provider event ids are idempotent')
  const calls: Array<{ url: string; headers: unknown; body: string }> = []
  const result = await dispatchServerEvents(db, async (url, init) => {
    calls.push({ url, headers: init.headers, body: String(init.body) })
    return { ok: true, status: 200, text: async () => JSON.stringify({events_received:1}) }
  })
  assert.deepEqual(result, { sent: 2, failed: 0 })
  assert.match(calls[0]!.body, /Purchase|CompletePayment/)
  assert.ok(calls.some((call) => call.url.includes('graph.facebook.com')))
  assert.ok(calls.some((call) => call.url.includes('business-api.tiktok.com')))
  assert.equal(db.one<{ c: number }>("SELECT COUNT(*) c FROM server_event_deliveries WHERE status = 'sent'")?.c, 2)

  const japanPayload = queueServerEvents(db, store.id, {
    eventId: 'order-jpy', type: 'checkout.complete', url: 'https://shop.example/thanks', ip: '127.0.0.1', userAgent: 'test',
    currency: 'JPY', valueCents: 15000,
  })
  assert.equal(japanPayload, 2)
  const queued = db.all<{ payload: string }>("SELECT payload FROM server_event_deliveries WHERE event_id = 'order-jpy'")
  assert.ok(queued.every((row) => JSON.parse(row.payload).custom_data?.value === 15000 || JSON.parse(row.payload).properties?.value === 15000))
})

test('markets convert product prices once and persist orders in the charged currency', () => {
  const { db, store, variant } = shop()
  const europe = createRegion(db, store.id, { name: 'Europe', currency: 'EUR', locale: 'de-DE', countries: ['DE', 'FR'], exchangeRate: 0.9 })
  const cart = addToCart(db, store.id, createCart(db, store.id, europe.id).id, variant.id, 2)
  const amounts = totals(db, store.id, cart)
  assert.equal(amounts.currency, 'EUR')
  assert.equal(amounts.subtotalCents, 18000)
  const order = completeCart(db, store.id, cart.id, { email: 'europe@example.com' })
  assert.equal(order.currency, 'EUR')
  assert.equal(order.items[0]?.unitCents, 9000)
  assert.equal(order.subtotalCents, 18000)
})

test('zero-decimal markets use the target currency minor unit', () => {
  const { db, store, variant } = shop()
  const japan = createRegion(db, store.id, { name: 'Japan', currency: 'JPY', locale: 'ja-JP', countries: ['JP'], exchangeRate: 150 })
  const cart = addToCart(db, store.id, createCart(db, store.id, japan.id).id, variant.id, 1)
  assert.equal(totals(db, store.id, cart).subtotalCents, 15000)
  const order = completeCart(db, store.id, cart.id, { email: 'japan@example.com' })
  assert.equal(order.totalCents, 15000)
  assert.equal(order.baseTotalCents, 10000)
  assert.equal(salesSummary(db, store.id).revenueCents, 10000)
  assert.equal(kpis(db, store.id).revenueCents, 10000)
})

test('cross-product BOGO, mix-and-match and region/use rules work together', () => {
  const { db, store, region, product, variant } = shop()
  const reward = createProduct(db, store.id, { title: 'Wrap', status: 'published', variants: [{ title: 'One', priceCents: 2500, inventory: 20 }] })
  createPromotion(db, store.id, { title: 'Glove plus wrap', kind: 'bogo', value: 100, rules: { buyProductIds: [product.id], getProductIds: [reward.id], buyQuantity: 1, getQuantity: 1, regionIds: [region.id], maxUses: 2 } })
  createPromotion(db, store.id, { title: 'Mix any two', kind: 'mix_match', value: 10, rules: { productIds: [product.id, reward.id], requiredDistinctProducts: 2 } })
  let cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1)
  cart = addToCart(db, store.id, cart.id, reward.variants[0]!.id, 1)
  const amounts = totals(db, store.id, cart)
  assert.equal(amounts.discountCents, 3750)
  assert.deepEqual(amounts.appliedPromotions.map((entry) => entry.title).sort(), ['Glove plus wrap', 'Mix any two'])
})

test('first/last touch attribution is frozen onto an order and grouped by channel', () => {
  const { db, store, variant } = shop()
  const first = captureAttribution(new URL('https://shop.example/?utm_source=meta&utm_campaign=launch'))
  const sessionId = sessionFor(db, store.id, { ip: '1.2.3.4', userAgent: 'browser', touch: first })
  sessionFor(db, store.id, { ip: '1.2.3.4', userAgent: 'browser', touch: captureAttribution(new URL('https://shop.example/product?ttclid=abc')) })
  sessionFor(db, store.id, {
    ip: '1.2.3.4', userAgent: 'browser', referrer: 'https://shop.example/product',
    touch: captureAttribution(new URL('https://shop.example/checkout'), 'https://shop.example/product'),
  })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, variant.id, 1)
  const order = completeCart(db, store.id, cart.id, { email: 'buyer@example.com' })
  attributeOrder(db, store.id, order.id, sessionId)
  const report = attributionReport(db, store.id, '30d')
  assert.equal(report[0]?.channel, 'tiktok')
  assert.equal(report[0]?.orders, 1)
})

test('native welcome flows require consent and never deliver the same trigger twice', async () => {
  const { db, store } = shop()
  const existing = upsertCustomer(db, store.id, { email: 'existing@example.com', name: 'Existing', marketing: true })
  db.run("UPDATE customers SET created_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", existing.id)
  ensureDefaultFlows(db, store.id)
  upsertCustomer(db, store.id, { email: 'yes@example.com', name: 'Yes', marketing: true })
  upsertCustomer(db, store.id, { email: 'no@example.com', name: 'No', marketing: false })
  const flow = listFlows(db, store.id).find((entry) => entry.trigger === 'welcome')!
  assert.equal(await runFlow(db, flow, 'https://shop.example'), 1)
  assert.equal(await runFlow(db, flow, 'https://shop.example'), 0)
  assert.equal(db.one<{ c: number }>('SELECT COUNT(*) c FROM marketing_flow_deliveries')?.c, 1)
  assert.equal(db.one<{ recipient: string }>('SELECT recipient FROM marketing_flow_deliveries')?.recipient, 'yes@example.com')
})

test('Assistant requests can queue and be cancelled before they run', () => {
  const { db, user, store } = shop()
  const request = enqueueAssistantRequest(db, { storeId: store.id, userId: user.id, text: 'Create a campaign', page: 'marketing' })
  assert.equal(listAssistantQueue(db, store.id)[0]?.status, 'queued')
  assert.equal(cancelAssistantRequest(db, store.id, request.id), true)
  assert.equal(listAssistantQueue(db, store.id)[0]?.status, 'cancelled')

  const interrupted = enqueueAssistantRequest(db, { storeId: store.id, userId: user.id, text: 'Change the storefront' })
  db.run("UPDATE assistant_queue SET status = 'running' WHERE id = ?", interrupted.id)
  assert.equal(recoverAssistantQueue(db), 1)
  assert.equal(listAssistantQueue(db, store.id).find((entry) => entry.id === interrupted.id)?.status, 'failed')
})
