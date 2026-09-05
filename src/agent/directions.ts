import type { Product, ProductContent } from '../domain/types.ts'
import type { Research } from './research.ts'
import type { MarketAnalysis } from './market.ts'
import type { Brief } from './copy.ts'
import { newBlock, salesTemplate, scienceTemplate } from '../pages/store.ts'
import { blockDefinition, type BlockInstance } from '../pages/blocks.ts'
import { logger } from '../lib/log.ts'
import { completeJson, describe, S, type ModelChoice } from './models.ts'
import { knowledge } from './knowledge.ts'

const log = logger('directions')

/**
 * Formats and direction.
 *
 * A format is a proven shape — the listicle, the "I tried it for thirty days"
 * story, problem-agitate-solve — and a direction is what the merchant typed:
 * "make it urgent", "premium, no hype", "for gift buyers". Both are read into
 * a small set of decisions (tone words, which sections lead, what the
 * headline pattern is). The format decides the layout; the model writes the
 * words in it; the rules writers below fill the layout when there is no model.
 */
export type Tone = 'plain' | 'urgent' | 'premium' | 'warm' | 'clinical' | 'playful' | 'blunt'

export type Direction = {
  raw: string
  tone: Tone
  audience: string
  angle: string
  /** Words the merchant used that should appear in the copy. */
  mustSay: string[]
  urgency: boolean
  priceLed: boolean
  /** The avatar this direction was filled from, when one was picked. */
  avatar?: string
}

export type Format = {
  id: string
  kind: 'advertorial' | 'pdp'
  name: string
  description: string
  headline: (input: { product: string; store: string; reasons: number; audience: string }) => string
}

export const ADVERTORIAL_FORMATS: Format[] = [
  { id: 'listicle', kind: 'advertorial', name: 'Listicle', description: '"N reasons people are switching" — the workhorse.', headline: ({ product, reasons }) => `${reasons} reasons people are switching to ${product}` },
  { id: 'story', kind: 'advertorial', name: 'First-person story', description: '"I tried it for 30 days" — one person, one arc, one verdict.', headline: ({ product }) => `I used ${product} every day for a month. Here is what happened.` },
  { id: 'pas', kind: 'advertorial', name: 'Problem · agitate · solve', description: 'Name the problem, make it hurt, present the fix.', headline: ({ product }) => `If your gear keeps failing you, this is why — and what ${product} does differently` },
  { id: 'expert', kind: 'advertorial', name: 'Expert take', description: 'A coach, a maker, a clinician explains the decision.', headline: ({ product, audience }) => `Why a coach who has seen a thousand pairs recommends ${product} to ${audience}` },
  { id: 'roundup', kind: 'advertorial', name: 'We tested five', description: 'A comparison roundup where the product wins on the criteria that matter.', headline: ({ product }) => `We tested five of the best-selling options. ${product} was the one we kept.` },
  { id: 'mistakes', kind: 'advertorial', name: 'Mistakes to avoid', description: '"N mistakes people make" — teaches, then sells the fix.', headline: ({ reasons }) => `${reasons} mistakes almost everyone makes when buying this — and how to avoid them` },
]

