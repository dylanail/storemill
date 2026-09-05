import { json, now, type Db } from '../lib/db.ts'
import { answersForPrompt, buildState } from '../control/build.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import { readBrief, type Brief } from './copy.ts'
import { completeJson, describe, modelFor, S, type ModelChoice } from './models.ts'
import { knowledge } from './knowledge.ts'

const log = logger('research')

/**
 * Customer research.
 *
 * Before a single product page is written, the platform works out who buys
 * this, what stops them, what they compare it against and what they will pay.
 * Every page that follows reads this record: the benefits are answers to the
 * triggers, the FAQ is the objections, the comparison table is the competitor
 * angles, the price sits inside the anchor. Copy that is not grounded in this
 * is the difference between a store that looks generated and one that sells.
 */
export type Persona = {
  name: string
  who: string
  wants: string
  fears: string
  buysWhen: string
  share: number
}

export type Research = {
  category: string
  positioning: string
  audience: Persona[]
  triggers: string[]
  objections: Array<{ objection: string; answer: string }>
  competitors: Array<{ name: string; angle: string; priceBand: string; weakness: string }>
  priceAnchor: { lowCents: number; midCents: number; highCents: number; note: string }
  keywords: string[]
  proofPoints: string[]
  comparison: { us: string[]; them: string[]; rows: Array<{ label: string; us: string; them: string }> }
  /** What the source material (site or image) told us, if anything. */
  sourceNotes: string[]
}

export type ResearchSource = 'rules' | 'model' | 'model+site'
export type ResearchRecord = Research & { id: string; source: ResearchSource; model: string; brief: string; createdAt: string }

/* ------------------------------------------------------------ the knowledge */

type CategoryKnowledge = {
  personas: Array<Omit<Persona, 'share'> & { share: number }>
  triggers: string[]
  objections: Array<{ objection: string; answer: string }>
  competitors: Array<{ name: string; angle: string; priceBand: string; weakness: string }>
  anchor: [number, number, number]
  keywords: string[]
  rows: Array<{ label: string; us: string; them: string }>
}

