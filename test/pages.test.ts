import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { BLOCKS, blockDefinition, renderBlock, renderBlocks, type BlockContext } from '../src/pages/blocks.ts'
import { advertorialTemplate, blockContextFor, checkoutTemplate, createPage, getPage, homePage, landingTemplate, listPageRevisions, liveCheckoutPage, newBlock, PAGE_TEMPLATES, pageTemplate, productTemplate, restorePageRevision, salesTemplate, savePageRevision, scienceTemplate, updatePage } from '../src/pages/store.ts'
import { clonePage, extractBlocks } from '../src/pages/clone.ts'
import { bundleFor, renderBundleWidget, tierFor, upsertBundle, removeBundle } from '../src/domain/bundles.ts'
import { formBody, signWebhook, stripeClient, verifyWebhookSignature } from '../src/payments/stripe.ts'
import { createStore, environment } from '../src/control/stores.ts'
import { createProduct, getProduct, getVariant, updateProduct } from '../src/domain/catalog.ts'
import { blockPage, htmlPage, notFoundPage, productPage } from '../src/storefront/render.ts'
import { createReview, statsFor } from '../src/domain/reviews.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'
import { addToCart, createCart, setQuantity, setShipping, totals } from '../src/domain/cart.ts'
import { completeCart, recordUpsell } from '../src/domain/orders.ts'
import { createPromotion, listPromotions } from '../src/domain/promotions.ts'
function require_promotions() {
  return { createPromotion }
}
import { execute } from '../src/agent/registry.ts'
import { editorPage } from '../src/admin/editor.ts'

const context: BlockContext = {
  storeName: 'Test Co',
  base: '/s/test',
  currency: 'USD',
  brand: { primary: '#123456' },
  products: [{ id: 'prod_1', handle: 'glove', title: 'The Glove', subtitle: 'For rounds', image: '/g.svg', priceCents: 34000, variants: [{ id: 'var_1', title: '16oz', priceCents: 34000 }], options: [] }],
  reviews: [{ productId: 'prod_1', rating: 5, title: 'Solid', body: 'Held up.', author: 'M.', verified: true }],
  bundles: [{ productId: 'prod_1', html: '<div class="bundle">tiers</div>' }],
}

function shop() {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Bundle Co', prompt: 'boxing' })
  seedDefaultRegion(db, store.id, 'USD')
  const glove = createProduct(db, store.id, { title: 'The Glove', status: 'published', variants: [{ title: '16oz', priceCents: 10000, inventory: 20 }] })
  const wraps = createProduct(db, store.id, { title: 'The Wrap', status: 'published', variants: [{ title: '180in', priceCents: 2000, inventory: 20 }] })
  return { db, user, store, glove, wraps }
}

/* --------------------------------------------------------------- blocks */

test('every block renders with its defaults and escapes what it is given', () => {
  for (const definition of BLOCKS) {
    const html = renderBlock({ id: 'b1', type: definition.type, settings: {} }, context)
    assert.ok(html.length > 0, `${definition.type} renders`)
    assert.ok(html.includes('data-block="b1"'), `${definition.type} carries its id`)
  }
  const hostile = renderBlock({ id: 'b2', type: 'headline', settings: { text: '<script>alert(1)</script>' } }, context)
  assert.ok(!hostile.includes('<script>'), 'text settings are escaped')
  assert.ok(hostile.includes('&lt;script&gt;'))
  const raw = renderBlock({ id: 'b3', type: 'custom-html', settings: { html: '<b>raw</b>' } }, context)
  assert.ok(raw.includes('<b>raw</b>'), 'custom HTML is rendered as-is on purpose')
})

test('a bad setting falls back rather than blanking the section, and unknown blocks say so', () => {
  const html = renderBlock({ id: 'b1', type: 'spacer', settings: { height: 'tall' } }, context)
  assert.match(html, /height:48px/)
  assert.match(renderBlock({ id: 'b9', type: 'made-up', settings: {} }, context), /Unknown block: made-up/)
})

test('commerce blocks read the store through the context, never the database', () => {
  const buy = renderBlock({ id: 'b1', type: 'buy-box', settings: { productId: 'prod_1' } }, context)
  assert.match(buy, /The Glove/)
  assert.match(buy, /action="\/s\/test\/checkout\/buy"/, 'buy now by default')
  assert.match(buy, /class="bundle"/, 'the bundle widget rides along')
  const wall = renderBlock({ id: 'b2', type: 'review-wall', settings: { productId: 'prod_1' } }, context)
  assert.match(wall, /Held up\./)
  assert.match(renderBlock({ id: 'b3', type: 'video', settings: { url: 'https://www.youtube.com/watch?v=abc123' } }, context), /youtube-nocookie\.com\/embed\/abc123/)
})

test('templates produce a complete advertorial and landing page from research', () => {
  const research = { triggers: ['One', 'Two', 'Three'], objections: [{ objection: 'Q?', answer: 'A.' }], comparison: { rows: [{ label: 'L', us: 'U', them: 'T' }] }, competitors: [{ name: 'Rival' }] }
  const advertorial = advertorialTemplate({ storeName: 'Test Co', product: { id: 'prod_1', title: 'The Glove', image: '/g.svg', subtitle: 'x' }, research })
  const types = advertorial.map((block) => block.type)
  for (const expected of ['publication-bar', 'byline', 'numbered-reason', 'comparison', 'review-wall', 'buy-box', 'faq', 'sticky-cta', 'disclaimer']) assert.ok(types.includes(expected), `advertorial has ${expected}`)
  assert.equal(types.filter((type) => type === 'numbered-reason').length, 3)
  const landing = landingTemplate({ storeName: 'Test Co', product: { id: 'prod_1', title: 'The Glove', image: '/g.svg', subtitle: 'x' }, research })
  assert.ok(landing.some((block) => block.type === 'bundle-offer'))
  assert.match(renderBlocks(advertorial, context), /Rival/)
})