export const PDP_FORMATS: Format[] = [
  { id: 'benefit', kind: 'pdp', name: 'Benefit-led', description: 'What it does for you, first.', headline: ({ product }) => product },
  { id: 'story', kind: 'pdp', name: 'Story-led', description: 'Why it exists, who made it, then the buy box.', headline: ({ product, store }) => `${product}, the piece ${store} started with` },
  { id: 'ugc', kind: 'pdp', name: 'UGC-led', description: 'Reviews and photos above the fold; the product speaks second.', headline: ({ product }) => `What people say about ${product}` },
  { id: 'comparison', kind: 'pdp', name: 'Comparison-led', description: 'Against the cheap version, row by row, before the price.', headline: ({ product }) => `${product}, compared to what you were going to buy` },
  { id: 'premium', kind: 'pdp', name: 'Premium minimal', description: 'Big image, few words, one button.', headline: ({ product }) => product },
  { id: 'offer', kind: 'pdp', name: 'Offer-led', description: 'The bundle tiers are the page.', headline: ({ product }) => `${product}: buy two, save more` },
  { id: 'urgency', kind: 'pdp', name: 'Urgency-led', description: 'Countdown, stock, recent buyers — for cold paid traffic.', headline: ({ product }) => `${product} — this batch is nearly gone` },
  { id: 'science', kind: 'pdp', name: 'Science-led', description: 'The mechanism with its numbers, how it works in steps, the study cards, the expert, where it is made, then the buy box (the Honex shape).', headline: ({ product }) => `${product}: how it works, and the research behind it` },
  { id: 'sales', kind: 'pdp', name: 'Sales page', description: 'The long Funnelish page: the buy box on top with the bullets, chips and guarantee; the problem, the reframe, the mechanism, the timeline, the offer stack and the cost stack below; the sticky button (the PiPi Tea and Celinva shape).', headline: ({ product }) => `${product}: the one that works the first time you use it` },
]

export function formatById(id: string, kind: 'advertorial' | 'pdp'): Format {
  const list = kind === 'advertorial' ? ADVERTORIAL_FORMATS : PDP_FORMATS
  return list.find((format) => format.id === id) ?? (list[0] as Format)
}

const TONE_WORDS: Array<[Tone, string[]]> = [
  ['urgent', ['urgent', 'urgency', 'scarcity', 'fomo', 'hurry', 'limited', 'countdown', 'now', 'fast']],
  ['premium', ['premium', 'luxury', 'high-end', 'elevated', 'no hype', 'understated', 'quiet', 'minimal', 'classy']],
  ['clinical', ['clinical', 'scientific', 'data', 'evidence', 'facts', 'technical', 'spec', 'precise']],
  ['warm', ['warm', 'friendly', 'gift', 'family', 'cozy', 'kind', 'gentle', 'story']],
  ['playful', ['playful', 'fun', 'cheeky', 'bold', 'loud', 'punchy', 'witty']],
  ['blunt', ['blunt', 'direct', 'no fluff', 'straight', 'honest', 'plain']],
]

export function readDirection(raw: string): Direction {
  const text = (raw ?? '').toLowerCase()
  const tone = TONE_WORDS.find(([, words]) => words.some((word) => text.includes(word)))?.[0] ?? 'plain'
  const audience = /\b(?:for|aimed at|targeting)\s+([a-z][a-z\s-]{2,48}?)(?:[.,;]|$|\s+(?:focus|lead|emphasi|say|angle|about)\b)/.exec(text)?.[1]?.trim() ?? ''
  const angle = /\b(?:angle|focus on|lead with|emphasi[sz]e|about)\s+([a-z][a-z\s-]{2,60}?)(?:[.,;]|$)/.exec(text)?.[1]?.trim() ?? ''
  const mustSay = [...raw.matchAll(/"([^"]{2,60})"/g)].map((match) => match[1] as string)
  return {
    raw: raw ?? '',
    tone,
    audience,
    angle,
    mustSay,
    urgency: tone === 'urgent' || /\b(sale|deadline|ends|limited)\b/.test(text),
    priceLed: /\b(price|cheap|deal|discount|save|bundle|offer)\b/.test(text),
  }
}

/* --------------------------------------------------------------- writers */