const KNOWLEDGE: Record<string, CategoryKnowledge> = {
  'boxing gear': {
    personas: [
      { name: 'The serious amateur', who: 'Trains 3–5 times a week, spars, has been through two pairs of gym-brand gloves.', wants: 'Wrist support that survives a year and padding that protects a partner.', fears: 'Paying premium money for a logo.', buysWhen: 'The current pair goes soft at the wrist.', share: 0.45 },
      { name: 'The coach', who: 'Runs a gym or a small fight team and buys for others.', wants: 'Gear that holds up to daily shared use and can be repaired.', fears: 'A brand that vanishes when a lace or a stitch fails.', buysWhen: 'Kitting out new members or replacing club stock.', share: 0.2 },
      { name: 'The gift buyer', who: 'Partner or parent of someone who trains, does not box.', wants: 'Something obviously well made that will be used, not shelved.', fears: 'Choosing the wrong size or weight.', buysWhen: 'A birthday or a first fight.', share: 0.2 },
      { name: 'The collector', who: 'Loves the craft and the heritage as much as the sport.', wants: 'Materials, provenance, the story of the workshop.', fears: 'Mass-produced gear dressed up as artisan.', buysWhen: 'A limited run or a custom option appears.', share: 0.15 },
    ],
    triggers: ['The wrist closure failed on the last pair', 'A sparring partner complained about hard gloves', 'Starting to spar for the first time', 'Wanting one pair that lasts instead of three that do not'],
    objections: [
      { objection: 'They cost three times what my gym sells.', answer: 'They are built to outlast three of those pairs, and the wrist and lace can be repaired instead of replaced.' },
      { objection: 'Leather gloves need breaking in.', answer: 'About two weeks of bag work. We tell you that up front because the payoff is a glove shaped to your hand for years.' },
      { objection: 'I do not know which weight to buy.', answer: '14oz for bag and pads, 16oz for sparring at most gyms. If your coach says otherwise, follow your coach — and we exchange free.' },
      { objection: 'Fourteen days is a long wait.', answer: 'Every pair is built to order by one person. Stock builds ship in fourteen days; custom in twenty-one.' },
    ],
    competitors: [
      { name: 'Gym-brand basics', angle: 'Cheap, available today, everyone has them.', priceBand: '$40–80', weakness: 'Wrist support goes soft inside a year; not repairable.' },
      { name: 'Big-name pro gear', angle: 'Seen on fighters, heavy marketing.', priceBand: '$150–250', weakness: 'Much of the price is the logo; often factory-made.' },
      { name: 'Custom heritage makers', angle: 'Hand-made, long waits, mostly word of mouth.', priceBand: '$300–500', weakness: 'Hard to buy from; no returns; months of lead time.' },
    ],
    anchor: [8000, 22000, 45000],
    keywords: ['leather boxing gloves', 'lace up boxing gloves', 'sparring gloves 16oz', 'handmade boxing gloves', 'best boxing gloves for sparring', 'boxing gloves mexican style'],
    rows: [
      { label: 'Leather', us: 'Full-grain, vegetable-tanned', them: 'Split leather or synthetic' },
      { label: 'Wrist', us: 'Lace-up, repairable', them: 'Velcro, wears out' },
      { label: 'Padding', us: 'Layered horsehair and foam', them: 'Moulded foam' },
      { label: 'Made', us: 'One person, built to order', them: 'Factory line' },
      { label: 'Repairs', us: 'In-house, for life', them: 'None' },
    ],
  },
  skincare: {
    personas: [
      { name: 'The ingredient reader', who: 'Knows what niacinamide does and checks the percentage.', wants: 'Clinical actives at honest concentrations without fragrance.', fears: 'Marketing dressed as science.', buysWhen: 'A routine stops working or a new active gets attention.', share: 0.4 },
      { name: 'The minimalist', who: 'Wants three products that work and nothing else.', wants: 'A routine that takes two minutes.', fears: 'Ten-step regimes and drawers of half-used jars.', buysWhen: 'Simplifying after an overwhelming phase.', share: 0.3 },
      { name: 'The sensitive-skin buyer', who: 'Has reacted badly before and reads reviews for that word.', wants: 'Proof it will not sting.', fears: 'Another wasted bottle and a flare-up.', buysWhen: 'Someone with the same skin recommends it.', share: 0.3 },
    ],
    triggers: ['A product caused a reaction', 'Dry winter skin', 'A routine has too many steps', 'A dermatologist mentioned an ingredient'],
    objections: [
      { objection: 'How is this different from the pharmacy version?', answer: 'Same actives, at the concentrations the studies used, without fragrance or filler. The label says the percentages.' },
      { objection: 'Will it irritate sensitive skin?', answer: 'It is fragrance-free and patch-tested; start every other night. If it does not suit you, send it back — even opened.' },
      { objection: 'It is expensive for 30ml.', answer: 'A pea-sized amount twice a day lasts about ten weeks. Per week it costs less than a coffee.' },
    ],
    competitors: [
      { name: 'Pharmacy actives', angle: 'Cheap, clinical, no frills.', priceBand: '$8–20', weakness: 'Inconsistent formulations; harsh bases.' },
      { name: 'Prestige counters', angle: 'Luxury texture, beautiful packaging.', priceBand: '$80–200', weakness: 'You pay for the jar; actives are vague.' },
      { name: 'Influencer brands', angle: 'Trend-led, fast launches.', priceBand: '$30–60', weakness: 'Fragrance-heavy; little published testing.' },
    ],
    anchor: [2500, 6000, 12000],
    keywords: ['barrier repair serum', 'fragrance free moisturiser', 'niacinamide serum', 'sensitive skin routine', 'minimal skincare routine'],
    rows: [
      { label: 'Actives', us: 'Named, with percentages', them: '"Proprietary complex"' },
      { label: 'Fragrance', us: 'None', them: 'Usually added' },
      { label: 'Testing', us: 'Patch-tested, published', them: 'Rarely stated' },
      { label: 'Routine', us: 'Three steps', them: 'Seven to ten' },
    ],
  },
  coffee: {
    personas: [
      { name: 'The home brewer', who: 'Owns a grinder and a scale; has opinions about water.', wants: 'Fresh roast dates and origin detail.', fears: 'Stale beans from a warehouse.', buysWhen: 'Running out, every two to three weeks.', share: 0.5 },
      { name: 'The office buyer', who: 'Orders for a team; wants it simple and reliable.', wants: 'Consistent house blend on a subscription.', fears: 'Complaints from colleagues.', buysWhen: 'The office runs dry.', share: 0.25 },
      { name: 'The gifter', who: 'Buying for someone who is fussy about coffee.', wants: 'Something that looks considered.', fears: 'Getting it wrong.', buysWhen: 'Holidays.', share: 0.25 },
    ],
    triggers: ['Bought a grinder', 'Stale supermarket beans', 'Wanting a subscription that just arrives', 'Curiosity about a specific origin'],
    objections: [
      { objection: 'Why pay twice the supermarket price?', answer: 'Roast date on every bag, shipped within days of roasting. Supermarket beans are months old before you open them.' },
      { objection: 'Will it suit my machine?', answer: 'Choose the grind for your brewer at checkout, or whole bean if you grind at home.' },
      { objection: 'I do not want to be locked into a subscription.', answer: 'Pause, skip or cancel from one page. No calls, no forms.' },
    ],
    competitors: [
      { name: 'Supermarket', angle: 'Cheap and everywhere.', priceBand: '$6–12', weakness: 'No roast date; stale.' },
      { name: 'Big speciality roasters', angle: 'Known names, wide range.', priceBand: '$16–24', weakness: 'Shipping delays; blends change.' },
      { name: 'Local micro-roasters', angle: 'Very fresh, very small.', priceBand: '$14–22', weakness: 'Hard to buy online; inconsistent.' },
    ],
    anchor: [1400, 2200, 3600],
    keywords: ['single origin coffee', 'fresh roasted coffee beans', 'coffee subscription', 'espresso beans online', 'filter coffee beans'],
    rows: [
      { label: 'Roast date', us: 'On every bag', them: 'Best-before only' },
      { label: 'Shipped', us: 'Within 3 days of roasting', them: 'Weeks to months' },
      { label: 'Origin', us: 'Farm and lot named', them: '"Blend"' },
      { label: 'Subscription', us: 'Pause or cancel in one click', them: 'Call to cancel' },
    ],
  },
}

