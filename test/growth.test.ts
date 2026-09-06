import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createStore, getStore } from '../src/control/stores.ts'
import { onboard } from '../src/agent/onboarding.ts'
import { execute } from '../src/agent/registry.ts'
import { getProduct, listProducts } from '../src/domain/catalog.ts'
import { createReview, moderate } from '../src/domain/reviews.ts'
import { saveUpload } from '../src/lib/uploads.ts'
import { generate, imageModels, imagePrompt, defaultProvider, useImageTransport } from '../src/agent/images.ts'
import { attachDomain, checkDomain, dnsPlan, domainsFor, REGISTRARS, tlsAllowed, type Resolver } from '../src/control/domains.ts'
import { directionFor, listAvatars, saveAvatar, suggestAvatars, shortWho } from '../src/agent/avatars.ts'
import { applyCompetitor, classifyAngle, directionFrom, extractAngle, readCompetitor, saveCompetitor } from '../src/agent/angles.ts'
import { AD_FORMATS, draftAds, limitWarnings, patternInspiration, PLATFORMS, readInspiration, reviseAd, saveAd, searchAdLibrary, unverifiedQuotes, useAdLibraryTransport, writeAd, type AdInput } from '../src/agent/ads.ts'
import { latestResearch, rulesResearch } from '../src/agent/research.ts'
import { readBrief } from '../src/agent/copy.ts'
import { readDirection } from '../src/agent/directions.ts'
import { generateVersions } from '../src/pages/versions.ts'
import { TEMPLATES } from '../src/email/templates.ts'
import { privacyHtml } from '../src/storefront/legal.ts'
import { install } from '../src/control/plugins.ts'

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

async function seeded() {
  const { db, user } = fresh()
  const result = await onboard(db, { ownerId: user.id, prompt: 'A boxing gear brand from Mexico City, handmade leather gloves' })
  const store = getStore(db, result.store.id)!
  const product = listProducts(db, store.id, { limit: 1 })[0]!
  return { db, user, store, product }
}

/* ------------------------------------------------------------------ images */