test('the blocks from the reference funnels render their content and nothing they were not given', () => {
  const stats = renderBlock({ id: 'b1', type: 'stats', settings: { items: '76%|Felt steadier\n14 days|To mould', source: 'Survey, 2025' } }, context)
  assert.match(stats, /<b>76%<\/b><span>Felt steadier<\/span>/)
  assert.match(stats, /Survey, 2025/)
  assert.match(renderBlock({ id: 'b2', type: 'timeline', settings: { steps: 'Week 1|Break-in|Stiff at first.' } }, context), /<span class="when">Week 1<\/span><div><strong>Break-in<\/strong>/)
  const steps = renderBlock({ id: 'b3', type: 'how-it-works', settings: { steps: 'Wrap|Wrap up.|/w.jpg\nLace|Lace up.|' } }, context)
  assert.match(steps, /<img src="\/w.jpg"/)
  assert.match(steps, /<span class="num">2<\/span><h3>Lace<\/h3>/)
  const stack = renderBlock({ id: 'b4', type: 'value-stack', settings: { items: 'Gloves|$340\nRepairs|Included', total: '$383', price: '$289' } }, context)
  assert.match(stack, /✓ Gloves<\/span><b>\$340<\/b>/)
  assert.match(stack, /<s>\$383<\/s>/)
  assert.match(stack, /class="vprice"><span>Today only<\/span><b>\$289<\/b>/)
  const costs = renderBlock({ id: 'b5', type: 'cost-comparison', settings: { rows: 'Chair|$800', total: '$5,930+', us: '$54' } }, context)
  assert.match(costs, /<span>Chair<\/span><b>\$800<\/b>/)
  assert.match(costs, /class="us"><span>One pair, repaired for life<\/span><b>\$54<\/b>/)
  const gallery = renderBlock({ id: 'b6', type: 'gallery', settings: { images: '/a.jpg\n/b.jpg' } }, context)
  assert.match(gallery, /data-gallery/)
  assert.equal((gallery.match(/class="gal-thumbs"/g) ?? []).length, 1)
  assert.match(gallery, /<button type="button" class="on" data-src="\/a.jpg"/)
  assert.doesNotMatch(renderBlock({ id: 'b7', type: 'gallery', settings: { images: '/a.jpg' } }, context), /gal-thumbs/, 'one image, no thumbnails')
  const studies = renderBlock({ id: 'b8', type: 'studies', settings: { items: 'JSS, 2019|Wrist stiffness cut load.|https://example.com/s' } }, context)
  assert.match(studies, /<div class="src">JSS, 2019<\/div><p>Wrist stiffness cut load.<\/p><a href="https:\/\/example.com\/s"/)
  assert.match(renderBlock({ id: 'b9', type: 'expert-quote', settings: { quotes: 'Closest to taped.|Marisol|Cutman|' } }, context), /<span class="av">M<\/span><blockquote>Closest to taped.<\/blockquote>/)
  assert.match(renderBlock({ id: 'b10', type: 'letter', settings: { text: 'One.\n\nTwo.', name: 'Ana' } }, context), /<p>One.<\/p><p>Two.<\/p>.*<strong>Ana<\/strong>/)
  assert.match(renderBlock({ id: 'b11', type: 'video-wall', settings: { videos: 'https://youtu.be/abc123||Lindsey\n/clip.mp4|/p.jpg|Diana' } }, context), /youtube-nocookie\.com\/embed\/abc123[\s\S]*<video class="video" controls preload="none" poster="\/p.jpg" src="\/clip.mp4">/)
  assert.match(renderBlock({ id: 'b12', type: 'specs', settings: { rows: 'Weight|14oz' } }, context), /<dt>Weight<\/dt><dd>14oz<\/dd>/)
  assert.match(renderBlock({ id: 'b13', type: 'multicolumn', settings: { columns: '/i.png|Fast|Ships today' } }, context), /<div class="ico"><img src="\/i.png"/, 'a URL in the icon cell is a picture')
  assert.match(renderBlock({ id: 'b14', type: 'guarantee', settings: { note: 'Fewer than 1% use it.' } }, context), /Fewer than 1% use it\./)
  // The rating line and the histogram read real reviews; below the minimum they say nothing.
  assert.match(renderBlock({ id: 'b15', type: 'rating-strip', settings: { minimum: 1 } }, context), /Rated 5\.0\/5 by 1\+ verified buyers/)
  assert.match(renderBlock({ id: 'b16', type: 'rating-strip', settings: {} }, context), /^<!-- data-block="b16" rating-strip: 1 reviews -->$/)
  assert.match(renderBlock({ id: 'b17', type: 'review-wall', settings: { histogram: true } }, context), /class="histo"[\s\S]*<span>5★<\/span><i><b style="width:100%">/)
  assert.doesNotMatch(renderBlock({ id: 'b18', type: 'review-wall', settings: {} }, context), /class="histo"/)
})

