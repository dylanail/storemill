import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import { getProduct } from '../domain/catalog.ts'
import { bundleFor } from '../domain/bundles.ts'
import { listReviews } from '../domain/reviews.ts'
import { format as money } from '../lib/money.ts'
import type { Product } from '../domain/types.ts'
import type { Store } from '../control/stores.ts'
import { readBrief } from './copy.ts'
import { latestResearch, rulesResearch, type Research } from './research.ts'
import { directionFor, getAvatar, listAvatars, type Avatar } from './avatars.ts'
import { classifyAngle, extractAngle, readCompetitor, type AngleKind, type Fetcher } from './angles.ts'
import type { Direction } from './directions.ts'
import { catalog, completeJson, describe, modelFor, parseChoice, S, type ModelChoice } from './models.ts'
import { knowledge } from './knowledge.ts'

const log = logger('ads')

/**
 * Ads.
 *
 * The page is where the sale happens; the ad is where the click does. Both
 * are written from the same research, the same avatar and the same
 * direction, so the promise in the ad is the promise on the page. A draft is
 * a starting point in every field — hooks, primary text, headline, a script
 * for video — and every field is editable, because the merchant knows things
 * about their offer no writer does.
 */
export type AdPlatform = 'meta' | 'tiktok' | 'google' | 'youtube'

export const PLATFORMS: Array<{ id: AdPlatform; name: string; limits: { primary: number; headline: number; description: number }; note: string }> = [
  { id: 'meta', name: 'Meta (Facebook / Instagram)', limits: { primary: 125, headline: 40, description: 30 }, note: 'Primary text is truncated after ~125 characters in feed; the first line is the hook.' },
  { id: 'tiktok', name: 'TikTok', limits: { primary: 100, headline: 100, description: 0 }, note: 'The video does the work; text is one line. Scripts matter more than copy here.' },
  { id: 'google', name: 'Google Search (responsive ad)', limits: { primary: 0, headline: 30, description: 90 }, note: 'Up to 15 headlines of 30 and 4 descriptions of 90; Google assembles them.' },
  { id: 'youtube', name: 'YouTube', limits: { primary: 90, headline: 15, description: 70 }, note: 'The script carries it. Headline is 15 characters on in-stream.' },
]

export type AdFormat = { id: string; name: string; description: string; video: boolean }

export const AD_FORMATS: AdFormat[] = [
  { id: 'static', name: 'Static / image ad', description: 'Hook, three lines of why, the offer, a button.', video: false },
  { id: 'ugc-script', name: 'UGC video script', description: 'Hook in 3 seconds, problem, reveal, demo, offer — timed beats for a creator to read.', video: true },
  { id: 'problem-solution', name: 'Problem · agitate · solve', description: 'Name the problem, make it hurt, present the fix.', video: false },
  { id: 'testimonial', name: 'Testimonial', description: 'Built from real approved reviews on file; never invented.', video: false },
  { id: 'us-vs-them', name: 'Us vs them', description: 'The comparison table as an ad.', video: false },
  { id: 'founder', name: 'Founder', description: 'Why the store exists, in the first person.', video: true },
  { id: 'hooks', name: '10 hooks', description: 'Ten first lines to test; nothing else.', video: false },
  { id: 'offer', name: 'Offer / bundle', description: 'The tiers, the shipping, the deadline.', video: false },
  { id: 'retargeting', name: 'Retargeting', description: 'For people who visited and left: the objection, answered, plus the guarantee.', video: false },
  { id: 'search', name: 'Search headlines', description: 'Fifteen headlines and four descriptions in Google\'s character limits.', video: false },
]

export function formatById(formatId: string): AdFormat {
  return AD_FORMATS.find((entry) => entry.id === formatId) ?? (AD_FORMATS[0] as AdFormat)
}

export type ScriptBeat = { beat: string; seconds: string; line: string; visual: string }

export type AdCopy = {
  hooks: string[]
  primaryText: string
  headline: string
  description: string
  cta: string
  headlines: string[]
  descriptions: string[]
  script: ScriptBeat[]
  angle: string
  avatar: string
  notes: string[]
}

export type Ad = {
  id: string
  productId: string
  platform: AdPlatform
  format: string
  name: string
  direction: string
  avatarId: string
  body: AdCopy
  status: 'draft' | 'ready' | 'archived'
  createdAt: string
  updatedAt: string
}

/* ------------------------------------------------------------------ writing */

export type AdInput = {
  product: Product
  store: Store
  research: Research
  direction: Direction
  format: AdFormat
  platform: AdPlatform
  avatar: Avatar | null
  reviews: Array<{ rating: number; body: string; author: string }>
  bundle: { tiers: Array<{ quantity: number; discountPercent: number; label: string }> } | null
  inspiration: Inspiration[]
}

const CTA: Record<Direction['tone'], string> = {
  plain: 'Shop now',
  urgent: 'Get yours before this batch goes',
  premium: 'See the collection',
  warm: 'Find theirs',
  clinical: 'See the specification',
  playful: 'Go on then',
  blunt: 'Buy it',
}

