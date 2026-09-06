import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import type { Product } from '../domain/types.ts'
import { getProduct, listProducts } from '../domain/catalog.ts'
import { answersForPrompt, assumeAnswers, buildState, QUESTIONS } from '../control/build.ts'
import { latestResearch, type Research } from './research.ts'
import { listCompetitors, type CompetitorRecord } from './angles.ts'
import { getAvatar, listAvatars, saveAvatar, type Avatar, type AvatarInput } from './avatars.ts'
import { calendarMonth, knowledge } from './knowledge.ts'
import { completeJson, describe, modelFor, S, type ModelChoice } from './models.ts'

const log = logger('market')

/**
 * The market tab.
 *
 * Everything that is planned before a page or an ad is written lives here,
 * saved under the store: the market analysis (where the market sits, which
 * desire to lead with, the mechanism, the new information, the underserved
 * avatar), the product overview (what it is, what it does, what is assumed),
 * the sub-avatars under each core avatar, and the ad plan that turns those
 * into concepts, angles and variations. Each document is written by a model
 * when one is configured and by rules when not, and the page says which.
 */
export type DocKind = 'analysis' | 'product-overview' | 'ad-plan' | 'loop' | 'note'

export type MarketDoc<T = Record<string, unknown>> = { id: string; storeId: string; kind: DocKind; title: string; body: T; source: 'rules' | 'model' | 'manual'; model: string; createdAt: string; updatedAt: string }

type DocRow = { id: string; store_id: string; kind: string; title: string; body: string; source: string; model: string; created_at: string; updated_at: string }