test('image models: the newest of each family by default, overridable, and the vector stage without keys', async () => {
  const saved = { openai: process.env.OPENAI_API_KEY, google: process.env.GEMINI_API_KEY, provider: process.env.AMBORAS_IMAGE_PROVIDER, model: process.env.AMBORAS_IMAGE_MODEL }
  delete process.env.OPENAI_API_KEY
  delete process.env.GEMINI_API_KEY
  delete process.env.AMBORAS_IMAGE_PROVIDER
  delete process.env.AMBORAS_IMAGE_MODEL
  try {
    const models = imageModels()
    assert.equal(models.find((model) => model.id === 'openai')?.model, 'gpt-image-2')
    assert.equal(models.find((model) => model.id === 'google')?.model, 'gemini-3-pro-image-preview')
    assert.equal(defaultProvider(), 'svg', 'nothing configured → the stage')
    process.env.GEMINI_API_KEY = 'test'
    assert.equal(defaultProvider(), 'google')
    process.env.OPENAI_API_KEY = 'test'
    assert.equal(defaultProvider(), 'openai', 'the first configured family wins')
    process.env.AMBORAS_IMAGE_PROVIDER = 'google'
    assert.equal(defaultProvider(), 'google', 'an explicit preference wins over order')
    process.env.AMBORAS_IMAGE_MODEL = 'gpt-image-3'
    assert.equal(imageModels()[0]?.model, 'gpt-image-3', 'a newer snapshot is one variable away')
  } finally {
    for (const [key, value] of [['OPENAI_API_KEY', saved.openai], ['GEMINI_API_KEY', saved.google], ['AMBORAS_IMAGE_PROVIDER', saved.provider], ['AMBORAS_IMAGE_MODEL', saved.model]] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})

test('the prompt quotes the direction verbatim and pins the product when there is a reference', () => {
  const prompt = imagePrompt({ subject: 'Sparring glove', preset: 'lifestyle', direction: 'on marble, morning light, a hand holding it', reference: '/_uploads/x/up_1.png' })
  assert.match(prompt, /Art direction from the merchant: on marble, morning light, a hand holding it\./)
  assert.match(prompt, /Keep this exact product/)
  assert.match(prompt, /natural window light/)
  assert.doesNotMatch(imagePrompt({ subject: 'Glove' }), /Keep this exact product/)
})

test('both providers are called with the reference photo and their output is saved as an upload', async () => {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = []
  useImageTransport(async (url, init) => {
    calls.push({ url, body: init.body, headers: (init.headers as Record<string, string>) ?? {} })
    if (url.includes('openai')) return new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }), { status: 200 })
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'here' }, { inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }), { status: 200 })
  })
  const saved = { openai: process.env.OPENAI_API_KEY, google: process.env.GEMINI_API_KEY }
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.GEMINI_API_KEY = 'g-test'
  try {
    const reference = saveUpload({ name: 'g.png', type: 'image/png', data: PNG }, 'store_img').url
    const fromOpenai = await generate({ subject: 'Glove', provider: 'openai', reference, direction: 'on marble', storeId: 'store_img' })
    assert.match(fromOpenai, /^\/_uploads\/store_img\/up_[a-z0-9]+\.png$/, 'model output becomes an upload, not a data URI in the row')
    assert.equal(calls[0]?.url, 'https://api.openai.com/v1/images/edits', 'a reference means an edit, not a generation')
    assert.ok(calls[0]?.body instanceof FormData)
    assert.equal((calls[0]?.body as FormData).get('model'), 'gpt-image-2')
    assert.match(String((calls[0]?.body as FormData).get('prompt')), /on marble/)

    const fromGoogle = await generate({ subject: 'Glove', provider: 'google', reference, direction: 'dark stone', storeId: 'store_img' })
    assert.match(fromGoogle, /^\/_uploads\/store_img\/up_[a-z0-9]+\.png$/)
    assert.match(calls[1]?.url ?? '', /gemini-3-pro-image-preview:generateContent$/)
    assert.equal(calls[1]?.headers['x-goog-api-key'], 'g-test')
    const payload = JSON.parse(String(calls[1]?.body)) as { contents: Array<{ parts: Array<Record<string, unknown>> }>; generationConfig: { responseModalities: string[] } }
    assert.ok(payload.contents[0]?.parts[0]?.inline_data, 'the reference goes in ahead of the prompt')
    assert.deepEqual(payload.generationConfig.responseModalities, ['IMAGE'])

    const withoutReference = await generate({ subject: 'Glove', provider: 'openai', storeId: 'store_img' })
    assert.equal(calls[2]?.url, 'https://api.openai.com/v1/images/generations')
    assert.match(withoutReference, /^\/_uploads\//)

    useImageTransport(async () => new Response('nope', { status: 500 }))
    const fallback = await generate({ subject: 'Glove', provider: 'openai', reference })
    assert.match(fallback, /^\/_media\/render\.svg/, 'a failed model call falls back to the stage, never to a broken image')
  } finally {
    useImageTransport(null)
    if (saved.openai === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = saved.openai
    if (saved.google === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = saved.google
  }
})

test('regenerate_product_image renders a sheet from a free-form direction and keeps it on the product', async () => {
  const { db, user, store, product } = await seeded()
  const ctx = { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } }
  const result = await execute('regenerate_product_image', { productId: product.id, direction: 'on a marble counter, morning light', provider: 'svg', lanes: 2 }, ctx)
  assert.match(result.summary, /2 Vector stage.*lanes/)
  const sheet = JSON.parse(getProduct(db, store.id, product.id)!.metadata.imageSheet ?? '{}') as { lanes: string[]; direction: string }
  assert.equal(sheet.lanes.length, 2)
  assert.equal(sheet.direction, 'on a marble counter, morning light')
  assert.notEqual(sheet.lanes[0], sheet.lanes[1], 'lanes differ')
  const attached = await execute('regenerate_product_image', { productId: product.id, direction: 'dark', provider: 'svg', lanes: 1, attachLane: 0 }, ctx)
  assert.match(attached.summary, /attached lane 0/)
  assert.equal(getProduct(db, store.id, product.id)!.heroImage, (JSON.parse(getProduct(db, store.id, product.id)!.metadata.imageSheet!) as { lanes: string[] }).lanes[0])
  await assert.rejects(execute('regenerate_product_image', { productId: product.id, provider: 'google' }, ctx), /needs GEMINI_API_KEY/)
})

/* ----------------------------------------------------------------- domains */