test('the checkout blocks place the form, summary and bump from the context, and say what they are without it', () => {
  assert.match(renderBlock({ id: 'c1', type: 'checkout-form', settings: {} }, context), /The checkout form renders here/)
  assert.match(renderBlock({ id: 'c2', type: 'order-summary', settings: {} }, context), /class="ph"/)
  assert.match(renderBlock({ id: 'c3', type: 'checkout-steps', settings: { current: 2 } }, context), /<li class="done"[^>]*><span>✓<\/span>Cart<\/li><li class="now" aria-current="step"><span>2<\/span>Information<\/li><li class="" ><span>3<\/span>Payment<\/li>/)
  const checkout = { formHtml: '<form id="checkout-form"><!--bump--><button><!--pay-label--></button></form>', summaryHtml: '<div class="summary-body">lines</div>', expressHtml: '<div class="express">wallets</div>', bumpHtml: '<label class="bump">Protect my order</label>', totalCents: 12345, itemCount: 2, sample: false }
  const two = renderBlock({ id: 'c4', type: 'checkout-form', settings: { buttonLabel: 'Complete order' } }, { ...context, checkout })
  assert.match(two, /<form id="checkout-form"><label class="bump">Protect my order<\/label><button>Complete order<\/button><\/form>/, 'the bump lands at the marker, the label on the button')
  assert.match(two, /<aside class="co-side"><h2 class="co-h">Your order<\/h2><div class="summary-body">lines<\/div>/, 'two-column carries the summary')
  assert.match(two, /co-summary-mobile[\s\S]*\$123\.45/)
  assert.match(two, /class="express"/)
  const stacked = renderBlock({ id: 'c5', type: 'checkout-form', settings: { layout: 'stacked', showBump: false, showExpress: false } }, { ...context, checkout })
  assert.doesNotMatch(stacked, /co-side|class="bump"|class="express"/)
  assert.match(stacked, /checkout--stacked/)
  assert.match(renderBlock({ id: 'c6', type: 'checkout-form', settings: {} }, { ...context, checkout: { ...checkout, sample: true, error: 'Enter a valid email address' } }), /Sample order[\s\S]*Enter a valid email address/)
  assert.match(renderBlock({ id: 'c7', type: 'order-summary', settings: {} }, { ...context, checkout }), /co-summary-blk[\s\S]*lines/)
  assert.match(renderBlock({ id: 'c8', type: 'order-bump', settings: {} }, { ...context, checkout }), /Wait — add this to your order\?[\s\S]*Protect my order/)
  assert.match(renderBlock({ id: 'c9', type: 'order-bump', settings: {} }, { ...context, checkout: { ...checkout, bumpHtml: '' } }), /^<!-- data-block="c9" order-bump/)
})

test('every template builds a whole page from the research, and the checkout template is the checkout', () => {
  const research = { triggers: ['One', 'Two', 'Three', 'Four'], objections: [{ objection: 'Q?', answer: 'A.' }], comparison: { rows: [{ label: 'L', us: 'U', them: 'T' }] }, competitors: [{ name: 'Rival' }] }
  const input = { storeName: 'Test Co', product: { id: 'prod_1', title: 'The Glove', image: '/g.svg', subtitle: 'x' }, research }
  for (const template of PAGE_TEMPLATES) {
    const blocks = template.build(input)
    assert.ok(blocks.length >= 4, `${template.key} has blocks`)
    assert.equal(blocks.at(-1)?.type, 'footer', `${template.key} ends with a footer`)
    assert.ok(blocks.every((block) => blockDefinition(block.type)), `${template.key} uses only known blocks`)
    assert.ok(template.title(input).length > 0)
    const html = renderBlocks(blocks, context)
    assert.ok(!html.includes('Unknown block'), `${template.key} renders`)
  }
  const types = (blocks: ReturnType<typeof productTemplate>) => blocks.map((block) => block.type)
  const product = types(productTemplate(input))
  for (const expected of ['rating-strip', 'buy-box', 'delivery-estimate', 'how-it-works', 'specs', 'comparison', 'expert-quote', 'review-wall', 'product-qa', 'sticky-cta']) assert.ok(product.includes(expected), `product page has ${expected}`)
  assert.equal(productTemplate(input).find((block) => block.type === 'buy-box')?.settings.buyNow, false, 'a product page adds to cart')
  assert.equal(productTemplate(input).find((block) => block.type === 'review-wall')?.settings.histogram, true)
  const sales = types(salesTemplate(input))
  for (const expected of ['gallery', 'pull-quote', 'stats', 'cost-comparison', 'timeline', 'value-stack', 'expert-quote', 'payment-icons', 'buy-box']) assert.ok(sales.includes(expected), `sales page has ${expected}`)
  assert.ok(sales.indexOf('button') < sales.indexOf('stats'), 'the first button comes before the long argument')
  const science = types(scienceTemplate(input))
  for (const expected of ['stats', 'studies', 'timeline', 'video-wall', 'letter', 'value-stack']) assert.ok(science.includes(expected), `science page has ${expected}`)
  const checkout = checkoutTemplate(input)
  assert.equal(checkout.filter((block) => block.type === 'checkout-form').length, 1)
  assert.ok(types(checkout).indexOf('checkout-steps') < types(checkout).indexOf('checkout-form'))
  assert.equal(pageTemplate('checkout').role, 'checkout')
  assert.equal(pageTemplate('made-up').key, 'blank', 'an unknown key is the blank page')

  const { db, store } = shop()
  assert.equal(liveCheckoutPage(db, store.id), null)
  const draft = createPage(db, store.id, { title: 'Checkout', kind: 'checkout', role: 'checkout', blocks: checkout })
  assert.equal(liveCheckoutPage(db, store.id), null, 'a draft is not the live checkout')
  assert.equal(liveCheckoutPage(db, store.id, { preview: true })?.id, draft.id, 'but it is the preview one')
  updatePage(db, store.id, draft.id, { status: 'published' })
  assert.equal(liveCheckoutPage(db, store.id)?.id, draft.id)
})