function clip(text: string, max: number): string {
  if (!max || text.length <= max) return text
  const cut = text.slice(0, max - 1)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20))}…`
}

function sentence(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ')
  return /[.!?]$/.test(clean) ? clean : `${clean}.`
}

/** The hooks: the avatar's first, then the direction's, then research triggers, then anything borrowed. */
export function hooksFor(input: AdInput, count = 10): string[] {
  const { product, research, direction, avatar, inspiration } = input
  const name = product.title
  const hooks: string[] = []
  if (direction.mustSay[0]) hooks.push(direction.mustSay[0])
  if (avatar) hooks.push(...avatar.hooks)
  for (const trigger of research.triggers) hooks.push(`${sentence(trigger)} ${name} exists because of it.`)
  for (const objection of research.objections) hooks.push(`"${objection.objection}" — fair. Here is the answer.`)
  if (direction.angle) hooks.push(`${capitalize(direction.angle)}. Nothing else on the page matters as much.`)
  for (const persona of research.audience) hooks.push(`If you are ${persona.name.toLowerCase().replace(/^the /, 'the ')}, this is for you: ${persona.wants.toLowerCase()}`)
  for (const entry of inspiration) if (entry.hook) hooks.push(`${entry.hook.replace(/[.!?]$/, '')} — but for ${name}.`)
  hooks.push(`Most ${research.category} fails at the same point. ${name} was built at that point.`)
  hooks.push(`${money(research.priceAnchor.midCents, input.store.currency)} for something that outlasts three of the cheap ones.`)
  return [...new Set(hooks.map((hook) => hook.trim()).filter(Boolean))].slice(0, count)
}

export function writeAd(input: AdInput): AdCopy {
  const { product, store, research, direction, format, platform, avatar, reviews, bundle } = input
  const limits = PLATFORMS.find((entry) => entry.id === platform)?.limits ?? { primary: 125, headline: 40, description: 30 }
  const hooks = hooksFor(input)
  const hook = hooks[0] ?? product.title
  const cta = CTA[direction.tone]
  const proof = research.proofPoints.slice(0, 3)
  const objection = avatar?.objection ? { objection: avatar.objection, answer: avatar.answer } : research.objections[0]
  const guarantee = product.content.guarantee || 'Free returns for thirty days.'
  const audience = direction.audience || 'people who care about the details'
  const angle = direction.angle || (avatar?.angle ?? research.positioning.split('—')[0]?.trim() ?? '')
  const notes: string[] = []
  const base: AdCopy = { hooks, primaryText: '', headline: clip(product.title, limits.headline || 40), description: clip(product.subtitle || proof[0] || '', limits.description || 30), cta, headlines: [], descriptions: [], script: [], angle, avatar: avatar?.name ?? '', notes }

  switch (format.id) {
    case 'hooks':
      return { ...base, primaryText: hooks.join('\n'), notes: ['Ten first lines. Run each as its own ad with the same creative and keep the two that win.'] }
    case 'ugc-script':
    case 'founder': {
      const founder = format.id === 'founder'
      const script: ScriptBeat[] = [
        { beat: 'Hook', seconds: '0–3', line: founder ? `I started ${store.name} because ${research.triggers[0]?.toLowerCase() ?? 'the cheap version kept failing'}.` : hook, visual: founder ? 'You, to camera, product in frame' : 'Product in hand, close, no intro' },
        { beat: 'Problem', seconds: '3–8', line: objection ? `${objection.objection}` : `${research.triggers[1] ?? research.triggers[0] ?? 'It keeps going wrong'}.`, visual: 'The old one failing, or the frustration' },
        { beat: 'Reveal', seconds: '8–14', line: `So: ${product.title}. ${sentence(product.subtitle || research.positioning.split('—')[0] || '')}`, visual: 'Unbox / first look, hero angle' },
        { beat: 'Demo', seconds: '14–26', line: proof.map((line) => sentence(line)).join(' '), visual: 'In use. Show the detail you are claiming.' },
        { beat: 'Proof', seconds: '26–32', line: objection ? objection.answer : guarantee, visual: reviews.length ? 'Review screenshots' : 'Detail shots' },
        { beat: 'Offer', seconds: '32–40', line: `${bundle?.tiers.find((tier) => tier.discountPercent > 0) ? `${bundle.tiers.find((tier) => tier.discountPercent > 0)?.label}. ` : ''}${guarantee} ${cta}.`, visual: 'Price on screen, button, store name' },
      ]
      return {
        ...base,
        primaryText: clip(`${hook} ${objection ? objection.answer : proof[0] ?? ''}`, limits.primary || 125),
        script,
        notes: ['Read it in one take, phone at arm\'s length, natural light. Subtitles on: most people watch muted.', platform === 'tiktok' ? 'Cut the Offer beat to five seconds on TikTok; the button carries it.' : 'The first three seconds decide the view; test three hooks with the same body.'],
      }
    }
    case 'testimonial': {
      const usable = reviews.filter((review) => review.rating >= 4 && review.body.length > 30).slice(0, 3)
      if (!usable.length) {
        return { ...base, primaryText: '', notes: ['No approved reviews with enough text on file. Import or approve reviews first; testimonial ads are only ever built from real ones.'] }
      }
      const quotes = usable.map((review) => `"${clip(review.body, 140)}" — ${review.author.split(' ')[0] ?? 'a customer'}${'.'}`)
      return { ...base, primaryText: `${quotes[0]}\n\n${quotes.slice(1).join('\n')}${quotes.length > 1 ? '\n\n' : ''}${guarantee} ${cta}.`, headline: clip(`What people say about ${product.title}`, limits.headline || 40), notes: ['Every quote is an approved review on file, first name only. Add the photo from the review if it has one.'] }
    }
    case 'us-vs-them': {
      const rows = product.content.comparison?.rows?.slice(0, 4) ?? research.comparison.rows.slice(0, 4)
      return {
        ...base,
        primaryText: `${hook}\n\n${rows.map((row) => `${row.label}: ${row.us} — not ${row.them.toLowerCase()}`).join('\n')}\n\n${cta}.`,
        headline: clip(`${product.title} vs the usual`, limits.headline || 40),
        notes: ['Creative: a two-column table, your column in the brand colour. Same rows as the page so the click lands on the proof.'],
      }
    }
    case 'offer': {
      const tiers = bundle?.tiers.filter((tier) => tier.discountPercent > 0) ?? []
      const lines = tiers.length ? tiers.map((tier) => `${tier.label}`) : [`${money(research.priceAnchor.midCents, store.currency)}, shipping included over the threshold`]
      return {
        ...base,
        primaryText: `${lines.join(' · ')}\n${direction.urgency ? 'This batch, this week. ' : ''}${guarantee}\n${cta}.`,
        headline: clip(tiers[0]?.label ?? `${product.title} — the deal`, limits.headline || 40),
        notes: [tiers.length ? 'Tiers come from the bundle on the product; change them there and re-draft.' : 'No bundle on this product yet; the ad uses the price anchor. Set up tiers on the Bundles page for a real offer.'],
      }
    }
    case 'retargeting':
      return {
        ...base,
        primaryText: `Still thinking about ${product.title}?\n${objection ? `${objection.objection} ${objection.answer}` : proof[0] ?? ''}\n${guarantee} ${cta}.`,
        headline: clip('Your cart is where you left it', limits.headline || 40),
        notes: ['Audience: viewed product or added to cart, last 7 days, minus purchasers. Cap at 3 impressions a day.'],
      }
    case 'search': {
      const headlines = [
        product.title,
        `${capitalize(research.category)} that lasts`,
        ...research.keywords.map((keyword) => capitalize(keyword)),
        ...proof,
        guarantee.split('.')[0] ?? '',
        `Ships in ${product.supplier.processingDays ?? 3} days`,
        `${money(Math.min(...product.variants.map((variant) => variant.priceCents)), store.currency)} · free returns`,
        `For ${audience}`,
        cta,
      ].map((line) => clip(line, 30)).filter((line) => line.length >= 5)
      const descriptions = [research.positioning, `${sentence(proof.join(', '))}`, objection ? `${objection.answer}` : '', `${guarantee} ${cta}.`].map((line) => clip(line, 90)).filter(Boolean)
      return { ...base, headlines: [...new Set(headlines)].slice(0, 15), descriptions: [...new Set(descriptions)].slice(0, 4), primaryText: '', notes: ['Pin the product name to position 1. Google mixes the rest.'] }
    }
    case 'problem-solution':
      return {
        ...base,
        primaryText: `${sentence(research.triggers[0] ?? hook)} ${objection ? `${objection.objection} ` : ''}It gets worse every time you replace it with the same thing.\n\n${product.title}: ${sentence(product.subtitle || proof[0] || '')} ${objection?.answer ?? ''}\n\n${guarantee} ${cta}.`,
        headline: clip(`Stop replacing your ${research.category}`, limits.headline || 40),
        notes: ['Creative: before/after, or the failed old one next to yours.'],
      }
    default:
      return {
        ...base,
        primaryText: `${hook}\n\n${proof.map((line) => `✓ ${line}`).join('\n')}\n\n${guarantee} ${cta}.`,
        notes: [platform === 'meta' ? 'Feed truncates after the first ~125 characters; the hook has to land before "See more".' : ''],
      }
  }
}

/* -------------------------------------------------------------------- model */

const AD_SCHEMA = S.obj({
  hooks: S.arr(S.str(), 'Ten first lines, best first. For the "hooks" format these are the whole ad.'),
  primaryText: S.str('The body copy. Empty for search ads.'),
  headline: S.str('Within the platform limit.'),
  description: S.str('Within the platform limit; empty where the platform has none.'),
  cta: S.str('The button text.'),
  headlines: S.arr(S.str(), 'Search ads only: up to fifteen headlines of at most 30 characters. Empty otherwise.'),
  descriptions: S.arr(S.str(), 'Search ads only: up to four descriptions of at most 90 characters. Empty otherwise.'),
  script: S.arr(S.obj({ beat: S.str('Hook, Problem, Reveal, Demo, Proof, Offer'), seconds: S.str('"0–3"'), line: S.str('What is said.'), visual: S.str('What is on screen.') }), 'Video formats only: six timed beats. Empty otherwise.'),
  angle: S.str('The angle this ad runs, in a few words.'),
  notes: S.arr(S.str(), 'One to three notes for the media buyer: creative, audience, what to test.'),
})

/**
 * The model writes the ad. It gets the platform limits, the format's shape
 * (the rules draft shows which fields the format fills), the research, the
 * avatar, the direction, the real reviews and the swipe file, and writes the
 * copy fresh. Testimonials only ever quote the approved reviews it is given.
 */
export function unverifiedQuotes(text: string, reviews: Array<{ body: string; author: string }>): string[] {
  const bag = (value: string) => new Set(value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean))
  const pool = reviews.map((review) => bag(`${review.body} ${review.author}`))
  const out: string[] = []
  for (const match of text.matchAll(/["\u201c\u201d]([^"\u201c\u201d]{12,240})["\u201c\u201d]/g)) {
    const quote = (match[1] ?? '').trim()
    const words = [...bag(quote)].filter((word) => word.length > 3)
    if (words.length < 3) continue
    const best = pool.length ? Math.max(...pool.map((set) => words.filter((word) => set.has(word)).length / words.length)) : 0
    if (best < 0.7) out.push(quote)
  }
  return out
}

function withoutInventedQuotes(written: AdCopy, draft: AdCopy, reviews: Array<{ body: string; author: string }>): AdCopy {
  const dropped: string[] = []
  const checkText = (value: string, fallback: string) => {
    const bad = unverifiedQuotes(value, reviews)
    if (!bad.length) return value
    dropped.push(...bad)
    return fallback
  }
  const checkList = (values: string[], fallback: string[]) => {
    const kept = values.filter((value) => {
      const bad = unverifiedQuotes(value, reviews)
      dropped.push(...bad)
      return !bad.length
    })
    return kept.length ? kept : fallback
  }
  const result: AdCopy = {
    ...written,
    hooks: checkList(written.hooks, draft.hooks),
    primaryText: checkText(written.primaryText, draft.primaryText),
    headline: checkText(written.headline, draft.headline),
    description: checkText(written.description, draft.description),
    headlines: checkList(written.headlines, draft.headlines),
    descriptions: checkList(written.descriptions, draft.descriptions),
    script: written.script.some((beat) => unverifiedQuotes(`${beat.line} ${beat.visual}`, reviews).length) ? draft.script : written.script,
  }
  return dropped.length ? {
    ...result,
    notes: [`An unverified quote was removed from this ad: "${clip(dropped[0] as string, 90)}".`, ...result.notes].slice(0, 4),
  } : result
}

async function authorAd(choice: ModelChoice | null, draft: AdCopy, input: AdInput): Promise<AdCopy> {
  if (!choice) return draft
  if (input.format.id === 'testimonial' && !draft.primaryText) return draft
  const limits = PLATFORMS.find((entry) => entry.id === input.platform)
  try {
    const prompt = [
      `Platform: ${limits?.name ?? input.platform}. Limits: primary text ${limits?.limits.primary || 'none'} characters before truncation, headline ${limits?.limits.headline || 'none'}, description ${limits?.limits.description || 'none'}. ${limits?.note ?? ''}`,
      `Format: ${input.format.name} — ${input.format.description}${input.format.video ? ' This is a video format: fill the script with six timed beats.' : ''}${input.format.id === 'search' ? ' Fill headlines and descriptions; leave primaryText empty.' : ''}`,
      `Direction from the owner, verbatim: ${input.direction.raw || '(none)'}\nRead as: tone ${input.direction.tone}; audience ${input.direction.audience || '(unspecified)'}; angle ${input.direction.angle || '(unspecified)'}; must say: ${input.direction.mustSay.join(' / ') || '(nothing)'}`,
      input.avatar ? `Written to this avatar: ${JSON.stringify({ name: input.avatar.name, who: input.avatar.who, wants: input.avatar.wants, fears: input.avatar.fears, angle: input.avatar.angle, hooks: input.avatar.hooks, objection: input.avatar.objection, answer: input.avatar.answer })}` : 'No avatar; write to the main research persona.',
      `Product: ${input.product.title}. ${input.product.subtitle}\n${input.product.description.slice(0, 900)}\nPrice from ${money(Math.min(...input.product.variants.map((variant) => variant.priceCents)), input.store.currency)}. Guarantee on the page: ${input.product.content.guarantee || '(none written)'}`,
      input.bundle?.tiers.some((tier) => tier.discountPercent > 0) ? `Bundle tiers on the product: ${input.bundle.tiers.map((tier) => `${tier.label} (${tier.discountPercent}% off)`).join(', ')}` : 'No bundle on this product.',
      `Research: ${JSON.stringify({ positioning: input.research.positioning, triggers: input.research.triggers, objections: input.research.objections, proofPoints: input.research.proofPoints, competitors: input.research.competitors, keywords: input.research.keywords })}`,
      input.reviews.length ? `Approved reviews on file (the only source for any quote; use first names only):\n${JSON.stringify(input.reviews.slice(0, 6))}` : 'No approved reviews on file: do not quote anyone.',
      input.inspiration.length ? `Swipe file, patterns to learn from and not copy: ${JSON.stringify(input.inspiration.slice(0, 6).map((entry) => ({ hook: entry.hook, angle: entry.angle })))}` : '',
      `The rules draft below shows which fields this format fills and the shape of each. Write your own copy in those fields; leave the others as they are.\n${JSON.stringify({ hooks: draft.hooks, primaryText: draft.primaryText, headline: draft.headline, description: draft.description, cta: draft.cta, headlines: draft.headlines, descriptions: draft.descriptions, script: draft.script })}`,
    ]
      .filter(Boolean)
      .join('\n\n')
    const parsed = await completeJson<Omit<AdCopy, 'avatar'>>(choice, {
      task: 'ads',
      system: `You write direct-response ads for a dropshipping brand that buys paid social and search traffic. Hooks stop the scroll; the body earns the click; the offer closes. Respect the platform character limits exactly. Never invent reviews, statistics, names or certifications; quote only the reviews you are given, first name only. Every ad has one angle, stated directly in the hook; name it in the angle field.\n\n${knowledge('creatives', 'avatars', 'sophistication', 'honesty')}`,
      prompt,
      schema: AD_SCHEMA,
      name: 'ad_copy',
    })
    const platformLimits = PLATFORMS.find((entry) => entry.id === input.platform)?.limits ?? { primary: 125, headline: 40, description: 30 }
    const clean = (list: string[] | undefined, max: number, chars = 0) =>
      (list ?? []).map((line) => (chars ? clip(line.trim(), chars) : line.trim())).filter(Boolean).slice(0, max)
    const written: AdCopy = {
      hooks: clean(parsed.hooks, 10).length ? clean(parsed.hooks, 10) : draft.hooks,
      primaryText: input.format.id === 'search' ? '' : clip(parsed.primaryText?.trim() || draft.primaryText, platformLimits.primary),
      headline: clip(parsed.headline?.trim() || draft.headline, platformLimits.headline),
      description: clip(parsed.description?.trim() ?? draft.description, platformLimits.description),
      cta: parsed.cta?.trim() || draft.cta,
      headlines: input.format.id === 'search' ? (clean(parsed.headlines, 15, 30).length ? clean(parsed.headlines, 15, 30) : draft.headlines) : [],
      descriptions: input.format.id === 'search' ? (clean(parsed.descriptions, 4, 90).length ? clean(parsed.descriptions, 4, 90) : draft.descriptions) : [],
      script: input.format.video ? (parsed.script?.length ? parsed.script.slice(0, 8) : draft.script) : [],
      angle: parsed.angle?.trim() || draft.angle,
      avatar: draft.avatar,
      notes: [...clean(parsed.notes, 3), ...draft.notes.filter((note) => /approved reviews|Tiers come from|No bundle/.test(note))].filter(Boolean),
    }
    return withoutInventedQuotes(written, draft, input.reviews)
  } catch (error) {
    log.warn(`${describe(choice)} could not write the ${input.format.name} ad; keeping the rules draft: ${error instanceof Error ? error.message : String(error)}`)
    return draft
  }
}

/* ------------------------------------------------------------------ drafting */

export type DraftRequest = {
  productId: string
  platform?: AdPlatform
  formats?: string[]
  direction?: string
  avatarId?: string
  count?: number
  /** Optional one-run override; the store's Ads model remains the default. */
  model?: string
}

export function suggestAdFormats(platform: AdPlatform, direction: Direction): string[] {
  if (platform === 'google') return ['search']
  const order = platform === 'tiktok' || platform === 'youtube' ? ['ugc-script', 'hooks', 'founder', 'problem-solution', 'testimonial'] : ['static', 'ugc-script', 'hooks', 'problem-solution', 'testimonial', 'us-vs-them', 'offer', 'retargeting']
  if (direction.priceLed) order.unshift('offer')
  if (direction.tone === 'warm') order.unshift('founder')
  if (direction.tone === 'clinical') order.unshift('us-vs-them')
  return [...new Set(order)]
}

function adInput(db: Db, store: Store, product: Product, request: { direction?: string; avatarId?: string; platform: AdPlatform; format: AdFormat }): AdInput {
  const research = latestResearch(db, store.id) ?? rulesResearch(readBrief(`${store.prompt} ${product.title}`))
  const avatar = request.avatarId ? getAvatar(db, store.id, request.avatarId) : listAvatars(db, store.id).find((entry) => entry.selected) ?? null
  const direction = directionFor(request.direction ?? '', avatar)
  const reviews = listReviews(db, store.id, { productId: product.id, status: 'approved', minRating: 4, limit: 10 })
  const bundle = bundleFor(db, store.id, product.id)
  return { product, store, research, direction, format: request.format, platform: request.platform, avatar, reviews, bundle, inspiration: listInspiration(db, store.id).slice(0, 8) }
}

export async function draftAds(db: Db, store: Store, request: DraftRequest): Promise<Ad[]> {
  const product = getProduct(db, store.id, request.productId)
  if (!product) throw new Error('No product with that id')
  const platform = request.platform ?? 'meta'
  const probe = adInput(db, store, product, { ...request, platform, format: formatById('static') })
  const wanted = request.formats?.length ? request.formats : suggestAdFormats(platform, probe.direction).slice(0, request.count ?? 3)
  const requested = parseChoice(request.model)
  const model = requested && catalog().some((entry) => entry.available && entry.provider === requested.provider && entry.model === requested.model) ? requested : modelFor(db, store.id, 'ads')
  const created: Ad[] = []
  for (const formatId of wanted) {
    const format = formatById(formatId)
    const input = { ...probe, format }
    const body = await authorAd(model, writeAd(input), input)
    created.push(
      saveAd(db, store.id, {
        productId: product.id,
        platform,
        format: format.id,
        name: `${product.title} — ${format.name}${input.avatar ? ` · ${input.avatar.name}` : ''}${input.direction.raw ? ` (${clip(input.direction.raw, 48)})` : ''}`,
        direction: input.direction.raw,
        avatarId: input.avatar?.id ?? '',
        body,
        status: 'draft',
      }),
    )
  }
  return created
}

/** Re-drafts one ad under a new direction; the platform, format and avatar stay. */
export async function reviseAd(db: Db, store: Store, adId: string, direction: string): Promise<Ad> {
  const ad = getAd(db, store.id, adId)
  if (!ad) throw new Error('No such ad')
  const product = getProduct(db, store.id, ad.productId)
  if (!product) throw new Error('The product behind this ad is gone')
  const input = adInput(db, store, product, { direction, avatarId: ad.avatarId, platform: ad.platform, format: formatById(ad.format) })
  const body = await authorAd(modelFor(db, store.id, 'ads'), writeAd(input), input)
  return saveAd(db, store.id, { id: ad.id, direction, body })
}

/* ------------------------------------------------------------------ storage */

type AdRow = { id: string; product_id: string; platform: string; format: string; name: string; direction: string; avatar_id: string; body: string; status: string; created_at: string; updated_at: string }

const EMPTY: AdCopy = { hooks: [], primaryText: '', headline: '', description: '', cta: '', headlines: [], descriptions: [], script: [], angle: '', avatar: '', notes: [] }

function rowToAd(row: AdRow): Ad {
  return {
    id: row.id,
    productId: row.product_id,
    platform: row.platform as AdPlatform,
    format: row.format,
    name: row.name,
    direction: row.direction,
    avatarId: row.avatar_id,
    body: { ...EMPTY, ...json<Partial<AdCopy>>(row.body, {}) },
    status: row.status as Ad['status'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function saveAd(db: Db, storeId: string, input: Partial<Omit<Ad, 'createdAt' | 'updatedAt' | 'body'>> & { body?: Partial<AdCopy> }): Ad {
  const current = input.id ? getAd(db, storeId, input.id) : null
  const body = { ...(current?.body ?? EMPTY), ...(input.body ?? {}) }
  if (current) {
    db.update('ads', current.id, {
      product_id: input.productId ?? current.productId,
      platform: input.platform ?? current.platform,
      format: input.format ?? current.format,
      name: input.name ?? current.name,
      direction: input.direction ?? current.direction,
      avatar_id: input.avatarId ?? current.avatarId,
      body,
      status: input.status ?? current.status,
      updated_at: now(),
    })
    return getAd(db, storeId, current.id) as Ad
  }
  const adId = id('ad')
  db.insert('ads', {
    id: adId,
    store_id: storeId,
    product_id: input.productId ?? '',
    platform: input.platform ?? 'meta',
    format: input.format ?? 'static',
    name: input.name ?? 'Untitled ad',
    direction: input.direction ?? '',
    avatar_id: input.avatarId ?? '',
    body,
    status: input.status ?? 'draft',
    created_at: now(),
    updated_at: now(),
  })
  return getAd(db, storeId, adId) as Ad
}

export function listAds(db: Db, storeId: string, opts: { productId?: string; status?: string } = {}): Ad[] {
  const where = ['store_id = ?']
  const params: unknown[] = [storeId]
  if (opts.productId) {
    where.push('product_id = ?')
    params.push(opts.productId)
  }
  if (opts.status) {
    where.push('status = ?')
    params.push(opts.status)
  } else where.push("status != 'archived'")
  return db.all<AdRow>(`SELECT * FROM ads WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, ...params).map(rowToAd)
}

