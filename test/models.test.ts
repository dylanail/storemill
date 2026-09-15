import assert from 'node:assert/strict'
import test from 'node:test'
import { createPage, getPage, listPageRevisions } from '../src/pages/store.ts'
import { captureAssistantContext } from '../src/agent/context.ts'
import { fresh } from './helpers.ts'
import { anyModel, catalog, complete, completeJson, defaultChoice, modelFor, parseChoice, planWithTools, resolvedModels, S, useModelTransport, type ModelChoice } from '../src/agent/models.ts'
import { createStore, updateStore } from '../src/control/stores.ts'
import { authorResearch, latestResearch, runResearch } from '../src/agent/research.ts'
import { readBrief } from '../src/agent/copy.ts'
import { authorBrandKit } from '../src/agent/brand.ts'
import { onboard } from '../src/agent/onboarding.ts'
import { ask } from '../src/agent/chat.ts'
import { suggestAvatars } from '../src/agent/avatars.ts'
import { readCompetitor } from '../src/agent/angles.ts'
import { listProducts } from '../src/domain/catalog.ts'
import { listPromotions } from '../src/domain/promotions.ts'
import { saveAnswers } from '../src/control/build.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'

/**
 * The model path, exercised end to end against a fake network: the request
 * the SDK sends is inspected, and a reply in the API's own shape comes back.
 * Nothing here reaches the internet.
 */
const KEYS = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'AMBORAS_TEXT_PROVIDER', 'AMBORAS_MODEL', 'AMBORAS_OPENAI_MODEL', 'AMBORAS_MODEL_RESEARCH'] as const

function withEnv(values: Partial<Record<(typeof KEYS)[number], string>>, work: () => Promise<void>): Promise<void> {
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
  for (const key of KEYS) delete process.env[key]
  Object.assign(process.env, values)
  return work().finally(() => {
    for (const key of KEYS) {
      if (saved[key] === undefined) delete process.env[key]
      else process.env[key] = saved[key]
    }
    useModelTransport(null)
  })
}

type Captured = { url: string; body: Record<string, unknown>; headers: Record<string, string> }

/** A fake network that answers Anthropic and OpenAI in their own shapes. */
function fakeNetwork(reply: (captured: Captured) => unknown): { calls: Captured[] } {
  const calls: Captured[] = []
  useModelTransport(async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const headers: Record<string, string> = {}
    const raw = init?.headers as { forEach?: (fn: (value: string, key: string) => void) => void } | Record<string, string> | undefined
    if (raw && typeof (raw as { forEach?: unknown }).forEach === 'function') (raw as { forEach: (fn: (value: string, key: string) => void) => void }).forEach((value, key) => (headers[key.toLowerCase()] = value))
    else for (const [key, value] of Object.entries(raw ?? {})) headers[key.toLowerCase()] = String(value)
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const captured = { url, body, headers }
    calls.push(captured)
    const answer = reply(captured)
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } })
  })
  return { calls }
}

function anthropicText(text: string, extra: Record<string, unknown> = {}) {
  return { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 }, ...extra }
}

function openaiText(text: string) {
  return { id: 'resp_1', object: 'response', created_at: 0, status: 'completed', model: 'gpt-5', output: [{ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] }], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }
}

test('routing: nothing configured means rules; a key means the newest model; the store can override per task', async () => {
  await withEnv({}, async () => {
    assert.equal(anyModel(), false)
    assert.equal(modelFor(null, null, 'research'), null)
    assert.ok(catalog().every((entry) => !entry.available))
  })
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    assert.deepEqual(defaultChoice('research'), { provider: 'anthropic', model: 'claude-opus-5' })
    const { db, user } = fresh()
    const store = createStore(db, user.id, { name: 'Routed' })
    updateStore(db, store.id, { models: { ads: 'anthropic:claude-sonnet-5', pages: 'openai:gpt-5' } })
    assert.deepEqual(modelFor(db, store.id, 'ads'), { provider: 'anthropic', model: 'claude-sonnet-5' }, 'the store choice wins')
    assert.deepEqual(modelFor(db, store.id, 'pages'), { provider: 'anthropic', model: 'claude-opus-5' }, 'a choice whose key is missing falls back to the default')
    assert.equal(resolvedModels(db, store.id).find((row) => row.task === 'ads')?.label, 'Claude Sonnet 5')
  })
  await withEnv({ OPENAI_API_KEY: 'sk-test', AMBORAS_OPENAI_MODEL: 'gpt-6' }, async () => {
    assert.deepEqual(defaultChoice('planner'), { provider: 'openai', model: 'gpt-6' }, 'the OpenAI id is one variable away')
  })
  await withEnv({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'b', AMBORAS_TEXT_PROVIDER: 'openai', AMBORAS_MODEL_RESEARCH: 'anthropic:claude-fable-5-1' }, async () => {
    assert.equal(defaultChoice('ads')?.provider, 'openai', 'the configured provider wins when both have keys')
    assert.deepEqual(defaultChoice('research'), { provider: 'anthropic', model: 'claude-fable-5-1' }, 'a per-task variable pins one task')
  })
  assert.equal(parseChoice('nonsense'), null)
  assert.deepEqual(parseChoice('anthropic:claude-opus-5'), { provider: 'anthropic', model: 'claude-opus-5' })
})