/* ---------------------------------------------------------------- pages */

test('pages are created, updated, and one of them can be the home page', () => {
  const { db, store } = shop()
  const page = createPage(db, store.id, { title: 'Why switch', blocks: [newBlock('headline', { text: 'Hi' })] })
  assert.equal(page.handle, 'why-switch')
  assert.equal(createPage(db, store.id, { title: 'Why switch' }).handle, 'why-switch-2')
  updatePage(db, store.id, page.id, { isHome: true })
  assert.equal(homePage(db, store.id), null, 'a draft home is not public')
  assert.equal(homePage(db, store.id, { preview: true })?.id, page.id, 'but the theme designer previews the selected draft home')
  updatePage(db, store.id, page.id, { status: 'published', isHome: true })
  assert.equal(homePage(db, store.id)?.id, page.id)
  const other = createPage(db, store.id, { title: 'Other', status: 'published' })
  updatePage(db, store.id, other.id, { isHome: true })
  assert.equal(homePage(db, store.id)?.id, other.id, 'only one home at a time')
  assert.equal(getPage(db, store.id, page.id)?.isHome, false)
  const html = renderBlocks(getPage(db, store.id, page.id)!.blocks, blockContextFor(db, store, ''))
  assert.match(html, /Hi/)
})

test('every builder save is a named page revision that can be restored', () => {
  const { db, store } = shop()
  const page = createPage(db, store.id, { title: 'First draft', blocks: [newBlock('headline', { text: 'Original' })] })
  assert.equal(listPageRevisions(db, store.id, page.id).length, 1)
  const changed = updatePage(db, store.id, page.id, { title: 'Second draft', blocks: [newBlock('headline', { text: 'Changed' })] })
  savePageRevision(db, changed, 'Saved from builder')
  const revisions = listPageRevisions(db, store.id, page.id)
  assert.equal(revisions[0]?.version, 2)
  assert.equal(revisions[0]?.snapshot.title, 'Second draft')
  const restored = restorePageRevision(db, store.id, page.id, revisions[1]!.id)
  assert.equal(restored.title, 'First draft')
  assert.equal(restored.blocks[0]?.settings.text, 'Original')
  assert.match(listPageRevisions(db, store.id, page.id)[0]!.note, /Restored version 1/)
})

test('the page builder ships valid, safely embedded client code', () => {
  const { db, store } = shop()
  const title = 'A </script><script>alert(1)</script> title'
  const page = createPage(db, store.id, { title, blocks: [newBlock('headline', { text: title })] })
  const html = editorPage({ page, storeSlug: store.slug, products: [], revisions: listPageRevisions(db, store.id, page.id) })
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  scripts.forEach((match) => assert.doesNotThrow(() => new Function(match[1] ?? '')))
  assert.equal(scripts.length, 6)
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /Save history/)
  assert.match(html, /sandbox="allow-same-origin"/)
  assert.match(html, /id="preview-draft"/)
  assert.match(html, /data-width="1200px"/)
})

/* ---------------------------------------------------------------- clone */

test('cloning inlines stylesheets, makes URLs absolute, drops scripts and keeps the words', async () => {
  const pages: Record<string, { type: string; body: string }> = {
    'https://ref.example.com/landing': {
      type: 'text/html',
      body: `<!doctype html><html><head><title>Ref &ndash; Page &#x2122;</title><meta name="description" content="A reference &amp; source"><base href="/x/">
        <link rel="stylesheet" href="../site.css"><script src="/track.js"></script><meta http-equiv="Content-Security-Policy" content="default-src 'self'"></head>
        <body onload="track()"><h1>Reference headline</h1><img src="img/hero.png" srcset="img/hero.png 1x, img/hero@2x.png 2x"><p>Long enough paragraph to survive extraction into a block.</p><a href="/buy">Buy</a><script>alert(1)</script></body></html>`,
    },
    'https://ref.example.com/site.css': { type: 'text/css', body: 'body{background:url(bg.png)} @import "more.css";' },
    'https://ref.example.com/x/img/hero.png': { type: 'image/png', body: 'PNG' },
    'https://ref.example.com/x/img/hero@2x.png': { type: 'image/png', body: 'PNG' },
    'https://ref.example.com/bg.png': { type: 'image/png', body: 'PNG' },
  }
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input)
    const found = pages[url]
    if (!found) return new Response('nope', { status: 404 })
    const body = found.type === 'image/png' ? Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64') : found.body
    return new Response(body as never, { status: 200, headers: { 'content-type': found.type } })
  }) as typeof fetch

  const result = await clonePage('https://ref.example.com/landing', { storeId: 'store_clone', fetchImpl })
  assert.equal(result.title, 'Ref – Page ™')
  assert.equal(result.description, 'A reference & source')
  assert.equal(result.stylesheets, 1)
  assert.match(result.html, /<style data-cloned-from="https:\/\/ref\.example\.com\/site\.css">/)
  assert.match(result.html, /url\(\/_uploads\/store_clone\/up_[a-z0-9]+\.png\)/, 'CSS background images are owned too')
  assert.match(result.html, /href="https:\/\/ref\.example\.com\/buy"/, 'links absolute')
  assert.ok(!result.html.includes('<base'), 'base tag removed')
  assert.ok(!result.html.includes('Content-Security-Policy'))
  assert.ok(!/<script/i.test(result.html), 'scripts dropped by default')
  assert.ok(!/onload=/i.test(result.html), 'inline handlers dropped')
  assert.equal(result.imagesLocalized, 3)
  assert.match(result.html, /src="\/_uploads\/store_clone\/up_[a-z0-9]+\.png"/, 'the image now lives here')
  assert.match(result.html, /srcset="\/_uploads\/store_clone\/up_[a-z0-9]+\.png 1x, \/_uploads\/store_clone\/up_[a-z0-9]+\.png 2x"/, 'responsive candidates are localized rather than left on the source CDN')
  assert.ok(result.notes.some((note) => /Dropped 2 scripts/.test(note)))

  const kept = await clonePage('https://ref.example.com/landing', { storeId: 'store_clone', fetchImpl, keepScripts: true, localizeImages: false })
  assert.match(kept.html, /<script src="https:\/\/ref\.example\.com\/track\.js">/)

  const blocks = extractBlocks(result.html)
  assert.deepEqual(blocks.map((block) => block.type), ['headline', 'image', 'rich-text'])
  assert.equal(blocks[0]?.settings.text, 'Reference headline')
})