function rowToDoc<T>(row: DocRow): MarketDoc<T> {
  return { id: row.id, storeId: row.store_id, kind: row.kind as DocKind, title: row.title, body: json<T>(row.body, {} as T), source: row.source as MarketDoc['source'], model: row.model, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function saveDoc<T>(db: Db, storeId: string, input: { id?: string; kind: DocKind; title: string; body: T; source?: MarketDoc['source']; model?: string }): MarketDoc<T> {
  const timestamp = now()
  if (input.id) {
    const existing = getDoc<T>(db, storeId, input.id)
    if (existing) {
      db.update('market_docs', existing.id, { title: input.title, body: input.body, source: input.source ?? existing.source, model: input.model ?? existing.model, updated_at: timestamp })
      return getDoc<T>(db, storeId, existing.id) as MarketDoc<T>
    }
  }
  const docId = id('doc')
  db.insert('market_docs', { id: docId, store_id: storeId, kind: input.kind, title: input.title, body: input.body, source: input.source ?? 'manual', model: input.model ?? '', created_at: timestamp, updated_at: timestamp })
  return getDoc<T>(db, storeId, docId) as MarketDoc<T>
}

export function getDoc<T>(db: Db, storeId: string, docId: string): MarketDoc<T> | null {
  const row = db.one<DocRow>('SELECT * FROM market_docs WHERE store_id = ? AND id = ?', storeId, docId)
  return row ? rowToDoc<T>(row) : null
}

export function listDocs<T = Record<string, unknown>>(db: Db, storeId: string, kind?: DocKind): Array<MarketDoc<T>> {
  const rows = kind
    ? db.all<DocRow>('SELECT * FROM market_docs WHERE store_id = ? AND kind = ? ORDER BY updated_at DESC', storeId, kind)
    : db.all<DocRow>('SELECT * FROM market_docs WHERE store_id = ? ORDER BY updated_at DESC', storeId)
  return rows.map((row) => rowToDoc<T>(row))
}

export function latestDoc<T>(db: Db, storeId: string, kind: DocKind): MarketDoc<T> | null {
  const row = db.one<DocRow>('SELECT * FROM market_docs WHERE store_id = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1', storeId, kind)
  return row ? rowToDoc<T>(row) : null
}

export function deleteDoc(db: Db, storeId: string, docId: string) {
  db.run('DELETE FROM market_docs WHERE store_id = ? AND id = ?', storeId, docId)
}

/* ------------------------------------------------------------ the analysis */

export type Tier = 'niche' | 'mid' | 'mass'

export type MarketAnalysis = {
  summary: string
  awareness: 'unaware' | 'problem' | 'solution' | 'product' | 'most'
  awarenessWhy: string
  sophistication: number
  sophisticationWhy: string
  desires: Array<{ desire: string; instinct: string; scope: Tier; urgency: 'low' | 'medium' | 'high'; stayingPower: 'fad' | 'seasonal' | 'durable'; note: string }>
  leadDesire: string
  languageSnippets: string[]
  researchQueries: Array<{ where: string; query: string; lookFor: string }>
  competitors: Array<{ name: string; angle: string; awareness: string; sophistication: number; offer: string; weakness: string; url: string }>
  mechanisms: Array<{ name: string; how: string; isNew: boolean; proof: string }>
  newInformation: Array<{ claim: string; whyItMatters: string; checkWith: string }>
  underserved: Array<{ avatar: string; why: string; angle: string; tier: Tier }>
  standOut: { found: boolean; via: 'mechanism' | 'information' | 'identity' | 'none'; recommendation: string }
  calendar: { month: string; theme: string; angle: string }
  answers: Record<string, string>
  risks: string[]
}

const TIERS = ['niche', 'mid', 'mass'] as const

const ANALYSIS_SCHEMA = S.obj({
  summary: S.str('Three or four sentences: where this market sits and how this store should enter it.'),
  awareness: S.enumOf(['unaware', 'problem', 'solution', 'product', 'most'], 'Where most buyers sit.'),
  awarenessWhy: S.str('One sentence of evidence.'),
  sophistication: S.int('1 to 5.'),
  sophisticationWhy: S.str('Which claims the market has already heard.'),
  desires: S.arr(S.obj({ desire: S.str('As "I want …" or "I need …".'), instinct: S.enumOf(['health', 'status', 'sex', 'comfort', 'control', 'belonging']), scope: S.enumOf(TIERS), urgency: S.enumOf(['low', 'medium', 'high']), stayingPower: S.enumOf(['fad', 'seasonal', 'durable']), note: S.str() }), 'Three to six surface desires the product can truthfully serve, strongest first.'),
  leadDesire: S.str('The one desire to build the core avatar on.'),
  languageSnippets: S.arr(S.str(), 'Eight to twelve lines the buyer would actually say or type, in their words, drawn from how this market talks. Mark any you are unsure of with [confirm].'),
  researchQueries: S.arr(S.obj({ where: S.str('Reddit, Amazon reviews, YouTube comments, TikTok comments, AnswerThePublic, Google Trends.'), query: S.str('The exact search.'), lookFor: S.str('What to extract.') }), 'Six to ten searches the owner should run, most useful first.'),
  competitors: S.arr(S.obj({ name: S.str(), angle: S.str(), awareness: S.str('Which awareness level the page speaks to.'), sophistication: S.int(), offer: S.str(), weakness: S.str(), url: S.str('Empty if unknown.') }), 'Every competitor named in the research and the competitor records, plus types you know of.'),
  mechanisms: S.arr(S.obj({ name: S.str('Two to five words.'), how: S.str('How it creates the result, at a sixth-grade level.'), isNew: S.bool('True only if the market has not heard it.'), proof: S.str('How the page would show it: demo, cutaway, comparison row, before/after.') }), 'Every mechanism the product truthfully has. Empty if none is known.'),
  newInformation: S.arr(S.obj({ claim: S.str(), whyItMatters: S.str(), checkWith: S.str('Where to verify it before it is published.') }), 'Up to four pieces of checkable information that make the product the obvious answer.'),
  underserved: S.arr(S.obj({ avatar: S.str('A person, not a demographic.'), why: S.str('Why the market is not talking to them.'), angle: S.str('The reason to buy in their terms.'), tier: S.enumOf(TIERS) }), 'Two to four underserved avatars.'),
  standOut: S.obj({ found: S.bool('False when neither a new mechanism nor an underserved avatar could be named.'), via: S.enumOf(['mechanism', 'information', 'identity', 'none']), recommendation: S.str('What to lead with, or why not to run this product yet.') }),
  calendar: S.obj({ month: S.str(), theme: S.str(), angle: S.str('How this month\'s desire theme shapes the first ads.') }),
  answers: S.obj(Object.fromEntries(QUESTIONS.map((question) => [question.key, S.str(`Your best assumption for: ${question.label} Empty if the owner already answered it.`)]))),
  risks: S.arr(S.str(), 'Two to five honest risks: sophistication, price, seasonality, legal, claims.'),
})

/** Rules baseline: read from the research on file. It never claims to have found a way to stand out. */
export function rulesAnalysis(research: Research, competitors: CompetitorRecord[], month = calendarMonth()): MarketAnalysis {
  const rows = research.comparison.rows
  return {
    summary: `${research.positioning} The research lists ${research.competitors.length} competitor types; without a model this analysis can only repeat what the research says. Run it with a model for the awareness, sophistication and stand-out reads.`,
    awareness: 'solution',
    awarenessWhy: 'Assumed: buyers know the category and are choosing within it. Confirm from the ad library and the forums.',
    sophistication: 3,
    sophisticationWhy: 'Assumed stage 3: the market has heard claims and wants a mechanism. Confirm by reading the top competitors\' pages.',
    desires: research.audience.slice(0, 4).map((persona) => ({ desire: `I want ${persona.wants.replace(/\.$/, '').toLowerCase()}`, instinct: 'comfort', scope: 'mid' as Tier, urgency: 'medium' as const, stayingPower: 'durable' as const, note: `From the ${persona.name} persona.` })),
    leadDesire: research.audience[0] ? `I want ${research.audience[0].wants.replace(/\.$/, '').toLowerCase()}` : '',
    languageSnippets: [...research.objections.map((entry) => entry.objection), ...research.triggers].slice(0, 10),
    researchQueries: [
      { where: 'Reddit', query: `${research.category} "doesn't work"`, lookFor: 'What was tried, why it failed, the words used.' },
      { where: 'Reddit', query: `best ${research.category} reddit`, lookFor: 'The criteria people use and the brands they name.' },
      { where: 'Amazon reviews', query: `${research.competitors[0]?.name ?? research.category} 1 star`, lookFor: 'The specific complaint; the mechanism that failed.' },
      { where: 'Amazon reviews', query: `${research.competitors[0]?.name ?? research.category} 5 star`, lookFor: 'The outcome in the buyer\'s words.' },
      { where: 'YouTube comments', query: `${research.category} review`, lookFor: 'Questions nobody answered.' },
      { where: 'TikTok comments', query: research.keywords[0] ?? research.category, lookFor: 'The objection under the top videos.' },
      { where: 'Google Trends', query: research.category, lookFor: 'Five years, US: flat or rising passes, declining fails.' },
    ],
    competitors: [
      ...research.competitors.map((entry) => ({ name: entry.name, angle: entry.angle, awareness: 'solution', sophistication: 3, offer: entry.priceBand, weakness: entry.weakness, url: '' })),
      ...competitors.map((record) => ({ name: record.brand || record.url, angle: `${record.angle}: ${record.headline}`, awareness: 'product', sophistication: 3, offer: [record.offer.price, record.offer.discount, record.offer.bundle].filter(Boolean).join(', '), weakness: record.take, url: record.url })),
    ],
    mechanisms: rows.slice(0, 3).map((row) => ({ name: row.label, how: `${row.us} where the usual is ${row.them.toLowerCase()}.`, isNew: false, proof: 'A comparison row and a photo of the difference.' })),
    newInformation: [],
    underserved: research.audience.slice(1, 3).map((persona) => ({ avatar: persona.name, why: 'A smaller persona the mass-market pages do not address.', angle: persona.wants, tier: 'niche' as Tier })),
    standOut: { found: false, via: 'none', recommendation: 'No new mechanism or underserved avatar has been confirmed yet. Read the competitors, run the searches above, and write the analysis again with a model or by hand before spending on ads.' },
    calendar: { month: month.month, theme: month.theme, angle: month.note },
    answers: {},
    risks: ['The awareness and sophistication reads are assumptions until the competitor pages and forums are read.'],
  }
}

function normalizeAnalysis(parsed: Partial<MarketAnalysis>, baseline: MarketAnalysis): MarketAnalysis {
  const tier = (value: unknown): Tier => (TIERS.includes(value as Tier) ? (value as Tier) : 'mid')
  return {
    ...baseline,
    ...parsed,
    sophistication: Math.min(5, Math.max(1, Number(parsed.sophistication) || baseline.sophistication)),
    desires: (parsed.desires ?? baseline.desires).map((entry) => ({ ...entry, scope: tier(entry.scope) })),
    underserved: (parsed.underserved ?? baseline.underserved).map((entry) => ({ ...entry, tier: tier(entry.tier) })),
    standOut: parsed.standOut ?? baseline.standOut,
    calendar: parsed.calendar?.month ? parsed.calendar : baseline.calendar,
    answers: parsed.answers ?? {},
    competitors: parsed.competitors?.length ? parsed.competitors : baseline.competitors,
    researchQueries: parsed.researchQueries?.length ? parsed.researchQueries : baseline.researchQueries,
  }
}

export type AnalysisInput = { research: Research; competitors: CompetitorRecord[]; avatars: Avatar[]; answers: string; notes?: string; products?: Product[]; month?: ReturnType<typeof calendarMonth> }

export async function authorAnalysis(choice: ModelChoice | null, input: AnalysisInput): Promise<{ analysis: MarketAnalysis; source: 'rules' | 'model'; model: string }> {
  const month = input.month ?? calendarMonth()
  const baseline = rulesAnalysis(input.research, input.competitors, month)
  if (!choice) return { analysis: baseline, source: 'rules', model: '' }
  const prompt = [
    `Research on file:\n${JSON.stringify({ category: input.research.category, positioning: input.research.positioning, audience: input.research.audience, triggers: input.research.triggers, objections: input.research.objections, competitors: input.research.competitors, priceAnchor: input.research.priceAnchor, keywords: input.research.keywords, comparison: input.research.comparison.rows })}`,
    input.competitors.length ? `Competitor pages read by the owner:\n${JSON.stringify(input.competitors.map((record) => ({ brand: record.brand, url: record.url, headline: record.headline, hooks: record.hooks, benefits: record.benefits, offer: record.offer, proof: record.proof, audience: record.audience, angle: record.angle, take: record.take })))}` : 'No competitor pages have been read yet.',
    input.avatars.length ? `Avatars on file:\n${JSON.stringify(input.avatars.map((avatar) => ({ name: avatar.name, who: avatar.who, wants: avatar.wants, angle: avatar.angle, desire: avatar.desire })))}` : '',
    input.products?.length ? `Products:\n${JSON.stringify(input.products.map((product) => ({ title: product.title, subtitle: product.subtitle, description: product.description.slice(0, 600), price: Math.min(...product.variants.map((variant) => variant.priceCents)) / 100, options: product.options.map((option) => option.title) })))}` : '',
    input.answers,
    input.notes ? `Notes from the owner: ${input.notes}` : '',
    `This month is ${month.month}: ${month.theme} — ${month.note}`,
    'Write the market analysis. Be honest about what is assumed: if no new mechanism and no underserved avatar can be named from what you have, set standOut.found to false and say what to read first. Fill answers only for questions the owner left as "does not know". Never invent a study, a statistic or a competitor\'s numbers.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const parsed = await completeJson<Partial<MarketAnalysis>>(choice, {
    task: 'research',
    system: `You are a direct-response strategist reading a market for a dropshipping brand that sells through paid social. You decide where the market sits, which desire to lead with, and whether there is a way to stand out.\n\n${knowledge('sophistication', 'desires', 'avatars', 'product', 'calendar', 'honesty')}`,
    prompt,
    schema: ANALYSIS_SCHEMA,
    name: 'market_analysis',
    maxTokens: 9000,
  })
  log.info(`market analysis written by ${describe(choice)}`)
  return { analysis: normalizeAnalysis(parsed, baseline), source: 'model', model: choice.model }
}

/** Writes the analysis for a store from everything on file and saves it; the owner's unknowns get the assumptions. */
export async function runAnalysis(db: Db, storeId: string, opts: { notes?: string; model?: ModelChoice | null } = {}): Promise<MarketDoc<MarketAnalysis>> {
  const research = latestResearch(db, storeId)
  if (!research) throw new Error('Run customer research first; the analysis reads it.')
  const choice = opts.model === undefined ? modelFor(db, storeId, 'research') : opts.model
  const authored = await authorAnalysis(choice, {
    research,
    competitors: listCompetitors(db, storeId),
    avatars: listAvatars(db, storeId),
    answers: answersForPrompt(buildState(db, storeId)),
    products: listProducts(db, storeId, { limit: 10 }),
    ...(opts.notes ? { notes: opts.notes } : {}),
  })
  if (Object.keys(authored.analysis.answers).length) assumeAnswers(db, storeId, authored.analysis.answers)
  return saveDoc<MarketAnalysis>(db, storeId, { kind: 'analysis', title: `Market analysis — ${research.category}`, body: authored.analysis, source: authored.source, model: authored.model })
}

/* ----------------------------------------------------- the product overview */

export type ProductOverview = {
  productId: string
  name: string
  price: string
  compareAt: string
  howItWorks: string
  sixthGrade: string
  features: string[]
  benefits: Array<{ feature: string; benefit: string }>
  desires: Array<{ benefit: string; desire: string }>
  mechanisms: Array<{ name: string; how: string; isNew: boolean }>
  hidden: { notAdvertised: string; competitorsLack: string; ifTooWell: string; friendWouldSay: string }
  assumed: boolean
}

const OVERVIEW_SCHEMA = S.obj({
  howItWorks: S.str('The process, the method and the outcome, from the product facts given.'),
  sixthGrade: S.str('The same, rewritten so an eleven-year-old follows it.'),
  features: S.arr(S.str(), 'Materials, components and mechanisms that are actually stated. Do not add any.'),
  benefits: S.arr(S.obj({ feature: S.str(), benefit: S.str('Why this feature matters to the buyer.') })),
  desires: S.arr(S.obj({ benefit: S.str(), desire: S.str('"I want …" — why someone wants that benefit.') })),
  mechanisms: S.arr(S.obj({ name: S.str(), how: S.str(), isNew: S.bool() }), 'Mechanisms that separate it, if any.'),
  hidden: S.obj({ notAdvertised: S.str('What it does that the page does not say. Say "unknown" if you cannot tell.'), competitorsLack: S.str(), ifTooWell: S.str('What people would complain about if it worked too well; be creative and specific.'), friendWouldSay: S.str('Two or three sentences, as a friend would actually say it, not a pitch.') }),
})

export function rulesOverview(product: Product, currency: string): ProductOverview {
  const cheapest = product.variants.reduce((best, variant) => (variant.priceCents < best.priceCents ? variant : best), product.variants[0]!)
  const features = [...product.options.map((option) => `${option.title}: ${option.values.map((value) => value.value).join(', ')}`), ...(product.content.specs ?? []).map((spec) => `${spec.label}: ${spec.value}`)]
  const benefits = (product.content.benefits ?? []).map((benefit) => ({ feature: benefit.title, benefit: benefit.body }))
  return {
    productId: product.id,
    name: product.title,
    price: `${(cheapest?.priceCents ?? 0) / 100} ${currency}`,
    compareAt: cheapest?.compareAtCents ? `${cheapest.compareAtCents / 100} ${currency}` : '',
    howItWorks: product.description,
    sixthGrade: '',
    features,
    benefits,
    desires: benefits.map((entry) => ({ benefit: entry.feature, desire: '' })),
    mechanisms: (product.content.comparison?.rows ?? []).slice(0, 2).map((row) => ({ name: row.label, how: row.us, isNew: false })),
    hidden: { notAdvertised: '', competitorsLack: '', ifTooWell: '', friendWouldSay: '' },
    assumed: true,
  }
}

export async function authorOverview(choice: ModelChoice | null, product: Product, currency: string, research: Research | null): Promise<{ overview: ProductOverview; source: 'rules' | 'model'; model: string }> {
  const baseline = rulesOverview(product, currency)
  if (!choice) return { overview: baseline, source: 'rules', model: '' }
  const prompt = [
    `Product: ${product.title}${product.subtitle ? ` — ${product.subtitle}` : ''}. Price ${baseline.price}${baseline.compareAt ? ` (compare at ${baseline.compareAt})` : ''}.`,
    `Description: ${product.description.slice(0, 2000)}`,
    baseline.features.length ? `Stated features and options: ${baseline.features.join('; ')}` : 'No features are stated beyond the description.',
    product.content.benefits?.length ? `Page benefits already written: ${JSON.stringify(product.content.benefits)}` : '',
    research ? `Research: ${JSON.stringify({ positioning: research.positioning, triggers: research.triggers, objections: research.objections.map((entry) => entry.objection) })}` : '',
    'Fill the product overview. Every feature must be something stated above; benefits and desires are assumptions and will be labelled so. If you cannot know something (what is advertised, what competitors include), say "unknown" rather than guessing.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const parsed = await completeJson<Omit<ProductOverview, 'productId' | 'name' | 'price' | 'compareAt' | 'assumed'>>(choice, {
    task: 'research',
    system: `You fill out a product overview for a direct-response marketer: what the product is, what it does, and what its buyers want, in that order.\n\n${knowledge('product', 'honesty')}`,
    prompt,
    schema: OVERVIEW_SCHEMA,
    name: 'product_overview',
  })
  return { overview: { ...baseline, ...parsed, features: parsed.features?.length ? parsed.features : baseline.features, assumed: true }, source: 'model', model: choice.model }
}