test('an Anthropic completion sends structured output with the schema, effort and the refusal fallback, and parses the reply', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    const net = fakeNetwork(() => anthropicText(JSON.stringify({ answer: 'yes', count: 3 })))
    const choice: ModelChoice = { provider: 'anthropic', model: 'claude-opus-5' }
    const parsed = await completeJson<{ answer: string; count: number }>(choice, { task: 'research', system: 'sys', prompt: 'hello', schema: S.obj({ answer: S.str(), count: S.int() }), name: 'thing' })
    assert.deepEqual(parsed, { answer: 'yes', count: 3 })
    const call = net.calls[0]!
    assert.match(call.url, /api\.anthropic\.com\/v1\/messages/)
    assert.equal(call.headers['x-api-key'], 'sk-test')
    assert.match(call.headers['anthropic-beta'] ?? '', /server-side-fallback-2026-07-01/)
    assert.equal(call.body.model, 'claude-opus-5')
    assert.equal(call.body.fallbacks, 'default')
    assert.equal(call.body.system, 'sys')
    assert.equal((call.body.output_config as { effort: string }).effort, 'high', 'research runs at high effort')
    assert.deepEqual((call.body.output_config as { format: { type: string; schema: { required: string[] } } }).format.type, 'json_schema')
    assert.deepEqual((call.body.output_config as { format: { schema: { required: string[]; additionalProperties: boolean } } }).format.schema.required, ['answer', 'count'])
    assert.equal('thinking' in call.body, false, 'thinking is left adaptive by omission')

    useModelTransport(null)
    fakeNetwork(() => anthropicText('', { stop_reason: 'refusal', content: [], stop_details: { type: 'refusal', category: 'other', explanation: 'no' } }))
    await assert.rejects(complete(choice, { task: 'ads', system: 's', prompt: 'p' }), /declined/)
  })
})

test('an OpenAI completion uses the Responses API with a strict JSON schema and reasoning effort', async () => {
  await withEnv({ OPENAI_API_KEY: 'sk-test' }, async () => {
    const net = fakeNetwork(() => openaiText(JSON.stringify({ answer: 'yes' })))
    const parsed = await completeJson<{ answer: string }>({ provider: 'openai', model: 'gpt-5' }, { task: 'extraction', system: 'sys', prompt: 'hello', schema: S.obj({ answer: S.str() }), name: 'thing' })
    assert.deepEqual(parsed, { answer: 'yes' })
    const call = net.calls[0]!
    assert.match(call.url, /api\.openai\.com\/v1\/responses/)
    assert.equal(call.headers['authorization'], 'Bearer sk-test')
    assert.equal(call.body.instructions, 'sys')
    assert.equal(call.body.input, 'hello')
    assert.deepEqual(call.body.reasoning, { effort: 'medium' })
    const format = (call.body.text as { format: { type: string; strict: boolean; name: string } }).format
    assert.equal(format.type, 'json_schema')
    assert.equal(format.strict, true)
    assert.equal(format.name, 'thing')
  })
})