/* -------------------------------------------------------------- bundles */

test('a bundle enforces its tiers in the cart and hands out the gift only while the tier holds', () => {
  const { db, store, glove, wraps } = shop()
  const bundle = upsertBundle(db, store.id, {
    productId: glove.id,
    tiers: [
      { quantity: 1, discountPercent: 0, label: 'One' },
      { quantity: 2, discountPercent: 10, label: 'Two', freeShipping: true },
      { quantity: 3, discountPercent: 20, label: 'Three', giftVariantId: wraps.variants[0]!.id, giftLabel: 'free wraps' },
    ],
  })
  assert.equal(bundleFor(db, store.id, glove.id)?.id, bundle.id)
  assert.equal(tierFor(bundle, 2)?.label, 'Two')
  assert.equal(tierFor(bundle, 5)?.label, 'Three')

  const widget = renderBundleWidget(bundle, glove, 'USD')
  assert.match(widget, /Save 10%/)
  assert.match(widget, /\$180\.00/, 'two at 10% off')
  assert.match(widget, /\$80\.00 each/, 'three at 20% off, per unit')
  assert.match(widget, /free wraps/)

  const one = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  assert.equal(totals(db, store.id, one).discountCents, 0)
  assert.equal(totals(db, store.id, one).shippingCents, 900)

  const two = setQuantity(db, store.id, one.id, glove.variants[0]!.id, 2)
  const twoTotals = totals(db, store.id, two)
  assert.equal(twoTotals.discountCents, 2000, '10% off 20000')
  assert.equal(twoTotals.shippingCents, 0, 'free shipping unlocked by the tier')
  assert.ok(!two.items.some((item) => item.giftOf), 'no gift yet')

  const three = setQuantity(db, store.id, two.id, glove.variants[0]!.id, 3)
  const gift = three.items.find((item) => item.giftOf === glove.id)
  assert.ok(gift, 'the gift appears at three')
  assert.equal(gift?.unitCents, 0)
  assert.equal(totals(db, store.id, three).discountCents, 6000)

  const back = setQuantity(db, store.id, three.id, glove.variants[0]!.id, 1)
  assert.ok(!back.items.some((item) => item.giftOf), 'the gift leaves with the tier')

  // Creating it again replaces the promotions rather than stacking them.
  upsertBundle(db, store.id, { productId: glove.id, tiers: [{ quantity: 2, discountPercent: 50, label: 'Half' }] })
  const active = listPromotions(db, store.id).filter((promotion) => promotion.status === 'active')
  assert.equal(active.length, 1)
  assert.equal(totals(db, store.id, setQuantity(db, store.id, back.id, glove.variants[0]!.id, 2)).discountCents, 10000)

  removeBundle(db, store.id, bundle.id)
  assert.equal(listPromotions(db, store.id).filter((promotion) => promotion.status === 'active').length, 0)
})

test('a product bundle does not stack with a store-wide quantity discount', () => {
  const { db, store, glove } = shop()
  const { createPromotion } = require_promotions()
  createPromotion(db, store.id, { title: 'Buy two, save 15%', kind: 'bundle', value: 15, rules: { buyQuantity: 2 } })
  upsertBundle(db, store.id, { productId: glove.id, tiers: [{ quantity: 2, discountPercent: 25, label: 'Two' }] })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 2)
  const amounts = totals(db, store.id, cart)
  assert.equal(amounts.discountCents, 5000, 'the better of 15% and 25%, not 40%')
  assert.equal(amounts.appliedPromotions.filter((entry) => entry.amountCents > 0).length, 1)
})