const TONE_VERBS: Record<Tone, { cta: string; opener: string; closer: string }> = {
  plain: { cta: 'Get yours', opener: 'Here is what it is and what it is not.', closer: 'Built to order. Free returns for thirty days.' },
  urgent: { cta: 'Claim yours before this batch goes', opener: 'This run is small and it does not get restocked on a schedule.', closer: 'When the counter hits zero the price goes back up. That is not a trick; it is how small batches work.' },
  premium: { cta: 'Order', opener: 'There is not much to say. The materials say it.', closer: 'Made to order. Delivered in fourteen days. Repaired for life.' },
  warm: { cta: 'Choose yours', opener: 'Whoever you are buying this for, you already know what they will say when they open it.', closer: 'It arrives boxed, with a card from the workshop if you want one.' },
  clinical: { cta: 'Order', opener: 'The specification is on this page. Every claim on it can be checked.', closer: 'Tolerances, materials and lead times are stated because they are measured.' },
  playful: { cta: 'Yes, obviously', opener: 'You have read enough product pages. This one is short.', closer: 'Thirty days to change your mind. You will not.' },
  blunt: { cta: 'Buy it', opener: 'No story. Here is the product and here is the price.', closer: 'If it fails, we fix it. If you hate it, send it back.' },
}

export type WriterInput = {
  product: Product
  store: { name: string; prompt: string }
  research: Research
  brief: Brief
  direction: Direction
  format: Format
  /**
   * The Market tab's analysis, when the store has run one.
   *
   * The prompt below already tells the writer to "name the mechanism from the
   * research and use the name everywhere" — and the mechanism, the awareness
   * level, the sophistication stage and the underserved avatar live in the
   * market analysis, which no writer was given. The course's whole method for
   * deciding what a page must say was written, displayed on its own tab, and
   * read by nothing that writes a word.
   */
  market?: MarketAnalysis | null
}

/** The part of the analysis a writer needs, as a line in its prompt. */
export function marketBrief(market: MarketAnalysis | null | undefined): string {
  if (!market) return ''
  const mechanism = market.mechanisms.find((entry) => entry.isNew) ?? market.mechanisms[0]
  return `Market: awareness ${market.awareness} (${market.awarenessWhy}); sophistication stage ${market.sophistication} (${market.sophisticationWhy}). Lead desire: ${market.leadDesire}. ${
    mechanism ? `Mechanism${mechanism.isNew ? ' (new)' : ''}: ${mechanism.name} — ${mechanism.how}.` : 'No mechanism named yet.'
  } ${market.newInformation.length ? `New information to lead with: ${market.newInformation.map((entry) => entry.claim).join('; ')}.` : ''} ${
    market.underserved.length ? `Underserved: ${market.underserved.map((entry) => `${entry.avatar} — ${entry.angle}`).join('; ')}.` : ''
  } Stand out via ${market.standOut.via}: ${market.standOut.recommendation}. ${
    market.languageSnippets.length ? `Words the market uses: ${market.languageSnippets.slice(0, 8).join(' / ')}.` : ''
  } At stage 3 or above the page needs a reset — a new mechanism, new information or a new identity — not a bigger claim.`
}

export function reasonsFor(input: WriterInput, count: number): Array<{ headline: string; text: string }> {
  const { research, direction, format, product } = input
  const base = research.triggers.slice(0, count)
  const objections = research.objections
  const name = product.title
  return base.map((trigger, index) => {
    const objection = objections[index % Math.max(1, objections.length)]
    switch (format.id) {
      case 'mistakes':
        return { headline: `Mistake ${index + 1}: ${trigger.toLowerCase().replace(/^the /, 'buying because the ')}`, text: objection ? `${objection.objection} ${objection.answer}` : trigger }
      case 'story':
        return { headline: `Week ${index + 1}: ${trigger}`, text: `${objection?.answer ?? ''} By the end of the week I had stopped noticing the ${name.toLowerCase()} at all, which is the point.` }
      case 'pas':
        return { headline: index === 0 ? `The problem: ${trigger.toLowerCase()}` : index === count - 1 ? `What ${name} does instead` : `Why the usual fix fails`, text: objection ? `${objection.answer}` : trigger }
      case 'expert':
        return { headline: trigger, text: `Every coach has seen this. ${objection?.answer ?? ''}` }
      case 'roundup':
        return { headline: `Criterion ${index + 1}: ${trigger.toLowerCase()}`, text: `Three of the five failed here. ${objection?.answer ?? ''}` }
      default:
        return { headline: trigger, text: objection ? objection.answer : `${direction.tone === 'blunt' ? '' : 'Plainly: '}${trigger.toLowerCase()} is the moment ${name} was built for.` }
    }
  })
}