export function getAd(db: Db, storeId: string, adId: string): Ad | null {
  const row = db.one<AdRow>('SELECT * FROM ads WHERE store_id = ? AND id = ?', storeId, adId)
  return row ? rowToAd(row) : null
}

export function deleteAd(db: Db, storeId: string, adId: string) {
  db.run('DELETE FROM ads WHERE store_id = ? AND id = ?', storeId, adId)
}

/** Where a draft breaks a platform limit. Shown, never enforced: the merchant decides. */
export function limitWarnings(ad: Ad): string[] {
  const limits = PLATFORMS.find((entry) => entry.id === ad.platform)?.limits
  if (!limits) return []
  const warnings: string[] = []
  const firstLine = ad.body.primaryText.split('\n')[0] ?? ''
  if (limits.primary && firstLine.length > limits.primary) warnings.push(`The first line of the primary text is ${firstLine.length} characters; feed shows about ${limits.primary} before "See more".`)
  if (limits.headline && ad.body.headline.length > limits.headline) warnings.push(`Headline is ${ad.body.headline.length} characters; the limit is ${limits.headline}.`)
  if (limits.description && ad.body.description.length > limits.description) warnings.push(`Description is ${ad.body.description.length} characters; the limit is ${limits.description}.`)
  for (const [index, line] of ad.body.headlines.entries()) if (line.length > 30) warnings.push(`Search headline ${index + 1} is over 30 characters.`)
  for (const [index, line] of ad.body.descriptions.entries()) if (line.length > 90) warnings.push(`Search description ${index + 1} is over 90 characters.`)
  return warnings
}