const GENERIC: CategoryKnowledge = {
  personas: [
    { name: 'The considered buyer', who: 'Researches before buying and reads the reviews that mention flaws.', wants: 'Something that will not need replacing.', fears: 'Overpaying for marketing.', buysWhen: 'The cheap version fails.', share: 0.4 },
    { name: 'The gift buyer', who: 'Buying for someone with taste they do not share.', wants: 'An obvious signal of quality.', fears: 'Choosing wrong.', buysWhen: 'An occasion is close.', share: 0.3 },
    { name: 'The enthusiast', who: 'Cares about the craft and the materials.', wants: 'Provenance and detail.', fears: 'Mass-produced goods dressed as artisan.', buysWhen: 'A limited run or new piece appears.', share: 0.3 },
  ],
  triggers: ['The last one broke', 'An occasion', 'A recommendation from someone trusted', 'Wanting to buy once and stop thinking about it'],
  objections: [
    { objection: 'It costs more than the alternatives.', answer: 'It is built to outlast them and to be repaired rather than replaced.' },
    { objection: 'How do I know it is good?', answer: 'Every material is named, the maker is named, and returns are free for thirty days.' },
    { objection: 'How long will it take?', answer: 'Built to order and shipped in fourteen days; the date is shown before you pay.' },
  ],
  competitors: [
    { name: 'Marketplace listings', angle: 'Cheapest option, next-day delivery.', priceBand: 'Low', weakness: 'Unknown maker; no support.' },
    { name: 'Established brand', angle: 'Recognised name.', priceBand: 'Mid to high', weakness: 'Price carries the marketing.' },
    { name: 'Artisan makers', angle: 'Hand-made, small.', priceBand: 'High', weakness: 'Hard to buy from; long waits.' },
  ],
  anchor: [4000, 12000, 30000],
  keywords: [],
  rows: [
    { label: 'Materials', us: 'Named, chosen one at a time', them: 'Unspecified' },
    { label: 'Made', us: 'Small runs, by name', them: 'Factory line' },
    { label: 'Repairs', us: 'In-house', them: 'None' },
    { label: 'Returns', us: '30 days, free', them: 'Varies' },
  ],
}