export async function runOverview(db: Db, storeId: string, productId: string, currency: string, model?: ModelChoice | null): Promise<MarketDoc<ProductOverview>> {
  const product = getProduct(db, storeId, productId)
  if (!product) throw new Error('No product with that id')
  const choice = model === undefined ? modelFor(db, storeId, 'research') : model
  const authored = await authorOverview(choice, product, currency, latestResearch(db, storeId))
  const existing = listDocs<ProductOverview>(db, storeId, 'product-overview').find((doc) => doc.body.productId === productId)
  return saveDoc<ProductOverview>(db, storeId, { ...(existing ? { id: existing.id } : {}), kind: 'product-overview', title: `Product overview — ${product.title}`, body: authored.overview, source: authored.source, model: authored.model })
}

/* ---------------------------------------------------------- sub-avatars */

const SUB_SCHEMA = S.obj({
  avatars: S.arr(
    S.obj({
      name: S.str('"The night-shift sleeper" — the core avatar plus what this sub-avatar adds.'),
      label: S.str('What they call themselves, for a hook.'),
      who: S.str('One or two sentences, concrete.'),
      desire: S.str('The core desire, unchanged, as "I want …".'),
      experience: S.str('A circumstance, or a product they tried with its outcome, emotion removed. Empty if this sub-avatar is not defined by one.'),
      emotion: S.str('One of joy, sadness, fear, disgust, anger, surprise, or a secondary emotion unpacked. Empty if not defined by one.'),
      behaviour: S.str('What they do about it now and how often. Empty if not defined by one.'),
      demographic: S.str('Only if the product genuinely works better for them. Usually empty.'),
      angle: S.str('The reason to buy in their terms: desire → what they do now → the gap.'),
      hooks: S.arr(S.str(), 'Three hooks that state the angle directly, one using the label.'),
      objection: S.str(),
      answer: S.str(),
      tone: S.enumOf(['plain', 'urgent', 'premium', 'warm', 'clinical', 'playful', 'blunt']),
      tier: S.enumOf(TIERS),
    }),
    'Four to six sub-avatars, each adding one or two categories to the core avatar, the most reachable first.',
  ),
})

