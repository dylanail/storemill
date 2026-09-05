import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { parseMultipart } from '../src/lib/http.ts'
import { saveUpload, readUpload, UploadError } from '../src/lib/uploads.ts'
import { readBrief } from '../src/agent/copy.ts'
import { latestResearch, rulesResearch, runResearch } from '../src/agent/research.ts'
import { writeProductContent } from '../src/agent/pages.ts'
import { imageUrl, renderSvg } from '../src/agent/images.ts'
import { createStore } from '../src/control/stores.ts'
import { execute } from '../src/agent/registry.ts'
import { getProduct } from '../src/domain/catalog.ts'
import { onboard } from '../src/agent/onboarding.ts'

// A 1x1 PNG, the smallest real image there is.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

function multipartBody(parts: Array<{ name: string; value?: string; filename?: string; type?: string; data?: Buffer }>, boundary = 'xYzZY') {
  const chunks: Buffer[] = []
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    if (part.filename !== undefined) {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: ${part.type ?? 'application/octet-stream'}\r\n\r\n`))
      chunks.push(part.data ?? Buffer.alloc(0))
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value ?? ''}`))
    }
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return Buffer.concat(chunks)
}

test('the multipart parser separates fields from files and keeps binary intact', () => {
  const body = multipartBody([
    { name: 'prompt', value: 'a boxing store' },
    { name: 'tags', value: 'a' },
    { name: 'tags', value: 'b' },
    { name: 'photo', filename: 'glove.png', type: 'image/png', data: PNG },
    { name: 'empty', filename: '', type: 'application/octet-stream', data: Buffer.alloc(0) },
  ])
  const parsed = parseMultipart(body, 'xYzZY')
  assert.equal(parsed.fields.prompt, 'a boxing store')
  assert.deepEqual(parsed.fields.tags, ['a', 'b'])
  assert.equal(parsed.files.photo?.type, 'image/png')
  assert.ok(parsed.files.photo?.data.equals(PNG), 'bytes survive the round trip')
  assert.equal(parsed.files.empty, undefined, 'an empty file input is not a file')
})

test('uploads are typed by content, not by the name the browser sent', () => {
  const saved = saveUpload({ name: 'anything.html', type: 'image/png', data: PNG }, 'store_test')
  assert.match(saved.url, /^\/_uploads\/store_test\/up_[a-z0-9]+\.png$/)
  assert.ok(readUpload(saved.url)?.data.equals(PNG))
  assert.throws(() => saveUpload({ name: 'x.png', type: 'image/png', data: Buffer.from('<html>') }, 'store_test'), UploadError)
  assert.throws(() => saveUpload({ name: 'x.txt', type: 'text/plain', data: PNG }, 'store_test'), /Images only/)
  assert.equal(readUpload('/_uploads/../../etc/passwd'), null)
})