test('the planner hands the model the real tool schemas and the conversation, and reads tool calls back from both families', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    const net = fakeNetwork(() => ({ ...anthropicText('Creating it.'), content: [{ type: 'text', text: 'Creating it.' }, { type: 'tool_use', id: 'tu_1', name: 'create_promotion', input: { title: '20% off', kind: 'percentage', value: 20, code: 'TWENTY' } }], stop_reason: 'tool_use' }))
    const reply = await planWithTools({ provider: 'anthropic', model: 'claude-opus-5' }, { system: 'sys', history: [{ role: 'assistant', content: 'stray' }, { role: 'user', content: 'earlier' }, { role: 'assistant', content: 'ok' }], prompt: 'now', tools: [{ name: 'create_promotion', description: 'd', input_schema: { type: 'object', properties: {} } }] })
    assert.equal(reply.text, 'Creating it.')
    assert.deepEqual(reply.calls, [{ name: 'create_promotion', args: { title: '20% off', kind: 'percentage', value: 20, code: 'TWENTY' } }])
    const messages = net.calls[0]!.body.messages as Array<{ role: string; content: string }>
    assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'user'], 'history starts with the user and ends with the prompt')
    assert.equal((net.calls[0]!.body.tools as Array<{ name: string }>)[0]?.name, 'create_promotion')

    // Through the chat: the run executes what the model planned, and the reply is its words plus what happened.
    const { db, store, user } = (() => {
      const { db, user } = fresh()
      const store = createStore(db, user.id, { name: 'Planned', prompt: 'a boxing store' })
      return { db, store, user }
    })()
    const result = await ask(db, { storeId: store.id, userId: user.id, text: 'twenty percent off on TWENTY', page: 'promotions' })
    assert.equal(result.failures.length, 0)
    assert.match(result.assistant.content, /^Creating it\./)
    assert.equal(listPromotions(db, store.id)[0]?.code, 'TWENTY')
  })
  await withEnv({ OPENAI_API_KEY: 'sk-test' }, async () => {
    fakeNetwork(() => ({ ...openaiText('On it.'), output: [{ type: 'function_call', id: 'fc_1', call_id: 'c1', name: 'list_orders', arguments: '{"limit":5}', status: 'completed' }, { type: 'message', id: 'm', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'On it.', annotations: [] }] }] }))
    const reply = await planWithTools({ provider: 'openai', model: 'gpt-5' }, { system: 'sys', history: [], prompt: 'orders', tools: [{ name: 'list_orders', description: 'd', input_schema: { type: 'object', properties: {} } }] })
    assert.deepEqual(reply.calls, [{ name: 'list_orders', args: { limit: 5 } }])
    assert.equal(reply.text, 'On it.')
  })
})

test('a configured model that fails is said out loud; the rules planner does not pretend to be it', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    useModelTransport(async () => new Response(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }), { status: 500 }))
    const { db, user } = fresh()
    const store = createStore(db, user.id, { name: 'Down', prompt: 'a boxing store' })
    const result = await ask(db, { storeId: store.id, userId: user.id, text: 'Create a 15% discount on code FIFTEEN', page: 'promotions' })
    assert.match(result.assistant.content, /claude-opus-5 was unreachable/)
    assert.equal(listPromotions(db, store.id)[0]?.code, 'FIFTEEN', 'the rules planner still did the work')
  })
})

test('research is authored by the model from the brief, normalised, and recorded with the model that wrote it', async () => {
  const written = {
    category: 'boxing gear',
    positioning: 'Gloves for people who spar twice a week.',
    audience: [
      { name: 'The club fighter', who: 'Spars twice a week.', wants: 'Wrist support.', fears: 'Gloves that go soft.', buysWhen: 'The pair splits.', share: 3 },
      { name: 'The coach', who: 'Buys for a gym.', wants: 'Durability.', fears: 'Vanishing brands.', buysWhen: 'Kitting out.', share: 1 },
    ],
    triggers: ['The wrist closure failed', 'First sparring session'],
    objections: [{ objection: 'Too expensive', answer: 'It outlasts three cheap pairs.' }],
    competitors: [{ name: 'Gym basics', angle: 'cheap', priceBand: '$40', weakness: 'soft wrists' }],
    priceAnchor: { lowCents: 4000, midCents: 15000, highCents: 40000, note: 'Premium without a waiting list.' },
    keywords: ['sparring gloves'],
    proofPoints: ['Free 30-day returns'],
    comparison: { rows: [{ label: 'Wrist', us: 'Lace-up', them: 'Velcro' }] },
    sourceNotes: ['The old site led with price.'],
  }
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    const net = fakeNetwork(() => anthropicText(JSON.stringify(written)))
    const authored = await authorResearch({ provider: 'anthropic', model: 'claude-opus-5' }, readBrief('hand-stitched boxing gloves'), { sourceText: 'OLD SITE TEXT', notes: ['Existing site title: Old'], currency: 'USD', hasSite: true })
    assert.equal(authored.source, 'model+site')
    assert.equal(authored.model, 'claude-opus-5')
    assert.deepEqual(authored.research.audience.map((persona) => persona.share), [0.75, 0.25], 'shares are normalised')
    assert.deepEqual(authored.research.comparison.us, ['Lace-up'])
    assert.deepEqual(authored.research.sourceNotes, ['Existing site title: Old', 'The old site led with price.'])
    assert.match(String(net.calls[0]!.body.messages && (net.calls[0]!.body.messages as Array<{ content: string }>)[0]?.content), /OLD SITE TEXT/, 'the site text reaches the model')
    assert.doesNotMatch(String((net.calls[0]!.body.messages as Array<{ content: string }>)[0]?.content), /Kyoto|Lisbon|Portland/, 'no guessed place is fed to the model')

    const { db, user } = fresh()
    const store = createStore(db, user.id, { name: 'Researched', prompt: 'boxing gloves' })
    const record = await runResearch(db, store.id, { prompt: 'boxing gloves' })
    assert.equal(record.source, 'model')
    assert.equal(latestResearch(db, store.id)?.model, 'claude-opus-5')
    assert.equal(latestResearch(db, store.id)?.positioning, written.positioning)
  })
})

