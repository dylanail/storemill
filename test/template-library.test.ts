import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createBlankAsset } from '../src/control/assets.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { createPage, liveCartPage, liveCheckoutPage, newBlock, restorePageRevision, savePageRevision, updatePage } from '../src/pages/store.ts'
import { deletePageTemplate, getPageTemplate, listPageTemplates, savePageTemplate, templateBlocks, templateHtml, usePageTemplate } from '../src/pages/library.ts'

test('whole page templates preserve responsive design and create independent drafts on another site', () => {
  const { db, user } = fresh()
  const source = createBlankAsset(db, user.id, { name: 'Source', kind: 'store' }), target = createBlankAsset(db, user.id, { name: 'Target', kind: 'funnel' })
  const product = createProduct(db, source.id, { title: 'Original product', variants: [{ title: 'Default', priceCents: 2300 }] })
  const nextProduct = createProduct(db, target.id, { title: 'Next product', variants: [{ title: 'Default', priceCents: 4900 }] })
  const original = createPage(db, source.id, { title: 'Complete design', role: 'offer', status: 'published', productId: product.id, rawHtml: '<style>.hero{padding:60px}@media(max-width:767px){.hero{padding:20px}}</style><section class="hero">A complete design</section>' })
  updatePage(db, source.id, original.id, { isHome: true })
  const template = savePageTemplate(db, user.id, source.id, 'Reusable offer', original)
  const copy = usePageTemplate(db, user.id, target.id, template.id, { productId: nextProduct.id })
  assert.equal(copy.storeId, target.id);assert.equal(copy.status, 'draft');assert.equal(copy.isHome, false)
  assert.notEqual(copy.id, original.id);assert.equal(copy.role, 'offer');assert.equal(copy.productId, nextProduct.id)
  assert.equal(copy.rawHtml, original.rawHtml)
  updatePage(db, target.id, copy.id, { rawHtml: 'Changed' })
  assert.equal(getPageTemplate(db, user.id, template.id)?.snapshot.rawHtml, original.rawHtml)
  assert.throws(() => usePageTemplate(db, user.id, target.id, template.id, { productId: product.id }), /this site/)
  assert.equal(getPageTemplate(db, 'another-owner', template.id), null)
  assert.equal(deletePageTemplate(db, 'another-owner', template.id), false)
  assert.equal(listPageTemplates(db, 'another-owner').length, 0)
  db.handle.close()
})

test('block templates rebind products, regenerate block ids and remove stale source-store routes', () => {
  const { db, user } = fresh(), source = createBlankAsset(db, user.id, { name: 'Source', kind: 'store' }), target = createBlankAsset(db, user.id, { name: 'Target', kind: 'store' })
  const next = createProduct(db, target.id, { title: 'Destination', variants: [{ title: 'Default', priceCents: 1000 }] })
  const original = createPage(db, source.id, { title: 'Offer', role: 'offer', blocks: [newBlock('buy-box', { productId: 'source-product', variantId: 'source-variant' }), newBlock('button', { href: `/s/${source.slug}/products/item` })] })
  const template = savePageTemplate(db, user.id, source.id, 'Offer blocks', original)
  const copy = usePageTemplate(db, user.id, target.id, template.id, { productId: next.id })
  assert.equal(copy.blocks[0]?.settings.productId, next.id);assert.equal(copy.blocks[0]?.settings.variantId, '')
  assert.notEqual(copy.blocks[0]?.id, original.blocks[0]?.id)
  assert.equal(copy.blocks[1]?.settings.href, '/products/item')
  const unbound = usePageTemplate(db, user.id, target.id, template.id)
  assert.equal(unbound.blocks[0]?.settings.productId, '')
  db.handle.close()
})

test('template navigation normalizes only the known source asset and covers form actions and declared next steps', () => {
  const source = 'source-store'
  const html = '<a href="https://app.example/s/source-store/products/item?plan=one&amp;quantity=2#buy">Details</a><form action="/preview/source-store/cart/add"><button formaction=\'https://app.example/preview/source-store/checkout?from=button\'>Buy</button></form><div data-copy-href="/s/source-store/cart" data-href="https://app.example/s/source-store/pages/next" data-url="//app.example/s/source-store/pages/next" data-next-url="/preview/source-store/checkout" data-next-step="/s/source-store/thanks" data-checkout-url="https://app.example/s/source-store/checkout"></div><a href="/s/source-store">Home</a><a href=/preview/source-store/pages/bare>Bare</a><img src="https://app.example/s/source-store/photo.jpg"><style>.image{background:url(https://app.example/s/source-store/photo.jpg)}</style><script>const html=\'<a href="https://app.example/s/source-store/pages/test">Test</a>\';</script><a href="https://outside.example/catalog">External</a><a href="/s/another-store/cart">Other store</a><a href="https://outside.example/s/another-store/checkout">Other checkout</a><a href="https://app.example/s/source-store-similar/cart">Similar slug</a>'
  const copy = templateHtml(html, '', source)
  assert.match(copy, /href="\/products\/item\?plan=one&amp;quantity=2#buy"/)
  assert.match(copy, /action="\/cart\/add"/)
  assert.match(copy, /formaction='\/checkout\?from=button'/)
  assert.match(copy, /data-copy-href="\/cart"/)
  assert.match(copy, /data-href="\/pages\/next"/)
  assert.match(copy, /data-url="\/pages\/next"/)
  assert.match(copy, /data-next-url="\/checkout"/)
  assert.match(copy, /data-next-step="\/thanks"/)
  assert.match(copy, /data-checkout-url="\/checkout"/)
  assert.match(copy, /href="\/">Home/)
  assert.match(copy, /href="\/pages\/bare"/)
  assert.match(copy, /src="https:\/\/app.example\/s\/source-store\/photo.jpg"/)
  assert.ok(copy.includes('<style>.image{background:url(https://app.example/s/source-store/photo.jpg)}</style>'))
  assert.ok(copy.includes('<script>const html=\'<a href="https://app.example/s/source-store/pages/test">Test</a>\';</script>'))
  assert.match(copy, /href="https:\/\/outside.example\/catalog"/)
  assert.match(copy, /href="\/s\/another-store\/cart"/)
  assert.match(copy, /href="https:\/\/outside.example\/s\/another-store\/checkout"/)
  assert.match(copy, /href="https:\/\/app.example\/s\/source-store-similar\/cart"/)
  assert.equal(templateHtml(html), html, 'without a known source slug, unrelated paths are retained')
  const blocks = templateBlocks([newBlock('custom-html', { html: '<button formaction="/s/source-store/cart/add">Buy</button>', nested: { href: 'https://app.example/preview/source-store/pages/about#team' }, copy: 'Visit /s/source-store/pages/about for details.', foreign: 'https://outside.example/s/another-store/cart' })], '', source)
  assert.match(String(blocks[0]?.settings.html), /formaction="\/cart\/add"/)
  assert.deepEqual(blocks[0]?.settings.nested, { href: '/pages/about#team' })
  assert.equal(blocks[0]?.settings.copy, 'Visit /s/source-store/pages/about for details.')
  assert.equal(blocks[0]?.settings.foreign, 'https://outside.example/s/another-store/cart')
})

