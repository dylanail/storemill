import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { brandFromClone, createBlankAsset, fontFamiliesFromClone, importAssetFromUrl, navigationFromClone, productPathsFromClone } from '../src/control/assets.ts'
import { getStore, listStores } from '../src/control/stores.ts'
import { buildState } from '../src/control/build.ts'
import { listFunnels } from '../src/domain/funnels.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { createPage, newBlock } from '../src/pages/store.ts'
import { listStoreMedia } from '../src/control/media.ts'
import { storePage, storesPage } from '../src/admin/pages.ts'
import { shell } from '../src/admin/shell.ts'

test('stores and funnels are separate top-level assets', () => {
  const { db, user } = fresh()
  const store = createBlankAsset(db, user.id, { name: 'Catalog Brand', kind: 'store', currency: 'USD' })
  const funnel = createBlankAsset(db, user.id, { name: 'Focused Offer', kind: 'funnel', currency: 'EUR' })

  assert.equal(getStore(db, store.id)?.kind, 'store')
  assert.equal(getStore(db, funnel.id)?.kind, 'funnel')
  assert.equal(buildState(db, store.id).shape, 'store')
  assert.equal(buildState(db, funnel.id).shape, 'funnel')
  assert.equal(db.one<{ c: number }>('SELECT COUNT(*) c FROM regions WHERE store_id = ?', funnel.id)?.c, 1)

  const html = storesPage({ db, store, userName: 'Owner', storeUrl: `/s/${store.slug}` }, listStores(db, user.id))
  assert.match(html, /Stores & funnels/)
  assert.match(html, /Today/)
  assert.match(html, /30 days/)
  assert.match(html, /data-kind="store"/)
  assert.match(html, /data-kind="funnel"/)
  assert.match(html, /data-new-asset/)
  assert.match(html, /Cancel clone/)
  assert.match(html, new RegExp(`/preview/${store.slug}`), 'draft assets open their private preview')

  const funnelShell = shell({ store: funnel, stores: [store, funnel], active: 'funnels', title: 'Funnel', body: '', todos: [], messages: [], queue: [], publish: { label: 'Publish funnel', ready: false, reason: '' }, userName: 'Owner', storeUrl: `/s/${funnel.slug}` })
  assert.match(funnelShell, /Funnel pages/)
  assert.match(funnelShell, /Funnel flow/)
  assert.doesNotMatch(funnelShell, /Theme &amp; navigation/)
  const storeShell = shell({ store, stores: [store, funnel], active: 'store', title: 'Store', body: '', todos: [], messages: [], queue: [], publish: { label: 'Publish store', ready: false, reason: '' }, userName: 'Owner', storeUrl: `/s/${store.slug}` })
  assert.match(storeShell, /Theme &amp; navigation/)
  assert.doesNotMatch(storeShell, /Funnel flow/)
  assert.match(storeShell, new RegExp(`href="/preview/${store.slug}"[^>]*>Preview store`))
})

test('a URL creates an editable asset and strips source scripts', async () => {
  const { db, user } = fresh()
  const source = '<!doctype html><html><head><title>North Star | Shop</title><meta name="description" content="A useful shop"></head><body><h1>North Star</h1><img src="https://cdn.northstar.example/logo.png"><a href="/products/widget?variant=2">Widget</a><script>window.tracker=true</script></body></html>'
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
  const fetchImpl = (async (input: string | URL | Request) => {
    const target = String(input)
    if (target.endsWith('/products/widget.json')) return new Response(JSON.stringify({ product: {
      title: 'North Star Widget', body_html: '<p>A structured product.</p>', vendor: 'North Star',
      images: [{ id: 1, src: 'https://cdn.northstar.example/widget-hero.png' }, { id: 2, src: 'https://cdn.northstar.example/widget-detail.png' }],
      options: [{ name: 'Title', values: ['Default Title'] }],
      variants: [{ title: 'Default Title', price: '29.00', sku: 'NS-WIDGET', image_id: 1 }],
    } }), { status: 200, headers: { 'content-type': 'application/json' } })
    if (target.startsWith('https://cdn.northstar.example/')) return new Response(image, { status: 200, headers: { 'content-type': 'image/png' } })
    const body = target.includes('/products/widget') ? '<html><head><title>Widget | North Star</title></head><body><h1>Widget</h1><img src="https://cdn.northstar.example/widget-hero.png"></body></html>' : source
    const response = new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
    Object.defineProperty(response, 'url', { value: target })
    return response
  }) as typeof fetch

  const imported = await importAssetFromUrl(db, user.id, { url: 'https://northstar.example/', kind: 'funnel', fetchImpl })
  assert.equal(imported.store.kind, 'funnel')
  assert.equal(imported.page.mode, 'html')
  assert.equal(imported.page.role, 'offer')
  assert.equal(imported.page.sourceUrl, 'https://northstar.example/')
  assert.doesNotMatch(imported.page.rawHtml, /window\.tracker/)
  assert.equal(listFunnels(db, imported.store.id)[0]?.offerPageId, imported.page.id)

  const storeImport = await importAssetFromUrl(db, user.id, { url: 'https://northstar.example/', kind: 'store', fetchImpl })
  assert.equal(storeImport.pages.length, 3)
  assert.ok(storeImport.pages.some(page => page.role === 'checkout'))
  assert.equal(storeImport.products.length, 1)
  const product = storeImport.products[0]!
  assert.equal(product.title, 'North Star Widget')
  assert.equal(product.variants[0]?.priceCents, 2900)
  assert.ok(product.heroImage.startsWith(`/_uploads/${storeImport.store.id}/`))
  assert.equal(product.media[0]?.url, product.heroImage, 'the hero is retained in the product photo gallery')
  assert.equal(product.media.length, 2)
  assert.ok(product.media.every((entry) => entry.url.startsWith(`/_uploads/${storeImport.store.id}/`)))
  assert.equal(product.variants[0]?.image, product.heroImage)
  assert.equal(storeImport.pages[1]?.productId, product.id)
  assert.match(storeImport.page.rawHtml, new RegExp(`/pages/${storeImport.pages[1]?.handle}`))
  assert.doesNotMatch(storeImport.page.rawHtml, /northstar\.example\/products/)
  const designer = storePage({ db, store: storeImport.store, userName: 'Owner', storeUrl: `/s/${storeImport.store.slug}` }, [])
  assert.match(designer, /From your imported site/)
  assert.match(designer, /Your imported page keeps its layout/)
  assert.match(designer, new RegExp(`iframe id="designer-preview" src="/preview/${storeImport.store.slug}"`))
})