test('the DNS plan speaks each registrar\'s language and knows which apexes can alias', () => {
  const namecheap = dnsPlan('ironjaw.co', 'host', 'namecheap', 'tok', 'https://ironjaw.example.com')
  assert.deepEqual(namecheap.records.map((record) => [record.type, record.name]), [['ALIAS', '@'], ['CNAME', 'www'], ['TXT', '_storemill.ironjaw.co']])
  assert.match(namecheap.steps[0] ?? '', /Domain List/)
  assert.equal(namecheap.caveat, '')

  const godaddy = dnsPlan('ironjaw.co', 'host', 'godaddy', 'tok', 'https://ironjaw.example.com')
  assert.equal(godaddy.records[0]?.type, 'FORWARD', 'no ALIAS at GoDaddy → the apex forwards to www')
  assert.match(godaddy.caveat, /cannot point a bare domain/)

  const sub = dnsPlan('shop.ironjaw.co', 'host', 'cloudflare', 'tok', 'https://ironjaw.example.com')
  assert.deepEqual(sub.records.map((record) => [record.type, record.name]), [['CNAME', 'shop'], ['TXT', '_storemill.shop.ironjaw.co']])

  const forward = dnsPlan('ironjaw.co', 'forward', 'namecheap', 'tok', 'https://ironjaw.example.com')
  assert.equal(forward.records[0]?.type, 'FORWARD')
  assert.equal(forward.records[0]?.value, 'https://ironjaw.example.com')
  assert.match(forward.steps.join(' '), /Redirect Domain/)
  assert.ok(REGISTRARS.length >= 5)
})

test('a hosted domain verifies from what DNS actually says, and the check records what it found', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Ironjaw', prompt: 'boxing' })
  const record = attachDomain(db, store.id, { hostname: 'https://Ironjaw.co/shop', mode: 'host', registrar: 'namecheap' })
  assert.equal(record.hostname, 'ironjaw.co')
  assert.equal(record.status, 'pending')

  const answers: Record<string, string[]> = {}
  const resolver: Resolver = {
    txt: async (name) => answers[`txt:${name}`] ?? [],
    cname: async (name) => answers[`cname:${name}`] ?? [],
    a: async (name) => answers[`a:${name}`] ?? [],
    head: async () => ({ status: 0, location: '' }),
  }
  let check = await checkDomain(db, store.id, 'ironjaw.co', 'https://x', resolver)
  assert.equal(check.verified, false)
  assert.match(check.reason, /No TXT record/)
  assert.equal(domainsFor(db, store.id)[0]?.lastCheck?.reason, check.reason, 'the failure is kept on the record')

  answers['txt:_amboras.ironjaw.co'] = ['something-else', `amboras-verify=${record.verificationToken}`]
  check = await checkDomain(db, store.id, 'ironjaw.co', 'https://x', resolver)
  assert.equal(check.verified, false)
  assert.match(check.reason, /points at nothing yet/)

  answers['cname:ironjaw.co'] = ['edge.amboras.app.']
  check = await checkDomain(db, store.id, 'ironjaw.co', 'https://x', resolver)
  assert.equal(check.verified, true, 'TXT and CNAME → verified')
  assert.equal(domainsFor(db, store.id)[0]?.status, 'verified')
  assert.equal(domainsFor(db, store.id)[0]?.ssl, 'issued')

  // Re-attaching keeps the token (the merchant already added it) and resets the state.
  const again = attachDomain(db, store.id, { hostname: 'ironjaw.co', mode: 'host', registrar: 'cloudflare' })
  assert.equal(again.verificationToken, record.verificationToken)
  assert.equal(again.status, 'pending')
  assert.equal(again.registrar, 'cloudflare')
})

test('a forwarded domain verifies by following the redirect', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Ironjaw', prompt: 'boxing' })
  attachDomain(db, store.id, { hostname: 'ironjaw.shop', mode: 'forward', registrar: 'godaddy' })
  const head = { status: 200, location: '' }
  const resolver: Resolver = { txt: async () => [], cname: async () => [], a: async () => [], head: async () => head }
  let check = await checkDomain(db, store.id, 'ironjaw.shop', 'https://ironjaw.example.com/s/ironjaw', resolver)
  assert.equal(check.verified, false)
  assert.match(check.reason, /answers 200 instead of redirecting/)
  head.status = 301
  head.location = 'https://elsewhere.example.com/'
  check = await checkDomain(db, store.id, 'ironjaw.shop', 'https://ironjaw.example.com/s/ironjaw', resolver)
  assert.match(check.reason, /not to https:\/\/ironjaw.example.com/)
  head.location = 'https://ironjaw.example.com/s/ironjaw/'
  check = await checkDomain(db, store.id, 'ironjaw.shop', 'https://ironjaw.example.com/s/ironjaw', resolver)
  assert.equal(check.verified, true)
  assert.equal(domainsFor(db, store.id)[0]?.ssl, 'pending', 'forwarding issues no certificate here; the registrar serves the redirect')
})