/** An advertorial in the chosen format and tone. */
export function writeAdvertorial(input: WriterInput): BlockInstance[] {
  const { product, store, research, direction, format } = input
  const reasons = reasonsFor(input, format.id === 'story' ? 4 : 5)
  const tone = TONE_VERBS[direction.tone]
  const audience = direction.audience || research.audience[0]?.name.toLowerCase().replace(/^the /, '') || 'people who train'
  const headline = direction.mustSay[0] ?? format.headline({ product: product.title, store: store.name, reasons: reasons.length, audience })
  const blocks: BlockInstance[] = [
    newBlock('publication-bar', { name: `${store.name} Journal`, section: format.id === 'expert' ? 'Opinion' : format.id === 'roundup' ? 'Tested' : 'Reviews' }),
    newBlock('headline', { level: 'h1', eyebrow: format.id === 'story' ? 'First person' : format.id === 'roundup' ? 'We tested them' : 'Editor’s pick', text: headline, sub: direction.angle ? `On ${direction.angle}.` : product.subtitle, width: 'narrow', padding: 'small' }),
    newBlock('byline', { author: format.id === 'expert' ? 'By a coach who has seen a thousand pairs' : format.id === 'story' ? 'By someone who bought it with their own money' : 'By the editorial team', readTime: `${3 + reasons.length} min read` }),
  ]
  if (product.heroImage) blocks.push(newBlock('image', { src: product.heroImage, alt: product.title, width: 'narrow', padding: 'none' }))
  blocks.push(newBlock('rich-text', { text: `${tone.opener}\n\n${direction.mustSay.slice(1).join(' ')}`.trim() }))
  if (direction.urgency) blocks.push(newBlock('progress-bar', { label: '73% of this batch claimed', percent: 73 }))
  reasons.forEach((reason, index) => blocks.push(newBlock('numbered-reason', { number: index + 1, headline: reason.headline, text: reason.text })))
  if (format.id === 'roundup') blocks.push(newBlock('comparison', { themLabel: research.competitors[0]?.name ?? 'The others', rows: research.comparison.rows.map((row) => `${row.label}|${row.us}|${row.them}`).join('\n') }))
  blocks.push(newBlock('pull-quote', { quote: format.id === 'story' ? 'I stopped thinking about it. That is the whole point.' : `${research.proofPoints[0] ?? 'Named materials, one maker.'}`, who: format.id === 'story' ? '' : 'From the workshop' }))
  blocks.push(newBlock('review-wall', { headline: 'From people who bought it', count: 6, productId: product.id }))
  if (direction.urgency) blocks.push(newBlock('countdown', { text: 'Offer ends in', minutes: 15 }))
  blocks.push(newBlock(direction.priceLed ? 'bundle-offer' : 'buy-box', { productId: product.id, buyNow: true, background: 'raise', headline: direction.priceLed ? 'Buy more, pay less' : undefined }))
  blocks.push(newBlock('faq', { headline: 'Before you decide', items: research.objections.map((entry) => `${entry.objection}|${entry.answer}`).join('\n') }))
  blocks.push(newBlock('guarantee', {}))
  blocks.push(newBlock('rich-text', { text: tone.closer, width: 'narrow' }))
  blocks.push(newBlock('comments', {}))
  blocks.push(newBlock('sticky-cta', { label: `${tone.cta} — ${product.title}`, href: '#offer' }))
  blocks.push(newBlock('disclaimer', {}))
  blocks.push(newBlock('footer', {}))
  return blocks
}

