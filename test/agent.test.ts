import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createStore, environment, getStore, publishState } from '../src/control/stores.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'
import { listProducts } from '../src/domain/catalog.ts'
import { listPromotions } from '../src/domain/promotions.ts'
import { execute, listTools, ToolRefusal } from '../src/agent/registry.ts'
import { createRun, getRun, recoverRuns, resumeQueuedRuns, runToCompletion } from '../src/agent/runtime.ts'
import { rulesPlan } from '../src/agent/llm.ts'
import { onboard } from '../src/agent/onboarding.ts'
import { ask } from '../src/agent/chat.ts'
import { listAudit } from '../src/control/todos.ts'

function withStore() {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Test', prompt: 'a boxing gear store' })
  seedDefaultRegion(db, store.id, 'USD')
  return { db, store, user, ctx: { db, storeId: store.id, actor: { type: 'user' as const, id: user.id } } }
}

test('the registry refuses a tool that does not exist', async () => {
  const { ctx } = withStore()
  await assert.rejects(() => execute('summon_customers', {}, ctx), (error: ToolRefusal) => error.kind === 'unknown')
})

test('arguments are validated before the handler runs', async () => {
  const { ctx } = withStore()
  await assert.rejects(
    () => execute('create_product', { subtitle: 'no title' }, ctx),
    (error: ToolRefusal) => error.kind === 'invalid' && (error.detail as string[]).some((issue) => issue.includes('title')),
  )
})

test('a risky tool executes and its audit row says it was risky', async () => {
  const { db, store, ctx } = withStore()
  const created = await execute('create_product', { title: 'Doomed', priceCents: 1000 }, ctx)
  const productId = (created.data as { id: string }).id
  await execute('delete_product', { productId }, ctx)
  assert.equal(listProducts(db, store.id, {}).length, 0, 'no per-turn gate: the draft/live split is the safety surface')
  const row = db.one<{ diff: string }>("SELECT diff FROM audit_log WHERE store_id = ? AND action = 'delete_product'", store.id)
  assert.match(row?.diff ?? '', /"risk":"confirm"/)
})

test('every call is audited, successes and failures alike', async () => {
  const { db, store, ctx } = withStore()
  await execute('create_product', { title: 'Audited', priceCents: 1000 }, ctx)
  await assert.rejects(() => execute('update_variant', { variantId: 'var_nope', priceCents: 1 }, ctx))
  const rows = db.all<{ action: string }>('SELECT action FROM audit_log WHERE store_id = ?', store.id)
  assert.ok(rows.some((row) => row.action === 'create_product'))
  assert.ok(rows.some((row) => row.action === 'update_variant (failed)'))
})

test('the rules planner maps plain requests onto real tools', () => {
  const { db, store } = withStore()
  const context = { db, storeId: store.id }
  const names = (text: string) => rulesPlan(text, context).steps.map((step) => step.tool)
  assert.deepEqual(names('Add a product called "The Road Bag" for $210'), ['create_product'])
  assert.deepEqual(names('Create a 15% discount on code SPRING15'), ['create_promotion'])
  assert.deepEqual(names('set free shipping over $150'), ['create_promotion'])
  assert.deepEqual(names('How is the store doing this week?'), ['get_kpis', 'get_funnel'])
  assert.deepEqual(names('show me the pending review queue'), ['list_reviews'])
  assert.deepEqual(names('publish the store'), ['publish_store'])
  assert.deepEqual(names('install shippo'), ['install_plugin'])
  assert.ok(rulesPlan('mgnbqwx', context).preamble.includes('No model is configured'))
})

test('the planner extracts the title and the price it was given', () => {
  const { db, store } = withStore()
  const plan = rulesPlan('Add a product called "The Road Bag" for $210 with sizes', { db, storeId: store.id })
  const args = plan.steps[0]?.args as { title: string; priceCents: number; options?: unknown[] }
  assert.equal(args.title, 'The Road Bag')
  assert.equal(args.priceCents, 21000)
  assert.equal(args.options?.length, 1)
})