test('connect_domain and check_domain are tools, and a verified hosted domain is cleared for a certificate', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Ironjaw', prompt: 'boxing' })
  const ctx = { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } }
  const attached = await execute('connect_domain', { hostname: 'ironjaw.co', registrar: 'porkbun' }, ctx)
  assert.match(attached.summary, /3 records to add at porkbun/)
  assert.equal(tlsAllowed(db, 'ironjaw.co', ''), false, 'not until it verifies')
  await execute('mark_domain_verified', { hostname: 'ironjaw.co' }, ctx)
  assert.equal(domainsFor(db, store.id)[0]?.status, 'verified')
  assert.equal(tlsAllowed(db, 'ironjaw.co', ''), true)
  assert.equal(tlsAllowed(db, 'www.ironjaw.co', ''), true, 'www and apex are one')
  assert.equal(tlsAllowed(db, 'evil.example', ''), false)
  assert.equal(tlsAllowed(db, 'shop.amboras.test', 'amboras.test'), true, 'subdomains of the storefront root')
})

/* ----------------------------------------------------------------- avatars */

test('avatars are suggested from research, edited by hand, and read into a direction', async () => {
  const { db, store } = await seeded()
  const avatars = await suggestAvatars(db, store.id)
  assert.ok(avatars.length >= 3, 'one per research persona')
  const amateur = avatars.find((avatar) => /serious amateur/i.test(avatar.name))!
  assert.equal(amateur.angle, 'wrist support that survives a year')
  assert.ok(amateur.hooks.length >= 3)
  assert.equal(amateur.source, 'research')
  assert.equal(shortWho(amateur), 'serious amateurs')

  // One is on, not all of them. Every writer takes the first selected avatar,
  // so a set where everything is selected picks whichever row came back first
  // and the merchant never made the choice at all.
  const on = avatars.filter((avatar) => avatar.selected)
  assert.equal(on.length, 1, 'the core avatar is the one being written to')
  assert.equal(on[0]?.share, Math.max(...avatars.map((avatar) => avatar.share)), 'and it is the largest share')

  // A store that has already chosen keeps its choice when research is re-read.
  saveAvatar(db, store.id, { id: on[0]!.id, name: on[0]!.name, selected: false })
  saveAvatar(db, store.id, { id: amateur.id, name: amateur.name, selected: true })
  await suggestAvatars(db, store.id)
  assert.deepEqual(listAvatars(db, store.id).filter((avatar) => avatar.selected).map((avatar) => avatar.id), [amateur.id], 'a second run adds, it does not re-pick')

  // Edits survive a re-suggest.
  saveAvatar(db, store.id, { id: amateur.id, name: amateur.name, angle: 'padding that protects a partner', tone: 'blunt' })
  await suggestAvatars(db, store.id)
  const kept = listAvatars(db, store.id).find((avatar) => avatar.id === amateur.id)!
  assert.equal(kept.angle, 'padding that protects a partner')
  assert.equal(listAvatars(db, store.id).length, avatars.length, 'no duplicates')

  const filled = directionFor('', kept)
  assert.equal(filled.audience, 'serious amateurs')
  assert.equal(filled.angle, 'padding that protects a partner')
  assert.equal(filled.tone, 'blunt')
  assert.equal(filled.avatar, kept.name)
  const typed = directionFor('premium, for coaches, focus on the lace', kept)
  assert.equal(typed.tone, 'premium', 'typed words win')
  assert.equal(typed.audience, 'coaches')
  assert.equal(typed.angle, 'the lace')
  assert.equal(directionFor('warm', null).tone, 'warm')
})

test('versions take an avatar, and it shows in the title and the audience line', async () => {
  const { db, store, product } = await seeded()
  const gift = (await suggestAvatars(db, store.id)).find((avatar) => /gift/i.test(avatar.name))!
  const [page] = await generateVersions(db, store, { productId: product.id, kind: 'pdp', formats: ['benefit'], avatarId: gift.id })
  assert.match(page!.title, /The gift buyer/)
  assert.match(JSON.stringify(page!.blocks), /gift buyers/i)
  const [none] = await generateVersions(db, store, { productId: product.id, kind: 'pdp', formats: ['benefit'], avatarId: 'none' })
  assert.doesNotMatch(none!.title, /gift buyer/i)
})

/* -------------------------------------------------------------- competitors */

