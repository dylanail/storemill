import type { Product, ProductContent } from '../domain/types.ts'
import { logger } from '../lib/log.ts'
import { readBrief, type Brief } from './copy.ts'
import type { Research } from './research.ts'
import { completeJson, describe, S, type ModelChoice } from './models.ts'
import { knowledge, knowledgeContext } from './knowledge.ts'

const log = logger('pages')

/**
 * The product page writer.
 *
 * A Shopify-grade page has a shape: benefits answer the purchase triggers, the
 * comparison table answers "why not the cheaper one", the FAQ answers the
 * objections, the guarantee removes the last reason to wait. `authorProductContent`
 * has the model write that page from the research and the product; this
 * function is the rules mapping that stands in without a model, and either
 * way a page can only carry claims the research put there.
 */
export function writeProductContent(
  research: Research,
  brief: Brief,
  product: { title: string; role?: 'hero' | 'complement'; priceCents: number; options?: Array<{ title: string; values: Array<{ value: string }> }> },
): ProductContent {
  const material = brief.material
  const isHero = product.role !== 'complement'

  const benefits = research.triggers.slice(0, 4).map((trigger, index) => ({
    title: benefitTitle(trigger, material, index),
    body: benefitBody(trigger, material, brief, product.title),
  }))

  // Spec rows are read as facts about the product. "Made in <a city picked by
  // hashing the prompt>", a fourteen-day build time and in-house repairs for
  // life were the demo store's, asserted on every product of every store —
  // and on the same page as a different city in the shipping line. What is
  // left is what the platform actually knows: the options the merchant set.
  const specs: ProductContent['specs'] = [
    ...(brief.prompt.toLowerCase().includes(material.toLowerCase()) ? [{ label: 'Material', value: capitalize(material) }] : []),
    ...(brief.place ? [{ label: 'Made in', value: brief.place }] : []),
    ...(product.options ?? []).map((option) => ({ label: option.title, value: option.values.map((value) => value.value).join(' · ') })),
  ]

  const faq = [
    ...research.objections.slice(0, 4).map(({ objection }) => ({ q: objection, a: 'Ask the merchant to confirm the relevant product details and policy before ordering.' })),
    { q: 'When will it ship?', a: 'Delivery times and available shipping options need merchant confirmation.' },
    { q: 'What if it is not right?', a: 'Check the merchant-confirmed return and refund policy before ordering.' },
  ]

  return {
    benefits,
    comparison: { rows: [], themLabel: 'Alternatives' },
    specs,
    faq,
    guarantee: 'Returns and refund terms need merchant confirmation before purchase.',
    shipping: 'Delivery times and shipping options need merchant confirmation.',
    audience: research.audience[0] ? `Made for ${research.audience[0].name.toLowerCase().replace(/^the /, '')}: ${research.audience[0].wants.toLowerCase()}` : '',
    trust: [],
  }
}

function benefitTitle(_trigger: string, _material: string, index: number): string {
  return ['For your daily routine', 'Compare the details', 'Choose your fit', 'Before you order'][index] ?? 'Product details'
}
function benefitBody(_trigger: string, _material: string, _brief: Brief, title: string): string {
  return `Review the confirmed details and available options for ${title.replace(/^The /, '')} to decide whether it fits your needs. Ask the merchant to confirm any missing specification before ordering.`
}

/** Fills the page for a product that was created without research. */
export function contentFor(research: Research, prompt: string, product: Product): ProductContent {
  return writeProductContent(research, readBrief(`${prompt} ${product.title}`), {
    title: product.title,
    priceCents: Math.min(...product.variants.map((variant) => variant.priceCents)),
    options: product.options,
  })
}

/* ---------------------------------------------------------------- model */

const CONTENT_SCHEMA = S.obj({
  benefits: S.arr(S.obj({ title: S.str('Six words or fewer.'), body: S.str('Two or three sentences.') }), 'Four benefits, each answering one purchase trigger from the research.'),
  comparison: S.obj({
    themLabel: S.str('Who the right column is: the named competitor or "The usual".'),
    rows: S.arr(S.obj({ label: S.str(), us: S.str(), them: S.str() }), 'Four to six rows.'),
  }),
  specs: S.arr(S.obj({ label: S.str(), value: S.str() }), 'Five to eight specification rows, including one per product option.'),
  faq: S.arr(S.obj({ q: S.str('The objection as a question in the buyer\'s words.'), a: S.str('The honest answer.') }), 'Five or six questions: the research objections first, then shipping and returns.'),
  guarantee: S.str('One or two sentences. Only promise what a dropshipper can keep: returns window, refund, replacement.'),
  shipping: S.str('One line: where it ships from in general terms, how long, tracking.'),
  audience: S.str('"Made for …": one line naming the main persona and what they want.'),
  trust: S.arr(S.str(), 'Three short lines for the strip under the buy button, e.g. "Free 30-day returns".'),
})

