import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createStore, getStore } from '../src/control/stores.ts'
import { canReserve, createProduct, getProduct, getVariant, updateProduct } from '../src/domain/catalog.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'
import { addToCart, createCart } from '../src/domain/cart.ts'
import { completeCart, recordSupplierOrder, markDelivered, recordUpsell } from '../src/domain/orders.ts'
import { createPromotion } from '../src/domain/promotions.ts'
import { totals } from '../src/domain/cart.ts'
import { carrierFor, deliveryEstimate, importReviews, marginFor, parseCsv, profitReport, recordAdSpend, recentPurchases, roasLines, trackingFor, importProductFromUrl, createFromImport, askQuestion, answerQuestion, listQuestions } from '../src/domain/ops.ts'
import { ensureShippingProtection, funnelForProducts, resolveBump, resolveOffer, upsertFunnel } from '../src/domain/funnels.ts'
import { ADVERTORIAL_FORMATS, PDP_FORMATS, readDirection, redirectContent, writeAdvertorial, writePdp } from '../src/agent/directions.ts'
import { readBrief } from '../src/agent/copy.ts'
import { rulesResearch } from '../src/agent/research.ts'
import { generateVersions, pickPdpVersion, setVersionWeight, versionStats } from '../src/pages/versions.ts'
import { renderBlocks, type BlockContext } from '../src/pages/blocks.ts'
import { blockContextFor } from '../src/pages/store.ts'
import { sessionFor, track } from '../src/analytics/events.ts'
import { sweepAbandonedCarts } from '../src/email/abandoned.ts'
import { saveCheckoutDraft } from '../src/domain/cart.ts'
import { listReviews } from '../src/domain/reviews.ts'
import { execute } from '../src/agent/registry.ts'

function shop() {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Drop Co', prompt: 'a boxing gear store' })
  seedDefaultRegion(db, store.id, 'USD')
  const glove = createProduct(db, store.id, { title: 'The Glove', subtitle: 'For rounds', description: 'A glove. It lasts. It is repaired.', status: 'published', heroImage: '/g.svg', variants: [{ title: '16oz', priceCents: 10000, inventory: 20 }], supplier: { costCents: 3000, shippingCents: 800, processingDays: 2, shippingDaysMin: 5, shippingDaysMax: 9 } })
  const wraps = createProduct(db, store.id, { title: 'The Wrap', status: 'published', variants: [{ title: '180in', priceCents: 2000, inventory: 20 }] })
  return { db, user, store, glove, wraps }
}

/* ------------------------------------------------------- directions */

test('direction is read into tone, audience, angle and must-say phrases', () => {
  const direction = readDirection('Premium and understated, for people who train seriously, focus on the repair guarantee, say "built in Mexico City"')
  assert.equal(direction.tone, 'premium')
  assert.equal(direction.audience, 'people who train seriously')
  assert.equal(direction.angle, 'the repair guarantee')
  assert.deepEqual(direction.mustSay, ['built in Mexico City'])
  assert.equal(direction.urgency, false)
  assert.equal(readDirection('make it urgent, limited batch').urgency, true)
  assert.equal(readDirection('').tone, 'plain')
})

