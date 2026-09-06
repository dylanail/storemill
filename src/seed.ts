import './lib/env.ts'
import { getDb } from './lib/db.ts'
import { logger } from './lib/log.ts'
import './agent/tools/index.ts'
import { register } from './control/auth.ts'
import { install } from './control/plugins.ts'
import { getStore, publish, updateStore } from './control/stores.ts'
import { addToCart, applyCode, createCart } from './domain/cart.ts'
import { listProducts } from './domain/catalog.ts'
import { completeCart, fulfillOrder } from './domain/orders.ts'
import { createReview, moderate } from './domain/reviews.ts'
import { createArticle, createBlog } from './domain/content.ts'
import { sessionFor, track } from './analytics/events.ts'
import { onboard } from './agent/onboarding.ts'
import { upsertBundle } from './domain/bundles.ts'
import { advertorialTemplate, checkoutTemplate, createPage, landingTemplate, productTemplate } from './pages/store.ts'
import { latestResearch } from './agent/research.ts'
import { updateProduct } from './domain/catalog.ts'
import { recordAdSpend } from './domain/ops.ts'
import { upsertFunnel } from './domain/funnels.ts'
import { generateVersions, setVersionWeight } from './pages/versions.ts'
import { suggestAvatars } from './agent/avatars.ts'
import { saveAnswers, setBuildMode } from './control/build.ts'
import { queuePhotoBriefs } from './creative/briefs.ts'
import { extractAngle, saveCompetitor } from './agent/angles.ts'
import { draftAds, saveInspiration } from './agent/ads.ts'
import { attachDomain } from './control/domains.ts'

const log = logger('seed')

const REVIEWS = [
  { rating: 5, author: 'Marisol A.', body: 'Four months of six-round sparring and the stitching has not moved. The leather has darkened where my knuckles sit, which I did not expect to like as much as I do.' },
  { rating: 5, author: 'Dev P.', body: 'My old gloves went soft at the wrist inside a year. These have not. The lace-up takes longer and it is worth it every single time.' },
  { rating: 4, author: 'Tomas R.', body: 'Break-in took about two weeks and was genuinely uncomfortable for the first few sessions. After that they are the best gloves I have owned.' },
  { rating: 5, author: 'Jian L.', body: 'The leather smells like a saddlery and the padding is firm rather than mushy. My partner has stopped complaining about my hooks.' },
  { rating: 4, author: 'Priya N.', body: 'Sizing runs true. I take 14oz for bag work and 16oz for sparring and both fit the same hand wrap without fighting me.' },
  { rating: 5, author: 'Owen B.', body: 'I asked about a repair and got a real answer from a person in two hours. That is worth the price on its own.' },
  { rating: 3, author: 'Kaz M.', body: 'Very good gloves, slow shipping. Fourteen days is what they say and fourteen days is what it was, but I wanted them sooner.' },
  { rating: 5, author: 'Elena V.', body: 'The custom stitching with my initials came out cleaner than the sample photo. Worth the extra wait.' },
]

const ORDERS = [
  { email: 'marisol@example.com', name: 'Marisol Aguilar', code: 'WELCOME10', quantities: [1, 2] },
  { email: 'dev@example.com', name: 'Dev Patel', code: '', quantities: [1] },
  { email: 'tomas@example.com', name: 'Tomas Rivera', code: '', quantities: [2, 1] },
  { email: 'jian@example.com', name: 'Jian Liu', code: 'WELCOME10', quantities: [1] },
  { email: 'priya@example.com', name: 'Priya Nair', code: '', quantities: [1, 1] },
  { email: 'owen@example.com', name: 'Owen Blake', code: '', quantities: [3] },
]

/**
 * Seeds one demo store the same way a real merchant gets one: through
 * onboarding, through the tool registry, through checkout. Nothing here writes
 * a row a customer could not have produced, which is why the dashboard numbers
 * on a fresh install are numbers you can trust.
 */