const COMPETITOR_HTML = `<!doctype html><html><head><title>ProGlove Elite Sparring Gloves | FightCo</title>
<meta property="og:site_name" content="FightCo"><meta property="og:description" content="Designed for serious boxers who are tired of gloves that fall apart.">
<meta property="og:image" content="https://cdn.example.com/products/hero.jpg"></head><body>
<nav><ul><li>Home</li><li>Shop</li></ul></nav>
<h1>Stop replacing your gloves every six months</h1>
<h2>Why 12,000+ boxers switched to ProGlove</h2>
<h2>Tired of wrist pain after bag work?</h2>
<h3>What makes it different</h3>
<ul><li>Triple-layer foam that keeps its shape</li><li>Genuine cowhide leather, hand stitched</li><li>Lace-up wrist lock system</li></ul>
<p>Only $89.00 <s>$149.00</s> — save 40% today. Free worldwide shipping on every order. 90-day money-back guarantee, no questions asked.</p>
<p>Buy 2 get 1 free this week only. Rated 4.8/5 from 12,340 reviews. As seen on ESPN.</p>
<button>Add to cart</button><a class="btn" href="/checkout">Buy now — 40% off</a>
<img src="https://cdn.example.com/products/side.jpg"><img src="https://cdn.example.com/logo.png">
<script>var x = 1</script></body></html>`

test('a competitor page is read into headline, hooks, offer, proof, audience and the angle it runs', () => {
  const angle = extractAngle(COMPETITOR_HTML, 'https://www.fightco.example.com/products/proglove')
  assert.equal(angle.brand, 'FightCo')
  assert.equal(angle.headline, 'Stop replacing your gloves every six months')
  assert.match(angle.subheadline, /serious boxers/)
  assert.ok(angle.hooks.includes('Tired of wrist pain after bag work?'))
  assert.ok(angle.hooks.includes('Why 12,000+ boxers switched to ProGlove'))
  assert.deepEqual(angle.benefits, ['Triple-layer foam that keeps its shape', 'Genuine cowhide leather, hand stitched', 'Lace-up wrist lock system'])
  assert.equal(angle.offer.price, '$89.00')
  assert.equal(angle.offer.comparePrice, '$149.00')
  assert.equal(angle.offer.discount, '40% off')
  assert.match(angle.offer.shipping, /Free worldwide shipping/)
  assert.match(angle.offer.guarantee, /90-day money-back guarantee/)
  assert.match(angle.offer.bundle, /Buy 2 get 1 free/)
  assert.equal(angle.proof.reviewCount, '12,340')
  assert.equal(angle.proof.rating, '4.8')
  assert.ok(angle.proof.badges.some((badge) => /ESPN/.test(badge)))
  assert.ok(angle.ctas.includes('Add to cart'))
  assert.equal(angle.audience, 'serious boxers')
  assert.equal(angle.angle, 'urgency', 'the loudest signal wins: "this week only"')
  assert.deepEqual(angle.images, ['https://cdn.example.com/products/hero.jpg', 'https://cdn.example.com/products/side.jpg'], 'logos are skipped')
  assert.match(directionFrom(angle), /^urgent, for serious boxers, focus on scarcity/)

  assert.equal(classifyAngle('90-day money back guarantee'), 'risk-reversal')
  assert.equal(classifyAngle('Handmade in small batches from full grain leather'), 'premium')
  assert.equal(classifyAngle('Nothing special here'), 'benefit')

  const pasted = extractAngle('Tired of gloves that split? Ours are guaranteed for life.\nFree shipping over $50.')
  assert.equal(pasted.headline, 'Tired of gloves that split?')
  assert.ok(pasted.notes.some((note) => /pasted text/.test(note)))
})

test('a blocked site says so and offers the paste route; a fetched one is read', async () => {
  const blocked = await readCompetitor({ url: 'https://blocked.example.com/p' }, async () => ({ ok: false, status: 403, text: '' }))
  assert.equal(blocked.brand, 'blocked.example.com')
  assert.match(blocked.notes.join(' '), /answered 403; paste/)
  const fetched = await readCompetitor({ url: 'https://fightco.example.com/p' }, async () => ({ ok: true, status: 200, text: COMPETITOR_HTML }))
  assert.equal(fetched.brand, 'FightCo')
  const pastedWins = await readCompetitor({ url: 'https://x.example.com', html: '<h1>Pasted</h1>' }, async () => {
    throw new Error('should not fetch')
  })
  assert.equal(pastedWins.headline, 'Pasted')
})