/** Rules sub-avatars: the core avatar crossed with the research triggers and objections. */
export function rulesSubAvatars(core: Avatar, research: Research | null): AvatarInput[] {
  const triggers = research?.triggers ?? []
  const objections = research?.objections ?? []
  const out: AvatarInput[] = []
  triggers.slice(0, 3).forEach((trigger, index) => {
    out.push({
      name: `${core.name} — ${trigger.toLowerCase()}`,
      label: trigger.toLowerCase(),
      who: `${core.who} ${trigger}.`,
      wants: core.wants,
      fears: core.fears,
      buysWhen: trigger,
      share: 0,
      desire: core.desire || `I want ${core.wants.replace(/\.$/, '').toLowerCase()}`,
      experience: trigger,
      emotion: '',
      behaviour: '',
      demographic: '',
      angle: `${core.angle || core.wants.replace(/\.$/, '').toLowerCase()} after ${trigger.toLowerCase()}`,
      hooks: [`${trigger}? Here is what to do about it.`, `If ${trigger.toLowerCase()}, this is for you.`],
      tone: core.tone,
      objection: objections[index]?.objection ?? core.objection,
      answer: objections[index]?.answer ?? core.answer,
      tier: 'niche',
      parentId: core.id,
      source: 'research',
      selected: false,
    })
  })
  return out
}

