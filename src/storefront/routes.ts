import { cartDisplayLines } from '../domain/cart-prices.ts'
import { currentOfferStep, respondToOffer, offerReceipts } from '../domain/post-purchase.ts'
import { id } from '../lib/ids.ts'
import { metaEvent, type MetaEvent } from '../analytics/meta-browser.ts'
import type { ServerEventInput } from '../analytics/server-events.ts'
import { pageProductData } from '../pages/product-data.ts'
import { getDb } from '../lib/db.ts'
import { badRequest, escapeHtml, html, notFound, redirect, Raw, Router, setCookie, type Ctx } from '../lib/http.ts'
import { addToCart, applyCode, attachPaymentIntent, createCart, getCart, saveCheckoutDraft, setCartRegion, setQuantity, setShipping, totals } from '../domain/cart.ts'
import { convertCents, getRegion, defaultRegion, listRegions, regionForCountry, toBaseCents, type Region } from '../domain/regions.ts'
import { orderByPaymentIntent, recordUpsell, setPaymentStatus } from '../domain/orders.ts'
import { getPage, homePage, liveCheckoutPage, liveCartPage } from '../pages/store.ts'
import { completeStripeCart, paymentTotals } from '../payments/checkout.ts'
import { stripeFor, verifyWebhookSignature } from '../payments/stripe.ts'
import { upsertCustomer } from '../domain/customers.ts'
import { logger } from '../lib/log.ts'
import { id as visitorId } from '../lib/ids.ts'
import type { LineItem } from '../domain/types.ts'
import { askQuestion, requestStockAlert, trackingFor } from '../domain/ops.ts'
import { funnelEntry, funnelForProducts, pickFunnel, resolveBump, resolveOffer } from '../domain/funnels.ts'
import { privacyHtml, termsHtml } from './legal.ts'
import { BEHAVIOUR_EVENTS } from '../analytics/events.ts'
import { recordDownsell } from '../domain/orders.ts'
import { pickPdpVersion } from '../pages/versions.ts'
import { canReserve, getCollection, getProduct, getVariant, listCollections, listProducts } from '../domain/catalog.ts'
import { articleIsPublic, findArticle, listBlogs } from '../domain/content.ts'
import { CheckoutError, completeCart, getOrder } from '../domain/orders.ts'
import { createReview, listReviews, statsFor } from '../domain/reviews.ts'
import { environment, getStore, type Store } from '../control/stores.ts'
import { activeStorefrontConfig } from '../control/plugins.ts'
import { attributeOrder, captureAttribution, companionsFor, sessionFor as analyticsSession, track } from '../analytics/events.ts'
import { queueServerEvents } from '../analytics/server-events.ts'
import { orderContext, sendEmail } from '../email/send.ts'
import { findRedirect, llmsTxt, robots, sitemap } from '../seo/schema.ts'
import * as view from './render.ts'
import type { CheckoutInput, StoreView } from './render.ts'
import { atomFeed, rssFeed } from './feeds.ts'
import { syncOrderTracking } from '../shipping/seventeen-track.ts'

const CART_COOKIE = 'amboras_cart'
const cartCookie = (storeId: string, preview = false) => `${CART_COOKIE}_${preview ? 'preview_' : ''}${storeId}`
const REGION_COOKIE = 'amboras_region'
const VISITOR_COOKIE = 'amboras_v'
const log = logger('checkout')

function visitorFor(ctx: Ctx): string {
  const existing = ctx.cookies[VISITOR_COOKIE]
  if (existing) return existing
  const fresh = visitorId('v')
  ctx.cookies[VISITOR_COOKIE] = fresh
  setCookie(ctx.res, VISITOR_COOKIE, fresh, { maxAge: 60 * 60 * 24 * 365 })
  return fresh
}

/**
 * The storefront is served for a store resolved from the host (or from a
 * `/preview/:slug` path in development). `preview` is threaded all the way to
 * the plugin slots so pixels never fire against the admin's own iframe.
 */
export function storeViewFor(ctx: Ctx, store: Store, opts: { preview?: boolean } = {}): StoreView {
  const db = getDb()
  const env = environment(db, store.id, opts.preview ? (ctx.query.get('theme')==='live'?'live':'draft') : store.status === 'live' ? 'live' : 'draft')
  const branded = Object.keys(env.brand).length ? { ...store, brand: env.brand } : store
  const cartId = ctx.cookies[cartCookie(store.id, opts.preview)]
  const cart = cartId ? getCart(db, store.id, cartId) : null
  const regionCookie = ctx.cookies[`${REGION_COOKIE}_${store.id}`]
  const country = String(ctx.req.headers['cf-ipcountry'] ?? ctx.req.headers['x-vercel-ip-country'] ?? '')
  const regions = listRegions(db, store.id)
  const region = (cart?.regionId ? getRegion(db, store.id, cart.regionId) : null)
    ?? (regionCookie ? getRegion(db, store.id, regionCookie) : null)
    ?? (country ? regionForCountry(db, store.id, country) : null)
    ?? defaultRegion(db, store.id)
  const base = process.env.AMBORAS_STOREFRONT_HOST && !opts.preview ? '' : `${opts.preview ? '/preview' : '/s'}/${store.slug}`
  const pendingName='amboras_meta_'+store.id;let pending:MetaEvent[]=[];
  if(ctx.cookies[pendingName]){try{const parsed=JSON.parse(ctx.cookies[pendingName]!);if(parsed&&typeof parsed.id==='string'&&typeof parsed.name==='string')pending=[parsed];}catch{}setCookie(ctx.res,pendingName,'',{maxAge:0});}
  const fbclid=ctx.url.searchParams.get('fbclid');
  const advertising={eventId:id('pv'),url:ctx.url.origin+ctx.url.pathname,ip:ctx.ip,userAgent:String(ctx.req.headers['user-agent']||''),...(ctx.cookies._fbp?{fbp:ctx.cookies._fbp}:{}),...(ctx.cookies._fbc?{fbc:ctx.cookies._fbc}:fbclid?{fbc:'fb.1.'+Date.now()+'.'+fbclid}:{})};
  return {
    db,
    metaEvents:pending,
    ...(opts.preview?{}:{advertising}),
    store: branded,
    env,
    base,
    preview: opts.preview ?? false,
    cart: cart && !cart.orderId && Boolean(cart.checkout.preview) === Boolean(opts.preview) ? cart : null,
    totals: null,
    region,
    regions,
  }
}

function withTotals(current: StoreView): StoreView {
  const cart = current.cart ?? createCart(current.db, current.store.id, current.region?.id, { preview: current.preview })
  return { ...current, cart, totals: totals(current.db, current.store.id, cart) }
}

function ensureCart(ctx: Ctx, current: StoreView) {
  const cart = current.cart ?? createCart(current.db, current.store.id, current.region?.id, { preview: current.preview })
  if (!current.cart) {
    setCookie(ctx.res, cartCookie(current.store.id, current.preview), cart.id, { maxAge: 60 * 60 * 24 * 30 })
  }
  return cart
}