/* --------------------------------------------------------------- the rules */

export function rulesResearch(brief: Brief, sourceNotes: string[] = []): Research {
  const knowledge = KNOWLEDGE[brief.category] ?? GENERIC
  const keywords = knowledge.keywords.length
    ? knowledge.keywords
    : [`handmade ${brief.category}`, `best ${brief.category}`, ...(brief.place ? [`${brief.category} ${brief.place.toLowerCase()}`] : []), `${brief.material} ${brief.category}`, `buy ${brief.category} online`]
  const [low, mid, high] = knowledge.anchor
  return {
    category: brief.category,
    positioning: `${capitalize(brief.category)} for ${brief.audience}, made from ${brief.material}${brief.place ? ` in ${brief.place}` : ''} — priced above the mass market and below the bespoke makers, and easier to buy from than either.`,
    audience: knowledge.personas.map((persona) => ({ ...persona })),
    triggers: knowledge.triggers,
    objections: knowledge.objections,
    competitors: knowledge.competitors,
    priceAnchor: {
      lowCents: low,
      midCents: mid,
      highCents: high,
      note: `The mass market sits around ${(low / 100).toFixed(0)}, the bespoke makers around ${(high / 100).toFixed(0)}. Sitting near ${(mid / 100).toFixed(0)} reads as premium without needing a waiting list to justify it.`,
    },
    keywords,
    proofPoints: [
      `${capitalize(brief.material)}, named on the page`,
      // A place of manufacture and a lifetime repair promise are the
      // merchant's to make, not the scaffolding's. They are here only when the
      // owner's own sentence said so.
      ...(brief.place ? [`Made in ${brief.place} in small runs`] : []),
      'Free returns for thirty days',
      'Ship date shown before checkout',
    ],
    comparison: {
      us: knowledge.rows.map((row) => row.us),
      them: knowledge.rows.map((row) => row.them),
      rows: knowledge.rows,
    },
    sourceNotes,
  }
}

/* --------------------------------------------------------------- the model */

export const RESEARCH_SCHEMA = S.obj({
  category: S.str('The product category in two or three plain words.'),
  positioning: S.str('One sentence: what this brand is for whom, against what, at what price position.'),
  audience: S.arr(
    S.obj({
      name: S.str('"The serious amateur" — a label the owner will recognise.'),
      who: S.str('Who they are, in a sentence with concrete detail.'),
      wants: S.str('The outcome they are buying.'),
      fears: S.str('What they are afraid of getting wrong.'),
      buysWhen: S.str('The moment that triggers the purchase.'),
      share: S.num('Fraction of buyers, 0 to 1; the shares add up to 1.'),
    }),
    'Three to five buyer personas, biggest first.',
  ),
  triggers: S.arr(S.str(), 'Four to six purchase triggers: the event or frustration that makes someone go looking.'),
  objections: S.arr(S.obj({ objection: S.str('In the buyer\'s own words.'), answer: S.str('The honest answer the page should give.') }), 'Four to six objections, most common first.'),
  competitors: S.arr(
    S.obj({ name: S.str('A real brand if you are sure of it, otherwise a type: "Amazon generics".'), angle: S.str('What they lead with.'), priceBand: S.str('"$40–80"'), weakness: S.str('Where they lose buyers.') }),
    'Three or four competitors or competitor types.',
  ),
  priceAnchor: S.obj({
    lowCents: S.int('Mass-market price, minor units.'),
    midCents: S.int('Where this brand should sit, minor units.'),
    highCents: S.int('The bespoke or premium ceiling, minor units.'),
    note: S.str('One sentence on why the middle number is right.'),
  }),
  keywords: S.arr(S.str(), 'Six to ten search phrases buyers actually type.'),
  proofPoints: S.arr(S.str(), 'Five to seven short claims the pages can make. Only things the brief supports, or promises the brand should make (returns, guarantee); never invented numbers.'),
  comparison: S.obj({
    rows: S.arr(S.obj({ label: S.str('The criterion.'), us: S.str('This brand.'), them: S.str('The usual alternative.') }), 'Four to six rows for the comparison table.'),
  }),
  sourceNotes: S.arr(S.str(), 'What the source material told you, one note per fact. Empty when there was none.'),
})

