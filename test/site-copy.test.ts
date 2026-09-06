import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { importAssetFromUrl, createBlankAsset } from '../src/control/assets.ts'
import { duplicateAsset } from '../src/control/duplicate-asset.ts'
import { canonicalPageUrl, discoverPageLinks, rewriteCopiedLinks } from '../src/pages/site-copy.ts'
import { clonePage, localizeClonedHtml, planClonedMediaRepair } from '../src/pages/clone.ts'
import { createPage, updatePage } from '../src/pages/store.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { upsertFunnel } from '../src/domain/funnels.ts'
import { upsertBundle } from '../src/domain/bundles.ts'
import { environment, setTheme, updateStore } from '../src/control/stores.ts'
import { saveUpload, readUpload } from '../src/lib/uploads.ts'
import { planImportedOfferProduct } from '../src/pages/imported-offers.ts'

const document = (body: string, head = '') => `<!doctype html><html><head><title>Copy reference</title>${head}</head><body>${body}</body></html>`
function fixtureFetch(pages: Record<string, string | { body: string; type?: string; status?: number; finalUrl?: string }>) {
  const requests: string[] = []
  const fetchImpl = (async (input: string | URL | Request, options?: RequestInit) => {
    assert.ok(!options?.method || options.method === 'GET', 'copying never submits source forms')
    const url = String(input instanceof Request ? input.url : input)
    requests.push(url)
    const found = pages[url]
    const result = typeof found === 'string' ? { body: found, type: 'text/html', status: 200 } : found
    const response = new Response(result?.body ?? 'Not found', { status: result?.status ?? (found === undefined ? 404 : 200), headers: { 'content-type': result?.type ?? 'text/html' } })
    Object.defineProperty(response, 'url', { value: result && 'finalUrl' in result ? result.finalUrl ?? url : url })
    return response
  }) as typeof fetch
  return { fetchImpl, requests }
}

test('funnel copy discovers query-based steps, declared navigation and extra pages; rewires exact links', async () => {
  const { db, user } = fresh()
  const source = 'https://funnel.example/'
  const { fetchImpl, requests } = fixtureFetch({
    [`${source}?step=offer`]: document('<a href="?step=checkout&amp;utm_source=ad#address">Buy</a><button onclick="location.href=\'/upsell\'">Continue</button><a href="/cart/add?id=2">Action</a><p>Reference: https://funnel.example/?step=offer</p>'),
    [`${source}?step=checkout`]: document('<form action="/checkout/process" method="post"><button>Pay</button></form><script>const flow={nextPageUrl:"/thank-you"}</script><a href="/missing">More</a>'),
    [`${source}upsell`]: document('<a href="/downsell">No thanks</a>'),
    [`${source}downsell`]: document('<a href="/thank-you">Continue</a>'),
    [`${source}thank-you`]: document('<h1>Thank you</h1>'),
    [`${source}hidden-bonus`]: document('<h1>Unlinked bonus</h1>'),
  })
  const result = await importAssetFromUrl(db, user.id, { url: `${source}?step=offer`, kind: 'funnel', additionalUrls: [`${source}hidden-bonus`], fetchImpl })
  assert.equal(result.pages.length, 6)
  assert.deepEqual(new Set(result.pages.map((page) => page.role)), new Set(['offer', 'checkout', 'upsell', 'downsell', 'thankyou', 'page']))
  assert.match(result.page.rawHtml, /href="\/checkout#address"/)
  const upsell = result.pages.find((page) => page.role === 'upsell')!
  assert.match(result.page.rawHtml, new RegExp(`data-copy-href="/pages/${upsell.handle}"`))
  assert.match(result.page.rawHtml, /Reference: https:\/\/funnel.example\/\?step=offer/)
  assert.doesNotMatch(result.page.rawHtml, /onclick=/)
  assert.ok(!requests.some((url) => /cart\/add|checkout\/process/.test(url)))
  assert.equal(result.report.complete, false)
  assert.deepEqual(result.report.failed.map((failure) => failure.url), [`${source}missing`])
  assert.match(result.clone.notes.join('\n'), /Not copied.*missing/)
})