test('every advertorial and pdp format writes a complete page in every tone', () => {
  const { store, glove } = shop()
  const brief = readBrief('boxing gloves')
  const research = rulesResearch(brief)
  const context: BlockContext = { storeName: 'Drop Co', base: '', currency: 'USD', brand: {}, products: [{ id: glove.id, handle: glove.handle, title: glove.title, subtitle: '', image: '/g.svg', priceCents: 10000, variants: [{ id: glove.variants[0]!.id, title: '16oz', priceCents: 10000 }], options: [] }], reviews: [], bundles: [] }
  for (const format of ADVERTORIAL_FORMATS) {
    for (const tone of ['', 'urgent', 'premium', 'blunt']) {
      const blocks = writeAdvertorial({ product: glove, store: { name: store.name, prompt: store.prompt }, research, brief, direction: readDirection(tone), format })
      const types = blocks.map((block) => block.type)
      assert.ok(types.includes('publication-bar') && types.includes('disclaimer') && (types.includes('buy-box') || types.includes('bundle-offer')), `${format.id}/${tone} has masthead, disclaimer and an offer`)
      assert.ok(renderBlocks(blocks, context).length > 2000)
    }
  }
  for (const format of PDP_FORMATS) {
    const blocks = writePdp({ product: glove, store: { name: store.name, prompt: store.prompt }, research, brief, direction: readDirection('for gift buyers'), format })
    assert.ok(blocks.some((block) => block.type === 'buy-box' || block.type === 'bundle-offer'), `${format.id} sells`)
    assert.equal(blocks.at(-1)?.type, 'footer')
  }
  const urgent = writePdp({ product: glove, store: { name: store.name, prompt: store.prompt }, research, brief, direction: readDirection('urgent'), format: PDP_FORMATS[0]! })
  assert.ok(urgent.some((block) => block.type === 'countdown'), 'an urgent direction adds the countdown to a calm format')

  // The two formats the reference pages taught: the science page and the long sales page.
  const science = writePdp({ product: glove, store: { name: store.name, prompt: store.prompt }, research, brief, direction: readDirection(''), format: PDP_FORMATS.find((format) => format.id === 'science')! })
  const scienceTypes = science.map((block) => block.type)
  for (const type of ['rating-strip', 'stats', 'how-it-works', 'studies', 'ingredients', 'timeline', 'letter', 'value-stack', 'buy-box']) assert.ok(scienceTypes.includes(type), `science page has ${type}`)
  assert.ok(scienceTypes.indexOf('studies') < scienceTypes.indexOf('buy-box'), 'the research comes before the offer')
  assert.equal(science.find((block) => block.type === 'sticky-cta')?.settings.productId, glove.id)
  assert.match(renderBlocks(science, context), /\[confirm\]/, 'facts nobody supplied are marked, not invented')
  const sales = writePdp({ product: glove, store: { name: store.name, prompt: store.prompt }, research, brief, direction: readDirection('for gift buyers'), format: PDP_FORMATS.find((format) => format.id === 'sales')! })
  const salesTypes = sales.map((block) => block.type)
  assert.ok(salesTypes.indexOf('button') < salesTypes.indexOf('timeline'), 'the first button is on top, the argument below')
  assert.ok(!salesTypes.includes('announcement-bar'), 'no urgency bar without an urgent direction')
  assert.equal(sales.find((block) => block.type === 'sticky-cta')?.settings.productId, glove.id)
  assert.equal(sales.find((block) => block.type === 'headline' && block.settings.level === 'h1')?.settings.eyebrow, 'For gift buyers')
  assert.ok(writePdp({ product: glove, store: { name: store.name, prompt: store.prompt }, research, brief, direction: readDirection('urgent'), format: PDP_FORMATS.find((format) => format.id === 'sales')! }).some((block) => block.type === 'announcement-bar'))
})

test('a direction restyles the built-in product page without a new page', () => {
  const content = redirectContent({ benefits: [{ title: 'Lasts', body: 'Long.' }], guarantee: 'Thirty days, no questions.', trust: ['a', 'b', 'c'] }, readDirection('blunt, say "no logo tax", focus on durability'))
  assert.equal(content.guarantee, 'Thirty days. Send it back, get your money.')
  assert.equal(content.benefits?.[0]?.title, 'Lasts — durability')
  assert.equal(content.trust?.[0], 'no logo tax')
})

/* --------------------------------------------------------- versions */