test('onboarding with a model: research, then the brand kit from it, then the store the kit describes', async () => {
  const research = {
    category: 'skincare', positioning: 'Barrier repair without fragrance.', audience: [{ name: 'The ingredient reader', who: 'Reads labels.', wants: 'Named actives.', fears: 'Marketing.', buysWhen: 'A routine stops working.', share: 1 }],
    triggers: ['A product caused a reaction'], objections: [{ objection: 'Will it sting?', answer: 'Fragrance-free and patch-tested.' }], competitors: [{ name: 'Pharmacy actives', angle: 'cheap', priceBand: '$10', weakness: 'harsh bases' }],
    priceAnchor: { lowCents: 1500, midCents: 4800, highCents: 12000, note: 'Mid.' }, keywords: ['barrier serum'], proofPoints: ['Free returns'], comparison: { rows: [{ label: 'Fragrance', us: 'None', them: 'Added' }] }, sourceNotes: [],
  }
  const kit = {
    name: 'Marrow Lab', mood: 'clinical', slogan: 'Actives, named.', description: 'A skincare brand that prints the percentages.', voice: 'Clinical, plain, no exclamation marks.', announcement: 'FREE SHIPPING OVER $50 · 30-DAY RETURNS',
    products: [
      { title: 'The Barrier Serum', subtitle: 'Niacinamide at 5%.', description: 'word '.repeat(160).trim(), priceCents: 4800, role: 'hero', tags: ['serum'], options: [{ title: 'Size', values: ['30ml', '50ml'] }] },
      { title: 'The Milk Cleanser', subtitle: 'Gentle.', description: 'word '.repeat(160).trim(), priceCents: 2800, role: 'complement', tags: [], options: [] },
      { title: 'The Night Balm', subtitle: 'Occlusive.', description: 'word '.repeat(160).trim(), priceCents: 3900, role: 'complement', tags: [], options: [] },
    ],
    collections: [{ title: 'New arrivals', description: 'Latest.' }, { title: 'The essentials', description: 'Start here.' }],
  }
  const page = { benefits: [{ title: 'Calms a reaction', body: 'Fragrance-free.' }], comparison: { themLabel: 'Pharmacy actives', rows: [{ label: 'Fragrance', us: 'None', them: 'Added' }] }, specs: [{ label: 'Size', value: '30ml · 50ml' }], faq: [{ q: 'Will it sting?', a: 'No: fragrance-free.' }], guarantee: 'Thirty days, full refund.', shipping: 'Tracked, 3–7 days.', audience: 'Made for ingredient readers', trust: ['Free 30-day returns', 'Fragrance-free', 'Tracked shipping'] }
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    const net = fakeNetwork((captured) => {
      const schema = (captured.body.output_config as { format?: { schema: { properties: Record<string, unknown> } } }).format?.schema.properties ?? {}
      if ('priceAnchor' in schema) return anthropicText(JSON.stringify(research))
      if ('announcement' in schema) return anthropicText(JSON.stringify(kit))
      if ('guarantee' in schema) return anthropicText(JSON.stringify(page))
      return anthropicText('{}')
    })
    const { db, user } = fresh()
    const result = await onboard(db, { ownerId: user.id, prompt: 'A clinical skincare brand called Marrow Lab' })
    assert.equal(result.failures.length, 0, result.failures.join('; '))
    assert.equal(result.store.name, 'Marrow Lab')
    assert.equal(result.kit.source, 'model')
    assert.equal(result.research.source, 'model')
    assert.equal(result.store.brand.slogan, 'Actives, named.')
    assert.equal(result.store.brand.voice, kit.voice)
    assert.equal(result.store.brand.announcement, kit.announcement)
    assert.equal(result.store.brand.displayFont?.includes('Instrument Serif'), true, 'the clinical mood picked the clinical palette')
    const products = listProducts(db, result.store.id, { limit: 10 })
    assert.deepEqual(products.map((product) => product.title).sort(), ['The Barrier Serum', 'The Milk Cleanser', 'The Night Balm'])
    const serum = products.find((product) => product.title === 'The Barrier Serum')!
    assert.equal(serum.variants.length, 2, 'the kit\'s options became variants')
    assert.equal(serum.content.faq?.[0]?.a, 'No: fragrance-free.', 'the page was written by the model too')
    assert.equal(latestResearch(db, result.store.id)?.model, 'claude-opus-5')
    assert.ok(net.calls.length >= 5, `research + kit + three pages = ${net.calls.length} calls`)
    assert.ok(net.calls.every((call) => call.body.model === 'claude-opus-5'))
  })
})

