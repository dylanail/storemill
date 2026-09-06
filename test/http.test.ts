import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The whole thing, over HTTP, with no mocks: register, onboard from one
 * sentence, walk the admin, drive the assistant, then buy something from the
 * generated storefront and watch the order land in the admin.
 */
const dir = mkdtempSync(join(tmpdir(), 'amboras-test-'))
process.env.AMBORAS_DB = join(dir, 'test.db')
process.env.PORT = '0'
process.env.AMBORAS_LOG_LEVEL = 'error'
// main.ts reads a developer's .env at boot. Set the host variables here so the
// file cannot reach in and change what these assertions are about: anything
// already in the environment wins over the file, empty string included.
process.env.AMBORAS_STOREFRONT_HOST = ''
process.env.AMBORAS_PUBLIC_ORIGIN = ''
process.env.AMBORAS_ADMIN_HOST = ''

const { useStripeTransport } = await import('../src/payments/stripe.ts')
const { server } = await import('../src/main.ts')
await new Promise<void>((resolve) => (server.listening ? resolve() : server.once('listening', () => resolve())))
const address = server.address()
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

after(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

const jar = new Map<string, string>()

const flashOf = (location: string) => decodeURIComponent(location.replace(/\+/g, ' '))

async function call(path: string, init: { method?: string; form?: Record<string, string>; json?: unknown; accept?: string } = {}) {
  const headers: Record<string, string> = { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') }
  if (init.accept) headers.accept = init.accept
  let body: string | undefined
  if (init.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = new URLSearchParams(init.form).toString()
  } else if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const response = await fetch(`${base}${path}`, { method: init.method ?? (init.form || init.json !== undefined ? 'POST' : 'GET'), headers, ...(body ? { body } : {}), redirect: 'manual' })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const [name, value = ''] = (pair ?? '').split('=')
    if (name) jar.set(name.trim(), decodeURIComponent(value))
  }
  return { status: response.status, location: response.headers.get('location') ?? '', headers: response.headers, text: await response.text() }
}

let slug = ''

/**
 * Onboarding is detached: the POST redirects to a page that polls. This walks
 * that for the tests — start the build, poll until it settles, follow it.
 */
async function build(form: Record<string, string>) {
  const started = await call('/onboarding', { form })
  assert.match(started.location, /^\/onboarding\/building\?t=/, 'the build is watched, not waited on')
  const ticket = new URL(started.location, base).searchParams.get('t') ?? ''
  const watching = await call(started.location)
  assert.match(watching.text, /onboarding\/status\?t=/, 'the page polls for the stage rather than holding the request open')
  assert.match(watching.text, /Names the brand and picks a palette/, 'and lists what is happening')
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = JSON.parse((await call(`/onboarding/status?t=${encodeURIComponent(ticket)}`)).text) as { state: string; next?: string; error?: string }
    if (status.state === 'done') return { location: status.next ?? '/admin' }
    if (status.state === 'failed') throw new Error(`build failed: ${status.error}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('build did not finish')
}

test('the root is the admin, and login and register are served', async () => {
  assert.equal((await call('/')).status, 302)
  assert.equal((await call('/')).location, '/admin')
  assert.equal((await call('/about-this-platform')).status, 404, 'there is no marketing site; this is one person\'s admin')
  assert.equal((await call('/login')).status, 200)
  assert.equal((await call('/healthz')).status, 200)
  assert.equal((await call('/nope')).status, 404)
})

test('a forgotten password has a way back into the account', async () => {
  // There was none: a forgotten password meant the store, its products, its
  // orders and its connected domain were gone, with no recovery short of
  // editing the database by hand.
  assert.match((await call('/login')).text, /Forgot your password/)

  const { getDb } = await import('../src/lib/db.ts')
  const { register, startPasswordReset, userForReset } = await import('../src/control/auth.ts')
  register(getDb(), { email: 'locked-out@example.com', password: 'the-old-password', name: 'Locked' })

  // The form answers the same either way, so it cannot be used to find out who
  // has an account.
  const unknown = await call('/forgot', { form: { email: 'nobody@example.com' } })
  const known = await call('/forgot', { form: { email: 'locked-out@example.com' } })
  assert.equal(unknown.location.split('&')[0], known.location.split('&')[0])
  assert.match((await call(known.location)).text, /a link is on its way/)
  assert.match((await call(known.location)).text, /written to the server log/, 'with no sender configured it says where the link went, and never shows it')

  const first = startPasswordReset(getDb(), 'locked-out@example.com')!
  const second = startPasswordReset(getDb(), 'locked-out@example.com')!
  assert.equal(userForReset(getDb(), first.token), null, 'asking again kills the earlier link')

  const form = await call(`/reset?token=${encodeURIComponent(second.token)}`)
  assert.equal(form.status, 200)
  assert.match(form.text, /locked-out@example\.com/)
  assert.match((await call('/reset', { form: { token: second.token, password: 'short' } })).location, /\/reset\?token=.*at%20least%2010/, 'a short password comes back to the same form')

  const jarBefore = new Map(jar)
  const done = await call('/reset', { form: { token: second.token, password: 'a-brand-new-password' } })
  assert.match(flashOf(done.location), /Password changed/)
  assert.match((await call('/reset', { form: { token: second.token, password: 'another-new-password' } })).location, /\/forgot\?error=.*already%20been%20used/, 'the link works once')

  // The reset signed this browser in as the recovered user; put the jar back
  // so the rest of the file keeps working as the owner it started as.
  jar.clear()
  for (const [name, value] of jarBefore) jar.set(name, value)
  assert.equal((await call('/login', { form: { email: 'locked-out@example.com', password: 'a-brand-new-password' } })).location, '/admin', 'and the new password is the password')
  jar.clear()
  for (const [name, value] of jarBefore) jar.set(name, value)
})

test('an unauthenticated admin request is sent to the login page', async () => {
  const response = await fetch(`${base}/admin`, { headers: { accept: 'text/html' }, redirect: 'manual' })
  assert.equal(response.status, 302)
  assert.equal(response.headers.get('location'), '/login')
})

test('registering lands on onboarding, and one sentence builds a store', async () => {
  const registered = await call('/register', { form: { email: 'franz@example.com', password: 'a-long-enough-password', name: 'Franz' } })
  assert.equal(registered.location, '/onboarding')
  assert.match((await call('/onboarding')).text, /What are you selling/)


  const short = await call('/onboarding', { form: { prompt: 'shoes' } })
  assert.match(short.location, /error=/, 'a two-word prompt is refused rather than guessed at')

  const built = await build({ prompt: 'A hand-stitched boxing gear store called Ironjaw & Co, heritage leather atelier in Mexico City' })
  assert.match(built.location, /^\/admin\?flash=/)
  assert.match(decodeURIComponent(built.location), /Ironjaw & Co is built/)

  const dashboard = await call('/admin')
  assert.equal(dashboard.status, 200)
  assert.match(dashboard.text, /Hello Franz/)
  assert.match(dashboard.text, /Ironjaw/)
  assert.match(dashboard.text, /commerce-kpis/)
  assert.match(dashboard.text, /Store pulse/)
  slug = /\/preview\/([a-z0-9-]+)/.exec(dashboard.text)?.[1] ?? ''
  assert.ok(slug, 'the dashboard links a live preview')
  assert.match(dashboard.text, new RegExp(`href="/preview/${slug}"[^>]*>Preview store`), 'the admin view action opens the private draft while the public URL is closed')

  // The public address is closed until the store is published — that is the
  // whole of what publishing does, and it used to do nothing at all.
  const closed = await call(`/s/${slug}`)
  assert.equal(closed.status, 503, 'an unpublished store does not answer at its public address')
  assert.match(closed.text, /Not open yet/)
  assert.match(closed.text, /noindex/, 'and it is not offered to a crawler')
  assert.match((await call(`/preview/${slug}`)).text, /Ironjaw/i, 'the draft is where the merchant looks until then')
  const missingDraft = await call(`/preview/${slug}/this-page-moved`, { accept: 'text/html' })
  assert.equal(missingDraft.status, 404)
  assert.match(missingDraft.text, /That page is not here/)
  assert.match(missingDraft.text, /Return to Ironjaw/, 'the storefront 404 keeps the current store chrome instead of the default error theme')

  const opened = await call('/admin/publish', { form: {} })
  assert.match(opened.location.replace(/\+/g, ' '), /Published v\d/)
  assert.equal((await call(`/s/${slug}`)).status, 200, 'and now it is open')
})

test('a shop can be taken down and put back up', async () => {
  const hub = await call('/admin/stores')
  const card = hub.text.split('class="card storecard"').find((chunk) => chunk.includes(`/s/${slug}`)) ?? ''
  const storeId = /storeId=(store_[a-z0-9]+)/.exec(card)?.[1] ?? ''
  assert.ok(storeId)

  const paused = await call(`/admin/stores/${storeId}/status`, { form: { status: 'paused' } })
  assert.match(decodeURIComponent(paused.location.replace(/\+/g, ' ')), /is paused/)
  const down = await call(`/s/${slug}`)
  assert.equal(down.status, 503)
  assert.match(down.text, /Temporarily closed/)
  assert.match((await call('/admin/stores')).text, /Paused/, 'and the hub says so')

  await call(`/admin/stores/${storeId}/status`, { form: { status: 'live' } })
  assert.equal((await call(`/s/${slug}`)).status, 200)
})

test('every admin page renders', async () => {
  for (const path of [
    '/admin', '/admin/ai', '/admin/products', '/admin/orders', '/admin/customers', '/admin/collections',
    '/admin/promotions', '/admin/analytics', '/admin/cro', '/admin/reviews', '/admin/store', '/admin/marketing',
    '/admin/plugins', '/admin/settings', '/admin/ads', '/admin/domains', '/admin/research', '/admin/funnels', '/admin/profit', '/admin/bundles', '/admin/pages',
    '/admin/build', '/admin/market', '/admin/creative', '/admin/speed',
  ]) {
    const response = await call(path)
    assert.equal(response.status, 200, `${path} responded ${response.status}`)
    assert.match(response.text, /id="assistant-launcher"/, `${path} carries the assistant launcher`)
  }
  assert.equal((await call('/admin/store?health=1')).location,'/admin/speed')
  const settings = await call('/admin/settings')
  assert.match(settings.text, /Customer event pixels/)
  assert.match(settings.text, /17TRACK/)
  assert.match(settings.text, /Download JSON backup/)
  assert.match(settings.text, /action="\/admin\/profile"/)
  assert.match(settings.text, /value="franz@example\.com"/)
  const backup = JSON.parse((await call('/admin/settings/export')).text)
  assert.equal(backup.tables.stores[0].name, 'Ironjaw & Co')
  assert.equal(backup.tables.sessions, undefined, 'login sessions are excluded from a store backup')
})

test('profile settings update the signed-in account', async () => {
  const saved = await call('/admin/profile', { form: { name: 'Franz Owner', email: 'franz+owner@example.com' } })
  assert.match(flashOf(saved.location), /Profile saved/)
  const settings = await call('/admin/settings')
  assert.match(settings.text, /value="Franz Owner"/)
  assert.match(settings.text, /value="franz\+owner@example\.com"/)
  assert.match((await call('/admin')).text, /Hello Franz Owner/)
})

test('the assistant executes a real change from the panel', async () => {
  const asked = await call('/admin/ask', { form: { text: 'Add a product called "The Road Bag" for $210', page: 'products' } })
  assert.equal(asked.status, 302)
  const products = await call('/admin/products')
  assert.match(products.text, /The Road Bag/)
  const ai = await call('/admin/ai')
  assert.match(ai.text, /Created The Road Bag/)
})

test('a risky action from the panel executes, is audited, and the panel carries no permission checkbox', async () => {
  const products = await call('/admin/products?search=Road')
  const productId = /prod_[a-z0-9]+/.exec(products.text)?.[0] ?? ''
  assert.ok(!products.text.includes('Allow risky actions'), 'the per-turn gate is gone')
  const deleted = await call('/admin/ask', { form: { text: `delete product ${productId}`, page: 'products' } })
  assert.equal(deleted.status, 302)
  const row = `href="/admin/products/${productId}" style="text-decoration:none"`
  assert.ok(products.text.includes(row), 'the table row was there')
  assert.ok(!(await call('/admin/products')).text.includes(row), `gone from the catalog (${flashOf(deleted.location)})`)
  assert.match((await call('/admin/settings')).text, /delete_product/, 'and the audit says so')
})

test('the generated storefront serves a home page, a PDP and its structured data', async () => {
  const home = await call(`/s/${slug}/`)
  assert.equal(home.status, 200)
  assert.match(home.text, /Ironjaw/)
  assert.ok(!home.text.includes('DRAFT PREVIEW'), 'the live path is not a draft preview')
  assert.match((await call(`/preview/${slug}/`)).text, /DRAFT PREVIEW/, 'the draft path says so plainly')

  const handle = /\/products\/([a-z0-9-]+)/.exec(home.text)?.[1] ?? ''
  const pdp = await call(`/s/${slug}/products/${handle}`)
  assert.equal(pdp.status, 200)
  assert.match(pdp.text, /application\/ld\+json/)
  assert.match(pdp.text, /"@type":"Product"/)
  assert.match(pdp.text, /"@type":"BreadcrumbList"/)
  assert.match(pdp.text, /Add to cart/)
  assert.match(pdp.text, /class="pill"|class="swatch"/, 'options render as pills or swatches')

  assert.match((await call(`/s/${slug}/sitemap.xml`)).text, /<urlset/)
  assert.match((await call(`/s/${slug}/robots.txt`)).text, /Sitemap:/)
  assert.match((await call(`/s/${slug}/llms.txt`)).text, /## What we sell/)
})

test('the storefront gives a visitor a durable id and keeps it when the address changes', async () => {
  // Split tests are assigned from this id. The analytics fingerprint it used
  // to be assigned from folds in the date and the address, so a returning
  // visitor was re-rolled at midnight and every time a phone changed network.
  const first = await fetch(`${base}/s/${slug}/`, { redirect: 'manual' })
  const issued = first.headers.getSetCookie().find((cookie) => cookie.startsWith('amboras_v='))
  assert.ok(issued, 'a first visit is given a visitor id')
  assert.match(issued, /Max-Age=31536000/, 'and keeps it for a year, not for the browser session')
  assert.match(issued, /HttpOnly/)
  const value = issued.slice('amboras_v='.length).split(';')[0] ?? ''

  const again = await fetch(`${base}/s/${slug}/`, { headers: { cookie: `amboras_v=${value}`, 'x-forwarded-for': '203.0.113.44' }, redirect: 'manual' })
  assert.ok(
    !again.headers.getSetCookie().some((cookie) => cookie.startsWith('amboras_v=')),
    'the same visitor from a different address is not issued a new one',
  )
})

test('a visitor can buy something, and the order shows up in the admin', async () => {
  const collection = await call(`/s/${slug}/collections/all`)
  const handle = /\/products\/([a-z0-9-]+)/.exec(collection.text)?.[1] ?? ''
  const pdp = await call(`/s/${slug}/products/${handle}`)
  const variantId = /id="pdp-variant" value="(var_[a-z0-9]+)"/.exec(pdp.text)?.[1] ?? ''
  assert.ok(variantId)

  await call(`/s/${slug}/cart/add`, { form: { variantId, quantity: '2' } })
  await call(`/s/${slug}/cart/code`, { form: { code: 'WELCOME10' } })
  const cart = await call(`/s/${slug}/cart`)
  assert.match(cart.text, /Welcome offer/)
  assert.match(cart.text, /Buy two, save 15%/, 'the automatic bundle stacks with the code')

  const bad = await call(`/s/${slug}/checkout`, { form: { email: 'not-an-email', name: 'X' } })
  assert.equal(bad.status, 400)
  assert.match(bad.text, /valid email/)

  const placed = await call(`/s/${slug}/checkout`, {
    form: { email: 'buyer@example.com', firstName: 'A', lastName: 'Buyer', line1: '1 Road', city: 'Austin', postal: '78701', country: 'US' },
  })
  assert.match(placed.location, /\/orders\/order_[a-z0-9]+\/offer$/, 'checkout lands on the one-click offer')
  const offerPath = placed.location.replace(base, '')
  const offer = await call(offerPath)
  assert.equal(offer.status, 200)
  assert.match(offer.text, /Add .* to this order/)
  const declined = await call(offerPath, { form: { accept: 'no' } })
  assert.match(declined.location, /\/orders\/order_[a-z0-9]+\/downsell$/, 'a declined upsell goes to the downsell step')
  const downsell = await call(declined.location.replace(base, ''))
  assert.match(downsell.location, /\/orders\/order_[a-z0-9]+$/, 'with no funnel configured there is no downsell, so straight to the order')
  const confirmation = await call(downsell.location.replace(base, ''))
  assert.match(confirmation.text, /Thank you/)
  assert.equal((await call(offerPath)).status, 302, 'the offer is shown exactly once')

  const orders = await call('/admin/orders')
  assert.match(orders.text, /buyer@example.com/)
  const analytics = await call('/admin/analytics')
  assert.match(analytics.text, /checkout.complete/)
})

test('a checkout laid out from blocks becomes the store\'s checkout once published, and previews with a sample order before', async () => {
  const created = await call('/admin/pages/new', { form: { template: 'checkout' } })
  const pageId = /\/admin\/pages\/(page_[a-z0-9]+)\/edit/.exec(created.location)?.[1] ?? ''
  assert.ok(pageId, 'the template creates a page and opens the editor')
  const editor = await call(`/admin/pages/${pageId}/edit`)
  const handle = /"handle":"([^"]+)"/.exec(editor.text)?.[1] ?? ''
  assert.ok(handle)
  assert.match((await call('/admin/pages')).text, /checkout<\/span>/, 'the pages list marks it as the checkout')

  const preview = await call(`/preview/${slug}/pages/${handle}`)
  assert.equal(preview.status, 200)
  assert.match(preview.text, /Sample order/, 'with nothing in the cart the preview fills the form with a sample line')
  assert.match(preview.text, /id="checkout-form"/)
  assert.match(preview.text, /class="costeps"/)

  const collection = await call(`/s/${slug}/collections/all`)
  const handleOf = /\/products\/([a-z0-9-]+)/.exec(collection.text)?.[1] ?? ''
  const variantId = /id="pdp-variant" value="(var_[a-z0-9]+)"/.exec((await call(`/s/${slug}/products/${handleOf}`)).text)?.[1] ?? ''
  await call(`/s/${slug}/cart/add`, { form: { variantId, quantity: '1' } })
  assert.doesNotMatch((await call(`/s/${slug}/checkout`)).text, /class="checkout checkout--blk/, 'a draft checkout page is not the live checkout')

  const editorPage = JSON.parse(/window\.__PAGE = (\{.*?\});/.exec(editor.text)?.[1] ?? '{}') as { blocks: unknown[] }
  const saved = await call(`/admin/pages/${pageId}/save`, { json: { title: 'Checkout', mode: 'blocks', blocks: editorPage.blocks, status: 'published' } })
  assert.match(saved.text, /"ok": ?true/)

  const beforeBump = await call(`/s/${slug}/checkout`)
  assert.doesNotMatch(beforeBump.text, /class="bump"/, 'checkout does not invent an add-on when no funnel configured one')
  const otherHandle = [...collection.text.matchAll(/\/products\/([a-z0-9-]+)/g)].map(match => match[1]).find(handle => handle !== handleOf)
  assert.ok(otherHandle, 'the fixture has a second product for an explicitly configured add-on')
  const bumpVariantId = /id="pdp-variant" value="(var_[a-z0-9]+)"/.exec((await call(`/s/${slug}/products/${otherHandle}`)).text)?.[1] ?? ''
  assert.ok(bumpVariantId)
  await call('/admin/funnels', { form: { name: 'Checkout add-on fixture', bumpVariantId, bumpLabel: 'Add the matching accessory', bumpPriceCents: '350' } })
  const funnelId = /name="id" value="(fun_[a-z0-9]+)"/.exec((await call('/admin/funnels')).text)?.[1] ?? ''
  assert.ok(funnelId)
  const cartBeforeBump = JSON.parse((await call(`/s/${slug}/cart/state`)).text) as { items: Array<{ variantId: string }> }
  const live = await call(`/s/${slug}/checkout`)
  assert.equal(live.status, 200)
  assert.match(live.text, /class="checkout checkout--blk/, 'the published page is the checkout')
  assert.match(live.text, /Complete order/)
  assert.match(live.text, /class="bump"/, 'the bump from the funnel is inside the form')
  assert.match(live.text, /Add the matching accessory/)
  assert.doesNotMatch(live.text, /name="bumpVariantId"[^>]*checked/, 'an available add-on is not selected for the shopper')
  assert.deepEqual(JSON.parse((await call(`/s/${slug}/cart/state`)).text).items, cartBeforeBump.items, 'rendering checkout preserves exactly the chosen cart items')
  const selectedBump = await call(`/s/${slug}/checkout/bump`, { json: { variantId: bumpVariantId, on: true } })
  assert.equal(selectedBump.status, 200, 'the shopper can explicitly select the configured add-on')
  const cartWithBump = JSON.parse((await call(`/s/${slug}/cart/state`)).text) as { items: Array<{ variantId: string; lineCents: number }> }
  assert.equal(cartWithBump.items.find(item => item.variantId === bumpVariantId)?.lineCents, 350, 'the configured server price is used')
  await call(`/s/${slug}/checkout/bump`, { json: { variantId: bumpVariantId, on: false } })
  assert.deepEqual(JSON.parse((await call(`/s/${slug}/cart/state`)).text).items, cartBeforeBump.items)
  assert.doesNotMatch(live.text, /Sample order/)

  const bad = await call(`/s/${slug}/checkout`, { form: { email: 'nope', firstName: 'A' } })
  assert.equal(bad.status, 400)
  assert.match(bad.text, /class="checkout checkout--blk[\s\S]*valid email/, 'errors come back on the same page')
  const placed = await call(`/s/${slug}/checkout`, { form: { email: 'block-buyer@example.com', firstName: 'B', lastName: 'Buyer', line1: '2 Road', city: 'Austin', postal: '78701', country: 'US' } })
  assert.match(placed.location, /\/orders\/order_[a-z0-9]+\/offer$/, 'the order goes through the block checkout')
  await call(placed.location.replace(base, ''), { form: { accept: 'no' } })
  await call(`/admin/funnels/${funnelId}/delete`, { method: 'POST' })

  const suggested = await call('/admin/pages/suggest', { form: { goal: 'checkout' } })
  assert.match(suggested.location, /\/admin\/pages\/page_[a-z0-9]+\/edit/, 'the layout suggester knows the checkout as a goal')
})

test('an exact HTML page opens as a detected visual canvas and can save a reusable section', async () => {
  const created = await call('/admin/pages/html', { form: { title: 'Visual clone', html: '<!doctype html><html><head><title>Clone</title></head><body><main><section><h1>Selectable headline</h1><p>Editable copy</p></section></main></body></html>' } })
  const pageId = /\/admin\/pages\/(page_[a-z0-9]+)\/edit/.exec(created.location)?.[1] ?? ''
  assert.ok(pageId)

  const editor = await call(`/admin/pages/${pageId}/edit`)
  assert.match(editor.text, /Visual clone editor/)
  assert.match(editor.text, /Hover to identify elements/)
  assert.match(editor.text, />↶ <span>Undo<\/span>/)
  assert.doesNotMatch(editor.text, /Convert to editable blocks/)

  const canvas = await call(`/admin/pages/${pageId}/canvas`)
  assert.equal(canvas.status, 200)
  assert.match(canvas.headers.get('content-security-policy') ?? '', /sandbox allow-same-origin; script-src 'none'/)
  assert.match(canvas.text, /Selectable headline/)
  assert.doesNotMatch(canvas.text, /data-amboras-editor/, 'editor-only outlines never leak into the stored page')

  const saved = await call(`/admin/pages/${pageId}/html-presets`, { json: { name: 'Cloned hero', html: '<section><h1>Reusable hero</h1></section>' } })
  assert.match(saved.text, /"ok": ?true/)
  assert.match(saved.text, /"type": ?"custom-html"/)
  const script = await call(`/admin/pages/${pageId}/html-presets`, { json: { name: 'Unsafe hero', html: '<section><script>alert(1)</script></section>' } })
  assert.match(script.text, /Remove scripts/)
})

test('native draft preview renders unsaved edits without saving or publishing', async () => {
  const created = await call('/admin/pages/new', { form: { template: 'landing' } })
  const pageId = /\/admin\/pages\/(page_[a-z0-9]+)\/edit/.exec(created.location)?.[1] ?? ''
  const { getDb } = await import('../src/lib/db.ts')
  const db = getDb()
  const before = db.one('SELECT * FROM pages WHERE id = ?', pageId)
  const preview = await call(`/admin/pages/${pageId}/draft-preview`, { json: { title: 'Unsaved preview title', blocks: [{ id: 'headline', type: 'headline', settings: { text: 'Unsaved preview words' } }] } })
  assert.equal(preview.status, 200)
  assert.match(preview.text, /Unsaved preview words/)
  assert.deepEqual(db.one('SELECT * FROM pages WHERE id = ?', pageId), before)
})

test('editor product data is store-scoped and exposes only public catalog fields', async () => {
  const { getDb } = await import('../src/lib/db.ts')
  const { createProduct } = await import('../src/domain/catalog.ts')
  const db = getDb()
  const store = db.one<{ id: string }>('SELECT id FROM stores WHERE slug = ?', slug)!
  const product = createProduct(db, store.id, { title: 'Bound product', status: 'published', metadata: { private: 'do-not-expose' }, variants: [{ title: 'Standard', priceCents: 4900, inventory: 10 }] })
  const created = await call('/admin/pages/html', { form: { title: 'Bindings', html: '<h1>Original</h1>' } })
  const pageId = /\/admin\/pages\/(page_[a-z0-9]+)\/edit/.exec(created.location)?.[1] ?? ''
  const preview = await call(`/admin/pages/${pageId}/product-data/${product.id}`)
  assert.equal(preview.status, 200)
  assert.equal(JSON.parse(preview.text).title, 'Bound product')
  assert.doesNotMatch(preview.text, /do-not-expose|supplier|metadata/)
  const publicData = await call(`/s/${slug}/api/page-products/${product.id}`)
  assert.equal(publicData.status, 200)
  assert.equal(JSON.parse(publicData.text).price, '$49.00')
  const draft = createProduct(db, store.id, { title: 'Draft data', status: 'draft' })
  assert.equal((await call(`/s/${slug}/api/page-products/${draft.id}`)).status, 404)
  assert.equal((await call(`/admin/pages/not-a-page/product-data/${product.id}`)).status, 404)
  const otherStore = db.one<{ id: string }>('SELECT id FROM stores WHERE id != ? LIMIT 1', store.id)
  if (otherStore) {
    const foreign = createProduct(db, otherStore.id, { title: 'Other store', status: 'published' })
    assert.equal((await call(`/s/${slug}/api/page-products/${foreign.id}`)).status, 404)
    assert.equal((await call(`/admin/pages/${pageId}/product-data/${foreign.id}`)).status, 404)
  }
})

test('a block the store defined can be read back, edited, and outlives its own removal on a page', async () => {
  const defined = await call('/admin/blocks', {
    form: { name: 'Ingredient strip', description: 'Chips with a percentage each', icon: '✚', fields: 'headline|Headline|string|What is in it', template: '<h2 class="head">{{headline}}</h2>', css: '.chip{color:#c00}' },
  })
  assert.match(flashOf(defined.location), /saved as custom-ingredient-strip/)

  // The card used to list a name and a Remove button: what the block actually
  // was — its template, its fields, the CSS — was unreadable once saved, so
  // changing one word meant writing the whole thing again.
  const listed = await call('/admin/pages')
  assert.match(listed.text, /&lt;h2 class=&quot;head&quot;&gt;\{\{headline\}\}/, 'the stored template comes back in a form')
  assert.match(listed.text, /headline\|Headline\|string\|What is in it/, 'and so do its fields')
  assert.match(listed.text, /\.chip\{color:#c00\}/)

  const edited = await call('/admin/blocks', {
    form: { name: 'Ingredient strip', type: 'custom-ingredient-strip', icon: '✚', description: 'Chips with a percentage each', fields: 'headline|Headline|string|What is in it', template: '<h2 class="head">{{headline}} — every one</h2>', css: '.chip{color:#c00}' },
  })
  assert.match(flashOf(edited.location), /saved as custom-ingredient-strip/)
  const after = await call('/admin/pages')
  assert.match(after.text, /— every one/, 'saving the same type replaces it')
  assert.equal(after.text.split('custom-ingredient-strip</code>').length - 1, 1, 'and does not leave a second copy behind')

  // A page carrying the block, and then the block removed underneath it. The
  // save used to be refused for an unknown type, so the page could not be
  // edited at all — least of all to take the orphan off it.
  const page = await call('/admin/pages/new', { form: { template: 'advertorial', title: 'Ingredients' } })
  const pageId = /\/admin\/pages\/(page_[a-z0-9]+)\/edit/.exec(page.location)?.[1] ?? ''
  assert.ok(pageId)
  const withBlock = [{ id: 'blk_ing', type: 'custom-ingredient-strip', settings: { headline: 'What is in it' } }]
  assert.match((await call(`/admin/pages/${pageId}/save`, { json: { title: 'Ingredients', mode: 'blocks', blocks: withBlock, status: 'draft' } })).text, /"ok": ?true/)

  await call('/admin/blocks/custom-ingredient-strip/delete', { form: {} })
  const orphaned = await call(`/admin/pages/${pageId}/save`, { json: { title: 'Ingredients, edited', mode: 'blocks', blocks: withBlock, status: 'draft' } })
  assert.match(orphaned.text, /"ok": ?true/, 'the page still saves with the orphan on it')
  const emptied = await call(`/admin/pages/${pageId}/save`, { json: { title: 'Ingredients, edited', mode: 'blocks', blocks: [], status: 'draft' } })
  assert.match(emptied.text, /"ok": ?true/)
  const stillRefused = await call(`/admin/pages/${pageId}/save`, { json: { title: 'Ingredients', mode: 'blocks', blocks: [{ type: 'custom-invented-just-now', settings: {} }], status: 'draft' } })
  assert.match(stillRefused.text, /Unknown block type/, 'a type that was never on the page is still refused')

  await call(`/admin/pages/${pageId}/delete`, { form: {} })
})

test('the blog is editable in the admin, not only writable by the assistant', async () => {
  // The storefront has served /blogs since the beginning and the assistant
  // could publish into it. The merchant could not read it back, fix a line,
  // unpublish it or take it down.
  const started = await call('/admin/blogs', { form: { title: 'Journal' } })
  assert.match(flashOf(started.location), /\/blogs\/journal/)
  const hub = await call('/admin/pages')
  const blogId = /\/admin\/blogs\/(blog_[a-z0-9]+)\/articles/.exec(hub.text)?.[1] ?? ''
  assert.ok(blogId, 'the blog has a form to write into')

  const written = await call(`/admin/blogs/${blogId}/articles`, { form: { title: 'How we choose leather', excerpt: 'Two tanneries.', body: 'It starts at the tannery.', status: 'published' } })
  assert.match(flashOf(written.location), /saved as a published/)
  const live = await call(`/s/${slug}/blogs/journal/how-we-choose-leather`)
  assert.equal(live.status, 200)
  assert.match(live.text, /It starts at the tannery/)

  const withArticle = await call('/admin/pages')
  const articleId = /\/admin\/articles\/(art_[a-z0-9]+)"/.exec(withArticle.text)?.[1] ?? ''
  assert.ok(articleId, 'and the article that exists can be opened')
  assert.match(withArticle.text, /It starts at the tannery/, 'with what it actually says in the form')

  const unpublished = await call(`/admin/articles/${articleId}`, { form: { title: 'How we choose leather', excerpt: 'Two tanneries.', body: 'It starts at the tannery, in León.', status: 'draft' } })
  assert.match(flashOf(unpublished.location), /saved as a draft/)
  assert.equal((await call(`/s/${slug}/blogs/journal/how-we-choose-leather`)).status, 404, 'a draft is off the storefront')

  await call(`/admin/articles/${articleId}/delete`, { form: {} })
  assert.doesNotMatch((await call('/admin/pages')).text, /It starts at the tannery/)
  await call(`/admin/blogs/${blogId}/delete`, { form: {} })
  assert.doesNotMatch((await call('/admin/pages')).text, /\/blogs\/journal/)
})

test('publishing a store with nothing new to publish is refused, not a version bump for nothing', async () => {
  // The version bump itself is asserted where it belongs: the first test
  // publishes this store and watches its public address open.
  const again = await call('/admin/publish', { form: {} })
  assert.equal(again.status, 302)
  assert.match(flashOf(again.location), /Live since/)
  assert.equal((await call(`/s/${slug}`)).status, 200, 'and the shop stays open')
})

test('generated imagery is served and cached hard', async () => {
  const response = await fetch(`${base}/_media/render.svg?s=1&k=product&l=Test`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'image/svg+xml; charset=utf-8')
  assert.match(response.headers.get('cache-control') ?? '', /immutable/)
  assert.match(await response.text(), /^<svg/)
})

test('the activity stream is a long-lived response the router does not step on', async () => {
  const controller = new AbortController()
  const response = await fetch(`${base}/admin/activity`, {
    headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
    signal: controller.signal,
  })
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type') ?? '', /text\/event-stream/)
  controller.abort()
  // The server has to still be answering afterwards: a stream that crashes the
  // process on close is how a whole admin goes down.
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal((await fetch(`${base}/healthz`)).status, 200)
})

/* ------------------------------------------------------- second iteration */

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function upload(path: string, fields: Record<string, string>, file: { field: string; name: string; type: string; data: Buffer }) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  form.set(file.field, new Blob([new Uint8Array(file.data)], { type: file.type }), file.name)
  const response = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
    body: form,
    redirect: 'manual',
  })
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const [name, value = ''] = (pair ?? '').split('=')
    if (name) jar.set(name.trim(), decodeURIComponent(value))
  }
  return { status: response.status, location: response.headers.get('location') ?? '', headers: response.headers, text: await response.text() }
}

test('a second store can be started from the admin, with a photo, and both show in the hub', async () => {
  const hub = await call('/admin/stores')
  assert.equal(hub.status, 200)
  assert.match(hub.text, /New store/)
  assert.match(hub.text, /Ironjaw/)
  assert.match(hub.text, /orders?(&nbsp;| )\/(&nbsp;| )30d/, 'the hub says whether each store is a business yet')

  const started = await upload('/onboarding', { prompt: 'A clinical skincare brand called Marrow Lab with three products' }, { field: 'photo', name: 'serum.png', type: 'image/png', data: PNG })
  const ticket = new URL(started.location, base).searchParams.get('t') ?? ''
  assert.ok(ticket, 'a multipart build is watched too')
  let built = { location: '' }
  for (let attempt = 0; attempt < 200 && !built.location; attempt++) {
    const status = JSON.parse((await call(`/onboarding/status?t=${encodeURIComponent(ticket)}`)).text) as { state: string; next?: string }
    if (status.state === 'done') built = { location: status.next ?? '' }
    else await new Promise((resolve) => setTimeout(resolve, 50))
  }
  assert.match(decodeURIComponent(built.location), /Marrow Lab is built/)

  const dashboard = await call('/admin')
  assert.match(dashboard.text, /Marrow Lab/, 'the new store is selected')
  const after = await call('/admin/stores')
  assert.match(after.text, /Ironjaw/)
  assert.match(after.text, /Marrow Lab/)

  const products = await call('/admin/products')
  const productId = /prod_[a-z0-9]+/.exec(products.text)?.[0] ?? ''
  const detail = await call(`/admin/products/${productId}`)
  assert.match(detail.text, /ref=%2F_uploads%2F/, 'product imagery is derived from the uploaded photo')
  assert.match(detail.text, /-row comparison/, 'the page content is on file')
})

test('the research page shows what the catalog was written from', async () => {
  const research = await call('/admin/research')
  assert.equal(research.status, 200)
  assert.match(research.text, /Who buys/)
  assert.match(research.text, /Objections, answered/)
  assert.match(research.text, /ingredient reader/i)
})

test('a product photo can be uploaded and staged from the product page', async () => {
  const products = await call('/admin/products')
  const productId = /prod_[a-z0-9]+/.exec(products.text)?.[0] ?? ''
  const staged = await upload(`/admin/products/${productId}/photo`, { preset: 'dark-luxury' }, { field: 'photo', name: 'p.png', type: 'image/png', data: PNG })
  assert.equal(staged.status, 302)
  assert.match(staged.location.replace(/\+/g, ' '), /staged as dark-luxury/)

  const bad = await upload(`/admin/products/${productId}/photo`, { preset: 'lifestyle' }, { field: 'photo', name: 'p.png', type: 'image/png', data: Buffer.from('not a png at all') })
  assert.match(bad.location.replace(/\+/g, ' '), /does not look like the image/)

  const detail = await call(`/admin/products/${productId}`)
  const uploadPath = /\/_uploads\/[a-z0-9_]+\/up_[a-z0-9]+\.png/.exec(detail.text)?.[0] ?? ''
  assert.ok(uploadPath, 'the original is kept in the gallery')
  const served = await fetch(`${base}${uploadPath}`)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/png')
  assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
})

test('ads are drafted, edited and exported from the Ads tab', async () => {
  const products = await call('/admin/products')
  const productId = /prod_[a-z0-9]+/.exec(products.text)?.[0] ?? ''
  await call('/admin/avatars/suggest', { form: {} })
  const drafted = await call('/admin/ads/draft', { form: { productId, platform: 'meta', formats: 'static', direction: 'blunt, for coaches', count: '1' } })
  assert.equal(drafted.status, 302)
  assert.match(flashOf(drafted.location), /Drafted 1 ad: static/)
  const list = await call('/admin/ads')
  const adId = /ad_[a-z0-9]+/.exec(list.text)?.[0] ?? ''
  assert.ok(adId, 'the draft is listed')
  const detail = await call(`/admin/ads/${adId}`)
  assert.match(detail.text, /Copy for the ad manager/)
  assert.match(detail.text, /written to/)
  const saved = await call(`/admin/ads/${adId}/save`, { form: { name: 'Coach static', status: 'ready', hooks: 'My hook\nSecond hook', primaryText: 'Body', headline: 'Head', description: 'Desc', cta: 'Buy' } })
  assert.equal(saved.status, 302)
  const after = await call(`/admin/ads/${adId}`)
  assert.match(after.text, /My hook/)
  assert.match(after.text, /Coach static/)
  const kept = await call('/admin/ads/inspiration/read', { form: { text: 'Stop buying gloves twice a year.\nGuaranteed for life.', brand: 'Rival' } })
  assert.match(flashOf(kept.location), /Kept "Stop buying gloves twice a year\."/)
  assert.match((await call('/admin/ads')).text, /Rival/)
})

test('a competitor page pasted on the research page becomes an editable angle', async () => {
  const products = await call('/admin/products')
  const productId = /prod_[a-z0-9]+/.exec(products.text)?.[0] ?? ''
  const read = await call('/admin/competitors/read', { form: { url: 'https://fightco.example.com/p', html: '<html><head><title>ProGlove | FightCo</title></head><body><h1>Stop replacing your gloves</h1><h2>Tired of wrist pain?</h2><p>$89.00 was $149.00, 90-day money-back guarantee</p></body></html>', productId } })
  assert.match(flashOf(read.location), /FightCo runs the risk-reversal angle/)
  const research = await call('/admin/research')
  assert.match(research.text, /Stop replacing your gloves/)
  assert.match(research.text, /Generate PDP versions with this angle/)
  const recordId = /cmp_[a-z0-9]+/.exec(research.text)?.[0] ?? ''
  const applied = await call(`/admin/competitors/${recordId}/apply`, { form: {} })
  assert.match(flashOf(applied.location), /Folded in/)
})

test('a domain is attached with the registrar\'s records and a check says what it found', async () => {
  const attached = await call('/admin/domains', { form: { hostname: 'ironjaw.co', mode: 'host', registrar: 'namecheap' } })
  assert.equal(attached.status, 302)
  const page = await call('/admin/domains')
  assert.match(page.text, /ironjaw\.co/)
  assert.match(page.text, /Advanced DNS tab/)
  assert.match(page.text, /_storemill\.ironjaw\.co/)
  assert.match(page.text, /ALIAS/)
  const checked = await call('/admin/domains/check', { form: { hostname: 'ironjaw.co' } })
  assert.match(flashOf(checked.location), /No TXT record|points at/)
  const settings = await call('/admin/settings')
  assert.match(settings.text, /ironjaw\.co/)
  const detached = await call('/admin/domains/remove', { form: { hostname: 'ironjaw.co' } })
  assert.equal(detached.status, 302)
})

test('regions, rates and tax are editable in the admin, not just readable', async () => {
  // They were four lines of text. What a customer is charged for shipping, in
  // what currency, with what tax, could only be changed by asking the
  // assistant — and the assistant could only add: a second "Standard shipping"
  // landed beside the first and the cart quoted whichever came out first.
  const before = await call('/admin/settings')
  assert.match(before.text, /Regions and shipping/)
  assert.match(before.text, /name="countries"/, 'the region is a form now')
  assert.match(before.text, /the one a free-shipping promotion covers/, 'and says which rate is the standard one')

  const added = await call('/admin/regions', { form: { name: 'United Kingdom', currency: 'gbp', countries: 'GB, IE', taxPercent: '20', shippingName: 'Royal Mail', shippingAmount: '4.50', shippingFreeAbove: '60' } })
  assert.match(flashOf(added.location), /United Kingdom added: GBP for GB, IE/)
  const withUk = await call('/admin/settings')
  const uk = withUk.text.split('<details').find((chunk) => chunk.includes('United Kingdom')) ?? ''
  const regionId = /\/admin\/regions\/(reg_[a-z0-9]+)"/.exec(uk)?.[1] ?? ''
  assert.ok(regionId, 'the region has its own form')
  assert.match(uk, /value="GBP"/)
  assert.match(uk, /value="GB, IE"/)
  assert.match(uk, /value="20\.00"/, 'the tax rate comes back as the percentage it was typed as')
  assert.match(uk, /value="4\.50"/)
  assert.match(uk, /value="60\.00"/)

  const rejected = await call('/admin/regions', { form: { name: 'Nowhere', currency: 'pounds', countries: 'GB' } })
  assert.match(flashOf(rejected.location), /!?A currency is three letters/)

  await call(`/admin/regions/${regionId}/shipping`, { form: { name: 'Royal Mail', amount: '5.50', freeAbove: '' } })
  const changed = (await call('/admin/settings')).text.split('<details').find((chunk) => chunk.includes('United Kingdom')) ?? ''
  assert.equal(changed.split('Royal Mail').length - 1, 1, 'the same name changes the rate rather than adding a second one')
  assert.match(changed, /value="5\.50"/)

  await call(`/admin/regions/${regionId}/shipping`, { form: { name: 'Next day', amount: '9.99' } })
  const two = (await call('/admin/settings')).text.split('<details').find((chunk) => chunk.includes('United Kingdom')) ?? ''
  const optionId = /\/admin\/shipping\/(so_[a-z0-9]+)\/delete/.exec(two)?.[1] ?? ''
  assert.ok(optionId)
  assert.match(two, /Next day/)

  await call(`/admin/shipping/${optionId}/delete`, { form: {} })
  const one = (await call('/admin/settings')).text.split('<details').find((chunk) => chunk.includes('United Kingdom')) ?? ''
  assert.doesNotMatch(one, /value="5\.50"/, 'the removed rate is gone')
  const lastRate = /\/admin\/shipping\/(so_[a-z0-9]+)\/delete/.exec(one)?.[1] ?? ''
  assert.equal(lastRate, '', 'and the last rate in a region has no Remove button — the cart would have nothing to quote')

  const renamed = await call(`/admin/regions/${regionId}`, { form: { name: 'Britain & Ireland', currency: 'GBP', countries: 'GB IE', taxPercent: '20' } })
  assert.match(flashOf(renamed.location), /Britain & Ireland saved/)

  const removed = await call(`/admin/regions/${regionId}/delete`, { form: {} })
  assert.match(flashOf(removed.location), /Region removed/)
  const after = await call('/admin/settings')
  assert.doesNotMatch(after.text, /Britain &amp; Ireland/)
  const usId = /\/admin\/regions\/(reg_[a-z0-9]+)"/.exec(after.text)?.[1] ?? ''
  const lastOne = await call(`/admin/regions/${usId}/delete`, { form: {} })
  assert.match(flashOf(lastOne.location), /A store needs one region/, 'the last region stays: it is where the checkout gets its currency')
})

test('product images are re-shot from a direction, and a lane can be made the hero', async () => {
  const products = await call('/admin/products')
  const productId = /prod_[a-z0-9]+/.exec(products.text)?.[0] ?? ''
  const rendered = await call(`/admin/products/${productId}/regenerate`, { form: { direction: 'on marble, morning light', preset: 'lifestyle', provider: 'svg', lanes: '2' } })
  assert.match(flashOf(rendered.location), /Rendered 2 Vector stage/)
  const detail = await call(`/admin/products/${productId}`)
  assert.match(detail.text, /on marble, morning light/)
  const lane = /name="url" value="([^"]+)"/.exec(detail.text)?.[1]?.replace(/&amp;/g, '&') ?? ''
  assert.ok(lane, 'a lane is offered')
  const used = await call(`/admin/products/${productId}/use-image`, { form: { url: lane, as: 'hero' } })
  assert.match(flashOf(used.location), /hero image now/)
})

test('a photo can be labelled as the shot it is, and the creative checklist counts it', async () => {
  // The checklist read a photo:<id> marker out of the alt text and told the
  // owner to type one there — with nothing anywhere that could write it. Every
  // product showed twelve missing shots forever.
  const products = await call('/admin/products')
  const productId = /prod_[a-z0-9]+/.exec(products.text)?.[0] ?? ''
  const detail = await call(`/admin/products/${productId}`)
  assert.match(detail.text, /which shot/, 'every image on the product can say which brief it is')
  const mediaUrl = /name="mediaUrl" value="([^"]+)"/.exec(detail.text)?.[1]?.replace(/&amp;/g, '&') ?? ''
  assert.ok(mediaUrl, 'there is an image to label')

  const labelled = await call(`/admin/products/${productId}/media/label`, { form: { mediaUrl, shot: 'detail' } })
  assert.match(flashOf(labelled.location), /Detail of the mechanism/)
  const creative = await call('/admin/creative')
  const row = creative.text.split('<tr>').find((chunk) => chunk.includes('</td>') && chunk.includes('tag ok">detail')) ?? ''
  assert.ok(row, 'the coverage table counts the shot as taken')

  const cleared = await call(`/admin/products/${productId}/media/label`, { form: { mediaUrl, shot: '' } })
  assert.match(flashOf(cleared.location), /Label removed/)
  const refused = await call(`/admin/products/${productId}/media/label`, { form: { mediaUrl, shot: 'not-a-brief' } })
  assert.match(flashOf(refused.location), /not one of the briefs/)
})

test('the storefront product page carries the conversion sections and the sticky bar', async () => {
  const dashboard = await call('/admin')
  const slug2 = /\/(?:preview|s)\/([a-z0-9-]+)/.exec(dashboard.text)?.[1] ?? ''
  assert.ok(slug2)
  // This is a visitor's view of the current store, so it has to be open.
  await call('/admin/publish', { form: {} })
  const collection = await call(`/s/${slug2}/collections/all`)
  const handle = /\/products\/([a-z0-9-]+)/.exec(collection.text)?.[1] ?? ''
  const pdp = await call(`/s/${slug2}/products/${handle}`)
  assert.equal(pdp.status, 200)
  assert.match(pdp.text, /Why this one/)
  assert.match(pdp.text, /table class="compare"/)
  assert.match(pdp.text, /details class="faq"/)
  assert.match(pdp.text, /30-day guarantee/, 'the guarantee is the number in the legal card, not a hardcoded thirty')
  assert.match(pdp.text, /id="stickybar"/)
  const hero = /id="pdp-main" src="([^"]+)"/.exec(pdp.text)?.[1]?.replace(/&amp;/g, '&') ?? ''
  assert.match(hero, /ref=%2F_uploads/)
  const svg = await (await fetch(`${base}${hero}`)).text()
  assert.match(svg, /<image href="data:image\/png;base64,/, 'the hero is the merchant photo, staged')
})

test('the storefront serves generated legal pages, takes behaviour beacons, and names a missing funnel test', async () => {
  const privacy = await call(`/s/${slug}/pages/privacy`)
  assert.equal(privacy.status, 200)
  assert.match(privacy.text, /cookie-free/)
  assert.match(privacy.text, /Skip to content/, 'the skip link is on every page')
  assert.match(privacy.text, /<main id="main"/, 'and the main landmark')
  const terms = await call(`/s/${slug}/pages/terms`)
  assert.equal(terms.status, 200)
  assert.match(terms.text, /Returns and the guarantee/)
  // Point the admin at the store the beacon is about to hit, or these
  // assertions are about whichever store happened to be selected.
  const hub = await call('/admin/stores')
  const card = hub.text.split('class="asset-card"').find((chunk) => chunk.includes(`/s/${slug}`)) ?? ''
  const storeId = /storeId=(store_[a-z0-9]+)/.exec(card)?.[1] ?? ''
  assert.ok(storeId, 'the hub links each store by id')
  await call(`/admin/switch?storeId=${storeId}`)
  const count = (text: string, needle: RegExp) => (text.match(needle) ?? []).length
  const before = (await call('/admin/analytics')).text
  const purchasesBefore = count(before, /checkout\.complete/g)

  const beacon = await fetch(`${base}/s/${slug}/_t`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ p: '/pages/privacy', e: [{ t: 'scroll', m: { depth: 50 } }, { t: 'cta.click', m: { label: 'Buy' } }, { t: 'checkout.complete', m: {} }] }) })
  assert.equal(beacon.status, 204)
  const analytics = await call('/admin/analytics')
  assert.match(analytics.text, /What visitors did/)
  assert.ok(count(analytics.text, /cta\.click/g) > count(before, /cta\.click/g), 'the beacon events reached the ticker')
  assert.equal(count(analytics.text, /checkout\.complete/g), purchasesBefore, 'a beacon cannot claim a purchase')
  const missing = await call(`/s/${slug}/go/nothing`)
  assert.equal(missing.status, 404)
  // The draft is the merchant's own view, so it carries their session; a
  // stranger who guesses the slug gets nothing.
  const preview = await fetch(`${base}/preview/${slug}/_t`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; ') },
    body: JSON.stringify({ p: '/', e: [{ t: 'scroll', m: { depth: 100 } }] }),
  })
  assert.equal(preview.status, 204, 'preview beacons are accepted and dropped')
  const stranger = await fetch(`${base}/preview/${slug}`, { headers: { accept: 'text/html' }, redirect: 'manual' })
  assert.equal(stranger.status, 302, 'an unpublished store is not readable by whoever guesses the slug')
  assert.equal(stranger.headers.get('location'), '/login')
})

test('the scheme a proxy forwards is the scheme the request is seen under', async () => {
  const { makeCtx } = await import('../src/lib/http.ts')
  const fake = (headers: Record<string, string>) =>
    makeCtx({ headers: { host: 'admin.example.com', ...headers }, url: '/admin', socket: {} } as never, {} as never, {})
  assert.equal(fake({}).url.origin, 'http://admin.example.com')
  assert.equal(fake({ 'x-forwarded-proto': 'https' }).url.origin, 'https://admin.example.com')
  assert.equal(fake({ 'x-forwarded-proto': 'https, http' }).url.origin, 'https://admin.example.com')
  assert.equal(fake({ 'x-forwarded-proto': 'ftp' }).url.origin, 'http://admin.example.com')
})

test('an invited teammate can actually join the store', async () => {
  // The owner invites someone who has no account yet.
  const invited = await call('/admin/team', { form: { email: 'colleague@example.com', role: 'member' } })
  const link = /\/join\/[A-Za-z0-9_-]+/.exec(flashOf(invited.location))?.[0] ?? ''
  assert.ok(link, `the invite is a link the owner can send (got ${flashOf(invited.location)})`)

  const own = new Map<string, string>()
  const theirs = async (path: string, form?: Record<string, string>) => {
    const response = await fetch(`${base}${path}`, {
      method: form ? 'POST' : 'GET',
      headers: {
        accept: 'text/html',
        cookie: [...own].map(([name, value]) => `${name}=${value}`).join('; '),
        ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(form ? { body: new URLSearchParams(form).toString() } : {}),
      redirect: 'manual',
    })
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      const [name, value = ''] = (pair ?? '').split('=')
      if (name) own.set(name.trim(), decodeURIComponent(value))
    }
    return { status: response.status, location: response.headers.get('location') ?? '', headers: response.headers, text: await response.text() }
  }

  const followed = await theirs(link)
  assert.match(followed.location, /^\/register/, 'without an account, the link sends them to register')
  await theirs('/register', { email: 'colleague@example.com', password: 'a-long-enough-password', name: 'Colleague' })

  const hub = await theirs('/admin/stores')
  assert.match(hub.text, /Ironjaw/, 'and the store they were invited to is theirs to open')
})

test('opening a store from the hub can land on a page other than the dashboard, and only inside the admin', async () => {
  const build = await call('/admin/switch?storeId=&to=%2Fadmin%2Fbuild')
  assert.equal(build.location, '/admin/build')
  const away = await call('/admin/switch?to=https%3A%2F%2Felsewhere.example')
  assert.equal(away.location, '/admin', 'a switch cannot be turned into an open redirect')
  const protocolRelative = await call('/admin/switch?to=%2F%2Felsewhere.example%2Fadmin')
  assert.equal(protocolRelative.location, '/admin')
})

test('a shopper who edits the checkout gets the same payment intent re-priced, not a new one each time', async () => {
  // The page asks for an intent on render and on every edit to the form. Each
  // ask opened a new PaymentIntent and a new Stripe Customer, so one shopper
  // who typed an email, changed the quantity and came back left five of each
  // behind — five abandoned checkouts by five people, as far as Stripe knew.
  const posts: Array<{ path: string; body: Record<string, string> }> = []
  useStripeTransport(async (path, init) => {
    const body = Object.fromEntries(new URLSearchParams(init.body ?? ''))
    if (init.method === 'POST') posts.push({ path, body })
    if (path.startsWith('/v1/customers')) return { ok: true, status: 200, json: async () => ({ id: 'cus_1' }) }
    const amount = Number(body.amount ?? 0) || 4900
    return { ok: true, status: 200, json: async () => ({ id: 'pi_reused', status: 'requires_payment_method', client_secret: 'pi_reused_secret', amount, currency: 'usd', customer: body.customer ?? null }) }
  })
  assert.match(flashOf((await call('/admin/plugins/stripe/settings', { form: { publishableKey: 'pk_test_abc', secretKey: 'sk_test_xyz', captureMode: 'automatic' } })).location), /Saved/)
  // Stripe is connected on whichever store the admin is currently on.
  const shop = /\/s\/([a-z0-9-]+)/.exec((await call('/admin')).text)?.[1] ?? ''
  assert.ok(shop)

  const collection = await call(`/s/${shop}/collections/all`)
  const handle = /\/products\/([a-z0-9-]+)/.exec(collection.text)?.[1] ?? ''
  const variantId = /id="pdp-variant" value="(var_[a-z0-9]+)"/.exec((await call(`/s/${shop}/products/${handle}`)).text)?.[1] ?? ''
  await call(`/s/${shop}/cart/add`, { form: { variantId, quantity: '1' } })

  const first = JSON.parse((await call(`/s/${shop}/checkout/intent`, { json: {} })).text) as { intentId?: string; error?: string }
  assert.equal(first.error, undefined)
  assert.equal(first.intentId, 'pi_reused')
  await call(`/s/${shop}/cart/add`, { form: { variantId, quantity: '1' } })
  const second = JSON.parse((await call(`/s/${shop}/checkout/intent`, { json: {} })).text) as { intentId?: string }
  assert.equal(second.intentId, 'pi_reused')

  const created = posts.filter((post) => post.path === '/v1/payment_intents')
  const updated = posts.filter((post) => post.path === '/v1/payment_intents/pi_reused')
  assert.equal(created.length, 1, 'one intent is opened for the cart')
  assert.equal(updated.length, 1, 'and the second ask re-prices it')
  assert.ok(Number(updated[0]?.body.amount) > Number(created[0]?.body.amount), 'at the new total')

  useStripeTransport(null)
  await call('/admin/plugins/stripe/uninstall', { form: {} })
})

test('page type/link editing and the cross-site template library work through the admin', async () => {
  const created = await call('/admin/pages/html', { form: { title: 'Reusable checkout shell', role: 'checkout', html: '<!doctype html><html><head><style>@media(max-width:767px){main{padding:16px}}</style></head><body><main>Library checkout shell</main></body></html>' } })
  assert.equal(created.status, 302)
  const pageId = /\/admin\/pages\/([^/]+)\/edit/.exec(created.location)?.[1]
  assert.ok(pageId)
  const { getDb } = await import('../src/lib/db.ts')
  const { createProduct } = await import('../src/domain/catalog.ts')
  const storeId = getDb().one<{ store_id: string }>('SELECT store_id FROM pages WHERE id = ?', pageId)?.store_id as string
  const draftProduct = createProduct(getDb(), storeId, { title: 'Imported draft connection', status: 'draft', variants: [{ title: 'Default', priceCents: 2900 }] })
  getDb().run('UPDATE pages SET product_id = ?, head_html = ? WHERE id = ?', draftProduct.id, '<style data-template-head>main{letter-spacing:.01em}</style>', pageId)
  const editor = await call(created.location)
  assert.match(editor.text, /id="page-role"/);assert.match(editor.text, /id="page-handle"/);assert.match(editor.text, /Save page to library/)
  assert.match(editor.text, /Imported draft connection \(draft\)/, 'draft imports remain selectable instead of losing their product connection when saved')
  const saved = await call(`/admin/pages/${pageId}/template`, { json: { name: 'My reusable checkout' } })
  assert.equal(saved.status, 200)
  const template = JSON.parse(saved.text).template
  assert.ok(template.id)
  const library = await call('/admin/templates')
  assert.match(library.text, /My reusable checkout/);assert.match(library.text, /Save a page from a link/)
  const preview = await call(`/admin/templates/${template.id}/preview`)
  assert.match(preview.text, /Library checkout shell/);assert.match(preview.headers.get('content-security-policy') ?? '', /script-src 'none'/)
  assert.match(preview.text, /data-template-head/, 'custom head styles appear in the sandboxed template preview')
  const copy = await call(`/admin/templates/${template.id}/use`, { form: { title: 'Second checkout', role: 'checkout' } })
  assert.equal(copy.status, 302);assert.notEqual(copy.location, created.location)
  const nextId = /\/admin\/pages\/([^/]+)\/edit/.exec(copy.location)?.[1]
  const row = getDb().one<{ role: string; status: string; raw_html: string; handle: string; is_home: number }>('SELECT * FROM pages WHERE id = ?', nextId as string)
  assert.equal(row?.role, 'checkout');assert.equal(row?.status, 'draft');assert.equal(row?.is_home, 0);assert.match(row?.raw_html ?? '', /@media/)
  const changed = await call(`/admin/pages/${nextId}/save`, { json: { title: 'A cart design', handle: 'my-cart-design', role: 'cart', mode: 'html', rawHtml: row?.raw_html } })
  assert.equal(changed.status, 200);assert.equal(JSON.parse(changed.text).handle, 'my-cart-design')
  assert.equal(getDb().one<{ role: string }>('SELECT role FROM pages WHERE id = ?', nextId as string)?.role, 'cart')
  const invalid = await call(`/admin/pages/${nextId}/save`, { json: { role: 'invalid-role' } })
  assert.match(JSON.parse(invalid.text).error, /valid page type/)
  assert.equal((await call(`/admin/templates/${template.id}/delete`, { form: {} })).status, 302)
  assert.equal((await call(`/admin/templates/${template.id}/preview`)).status, 404)
})

test('theme settings persist source colors and font weights in draft without publishing', async () => {
  const { getDb } = await import('../src/lib/db.ts')
  const { environment, getStore } = await import('../src/control/stores.ts')
  const db = getDb()
  const created = await call('/admin/pages/new', { form: { title: 'Theme scope', template: 'blank', role: 'page' } })
  const pageId = /\/admin\/pages\/([^/]+)\/edit/.exec(created.location)?.[1]
  assert.ok(pageId)
  const storeId = db.one<{store_id:string}>('SELECT store_id FROM pages WHERE id = ?',pageId)!.store_id
  const before=environment(db,storeId,'live')
  const source={primary:'#c21882',paper:'#ffffff',ink:'#202223',displayFont:'Georgia',bodyFont:'Arial',displayWeight:700,bodyWeight:400}
  const response=await call('/admin/theme',{form:{primary:'#2244aa',secondary:'#145b49',paper:'#ffffff',ink:'#202223',surface:'#f5f1f4',buttonText:'#ffffff',border:'#dedede',displayFont:'Georgia',bodyFont:'Arial',displayWeight:'800',bodyWeight:'500',sourceTheme:JSON.stringify(source),template:'market',radius:'8px',density:'roomy'}})
  assert.equal(response.status,302)
  const brand=environment(db,storeId,'draft').brand
  assert.equal(brand.primary,'#2244aa');assert.equal(brand.displayFont,'Georgia');assert.equal(brand.bodyFont,'Arial');assert.equal(brand.displayWeight,800);assert.equal(brand.bodyWeight,500);assert.deepEqual(brand.sourceTheme,source)
  assert.equal(brand.themeCustomized,true);assert.deepEqual(environment(db,storeId,'live').brand,before.brand)
  assert.equal(getStore(db,storeId)?.brand.displayWeight,800)
  const form=await call('/admin/store');assert.match(form.text,/name="displayWeight"[\s\S]*?value="800" selected/);assert.match(form.text,/theme-font-dialog/)
})