test('versions are generated per format, split by session, and measured', async () => {
  const { db, store, glove } = shop()
  const pages = await generateVersions(db, getStore(db, store.id)!, { productId: glove.id, kind: 'pdp', formats: ['benefit', 'urgency'], direction: 'urgent', publish: true })
  assert.equal(pages.length, 2)
  assert.equal(pickPdpVersion(db, store.id, glove, 'anyone'), null, 'weight 0 means the built-in page')
  setVersionWeight(db, store.id, pages[0]!.id, 1)
  setVersionWeight(db, store.id, pages[1]!.id, 1)
  const seen = new Set<string>()
  for (let index = 0; index < 40; index++) seen.add(pickPdpVersion(db, store.id, glove, `session-${index}`)!.id)
  assert.equal(seen.size, 2, 'both versions get traffic')
  assert.equal(pickPdpVersion(db, store.id, glove, 'stable')!.id, pickPdpVersion(db, store.id, glove, 'stable')!.id, 'the same session sees the same version')

  const session = sessionFor(db, store.id, { ip: '10.9.9.9', userAgent: 'x' })
  const winner = pickPdpVersion(db, store.id, glove, session)!
  track(db, store.id, session, 'view.product', { productId: glove.id, meta: { pageId: winner.id } })
  track(db, store.id, session, 'cart.add', { productId: glove.id })
  track(db, store.id, session, 'checkout.complete', { amountCents: 10900 })
  const stats = versionStats(db, store.id, glove.id)
  const row = stats.find((entry) => entry.pageId === winner.id)!
  assert.deepEqual([row.views, row.carts, row.purchases, row.revenueCents], [1, 1, 1, 10900])
})

/* -------------------------------------------------------------- ops */

test('margin, profit and ROAS come from what is on file', () => {
  const { db, store, glove } = shop()
  const margin = marginFor(10000, glove.supplier)
  assert.equal(margin.costCents, 3000)
  assert.equal(margin.profitCents, 10000 - 3000 - 800 - 320)
  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  const order = completeCart(db, store.id, cart.id, { email: 'b@example.com' })
  recordAdSpend(db, store.id, { day: new Date().toISOString(), platform: 'Meta', amountCents: 2500 })
  const report = profitReport(db, store.id, 7)
  assert.equal(report.revenueCents, order.totalCents)
  assert.equal(report.cogsCents, 3000)
  assert.equal(report.adSpendCents, 2500)
  assert.equal(report.profitCents, order.totalCents - 3000 - 800 - (Math.round(order.totalCents * 0.029) + 30) - 2500)
  assert.equal(report.roas, Math.round((order.totalCents / 2500) * 100) / 100)
  recordSupplierOrder(db, store.id, order.id, { supplier: 'CJ', orderId: 'CJ-1', costCents: 2600, shippingCents: 700 })
  assert.equal(profitReport(db, store.id, 7).cogsCents, 2600, 'the recorded supplier cost replaces the estimate')
})

test('tracking detects the carrier and the timeline follows the order', () => {
  const { db, store, glove } = shop()
  assert.equal(carrierFor('1Z999AA10123456784').name, 'UPS')
  assert.equal(carrierFor('LP00123456789012').name, 'Cainiao / AliExpress Standard')
  assert.equal(carrierFor('RB123456789CN').name, 'Universal postal')
  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  const order = completeCart(db, store.id, cart.id, { email: 'b@example.com' })
  let view = trackingFor(db, store.id, order)
  assert.deepEqual(view.steps.map((step) => step.done), [true, false, false, false])
  assert.ok(view.estimate)
  const shipped = recordSupplierOrder(db, store.id, order.id, { supplier: 'CJ', orderId: 'CJ-2', tracking: '1Z999AA10123456784' })
  assert.equal(shipped.fulfillmentStatus, 'shipped')
  view = trackingFor(db, store.id, shipped)
  assert.equal(view.tracking?.carrier, 'UPS')
  assert.deepEqual(view.steps.map((step) => step.done), [true, true, true, false])
  markDelivered(db, store.id, order.id)
  assert.equal(trackingFor(db, store.id, getStoreOrder(db, store.id, order.id)).steps[3]?.done, true)
  const estimate = deliveryEstimate(glove.supplier, '2026-09-01T10:00:00Z')
  assert.ok(estimate.toDate > estimate.fromDate)
})