function record(ctx: Ctx, current: StoreView, type: Parameters<typeof track>[3], detail: Parameters<typeof track>[4] & { email?: string; phone?: string; externalId?: string; purchaseEventId?: string } = {}) {
  if (current.preview) return
  const referrer = String(ctx.req.headers.referer ?? '')
  const session = analyticsSession(current.db, current.store.id, {
    ip: ctx.ip,
    userAgent: String(ctx.req.headers['user-agent'] ?? ''),
    visitor: visitorFor(ctx),
    referrer,
    touch: captureAttribution(ctx.url, referrer),
  })
  const rawValue = detail.amountCents
  const analyticsValue = rawValue === undefined
    ? undefined
    : type === 'checkout.start' || type === 'checkout.complete'
      ? toBaseCents(rawValue, current.region, current.store.currency)
      : rawValue
  const eventId = track(current.db, current.store.id, session, type, {
    path: ctx.url.pathname, ...detail, ...(analyticsValue === undefined ? {} : { amountCents: analyticsValue }),
  })
  const valueCents = rawValue === undefined ? undefined : type === 'cart.add' ? convertCents(rawValue, current.region, current.store.currency) : rawValue
  const fbclid = ctx.url.searchParams.get('fbclid') ?? undefined
  const serverInput:ServerEventInput={
    eventId: type === 'checkout.complete' && detail.purchaseEventId ? detail.purchaseEventId : type==='view.page'&&current.advertising?current.advertising.eventId:eventId,
    type, url: ctx.url.origin+ctx.url.pathname, referrer, ip: ctx.ip, userAgent: String(ctx.req.headers['user-agent'] ?? ''),
    currency: current.totals?.currency ?? current.region?.currency ?? current.store.currency,
    ...(valueCents === undefined ? {} : { valueCents }),
    ...(detail.productId ? { productId: detail.productId } : {}),
    ...(detail.email ? { email: detail.email } : {}), ...(detail.phone ? { phone: detail.phone } : {}),
    ...(detail.externalId ? { externalId: detail.externalId } : {}),
    ...(ctx.cookies._fbp ? { fbp: ctx.cookies._fbp } : {}),
    ...(ctx.cookies._fbc ? { fbc: ctx.cookies._fbc } : fbclid ? { fbc: `fb.1.${Date.now()}.${fbclid}` } : {}),
    ...(ctx.cookies._ttp ? { ttp: ctx.cookies._ttp } : {}),
    ...(ctx.url.searchParams.get('ttclid') ? { ttclid: ctx.url.searchParams.get('ttclid') as string } : {}),
    // A webhook is a provider request, never evidence of the shopper's browser.
    ...(type==='checkout.complete'?(current.cart?.checkout.advertising||(/\/webhooks\//.test(ctx.url.pathname)?{url:ctx.url.origin+current.base+'/checkout',ip:'',userAgent:''}:{})):{}),
  };
  queueServerEvents(current.db,current.store.id,serverInput);
  const browser=metaEvent(serverInput);
  if(browser){(current.metaEvents||=[]).push(browser);if(ctx.req.method==='POST'&&!wantsJson(ctx))setCookie(ctx.res,'amboras_meta_'+current.store.id,JSON.stringify(browser),{maxAge:60});}
  return { sessionId: session, eventId }
}

export function storefrontRouter(resolve: (ctx: Ctx) => { store: Store; preview: boolean } | null): Router {
  const router = new Router()

  const open = (ctx: Ctx) => {
    const resolved = resolve(ctx)
    if (!resolved) throw notFound('No store at this address')
    return storeViewFor(ctx, resolved.store, { preview: resolved.preview })
  }

  router.get('/api/page-products/:id', (ctx) => {
    const current = open(ctx)
    const product = getProduct(current.db, current.store.id, ctx.params.id as string)
    if (!product || product.status !== 'published' && !(current.preview && product.status === 'draft') || product.metadata.hidden) throw notFound('No such product')
    return pageProductData(product, current.region?.currency ?? current.store.currency,
      value => convertCents(value, current.region, current.store.currency))
  })

  router.post('/localize', async (ctx) => {
    const current = open(ctx)
    const body = await ctx.body()
    const regionId = String(body.regionId ?? '')
    const region = getRegion(current.db, current.store.id, regionId)
    if (!region) throw badRequest('Unknown country or currency')
    setCookie(ctx.res, `${REGION_COOKIE}_${current.store.id}`, region.id, { maxAge: 60 * 60 * 24 * 365 })
    const cart = ensureCart(ctx, current)
    setCartRegion(current.db, current.store.id, cart.id, region.id)
    return redirect(`${current.base}${String(body.returnTo ?? '') || '/'}`)
  })

  router.get('/', (ctx) => {
    const current = withTotals(open(ctx))
    record(ctx, current, 'view.page')
    const custom = homePage(current.db, current.store.id, { preview: current.preview })
    if (custom) return html(custom.mode === 'html' ? view.htmlPage(current, custom) : view.blockPage(current, custom))
    const featured = listProducts(current.db, current.store.id, { status: 'published', limit: 6 })
    const collections = listCollections(current.db, current.store.id).filter((collection) => collection.productIds.length)
    return html(view.home(current, { featured, collections }))
  })

  router.get('/collections/:handle', (ctx) => {
    const current = withTotals(open(ctx))
    const handle = ctx.params.handle as string
    record(ctx, current, 'view.collection')
    if (handle === 'all') {
      const products = listProducts(current.db, current.store.id, { status: 'published', limit: 100 })
      return html(view.collectionPage(current, { title: 'Everything', description: `All ${products.length} products.` }, products))
    }
    const collection = getCollection(current.db, current.store.id, handle)
    if (!collection) throw notFound('No such collection')
    const products = listProducts(current.db, current.store.id, { status: 'published', collectionId: collection.id, limit: 100 })
    return html(view.collectionPage(current, collection, products))
  })

  router.get('/products/:handle', (ctx) => {
    const current = withTotals(open(ctx))
    const product = getProduct(current.db, current.store.id, ctx.params.handle as string)
    if (!product || (!current.preview && product.status !== 'published')) throw notFound('No such product')
    const visitor = current.preview ? '' : visitorFor(ctx)
    const version = ctx.query.get('version') ? getPage(current.db, current.store.id, ctx.query.get('version') as string) : pickPdpVersion(current.db, current.store.id, product, visitor)
    record(ctx, current, 'view.product', { productId: product.id, meta: { pageId: version?.id ?? 'default' } })
    if (version && version.productId === product.id) {
      if (version.mode === 'html') return html(view.htmlPage(current, version))
      return html(view.blockPage(current, version, {
        title: product.seo.title || `${product.title} — ${current.store.name}`,
        description: product.seo.description || product.subtitle || product.description.slice(0, 155),
        canonical: `${current.base}/products/${product.handle}`,
      }))
    }
    const imported = current.db.one<{ id: string }>(`SELECT id FROM pages WHERE store_id=? AND product_id=? AND role='pdp' AND mode='html' AND source_url<>'' ${current.preview ? '' : "AND status='published'"} ORDER BY updated_at DESC LIMIT 1`,current.store.id,product.id)
    if (imported) return html(view.htmlPage(current,getPage(current.db,current.store.id,imported.id)!))
    const stats = statsFor(current.db, current.store.id, product.id)
    const reviews = listReviews(current.db, current.store.id, { productId: product.id, status: 'approved', limit: 12 })
    const companions = companionsFor(current.db, current.store.id, product.id, 2)
      .map((productId) => getProduct(current.db, current.store.id, productId))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null && entry.status === 'published')
    return html(view.productPage(current, { product, stats, reviews, companions }))
  })

  router.post('/products/:handle/reviews', async (ctx) => {
    const current = open(ctx)
    const product = getProduct(current.db, current.store.id, ctx.params.handle as string)
    if (!product) throw notFound('No such product')
    const body = await ctx.body()
    createReview(current.db, current.store.id, {
      productId: product.id,
      rating: Number(body.rating ?? 5),
      body: String(body.body ?? ''),
      author: String(body.author ?? 'Anonymous'),
    })
    record(ctx, current, 'review.submit', { productId: product.id })
    return redirect(`${current.base}/products/${product.handle}#review`)
  })

  router.post('/products/:handle/questions', async (ctx) => {
    const current = open(ctx)
    const product = getProduct(current.db, current.store.id, ctx.params.handle as string)
    if (!product) throw notFound('No such product')
    const body = await ctx.body()
    if (String(body.question ?? '').trim().length < 4) return redirect(`${current.base}/products/${product.handle}`)
    askQuestion(current.db, current.store.id, { productId: product.id, question: String(body.question), asker: String(body.asker ?? ''), email: String(body.email ?? '') })
    return html(view.simplePage(current, 'Thanks for asking', '<p>We answer every question. If you left an email, the answer goes there too, and it appears on the page for the next person.</p>'))
  })

  router.post('/products/:handle/notify', async (ctx) => {
    const current = open(ctx)
    const product = getProduct(current.db, current.store.id, ctx.params.handle as string)
    if (!product) throw notFound('No such product')
    const body = await ctx.body()
    const email = String(body.email ?? '')
    if (email.includes('@')) requestStockAlert(current.db, current.store.id, String(body.variantId ?? product.variants[0]?.id ?? ''), email)
    return html(view.simplePage(current, 'You are on the list', '<p>One email when it is back. Nothing else.</p>'))
  })

  router.get('/search', (ctx) => {
    const current = withTotals(open(ctx))
    const query = (ctx.query.get('q') || '').trim().slice(0, 200)
    const products = query ? listProducts(current.db, current.store.id, { status: 'published', search: query, limit: 100 }) : []
    return html(view.searchPage(current, query, products))
  })

  router.get('/track', async (ctx) => {
    const current = withTotals(open(ctx))
    const number = (ctx.query.get('order') || ctx.query.get('number'))?.replace('#', '').trim() ?? ''
    const email = ctx.query.get('email')?.trim().toLowerCase() ?? ''
    const related = listProducts(current.db, current.store.id, { status: 'published', limit: 3 })
    if (!number) return html(view.trackPage(current, { related }))
    const order = getOrder(current.db, current.store.id, number)
    const byOwnId = !!order && order.id === number
    if (!order || (email ? order.email !== email : !byOwnId && !current.preview)) {
      return html(view.trackPage(current, { error: 'No order matches that number and email.', related, number }))
    }
    const snapshot = await syncOrderTracking(current.db, current.store.id, order)
    return html(view.trackPage(current, { tracking: trackingFor(current.db, current.store.id, order, snapshot), related }))
  })

  router.get('/cart/state', (ctx) => {
    const current = open(ctx)
    const cart = ensureCart(ctx, current)
    return cartState({ ...current, cart })
  })

  router.post('/cart/add', async (ctx) => {
    const current = open(ctx)
    const cart = ensureCart(ctx, current)
    const body = await ctx.body()
    const variantId = String(body.variantId ?? '')
    const quantity = cartQuantity(body.quantity, 1)
    const extras = [...new Set(Array.isArray(body.additionalVariantIds) ? body.additionalVariantIds.map(String) : [])].filter(id => id !== variantId).slice(0, 10)
    for (const id of extras) {
      const variant = getVariant(current.db, current.store.id, id), product = variant ? getProduct(current.db, current.store.id, variant.productId) : null
      if (!variant || !product || product.status !== 'published' && !(current.preview && product.status === 'draft') || !canReserve(current.db, id, 1)) throw badRequest('A selected cart add-on is not available')
    }
    const updated = current.db.tx(() => {
      let result = addToCart(current.db, current.store.id, cart.id, variantId, quantity, body.source ? String(body.source) : undefined)
      for (const id of extras) if (!result.items.some(item => item.variantId === id)) result = addToCart(current.db, current.store.id, cart.id, id, 1, 'cart-upsell')
      return result
    })
    const line = updated.items.find((item) => item.variantId === variantId)
    record(ctx, current, 'cart.add', { productId: line?.productId, amountCents: (line?.unitCents ?? 0) * quantity })
    if (wantsJson(ctx)) return cartState({ ...current, cart: updated })
    return redirect(`${current.base}/${current.store.kind === 'funnel' ? 'checkout' : 'cart'}`)
  })

  router.post('/cart/update', async (ctx) => {
    const current = open(ctx)
    const cart = ensureCart(ctx, current)
    const body = await ctx.body()
    const updated = setQuantity(current.db, current.store.id, cart.id, String(body.variantId ?? ''), cartQuantity(body.quantity, 0))
    if (wantsJson(ctx)) return cartState({ ...current, cart: updated })
    return redirect(`${current.base}/cart`)
  })

  router.post('/cart/code', async (ctx) => {
    const current = open(ctx)
    const cart = ensureCart(ctx, current)
    const body = await ctx.body()
    const updated = applyCode(current.db, current.store.id, cart.id, String(body.code ?? ''))
    if (wantsJson(ctx)) return cartState({ ...current, cart: updated })
    return redirect(`${current.base}/cart`)
  })

  router.get('/cart', (ctx) => {
    const resumed = ctx.query.get('resume')
    let current = open(ctx)
    if (current.store.kind === 'funnel') return redirect(`${current.base}/checkout`)
    if (resumed) {
      const cart = getCart(current.db, current.store.id, resumed)
      if (cart && !cart.orderId && Boolean(cart.checkout.preview) === current.preview) {
        setCookie(ctx.res, cartCookie(current.store.id, current.preview), cart.id, { maxAge: 60 * 60 * 24 * 30 })
        current = { ...current, cart }
      }
    }
    const cart = ensureCart(ctx, current)
    current = withTotals({ ...current, cart })
    const custom = liveCartPage(current.db, current.store.id, { preview: current.preview })
    return html(custom?.mode === 'html' ? view.htmlPage(current, custom) : custom ? view.blockPage(current, custom) : view.cartPage(current, current.totals!))
  })

  router.get('/checkout', (ctx) => {
    const opened = open(ctx)
    const current = withTotals({ ...opened, cart: ensureCart(ctx, opened) })
    if (!current.cart?.items.length && current.store.kind !== 'funnel') return redirect(`${current.base}/cart`)
    record(ctx, current, 'checkout.start', { amountCents: current.totals?.totalCents ?? 0 })
    return html(renderCheckout(current, checkoutInputFor(current)))
  })

  /** The no-provider path is never available after Stripe is connected. */
  router.post('/checkout', async (ctx) => {
    const opened = open(ctx)
    const current = withTotals({ ...opened, cart: ensureCart(ctx, opened) })
    const cart = current.cart
    if (!cart) return redirect(`${current.base}/cart`)
    if (current.preview) return html(renderCheckout(current, checkoutInputFor(current, { error: 'Preview checkout: no payment or order is created.' })), 409)
    if (stripeFor(current.db, current.store.id)) {
      return html(renderCheckout(current, checkoutInputFor(current, { error: 'Payment could not start. Reload the page and try again — nothing has been charged.' })), 409)
    }
    const body = await ctx.body()
    const draft = readCheckoutForm(body)
    if (body.shippingOptionId) setShipping(current.db, current.store.id, cart.id, String(body.shippingOptionId))
    if (body.bumpVariantId && !cart.items.some((item) => item.variantId === body.bumpVariantId)) {
      const bump = checkoutInputFor(current).bump
      if (!bump || bump.variantId !== String(body.bumpVariantId)) throw badRequest('That order add-on is not available')
      const priced = bump && bump.variantId === String(body.bumpVariantId) ? bump.priceCents : undefined
      addToCart(current.db, current.store.id, cart.id, String(body.bumpVariantId), 1, 'order-bump', priced)
    }
    try {
      const order = completeCart(current.db, current.store.id, cart.id, {
        email: draft.email ?? '',
        ...(draft.name ? { name: draft.name } : {}),
        ...(draft.address ? { address: draft.address } : {}),
        marketing: draft.marketing ?? false,
        payment: { provider: 'demo', status: 'captured' },
      })
      afterOrder(ctx, current, order)
      return redirect(`${current.base}/orders/${order.id}/offer`)
    } catch (error) {
      if (error instanceof CheckoutError) {
        saveCheckoutDraft(current.db, current.store.id, cart.id, draft)
        const refreshed = withTotals({ ...current, cart: getCart(current.db, current.store.id, cart.id) })
        return html(renderCheckout(refreshed, checkoutInputFor(refreshed, { stripe: null, error: error.message })), 400)
      }
      throw error
    }
  })

  router.get('/orders/:id', (ctx) => {
    const current = withTotals(open(ctx))
    const order = getOrder(current.db, current.store.id, ctx.params.id as string)
    if (!order) throw notFound('No such order')
    const inOrder = new Set(order.items.map((item) => item.productId))
    const related = listProducts(current.db, current.store.id, { status: 'published', limit: 6 }).filter((product) => !inOrder.has(product.id)).slice(0, 3)
    return html(view.orderPage(current, order, related))
  })

  router.post('/subscribe', async (ctx) => {
    const current = open(ctx)
    const body = await ctx.body()
    const email = String(body.email ?? '')
    if (!email.includes('@')) throw badRequest('Enter a valid email address')
    const { upsertCustomer } = await import('../domain/customers.ts')
    upsertCustomer(current.db, current.store.id, { email, marketing: true })
    record(ctx, current, 'signup')
    return html(view.simplePage(current, 'You are on the list', '<p>One email when there is something to say. Nothing else.</p>'))
  })

  router.get('/blogs/:blog', (ctx) => {
    const current = withTotals(open(ctx))
    const blog = listBlogs(current.db, current.store.id).find((entry) => entry.handle === ctx.params.blog)
    if (!blog) throw notFound('No such blog')
    const published = blog.articles.filter((article) => articleIsPublic(article))
    return html(
      view.simplePage(
        current,
        blog.title,
        (published.length
          ? published
              .map(
                (article) =>
                  `<article style="margin-bottom:2rem"><h3><a href="${current.base}/blogs/${blog.handle}/${article.handle}">${escapeHtml(article.title)}</a></h3>
                   <p class="micro">${escapeHtml(article.publishedAt?.slice(0, 10) ?? '')}</p><p>${escapeHtml(article.excerpt)}</p></article>`,
              )
              .join('')
          : '<p>Nothing published yet.</p>') +
          `<p class="micro"><a href="${current.base}/blogs/${blog.handle}/rss.xml">RSS</a> · <a href="${current.base}/blogs/${blog.handle}/atom.xml">Atom</a></p>`,
      ),
    )
  })

  router.get('/blogs/:blog/rss.xml', (ctx) => {
    const current = open(ctx)
    const blog = listBlogs(current.db, current.store.id).find((entry) => entry.handle === ctx.params.blog)
    if (!blog) throw notFound('No such blog')
    return new Raw(rssFeed({ blog, storeName: current.store.name, storefrontUrl: `${ctx.url.origin}${current.base}` }), 'application/rss+xml; charset=utf-8', { 'Cache-Control': 'public, max-age=300' })
  })

  router.get('/blogs/:blog/atom.xml', (ctx) => {
    const current = open(ctx)
    const blog = listBlogs(current.db, current.store.id).find((entry) => entry.handle === ctx.params.blog)
    if (!blog) throw notFound('No such blog')
    return new Raw(atomFeed({ blog, storeName: current.store.name, storefrontUrl: `${ctx.url.origin}${current.base}` }), 'application/atom+xml; charset=utf-8', { 'Cache-Control': 'public, max-age=300' })
  })

  router.get('/blogs/:blog/:article', (ctx) => {
    const current = withTotals(open(ctx))
    const found = findArticle(current.db, current.store.id, ctx.params.blog as string, ctx.params.article as string)
    if (!found) throw notFound('No such article')
    record(ctx, current, 'view.page')
    return html(
      view.simplePage(
        current,
        found.article.title,
        found.article.body
          .split(/\n{2,}/)
          .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
          .join(''),
      ),
    )
  })

  router.get('/pages/:slug', (ctx) => {
    const current = withTotals(open(ctx))
    const slug = ctx.params.slug as string
    const built = getPage(current.db, current.store.id, slug)
    if (built && (built.status === 'published' || current.preview)) {
      record(ctx, current, 'view.page')
      if (built.role === 'checkout') {
        // The checkout page at its own address: the visitor's cart if there is one, a sample line otherwise, so the editor preview is never blank.
        const sample = !current.cart?.items.length
        if (sample && !current.preview && current.store.kind !== 'funnel') return redirect(`${current.base}/cart`)
        // Direct funnel checkout must persist its empty cart for package selection.
        if (current.store.kind === 'funnel' && current.cart) setCookie(ctx.res, cartCookie(current.store.id, current.preview), current.cart.id, { maxAge: 60 * 60 * 24 * 30 })
        record(ctx,current,'checkout.start',{amountCents:current.totals?.totalCents||0});
        const shown = sample && current.store.kind !== 'funnel' ? withSampleCart(current) : current
        return html(built.mode === 'html' ? view.htmlPage(shown, built, checkoutInputFor(shown)) : view.checkoutBlockPage(shown, built, checkoutInputFor(shown), { sample }))
      }
      return html(built.mode === 'html' ? view.htmlPage(current, built) : view.blockPage(current, built))
    }
    const copy: Record<string, string> = {
      about: `<p>${escapeHtml(current.store.brand.description ?? '')}</p><p>${escapeHtml(current.store.brand.voice ?? '')}</p>`,
      privacy: privacyHtml(current.db, current.store),
      terms: termsHtml(current.db, current.store),
      shipping:
        '<p>Everything is built to order. Stock builds ship in fourteen days; custom work takes about three weeks.</p>' +
        '<p>Free shipping over 200. Returns are free for thirty days as long as the item has not been used in a fight.</p>',
    }
    if (!copy[slug]) throw notFound('No such page')
    const titles: Record<string, string> = { about: 'About', shipping: 'Shipping & returns', privacy: 'Privacy policy', terms: 'Terms of sale' }
    return html(view.simplePage(current, titles[slug] ?? slug, copy[slug]))
  })

  /* The page reports what happened on it: scroll depth, sections seen, buttons pressed, popup and quiz events. Preview traffic is dropped. */
  router.post('/_t', async (ctx) => {
    const current = open(ctx)
    if (current.preview) return undefined
    const body = await ctx.body()
    const events = Array.isArray(body.e) ? (body.e as Array<{ t?: string; m?: Record<string, unknown> }>).slice(0, 40) : []
    const path = typeof body.p === 'string' ? body.p.slice(0, 200) : ctx.url.pathname
    for (const event of events) {
      const type = String(event.t ?? '') as (typeof BEHAVIOUR_EVENTS)[number]
      if (!BEHAVIOUR_EVENTS.includes(type)) continue
      const meta = event.m && typeof event.m === 'object' ? Object.fromEntries(Object.entries(event.m).slice(0, 8).map(([key, value]) => [key.slice(0, 32), typeof value === 'string' ? value.slice(0, 120) : typeof value === 'number' ? value : String(value).slice(0, 120)])) : {}
      record(ctx, current, type, { path, meta })
    }
    return undefined
  })

  /* A funnel split test starts here: the visitor is assigned a funnel by weight and sent to its first page. */
  router.get('/go/:group', (ctx) => {
    const current = open(ctx)
    const group = ctx.params.group as string
    const visitor = current.preview ? `preview-${Date.now()}` : visitorFor(ctx)
    const sessionId = current.preview ? visitor : analyticsSession(current.db, current.store.id, { ip: ctx.ip, userAgent: String(ctx.req.headers['user-agent'] ?? ''), visitor, referrer: String(ctx.req.headers.referer ?? '') })
    const funnel = pickFunnel(current.db, current.store.id, group, visitor)
    if (!funnel) throw notFound('No funnel is running under that name')
    if (!current.preview) track(current.db, current.store.id, sessionId, 'funnel.enter', { path: ctx.url.pathname, meta: { funnelId: funnel.id, group } })
    return redirect(`${current.base}${funnelEntry(current.db, current.store.id, funnel)}`)
  })

  router.post('/contact', async (ctx) => {
    const current = open(ctx)
    const body = await ctx.body()
    const email = String(body.email ?? '')
    if (email.includes('@')) upsertCustomer(current.db, current.store.id, { email, name: String(body.name ?? '') })
    const { recordAudit } = await import('../control/todos.ts')
    recordAudit(current.db, { storeId: current.store.id, actorType: 'system', action: 'contact_form', target: email, diff: { message: String(body.message ?? '').slice(0, 2000) } })
    return html(view.simplePage(current, 'Thanks', '<p>A person will read that and reply.</p>'))
  })

  /* ------------------------------------------------------------- checkout */

  /** A funnel changes its main package in checkout. Prices and gifts always come from this catalog. */
  router.post('/checkout/selection', async (ctx) => {
    const current = open(ctx)
    if (current.store.kind !== 'funnel') throw badRequest('Change store items in the cart')
    const body = await ctx.body()
    const variantId = String(body.variantId ?? '')
    const quantity = Number(body.quantity)
    const variant = getVariant(current.db, current.store.id, variantId)
    const product = variant ? getProduct(current.db, current.store.id, variant.productId) : null
    if (!variant || !product || product.status !== 'published' && !(current.preview && product.status === 'draft') || product.metadata.hidden) throw badRequest('Choose an available package')
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999 || !canReserve(current.db, variantId, quantity)) throw badRequest('That package quantity is not available')
    const cart = ensureCart(ctx, current)
    if (cart.paymentIntentId) {
      const stripe = stripeFor(current.db, current.store.id)
      if (!stripe) throw badRequest('Payment settings changed. Reload checkout before changing your package')
      const intent = await stripe.client.paymentIntents.retrieve(cart.paymentIntentId)
      if (['processing', 'succeeded', 'requires_capture'].includes(intent.status)) throw badRequest('Your payment is in progress. Wait for confirmation before changing your package')
      if (intent.status !== 'canceled') {
        const canceled = await stripe.client.paymentIntents.cancel(intent.id)
        if (canceled.status !== 'canceled') throw badRequest('Payment could not be reset. Your package has not changed')
      }
    }
    current.db.tx(() => {
      const latest = getCart(current.db, current.store.id, cart.id)
      // Stripe I/O yields to other requests and webhook completion. Never overwrite their order/payment.
      if (!latest || latest.orderId || latest.paymentIntentId !== cart.paymentIntentId || latest.updatedAt !== cart.updatedAt || JSON.stringify(latest.items) !== JSON.stringify(cart.items)) throw badRequest('Your order changed while updating this package. Reload checkout to review it')
      // Preserve contact details, shipping and discount code; replace the explicit main order choice.
      current.db.update('carts', cart.id, { items: [], payment_intent_id: '' })
      addToCart(current.db, current.store.id, cart.id, variantId, quantity, 'funnel-checkout')
    })
    const updated = getCart(current.db, current.store.id, cart.id)!
    const amounts = paymentTotals(current.db, current.store.id, updated)
    const shown = { ...current, cart: updated, totals: amounts }
    const parts = view.checkoutParts(shown, checkoutInputFor(shown))
    return { ok: true, ...amounts, variantId, quantity, summaryHtml: parts.summary, bumpHtml:parts.bump, totalsHtml: view.totalsBlock(shown, amounts) }
  })

  /** Buy now: a fresh cart with this line, straight to checkout. */
  router.post('/checkout/buy', async (ctx) => {
    const current = open(ctx)
    const body = await ctx.body()
    const cart = createCart(current.db, current.store.id, current.region?.id, { preview: current.preview })
    setCookie(ctx.res, cartCookie(current.store.id, current.preview), cart.id, { maxAge: 60 * 60 * 24 * 30 })
    addToCart(current.db, current.store.id, cart.id, String(body.variantId ?? ''), cartQuantity(body.quantity, 1), 'buy-now')
    const line = getCart(current.db, current.store.id, cart.id)?.items[0]
    record(ctx, current, 'cart.add', { ...(line ? { productId: line.productId } : {}), amountCents: (line?.unitCents ?? 0) * (line?.quantity ?? 1) })
    if (wantsJson(ctx)) return { ok: true, metaEvents:current.preview?[]:current.metaEvents||[], checkoutUrl: `${current.base}/checkout` }
    return redirect(`${current.base}/checkout`)
  })

  /** The order bump: one checkbox, one line in the cart. */
  router.post('/checkout/bump', async (ctx) => {
    const current = open(ctx)
    const cart = ensureCart(ctx, current)
    const body = await ctx.body()
    const variantId = String(body.variantId ?? '')
    const bump = configuredBump({ ...current, cart })
    if (!cart.items.length || !bump || bump.variantId !== variantId) throw badRequest('That order add-on is not available')
    const priced = bump.priceCents
    const updated = body.on ? addToCart(current.db, current.store.id, cart.id, variantId, 1, 'order-bump', priced) : setQuantity(current.db, current.store.id, cart.id, variantId, 0)
    const amounts = totals(current.db, current.store.id, updated)
    return { ...amounts, totalsHtml: view.totalsBlock({ ...current, cart: updated, totals: amounts }, amounts) }
  })

  router.post('/checkout/shipping', async (ctx) => {
    const current = open(ctx)
    const cart = ensureCart(ctx, current)
    const body = await ctx.body()
    const updated = setShipping(current.db, current.store.id, cart.id, String(body.shippingOptionId ?? ''))
    const amounts = totals(current.db, current.store.id, updated)
    return { ...amounts, totalsHtml: view.totalsBlock({ ...current, cart: updated, totals: amounts }, amounts) }
  })

  /** Saves the contact and address before Stripe confirms, so the order can be written when the payment returns. */
  router.post('/checkout/prepare', async (ctx) => {
    const current = open(ctx)
    const cart = ensureCart(ctx, current)
    const body = await ctx.body()
    const draft = readCheckoutForm(body)
    if (!cart.items.length) return { ok: false, error: 'Choose a package before continuing to payment' }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email ?? '')) return { ok: false, error: 'Enter a valid email address' }
    if (!draft.address?.line1 || !draft.address.city || !draft.address.postal) return { ok: false, error: 'Fill in the delivery address' }
    const advertising = !current.preview && current.advertising ? {
      url: ctx.url.origin + current.base + '/checkout',
      ip: current.advertising.ip || '', userAgent: current.advertising.userAgent || '',
      ...(current.advertising.fbp ? { fbp: current.advertising.fbp } : {}),
      ...(current.advertising.fbc ? { fbc: current.advertising.fbc } : {}),
      ...(ctx.cookies._ttp ? { ttp: ctx.cookies._ttp } : {}),
      ...(ctx.query.get('ttclid') ? { ttclid: ctx.query.get('ttclid')! } : {}),
    } : undefined
    saveCheckoutDraft(current.db, current.store.id, cart.id, { ...draft, ...(advertising ? { advertising } : {}) })
    if (body.shippingOptionId) setShipping(current.db, current.store.id, cart.id, String(body.shippingOptionId))
    return { ok: true }
  })

  /** A PaymentIntent for the cart as it stands. Re-used if the amount has not moved. */
  router.post('/checkout/intent', async (ctx) => {
    const current = open(ctx)
    if (current.preview) throw badRequest('Preview checkout cannot create a payment')
    const cart = ensureCart(ctx, current)
    const stripe = stripeFor(current.db, current.store.id)
    if (cart.checkout.preview) throw badRequest('Preview checkout cannot create a payment')
    if (!stripe) return { error: 'No payment provider is connected' }
    if (stripe.config.captureMode === 'manual') return { error: 'Manual capture is not supported by this checkout. Select Automatic capture in Payments before accepting orders. No payment has been started.' }
    if (!cart.items.length || cart.items.some(item => !Number.isInteger(item.quantity) || item.quantity < 1 || !canReserve(current.db, item.variantId, item.quantity))) return { error: 'Some items are no longer available. Review your cart.' }
    const amounts = paymentTotals(current.db, current.store.id, cart)
    if (amounts.totalCents <= 0) return { error: 'This cart does not require a card payment.' }
    const draft = cart.checkout
    try {
      const reusableStatuses = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action'])
      const started = cart.paymentIntentId ? await stripe.client.paymentIntents.retrieve(cart.paymentIntentId).catch(() => null) : null
      if (started && ['processing', 'succeeded', 'requires_capture'].includes(started.status)) return { error: 'This cart already has a payment in progress. Wait for confirmation before trying again.' }
      const reusable = started && reusableStatuses.has(started.status) && started.currency.toLowerCase() === amounts.currency.toLowerCase() ? started : null
      let customerId = reusable?.customer ?? ''
      if (!customerId && draft.email && stripe.config.captureMode !== 'manual') {
        customerId = (await stripe.client.customers.create({ email: draft.email, ...(draft.name ? { name: draft.name } : {}) })).id
      }
      const intent = reusable
        ? await stripe.client.paymentIntents.update(reusable.id, {
            amountCents: amounts.totalCents,
            ...(customerId && !reusable.customer ? { customerId, saveForLater: true } : {}),
            ...(draft.email ? { receiptEmail: draft.email } : {}),
          })
        : await stripe.client.paymentIntents.create({
            amountCents: amounts.totalCents,
            currency: amounts.currency,
            ...(customerId ? { customerId } : {}),
            saveForLater: Boolean(customerId),
            ...(draft.email ? { receiptEmail: draft.email } : {}),
            metadata: { storeId: current.store.id, cartId: cart.id },
            idempotencyKey: `checkout:${cart.id}:${cart.updatedAt}:${amounts.currency}:${amounts.totalCents}`,
          })
      attachPaymentIntent(current.db, current.store.id, cart.id, intent.id)
      return { clientSecret: intent.client_secret, intentId: intent.id, publishableKey: stripe.config.publishableKey }
    } catch (error) {
      log.warn(`intent failed: ${error instanceof Error ? error.message : String(error)}`)
      return { error: error instanceof Error ? error.message : 'Could not start the payment' }
    }
  })

  /** Stripe returns here. The order is written only once the intent reports success. */
  router.get('/checkout/complete', async (ctx) => {
    const current = withTotals(open(ctx))
    const cart = getCart(current.db, current.store.id, ctx.cookies[cartCookie(current.store.id, current.preview)] || '') || current.cart
    const stripe = stripeFor(current.db, current.store.id)
    if (current.preview) throw badRequest('Preview checkout cannot complete a payment')
    const intentId = ctx.query.get('payment_intent') ?? cart?.paymentIntentId ?? ''
    if (!cart || !stripe || !intentId) return redirect(`${current.base}/checkout`)
    if (intentId !== cart.paymentIntentId) throw badRequest('This payment does not belong to your cart')
    const intent = await stripe.client.paymentIntents.retrieve(intentId)
    try {
      const result = completeStripeCart(current.db, current.store.id, cart, intent)
      if (result.created) afterOrder(ctx, current, result.order)
      return redirect(`${current.base}/orders/${result.order.id}/offer`)
    } catch (error) {
      if (error instanceof CheckoutError) return html(renderCheckout(current, checkoutInputFor(current, { error: error.message })), intent.status === 'processing' ? 202 : 400)
      throw error
    }
  })

  /** Stripe's second opinion: a refund or dispute moves the order; a success we already wrote is ignored. */
  router.post('/webhooks/stripe', async (ctx) => {
    const current = open(ctx)
    const stripe = stripeFor(current.db, current.store.id)
    if (!stripe) throw notFound('No Stripe on this store')
    const payload = (await ctx.raw()).toString('utf8')
    const signature = String(ctx.req.headers['stripe-signature'] ?? '')
    if (!stripe.config.webhookSecret || !verifyWebhookSignature(payload, signature, stripe.config.webhookSecret)) throw badRequest('Bad signature')
    const event = JSON.parse(payload) as { type: string; data: { object: { id: string; payment_intent?: string; amount_refunded?: number; amount?: number } } }
    const intentId = event.data.object.payment_intent ?? event.data.object.id
    let order = orderByPaymentIntent(current.db, current.store.id, intentId)
    if (!order && event.type === 'payment_intent.succeeded') {
      const intent = await stripe.client.paymentIntents.retrieve(intentId)
      const cartId = intent.metadata?.storeId === current.store.id ? intent.metadata.cartId : ''
      const cart = cartId ? getCart(current.db, current.store.id, cartId) : null
      if (cart) {
        const result = completeStripeCart(current.db, current.store.id, cart, intent)
        order = result.order
        if (result.created) afterOrder(ctx, { ...current, cart, totals: paymentTotals(current.db, current.store.id, cart) }, order, { clearCart: false })
      }
    }
    if (order) {
      if (event.type === 'charge.refunded') {
        const refunded = event.data.object.amount_refunded ?? 0
        setPaymentStatus(current.db, current.store.id, order.id, refunded >= order.totalCents ? 'refunded' : 'partially_refunded')
      }
      if (event.type === 'payment_intent.succeeded' && order.paymentStatus === 'awaiting') setPaymentStatus(current.db, current.store.id, order.id, 'captured')
    }
    return { received: true, matched: Boolean(order) }
  })

  /** The one-click offer after payment. Shown once; declined or accepted, never again. Declined → the downsell, once. */
  router.get('/orders/:id/offer', (ctx) => {
    const current = withTotals(open(ctx))
    const order = getOrder(current.db, current.store.id, ctx.params.id as string)
    if (!order) throw notFound('No such order')
    const copiedFlow=funnelForProducts(current.db,current.store.id,order.items.map(item=>item.productId))
    if(copiedFlow?.steps.some(step=>step.offer?.enabled)){
      const step=currentOfferStep(current.db,current.store.id,order,copiedFlow)
      if(!step)return redirect(`${current.base}/orders/${order.id}`)
      const offer=resolveOffer(current.db,current.store.id,step.offer,()=>null,0)
      if(!offer)return redirect(`${current.base}/orders/${order.id}`)
      const pending=offerReceipts(current.db,current.store.id,order.id).find(row=>row.page_id===step.pageId&&row.status==='pending')
      if(pending){const quote=JSON.parse(pending.quote),variant=offer.product.variants.find(v=>v.id===quote.lines[0]?.variantId);if(variant){offer.variantId=variant.id;offer.priceCents=quote.baseAmountCents;offer.discountPercent=0;offer.pending=true;offer.product={...offer.product,variants:[{...variant,priceCents:quote.baseAmountCents}]}}}
      return html(view.offerPage({...current,region:regionForOrder(current,order.id)},order,offer,step.role==='downsell'?'downsell':'upsell',`${current.base}/orders/${order.id}/steps/${step.pageId}`))
    }
    if (order.upsell.offered) return redirect(`${current.base}/orders/${order.id}${order.upsell.accepted || order.downsell.offered ? '' : '/downsell'}`)
    const funnel = funnelForProducts(current.db, current.store.id, order.items.map((item) => item.productId))
    const offer = resolveOffer(current.db, current.store.id, funnel?.upsell, () => { const picked = pickOffer(current, order); return picked ? { product: picked.product, variantId: picked.variantId } : null }, 20)
    if (!offer) return redirect(`${current.base}/orders/${order.id}`)
    return html(view.offerPage({ ...current, region: regionForOrder(current, order.id) }, order, offer, 'upsell'))
  })

  router.post('/orders/:id/steps/:pageId',async ctx=>{
    const current=open(ctx),order=getOrder(current.db,current.store.id,ctx.params.id!)
    if(!order)throw notFound('No such order')
    const funnel=funnelForProducts(current.db,current.store.id,order.items.map(item=>item.productId))
    if(!funnel)throw notFound('No such funnel')
    const body=await ctx.body(),region=regionForOrder(current,order.id)
    try{
      const result=await respondToOffer(current.db,current.store.id,order.id,funnel,{pageId:ctx.params.pageId!,accept:body.accept==='yes',variantId:String(body.variantId||'')},amount=>convertCents(amount,region,current.store.currency),(quote,key)=>chargeSaved(current,order,quote.amountCents,{offerStep:ctx.params.pageId!},key))
      if(result==='accepted'){const receipt=offerReceipts(current.db,current.store.id,order.id).find(row=>row.page_id===ctx.params.pageId)!;record(ctx,{...current,region},'checkout.complete',{amountCents:JSON.parse(receipt.quote).amountCents,meta:{offerStep:ctx.params.pageId}})}
      return redirect(`${current.base}/orders/${order.id}/offer${result==='pending'?'?offer=pending':result==='failed'?'?offer=failed':''}`)
    }catch(error){return html(`<p>${escapeHtml(error instanceof Error?error.message:'Could not update this order')}</p><a href="${current.base}/orders/${order.id}/offer">Return to your offer</a>`,400)}
  })

  router.get('/orders/:id/downsell', (ctx) => {
    const current = withTotals(open(ctx))
    const order = getOrder(current.db, current.store.id, ctx.params.id as string)
    if (!order) throw notFound('No such order')
    if (order.downsell.offered || order.upsell.accepted) return redirect(`${current.base}/orders/${order.id}`)
    const funnel = funnelForProducts(current.db, current.store.id, order.items.map((item) => item.productId))
    if (!funnel?.downsell || (!funnel.downsell.variantId && !funnel.downsell.discountPercent)) return redirect(`${current.base}/orders/${order.id}`)
    const offer = resolveOffer(current.db, current.store.id, funnel.downsell, () => { const picked = pickOffer(current, order); return picked ? { product: picked.product, variantId: picked.variantId } : null }, 35)
    if (!offer) return redirect(`${current.base}/orders/${order.id}`)
    return html(view.offerPage({ ...current, region: regionForOrder(current, order.id) }, order, offer, 'downsell'))
  })

  router.post('/orders/:id/downsell', async (ctx) => {
    const current = open(ctx)
    const order = getOrder(current.db, current.store.id, ctx.params.id as string)
    if (!order) throw notFound('No such order')
    if (order.downsell.offered) return redirect(`${current.base}/orders/${order.id}`)
    const body = await ctx.body()
    const funnel = funnelForProducts(current.db, current.store.id, order.items.map((item) => item.productId))
    const offer = resolveOffer(current.db, current.store.id, funnel?.downsell, () => { const picked = pickOffer(current, order); return picked ? { product: picked.product, variantId: picked.variantId } : null }, 35)
    if (body.accept === 'yes' && offer && !canReserve(current.db, offer.variantId, 1)) {
      recordDownsell(current.db, current.store.id, order.id, { offered: offer.variantId, accepted: false })
      return redirect(`${current.base}/orders/${order.id}?offer=soldout`)
    }
    if (body.accept !== 'yes' || !offer) {
      recordDownsell(current.db, current.store.id, order.id, { offered: offer?.variantId ?? 'none', accepted: false })
      return redirect(`${current.base}/orders/${order.id}`)
    }
    const basePrice = Math.round(offer.priceCents * (1 - offer.discountPercent / 100))
    const region = regionForOrder(current, order.id)
    const price = convertCents(basePrice, region, current.store.currency)
    const paid = await chargeSaved(current, order, price, { downsell: 'true' })
    if (!paid.ok) {
      recordDownsell(current.db, current.store.id, order.id, { offered: offer.variantId, accepted: false })
      return redirect(`${current.base}/orders/${order.id}?offer=failed`)
    }
    const variant = offer.product.variants.find((entry) => entry.id === offer.variantId)!
    recordDownsell(current.db, current.store.id, order.id, { offered: offer.variantId, accepted: true, line: { variantId: variant.id, productId: offer.product.id, title: offer.product.title, variantTitle: variant.title, image: variant.image || offer.product.heroImage, unitCents: price, quantity: 1, source: 'downsell' }, amountCents: price, baseAmountCents: basePrice })
    record(ctx, { ...current, region }, 'checkout.complete', { productId: offer.product.id, amountCents: price, meta: { downsell: true } })
    return redirect(`${current.base}/orders/${order.id}`)
  })

  router.post('/orders/:id/offer', async (ctx) => {
    const current = open(ctx)
    const order = getOrder(current.db, current.store.id, ctx.params.id as string)
    if (!order) throw notFound('No such order')
    if (order.upsell.offered) return redirect(`${current.base}/orders/${order.id}`)
    const body = await ctx.body()
    const funnel = funnelForProducts(current.db, current.store.id, order.items.map((item) => item.productId))
    const offer = resolveOffer(current.db, current.store.id, funnel?.upsell, () => { const picked = pickOffer(current, order); return picked ? { product: picked.product, variantId: picked.variantId } : null }, 20)
    if (body.accept === 'yes' && offer && !canReserve(current.db, offer.variantId, 1)) {
      recordUpsell(current.db, current.store.id, order.id, { offered: offer.variantId, accepted: false })
      return redirect(`${current.base}/orders/${order.id}/downsell`)
    }
    if (body.accept !== 'yes' || !offer) {
      recordUpsell(current.db, current.store.id, order.id, { offered: offer?.variantId ?? 'none', accepted: false })
      return redirect(`${current.base}/orders/${order.id}/downsell`)
    }
    const basePrice = Math.round(offer.priceCents * (1 - offer.discountPercent / 100))
    const region = regionForOrder(current, order.id)
    const price = convertCents(basePrice, region, current.store.currency)
    const paid = await chargeSaved(current, order, price, { upsell: 'true' })
    if (!paid.ok) {
      recordUpsell(current.db, current.store.id, order.id, { offered: offer.variantId, accepted: false })
      return redirect(`${current.base}/orders/${order.id}?offer=failed`)
    }
    const paymentIntentId = paid.intentId
    const variant = offer.product.variants.find((entry) => entry.id === offer.variantId)!
    const line: LineItem = { variantId: variant.id, productId: offer.product.id, title: offer.product.title, variantTitle: variant.title, image: variant.image || offer.product.heroImage, unitCents: price, quantity: 1, source: 'post-purchase' }
    recordUpsell(current.db, current.store.id, order.id, { offered: offer.variantId, accepted: true, line, amountCents: price, baseAmountCents: basePrice, ...(paymentIntentId ? { paymentIntentId } : {}) })
    record(ctx, { ...current, region }, 'checkout.complete', { productId: offer.product.id, amountCents: price, meta: { upsell: true } })
    return redirect(`${current.base}/orders/${order.id}`)
  })

  /* ----------------------------------------------------------- machine routes */

  router.get('/robots.txt', (ctx) => {
    const current = open(ctx)
    return new Raw(robots(`${ctx.url.origin}${current.base}`), 'text/plain; charset=utf-8')
  })

  router.get('/sitemap.xml', (ctx) => {
    const current = open(ctx)
    const products = listProducts(current.db, current.store.id, { status: 'published', limit: 500 })
    const collections = listCollections(current.db, current.store.id)
    return new Raw(
      sitemap(`${ctx.url.origin}${current.base}`, [
        { path: '/' },
        { path: '/collections/all' },
        ...collections.map((collection) => ({ path: `/collections/${collection.handle}` })),
        ...products.map((product) => ({ path: `/products/${product.handle}`, updated: product.updatedAt })),
      ]),
      'application/xml; charset=utf-8',
    )
  })

  /** The knowledge card, in the form a generative engine can actually read. */
  router.get('/llms.txt', (ctx) => {
    const current = open(ctx)
    const products = listProducts(current.db, current.store.id, { status: 'published', limit: 50 })
    return new Raw(llmsTxt(current.store, products), 'text/plain; charset=utf-8')
  })

  router.get('/store/integrations/active', (ctx) => {
    const current = open(ctx)
    return activeStorefrontConfig(current.db, current.store.id)
  })

  return router
}