/* -------------------------------------------------------------- inspiration */

/**
 * The swipe file. Three ways in:
 *
 *   ad-library  Meta's Ad Library API, when a token is configured. Its
 *               programmatic scope is political ads worldwide and *all* ads
 *               delivered to the EU or UK, so the default country is GB —
 *               which is where a dropshipper's competitors' commercial ads
 *               are actually retrievable.
 *   url         A competitor's landing page or a public ad link, read for its
 *               hook and angle with the same extraction the angle tool uses.
 *   paste       Ad text copied from anywhere: the first line is the hook.
 *
 * Plus the built-in patterns: hook formulas that have worked for a decade,
 * filled with this store's product, so the file is never empty.
 */
export type Inspiration = {
  id: string
  source: 'ad-library' | 'url' | 'paste' | 'pattern'
  brand: string
  url: string
  hook: string
  primaryText: string
  headline: string
  angle: AngleKind
  format: string
  notes: string
  startedAt: string
  createdAt: string
}

type InspirationRow = { id: string; source: string; brand: string; url: string; body: string; created_at: string }

function rowToInspiration(row: InspirationRow): Inspiration {
  const body = json<Partial<Inspiration>>(row.body, {})
  return { id: row.id, source: row.source as Inspiration['source'], brand: row.brand, url: row.url, hook: body.hook ?? '', primaryText: body.primaryText ?? '', headline: body.headline ?? '', angle: body.angle ?? 'benefit', format: body.format ?? '', notes: body.notes ?? '', startedAt: body.startedAt ?? '', createdAt: row.created_at }
}