function getStoreOrder(db: ReturnType<typeof fresh>['db'], storeId: string, orderId: string) {
  const { getOrder } = require_orders()
  return getOrder(db, storeId, orderId)!
}
import { getOrder } from '../src/domain/orders.ts'
function require_orders() { return { getOrder } }

test('reviews import from the export shapes the review apps produce', () => {
  const { db, store, glove } = shop()
  const csv = 'product_handle,rating,title,body,author,photo_url\n' + `${glove.handle},5,Great,"Held up, ""really"" well through sparring",Marisol,https://img.example.com/a.jpg|https://img.example.com/b.jpg\n` + `nope,4,,Short review of a missing product,Dev,\n` + `${glove.handle},3,,Fine. Slow shipping though.,Kaz,`
  const result = importReviews(db, store.id, csv)
  assert.deepEqual([result.imported, result.skipped, result.products], [2, 1, 1])
  const reviews = listReviews(db, store.id, { productId: glove.id, status: 'all' })
  const withPhotos = reviews.find((review) => review.media.length)
  assert.equal(withPhotos?.media.length, 2)
  assert.equal(withPhotos?.body, 'Held up, "really" well through sparring')
  assert.ok(reviews.every((review) => !review.verified), 'imported reviews are never verified')
  assert.deepEqual(parseCsv('a,b\n1,"x,y"\n')[0], { a: '1', b: 'x,y' })
})

test('products import from a Shopify store JSON or an Open Graph page', async () => {
  const { db, store } = shop()
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    if (url === 'https://rival.example.com/products/the-thing.json') return new Response(JSON.stringify({ product: { title: 'The Thing', body_html: '<p>Body <b>html</b></p>', vendor: 'Rival', images: [{ src: 'https://cdn.example.com/1.jpg' }], options: [{ name: 'Size', values: ['S', 'M'] }], variants: [{ title: 'S', price: '19.90', sku: 'T-S' }, { title: 'M', price: '19.90' }] } }), { headers: { 'content-type': 'application/json' } })
    if (url === 'https://supplier.example.com/item/9') return new Response('<html><head><title>Widget | Supplier</title><meta property="og:title" content="Steel Widget"><meta property="og:image" content="/img/w.jpg"><meta property="product:price:amount" content="4.20"><meta property="product:price:currency" content="USD"><meta name="description" content="A widget."></head><body></body></html>', { headers: { 'content-type': 'text/html' } })
    return new Response('nope', { status: 404 })
  }) as typeof fetch
  const shopify = await importProductFromUrl('https://rival.example.com/products/the-thing?variant=1', fetchImpl)
  assert.equal(shopify.title, 'The Thing')
  assert.equal(shopify.description, 'Body html')
  assert.deepEqual(shopify.options, [{ title: 'Size', values: ['S', 'M'] }])
  const product = createFromImport(db, store.id, shopify, { asSupplier: true, markup: 2.5 })
  assert.equal(product.supplier.costCents, 1990)
  assert.equal(product.variants[0]?.priceCents, 4999, 'marked up to the next hundred, ending in 99')
  assert.equal(product.status, 'draft')

  // The markup is on the landed cost. Multiplying the item alone put the
  // supplier's freight through at cost: $19.90 plus $7 of shipping at 2.5x
  // priced at $49.99 against a $26.90 cost — 1.9x, which no ad account carries.
  const landed = createFromImport(db, store.id, shopify, { asSupplier: true, markup: 2.5, supplierShippingCents: 700 })
  assert.equal(landed.supplier.shippingCents, 700)
  assert.equal(landed.variants[0]?.priceCents, 6699, '(1990 + 700) × 2.5, to the next hundred less a penny')
  const og = await importProductFromUrl('https://supplier.example.com/item/9', fetchImpl)
  assert.equal(og.title, 'Steel Widget')
  assert.equal(og.priceCents, 420)
  assert.deepEqual(og.images, ['https://supplier.example.com/img/w.jpg'])
})