test('the brand kit keeps an explicit name and repairs a thin reply from the rules', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    fakeNetwork(() => anthropicText(JSON.stringify({ name: 'Something Else', mood: 'not-a-mood', slogan: '', description: '', voice: '', announcement: '', products: [], collections: [] })))
    const brief = readBrief('a coffee roaster called "Salt & Cedar Supply" in Lisbon')
    const authored = await authorResearch(null, brief)
    const kit = await authorBrandKit({ provider: 'anthropic', model: 'claude-opus-5' }, brief, authored.research)
    assert.equal(kit.name, 'Salt & Cedar Supply', 'the owner named it')
    assert.equal(kit.mood, brief.mood, 'an unknown mood falls back')
    assert.equal(kit.products.length, 3, 'an empty product list is filled from the rules')
    assert.equal(kit.source, 'model')
  })
})

test('avatars and competitor pages are written by the model when one is configured', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    fakeNetwork((captured) => {
      const schema = (captured.body.output_config as { format?: { schema: { properties: Record<string, unknown> } } }).format?.schema.properties ?? {}
      if ('avatars' in schema) return anthropicText(JSON.stringify({ avatars: [{ name: 'The weekend sparrer', who: 'Trains Saturdays.', wants: 'A glove that lasts.', fears: 'Waste.', buysWhen: 'After a split seam.', share: 1, angle: 'one pair for years', hooks: ['Your third pair this year?'], tone: 'blunt', objection: 'Pricey', answer: 'Outlasts three.' }] }))
      if ('ctas' in schema) return anthropicText(JSON.stringify({ brand: 'FightCo', headline: 'Stop replacing gloves', subheadline: 'Built to last', hooks: ['Tired of split seams?'], benefits: ['Triple foam'], offer: { price: '$89', comparePrice: '$149', discount: '40% off', shipping: 'Free worldwide', guarantee: '90-day money back', bundle: '' }, proof: { reviewCount: '12,340', rating: '4.8', badges: [] }, ctas: ['Add to cart'], audience: 'serious boxers', angle: 'risk-reversal' }))
      return anthropicText('{}')
    })
    const { db, user } = fresh()
    const store = createStore(db, user.id, { name: 'Written', prompt: 'boxing gloves' })
    await runResearch(db, store.id, { prompt: 'boxing gloves', model: null })
    const avatars = await suggestAvatars(db, store.id)
    assert.equal(avatars[0]?.name, 'The weekend sparrer')
    assert.equal(avatars[0]?.tone, 'blunt')
    const angle = await readCompetitor({ html: '<html><h1>Stop replacing gloves</h1><p>Only $89 was $149</p></html>', url: 'https://fightco.example.com/p' }, undefined, { provider: 'anthropic', model: 'claude-opus-5' })
    assert.equal(angle.angle, 'risk-reversal')
    assert.equal(angle.offer.guarantee, '90-day money back')
    assert.equal(angle.offer.comparePrice, '$149')
    assert.match(angle.notes.join(' '), /Read by Claude Opus 5/)
  })
})