test('a cloned theme contributes its palette and typography to reusable blocks', () => {
  assert.deepEqual(brandFromClone(`<style>:root {
    --color-base-accent-1: 49, 128, 55;
    --color-base-accent-2: #f4a261;
    --color-base-background-1: 255,255,252;
    --color-base-text: #132016;
    --font-heading-family: "Poppins", sans-serif;
    --font-body-family: Inter, sans-serif;
  }</style>`), {
    primary: '#318037',
    secondary: '#f4a261',
    paper: '#fffffc',
    ink: '#132016',
    displayFont: 'Poppins',
    bodyFont: 'Inter',
    fonts: ['Poppins', 'Inter'],
  })
  assert.deepEqual(brandFromClone('<style>:root{--primary:999,0,0;--body-font:var(--system-font)}</style>'), {})
  assert.deepEqual(fontFamiliesFromClone('<style>@font-face{font-family:"Cloned Display"}body{font-family:"Cloned Body", sans-serif}.x{font-family:var(--body)}</style>'), ['Cloned Display', 'Cloned Body'])
  assert.deepEqual(brandFromClone('<style>h1,.headline{font-family:"Cloned Display", serif} body{font-family:Cloned Body, sans-serif}</style>'), {
    displayFont: 'Cloned Display',
    bodyFont: 'Cloned Body',
    fonts: ['Cloned Display', 'Cloned Body'],
  })
})

test('clone font discovery omits system stacks and icon-only families', () => {
  const html = `<style>body{font-family:-apple-system,Arial,sans-serif}.code{font-family:SFMono-Regular,monospace}.icon{font-family:"Font Awesome 5 Free"}.copy{font-family:"DM Sans",sans-serif}</style>`
  assert.deepEqual(fontFamiliesFromClone(html), ['DM Sans'])
})

test('a cloned header becomes site navigation and a cancelled clone creates nothing', async () => {
  assert.deepEqual(navigationFromClone(`<header>
    <a href="https://source.example/">Source logo</a>
    <nav><a href="/collections/all">Catalog</a><a href="https://source.example/pages/about?from=nav">About us</a><a href="/cart">Cart</a><a href="https://outside.example/">Elsewhere</a></nav>
  </header>`, 'https://source.example/', [
    { source: 'https://source.example/', target: '/' },
    { source: 'https://source.example/pages/about', target: '/pages/about-us' },
  ]), [
    { label: 'Home', href: '/' },
    { label: 'Catalog', href: '/collections/all' },
    { label: 'About us', href: '/pages/about-us' },
  ])
  assert.deepEqual(productPathsFromClone('<a href="/products/widget?variant=2">Widget</a><a href="https://outside.example/products/nope">Nope</a>', 'https://source.example/'), ['/products/widget'])

  const { db, user } = fresh()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(importAssetFromUrl(db, user.id, { url: 'https://source.example/', kind: 'store', signal: controller.signal }), { name: 'AbortError' })
  assert.equal(listStores(db, user.id).length, 0, 'cancelling before the request starts does not leave a duplicate asset')
})

test('the media library aggregates product and page imagery without duplicates', () => {
  const { db, user } = fresh()
  const store = createBlankAsset(db, user.id, { name: 'Media Brand', kind: 'store' })
  createProduct(db, store.id, {
    title: 'Hero Product',
    heroImage: 'https://cdn.example.com/hero.webp',
    media: [{ url: 'https://cdn.example.com/detail.jpg', alt: 'Detail' }],
    variants: [{ title: 'Default', priceCents: 2000, image: 'https://cdn.example.com/variant.png' }],
  })
  createPage(db, store.id, { title: 'Landing', blocks: [newBlock('image', { src: 'https://cdn.example.com/detail.jpg' }), newBlock('hero', { image: '/_media/render.svg?scene=hero' })] })

  const media = listStoreMedia(db, store.id)
  assert.ok(media.some((asset) => asset.url === 'https://cdn.example.com/hero.webp' && asset.source === 'Product'))
  assert.ok(media.some((asset) => asset.url === 'https://cdn.example.com/variant.png' && asset.source === 'Variant'))
  assert.ok(media.some((asset) => asset.url.startsWith('/_media/render.svg')))
  assert.equal(media.filter((asset) => asset.url === 'https://cdn.example.com/detail.jpg').length, 1)
})