test('copy reports crawl limits and external checkout sessions rather than claiming a complete funnel', async () => {
  const { db, user } = fresh()
  const { fetchImpl, requests } = fixtureFetch({
    'https://shop.example/': document('<a href="/one">One</a><a href="/two">Two</a><a href="/three">Three</a><a href="https://checkout.stripe.com/c/pay_secret">Pay</a>'),
    'https://shop.example/one': document('One'),
  })
  const result = await importAssetFromUrl(db, user.id, { url: 'https://shop.example/', kind: 'store', maxPages: 2, fetchImpl })
  assert.equal(result.pages.length, 3)
  assert.equal(result.report.copied, 2, 'generated checkout is distinct from the two captured source pages')
  assert.equal(result.report.generatedPages?.[0]?.role, 'checkout')
  assert.equal(result.report.remaining.length, 2)
  assert.equal(result.report.externalSteps.length, 1)
  assert.equal(result.report.complete, false)
  assert.equal(requests.filter((url) => url.includes('stripe.com')).length, 0)
})

test('page identity retains funnel query parameters and link rewriting never mutates CSS, copy or media', () => {
  assert.equal(canonicalPageUrl('https://example.com/?step=2&utm_source=ad&view=mobile#top'), 'https://example.com/?step=2&view=mobile')
  assert.equal(canonicalPageUrl('https://example.com/products/widget?variant=3&utm_campaign=a'), 'https://example.com/products/widget')
  const original = '<style>.hero{background:url(https://example.com/offer/background.png)}</style><img src="https://example.com/offer/photo.png"><a href="https://example.com/offer?step=2#buy">Offer</a><p>https://example.com/offer?step=2</p>'
  const copied = rewriteCopiedLinks(original, 'https://example.com/', [{ source: 'https://example.com/offer?step=2', target: '/pages/offer-two' }])
  assert.match(copied, /href="\/pages\/offer-two#buy"/)
  assert.ok(copied.includes('url(https://example.com/offer/background.png)'))
  assert.ok(copied.includes('<p>https://example.com/offer?step=2</p>'))
  assert.deepEqual(discoverPageLinks('<button data-next-url="/checkout">Next</button><script>{"upsellUrl":"https:\\/\\/example.com\\/upsell"}</script>', 'https://example.com/'), ['https://example.com/checkout', 'https://example.com/upsell'])
})