test('branches in a run execute concurrently and failures do not take the run down', async () => {
  const { db, store, user } = withStore()
  const run = createRun(db, {
    storeId: store.id,
    prompt: 'mixed',
    steps: [
      { branch: 'a', tool: 'create_product', args: { title: 'One', priceCents: 100 } },
      { branch: 'a', tool: 'create_product', args: { title: 'Two', priceCents: 100 } },
      { branch: 'b', tool: 'update_variant', args: { variantId: 'var_missing', priceCents: 1 } },
      { branch: 'c', tool: 'create_collection', args: { title: 'Shelf' } },
    ],
  })
  const outcome = await runToCompletion(db, run.id, { actor: { type: 'agent', id: user.id } })
  assert.equal(outcome.run.status, 'partial', 'some done and some failed is not a success')
  assert.equal(outcome.results.length, 3)
  assert.equal(outcome.failures.length, 1)
  assert.equal(listProducts(db, store.id, {}).length, 2)
})

test('an interrupted run is recovered without repeating finished steps', async () => {
  const { db, store, user } = withStore()
  const run = createRun(db, {
    storeId: store.id,
    prompt: 'interrupted',
    steps: [
      { branch: 'main', tool: 'create_product', args: { title: 'Done already', priceCents: 100 } },
      { branch: 'main', tool: 'create_product', args: { title: 'Never started', priceCents: 100 } },
    ],
  })
  // Simulate a crash: step one finished, step two was mid-flight, run left running.
  const steps = getRun(db, run.id)!.steps
  db.update('agent_steps', steps[0]!.id, { status: 'done', result: { summary: 'done' } })
  db.update('agent_steps', steps[1]!.id, { status: 'running' })
  db.run("UPDATE agent_runs SET status = 'running' WHERE id = ?", run.id)

  assert.equal(recoverRuns(db), 1)
  const outcome = await runToCompletion(db, run.id, { actor: { type: 'agent', id: user.id } })
  assert.equal(outcome.results.length, 1)
  assert.deepEqual(listProducts(db, store.id, {}).map((product) => product.title), ['Never started'])
})