test('a product is checked against the qualification criteria before anything is built on it', async () => {
  // docs/knowledge/product-research.md opens the whole method with this and
  // none of it was anywhere in the product: a store could be built end to end
  // around a $9 seasonal item at 1.4x on a declining trend, and nothing would
  // say so until the ad spend had already gone.
  const { db, store, user } = shop()
  const ctx = { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } }

  const bad = createProduct(db, store.id, { title: 'Novelty Snowman', status: 'draft', variants: [{ title: 'One', priceCents: 900, inventory: 5 }], supplier: { costCents: 600, shippingCents: 40 } })
  const skipped = await execute('qualify_product', { productId: bad.id, trend: 'declining', seasonal: true }, ctx)
  const result = skipped.data as { decision: string; checks: Array<{ key: string; verdict: string; detail: string }> }
  assert.equal(result.decision, 'skip')
  assert.equal(result.checks.find((check) => check.key === 'aov')?.verdict, 'fail')
  assert.equal(result.checks.find((check) => check.key === 'markup')?.verdict, 'fail', '$9.00 on a $6.40 landed cost is 1.4x')
  assert.equal(result.checks.find((check) => check.key === 'unit-price')?.verdict, 'fail')
  assert.equal(result.checks.find((check) => check.key === 'trend')?.verdict, 'fail')
  assert.equal(result.checks.find((check) => check.key === 'seasonality')?.verdict, 'warn')
  assert.equal(result.checks.find((check) => check.key === 'stand-out')?.verdict, 'fail', 'no way to stand out found is a reason not to run it')
  assert.ok(result.checks.every((check) => check.detail), 'every check says what it found')

  // The judgements stick to the product, so the next run remembers them.
  assert.match(getProduct(db, store.id, bad.id)?.metadata.qualify ?? '', /declining/)
  const again = await execute('qualify_product', { productId: bad.id, standOut: 'Nobody sells one that folds' }, ctx)
  assert.match((again.data as { checks: Array<{ key: string; verdict: string }> }).checks.find((check) => check.key === 'trend')?.verdict ?? '', /fail/, 'the trend from the earlier run is still on file')

  // The glove: $100 on a $38 landed cost, a flat trend, a stand-out named.
  const good = await execute('qualify_product', { productId: listProducts(db, store.id, { limit: 10 }).find((entry) => entry.title === 'The Glove')!.id, trend: 'flat', weightGrams: 600, standOut: 'Repairs, for club coaches who buy for a room' }, ctx)
  const passing = good.data as { decision: string; markup: number; summary: string; margin: { breakevenRoas: number | null } }
  assert.equal(passing.markup, 2.63, 'the markup is on the landed cost, the supplier\'s shipping included')
  assert.equal(passing.decision, 'work', 'nothing disqualifies it, but 2.63x is under the 3x line')
  assert.match(passing.summary, /markup on landed cost/)
  assert.ok(passing.margin.breakevenRoas, 'and the qualification quotes the same breakeven the profit page does')
  updateProduct(db, store.id, listProducts(db, store.id, { limit: 10 }).find((entry) => entry.title === 'The Glove')!.id, { supplier: { costCents: 2500, shippingCents: 500 } })
  const priced = await execute('qualify_product', { productId: listProducts(db, store.id, { limit: 10 }).find((entry) => entry.title === 'The Glove')!.id }, ctx)
  assert.equal((priced.data as { decision: string }).decision, 'run', 'at 3.3x on $30 landed every criterion passes')
})

test('questions are answered before they show, and social proof is only real orders', () => {
  const { db, store, glove } = shop()
  const question = askQuestion(db, store.id, { productId: glove.id, question: 'Does it run small?', asker: 'Priya' })
  assert.equal(listQuestions(db, store.id, { status: 'answered' }).length, 0)
  answerQuestion(db, store.id, question.id, 'True to size.')
  assert.equal(listQuestions(db, store.id, { productId: glove.id, status: 'answered' })[0]?.answer, 'True to size.')
  assert.deepEqual(recentPurchases(db, store.id), [])
  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  completeCart(db, store.id, cart.id, { email: 'marisol@example.com', name: 'Marisol Aguilar', address: { city: 'Mexico City' } })
  const [purchase] = recentPurchases(db, store.id)
  assert.equal(purchase?.name, 'Marisol')
  assert.equal(purchase?.city, 'Mexico City')
  const context = blockContextFor(db, getStore(db, store.id)!, '')
  assert.equal(context.live?.purchases.length, 1)
  assert.ok(context.live?.estimates[glove.id]?.from)
  assert.match(renderBlocks([{ id: 'b', type: 'recent-sales', settings: {} }], context), /salespop/)
  assert.match(renderBlocks([{ id: 'b', type: 'recent-sales', settings: {} }], { ...context, live: { ...context.live!, purchases: [] } }), /no orders yet/)
})