/** The branded 404 is built with the same draft/live environment as the URL. */
export function storefrontNotFound(ctx: Ctx, store: Store, preview: boolean) {
  return html(view.notFoundPage(storeViewFor(ctx, store, { preview })), 404)
}

function readCheckoutForm(body: Record<string, unknown>) {
  const name = [body.firstName, body.lastName].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ') || String(body.name ?? '').trim()
  return {
    email: String(body.email ?? '').trim().toLowerCase(),
    name,
    phone: String(body.phone ?? '').trim(),
    marketing: body.marketing === 'true',
    address: { name, line1: String(body.line1 ?? '').trim(), ...(body.line2 === undefined ? {} : { line2: String(body.line2 ?? '').trim() }), ...(body.state === undefined ? {} : { state: String(body.state ?? '').trim() }), city: String(body.city ?? '').trim(), postal: String(body.postal ?? '').trim(), country: String(body.country ?? 'US').trim().toUpperCase(), phone: String(body.phone ?? '').trim() },
  }
}

/** Everything the checkout renders from, in one place: totals, region, the payment provider and the funnel's bump. */
function checkoutInputFor(current: StoreView, extra: Partial<CheckoutInput> = {}): CheckoutInput {
  const stripe = current.preview ? null : stripeFor(current.db, current.store.id)
  const amounts = current.store.kind === 'funnel' && !current.cart?.items.length ? { ...current.totals!, shippingCents: 0, taxCents: 0, totalCents: 0 } : current.totals!
  return { totals: amounts, region: regionOf(current), stripe: stripe ? { publishableKey: stripe.config.publishableKey } : null, bump: configuredBump(current), ...extra }
}