type ModelResearch = Omit<Research, 'comparison'> & { comparison: { rows: Research['comparison']['rows'] } }

const RESEARCH_SYSTEM = `You are a direct-response strategist doing customer research for a dropshipping brand that sells through paid social, advertorials and a Shopify-style store. Write the record from what you know about this category and its buyers. Be specific to the brief. Never invent statistics, review counts, study names or awards. When you do not know a competitor by name, describe the type. Prices are integers in minor units (cents) of the given currency. Do not invent a place of manufacture or a material the brief does not give; write around what you do not know. Personas are desire-based: name the instinct each one is really buying for, the experience they are coming from, and the language they would use. Triggers are moments. Objections are what the buyer actually says.\n\n${knowledge('desires', 'sophistication', 'avatars', 'honesty')}`

/**
 * The model authors the record. The rules baseline is not shown to it: a
 * generic record in the prompt produces a generic answer, and the point of
 * the model is to know things about this category the rules do not.
 */
async function modelResearch(choice: ModelChoice, brief: Brief, sourceText: string, currency: string, ownerAnswers = ''): Promise<Research> {
  const prompt = [
    `Brief from the owner: ${brief.prompt}`,
    `Category guess from the brief: ${brief.category === 'goods' ? '(none; decide from the brief)' : brief.category}`,
    `Currency: ${currency}`,
    // The build asks eight questions about the buyer in step four and runs
    // research in step five, and the card promises research fills in what the
    // owner does not know. The answers were written to the store and read only
    // by the market analysis: research, the step they exist for, never saw
    // them.
    ownerAnswers,
    sourceText ? `Source material from the owner's existing site (read it for positioning, claims and price; quote what is useful into sourceNotes):\n${sourceText.slice(0, 12000)}` : 'No source material was given.',
    `Write the full research record. Personas biggest first with shares summing to 1; triggers are moments, not adjectives; every objection gets the answer a good page would give; the comparison rows are the criteria this brand wins on against the usual alternative. Where the owner has answered a question above, that answer is a fact about their buyer and the record must agree with it; where they said they do not know, that is exactly what this research is for.`,
  ].filter(Boolean).join('\n\n')
  const parsed = await completeJson<ModelResearch>(choice, { task: 'research', system: RESEARCH_SYSTEM, prompt, schema: RESEARCH_SCHEMA, name: 'customer_research' })
  return normalizeResearch(parsed, brief)
}

/** Shares are normalised and every list is present, so the pages never trip on a thin record. */
function normalizeResearch(parsed: ModelResearch, brief: Brief): Research {
  const baseline = rulesResearch(brief)
  const audience = (parsed.audience?.length ? parsed.audience : baseline.audience).map((persona) => ({ ...persona, share: Math.max(0, Number(persona.share) || 0) }))
  const total = audience.reduce((sum, persona) => sum + persona.share, 0) || 1
  const rows = parsed.comparison?.rows?.length ? parsed.comparison.rows : baseline.comparison.rows
  return {
    category: parsed.category?.trim() || brief.category,
    positioning: parsed.positioning?.trim() || baseline.positioning,
    audience: audience.map((persona) => ({ ...persona, share: Math.round((persona.share / total) * 100) / 100 })),
    triggers: parsed.triggers?.length ? parsed.triggers : baseline.triggers,
    objections: parsed.objections?.length ? parsed.objections : baseline.objections,
    competitors: parsed.competitors?.length ? parsed.competitors : baseline.competitors,
    priceAnchor: parsed.priceAnchor?.midCents ? parsed.priceAnchor : baseline.priceAnchor,
    keywords: parsed.keywords?.length ? parsed.keywords : baseline.keywords,
    proofPoints: parsed.proofPoints?.length ? parsed.proofPoints : baseline.proofPoints,
    comparison: { us: rows.map((row) => row.us), them: rows.map((row) => row.them), rows },
    sourceNotes: parsed.sourceNotes ?? [],
  }
}

export type AuthoredResearch = { research: Research; source: ResearchSource; model: string }

/**
 * Research, authored. With a model it writes the record from the brief and
 * the source; without one the category rules stand in and the record says so.
 * A configured model that fails is an error the caller sees, not a silent
 * downgrade to rules.
 */