/** A product page version in the chosen format: the buy box plus the sections that format leads with. */
export function writePdp(input: WriterInput): BlockInstance[] {
  const { product, research, direction, format } = input
  const tone = TONE_VERBS[direction.tone]
  const headline = direction.mustSay[0] ?? format.headline({ product: product.title, store: input.store.name, reasons: 3, audience: direction.audience || 'you' })
  const content = product.content
  const benefits = newBlock('multicolumn', { headline: 'Why this one', columns: (content.benefits ?? []).slice(0, 4).map((benefit) => `✦|${benefit.title}|${benefit.body.split('. ')[0]}.`).join('\n') })
  const comparison = newBlock('comparison', { themLabel: content.comparison?.themLabel ?? 'The usual', rows: (content.comparison?.rows ?? research.comparison.rows).map((row) => `${row.label}|${row.us}|${row.them}`).join('\n') })
  const reviews = newBlock('review-wall', { headline: 'What people say', count: 6, productId: product.id })
  const faq = newBlock('faq', { headline: 'Questions', items: (content.faq ?? []).map((entry) => `${entry.q}|${entry.a}`).join('\n') })
  const buy = newBlock(direction.priceLed || format.id === 'offer' ? 'bundle-offer' : 'buy-box', { productId: product.id, buyNow: true, ...(format.id === 'premium' ? { showImage: true } : {}) })
  const hero = newBlock('hero', { eyebrow: direction.audience ? `For ${direction.audience}` : '', headline, sub: product.subtitle, image: product.heroImage, cta: tone.cta, ctaHref: '#offer', height: format.id === 'premium' ? 'large' : 'medium', overlay: format.id === 'premium' ? 25 : 45 })
  const trust = newBlock('trust-badges', {})
  const guarantee = newBlock('guarantee', {})
  const urgency = [newBlock('countdown', { text: 'This price ends in', minutes: 20 }), newBlock('progress-bar', { label: 'Only a few of this batch left', percent: 82 })]
  const order: Record<string, BlockInstance[]> = {
    benefit: [newBlock('header', {}), hero, benefits, buy, reviews, comparison, faq, guarantee, trust],
    story: [newBlock('header', {}), newBlock('headline', { level: 'h1', eyebrow: 'Why it exists', text: headline, sub: research.positioning, width: 'narrow' }), newBlock('image-with-text', { image: product.heroImage, headline: 'Built where the load goes', text: product.description.split('. ').slice(0, 3).join('. ') + '.', cta: tone.cta, ctaHref: '#offer' }), buy, reviews, faq, guarantee],
    ugc: [newBlock('header', {}), newBlock('headline', { level: 'h1', text: headline, align: 'center' }), reviews, newBlock('carousel', { images: [product.heroImage, ...product.media.map((entry) => entry.url)].filter(Boolean).join('\n') }), buy, benefits, faq, guarantee],
    comparison: [newBlock('header', {}), newBlock('headline', { level: 'h1', text: headline, sub: 'Row by row.', width: 'narrow' }), comparison, benefits, buy, reviews, faq, guarantee],
    premium: [newBlock('header', {}), hero, newBlock('rich-text', { text: tone.opener, align: 'center', width: 'narrow' }), buy, newBlock('image', { src: product.media[1]?.url ?? product.heroImage, width: 'wide' }), guarantee],
    offer: [newBlock('header', {}), newBlock('headline', { level: 'h1', text: headline, sub: 'The more you take, the less each one costs.', align: 'center' }), buy, benefits, reviews, faq, guarantee, trust],
    urgency: [newBlock('announcement-bar', { text: 'THIS PRICE ENDS TONIGHT · FREE SHIPPING ON 2+' }), newBlock('header', {}), hero, ...urgency, buy, reviews, benefits, faq, guarantee, newBlock('sticky-cta', { label: tone.cta, href: '#offer' })],
  }
  // The two formats the reference pages taught (docs/knowledge/reference-pages.md).
  const bullets = (content.benefits ?? []).slice(0, 5).map((benefit) => `${benefit.title}|${benefit.body.split('. ')[0]}`).join('\n')
  if (format.id === 'sales') {
    const blocks = salesTemplate({ storeName: input.store.name, product: { id: product.id, title: product.title, image: product.heroImage, subtitle: product.subtitle }, research: { triggers: research.triggers, objections: research.objections, comparison: { rows: content.comparison?.rows ?? research.comparison.rows }, competitors: research.competitors } })
    for (const block of blocks) {
      if (block.type === 'headline' && block.settings.level === 'h1') block.settings = { ...block.settings, text: headline, ...(direction.audience ? { eyebrow: `For ${direction.audience}` } : {}) }
      if (block.type === 'buy-box' && bullets) block.settings = { ...block.settings, bullets, cta: tone.cta }
      if (block.type === 'sticky-cta') block.settings = { ...block.settings, label: tone.cta }
    }
    if (!direction.urgency) return blocks.filter((block) => block.type !== 'announcement-bar')
    return blocks
  }
  if (format.id === 'science') {
    const blocks = scienceTemplate({ storeName: input.store.name, product: { id: product.id, title: product.title, image: product.heroImage, subtitle: product.subtitle }, research: { triggers: research.triggers, objections: research.objections, comparison: { rows: content.comparison?.rows ?? research.comparison.rows }, competitors: research.competitors } })
    for (const block of blocks) {
      if (block.type === 'hero') block.settings = { ...block.settings, headline, sub: product.subtitle, cta: tone.cta }
      if (block.type === 'multicolumn' && bullets) block.settings = { ...block.settings, columns: bullets.split('\n').map((line) => `✓|${line}`).join('\n') }
      if (block.type === 'sticky-cta') block.settings = { ...block.settings, label: tone.cta, productId: product.id }
    }
    // Every ingredient or material, all of them, after the studies; a fact nobody supplied stays marked.
    const at = blocks.findIndex((block) => block.type === 'timeline')
    blocks.splice(at < 0 ? blocks.length - 1 : at, 0, newBlock('ingredients', { headline: 'What is in it', lead: 'Every material or ingredient, and what it does. All of them.', items: '[confirm] Material|What it does|' }))
    if (direction.urgency) blocks.splice(2, 0, ...urgency)
    return blocks
  }
  const blocks = order[format.id] ?? order.benefit!
  if (direction.urgency && format.id !== 'urgency') blocks.splice(2, 0, ...urgency)
  blocks.push(newBlock('footer', {}))
  return blocks
}

