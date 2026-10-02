import { logger } from '../lib/log.ts'
import { format as money } from '../lib/money.ts'
import type { Research } from './research.ts'
import { completeJson, describe, S, type ModelChoice } from './models.ts'
import { knowledge, knowledgeContext } from './knowledge.ts'
import { announcement, brandDescription, brandName, brandVoice, collectionPlan, draftProducts, MOODS, slogan, type Brief, type DraftProduct } from './copy.ts'

const log = logger('brand')

/**
 * The brand kit: name, voice, the announcement bar, and the first three
 * products with their copy. At onboarding the model writes it from the brief
 * and the research; the rules writer in `copy.ts` is what runs when there is
 * no model, and what the tests run on.
 */
export type BrandKit = {
  name: string
  /** One of the curated palette moods; the palette and fonts follow from it. */
  mood: string
  slogan: string
  description: string
  voice: string
  announcement: string
  products: DraftProduct[]
  collections: Array<{ title: string; description: string }>
  source: 'model' | 'rules'
  model: string
}

export function rulesBrandKit(brief: Brief): BrandKit {
  const name = brandName(brief)
  return {
    name,
    mood: brief.mood,
    slogan: slogan(brief, name),
    description: brandDescription(brief, name),
    voice: brandVoice(brief),
    announcement: announcement(brief),
    products: draftProducts(brief, name),
    collections: collectionPlan(brief),
    source: 'rules',
    model: '',
  }
}

const KIT_SCHEMA = S.obj({
  name: S.str('The brand name. Short, sayable, brandable; no "Shop", no "Online", no "Store".'),
  mood: S.enumOf(MOODS, 'The visual mood; the palette and fonts follow from it.'),
  slogan: S.str('Under eight words.'),
  description: S.str('Two or three sentences about the brand, for the About page and the footer.'),
  voice: S.str('A one-sentence brief for whoever writes for this brand: register, what to name, what to avoid.'),
  announcement: S.str('The announcement bar: two or three short facts separated by " · ", uppercase, only verified merchant facts; empty if none. Never infer free shipping or a returns policy.'),
  products: S.arr(
    S.obj({
      title: S.str('"The Sparring Glove" — a product name, not a category.'),
      subtitle: S.str('One line under the title.'),
      description: S.str('150 to 200 words: what it is, what it is made of or does, how it behaves over time, who it is not for.'),
      priceCents: S.int('Price in minor units, inside the research price anchor.'),
      role: S.enumOf(['hero', 'complement'], 'The first product is the hero; the other two complement it.'),
      tags: S.arr(S.str(), 'Two to four tags.'),
      options: S.arr(S.obj({ title: S.str('"Size", "Colour", "Weight"'), values: S.arr(S.str(), 'Two to five values.') }), 'Zero to two option axes.'),
    }),
    'Exactly three products: the hero and two complements.',
  ),
  collections: S.arr(S.obj({ title: S.str(), description: S.str() }), 'Two collections. Include one called "New arrivals" and one called "The essentials".'),
})

type ModelKit = Omit<BrandKit, 'products' | 'source' | 'model'> & { products: Array<Omit<DraftProduct, 'options' | 'variantPlan'> & { options: Array<{ title: string; values: string[] }> }> }

const KIT_SYSTEM = `You build direct-to-consumer brands for a dropshipper who sells through paid social and advertorials. Write a brand kit that a good operator would ship: a name people can say, a voice that is specific rather than generic, and three products with copy that names concrete details and admits who the product is not for. Never invent awards, review counts, statistics, return policies, guarantees, delivery promises, shipping offers or unverified performance. Do not claim a place of manufacture or a material the brief does not give. Products are described by what they do for the buyer before what they are.\n\n${knowledge('product', 'desires', 'honesty')}`

export async function authorBrandKit(choice: ModelChoice | null, brief: Brief, research: Research, opts: { currency?: string } = {}): Promise<BrandKit> {
  const rules = rulesBrandKit(brief)
  if (!choice) return rules
  const explicit = /(?:called|named)\s+"?([A-Z][A-Za-z0-9'.]*(?:\s+(?:&|[A-Z][A-Za-z0-9'.]*)){0,3})"?/.exec(brief.prompt)?.[1]?.trim()
  const currency = opts.currency ?? 'USD'
  const prompt = [
    `Brief from the owner: ${brief.prompt}`,
    explicit ? `The brand is called "${explicit}". Use exactly that name.` : 'Name the brand.',
    `Currency: ${currency}. The research price anchor is ${money(research.priceAnchor.lowCents, currency)} (mass) / ${money(research.priceAnchor.midCents, currency)} (us) / ${money(research.priceAnchor.highCents, currency)} (bespoke); price the hero near the middle.`,
    `Moods to choose from: ${MOODS.join(', ')}.`,
    `Customer research on file:\n${JSON.stringify({ positioning: research.positioning, audience: research.audience, triggers: research.triggers, objections: research.objections, competitors: research.competitors, proofPoints: research.proofPoints, keywords: research.keywords })}`,
    'Write the kit. The product descriptions should read like a good DTC product page, not a catalog entry: benefits are answers to the triggers, and the last sentence says who should buy something else.',
  ].join('\n\n')
  const parsed = await completeJson<ModelKit>(choice, { task: 'brand', system: KIT_SYSTEM.replace(knowledge('product', 'desires', 'honesty'), knowledgeContext(['product', 'desires', 'honesty'], brief.prompt)), prompt, schema: KIT_SCHEMA, name: 'brand_kit' })
  const products: DraftProduct[] = (parsed.products ?? []).slice(0, 3).map((product, index) => ({
    title: product.title?.trim() || rules.products[index]?.title || `Product ${index + 1}`,
    subtitle: product.subtitle ?? '',
    description: product.description ?? '',
    priceCents: Math.max(100, Math.round(Number(product.priceCents) || research.priceAnchor.midCents)),
    options: (product.options ?? []).slice(0, 2).map((option) => ({ title: option.title, values: option.values.slice(0, 5).map((value) => ({ value })) })),
    variantPlan: [],
    tags: product.tags ?? [],
    role: index === 0 ? 'hero' : 'complement',
  }))
  log.info(`brand kit written by ${describe(choice)}: ${parsed.name}`)
  return {
    name: explicit ?? (parsed.name?.trim() || rules.name),
    mood: MOODS.includes(parsed.mood) ? parsed.mood : rules.mood,
    slogan: parsed.slogan?.trim() || rules.slogan,
    description: parsed.description?.trim() || rules.description,
    voice: parsed.voice?.trim() || rules.voice,
    announcement: parsed.announcement?.trim() || rules.announcement,
    products: products.length === 3 ? products : rules.products,
    collections: parsed.collections?.length ? parsed.collections : rules.collections,
    source: 'model',
    model: choice.model,
  }
}