test('saved source slugs survive source deletion and older templates resolve their source store', () => {
  const { db, user } = fresh(), source = createBlankAsset(db, user.id, { name: 'Source', kind: 'store' }), target = createBlankAsset(db, user.id, { name: 'Target', kind: 'store' })
  const page = createPage(db, source.id, { title: 'Template links', mode: 'html', rawHtml: `<a href="https://app.example/s/${source.slug}/pages/offer">Offer</a>`, headHtml: `<meta name="description" content="Original"><a href="/preview/${source.slug}/cart">Cart</a>` })
  const saved = savePageTemplate(db, user.id, source.id, 'New template', page)
  assert.equal(saved.snapshot.sourceStoreSlug, source.slug)
  const legacy = savePageTemplate(db, user.id, source.id, 'Legacy template', page)
  const { sourceStoreSlug: _slug, ...oldSnapshot } = legacy.snapshot
  db.update('page_templates', legacy.id, { snapshot: oldSnapshot })
  assert.match(usePageTemplate(db, user.id, target.id, legacy.id).rawHtml, /href="\/pages\/offer"/)
  db.run('DELETE FROM stores WHERE id = ?', source.id)
  const copied = usePageTemplate(db, user.id, target.id, saved.id)
  assert.match(copied.rawHtml, /href="\/pages\/offer"/)
  assert.match(copied.headHtml, /href="\/cart"/)
  assert.equal(getPageTemplate(db, user.id, saved.id)?.sourceStoreId, '')
  db.handle.close()
})

test('saved visual bindings are rebound or disconnected without dropping editor styles', () => {
  const html = '<style data-pb-overrides>[data-pb-id="hero"]{padding:2rem}</style><script type="application/json" data-pb-document>{"nodes":{"hero":{"binding":{"productId":"old-product","field":"title"}}}}</script><button data-pb-product="old-product">Buy now</button><script data-pb-bindings>hydrate([{productId:"old-product"}])</script>'
  const rebound = templateHtml(html, 'new-product')
  assert.doesNotMatch(rebound, /old-product/);assert.match(rebound, /new-product/);assert.match(rebound, /data-pb-overrides/)
  const unbound = templateHtml(html)
  assert.doesNotMatch(unbound, /old-product|data-pb-bindings|data-pb-product/);assert.match(unbound, /Buy now/)
  const offers = '<div data-copy-product-id="old-product" data-copy-variant-id="old-variant" data-copy-purchase-type="one-time">Package</div><button data-pb-product-id="old-product">Buy</button>'
  const copiedOffer = templateHtml(offers, 'new-product')
  assert.doesNotMatch(copiedOffer, /old-product|old-variant|data-copy-variant-id/)
  assert.match(copiedOffer, /data-copy-product-id="new-product"/)
  assert.match(copiedOffer, /data-pb-product-id="new-product"/)
  assert.match(copiedOffer, /data-copy-purchase-type="one-time"/)
  assert.doesNotMatch(templateHtml(offers), /data-copy-product-id|data-copy-variant-id|data-pb-product-id/)
})

test('cart/checkout roles accept copied HTML and saved revisions restore page links and roles', () => {
  const { db, user } = fresh(), store = createBlankAsset(db, user.id, { name: 'Checkout', kind: 'funnel' })
  const page = createPage(db, store.id, { title: 'Copied checkout', role: 'checkout', rawHtml: '<main>Checkout</main>' })
  assert.equal(liveCheckoutPage(db, store.id), null)
  assert.equal(liveCheckoutPage(db, store.id, { preview: true })?.id, page.id)
  updatePage(db, store.id, page.id, { status: 'published' })
  assert.equal(liveCheckoutPage(db, store.id)?.id, page.id)
  const before = savePageRevision(db, page, 'Before role change')
  updatePage(db, store.id, page.id, { role: 'cart', handle: 'shopping-bag', status: 'published' })
  assert.equal(liveCartPage(db, store.id)?.id, page.id)
  const restored = restorePageRevision(db, store.id, page.id, before.id)
  assert.equal(restored.role, 'checkout');assert.equal(restored.handle, page.handle)
  db.handle.close()
})