/** Rewrites the product's own page content (benefits, FAQ order, guarantee copy) in a tone. */
export function redirectContent(content: ProductContent, direction: Direction): ProductContent {
  const tone = TONE_VERBS[direction.tone]
  return {
    ...content,
    benefits: content.benefits?.map((benefit, index) => (index === 0 && direction.angle ? { ...benefit, title: `${benefit.title} — ${direction.angle}` } : benefit)),
    guarantee: direction.tone === 'blunt' ? 'Thirty days. Send it back, get your money.' : content.guarantee,
    shipping: direction.urgency ? `${content.shipping ?? ''} Order in the next few hours to make this week's batch.`.trim() : content.shipping,
    trust: direction.mustSay.length ? [...direction.mustSay.slice(0, 2), ...(content.trust ?? [])].slice(0, 3) : content.trust,
    audience: direction.audience ? `Made for ${direction.audience}` : content.audience,
    faq: content.faq ? [...content.faq, ...(direction.urgency ? [{ q: 'Why the countdown?', a: tone.closer }] : [])] : content.faq,
  }
}

/* ---------------------------------------------------------------- model */

/** Block types whose settings carry the words a reader sees. */
const TEXT_BLOCKS = new Set(['headline', 'rich-text', 'numbered-reason', 'pull-quote', 'hero', 'image-with-text', 'multicolumn', 'faq', 'offer-box', 'comparison', 'announcement-bar', 'guarantee', 'byline', 'publication-bar', 'sticky-cta', 'progress-bar', 'countdown', 'review-wall', 'bundle-offer', 'buy-box', 'stats', 'timeline', 'how-it-works', 'value-stack', 'expert-quote', 'letter', 'cost-comparison', 'studies', 'specs', 'rating-strip', 'checkout-steps', 'trust-badges', 'testimonials', 'benefit-bullets', 'image-grid', 'alternatives', 'included', 'audience', 'press-quotes', 'ingredients', 'disclaimer'])
/** Setting keys that are addresses, ids or media, never prose. */
const NOT_TEXT = /^(src|href|image|images|videos|poster|productId|ctaHref|url|id|video|link|collectionId|background|align|width|padding|level|height|overlay|minutes|percent|count|number|showImage|buyNow|minimum|perRow|current|layout|showExpress|showBump|histogram|mode|endsAt)$/