test('a competitor is folded in as a competitor and an avatar, and never as the store\'s own claims', async () => {
  const { db, store, product } = await seeded()
  const before = latestResearch(db, store.id)!
  const record = saveCompetitor(db, store.id, { productId: product.id, angle: { ...extractAngle(COMPETITOR_HTML, 'https://fightco.example.com/p'), take: 'Foam, not horsehair; the wrist lock is velcro under the laces.' } })
  const research = applyCompetitor(db, store.id, record.id)
  const competitor = research.competitors.find((entry) => entry.name === 'FightCo')!
  assert.equal(competitor.priceBand, '$89.00–$149.00')
  assert.match(competitor.weakness, /velcro under the laces/)
  assert.match(competitor.angle, /scarcity/)
  // Proof points are printed on pages as trust lines and pull-quotes, and
  // triggers are what the copy writers turn into sentences. A competitor's
  // guarantee folded into either put a promise this merchant never made — in
  // the competitor's wording — on the merchant's own product page.
  assert.deepEqual(research.triggers, before.triggers, 'their hooks are not this store\'s reasons to buy')
  assert.deepEqual(research.proofPoints, before.proofPoints, 'and their guarantee is not this store\'s claim')
  assert.ok(research.sourceNotes.some((note) => /FightCo promises: .*90-day money-back guarantee/.test(note)), 'what they promise is on file as theirs')
  assert.ok(research.sourceNotes.some((note) => /not to reuse.*Why 12,000\+ boxers switched/.test(note)), 'and so are their hooks')
  assert.equal(latestResearch(db, store.id)!.competitors.length, before.competitors.length + 1, 'a new research record is on file')
  assert.ok(listAvatars(db, store.id).some((avatar) => avatar.source === 'competitor' && avatar.who === 'serious boxers'))
})

/* ---------------------------------------------------------------------- ads */

function adInput(overrides: Partial<AdInput> = {}): AdInput {
  const brief = readBrief('A boxing gear brand from Mexico City')
  const research = rulesResearch(brief)
  const product = {
    id: 'prod_1', storeId: 'store_1', title: 'Sparring Glove', handle: 'sparring-glove', subtitle: 'Sixteen ounces, laced, built to order', description: 'A glove.', status: 'published', heroImage: '', media: [], options: [], variants: [{ id: 'v1', productId: 'prod_1', title: '16oz', sku: 'SG16', priceCents: 22000, compareAtCents: 0, inventory: 10, optionValues: {}, weightGrams: 0 }], collectionIds: [], tags: [], seo: {}, metadata: {}, content: { guarantee: 'Repaired for life.', comparison: { rows: research.comparison.rows } }, supplier: {}, createdAt: '', updatedAt: '',
  } as unknown as AdInput['product']
  return {
    product,
    store: { id: 'store_1', name: 'Ironjaw', currency: 'USD', prompt: 'boxing' } as AdInput['store'],
    research,
    direction: readDirection(''),
    format: AD_FORMATS[0]!,
    platform: 'meta',
    avatar: null,
    reviews: [],
    bundle: null,
    inspiration: [],
    ...overrides,
  }
}