test('the gift is reserved from stock when the order is placed', () => {
  const { db, store, glove, wraps } = shop()
  upsertBundle(db, store.id, { productId: glove.id, tiers: [{ quantity: 2, discountPercent: 10, label: 'Two', giftVariantId: wraps.variants[0]!.id }] })
  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 2)
  const order = completeCart(db, store.id, cart.id, { email: 'b@example.com' })
  assert.equal(order.items.length, 2)
  assert.equal(getVariant(db, store.id, wraps.variants[0]!.id)?.inventory, 19)
  // 20000 less the 10% tier, plus standard shipping: the gift itself costs nothing.
  assert.equal(order.totalCents, 18900)
})

/* --------------------------------------------------------------- stripe */

test('the stripe client speaks form-encoding and reads errors', async () => {
  assert.equal(formBody({ amount: 100, automatic_payment_methods: { enabled: true }, metadata: { a: 'b c' } }), 'amount=100&automatic_payment_methods%5Benabled%5D=true&metadata%5Ba%5D=b%20c')
  const calls: Array<{ path: string; body?: string }> = []
  const client = stripeClient('sk_test_x', async (path, init) => {
    calls.push({ path, ...(init.body ? { body: init.body } : {}) })
    if (path.startsWith('/v1/refunds')) return { ok: false, status: 400, json: async () => ({ error: { message: 'Charge already refunded' } }) }
    return { ok: true, status: 200, json: async () => ({ id: 'pi_1', status: 'succeeded', client_secret: 'pi_1_secret', amount: 1000, currency: 'usd', customer: 'cus_1', payment_method: 'pm_1' }) }
  })
  const intent = await client.paymentIntents.create({ amountCents: 1000, currency: 'USD', customerId: 'cus_1', saveForLater: true })
  assert.equal(intent.client_secret, 'pi_1_secret')
  assert.match(calls[0]?.body ?? '', /setup_future_usage=off_session/)
  assert.match(calls[0]?.body ?? '', /currency=usd/)
  await client.paymentIntents.chargeOffSession({ amountCents: 500, currency: 'USD', customerId: 'cus_1', paymentMethodId: 'pm_1' })
  assert.match(calls[1]?.body ?? '', /off_session=true&confirm=true/)
  await assert.rejects(() => client.refunds.create({ paymentIntentId: 'pi_1' }), /already refunded/)
})

test('webhook signatures are verified with tolerance and constant time', () => {
  const payload = '{"type":"charge.refunded"}'
  const header = signWebhook(payload, 'whsec_test', 1_700_000_000)
  assert.ok(verifyWebhookSignature(payload, header, 'whsec_test', 300, 1_700_000_100))
  assert.ok(!verifyWebhookSignature(payload, header, 'whsec_other', 300, 1_700_000_100))
  assert.ok(!verifyWebhookSignature(payload + ' ', header, 'whsec_test', 300, 1_700_000_100))
  assert.ok(!verifyWebhookSignature(payload, header, 'whsec_test', 300, 1_700_001_000), 'stale')
  assert.ok(!verifyWebhookSignature(payload, 'garbage', 'whsec_test'))
})

/* --------------------------------------------------------------- checkout */

test('a chosen shipping method changes the total, and the upsell adds to the same order', () => {
  const { db, store, glove, wraps } = shop()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, glove.variants[0]!.id, 1)
  const region = (db.one<{ id: string }>('SELECT id FROM regions WHERE store_id = ?', store.id))!
  const express = db.one<{ id: string }>("SELECT id FROM shipping_options WHERE region_id = ? AND name LIKE 'Express%'", region.id)!
  const standard = totals(db, store.id, cart)
  assert.equal(standard.shippingCents, 900)
  const fast = totals(db, store.id, setShipping(db, store.id, cart.id, express.id))
  assert.equal(fast.shippingCents, 2400)
  assert.equal(fast.shippingOptionId, express.id)

  const order = completeCart(db, store.id, cart.id, { email: 'b@example.com', payment: { provider: 'demo' } })
  assert.equal(order.shippingOptionId, express.id)
  assert.equal(order.totalCents, 12400)
  const accepted = recordUpsell(db, store.id, order.id, { offered: wraps.variants[0]!.id, accepted: true, line: { variantId: wraps.variants[0]!.id, productId: wraps.id, title: wraps.title, variantTitle: '180in', image: '', unitCents: 1600, quantity: 1, source: 'post-purchase' }, amountCents: 1600 })
  assert.equal(accepted.totalCents, 14000)
  assert.equal(accepted.items.length, 2)
  assert.equal(accepted.upsell.accepted, true)
  assert.equal(getVariant(db, store.id, wraps.variants[0]!.id)?.inventory, 19)
})

/* ---------------------------------------------------------------- tools */

test('the assistant can build a page and a bundle', async () => {
  const { db, store, user, glove } = shop()
  const ctx = { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } }
  const created = await execute('create_page', { template: 'advertorial', productId: glove.id, publish: true }, ctx)
  const pageId = (created.data as { id: string }).id
  assert.ok(getPage(db, store.id, pageId)?.blocks.some((block) => block.type === 'buy-box'))
  await execute('add_block', { pageId, type: 'countdown', settings: { text: 'Ends in' } }, ctx)
  assert.equal(getPage(db, store.id, pageId)?.blocks.at(-1)?.type, 'countdown')
  const bundle = await execute('create_bundle', { productId: glove.id }, ctx)
  assert.match(bundle.summary, /3 tiers/)
  assert.ok(bundleFor(db, store.id, glove.id))
  assert.ok(blockDefinition('bundle-offer'))
})