/* ---------------------------------------------------------- funnels */

test('a funnel supplies the bump, the upsell and the downsell; the bump is a hidden real product', () => {
  const { db, store, glove, wraps } = shop()
  const funnel = upsertFunnel(db, store.id, { name: 'Cold', productId: glove.id, bump: { enabled: true, priceCents: 299 }, upsell: { variantId: wraps.variants[0]!.id, discountPercent: 20 }, downsell: { variantId: wraps.variants[0]!.id, discountPercent: 35, headline: 'Last chance' } })
  assert.equal(funnelForProducts(db, store.id, [glove.id])?.id, funnel.id)
  assert.equal(funnelForProducts(db, store.id, ['prod_other']), null)
  const bump = resolveBump(db, store.id, funnel)!
  assert.equal(bump.product.metadata.kind, 'shipping-protection')
  assert.equal(bump.priceCents, 299)
  assert.ok(!getProductList(db, store.id).some((product) => product.metadata.kind === 'shipping-protection'), 'never listed in the catalog')
  assert.equal(ensureShippingProtection(db, store.id).id, bump.product.id, 'created once')
  const upsell = resolveOffer(db, store.id, funnel.upsell, () => null, 20)!
  assert.equal(upsell.product.id, wraps.id)
  const downsell = resolveOffer(db, store.id, funnel.downsell, () => null, 35)!
  assert.equal(downsell.headline, 'Last chance')
  assert.equal(downsell.discountPercent, 35)
})
import { listProducts } from '../src/domain/catalog.ts'
function getProductList(db: ReturnType<typeof fresh>['db'], storeId: string) { return listProducts(db, storeId, { limit: 100 }) }

test('abandoned carts get one email, once, after the window', async () => {
  const { db, store, glove } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  saveCheckoutDraft(db, store.id, cart.id, { email: 'left@example.com' })
  assert.equal(await sweepAbandonedCarts(db, { hours: 4 }), 0, 'too recent')
  db.run('UPDATE carts SET updated_at = ? WHERE id = ?', new Date(Date.now() - 5 * 3600_000).toISOString(), cart.id)
  assert.equal(await sweepAbandonedCarts(db, { hours: 4 }), 1)
  assert.equal(await sweepAbandonedCarts(db, { hours: 4 }), 0, 'never twice')
  const send = db.one<{ template: string; recipient: string }>('SELECT template, recipient FROM email_sends WHERE store_id = ?', store.id)
  assert.equal(send?.template, 'abandoned_cart')
  assert.equal(send?.recipient, 'left@example.com')
})

test('one person\'s platform: a store carries no plan, and hidden products stay hidden', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Mine' })
  assert.ok(!('planSlug' in store), 'there is no plan on a store')
  assert.deepEqual(store.models, {}, 'model choices start as the environment default')
  updateProduct(db, store.id, createProduct(db, store.id, { title: 'x', variants: [{ title: 'a', priceCents: 1 }] }).id, { metadata: { hidden: 'true' } })
  assert.equal(listProducts(db, store.id, {}).length, 0)
  assert.equal(listProducts(db, store.id, { includeHidden: true }).length, 1)
  assert.ok(getProduct(db, store.id, 'nope') === null)
})