type ProductInput = { title: string; subtitle?: string; description?: string; role?: 'hero' | 'complement'; priceCents: number; options?: Array<{ title: string; values: Array<{ value: string }> }>; supplier?: { processingDays?: number; shippingDaysMin?: number; shippingDaysMax?: number } }

/**
 * The model writes the page from the research and the product. A page can
 * only say what the research and the product say: no invented numbers, no
 * certifications, no place of manufacture the owner did not give.
 */
export async function authorProductContent(
  choice: ModelChoice | null,
  research: Research,
  brief: Brief,
  product: ProductInput,
  store: { name: string; voice?: string; currency?: string } = { name: 'the store' },
): Promise<{ content: ProductContent; source: 'model' | 'rules'; warning?: string }> {
  const rules = writeProductContent(research, brief, product)
  if (!choice) return { content: rules, source: 'rules' }
  try {
    const prompt = [
      `Store: ${store.name}. Voice: ${store.voice || 'plain, specific, confident'}. Built from: ${brief.prompt}`,
      `Product: ${product.title}${product.subtitle ? ` — ${product.subtitle}` : ''}. Price ${((product.priceCents || 0) / 100).toFixed(2)} ${store.currency ?? 'USD'}. Role: ${product.role ?? 'hero'}.`,
      product.description ? `Description: ${product.description.slice(0, 1500)}` : '',
      product.options?.length ? `Options: ${product.options.map((option) => `${option.title}: ${option.values.map((value) => value.value).join(', ')}`).join('; ')}` : 'No options.',
      product.supplier?.shippingDaysMax ? `Shipping: ${product.supplier.processingDays ?? 1}-day handling, ${product.supplier.shippingDaysMin ?? '?'}–${product.supplier.shippingDaysMax} days in transit.` : 'Shipping times, tracking and delivery commitments are not confirmed; state that the merchant must confirm them.',
      `Research:\n${JSON.stringify({ positioning: research.positioning, audience: research.audience, triggers: research.triggers, objections: research.objections, competitors: research.competitors, proofPoints: research.proofPoints, comparison: research.comparison.rows })}`,
      'Write the page sections. Benefits answer the triggers in order; the FAQ answers the objections in the buyer\'s words; the comparison is against the first competitor. Claim nothing the research and the product do not support.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const parsed = await completeJson<Required<ProductContent>>(choice, {
      task: 'pages',
      system: `You write high-converting product pages for a direct-to-consumer dropshipping store. Every section is grounded in the customer research and the product facts you are given. Never invent statistics, reviews, certifications, materials, a place of manufacture, return policies, warranties, delivery promises, tracking availability or unverified performance. Unknown facts require merchant confirmation. Benefits say what the product does for the buyer, at a sixth-grade reading level; the comparison shows the mechanism.\n\n${knowledgeContext(['pages', 'product', 'offers', 'honesty'], `${brief.prompt} ${product.title}`)}`,
      prompt,
      schema: CONTENT_SCHEMA,
      name: 'product_page',
      maxTokens: 16000,
      effort: 'medium',
    })
    const content: ProductContent = {
      benefits: parsed.benefits?.length ? parsed.benefits : rules.benefits,
      comparison: parsed.comparison?.rows?.length ? parsed.comparison : rules.comparison,
      specs: parsed.specs?.length ? parsed.specs : rules.specs,
      faq: parsed.faq?.length ? parsed.faq : rules.faq,
      guarantee: parsed.guarantee || rules.guarantee,
      shipping: parsed.shipping || rules.shipping,
      audience: parsed.audience || rules.audience,
      trust: parsed.trust?.length ? parsed.trust.slice(0, 3) : rules.trust,
    }
    return { content, source: 'model' }
  } catch (error) {
    log.warn(`${describe(choice)} could not write the page for ${product.title}; using the rules page: ${error instanceof Error ? error.message : String(error)}`)
    return { content: rules, source: 'rules', warning: error instanceof Error ? error.message : 'Model generation failed; showing rules scaffolding.' }
  }
}

/** `contentFor`, authored: the async form the tools use. */
export async function authorContentFor(choice: ModelChoice | null, research: Research, store: { name: string; prompt: string; voice?: string; currency?: string }, product: Product): Promise<{ content: ProductContent; source: 'model' | 'rules'; warning?: string }> {
  return authorProductContent(
    choice,
    research,
    readBrief(`${store.prompt} ${product.title}`),
    {
      title: product.title,
      subtitle: product.subtitle,
      description: product.description,
      priceCents: Math.min(...product.variants.map((variant) => variant.priceCents)),
      options: product.options,
      supplier: product.supplier,
    },
    store,
  )
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}