async function main() {
  const db = getDb()
  const email = process.env.SEED_EMAIL ?? 'you@example.com'
  const password = process.env.SEED_PASSWORD ?? 'change-me-please'

  const existing = db.one<{ id: string }>('SELECT id FROM users WHERE email = ?', email.toLowerCase())
  if (existing) {
    log.info(`${email} already exists — nothing to seed. Delete data/amboras.db to start over.`)
    return
  }

  const user = register(db, { email, password, name: process.env.SEED_NAME ?? 'Franz' })
  log.info(`created ${email}`)

  const result = await onboard(db, {
    ownerId: user.id,
    prompt:
      'A high-converting hand-stitched boxing gear store called Ironjaw & Co, in the style of a 1920s heritage leather atelier — ' +
      'sepia parchment tones, deep burgundy accents, vintage serif typography — built in Mexico City.',
  })
  const store = result.store
  log.info(`built ${store.name} (${result.summaries.length} steps, ${result.failures.length} failures)`)

  updateStore(db, store.id, { brand: { announcement: 'HAND-STITCHED IN MEXICO CITY · 14-DAY BUILD TIME · FREE FREIGHT OVER $200' } })

  const products = listProducts(db, store.id, { status: 'published', limit: 10 })
  const hero = products[0]

  install(db, store.id, 'exit-intent', { headline: 'Before you go', body: 'Take 10% off your first pair.', code: 'WELCOME10' })
  install(db, store.id, 'contact-form', {})

  const blog = createBlog(db, store.id, 'Journal')
  createArticle(db, store.id, blog.id, {
    title: 'Why we still lace',
    body:
      'A velcro cuff is faster and it is what most gyms hand you. It is also the first thing to fail, because the hook side fills with dust and sweat and stops holding after a season.\n\n' +
      'A lace-up cuff takes a partner and thirty seconds. In exchange it holds the wrist where you set it, for the life of the glove, and it can be replaced for the cost of a lace.\n\n' +
      'We sell both. We wear the laces.',
    status: 'published',
  })

  if (hero) {
    for (const review of REVIEWS) {
      const created = createReview(db, store.id, { productId: hero.id, rating: review.rating, author: review.author, body: review.body, verified: true })
      if (review.rating >= 4) moderate(db, store.id, created.id, 'approved')
    }
    log.info(`${REVIEWS.length} reviews on ${hero.title}`)
  }

  // Traffic first, so the funnel has denominators that make sense.
  for (let index = 0; index < 240; index++) {
    const session = sessionFor(db, store.id, { ip: `203.0.113.${index % 200}`, userAgent: `seed/${index % 7}` })
    track(db, store.id, session, 'view.page', { path: '/' })
    if (index % 2 === 0) {
      const product = products[index % Math.max(1, products.length)]
      track(db, store.id, session, 'view.product', { path: `/products/${product?.handle ?? ''}`, ...(product ? { productId: product.id } : {}) })
    }
    if (index % 5 === 0) track(db, store.id, session, 'cart.add', { path: '/cart' })
    if (index % 11 === 0) track(db, store.id, session, 'checkout.start', { path: '/checkout' })
  }

  for (const order of ORDERS) {
    const cart = createCart(db, store.id)
    order.quantities.forEach((quantity, index) => {
      const product = products[index % Math.max(1, products.length)]
      const variant = product?.variants[0]
      if (variant) addToCart(db, store.id, cart.id, variant.id, quantity)
    })
    if (order.code) applyCode(db, store.id, cart.id, order.code)
    const placed = completeCart(db, store.id, cart.id, {
      email: order.email,
      name: order.name,
      marketing: true,
      address: { name: order.name, line1: '12 Calle Regina', city: 'Mexico City', postal: '06080', country: 'MX' },
    })
    const session = sessionFor(db, store.id, { ip: `198.51.100.${placed.displayId % 250}`, userAgent: 'seed/checkout' })
    track(db, store.id, session, 'checkout.complete', { path: '/checkout', amountCents: placed.totalCents })
    if (placed.displayId % 2 === 0) fulfillOrder(db, store.id, placed.id, { provider: 'manual', tracking: `IJ${placed.displayId}MX` })
  }
  log.info(`${ORDERS.length} orders placed through the real checkout`)

  // Demo orders are then spread back across a fortnight. Everything above went
  // through the real checkout — this only moves the timestamps so the revenue
  // chart has a shape, rather than one spike on the day you installed it.
  const placedOrders = db.all<{ id: string }>('SELECT id FROM orders WHERE store_id = ? ORDER BY display_id', store.id)
  placedOrders.forEach((row, index) => {
    const at = new Date(Date.now() - (placedOrders.length - index) * 2 * 86400000).toISOString()
    db.run('UPDATE orders SET created_at = ?, updated_at = ? WHERE id = ?', at, at, row.id)
  })

  // A quantity-break bundle on the hero, with the wraps as the top-tier gift.
  const wraps = products[1]
  if (hero) {
    upsertBundle(db, store.id, {
      productId: hero.id,
      title: 'Bundle & save',
      tiers: [
        { quantity: 1, discountPercent: 0, label: 'One pair' },
        { quantity: 2, discountPercent: 15, label: 'Two pairs', badge: 'Most popular', freeShipping: true },
        { quantity: 3, discountPercent: 25, label: 'Three pairs', badge: 'Best value', freeShipping: true, ...(wraps?.variants[0] ? { giftVariantId: wraps.variants[0].id, giftLabel: `free ${wraps.title.replace(/^The /, '')}` } : {}) },
      ],
    })
    log.info(`bundle on ${hero.title}`)
  }

  // An advertorial and a landing page, from the templates, wired to the research.
  const research = latestResearch(db, store.id)
  const templateInput = {
    storeName: store.name,
    ...(hero ? { product: { id: hero.id, title: hero.title, image: hero.heroImage, subtitle: hero.subtitle } } : {}),
    research: research ? { triggers: research.triggers, objections: research.objections, comparison: research.comparison, competitors: research.competitors } : null,
  }
  createPage(db, store.id, { title: `5 reasons fighters are switching to ${hero?.title ?? store.name}`, handle: 'why-fighters-switch', kind: 'advertorial', blocks: advertorialTemplate(templateInput), status: 'published' })
  createPage(db, store.id, { title: `${hero?.title ?? store.name} — the offer`, handle: 'offer', kind: 'landing', blocks: landingTemplate(templateInput), status: 'published' })
  createPage(db, store.id, { title: `${hero?.title ?? store.name} — product page`, handle: 'product-page', kind: 'product', blocks: productTemplate(templateInput), status: 'published' })
  // The checkout as blocks: published, so /checkout runs through it and the buy flow is exercised on the block version.
  createPage(db, store.id, { title: `${store.name} — checkout`, handle: 'checkout', kind: 'checkout', role: 'checkout', blocks: checkoutTemplate(templateInput), status: 'published' })
  log.info('advertorial, landing, product and checkout pages built from the templates')

  // Supplier costs, the way a dropshipper would have them, so margins and
  // delivery estimates are real numbers rather than blanks.
  const costs = [8900, 600, 4200]
  products.forEach((product, index) => {
    updateProduct(db, store.id, product.id, {
      supplier: { name: 'Taller Regina (CDMX)', url: 'https://example.com/supplier', costCents: costs[index] ?? 2000, shippingCents: 1200, processingDays: 3, shippingDaysMin: 5, shippingDaysMax: 9 },
      ...(index === 0 ? { metadata: { sizeChart: 'Weight|Hand circumference|Best for\n12oz|17–19cm|Bag work\n14oz|19–21cm|Pads, light sparring\n16oz|21–23cm|Sparring\n18oz|23cm+|Heavy sparring' } } : {}),
    })
  })
  for (let day = 1; day <= 12; day++) {
    recordAdSpend(db, store.id, { day: new Date(Date.now() - day * 86400000).toISOString(), platform: day % 3 ? 'Meta' : 'TikTok', amountCents: 9000 + (day % 4) * 2500, note: 'Sparring glove — UGC creative' })
  }

  // Two product-page versions in a split test, and a funnel around the hero.
  if (hero) {
    const fresh = getStore(db, store.id) ?? store
    const [benefit, urgency] = await generateVersions(db, fresh, { productId: hero.id, kind: 'pdp', formats: ['benefit', 'urgency'], direction: 'for people who train seriously, focus on the repair guarantee', publish: true })
    if (benefit) setVersionWeight(db, store.id, benefit.id, 1)
    if (urgency) setVersionWeight(db, store.id, urgency.id, 1)
    const [advertorial] = await generateVersions(db, fresh, { productId: hero.id, kind: 'advertorial', formats: ['story'], direction: 'warm, first person, focus on the wrist', publish: true })
    upsertFunnel(db, store.id, {
      name: 'Sparring glove — cold traffic',
      productId: hero.id,
      advertorialPageId: advertorial?.id ?? '',
      offerPageId: db.one<{ id: string }>("SELECT id FROM pages WHERE store_id = ? AND handle = 'offer'", store.id)?.id ?? '',
      bump: { enabled: true, priceCents: 299 },
      upsell: { ...(wraps?.variants[0] ? { variantId: wraps.variants[0].id } : {}), discountPercent: 20, headline: 'Add the hand wraps to this order for 20% off?' },
      downsell: { ...(products[2]?.variants[0] ? { variantId: products[2].variants[0].id } : {}), discountPercent: 35, headline: 'How about the holdall instead, 35% off, just this once?' },
    })
    log.info('two pdp versions in a split test, a story advertorial, and a funnel with bump, upsell and downsell')

    // Avatars from the research, a competitor read for its angle, a swipe file, and ads written to the coach.
    const avatars = await suggestAvatars(db, store.id)
    setBuildMode(db, store.id, 'own-product')
    saveAnswers(db, store.id, { who: { value: 'Amateurs who spar twice a week and have been through two pairs of gym gloves' }, instinct: { value: 'control' }, tried: { unknown: true }, outcome: { unknown: true } })
    for (const product of listProducts(db, store.id, { limit: 1 })) queuePhotoBriefs(db, store.id, product)
    const coach = avatars.find((avatar) => /coach/i.test(avatar.name))
    saveCompetitor(db, store.id, {
      productId: hero.id,
      angle: {
        ...extractAngle(`<html><head><title>ProGlove Elite | FightCo</title><meta property="og:site_name" content="FightCo"><meta property="og:description" content="Designed for serious boxers who are tired of gloves that fall apart."></head><body>
          <h1>Stop replacing your gloves every six months</h1><h2>Why 12,000+ boxers switched</h2><h2>Tired of wrist pain after bag work?</h2>
          <ul><li>Triple-layer foam that keeps its shape</li><li>Genuine cowhide, hand stitched</li><li>Lace-up wrist lock</li></ul>
          <p>Only $89.00 <s>$149.00</s> — save 40% today. Free worldwide shipping. 90-day money-back guarantee. Rated 4.8/5 from 12,340 reviews.</p><button>Add to cart</button></body></html>`, 'https://fightco.example.com/products/proglove-elite'),
        take: 'Foam, not horsehair, and the "wrist lock" is velcro under the laces. Their guarantee is the thing to match.',
      },
    })
    saveInspiration(db, store.id, { source: 'paste', brand: 'FightCo', hook: 'Stop replacing your gloves every six months.', primaryText: 'Stop replacing your gloves every six months.\nTriple-layer foam. 90-day guarantee. Free shipping.', notes: 'Running since January. Problem-first, guarantee second.' })
    await draftAds(db, fresh, { productId: hero.id, platform: 'meta', formats: ['static', 'ugc-script', 'hooks'], direction: 'blunt, focus on the repair guarantee', ...(coach ? { avatarId: coach.id } : {}) })
    attachDomain(db, store.id, { hostname: 'ironjaw.co', mode: 'host', registrar: 'namecheap' })
    log.info(`${avatars.length} avatars, a competitor angle, a swipe file, three meta ads and a pending domain`)
  }

  publish(db, store.id)
  log.info(`published ${store.name}`)

  log.info('')
  log.info(`  sign in at http://localhost:${process.env.PORT ?? 4100}/login`)
  log.info(`  ${email} / ${password}`)
  log.info(`  storefront: http://localhost:${process.env.PORT ?? 4100}/s/${store.slug}`)
  log.info(`  advertorial: http://localhost:${process.env.PORT ?? 4100}/s/${store.slug}/pages/why-fighters-switch`)
}

await main()