const BLOCKS_SCHEMA = S.obj({
  blocks: S.arr(
    S.obj({
      id: S.str('The block id, unchanged.'),
      values: S.arr(S.obj({ key: S.str('The setting key, unchanged.'), value: S.str('The new text.') }), 'Only the text settings you rewrote.'),
    }),
  ),
  additions: S.arr(
    S.obj({
      after: S.str('The id of the block this new section goes after; "" puts it first.'),
      type: S.str('A catalog block type; "custom-html" for a section no block does; "custom-code" for css and js this page needs.'),
      values: S.arr(S.obj({ key: S.str('A setting key of that block; "html" for custom-html; "css" and "js" for custom-code.'), value: S.str('Its text.') }), 'The settings, as text.'),
      why: S.str('One line: what this section does that the layout was missing.'),
    }),
    'Sections the layout was missing, if any. Usually empty.',
  ),
})

type Authored = { blocks: Array<{ id: string; values: Array<{ key: string; value: string }> }>; additions?: Array<{ after: string; type: string; values: Array<{ key: string; value: string }>; why?: string }> }

/**
 * Applies what the model wrote: the rewritten text per block, then the
 * sections it added. An added section must be a catalog block (its
 * settings are validated when rendered) or a custom-html section with its
 * HTML; anything else is dropped. Layout stays the format's except for
 * those insertions.
 */
export function applyAuthoring(blocks: BlockInstance[], parsed: Authored): BlockInstance[] {
  const byId = new Map((parsed.blocks ?? []).map((entry) => [entry.id, entry.values]))
  const rewritten = blocks.map((block) => {
    const values = byId.get(block.id)
    if (!values) return block
    const settings = { ...block.settings }
    for (const { key, value } of values) {
      if (typeof settings[key] === 'string' && !NOT_TEXT.test(key) && typeof value === 'string' && value.trim()) settings[key] = value
    }
    return { ...block, settings }
  })
  for (const addition of parsed.additions ?? []) {
    if (!addition || typeof addition.type !== 'string') continue
    const definition = blockDefinition(addition.type)
    if (!definition) continue
    const settings: Record<string, unknown> = {}
    for (const { key, value } of addition.values ?? []) if (typeof key === 'string' && typeof value === 'string' && !NOT_TEXT.test(key) && key in definition.schema) settings[key] = value
    if (addition.type === 'custom-html' && !String(settings.html ?? '').trim()) continue
    if (addition.type === 'custom-html' && /<script\b/i.test(String(settings.html ?? ''))) continue
    if (addition.type === 'custom-code' && !String(settings.css ?? '').trim() && !String(settings.js ?? '').trim()) continue
    if (addition.type === 'custom-code' && /<script\b[^>]*\bsrc=/i.test(String(settings.js ?? ''))) continue
    const block = newBlock(addition.type, settings)
    const at = addition.after ? rewritten.findIndex((entry) => entry.id === addition.after) : -1
    rewritten.splice(at + 1, 0, block)
  }
  return rewritten
}

/**
 * With a model, it writes the words inside the blocks the format laid out —
 * never the layout. It gets the format, the direction verbatim, the avatar,
 * the research and the product, and returns replacement text per block.
 * Line formats ("label|value" per line) are the block's own contract and are
 * preserved. Anything it does not return keeps the rules text.
 */