/** Visiting checkout must not invent or silently add an unconfigured product. */
function configuredBump(current: StoreView) {
  if (!current.cart?.items.length) return null
  const funnel = funnelForProducts(current.db, current.store.id, current.cart.items.map(item => item.productId))
  return funnel && (funnel.bump.enabled === true || funnel.bump.variantId) ? resolveBump(current.db, current.store.id, funnel) : null
}

/** The checkout built from blocks when the store has published one; the built-in page otherwise. */
function renderCheckout(current: StoreView, input: CheckoutInput): string {
  const productId=current.cart?.items.find(item=>!item.giftOf&&item.source!=='order-bump')?.productId||homePage(current.db,current.store.id,{preview:current.preview})?.productId
  const custom = liveCheckoutPage(current.db, current.store.id, { preview: current.preview,productId })
  return custom ? custom.mode === 'html' ? view.htmlPage(current, custom, input) : view.checkoutBlockPage(current, custom, input) : view.checkoutPage(current, input)
}

/** The cart with one line from the first product, in memory only, so a checkout page can be previewed without buying anything. */
function withSampleCart(current: StoreView): StoreView {
  const product = listProducts(current.db, current.store.id, { status: current.preview ? 'all' : 'published', limit: 1 })[0]
  const variant = product?.variants[0]
  if (!product || !variant || !current.cart) return current
  const cart = { ...current.cart, items: [{ variantId: variant.id, productId: product.id, title: product.title, variantTitle: variant.title, image: variant.image || product.heroImage, unitCents: variant.priceCents, quantity: 1 }] }
  return { ...current, cart, totals: totals(current.db, current.store.id, cart) }
}