export function saveInspiration(db: Db, storeId: string, input: Partial<Inspiration> & { hook: string }): Inspiration {
  const current = input.id ? getInspiration(db, storeId, input.id) : null
  const merged = { ...(current ?? {}), ...input }
  const body = { hook: merged.hook, primaryText: merged.primaryText ?? '', headline: merged.headline ?? '', angle: merged.angle ?? classifyAngle(`${merged.hook} ${merged.primaryText ?? ''}`), format: merged.format ?? '', notes: merged.notes ?? '', startedAt: merged.startedAt ?? '' }
  if (current) {
    db.update('ad_inspiration', current.id, { source: merged.source ?? current.source, brand: merged.brand ?? '', url: merged.url ?? '', body })
    return getInspiration(db, storeId, current.id) as Inspiration
  }
  const recordId = id('insp')
  db.insert('ad_inspiration', { id: recordId, store_id: storeId, source: merged.source ?? 'paste', brand: merged.brand ?? '', url: merged.url ?? '', body, created_at: now() })
  return getInspiration(db, storeId, recordId) as Inspiration
}

export function listInspiration(db: Db, storeId: string): Inspiration[] {
  return db.all<InspirationRow>('SELECT * FROM ad_inspiration WHERE store_id = ? ORDER BY created_at DESC', storeId).map(rowToInspiration)
}