export async function authorBlocks(choice: ModelChoice | null, blocks: BlockInstance[], input: WriterInput, extra = ''): Promise<{ blocks: BlockInstance[]; source: 'model' | 'rules' }> {
  if (!choice) return { blocks, source: 'rules' }
  const textual = blocks
    .filter((block) => TEXT_BLOCKS.has(block.type))
    .map((block) => ({ id: block.id, type: block.type, settings: Object.fromEntries(Object.entries(block.settings).filter(([key, value]) => typeof value === 'string' && !NOT_TEXT.test(key))) }))
    .filter((block) => Object.keys(block.settings).length)
  if (!textual.length) return { blocks, source: 'rules' }
  try {
    const { direction, format, product, research, store } = input
    const prompt = [
      `Store: ${store.name}. Product: ${product.title}. ${product.subtitle}\n${product.description.slice(0, 1200)}`,
      `Format: ${format.name} (${format.kind}) — ${format.description}`,
      `Direction from the owner, verbatim: ${direction.raw || '(none)'}\nRead as: tone ${direction.tone}; audience ${direction.audience || '(unspecified)'}; angle ${direction.angle || '(unspecified)'}; must say: ${direction.mustSay.join(' / ') || '(nothing)'}${direction.avatar ? `; written to the avatar "${direction.avatar}"` : ''}`,
      `Research: ${JSON.stringify({ positioning: research.positioning, audience: research.audience, triggers: research.triggers, objections: research.objections, proofPoints: research.proofPoints, competitors: research.competitors, comparison: research.comparison.rows })}`,
      marketBrief(input.market),
      `Blocks, in page order, with their current placeholder text:\n${JSON.stringify(textual)}`,
      extra,
      'Rewrite every text value in the format and direction. Write fresh copy; do not lightly edit the placeholders. Keep the keys. Where a value is a list of "a|b" or "a|b|c" lines, keep that line format and roughly the same number of lines: faq items are "question|answer", comparison rows "label|us|them", multicolumn columns "icon|title|text", check bullets and included items "lead|text", image cards "image URL|caption" (keep the URL part, even when empty), how-it-works steps "title|text|image URL", timeline steps "when|title|text", alternatives "name|why it fails", cost-comparison rows "what|cost", value-stack items "item|value", stats "number|caption", expert quotes "quote|name|title|image URL", studies "journal, year|finding|URL", personas "who|line", trust chips "icon|text". The hero and headline blocks carry the page\'s promise; numbered reasons carry one argument each; the closing rich-text is the send-off. Name the mechanism from the research and use the name everywhere; give every section one number that is actually in the research; reframe the root cause so the buyer is absolved. Never invent reviews, statistics, studies, experts or names: leave a "[confirm]" marker where a fact is missing rather than filling it. If the layout is missing a section the page needs (a comparison the research supports, a how-to, a "what\'s included"), add it in additions: a catalog block with its settings as text, or "custom-html" with the section\'s HTML using the theme classes (head, lead, cols, col, checks, btn, micro); if the page needs styling or behaviour no block gives (a reveal on scroll, a tab switcher), add one "custom-code" with css and js. Usually additions is empty.',
    ].filter(Boolean).join('\n\n')
    const parsed = await completeJson<Authored>(choice, {
      task: 'pages',
      system: `You write direct-response ecommerce pages and advertorials for a dropshipping brand. You write inside a layout that is already decided, replacing placeholder text with copy that is specific, honest and in the requested tone, and you may add a section when the layout is missing one the page needs. Write at a sixth-grade reading level, show rather than tell, and give the reader a reason to buy in the avatar's own terms.\n\n${knowledge('pages', 'offers', 'sophistication', 'honesty')}`,
      prompt,
      schema: BLOCKS_SCHEMA,
      name: 'page_blocks',
    })
    return { blocks: applyAuthoring(blocks, parsed), source: 'model' }
  } catch (error) {
    log.warn(`${describe(choice)} could not write the ${input.format.name} version; keeping the rules text: ${error instanceof Error ? error.message : String(error)}`)
    return { blocks, source: 'rules' }
  }
}