function regionOf(current: StoreView) {
  return current.cart?.regionId ? getRegion(current.db, current.store.id, current.cart.regionId) : defaultRegion(current.db, current.store.id)
}

function regionForOrder(current: StoreView, orderId: string): Region | null {
  const row = current.db.one<{ region_id: string | null }>('SELECT region_id FROM carts WHERE store_id = ? AND order_id = ?', current.store.id, orderId)
  return row?.region_id ? getRegion(current.db, current.store.id, row.region_id) : current.region ?? null
}

function afterOrder(ctx: Ctx, current: StoreView, order: ReturnType<typeof completeCart>, options: { clearCart?: boolean } = {}) {
  const event = record(ctx, current, 'checkout.complete', {
    amountCents: order.totalCents, email: order.email, phone: order.address.phone,
    purchaseEventId: order.id, externalId:current.db.one<{customer_id:string}>('SELECT customer_id FROM orders WHERE id=? AND store_id=?',order.id,current.store.id)?.customer_id||undefined, meta: { orderId: order.id },
  })
  if (event) attributeOrder(current.db, current.store.id, order.id, event.sessionId)
  if (options.clearCart !== false) setCookie(ctx.res, cartCookie(current.store.id, current.preview), '', { maxAge: 0 })
  // The receipt is not allowed to fail the checkout: the order is already
  // written and paid for by the time this runs.
  void sendEmail(current.db, current.store.id, { template: 'order_confirmation', to: order.email, context: orderContext(order, `${ctx.url.origin}${current.base}`) }).catch(() => undefined)
}