export async function suggestSubAvatars(db: Db, storeId: string, coreId: string, model?: ModelChoice | null): Promise<Avatar[]> {
  const core = getAvatar(db, storeId, coreId)
  if (!core) throw new Error('No avatar with that id')
  const research = latestResearch(db, storeId)
  const choice = model === undefined ? modelFor(db, storeId, 'research') : model
  let suggested: AvatarInput[] = []
  if (choice) {
    try {
      const prompt = [
        `Core avatar:\n${JSON.stringify({ name: core.name, who: core.who, wants: core.wants, fears: core.fears, buysWhen: core.buysWhen, desire: core.desire, angle: core.angle, label: core.label })}`,
        research ? `Research:\n${JSON.stringify({ category: research.category, positioning: research.positioning, triggers: research.triggers, objections: research.objections, competitors: research.competitors })}` : '',
        answersForPrompt(buildState(db, storeId)),
        'Write the sub-avatars under this core avatar. Keep the desire exactly; add an experience, an emotion or a behaviour (a demographic only when the product works better for it). Each sub-avatar gives a different angle.',
      ]
        .filter(Boolean)
        .join('\n\n')
      const parsed = await completeJson<{ avatars: Array<Omit<AvatarInput, 'source' | 'selected' | 'parentId' | 'share' | 'wants' | 'fears' | 'buysWhen'>> }>(choice, {
        task: 'research',
        system: `You build sub-avatars for a dropshipping brand: the core avatar's desire, layered with one more category at a time, each giving an angle.\n\n${knowledge('avatars', 'creatives', 'honesty')}`,
        prompt,
        schema: SUB_SCHEMA,
        name: 'sub_avatars',
        maxTokens: 7000,
      })
      suggested = (parsed.avatars ?? []).map((avatar) => ({ ...avatar, wants: core.wants, fears: core.fears, buysWhen: avatar.experience || core.buysWhen, share: 0, hooks: (avatar.hooks ?? []).slice(0, 5), parentId: core.id, source: 'research' as const, selected: false }))
      log.info(`sub-avatars for ${core.name} written by ${describe(choice)}`)
    } catch (error) {
      log.warn(`${describe(choice)} could not write sub-avatars; using the rules: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!suggested.length) suggested = rulesSubAvatars(core, research)
  const existing = new Set(listAvatars(db, storeId).map((avatar) => avatar.name.toLowerCase()))
  for (const avatar of suggested) {
    if (!avatar.name?.trim() || existing.has(avatar.name.toLowerCase())) continue
    saveAvatar(db, storeId, avatar)
    existing.add(avatar.name.toLowerCase())
  }
  return listAvatars(db, storeId).filter((avatar) => avatar.parentId === core.id)
}

/* ---------------------------------------------------------------- ad plan */

export type AdPlanRow = { concept: string; subAvatar: string; desire: string; angle: string; variations: string[]; format: string; method: 'marksman' | 'sniper'; awareness: string; why: string; status: 'idea' | 'working' | 'learning' | 'done'; result: string; learnings: string }
export type AdPlan = { rows: AdPlanRow[]; note: string }

const PLAN_SCHEMA = S.obj({
  rows: S.arr(S.obj({
    concept: S.str('The big idea of the test, internal.'),
    subAvatar: S.str('Which avatar or sub-avatar it targets.'),
    desire: S.str(),
    angle: S.str('The reason to buy, external. Always written even when the concept names it.'),
    variations: S.arr(S.str(), 'Three: for marksman three angles said once each; for sniper one angle said three ways. Each is a hook.'),
    format: S.str('static | product-photo-headline | meme | us-vs-them | voiceover-b-roll | subtitles-b-roll | slideshow | ugc'),
    method: S.enumOf(['marksman', 'sniper']),
    awareness: S.str('problem | solution | product | most'),
    why: S.str('Why this will work, as a hypothesis.'),
  }), 'Five to eight rows: statics first as marksman sub-avatar tests, then a sniper video on the angle most likely to win.'),
  note: S.str('One paragraph on the order to run them and what to learn from each.'),
})

export function rulesPlan(avatars: Avatar[], research: Research | null): AdPlan {
  const picked = avatars.filter((avatar) => avatar.selected).slice(0, 3)
  const rows: AdPlanRow[] = picked.length
    ? [
        { concept: 'Sub-avatar callout statics', subAvatar: picked.map((avatar) => avatar.name).join(' / '), desire: picked[0]?.desire || picked[0]?.wants || '', angle: picked.map((avatar) => avatar.angle).filter(Boolean).join(' / '), variations: picked.map((avatar) => avatar.hooks[0] ?? avatar.angle), format: 'static', method: 'marksman', awareness: 'solution', why: 'Three sub-avatars, one execution each, to find which person responds.', status: 'idea', result: '', learnings: '' },
        { concept: 'Video on the winning angle', subAvatar: picked[0]?.name ?? '', desire: picked[0]?.desire || picked[0]?.wants || '', angle: picked[0]?.angle ?? '', variations: (picked[0]?.hooks ?? []).slice(0, 3), format: 'subtitles-b-roll', method: 'sniper', awareness: 'problem', why: 'One angle said three ways once the statics show direction.', status: 'idea', result: '', learnings: '' },
      ]
    : []
  return { rows, note: research ? 'Statics first as a marksman test across sub-avatars; process the learnings; then a sniper video on the angle that got spend.' : 'Run research and turn on avatars first.' }
}

export async function runAdPlan(db: Db, storeId: string, model?: ModelChoice | null): Promise<MarketDoc<AdPlan>> {
  const avatars = listAvatars(db, storeId)
  const research = latestResearch(db, storeId)
  const analysis = latestDoc<MarketAnalysis>(db, storeId, 'analysis')
  const choice = model === undefined ? modelFor(db, storeId, 'ads') : model
  let plan = rulesPlan(avatars, research)
  let source: MarketDoc['source'] = 'rules'
  let modelName = ''
  if (choice && avatars.length) {
    try {
      const prompt = [
        `Avatars:\n${JSON.stringify(avatars.map((avatar) => ({ name: avatar.name, parent: avatar.parentId ? avatars.find((other) => other.id === avatar.parentId)?.name : '', label: avatar.label, desire: avatar.desire || avatar.wants, experience: avatar.experience, emotion: avatar.emotion, behaviour: avatar.behaviour, angle: avatar.angle, hooks: avatar.hooks, selected: avatar.selected })))}`,
        research ? `Research: ${JSON.stringify({ category: research.category, positioning: research.positioning, triggers: research.triggers })}` : '',
        analysis ? `Market analysis: ${JSON.stringify({ awareness: analysis.body.awareness, sophistication: analysis.body.sophistication, leadDesire: analysis.body.leadDesire, mechanisms: analysis.body.mechanisms, standOut: analysis.body.standOut, calendar: analysis.body.calendar })}` : '',
        loopBrief(db, storeId),
        'Write the ad plan: what to test first, second and third, as concept → angle → variations → format → method.',
      ]
        .filter(Boolean)
        .join('\n\n')
      const parsed = await completeJson<{ rows: Array<Omit<AdPlanRow, 'status' | 'result' | 'learnings'>>; note: string }>(choice, {
        task: 'ads',
        system: `You plan ad tests for a dropshipping brand. Every row has an angle; statics first as marksman tests across sub-avatars; sniper video on what wins; one concept a day.\n\n${knowledge('creatives', 'testing', 'avatars', 'honesty')}`,
        prompt,
        schema: PLAN_SCHEMA,
        name: 'ad_plan',
        maxTokens: 7000,
      })
      plan = { rows: (parsed.rows ?? []).map((row) => ({ ...row, method: row.method === 'sniper' ? 'sniper' : 'marksman', variations: (row.variations ?? []).slice(0, 3), status: 'idea' as const, result: '', learnings: '' })), note: parsed.note ?? '' }
      source = 'model'
      modelName = choice.model
    } catch (error) {
      log.warn(`${describe(choice)} could not write the ad plan; using the rules: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const existing = latestDoc<AdPlan>(db, storeId, 'ad-plan')
  // Rows already being worked keep their status and learnings; new rows are appended.
  if (existing) {
    const kept = existing.body.rows.filter((row) => row.status !== 'idea')
    const names = new Set(kept.map((row) => row.concept.toLowerCase()))
    plan = { rows: [...kept, ...plan.rows.filter((row) => !names.has(row.concept.toLowerCase()))], note: plan.note }
  }
  return saveDoc<AdPlan>(db, storeId, { ...(existing ? { id: existing.id } : {}), kind: 'ad-plan', title: 'Ad plan', body: plan, source, model: modelName })
}

/**
 * A plan row as a request the ad writer can take.
 *
 * The plan named the concept, the angle, the three variations, the format and
 * the method — and then the owner retyped all of it into the ad drafter by
 * hand, because nothing connected the two. The row's own words become the
 * direction, its sub-avatar picks the avatar, and its format maps onto the ad
 * formats that exist.
 */
export function planRowRequest(row: AdPlanRow, avatars: Avatar[]): { direction: string; avatarId?: string; formats: string[]; count: number } {
  const FORMATS: Record<string, string> = {
    static: 'static',
    'product-photo-headline': 'static',
    meme: 'static',
    slideshow: 'static',
    'us-vs-them': 'us-vs-them',
    'voiceover-b-roll': 'ugc-script',
    'subtitles-b-roll': 'ugc-script',
    ugc: 'ugc-script',
  }
  const named = row.subAvatar.split('/')[0]?.trim().toLowerCase() ?? ''
  const avatar = named ? avatars.find((entry) => entry.name.toLowerCase() === named) ?? avatars.find((entry) => entry.name.toLowerCase().includes(named)) : undefined
  const direction = [
    row.subAvatar ? `for ${row.subAvatar}` : '',
    row.angle ? `focus on ${row.angle}` : '',
    ...row.variations.slice(0, 3).map((hook) => `"${hook.replace(/"/g, '')}"`),
  ]
    .filter(Boolean)
    .join(', ')
  return {
    direction,
    ...(avatar ? { avatarId: avatar.id } : {}),
    formats: [FORMATS[row.format] ?? 'static'],
    count: Math.max(1, Math.min(3, row.variations.length || 3)),
  }
}

/**
 * The loops on file, as a brief. The card promised they were "kept here so the
 * planner and the writers can read them" and nothing read them: an account
 * could write down that statics keep failing and the planner would keep
 * proposing statics.
 */
export function loopBrief(db: Db, storeId: string, limit = 3): string {
  const loops = listDocs<Loop>(db, storeId, 'loop').slice(0, limit)
  if (!loops.length) return ''
  const lines = loops.map((doc) => {
    const l = doc.body
    return [
      l.failing ? `keeps failing: ${l.failing}` : '',
      l.working ? `keeps working: ${l.working}` : '',
      l.actions.length ? `tried: ${l.actions.join('; ')}` : '',
      l.outcome ? `outcome: ${l.outcome}` : 'outcome: not recorded yet',
    ]
      .filter(Boolean)
      .join(' · ')
  })
  return `What this account has already learned, from its own feedback loops. Do not propose what has already failed here, and lean on what is working:\n${lines.map((line) => `- ${line}`).join('\n')}`
}

export function updatePlanRow(db: Db, storeId: string, index: number, patch: Partial<Pick<AdPlanRow, 'status' | 'result' | 'learnings' | 'angle' | 'variations'>>): MarketDoc<AdPlan> {
  const doc = latestDoc<AdPlan>(db, storeId, 'ad-plan')
  if (!doc) throw new Error('No ad plan yet')
  const rows = doc.body.rows.map((row, at) => (at === index ? { ...row, ...patch } : row))
  return saveDoc<AdPlan>(db, storeId, { id: doc.id, kind: 'ad-plan', title: doc.title, body: { ...doc.body, rows } })
}

/* ---------------------------------------------------------- feedback loop */

export type Loop = { failing: string; working: string; hypotheses: string[]; actions: string[]; outcome: string }

export function saveLoop(db: Db, storeId: string, input: Loop & { id?: string; title?: string }): MarketDoc<Loop> {
  const { id: docId, title, ...body } = input
  return saveDoc<Loop>(db, storeId, { ...(docId ? { id: docId } : {}), kind: 'loop', title: title || `Feedback loop — ${now().slice(0, 10)}`, body, source: 'manual' })
}