test('the two ROAS lines are computed, and the report says which side of them the spend is on', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Lines', prompt: 'lines' })

  // 67% margin → breakeven 1.5, target 2.5 (the course's own worked example).
  assert.deepEqual(roasLines(67), { breakevenRoas: 1.5, targetRoas: 2.5 })
  assert.deepEqual(roasLines(55), { breakevenRoas: 1.82, targetRoas: 2.82 })
  assert.deepEqual(roasLines(0), { breakevenRoas: null, targetRoas: null })
  assert.deepEqual(roasLines(-12), { breakevenRoas: null, targetRoas: null }, 'a product that loses money has no line to scale on')

  const margin = marginFor(10_000, { costCents: 2_000, shippingCents: 500 } as never)
  assert.equal(margin.marginPercent, 72)
  assert.equal(margin.breakevenRoas, 1.39)
  assert.equal(margin.targetRoas, 2.39)

  const empty = profitReport(db, store.id, 30)
  assert.equal(empty.roas, null)
  assert.equal(empty.verdict, null, 'nothing to judge without spend')
  assert.equal(empty.cpcCents, null)

  recordAdSpend(db, store.id, { day: new Date().toISOString(), platform: 'Meta', amountCents: 20_000, clicks: 400 })
  recordAdSpend(db, store.id, { day: new Date().toISOString(), platform: 'TikTok', amountCents: 99_000 })
  const spent = profitReport(db, store.id, 30)
  assert.equal(spent.clicks, 400)
  assert.equal(spent.cpcCents, 50, 'CPC divides only the spend that had clicks logged with it, not the day someone forgot')
  assert.equal(spent.adSpendCents, 119_000, 'while the spend total still counts every row')
  assert.equal(spent.spendDays, 1)
  assert.equal(spent.roas, 0)
  assert.equal(spent.verdict, null, 'no revenue means no margin, and a line has to be divided into something')
})

test('the order bump is an add-on, not a second unit that triggers a quantity offer', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Bump', prompt: 'bump' })
  seedDefaultRegion(db, store.id, 'USD')
  const glove = createProduct(db, store.id, { title: 'Glove', status: 'published', variants: [{ title: '16oz', priceCents: 34_000, inventory: 20 }] })
  const protection = ensureShippingProtection(db, store.id, 299)
  createPromotion(db, store.id, { title: 'Buy two, save 15%', kind: 'bundle', value: 15, automatic: true, rules: { buyQuantity: 2 } })

  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  assert.equal(totals(db, store.id, cart).discountCents, 0, 'one glove is not two of anything')

  const withBump = addToCart(db, store.id, cart.id, protection.variants[0]!.id, 1, 'order-bump', 299)
  const after = totals(db, store.id, withBump)
  assert.equal(after.discountCents, 0, 'and $2.99 of shipping protection does not make it two')
  assert.equal(after.subtotalCents, 34_299)
})

test('a post-purchase offer will not charge for stock that is not there', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Stock', prompt: 'stock' })
  seedDefaultRegion(db, store.id, 'USD')
  const glove = createProduct(db, store.id, { title: 'Glove', status: 'published', variants: [{ title: '16oz', priceCents: 10_000, inventory: 5 }] })
  const extra = createProduct(db, store.id, { title: 'Wraps', status: 'published', variants: [{ title: 'One', priceCents: 2_000, inventory: 0 }] })
  const soldOut = extra.variants[0]!
  assert.equal(canReserve(db, soldOut.id, 1), false, 'the check the offer makes before it charges')

  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  const order = completeCart(db, store.id, cart.id, { email: 'b@example.com' })
  const line = { variantId: soldOut.id, productId: extra.id, title: 'Wraps', variantTitle: 'One', image: '', unitCents: 2_000, quantity: 1, source: 'post-purchase' }
  assert.throws(
    () => recordUpsell(db, store.id, order.id, { offered: soldOut.id, accepted: true, line, amountCents: 2_000 }),
    /out of stock/,
    'and the last line of defence if it slips through',
  )
  assert.equal(getVariant(db, store.id, soldOut.id)?.inventory, 0, 'nothing went negative')
})