/** Charges a saved card off-session on Stripe orders; demo orders just say yes. */
async function chargeSaved(current: StoreView, order: ReturnType<typeof completeCart>, amountCents: number, metadata: Record<string, string>, idempotencyKey?: string): Promise<{ ok: boolean; intentId: string; failed?: boolean }> {
  if (order.paymentProvider !== 'stripe') return { ok: true, intentId: '' }
  const stripe = stripeFor(current.db, current.store.id)
  if (!stripe || !order.paymentCustomerId || !order.paymentMethodId) return { ok: false, intentId: '' }
  try {
    const intent = await stripe.client.paymentIntents.chargeOffSession({ amountCents, currency: order.currency, customerId: order.paymentCustomerId, paymentMethodId: order.paymentMethodId, metadata: { storeId: current.store.id, orderId: order.id, ...metadata }, idempotencyKey })
    if(idempotencyKey&&['canceled','requires_payment_method'].includes(intent.status))return {ok:false,intentId:intent.id,failed:true}
    if (intent.status !== 'succeeded' && (idempotencyKey || intent.status !== 'processing')) throw new Error(`Payment ${intent.status}`)
    return { ok: true, intentId: intent.id }
  } catch (error) {
    log.warn(`off-session charge failed: ${error instanceof Error ? error.message : String(error)}`)
    return { ok: false, intentId: '' }
  }
}