test('the assistant can read a page back and edit the blocks on it', async () => {
  // It could add blocks and never touch them again: no way to see what was on
  // a page, change a headline, reorder it or take a section off. The only edit
  // available was building the page a second time.
  const { db, store, user, glove } = shop()
  const ctx = { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } }
  const created = await execute('create_page', { template: 'advertorial', productId: glove.id }, ctx)
  const pageId = (created.data as { id: string }).id
  await execute('add_block', { pageId, type: 'countdown', settings: { text: 'Ends in' } }, ctx)

  const read = await execute('read_page', { pageId }, ctx)
  const blocks = (read.data as { blocks: Array<{ position: number; id: string; type: string; settings: Record<string, unknown> }> }).blocks
  assert.equal(blocks.at(-1)?.type, 'countdown')
  assert.equal(blocks.at(-1)?.settings.text, 'Ends in')
  assert.equal(blocks[0]?.position, 0, 'every block comes back with the position the edit tools address it by')

  const countdown = blocks.at(-1)!
  await execute('update_block', { pageId, blockId: countdown.id, settings: { text: 'Ends tonight' } }, ctx)
  const edited = getPage(db, store.id, pageId)!.blocks.find((block) => block.id === countdown.id)
  assert.equal(edited?.settings.text, 'Ends tonight')
  assert.ok(Object.keys(edited?.settings ?? {}).length > 1, 'a partial update merges rather than replacing the settings')

  await execute('move_block', { pageId, blockId: countdown.id, to: 0 }, ctx)
  assert.equal(getPage(db, store.id, pageId)?.blocks[0]?.id, countdown.id)

  const before = getPage(db, store.id, pageId)!.blocks.length
  await execute('remove_block', { pageId, position: 0 }, ctx)
  const after = getPage(db, store.id, pageId)!.blocks
  assert.equal(after.length, before - 1)
  assert.ok(!after.some((block) => block.id === countdown.id))

  await assert.rejects(execute('update_block', { pageId, blockId: 'blk_nope', settings: {} }, ctx), /read_page/)
  await assert.rejects(execute('remove_block', { pageId, position: 99 }, ctx), /read_page/)
})

test('bundle tiers re-price against the variant the buyer picks', () => {
  // The widget is rendered once, from the cheapest variant. On a product where
  // the large size costs more, the three-pack quoted the small size's total
  // and the cart charged the large one — the page said $240 and the customer
  // paid $360.
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Sizes', prompt: 'sizes' })
  seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, {
    title: 'Tee',
    status: 'published',
    variants: [{ title: 'Small', priceCents: 4000, inventory: 5 }, { title: 'Large', priceCents: 6000, inventory: 5 }],
  })
  upsertBundle(db, store.id, { productId: product.id, tiers: [{ quantity: 1, discountPercent: 0, label: 'One' }, { quantity: 3, discountPercent: 20, label: 'Three' }] })
  const widget = renderBundleWidget(bundleFor(db, store.id, product.id)!, product, 'USD', { variantPriceCents: 4000 })
  assert.match(widget, /data-discount="20"/, 'the tier carries what it is worth, not only what it costs today')
  assert.match(widget, /<b data-tier-total>\$96\.00<\/b>/, 'three small at 20% off')

  const view = { db, store, env: environment(db, store.id, 'draft'), base: `/s/${store.slug}`, preview: false, cart: null, totals: null }
  const pdp = productPage(view as never, { product: getProduct(db, store.id, product.id)!, stats: statsFor(db, store.id, product.id), reviews: [], companions: [] })
  assert.match(pdp, /data-tier-total/, 'and the page can find the number to change')
  assert.match(pdp, /input\.dataset\.discount/, 'picking a variant re-prices every tier from that variant')
})

test('the buybox promises only what the store has actually configured', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Bare', prompt: 'bare' })
  seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, { title: 'Serum', status: 'published', variants: [{ title: 'One', priceCents: 4000, inventory: 5 }] })
  const view = { db, store, env: environment(db, store.id, 'draft'), base: `/s/${store.slug}`, preview: false, cart: null, totals: null }

  const render = (item: typeof product) => productPage(view as never, { product: item, stats: statsFor(db, store.id, item.id), reviews: [], companions: [] })
  const pdp = render(product)
  assert.ok(!/delivery by/.test(pdp), 'no supplier means no invented shipping date')
  assert.ok(!/PayPal/.test(pdp), 'the platform does not implement PayPal, so no page claims it')
  assert.ok(!/VISA/.test(pdp), 'and with no provider connected the store cannot take a card')
  assert.ok(!/Repaired in-house/.test(pdp), 'the demo store\'s promises are not this store\'s')
  assert.match(pdp, /Free shipping over \$200\.00/, 'the threshold is the one on the region')

  updateProduct(db, store.id, product.id, { supplier: { processingDays: 1, shippingDaysMin: 3, shippingDaysMax: 5 } })
  const withSupplier = render(getProduct(db, store.id, product.id)!)
  assert.match(withSupplier, /delivery by/, 'once the merchant says how long it takes, the estimate is theirs to show')
})

test('a review left on the storefront waits for the merchant', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Mod', prompt: 'mod' })
  const product = createProduct(db, store.id, { title: 'Glove', status: 'published', variants: [{ title: 'One', priceCents: 4000, inventory: 5 }] })
  createReview(db, store.id, { productId: product.id, rating: 1, body: 'unverifiable', author: 'Passer-by', status: 'pending' })
  assert.equal(statsFor(db, store.id, product.id).count, 0, 'a pending review is in no rating and on no page')
})