test('a reference photo is staged into the scene rather than redrawn', () => {
  const saved = saveUpload({ name: 'g.png', type: 'image/png', data: PNG }, 'store_ref')
  const url = imageUrl({ subject: 'Glove', kind: 'product', preset: 'dark-luxury', reference: saved.url })
  const svg = renderSvg(new URLSearchParams(url.split('?')[1]))
  assert.match(svg, /<image href="data:image\/png;base64,/, 'the merchant photo is embedded as-is')
  assert.match(svg, /<ellipse/, 'with a contact shadow under it')
  const plain = renderSvg(new URLSearchParams(imageUrl({ subject: 'Glove', kind: 'product' }).split('?')[1]))
  assert.ok(!plain.includes('<image'), 'no photo, no embed')
})

test('rules research is specific to the category and complete in every field', () => {
  const boxing = rulesResearch(readBrief('hand-stitched boxing gloves in Mexico City'))
  assert.equal(boxing.category, 'boxing gear')
  assert.ok(boxing.audience.length >= 3)
  assert.ok(Math.abs(boxing.audience.reduce((sum, persona) => sum + persona.share, 0) - 1) < 0.01, 'shares add up')
  assert.ok(boxing.objections.some((entry) => /weight/i.test(entry.objection)))
  assert.ok(boxing.keywords.some((keyword) => /sparring/.test(keyword)))
  assert.ok(boxing.priceAnchor.lowCents < boxing.priceAnchor.midCents && boxing.priceAnchor.midCents < boxing.priceAnchor.highCents)

  const unknown = rulesResearch(readBrief('artisanal umbrella repair kits'))
  assert.ok(unknown.audience.length >= 3 && unknown.objections.length >= 3 && unknown.comparison.rows.length >= 3, 'an unknown category still gets a full record')
})

test('a product page is written from the research, never from thin air', () => {
  const brief = readBrief('clinical skincare, three products')
  const research = rulesResearch(brief)
  const content = writeProductContent(research, brief, { title: 'The Barrier Serum', role: 'hero', priceCents: 6800, options: [{ title: 'Size', values: [{ value: '30ml' }] }] })
  assert.equal(content.benefits?.length, 4)
  assert.equal(content.comparison?.rows.length, research.comparison.rows.length)
  for (const entry of research.objections.slice(0, 4)) {
    assert.ok(content.faq?.some((faq) => faq.q === entry.objection), `the FAQ answers "${entry.objection}"`)
  }
  assert.ok(content.specs?.some((spec) => spec.label === 'Size' && spec.value === '30ml'))
  assert.match(content.guarantee ?? '', /Thirty days/)
})

test('research is persisted per store and read back by the page writer tool', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Researched', prompt: 'single-origin coffee in Lisbon' })
  assert.equal(latestResearch(db, store.id), null)
  const record = await runResearch(db, store.id, { prompt: 'single-origin coffee in Lisbon' })
  assert.equal(record.source, 'rules')
  assert.equal(latestResearch(db, store.id)?.id, record.id)

  const ctx = { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } }
  const created = await execute('create_product', { title: 'The House Roast', priceCents: 2200 }, ctx)
  const product = getProduct(db, store.id, (created.data as { id: string }).id)!
  assert.ok(product.content.faq?.some((entry) => /supermarket/i.test(entry.q)), 'the coffee objection made it onto the page')
  assert.match(created.summary, /comparison/)
})

test('onboarding researches first and every product ships with a full page', async () => {
  const { db, user } = fresh()
  const saved = saveUpload({ name: 'g.png', type: 'image/png', data: PNG }, 'pending_test')
  const result = await onboard(db, { ownerId: user.id, prompt: 'a boxing gear store called Ironjaw & Co in Mexico City', referenceImage: saved.url })
  assert.equal(result.failures.length, 0)
  assert.ok(latestResearch(db, result.store.id), 'research is on file')
  assert.equal(result.store.referenceImage, saved.url)
  const { listProducts } = await import('../src/domain/catalog.ts')
  for (const product of listProducts(db, result.store.id, {})) {
    assert.ok((product.content.benefits?.length ?? 0) >= 3, `${product.title} has benefits`)
    assert.ok((product.content.faq?.length ?? 0) >= 4, `${product.title} has a FAQ`)
    assert.ok(product.content.comparison?.rows.length, `${product.title} has a comparison`)
    assert.match(product.heroImage, /ref=%2F_uploads/, `${product.title} imagery is derived from the upload`)
  }
})

test('the rules writers do not invent a place of manufacture or a repair promise', () => {
  // Nothing in this sentence says where anything is made.
  const brief = readBrief('a clinical skincare brand with three products and a very plain white storefront')
  assert.equal(brief.place, '', 'a place is only ever one the owner named')

  const research = rulesResearch(brief)
  assert.ok(!/Made in/.test(research.proofPoints.join(' ')), 'and it is not asserted as a proof point')
  assert.ok(!/Repaired in-house/.test(research.proofPoints.join(' ')), 'nor is a lifetime repair promise')
  assert.ok(!research.positioning.includes(' in  '), 'nor left as a hole in the positioning')

  const named = readBrief('a hand-stitched boxing gear store, heritage leather atelier in Mexico City')
  assert.equal(named.place, 'Mexico City', 'a place the owner did name is kept')
  assert.ok(rulesResearch(named).proofPoints.some((point) => point.includes('Mexico City')))
})