export async function authorResearch(
  choice: ModelChoice | null,
  brief: Brief,
  input: { sourceText?: string; notes?: string[]; currency?: string; hasSite?: boolean; ownerAnswers?: string } = {},
): Promise<AuthoredResearch> {
  const notes = input.notes ?? []
  if (!choice) return { research: rulesResearch(brief, notes), source: 'rules', model: '' }
  const research = await modelResearch(choice, brief, input.sourceText ?? '', input.currency ?? 'USD', input.ownerAnswers ?? '')
  log.info(`research written by ${describe(choice)} for "${brief.prompt.slice(0, 60)}"`)
  return { research: { ...research, sourceNotes: [...notes, ...research.sourceNotes] }, source: input.hasSite ? 'model+site' : 'model', model: choice.model }
}

/* --------------------------------------------------------------- the source */

/**
 * A pasted URL is read for what it says about the brand: title, description,
 * headings and the first few hundred words. That text goes to the model when
 * there is one, and its headings become source notes either way.
 */
export async function readSite(url: string): Promise<{ text: string; notes: string[] }> {
  const notes: string[] = []
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'storemillResearch/1.0' } })
    clearTimeout(timer)
    if (!response.ok) return { text: '', notes: [`Could not read ${url} (${response.status})`] }
    const html = (await response.text()).slice(0, 400_000)
    const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]?.trim()
    const description = /<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})/i.exec(html)?.[1]?.trim()
    const headings = [...html.matchAll(/<h[12][^>]*>([\s\S]{1,120}?)<\/h[12]>/gi)].map((match) => strip(match[1] ?? '')).filter(Boolean).slice(0, 8)
    const body = strip(html.replace(/<(script|style|nav|footer)[\s\S]*?<\/\1>/gi, '')).slice(0, 4000)
    if (title) notes.push(`Existing site title: ${title}`)
    if (description) notes.push(`Existing site description: ${description}`)
    for (const heading of headings.slice(0, 4)) notes.push(`Heading on the existing site: ${heading}`)
    return { text: [title, description, ...headings, body].filter(Boolean).join('\n'), notes }
  } catch {
    return { text: '', notes: [`Could not reach ${url}`] }
  }
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/* --------------------------------------------------------------- the record */

export function saveResearch(db: Db, storeId: string, authored: AuthoredResearch, brief: string): ResearchRecord {
  const recordId = id('res')
  const createdAt = now()
  db.insert('store_research', { id: recordId, store_id: storeId, source: authored.source, brief, body: { ...authored.research, model: authored.model }, created_at: createdAt })
  return { ...authored.research, id: recordId, source: authored.source, model: authored.model, brief, createdAt }
}

export async function runResearch(
  db: Db,
  storeId: string,
  input: { prompt: string; siteUrl?: string; imageNote?: string; currency?: string; model?: ModelChoice | null },
): Promise<ResearchRecord> {
  const brief = readBrief(input.prompt)
  const notes: string[] = []
  let sourceText = ''
  if (input.siteUrl) {
    const site = await readSite(input.siteUrl)
    sourceText = site.text
    notes.push(...site.notes)
  }
  if (input.imageNote) notes.push(input.imageNote)
  const choice = input.model === undefined ? modelFor(db, storeId, 'research') : input.model
  const state = buildState(db, storeId)
  const ownerAnswers = Object.keys(state.answers).length ? answersForPrompt(state) : ''
  const authored = await authorResearch(choice, brief, {
    sourceText,
    notes,
    ...(input.currency ? { currency: input.currency } : {}),
    hasSite: Boolean(input.siteUrl && sourceText),
    ...(ownerAnswers ? { ownerAnswers } : {}),
  })
  return saveResearch(db, storeId, authored, input.prompt)
}

export function latestResearch(db: Db, storeId: string): ResearchRecord | null {
  const row = db.one<{ id: string; source: ResearchRecord['source']; brief: string; body: string; created_at: string }>(
    'SELECT * FROM store_research WHERE store_id = ? ORDER BY created_at DESC LIMIT 1',
    storeId,
  )
  if (!row) return null
  const { model = '', ...body } = json<Research & { model?: string }>(row.body, rulesResearch(readBrief(row.brief)))
  return { ...body, id: row.id, source: row.source, model, brief: row.brief, createdAt: row.created_at }
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}