test('every ad format writes for every platform, and the testimonial format refuses to invent', () => {
  for (const platform of PLATFORMS) {
    for (const format of AD_FORMATS) {
      const copy = writeAd(adInput({ platform: platform.id, format }))
      assert.ok(copy.hooks.length >= 5, `${format.id}/${platform.id} has hooks`)
      assert.ok(copy.cta, `${format.id} has a CTA`)
      if (format.id === 'search') {
        assert.ok(copy.headlines.length >= 8 && copy.headlines.every((line) => line.length <= 30), 'search headlines fit 30')
        assert.ok(copy.descriptions.length >= 2 && copy.descriptions.every((line) => line.length <= 90), 'search descriptions fit 90')
      } else if (format.id === 'testimonial') {
        assert.equal(copy.primaryText, '', 'no reviews → no testimonial')
        assert.match(copy.notes[0] ?? '', /only ever built from real ones/)
      } else {
        assert.ok(copy.primaryText.length > 20, `${format.id} has primary text`)
      }
      if (format.video) assert.ok(copy.script.length >= 5, `${format.id} has a script`)
    }
  }
  const testimonial = writeAd(adInput({ format: AD_FORMATS.find((format) => format.id === 'testimonial')!, reviews: [{ rating: 5, body: 'Four months of sparring and the stitching has not moved an inch, which is more than I can say for the last two pairs.', author: 'Marisol A.' }] }))
  assert.match(testimonial.primaryText, /"Four months of sparring/)
  assert.match(testimonial.primaryText, /— Marisol\./, 'first name only')
})

test('a quote the model wrote is checked against the approved reviews, not just asked for', () => {
  // "Quote only the reviews you are given" was a line in a prompt and nothing
  // else — the same footing the character limits were on before they were
  // clipped after the fact. A fabricated testimonial is a false statement
  // about a real person, in an ad, with the store's name on it.
  const reviews = [{ body: 'Four months of sparring and the stitching has not moved an inch, which is more than I can say for the last two pairs.', author: 'Marisol A.' }]
  assert.deepEqual(unverifiedQuotes('They said "Four months of sparring and the stitching has not moved an inch."', reviews), [])
  assert.deepEqual(unverifiedQuotes('"the stitching has not moved an inch after four months of sparring" — Marisol', reviews), [], 'a trim of a real review still passes')
  assert.equal(unverifiedQuotes('"My doctor told me these are the only gloves worth buying for tendonitis." — Dana', reviews).length, 1)
  assert.deepEqual(unverifiedQuotes('It doesn\'t slip and it isn\'t heavy.', reviews), [], 'apostrophes are contractions, not quotation marks')
  assert.deepEqual(unverifiedQuotes('"Built to last."', reviews), [], 'a phrase too short to be a testimonial is left alone')
  assert.equal(unverifiedQuotes('"Anything at all here that nobody ever wrote about anything."', []).length, 1, 'with no reviews on file, any quote is unverified')
})

test('the avatar and the direction shape the copy', () => {
  const avatar = { id: 'a', name: 'The coach', who: 'Runs a gym', wants: 'Gear that survives shared use', fears: 'A brand that vanishes', buysWhen: 'Kitting out members', share: 0.2, angle: 'gear that survives shared use', hooks: ['Your club gloves are done by March.'], tone: 'blunt' as const, objection: 'They cost three times what my gym sells.', answer: 'They outlast three of those pairs.', source: 'manual' as const, selected: true, parentId: '', desire: '', experience: '', emotion: '', behaviour: '', demographic: '', label: '', tier: '' as const, createdAt: '', updatedAt: '' }
  const copy = writeAd(adInput({ avatar, direction: directionFor('', avatar) }))
  assert.equal(copy.hooks[0], 'Your club gloves are done by March.', 'the avatar\'s hook leads')
  assert.equal(copy.cta, 'Buy it', 'blunt tone → blunt CTA')
  assert.equal(copy.avatar, 'The coach')
  const urgent = writeAd(adInput({ direction: readDirection('urgent, say "this batch ships Friday"'), format: AD_FORMATS.find((format) => format.id === 'offer')! }))
  assert.equal(urgent.hooks[0], 'this batch ships Friday', 'a quoted phrase is the first hook')
  assert.match(urgent.primaryText, /This batch, this week/)
  assert.match(urgent.cta, /before this batch goes/)
})

test('ads are drafted per product from the research on file, edited field by field, revised under a new direction, and warned about limits', async () => {
  const { db, store, product } = await seeded()
  createReview(db, store.id, { productId: product.id, rating: 5, title: 'Solid', body: 'Four months of six-round sparring and the stitching has not moved at all, which surprised me.', author: 'Marisol A.', verified: true })
  moderate(db, store.id, db.one<{ id: string }>('SELECT id FROM reviews WHERE store_id = ?', store.id)!.id, 'approved')
  await suggestAvatars(db, store.id)
  const ads = await draftAds(db, store, { productId: product.id, platform: 'meta', direction: 'for coaches, focus on the repair guarantee', count: 3 })
  assert.equal(ads.length, 3)
  assert.ok(ads.every((ad) => ad.platform === 'meta' && ad.status === 'draft' && ad.avatarId), 'each written to the first selected avatar')
  assert.ok(ads[0]!.name.includes(product.title))

  const testimonial = (await draftAds(db, store, { productId: product.id, formats: ['testimonial', 'ugc-script'] }))
  assert.match(testimonial[0]!.body.primaryText, /six-round sparring/, 'the real approved review')
  assert.ok(testimonial[1]!.body.script.length >= 5)

  const edited = saveAd(db, store.id, { id: ads[0]!.id, body: { headline: 'A'.repeat(60), hooks: ['My own hook'] }, status: 'ready' })
  assert.equal(edited.body.hooks[0], 'My own hook')
  assert.equal(edited.status, 'ready')
  assert.equal(edited.body.primaryText, ads[0]!.body.primaryText, 'untouched fields stay')
  assert.match(limitWarnings(edited)[0] ?? '', /Headline is 60 characters; the limit is 40/)

  const revised = await reviseAd(db, store, ads[0]!.id, 'premium, no hype')
  assert.equal(revised.direction, 'premium, no hype')
  assert.equal(revised.body.cta, 'See the collection')
  assert.equal(revised.avatarId, ads[0]!.avatarId, 'avatar stays')
  assert.equal(revised.status, 'ready', 'status is the merchant\'s')
})

test('inspiration: pasted ads, competitor links, the Ad Library with a token, and patterns without one', async () => {
  const pasted = await readInspiration({ text: 'Stop buying gloves twice a year.\nOurs come with a lifetime repair guarantee.\nFree shipping.', brand: 'Rival' })
  assert.equal(pasted.hook, 'Stop buying gloves twice a year.')
  assert.equal(pasted.angle, 'risk-reversal')
  assert.equal(pasted.source, 'paste')
  const linked = await readInspiration({ url: 'https://fightco.example.com/p' }, async () => ({ ok: true, status: 200, text: COMPETITOR_HTML }))
  assert.equal(linked.brand, 'FightCo')
  assert.equal(linked.hook, 'Why 12,000+ boxers switched to ProGlove')

  const patterns = patternInspiration('Sparring Glove', 'boxing gear')
  assert.equal(patterns.length, 10)
  assert.ok(patterns.some((entry) => entry.hook === 'I was wrong about Sparring Glove.'))

  const saved = process.env.META_AD_LIBRARY_TOKEN
  delete process.env.META_AD_LIBRARY_TOKEN
  try {
    const without = await searchAdLibrary('boxing gloves')
    assert.equal(without.results.length, 0)
    assert.match(without.note, /META_AD_LIBRARY_TOKEN/)
    process.env.META_AD_LIBRARY_TOKEN = 'EAAtest'
    let requested = ''
    useAdLibraryTransport(async (url) => {
      requested = url
      return { ok: true, status: 200, json: async () => ({ data: [{ page_name: 'FightCo', ad_creative_bodies: ['Tired of gloves that split?\nOurs are guaranteed.'], ad_creative_link_titles: ['ProGlove'], ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=1', ad_delivery_start_time: '2026-01-04' }] }) }
    })
    const found = await searchAdLibrary('boxing gloves', { country: 'DE' })
    assert.equal(found.results.length, 1)
    assert.equal(found.results[0]?.hook, 'Tired of gloves that split?')
    assert.equal(found.results[0]?.brand, 'FightCo')
    assert.match(requested, /ads_archive\?/)
    assert.match(decodeURIComponent(requested), /ad_reached_countries=\["DE"\]/)
    assert.match(requested, /search_terms=boxing\+gloves/)
  } finally {
    useAdLibraryTransport(null)
    if (saved === undefined) delete process.env.META_AD_LIBRARY_TOKEN
    else process.env.META_AD_LIBRARY_TOKEN = saved
  }
})

test('the ad tools run through the executor', async () => {
  const { db, user, store, product } = await seeded()
  const ctx = { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } }
  await execute('suggest_avatars', {}, ctx)
  const drafted = await execute('draft_ads', { productId: product.id, platform: 'tiktok', count: 2, direction: 'playful' }, ctx)
  assert.match(drafted.summary, /Drafted 2 tiktok ads: ugc-script, hooks/)
  const listed = await execute('list_ads', {}, ctx)
  assert.match(listed.summary, /2 ads/)
  const found = await execute('find_ad_inspiration', { text: 'POV: your gloves finally fit.\nNo break-in.', productId: product.id }, ctx)
  assert.match(found.summary, /1 found, plus 10 hook patterns/)
  const read = await execute('read_competitor_site', { html: COMPETITOR_HTML, url: 'https://fightco.example.com/p', productId: product.id }, ctx)
  assert.match(read.summary, /FightCo runs the urgency angle/)
  await assert.rejects(execute('draft_ads', { productId: product.id, formats: ['nonsense'] }, ctx), /cannot accept/)
})

test('a back-in-stock email is not the welcome email wearing a different heading', () => {
  const template = TEMPLATES.find((entry) => entry.key === 'back_in_stock')
  assert.ok(template, 'there is a template for it')
  assert.match(template.subject, /back in stock/i)
  assert.ok(!/Welcome/i.test(template.subject))
})

test('the privacy policy stops saying nothing is shared for advertising once a pixel is installed', () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Pixels', prompt: 'pixels' })
  const before = privacyHtml(db, getStore(db, store.id)!)
  assert.match(before, /Nothing is sold or shared for advertising/)

  install(db, store.id, 'meta-pixel', { pixelId: '1234567890' })
  const after = privacyHtml(db, getStore(db, store.id)!)
  assert.ok(!/Nothing is sold or shared for advertising/.test(after), 'not on a page that is firing a Meta pixel')
  assert.match(after, /Meta \(Facebook and Instagram\)/)
  assert.match(after, /set their own cookies/)
})