/* ------------------------------------------------------------ product copy */

const COPY_SCHEMA = S.obj({
  subtitle: S.str('One line under the title.'),
  description: S.str('150 to 200 words in the store voice.'),
})

/** A rewrite of one product's description from the research, in the store voice, under an optional steer. */
export async function authorProductCopy(
  choice: ModelChoice | null,
  input: { store: { name: string; voice: string; prompt: string }; product: { title: string; subtitle: string; description: string }; research: Research; angle: string; brief: Brief },
): Promise<{ subtitle: string; description: string; source: 'model' | 'rules' }> {
  if (!choice) {
    const draft = draftProducts(input.brief, input.store.name)[0]
    return { subtitle: input.product.subtitle || draft?.subtitle || '', description: draft?.description ?? input.product.description, source: 'rules' }
  }
  const prompt = [
    `Store: ${input.store.name}. Voice: ${input.store.voice || 'plain, specific, confident'}. Built from: ${input.store.prompt}`,
    `Product: ${input.product.title}. ${input.product.subtitle}\nCurrent description: ${input.product.description || '(none yet)'}`,
    input.angle ? `Steer from the owner: ${input.angle}` : '',
    `Research: ${JSON.stringify({ positioning: input.research.positioning, triggers: input.research.triggers, objections: input.research.objections, proofPoints: input.research.proofPoints, audience: input.research.audience.map((persona) => persona.name) })}`,
    'Rewrite the description: what it is, what it does for the buyer, how it behaves over time, who it is not for. Concrete over adjectives. No invented numbers.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const parsed = await completeJson<{ subtitle: string; description: string }>(choice, {
    task: 'brand',
    system: `You write product pages for direct-to-consumer brands. Specific, honest, in the store voice. Never invent statistics, reviews or certifications.\n\n${knowledgeContext(['product', 'honesty'], `${input.store.prompt} ${input.product.title} ${input.angle || ''}`)}`,
    prompt,
    schema: COPY_SCHEMA,
    name: 'product_copy',
    maxTokens: 4000,
  })
  return { subtitle: parsed.subtitle?.trim() || input.product.subtitle, description: parsed.description?.trim() || input.product.description, source: 'model' }
}

/* ---------------------------------------------------------------- campaign */

const CAMPAIGN_SCHEMA = S.obj({
  subjects: S.arr(S.str(), 'Three subject lines, under 50 characters each, different angles.'),
  body: S.str('The email body as plain text with blank lines between paragraphs. Under 180 words.'),
})

export async function authorCampaign(
  choice: ModelChoice | null,
  input: { store: { name: string; voice: string; slogan: string }; brief: string; product: { title: string; subtitle: string; price: string } | null; research: Research | null; fallback: { subjects: string[]; body: string } },
): Promise<{ subjects: string[]; body: string; source: 'model' | 'rules' }> {
  if (!choice) return { ...input.fallback, source: 'rules' }
  const prompt = [
    `Store: ${input.store.name}. Voice: ${input.store.voice || 'plain, specific'}. Slogan: ${input.store.slogan}`,
    `Brief for this email: ${input.brief}`,
    input.product ? `Featured product: ${input.product.title} — ${input.product.subtitle}. From ${input.product.price}.` : '',
    input.research ? `Research: ${JSON.stringify({ triggers: input.research.triggers, objections: input.research.objections.slice(0, 3), proofPoints: input.research.proofPoints })}` : '',
    'Write the campaign. One idea, one call to action, no exclamation marks.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const parsed = await completeJson<{ subjects: string[]; body: string }>(choice, {
    task: 'ads',
    system: 'You write marketing email for direct-to-consumer brands. Short, specific, one call to action. Never invent statistics or reviews.',
    prompt,
    schema: CAMPAIGN_SCHEMA,
    name: 'campaign',
    maxTokens: 3000,
  })
  return { subjects: parsed.subjects?.length ? parsed.subjects.slice(0, 3) : input.fallback.subjects, body: parsed.body?.trim() || input.fallback.body, source: 'model' }
}