test('the eight buyer answers reach the research step they are collected for', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Answers', prompt: 'a sleep supplement' })
  saveAnswers(db, store.id, {
    who: { value: 'Shift nurses in their thirties' },
    tried: { value: 'Melatonin, and it left them groggy' },
    instinct: { unknown: true },
  })

  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    const network = fakeNetwork(() =>
      anthropicText(
        JSON.stringify({ category: 'supplements', positioning: 'x', audience: [], triggers: [], objections: [], competitors: [], keywords: [], proofPoints: [], comparison: { rows: [] }, priceAnchor: { lowCents: 1000, midCents: 2000, highCents: 3000, note: '' }, sourceNotes: [] }),
      ),
    )
    await runResearch(db, store.id, { prompt: 'a sleep supplement' })
    const sent = JSON.stringify(network.calls)
    assert.match(sent, /Shift nurses in their thirties/, 'what the owner told the build about their buyer is in the research prompt')
    assert.match(sent, /left them groggy/)
    assert.match(sent, /does not know/, 'and so is what they said they do not know, which is what research is for')
  })
})

test('the assistant answers from what the tools returned, not before they ran', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Answers Co', prompt: 'a boxing gear store' })
  seedDefaultRegion(db, store.id, 'USD')

  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    let call = 0
    const net = fakeNetwork(() => {
      call++
      // First call: the plan, with a tool call and a preamble written blind.
      if (call === 1) {
        return anthropicText('', {
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Let me look.' },
            { type: 'tool_use', id: 'tu_1', name: 'create_product', input: { title: 'The Wrap', priceCents: 1800 } },
          ],
        })
      }
      // Second call: the answer, written with the result in hand.
      return anthropicText('The Wrap is in the catalog at $18.00.')
    })

    const result = await ask(db, { storeId: store.id, userId: user.id, text: 'add the wrap for $18' })
    assert.equal(result.assistant.content, 'The Wrap is in the catalog at $18.00.')

    // The last call is the answering turn: it carries what the tools returned.
    const last = JSON.stringify(net.calls.at(-1)!.body)
    assert.match(last, /What the tools returned/, 'the tool results go back to the model')
    assert.match(last, /The Wrap/)
    assert.ok(net.calls.length > 1, 'which means more than the one planning call')
  })
})

test('with no model the assistant still answers, from the tools own summaries', async () => {
  const { db, user } = fresh()
  const store = createStore(db, user.id, { name: 'Rules Co', prompt: 'a boxing gear store' })
  seedDefaultRegion(db, store.id, 'USD')
  await withEnv({}, async () => {
    const result = await ask(db, { storeId: store.id, userId: user.id, text: 'Create a 15% discount on code SPRING15' })
    assert.match(result.assistant.content, /SPRING15/)
  })
})


test('assistant reads copied HTML and uses the observed hash to finish the edit in one request', async () => {
  await withEnv({ ANTHROPIC_API_KEY: 'sk-test' }, async () => {
    const { db, user } = fresh()
    const store = createStore(db, user.id, { name: 'Context test' })
    const page = createPage(db, store.id, { title: 'Imported home', mode: 'html', rawHtml: '<!doctype html><h1>Old heading</h1><p>Preserve this paragraph.</p>' })
    let step = 0
    const net = fakeNetwork(({ body }) => {
      step++
      if (step === 1) return anthropicText('', { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'read_1', name: 'read_page_html', input: { pageId: page.id, search: 'Old heading' } }] })
      if (step === 2) {
        const prompt = (body.messages as Array<{content:string}>).at(-1)!.content
        const hash = /"hash":"([a-f0-9]+)"/.exec(prompt)?.[1]
        assert.ok(hash, 'the actual read result must reach the second planning call')
        assert.match(prompt, /Old heading/)
        return anthropicText('', { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'write_1', name: 'replace_page_html', input: { pageId: page.id, hash, find: 'Old heading', replacement: 'New heading' } }] })
      }
      return anthropicText('Updated the heading on Imported home.')
    })
    const result = await ask(db, { storeId: store.id, userId: user.id, text: 'Change this heading to New heading', page: captureAssistantContext(db, store.id, 'editor', { path: '/admin/pages/' + page.id + '/edit' }) })
    assert.deepEqual(result.failures, [])
    assert.equal(getPage(db, store.id, page.id)!.rawHtml, '<!doctype html><h1>New heading</h1><p>Preserve this paragraph.</p>')
    assert.equal(listPageRevisions(db, store.id, page.id).length, 2)
    assert.equal(net.calls.length, 3)
    assert.match(JSON.stringify(net.calls[0]!.body.system), /Imported home/)
    assert.equal(result.assistant.content, 'Updated the heading on Imported home.')
  })
})
