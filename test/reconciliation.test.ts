import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fresh } from './helpers.ts'
import { Db } from '../src/lib/db.ts'
import { createStore } from '../src/control/stores.ts'
import { install } from '../src/control/plugins.ts'
import { createBlog } from '../src/domain/content.ts'
import { createProduct, getProduct } from '../src/domain/catalog.ts'
import { bundleFor, upsertBundle } from '../src/domain/bundles.ts'
import { addToCart, createCart, totals } from '../src/domain/cart.ts'
import { completeCart, getOrder, markDelivered } from '../src/domain/orders.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'
import { createPage, getPage } from '../src/pages/store.ts'
import { pagesPage, settingsPage } from '../src/admin/pages.ts'
import { sweepReviewRequests } from '../src/email/reviews.ts'

function fixture() {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Merge regression' })
  seedDefaultRegion(db, store.id, 'USD')
  const product = createProduct(db, store.id, { title: 'Original gallery', status: 'published',
    media: Array.from({ length: 9 }, (_, i) => ({ url: `/uploads/original-${i}.jpg`, alt: `Original ${i}` })),
    variants: [{ title: 'Standard', priceCents: 5495, inventory: 100 }] })
  return { db, user, store, product }
}

test('upgrading main through migration 027 keeps copied pages, original media, offer totals and experiment tables', () => {
  const { db, store, product } = fixture()
  const page = createPage(db, store.id, { title: 'Owned checkout', role: 'checkout', mode: 'html', rawHtml: '<main>Copied checkout</main>' })
  upsertBundle(db, store.id, { productId: product.id, pricingMode: 'multiples', tiers: [
    { quantity: 2, label: 'Buy two', discountPercent: 15, totalPriceCents: 9342, compareAtTotalCents: 10990 },
  ] })
  const bundle = bundleFor(db, store.id, product.id)
  // Reconstruct the persisted main schema immediately before this PR's new migration.
  db.exec('ALTER TABLE orders DROP COLUMN review_requested_at')
  db.run('DELETE FROM migrations WHERE name = ?', '028_review_requested')
  const migrations = db.all('SELECT * FROM migrations ORDER BY name')
  const directory = mkdtempSync(join(tmpdir(), 'storemill-upgrade-'))
  const file = join(directory, 'main.db')
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
  let upgraded: Db | undefined
  try {
    upgraded = new Db(file)
    assert.deepEqual(upgraded.all("SELECT * FROM migrations WHERE name != '028_review_requested' ORDER BY name"), migrations)
    assert.deepEqual(getProduct(upgraded, store.id, product.id), product)
    assert.deepEqual(getPage(upgraded, store.id, page.id), page)
    assert.deepEqual(bundleFor(upgraded, store.id, product.id), bundle)
    assert.ok(upgraded.one("SELECT name FROM sqlite_master WHERE name = 'experiments'"), 'active experiment storage must not be dropped')
    assert.ok(upgraded.all<{ name: string }>('PRAGMA table_info(orders)').some(column => column.name === 'review_requested_at'))
    const cart = addToCart(upgraded, store.id, createCart(upgraded, store.id).id, product.variants[0]!.id, 3)
    const amount = totals(upgraded, store.id, cart)
    assert.equal(amount.subtotalCents - amount.discountCents, 9342 + 5495, 'exact packs keep the spare item at regular price')
    upgraded.handle.close()
    upgraded = new Db(file)
    assert.equal(upgraded.one<{ c: number }>("SELECT COUNT(*) c FROM migrations WHERE name = '028_review_requested'")?.c, 1)
  } finally { upgraded?.handle.close(); db.handle.close(); rmSync(directory, { recursive: true, force: true }) }
})

test('engraving survives the cart and order without changing exact pack prices or silently replacing text', () => {
  const { db, store, product } = fixture()
  const variantId = product.variants[0]!.id, cartId = createCart(db, store.id).id
  assert.throws(() => addToCart(db, store.id, cartId, variantId, 1, undefined, undefined, 'DN'), /not available/)
  install(db, store.id, 'engraving', { maxCharacters: 4 })
  assert.throws(() => addToCart(db, store.id, cartId, variantId, 1, undefined, undefined, 'Too long'), /4 characters/)
  const cart = addToCart(db, store.id, cartId, variantId, 1, undefined, undefined, 'DN')
  assert.equal(cart.items[0]?.engraving, 'DN')
  assert.match(cart.items[0]!.variantTitle, /Engraving: DN/)
  assert.throws(() => addToCart(db, store.id, cartId, variantId, 1, undefined, undefined, 'AB'), /different engraving/)
  assert.equal(cart.items[0]?.unitCents, 5495)
  const order = completeCart(db, store.id, cart.id, { email: 'buyer@example.test' })
  assert.equal(getOrder(db, store.id, order.id)?.items[0]?.engraving, 'DN')
})

test('review requests retry failed deliveries and overlapping sweeps do not send twice', async () => {
  const { db, store, product } = fixture()
  const cart = addToCart(db, store.id, createCart(db, store.id).id, product.variants[0]!.id, 1)
  const order = completeCart(db, store.id, cart.id, { email: 'buyer@example.test' })
  markDelivered(db, store.id, order.id)
  db.run('UPDATE orders SET delivered_at = ? WHERE id = ?', new Date(Date.now() - 8 * 86400000).toISOString(), order.id)
  const savedFetch = globalThis.fetch, savedKey = process.env.RESEND_API_KEY
  process.env.RESEND_API_KEY = 'test-only'
  let release: (() => void) | undefined
  try {
    globalThis.fetch = async () => new Response('', { status: 503 })
    assert.equal(await sweepReviewRequests(db), 0)
    assert.equal(db.one<{ review_requested_at: string | null }>('SELECT review_requested_at FROM orders WHERE id = ?', order.id)?.review_requested_at, null)
    let requests = 0
    globalThis.fetch = async () => { requests++; await new Promise<void>(resolve => { release = resolve }); return new Response('{}') }
    const pending = sweepReviewRequests(db)
    assert.equal(await sweepReviewRequests(db), 0)
    release!()
    assert.equal(await pending, 1)
    assert.equal(await sweepReviewRequests(db), 0)
    assert.equal(requests, 1)
  } finally {
    globalThis.fetch = savedFetch
    if (savedKey === undefined) delete process.env.RESEND_API_KEY
    else process.env.RESEND_API_KEY = savedKey
  }
})

test('contact submissions remain readable beside current settings and scheduled blogs appear once', () => {
  const { db, store, user } = fixture()
  const ctx = { db, store, userId: user.id, userName: 'Owner', storeUrl: `/s/${store.slug}` }
  db.insert('audit_log', { id: 'contact-regression', store_id: store.id, actor_type: 'system', actor_id: '', action: 'contact_form', target: 'buyer@example.test', diff: { message: '<script>hello</script>' }, created_at: new Date().toISOString() })
  const settings = settingsPage(ctx)
  assert.match(settings, /&lt;script&gt;hello&lt;\/script&gt;/)
  assert.match(settings, /buyer@example.test/)
  createBlog(db, store.id, 'News')
  const pages = pagesPage(ctx)
  assert.equal((pages.match(/id="blog"/g) || []).length, 1)
  assert.match(pages, /datetime-local/)
})