test('clone preserves responsive CSS imports, media conditions, source order and lazy media without source scripts', async () => {
  const { fetchImpl } = fixtureFetch({
    'https://source.example/offer': document('<img class="lazyload" src="" data-src="images/hero_{width}.webp" data-widths="[390,820,1440]"><picture><source media="(max-width:600px)" data-srcset="images/small.webp 1x, images/small@2x.webp 2x"><img data-src="images/hero.webp"></picture><section style="background-image:url(images/paper.png)"></section><script>loadImages()</script>', '<link rel="stylesheet" href="/css/base.css"><link rel="stylesheet" href="/css/mobile.css" media="(max-width:600px)">').replace('<html>', '<html class="no-js theme">'),
    'https://source.example/css/base.css': { body: '@import "tokens.css"; @import url("layout.css") layer(layout) supports(display:grid) screen and (min-width:700px);body{color:black}', type: 'text/css' },
    'https://source.example/css/tokens.css': { body: ':root{--ink:#111}', type: 'text/css' },
    'https://source.example/css/layout.css': { body: '.row{display:grid;background:url(../images/pattern.png)}', type: 'text/css' },
    'https://source.example/css/mobile.css': { body: '.row{display:block;padding:16px}', type: 'text/css' },
  })
  const copy = await clonePage('https://source.example/offer', { storeId: 'copy', fetchImpl, localizeImages: false })
  assert.equal(copy.stylesheets, 4)
  assert.match(copy.html, /<style data-cloned-from="https:\/\/source.example\/css\/mobile.css" media="\(max-width:600px\)">/)
  assert.match(copy.html, /@layer layout\{@supports \(display:grid\)\{@media screen and \(min-width:700px\)/)
  assert.match(copy.html, /url\(https:\/\/source.example\/images\/pattern.png\)/)
  assert.match(copy.html, /style="background-image:url\(https:\/\/source.example\/images\/paper.png\)"/)
  assert.match(copy.html, /srcset="https:\/\/source.example\/images\/hero_390.webp 390w, https:\/\/source.example\/images\/hero_820.webp 820w, https:\/\/source.example\/images\/hero_1440.webp 1440w"/)
  assert.match(copy.html, /<source[^>]* srcset="https:\/\/source.example\/images\/small.webp 1x,/)
  assert.match(copy.html, /class="js theme"/)
  assert.match(copy.html, /name="viewport" content="width=device-width, initial-scale=1"/)
  assert.doesNotMatch(copy.html, /<script/)
})

test('failed CSS imports stay absolute and visible in the copy report', async () => {
  const { fetchImpl } = fixtureFetch({
    'https://source.example/': document('Source', '<style>@import "mobile.css" screen and (max-width:600px);</style>'),
  })
  const copy = await clonePage('https://source.example/', { storeId: 'copy', fetchImpl, localizeImages: false })
  assert.match(copy.html, /@import url\("https:\/\/source.example\/mobile.css"\) screen and \(max-width:600px\);/)
  assert.match(copy.notes.join('\n'), /Kept stylesheet import.*mobile.css/)
})

test('image localization never rewrites the prefix of a responsive image that failed to download', async () => {
  const remote = 'https://cdn.example/hero.webp?v=1'
  const owned = '/_uploads/source/up_123.webp'
  const result = await localizeClonedHtml(`<img src="${remote}" srcset="${remote}&amp;width=390 390w, ${remote}&amp;width=820 820w"><style>.hero{background:url(${remote})}</style>`, 'https://example.com/', {
    storeId: 'copy', localizedImages: new Map([[remote, owned]]), fetchImpl: (async () => new Response('Unavailable', { status: 404 })) as typeof fetch,
  })
  assert.match(result.html, /src="\/_uploads\/source\/up_123.webp"/)
  assert.ok(result.html.includes(`srcset="${remote}&amp;width=390 390w, ${remote}&amp;width=820 820w"`))
  assert.ok(result.html.includes(`background:url(${owned})`))
  assert.ok(!result.html.includes(`${owned}&`))
})

test('existing copy repair is idempotent and preserves edited image sources and page content', () => {
  const original = '<html class="no-js"><body><h1>My edited headline</h1><img src="" data-src="/_uploads/store_one/up_logo.webp" class="lazyload"><img src="/_uploads/store_one/up_edited.jpg" data-src="/_uploads/store_one/up_old.jpg" srcset="/_uploads/store_one/up_edited.jpg&amp;width=390 390w, /_uploads/store_one/up_edited.jpg&width=820 820w"><a href="/my-link">My link</a></body></html>'
  const plan = planClonedMediaRepair(original)
  assert.equal(plan.changed, true)
  assert.match(plan.html, /src="\/_uploads\/store_one\/up_logo.webp"/)
  assert.match(plan.html, /src="\/_uploads\/store_one\/up_edited.jpg"/)
  assert.match(plan.html, /srcset="\/_uploads\/store_one\/up_edited.jpg 390w, \/_uploads\/store_one\/up_edited.jpg 820w"/)
  assert.match(plan.html, /<h1>My edited headline<\/h1>/)
  assert.match(plan.html, /href="\/my-link"/)
  assert.equal(planClonedMediaRepair(plan.html).changed, false)
})

test('funnel crawl preserves directory URLs while resolving relative next steps', async () => {
  const { db, user } = fresh()
  const { fetchImpl } = fixtureFetch({
    'https://example.com/': document('<a href="/flow/">Flow</a>'),
    'https://example.com/flow/': document('<a href="checkout">Checkout</a>'),
    'https://example.com/flow/checkout': document('Checkout'),
  })
  const result = await importAssetFromUrl(db, user.id, { url: 'https://example.com/', kind: 'funnel', fetchImpl })
  assert.equal(result.pages.length, 3)
  assert.equal(result.report.complete, false, 'unpriced funnel pages require review')
  assert.ok(result.pages.some((page) => page.sourceUrl === 'https://example.com/flow/checkout'))
})

test('Funnelish package import creates only explicitly priced one-time variants and binds the original offer tiles', async () => {
  // Structure/labels/prices from the existing Rosabella reference, with media omitted to keep this fixture offline.
  const offer = document('<div class="product-gallery"><img alt="Rosabella Organic Beetroot Capsules"></div><div class="khSubOffer"><div class="khOfferBox" id="recurring">Buy 1 + Get 1 FREE $35.95</div></div><div class="khOneOffer"><div class="khOfferBox" id="igf352s"><div>Buy 1 + Get 1 <span>FREE</span></div><div class="kh_none">Save 0%</div><div>$39.95</div><div class="kh_none">$19.97</div></div><div class="khOfferBox" id="ia7sjus"><div>Buy 2 + Get 2 <span>FREE</span></div><div>$64.95</div><div class="kh_none">$19.97</div></div><div class="khOfferBox" id="ieyh3nd"><div>Buy 3 + Get 3 <span>FREE</span></div><div>$79.95</div></div></div>')
  const plan = planImportedOfferProduct(offer, 'https://example.com/products/beetroot', { currency: 'USD' })!
  assert.equal(plan.product.title, 'Rosabella Organic Beetroot Capsules')
  assert.deepEqual(plan.product.variants.map((variant) => [variant.title, variant.priceCents]), [['Buy 1 + Get 1 FREE', 3995], ['Buy 2 + Get 2 FREE', 6495], ['Buy 3 + Get 3 FREE', 7995]])
  assert.equal(plan.product.description, '')
  assert.match(plan.notes.join('\n'), /Subscription offers were not imported/)
  const { db, user } = fresh()
  const { fetchImpl, requests } = fixtureFetch({ 'https://example.com/products/beetroot': offer })
  const copied = await importAssetFromUrl(db, user.id, { url: 'https://example.com/products/beetroot', kind: 'funnel', fetchImpl })
  assert.equal(copied.products.length, 1)
  assert.equal(copied.products[0]!.status, 'draft')
  assert.equal(copied.page.productId, copied.products[0]!.id)
  assert.deepEqual(copied.products[0]!.subscription, {})
  assert.ok(!requests.some((url) => url.endsWith('.json')), 'explicit source offer markup supplies the catalog without guessing a Shopify product API')
  for (const variant of copied.products[0]!.variants) assert.ok(copied.page.rawHtml.includes(`data-copy-variant-id="${variant.id}"`))
  assert.ok(!/<div[^>]*id="recurring"[^>]*data-copy-variant-id/.test(copied.page.rawHtml))
})

test('Funnelish anchor actions discover an opaque checkout URL through its redirect', async () => {
  const { db, user } = fresh()
  const { fetchImpl } = fixtureFetch({
    'https://get.example.com/products/beetroot': document('<a action="/beetroot/gn/route">Add to cart</a>'),
    'https://get.example.com/beetroot/gn/route': { body: '<html><head><title>Beetroot</title></head><body><form class="fk-card-payment-container"><input name="cardNumber"><input name="shipAddress1"></form></body></html>', finalUrl: 'https://get.example.com/beetroot/gn/of' },
  })
  const copied = await importAssetFromUrl(db, user.id, { url: 'https://get.example.com/products/beetroot', kind: 'funnel', fetchImpl })
  assert.equal(copied.pages.length, 2)
  assert.equal(copied.pages[1]!.role, 'checkout')
  assert.equal(copied.pages[1]!.sourceUrl, 'https://get.example.com/beetroot/gn/of')
  assert.match(copied.page.rawHtml, /action="\/checkout"/)
  assert.equal(copied.report.complete, false, 'a missing catalog is an incomplete commerce copy')
  assert.equal(copied.products.length, 0, 'a missing catalog price is never replaced by an invented default')
  assert.match(copied.clone.notes.join('\n'), /No explicit purchasable price/)
})

test('duplicating an owned funnel copies every page and all catalog references into an independent draft', () => {
  const { db, user } = fresh()
  const source = createBlankAsset(db, user.id, { name: 'Original funnel', kind: 'funnel' })
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const image = saveUpload({ name: 'hero.png', type: 'image/png', data: bytes }, source.id).url
  const product = createProduct(db, source.id, { title: 'Source product', heroImage: image, variants: [{ title: 'One', priceCents: 1900 }] })
  const roles = ['advertorial', 'offer', 'cart', 'checkout', 'upsell', 'downsell', 'thankyou'] as const
  const pages = roles.map((role) => createPage(db, source.id, { title: role, role, kind: role === 'checkout' ? 'checkout' : 'custom', productId: product.id, status: 'published', mode: 'html', sourceUrl: 'https://reference.example/funnel', rawHtml: `<h1>${role}</h1><img src="${image}"><button data-pb-product="${product.id}" data-variant-id="${product.variants[0]!.id}">Buy</button><a href="/preview/${source.slug}/pages/offer">Offer</a>` }))
  updatePage(db, source.id, pages[0]!.id, { isHome: true })
  upsertFunnel(db, source.id, { name: 'Complete flow', productId: product.id, advertorialPageId: pages[0]!.id, offerPageId: pages[1]!.id, upsell: { variantId: product.variants[0]!.id }, bump: { variantId: product.variants[0]!.id } })
  upsertBundle(db, source.id, { productId: product.id, tiers: [{ quantity: 1, discountPercent: 0, label: 'One' }, { quantity: 2, discountPercent: 10, label: 'Two' }] })
  setTheme(db, source.id, { heroImage: image, nav: [{ label: 'Offer', href: `/s/${source.slug}/pages/offer` }], slots: { footer: [pages[6]!.id] } })
  updateStore(db, source.id, { brand: { primary: '#112233' }, status: 'live', referenceUrl: 'https://reference.example/funnel' })
  db.update('store_environments', environment(db, source.id, 'draft').id, { brand: { primary: '#445566', announcement: 'Draft message' } })
  db.insert('domains', { id: 'source_domain', store_id: source.id, hostname: 'original.example', status: 'active', verification_token: 'test-only', ssl: 'active', created_at: new Date().toISOString() })
  updatePage(db, source.id, pages[2]!.id, { rawHtml: `<a href="https://original.example/checkout">Pay on this site</a><a href="https://app.example/s/${source.slug}/pages/offer?plan=one#buy">Absolute offer</a><a href="http://localhost:4100/preview/${source.slug}/cart">Preview cart</a><a href="https://outside.example/s/another-store/pages/about">Other site</a><img src="https://cdn.example/photo.jpg">` })
  db.insert('store_plugin_credentials', { id: 'credential_for_test', store_id: source.id, plugin_id: 'stripe', sealed: 'test-only-not-a-key', updated_at: new Date().toISOString() })
  const copied = duplicateAsset(db, user.id, source.id, { origin: 'https://app.example' })
  assert.equal(copied.pages.length, roles.length)
  assert.equal(copied.store.status, 'draft')
  assert.equal(copied.store.brand.primary, '#445566')
  assert.equal(environment(db, copied.store.id, 'draft').brand.announcement, 'Draft message')
  assert.equal(copied.store.referenceUrl, 'https://reference.example/funnel')
  assert.ok(copied.pages.every((page) => page.sourceUrl === 'https://reference.example/funnel'))
  assert.ok(copied.pages.every((page) => page.status === 'draft' && page.productId === copied.products[0]!.id))
  assert.ok(copied.pages.every((page) => !pages.some((old) => old.id === page.id)))
  assert.ok(copied.pages.every((page) => !page.rawHtml.includes(source.id) && !page.rawHtml.includes(source.slug) && !page.rawHtml.includes(product.id)))
  const copiedProduct = copied.products[0]!
  assert.ok(copiedProduct.heroImage.startsWith(`/_uploads/${copied.store.id}/`))
  assert.deepEqual(readUpload(copiedProduct.heroImage)?.data, bytes)
  assert.equal(copied.funnels[0]!.offerPageId, copied.pages.find((page) => page.role === 'offer')!.id)
  assert.equal(copied.funnels[0]!.upsell.variantId, copiedProduct.variants[0]!.id)
  assert.equal(environment(db, copied.store.id, 'draft').theme.nav[0]!.href, '/pages/offer')
  assert.match(copied.pages.find((page) => page.role === 'cart')!.rawHtml, /href="\/checkout"/)
  assert.match(copied.pages.find((page) => page.role === 'cart')!.rawHtml, /href="\/pages\/offer\?plan=one#buy"/)
  assert.match(copied.pages.find((page) => page.role === 'cart')!.rawHtml, /href="\/cart"/)
  assert.match(copied.pages.find((page) => page.role === 'cart')!.rawHtml, /href="https:\/\/outside.example\/s\/another-store\/pages\/about"/)
  assert.equal(environment(db, copied.store.id, 'live').publishedAt, null)
  assert.equal(db.one<{ c: number }>('SELECT COUNT(*) c FROM store_plugin_credentials WHERE store_id = ?', copied.store.id)?.c, 0)
  assert.equal(db.one<{ product_id: string }>('SELECT product_id FROM bundles WHERE store_id = ?', copied.store.id)?.product_id, copiedProduct.id)
  assert.throws(() => duplicateAsset(db, 'another-owner', source.id), /own stores/)
})