/**
 * The post-purchase offer is the best companion not already in the order,
 * at 20% off. It comes from the same affinity data the PDP uses, so the
 * thing offered is the thing people actually buy alongside.
 */
function pickOffer(current: StoreView, order: ReturnType<typeof completeCart>) {
  const inOrder = new Set(order.items.map((item) => item.productId))
  const first = order.items[0]
  if (!first) return null
  const candidates = companionsFor(current.db, current.store.id, first.productId, 4)
    .map((productId) => getProduct(current.db, current.store.id, productId))
    .filter((product): product is NonNullable<typeof product> => product !== null && product.status === 'published' && !inOrder.has(product.id))
  const product = candidates[0]
  const variant = product?.variants.find((entry) => entry.inventory > 0 || entry.allowBackorder) ?? product?.variants[0]
  if (!product || !variant) return null
  return { product, variantId: variant.id, priceCents: variant.priceCents, discountPercent: 20 }
}

/** 301s carried over from a migration are checked before the 404. */
export function redirectFor(store: Store, pathname: string) {
  return findRedirect(getDb(), store.id, pathname)
}

export function storeFromSlug(slug: string): Store | null {
  const db = getDb()
  const row = db.one<{ id: string }>('SELECT id FROM stores WHERE slug = ?', slug)
  return row ? getStore(db, row.id) : null
}

function wantsJson(ctx: Ctx): boolean { return String(ctx.req.headers.accept || '').includes('application/json') }
function cartQuantity(value: unknown, fallback: number): number {
  const quantity = value === undefined ? fallback : Number(value)
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 999 || (fallback === 1 && quantity === 0)) throw badRequest('Quantity must be a whole number between ' + fallback + ' and 999')
  return quantity
}
function cartState(current: StoreView) {
  const cart = current.cart!, totals = paymentTotals(current.db, current.store.id, cart)
  return { metaEvents:current.preview?[]:current.metaEvents||[], items:cartDisplayLines(current.db,current.store.id,cart,totals), count:cart.items.reduce((sum,item)=>sum+item.quantity,0), totals, discountCode:cart.discountCode }
}
