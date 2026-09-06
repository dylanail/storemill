import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createStore } from '../src/control/stores.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { createPage } from '../src/pages/store.ts'
import { setVersionWeight, versionsFor } from '../src/pages/versions.ts'
import { analyzeExperiment, probabilityBest, promoteExperiment, rollbackExperiment, startPdpExperiment } from '../src/analytics/experiments.ts'
import { track } from '../src/analytics/events.ts'
import { addToCart, createCart } from '../src/domain/cart.ts'
import { completeCart, recordSupplierOrder } from '../src/domain/orders.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'
import { normalizeResponse, syncOrderTracking, useSeventeenTrackTransport } from '../src/shipping/seventeen-track.ts'
import { exportStore } from '../src/control/export.ts'

test('Bayesian CRO waits for evidence, finds a winner, promotes it, and restores exact prior weights', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Experiment Shop' })
  const product = createProduct(db, store.id, { title: 'Daily Carry', status: 'published', variants: [{ title: 'One', priceCents: 7500, inventory: 500 }] })
  const control = createPage(db, store.id, { title: 'Daily Carry — Story', kind: 'product', role: 'pdp', productId: product.id, format: 'story', status: 'published' })
  const challenger = createPage(db, store.id, { title: 'Daily Carry — Benefit', kind: 'product', role: 'pdp', productId: product.id, format: 'benefit', status: 'published' })
  setVersionWeight(db, store.id, control.id, 30)
  setVersionWeight(db, store.id, challenger.id, 70)

  const experiment = startPdpExperiment(db, store.id, { productId: product.id, pageIds: [control.id, challenger.id], autoPromote: false, minViews: 75 })
  assert.deepEqual(versionsFor(db, store.id, product.id).map((page) => page.weight).sort((a, b) => a - b), [50, 50])
  assert.equal(analyzeExperiment(db, store.id, experiment.id).status, 'running', 'empty tests do not make a choice')

  for (const [page, purchases] of [[control, 5], [challenger, 22]] as const) {
    for (let index = 0; index < 80; index++) {
      const session = `session_${page.id}_${index}`
      track(db, store.id, session, 'view.product', { productId: product.id, meta: { pageId: page.id } })
      if (index < purchases) track(db, store.id, session, 'checkout.complete', { amountCents: 7500 })
    }
  }
  const ready = analyzeExperiment(db, store.id, experiment.id)
  assert.equal(ready.status, 'ready')
  assert.equal(ready.results.winnerId, challenger.id)
  assert.ok((ready.results.variants?.find((entry) => entry.pageId === challenger.id)?.probabilityBest ?? 0) > 0.99)

  promoteExperiment(db, store.id, experiment.id)
  assert.deepEqual(versionsFor(db, store.id, product.id).map((page) => [page.id, page.weight]).sort(), [[challenger.id, 100], [control.id, 0]].sort())
  rollbackExperiment(db, store.id, experiment.id)
  assert.deepEqual(versionsFor(db, store.id, product.id).map((page) => [page.id, page.weight]).sort(), [[challenger.id, 70], [control.id, 30]].sort())
})

test('probability-to-win is deterministic and keeps tiny samples uncertain', () => {
  const tiny = probabilityBest([{ views: 1, purchases: 1 }, { views: 1, purchases: 0 }], 'same-seed')
  assert.deepEqual(tiny, probabilityBest([{ views: 1, purchases: 1 }, { views: 1, purchases: 0 }], 'same-seed'))
  assert.ok(tiny[0]! < 0.95, 'one conversion cannot trigger a winner')
})

test('17TRACK v2.4 responses normalize into customer-facing events and are cached', async () => {
  const normalized = normalizeResponse('YT123', { data: { accepted: [{ number: 'YT123', track_info: { latest_status: { status: 'InTransit', sub_status: 'Departed' }, time_metrics: { estimated_delivery_date: { from: '2026-09-09', to: '2026-09-12' } }, tracking: { providers: [{ provider: { name: 'YunExpress' }, events: [{ time_iso: '2026-09-04T10:00:00Z', location: 'Shenzhen', description: 'Departed facility', stage: 'InTransit' }] }] } } }] } })
  assert.equal(normalized.carrier, 'YunExpress')
  assert.equal(normalized.subStatus, 'Departed')
  assert.equal(normalized.events[0]?.location, 'Shenzhen')

  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Tracked Shop' })
  seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, { title: 'Parcel', status: 'published', variants: [{ title: 'One', priceCents: 1000, inventory: 10 }] })
  const cart = createCart(db, store.id)
  addToCart(db, store.id, cart.id, product.variants[0]!.id, 1)
  const order = recordSupplierOrder(db, store.id, completeCart(db, store.id, cart.id, { email: 'buyer@example.com' }).id, { supplier: 'Supplier', tracking: 'YT123' })
  const oldKey = process.env.AMBORAS_17TRACK_API_KEY
  process.env.AMBORAS_17TRACK_API_KEY = 'test-token'
  let calls = 0
  useSeventeenTrackTransport(async (url) => {
    calls++
    if (url.endsWith('/register')) return new Response(JSON.stringify({ code: 0, data: { accepted: [{ number: 'YT123' }] } }), { status: 200 })
    return new Response(JSON.stringify({ code: 0, data: { accepted: [{ number: 'YT123', track_info: { latest_status: { status: 'InTransit', sub_status: 'Departed' }, tracking: { providers: [{ provider: { name: 'YunExpress' }, events: [{ time_iso: '2026-09-04T10:00:00Z', description: 'Departed' }] }] } } }] } }), { status: 200 })
  })
  try {
    const first = await syncOrderTracking(db, store.id, order)
    const second = await syncOrderTracking(db, store.id, order)
    assert.equal(first?.carrier, 'YunExpress')
    assert.equal(second?.status, 'InTransit')
    assert.equal(calls, 2, 'register and fetch happen once; the second view uses SQLite')
  } finally {
    useSeventeenTrackTransport(null)
    if (oldKey === undefined) delete process.env.AMBORAS_17TRACK_API_KEY
    else process.env.AMBORAS_17TRACK_API_KEY = oldKey
  }
})

test('store backup is complete within one store and excludes authentication sessions', () => {
  const { db, user } = fresh()
  const first = createStore(db, user.id, { name: 'Mine' })
  const second = createStore(db, user.id, { name: 'Not Mine' })
  createProduct(db, first.id, { title: 'Included', variants: [{ title: 'One', priceCents: 100 }] })
  createProduct(db, second.id, { title: 'Excluded', variants: [{ title: 'One', priceCents: 100 }] })
  const backup = exportStore(db, first.id)
  assert.equal(backup.format, 'storemill-store-backup')
  assert.equal(backup.tables.stores?.length, 1)
  assert.equal(backup.tables.products?.length, 1)
  assert.equal(backup.tables.products?.[0]?.title, 'Included')
  assert.equal(backup.tables.users, undefined)
  assert.equal(backup.tables.sessions, undefined)
})