export function getInspiration(db: Db, storeId: string, recordId: string): Inspiration | null {
  const row = db.one<InspirationRow>('SELECT * FROM ad_inspiration WHERE store_id = ? AND id = ?', storeId, recordId)
  return row ? rowToInspiration(row) : null
}

export function deleteInspiration(db: Db, storeId: string, recordId: string) {
  db.run('DELETE FROM ad_inspiration WHERE store_id = ? AND id = ?', storeId, recordId)
}

const PATTERNS: Array<{ name: string; hook: (product: string, category: string) => string; angle: AngleKind }> = [
  { name: 'The confession', hook: (product) => `I was wrong about ${product}.`, angle: 'story' },
  { name: 'The number', hook: (_product, category) => `3 things nobody tells you before buying ${category}.`, angle: 'problem-solution' },
  { name: 'The callout', hook: (_product, category) => `If you have bought ${category} twice this year, read this.`, angle: 'problem-solution' },
  { name: 'The contrast', hook: (product) => `Cheap ones last a season. ${product} is on year three.`, angle: 'comparison' },
  { name: 'The objection first', hook: (product) => `"${product} is expensive." Here is the maths.`, angle: 'comparison' },
  { name: 'The guarantee', hook: (product) => `Use ${product} for 30 days. Hate it, send it back, keep the shipping.`, angle: 'risk-reversal' },
  { name: 'The POV', hook: (product) => `POV: ${product.replace(/^the\s+/i, 'the ')} finally arrived.`, angle: 'social-proof' },
  { name: 'The mistake', hook: (_product, category) => `The mistake everyone makes with ${category} (and the fix).`, angle: 'problem-solution' },
  { name: 'The specific', hook: (product) => `${product}: one thing done properly.`, angle: 'premium' },
  { name: 'The deadline', hook: (product) => `This batch of ${product} ships Friday. The next one is a month out.`, angle: 'urgency' },
]