test('a block setting the owner cleared stays cleared', () => {
  // Any catalog block that ships copy in a string setting will do.
  const found = BLOCKS.map((entry) => blockDefinition(entry.type))
    .filter((definition): definition is NonNullable<typeof definition> => Boolean(definition))
    .flatMap((definition) =>
      Object.entries(definition.schema)
        .filter(([, field]) => field.type === 'string' && typeof (field as { default?: unknown }).default === 'string' && String((field as { default?: unknown }).default).length > 6)
        .map(([key, field]) => ({ definition, key, fallback: String((field as { default?: unknown }).default) })),
    )[0]
  assert.ok(found, 'the catalog ships blocks with stock copy in their string settings')
  const cleared = renderBlock({ id: 'b1', type: found.definition.type, settings: { [found.key]: '' } }, context)
  assert.ok(
    !cleared.includes(found.fallback),
    `deleting ${found.definition.type}.${found.key} must not bring "${found.fallback}" back at render`,
  )
})

test('a split-test version served at the product URL is that product, to a crawler', () => {
  const { db, store, glove } = shop()
  const version = createPage(db, store.id, {
    title: 'The Glove — benefit-led · Coach Mara (premium, focus on the wrist)',
    kind: 'product',
    role: 'pdp',
    productId: glove.id,
    status: 'published',
    weight: 100,
    blocks: [newBlock('headline', { text: 'Buy it' })],
  })
  const view = { db, store, env: environment(db, store.id, 'draft'), base: `/s/${store.slug}`, preview: false, cart: null, totals: null }
  const asItself = blockPage(view as never, version)
  assert.match(asItself, /Coach Mara/, 'at its own address it is the version')

  const asProduct = blockPage(view as never, version, {
    title: `${glove.title} — ${store.name}`,
    description: glove.subtitle || glove.title,
    canonical: `/s/${store.slug}/products/${glove.handle}`,
  })
  assert.ok(!/Coach Mara/.test(asProduct), 'at the product address the operator\'s internal name is not the title')
  assert.match(asProduct, new RegExp(`rel="canonical" href="[^"]*/products/${glove.handle}"`), 'and the canonical is the product, not a page nobody links to')
})

test('a cloned page carries its own meta, not the site it was copied from', () => {
  const { db, store } = shop()
  const source = `<!doctype html><html><head><title>Their Brand — Buy Now</title>
    <meta name="description" content="Their words">
    <link rel="canonical" href="https://competitor.example/offer">
    <link rel="stylesheet" href="https://competitor.example/theme.css">
    <meta property="og:title" content="Their Brand"></head><body><h1>Offer</h1>
    <a href="/">Return</a><a href="/products/widget?one=1&amp;two=2">Widget</a><a href="https://competitor.example/pages/about#team">About</a>
    <form action="/contact"><button formaction="/contact/quick">Send</button></form><img src="/logo.png"></body></html>`
  const page = createPage(db, store.id, {
    title: 'Our offer',
    kind: 'landing',
    mode: 'html',
    rawHtml: source,
    sourceUrl: 'https://competitor.example/offer',
    seo: { title: 'Our offer — Bundle Co', description: 'What we actually sell' },
    headHtml: '<meta name="robots" content="index">',
    status: 'published',
  })
  const view = { db, store, env: environment(db, store.id, 'draft'), base: `/s/${store.slug}`, preview: false, cart: null, totals: null }
  const out = htmlPage(view as never, getPage(db, store.id, page.id)!)

  assert.match(out, /<title>Our offer — Bundle Co<\/title>/)
  assert.ok(!/Their Brand — Buy Now/.test(out), 'the source title is gone, not sitting beside ours')
  assert.match(out, /content="What we actually sell"/)
  assert.ok(!/competitor\.example\/offer"/.test(out.match(/rel="canonical"[^>]*/)?.[0] ?? ''), 'the canonical is ours')
  assert.match(out, new RegExp(`rel="canonical" href="[^"]*/pages/${page.handle}"`))
  assert.match(out, /name="robots" content="index"/, 'and the extra head is emitted at all')
  assert.match(out, new RegExp(`href="/s/${store.slug}/"`), 'return stays in the mounted store instead of opening the Amboras admin')
  assert.match(out, new RegExp(`href="/s/${store.slug}/products/widget\\?one=1&amp;two=2"`))
  assert.match(out, new RegExp(`href="/s/${store.slug}/pages/about#team"`), 'same-origin absolute links are rebased too')
  assert.match(out, new RegExp(`action="/s/${store.slug}/contact"`))
  assert.doesNotMatch(out, /\sformaction=/, 'copied submit buttons use the store-owned form action, never an unimplemented source endpoint')
  assert.match(out, /href="https:\/\/competitor\.example\/theme\.css"/, 'stylesheet URLs are not mistaken for navigation')
  assert.match(out, /src="\/logo\.png"/, 'asset paths are not rebased')

  const missing = notFoundPage({ ...view, env: { ...view.env, brand: { primary: '#123456', paper: '#fefefe', ink: '#102030', displayFont: 'Poppins, sans-serif', bodyFont: 'Inter, sans-serif' } } } as never)
  assert.match(missing, /That page is not here/)
  assert.match(missing, /#123456/)
  assert.match(missing, /family=Poppins/)
  assert.match(missing, new RegExp(`href="/s/${store.slug}/"`))
})