test('onboarding turns one sentence into a store that could take an order', async () => {
  const { db, user } = fresh()
  const result = await onboard(db, {
    ownerId: user.id,
    prompt: 'a boxing gear store called Ironjaw & Co, hand-stitched leather, heritage atelier in Mexico City',
  })
  assert.equal(result.failures.length, 0)
  assert.equal(result.store.name, 'Ironjaw & Co')

  const products = listProducts(db, result.store.id, { status: 'published', limit: 10 })
  assert.equal(products.length, 3)
  for (const product of products) {
    assert.ok(product.variants.length >= 1, `${product.title} has variants`)
    assert.ok(product.heroImage, `${product.title} has an image`)
    const words = product.description.split(/\s+/).length
    assert.ok(words >= 150 && words <= 220, `${product.title} description is ${words} words`)
  }

  const brand = getStore(db, result.store.id)!.brand
  assert.match(brand.primary ?? '', /^#[0-9a-f]{6}$/i)
  assert.ok(brand.logoSvg && brand.slogan && brand.description)

  const promotions = listPromotions(db, result.store.id)
  assert.equal(promotions.length, 3)
  assert.ok(promotions.some((promotion) => promotion.code === 'WELCOME10'))
  assert.ok(promotions.some((promotion) => promotion.kind === 'free_shipping'))

  assert.equal(environment(db, result.store.id, 'draft').theme.heroImage !== undefined, true)
  assert.equal(publishState(db, result.store.id).ready, true)
})

test('onboarding is deterministic: the same sentence builds the same brand', async () => {
  const prompt = 'a single-origin coffee roaster in Lisbon selling subscriptions'
  const first = await onboard(fresh().db, { ownerId: 'seed', prompt }).catch(() => null)
  assert.equal(first, null, 'an unknown owner cannot create a store')

  const a = fresh()
  const b = fresh()
  const one = await onboard(a.db, { ownerId: a.user.id, prompt })
  const two = await onboard(b.db, { ownerId: b.user.id, prompt })
  assert.equal(one.store.name, two.store.name)
  assert.equal(getStore(a.db, one.store.id)!.brand.primary, getStore(b.db, two.store.id)!.brand.primary)
  assert.notEqual(one.store.slug, two.store.slug, 'slugs still carry an unguessable suffix')
})

test('a chat turn writes both messages, a run, and the change itself', async () => {
  const { db, store, user } = withStore()
  const result = await ask(db, { storeId: store.id, userId: user.id, text: 'Create a 20% discount on code TWENTY', page: 'promotions' })
  assert.equal(result.failures.length, 0)
  assert.match(result.assistant.content, /20%/)
  assert.ok(getRun(db, result.runId))
  const promotion = listPromotions(db, store.id)[0]
  assert.equal(promotion?.code, 'TWENTY')
  assert.equal(promotion?.value, 20)
})

test('the registry is fully populated and every tool declares a schema', () => {
  const tools = listTools()
  assert.ok(tools.length >= 70, `${tools.length} tools registered`)
  for (const tool of tools) {
    assert.ok(tool.description.length > 12, `${tool.name} has a real description`)
    assert.equal(typeof tool.schema, 'object')
  }
})

test('brand names are always real words, whatever the seed, and stop at the end of the name', async () => {
  const { brandName, readBrief } = await import('../src/agent/copy.ts')
  for (const prompt of ['a coffee roaster in Lisbon', 'ceramics studio in Kyoto', 'pet supplies for dogs', 'a candle brand', 'artisanal umbrellas', 'x', 'yy', 'zzz']) {
    const name = brandName(readBrief(prompt))
    assert.ok(!/undefined|null/.test(name), `${prompt} → ${name}`)
    assert.ok(name.split(' ').length >= 2, `${prompt} → ${name}`)
  }
  assert.equal(brandName(readBrief('A clinical skincare brand called Marrow Lab with three products')), 'Marrow Lab')
  assert.equal(brandName(readBrief('a store called "Salt & Cedar Supply" in Lisbon')), 'Salt & Cedar Supply')
})

test('a queued run is picked up: recovery is not just a status change', async () => {
  const { db, store } = withStore()
  const run = createRun(db, {
    storeId: store.id,
    prompt: 'interrupted mid-onboarding',
    steps: [
      { branch: 'main', tool: 'create_product', args: { title: 'Finished before the crash', priceCents: 100 } },
      { branch: 'main', tool: 'create_product', args: { title: 'Was in flight', priceCents: 100 } },
    ],
  })
  const steps = getRun(db, run.id)!.steps
  db.update('agent_steps', steps[0]!.id, { status: 'done', result: { summary: 'done' } })
  db.update('agent_steps', steps[1]!.id, { status: 'running' })
  db.run("UPDATE agent_runs SET status = 'running' WHERE id = ?", run.id)

  assert.equal(recoverRuns(db), 1)
  assert.equal(getRun(db, run.id)?.status, 'queued')
  assert.equal(resumeQueuedRuns(db), 1, 'and something actually runs the queue')
  // The resume is deliberately not awaited; the run settles a tick later.
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(getRun(db, run.id)?.status, 'completed')
  assert.deepEqual(listProducts(db, store.id, {}).map((product) => product.title), ['Was in flight'], 'and the finished step is not repeated')
})

test('a refused tool call is in the audit log, which is what was attempted', async () => {
  const { db, store, user } = withStore()
  const before = listAudit(db, store.id, 50).length
  await assert.rejects(() => execute('no_such_tool', {}, { db, storeId: store.id, actor: { type: 'agent', id: user.id } }), /no tool called/)
  await assert.rejects(() => execute('create_product', { subtitle: 'no title' }, { db, storeId: store.id, actor: { type: 'agent', id: user.id } }), /cannot accept/)
  const rows = listAudit(db, store.id, 50)
  assert.equal(rows.length, before + 2)
  assert.ok(rows.every((row) => String(row.action).endsWith('(refused)')))
})