export function patternInspiration(product: string, category: string): Inspiration[] {
  return PATTERNS.map((pattern, index) => ({
    id: `pattern_${index}`,
    source: 'pattern',
    brand: pattern.name,
    url: '',
    hook: pattern.hook(product, category),
    primaryText: '',
    headline: '',
    angle: pattern.angle,
    format: '',
    notes: 'A proven hook shape, filled with your product. Edit it or use it as is.',
    startedAt: '',
    createdAt: '',
  }))
}

export type AdLibraryTransport = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>
let libraryTransport: AdLibraryTransport = (url) => fetch(url)
export function useAdLibraryTransport(next: AdLibraryTransport | null) {
  libraryTransport = next ?? ((url) => fetch(url))
}

export async function searchAdLibrary(query: string, opts: { country?: string; limit?: number } = {}): Promise<{ results: Inspiration[]; note: string }> {
  const token = process.env.META_AD_LIBRARY_TOKEN
  if (!token) return { results: [], note: 'Set META_AD_LIBRARY_TOKEN (a Meta developer app with the Ad Library API, identity-verified) to search the Ad Library from here. Until then, paste ads or their links.' }
  const country = opts.country ?? process.env.AMBORAS_AD_LIBRARY_COUNTRY ?? 'GB'
  const params = new URLSearchParams({
    search_terms: query,
    ad_type: 'ALL',
    ad_active_status: 'ACTIVE',
    ad_reached_countries: JSON.stringify([country]),
    fields: 'page_name,ad_creative_bodies,ad_creative_link_titles,ad_creative_link_descriptions,ad_snapshot_url,ad_delivery_start_time',
    limit: String(opts.limit ?? 12),
    access_token: token,
  })
  try {
    const response = await libraryTransport(`https://graph.facebook.com/v21.0/ads_archive?${params.toString()}`)
    if (!response.ok) return { results: [], note: `The Ad Library API answered ${response.status}. Commercial ads are only returned for EU/UK reach; the token may also have expired.` }
    const payload = (await response.json()) as { data?: Array<{ page_name?: string; ad_creative_bodies?: string[]; ad_creative_link_titles?: string[]; ad_creative_link_descriptions?: string[]; ad_snapshot_url?: string; ad_delivery_start_time?: string }> }
    const results = (payload.data ?? []).map((entry, index) => {
      const body = entry.ad_creative_bodies?.[0] ?? ''
      const hook = body.split('\n').find(Boolean) ?? entry.ad_creative_link_titles?.[0] ?? ''
      return {
        id: `library_${index}`,
        source: 'ad-library' as const,
        brand: entry.page_name ?? '',
        url: entry.ad_snapshot_url ?? '',
        hook,
        primaryText: body,
        headline: entry.ad_creative_link_titles?.[0] ?? '',
        angle: classifyAngle(`${hook} ${body}`),
        format: '',
        notes: entry.ad_creative_link_descriptions?.[0] ?? '',
        startedAt: entry.ad_delivery_start_time ?? '',
        createdAt: '',
      }
    })
    return { results, note: results.length ? `${results.length} active ads reaching ${country}. Running since a date well in the past is the signal: nobody keeps paying for an ad that does not work.` : `No active ads for "${query}" reaching ${country}. Try the product's generic name.` }
  } catch (error) {
    return { results: [], note: `Could not reach the Ad Library (${error instanceof Error ? error.message : String(error)}).` }
  }
}

/** A URL or pasted ad text, read into one inspiration record. Not saved until the merchant keeps it. */
export async function readInspiration(input: { url?: string; text?: string; brand?: string }, fetcher?: Fetcher, model: ModelChoice | null = null): Promise<Inspiration> {
  if (input.text?.trim()) {
    const lines = input.text.trim().split('\n').map((line) => line.trim()).filter(Boolean)
    const hook = lines[0] ?? ''
    return { id: '', source: 'paste', brand: input.brand ?? '', url: input.url ?? '', hook, primaryText: lines.join('\n'), headline: '', angle: classifyAngle(input.text), format: '', notes: '', startedAt: '', createdAt: '' }
  }
  if (!input.url) throw new Error('Give a URL or paste the ad')
  const angle = await readCompetitor({ url: input.url }, fetcher, model)
  return { id: '', source: 'url', brand: input.brand || angle.brand, url: input.url, hook: angle.hooks[0] ?? angle.headline, primaryText: [angle.headline, angle.subheadline, ...angle.benefits.slice(0, 3)].filter(Boolean).join('\n'), headline: angle.headline, angle: angle.angle, format: '', notes: angle.notes.join(' '), startedAt: '', createdAt: '' }
}

export { extractAngle }

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}
