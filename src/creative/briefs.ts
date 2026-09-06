import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import type { Product } from '../domain/types.ts'
import type { Research } from '../agent/research.ts'
import type { Avatar } from '../agent/avatars.ts'
import { knowledge } from '../agent/knowledge.ts'
import { completeJson, describe, S, type ModelChoice } from '../agent/models.ts'
import { BLOCKS } from '../pages/blocks.ts'

const log = logger('creative')

/**
 * Creative work that needs a person before it is used.
 *
 * Three kinds of thing go through the queue: photo briefs (shots the product
 * does not have yet, described so a phone can take them), synthetic UGC
 * concepts (an idea for a real customer or a real shoot to fulfil — never a
 * fake customer on the page), and GIFs made from the product's renders. Each
 * waits as pending until the owner approves or rejects it, and nothing
 * pending reaches a page, a review or an ad.
 */
export type QueueKind = 'photo-brief' | 'ugc-concept' | 'gif'
export type QueueStatus = 'pending' | 'approved' | 'rejected'

export type QueueItem<T = Record<string, unknown>> = { id: string; storeId: string; productId: string; kind: QueueKind; title: string; body: T; status: QueueStatus; note: string; createdAt: string; updatedAt: string }

type QueueRow = { id: string; store_id: string; product_id: string; kind: string; title: string; body: string; status: string; note: string; created_at: string; updated_at: string }

function rowToItem<T>(row: QueueRow): QueueItem<T> {
  return { id: row.id, storeId: row.store_id, productId: row.product_id, kind: row.kind as QueueKind, title: row.title, body: json<T>(row.body, {} as T), status: row.status as QueueStatus, note: row.note, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function enqueue<T>(db: Db, storeId: string, input: { productId?: string; kind: QueueKind; title: string; body: T }): QueueItem<T> {
  const itemId = id('cq')
  const timestamp = now()
  db.insert('creative_queue', { id: itemId, store_id: storeId, product_id: input.productId ?? '', kind: input.kind, title: input.title, body: input.body, status: 'pending', note: '', created_at: timestamp, updated_at: timestamp })
  return getQueueItem<T>(db, storeId, itemId) as QueueItem<T>
}

export function getQueueItem<T>(db: Db, storeId: string, itemId: string): QueueItem<T> | null {
  const row = db.one<QueueRow>('SELECT * FROM creative_queue WHERE store_id = ? AND id = ?', storeId, itemId)
  return row ? rowToItem<T>(row) : null
}

export function listQueue<T = Record<string, unknown>>(db: Db, storeId: string, opts: { kind?: QueueKind; status?: QueueStatus; productId?: string } = {}): Array<QueueItem<T>> {
  const where = ['store_id = ?']
  const params: unknown[] = [storeId]
  if (opts.kind) { where.push('kind = ?'); params.push(opts.kind) }
  if (opts.status) { where.push('status = ?'); params.push(opts.status) }
  if (opts.productId) { where.push('product_id = ?'); params.push(opts.productId) }
  return db.all<QueueRow>(`SELECT * FROM creative_queue WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, ...params).map((row) => rowToItem<T>(row))
}

export function setQueueStatus(db: Db, storeId: string, itemId: string, status: QueueStatus, note = ''): QueueItem | null {
  db.run('UPDATE creative_queue SET status = ?, note = ?, updated_at = ? WHERE store_id = ? AND id = ?', status, note, now(), storeId, itemId)
  return getQueueItem(db, storeId, itemId)
}

export function deleteQueueItem(db: Db, storeId: string, itemId: string) {
  db.run('DELETE FROM creative_queue WHERE store_id = ? AND id = ?', storeId, itemId)
}

/* ------------------------------------------------------------ photo briefs */

export type PhotoBrief = { id: string; name: string; what: string; why: string; how: string; /** Only some products have this shot to take; missing it is not a gap. */ optional?: boolean }

/**
 * The shots every product page and ad set draws on: the eight the course
 * asks for, plus the ones every reference page turned out to use
 * (docs/knowledge/reference-pages.md): the pack shot per tier, the "before"
 * micro-scenes, the mechanism diagram, the goes-everywhere tiles, the
 * infographic slides for the mobile gallery, and, where there is one, the
 * expert's portrait, the origin photo and the texture macro.
 */
export const PHOTO_BRIEFS: PhotoBrief[] = [
  { id: 'hero', name: 'Hero on a plain ground', what: 'The product alone, front three-quarter, on a plain surface with one soft light.', why: 'The buy box, the ad thumbnail and the share image all use it.', how: 'Window light from one side, a white or neutral card behind, phone at product height, nothing else in frame.' },
  { id: 'tiers', name: 'The pack shot per tier', what: 'One unit, two units, three units (or 1 / 3 / 5 bottles), each on the same ground, so every quantity tier has its own picture.', why: 'Every reference buy box shows the tier as a picture, not a number: "Buy 2 Get 1 Free" is three bottles side by side. The tier a buyer picks is the one they can see.', how: 'Same distance, light and ground as the hero; stack or line the units up; one frame per tier; leave room for the badge.' },
  { id: 'hand', name: 'In hand, for scale', what: 'Someone holding or wearing it, hands only.', why: 'Answers "how big is it" without a ruler and reads as real.', how: 'Same light as the hero; crop at the wrist; skin tone true.' },
  { id: 'use', name: 'In use, in the real place', what: 'The product doing its job where it is used: the kitchen, the gym, the nursery, the desk.', why: 'The lifestyle block and the first ad frame; the buyer sees their own life.', how: 'Wider shot, natural mess allowed, product clearly the subject.' },
  { id: 'before', name: 'The "before": four moments of the problem', what: 'Four short scenes of the problem without the product: the ache at the desk at 3 p.m., the drive, bracing to stand, shifting on the couch. No product in frame.', why: 'The sales pages open the argument with four image cards and a caption each ("By mid-afternoon at your desk, sitting turns to a deep ache.") before any product is shown; the buyer recognises the moment.', how: 'One person, four places, phone at eye level, the discomfort readable in posture, nothing staged beyond that; square crops; each frame will get a one-line caption.' },
  { id: 'detail', name: 'Detail of the mechanism', what: 'A close-up of the part that makes it work: the seam, the clip, the texture, the ingredient list.', why: 'The mechanism must be shown, not asserted; this is the proof shot.', how: 'Macro or portrait mode, fill the frame with the detail, sharp focus.' },
  { id: 'mechanism', name: 'The mechanism as a diagram', what: 'A cutaway, a side profile or an annotated render that shows how it works: the jaw moved forward, the tailbone lifted off the seat, the three layers of the filter.', why: 'Every reference page names its mechanism and draws it; the diagram is what the "how it works" section and the ad hold are built on.', how: 'Brief for a render, not a photo: the product from the angle that shows the action, two or three labels, one accent colour; the 360 set is the input.' },
  { id: 'box', name: 'What arrives, laid out', what: 'The box or bag open with everything laid out flat: the product, the accessories, the manual, the gifts.', why: 'The "what\'s included" stack and the bundle tiers are built from it; it cuts "is that all?" tickets.', how: 'Top-down on a plain surface, every item visible and evenly spaced, labels readable; a second frame with each free gift on its own.' },
  { id: 'size', name: 'Size and options side by side', what: 'Every size, colour or variant in one frame.', why: 'The options picker and the size chart need it; returns fall when people see the range.', how: 'Same distance and light for every unit, evenly spaced.' },
  { id: 'result', name: 'The result, or before and after', what: 'What is different after using it: the clean surface, the sleeping baby, the flat pack. Two frames, same framing, one with the product and one without.', why: 'The outcome is what is bought; the before-and-after block and the ad hold read this.', how: 'Same framing before and after; if there is no before, the after alone with the product in frame.' },
  { id: 'everywhere', name: 'Goes everywhere: four places', what: 'The product in four places it travels to: the car, the porch, the office, on the go.', why: 'The "and it goes everywhere you go" grid on the sales pages; it answers "will it work in my seat" without a word.', how: 'Four square frames, product in the same position in each, the place doing the talking; shoot in one afternoon.' },
  { id: 'slides', name: 'The infographic slides', what: 'Four to six gallery slides that sell on their own: the benefits on a plain ground, the mechanism callouts, the dimensions, the expert quote, the reviews overlay.', why: 'On a phone the gallery is seen before any scroll; the reference product pages put the argument into the slides.', how: 'Brief for a designer or a render: the hero or a 360 frame as the base, short labels in the brand type, one idea per slide, the last slide the dimensions.' },
  { id: 'turn', name: 'The 360 set', what: 'Front, both sides, back and top, on the same ground.', why: 'Every render and every page needs the product from more than one side; the reference set is built from these.', how: 'Turn the product, not the phone; keep the distance and the light fixed.' },
  { id: 'expert', name: 'The expert, if there is one', what: 'A portrait of the real professional who recommends it, in their own place: the clinic, the workshop, the gym.', why: 'The expert quote and the "recommended by" badge need a face; a stock photo is a lie the health report cannot catch.', how: 'Only a real person who agreed in writing; natural light, their name and credential recorded with the file.', optional: true },
  { id: 'origin', name: 'Where it is made', what: 'The workshop, the factory line, the field, the kitchen: a real photo of the product being made or checked.', why: 'The manufacturing section on the reference pages carries a captioned photo ("Every unit is hand-checked before it ships."); origin is a quality claim the buyer can see.', how: 'Ask the supplier for one frame of the line or the final check; if none exists, the section is left out rather than faked.', optional: true },
  { id: 'texture', name: 'The texture macro', what: 'The material itself, filling the frame: the serum on skin, the weave, the grain, the foam cut edge.', why: 'Skincare and materials sell on texture; the gallery and the ingredients section use it.', how: 'Macro, raking light from one side, no product packaging in frame.', optional: true },
]

/** The brief an image is labelled with, if any. */
export function shotOf(alt: string): string {
  return /photo:([a-z0-9-]+)/i.exec(alt ?? '')?.[1]?.toLowerCase() ?? ''
}

/**
 * Labels an image with the brief it satisfies, or clears the label. The
 * checklist reads these markers out of the alt text; until there was a control
 * that wrote one, coverage could never move past the hero shot, and every
 * product showed twelve missing shots forever.
 */
export function labelShot(alt: string, shotId: string): string {
  const rest = (alt ?? '').replace(/\s*photo:[a-z0-9-]+/gi, '').replace(/\s{2,}/g, ' ').trim()
  if (!shotId) return rest
  return rest ? `${rest} photo:${shotId}` : `photo:${shotId}`
}

/** Which briefs a product already has, read from its media alt text and tags ("photo:hero"). */
export function photoCoverage(product: Product): { have: PhotoBrief[]; missing: PhotoBrief[]; optional: PhotoBrief[] } {
  const text = [...product.media.map((media) => media.alt), ...product.tags, product.metadata.photos ?? ''].join(' ').toLowerCase()
  const have = PHOTO_BRIEFS.filter((brief) => text.includes(`photo:${brief.id}`) || (brief.id === 'hero' && Boolean(product.heroImage)))
  // Optional shots (the expert, the origin, the texture) are listed so the owner knows to take them, but not counted as gaps.
  return { have, missing: PHOTO_BRIEFS.filter((brief) => !have.includes(brief) && !brief.optional), optional: PHOTO_BRIEFS.filter((brief) => brief.optional && !have.includes(brief)) }
}

/** One queue item per missing shot; already-queued ones are left alone. */
export function queuePhotoBriefs(db: Db, storeId: string, product: Product): Array<QueueItem<PhotoBrief>> {
  const existing = new Set(listQueue<PhotoBrief>(db, storeId, { kind: 'photo-brief', productId: product.id }).map((item) => item.body.id))
  const { missing } = photoCoverage(product)
  for (const brief of missing) {
    if (existing.has(brief.id)) continue
    enqueue(db, storeId, { productId: product.id, kind: 'photo-brief', title: `${product.title}: ${brief.name}`, body: brief })
  }
  return listQueue<PhotoBrief>(db, storeId, { kind: 'photo-brief', productId: product.id })
}

/* ------------------------------------------------------------ UGC concepts */

export type UgcConcept = {
  title: string
  who: string
  scene: string
  says: string
  shots: string[]
  format: string
  angle: string
  /** Always present: how the ad will disclose that it is a paid or scripted creator piece. */
  disclosure: string
}

const UGC_SCHEMA = S.obj({
  concepts: S.arr(
    S.obj({
      title: S.str('Five words.'),
      who: S.str('The kind of person on camera, matching the avatar. Not a name.'),
      scene: S.str('Where, doing what, with the product.'),
      says: S.str('What they say, in their words, about twenty seconds. Claims only the product can keep.'),
      shots: S.arr(S.str(), 'Four to six shots in order, each one line.'),
      format: S.str('talking-head | voiceover-b-roll | subtitles-b-roll | pov'),
      angle: S.str('The reason to buy this piece carries.'),
      disclosure: S.str('How the piece is labelled: "paid partnership", "creator content", "dramatisation".'),
    }),
    'Three concepts, each for a real creator or a real customer to film.',
  ),
})

export function rulesUgcConcepts(product: Product, avatar: Avatar | null, research: Research | null): UgcConcept[] {
  const who = avatar ? avatar.who.split(/[.;]/)[0]?.trim() || avatar.name : research?.audience[0]?.who.split(/[.;]/)[0]?.trim() || 'a real customer'
  const angle = avatar?.angle || research?.triggers[0] || `what ${product.title} does`
  return [
    { title: 'First use, honestly', who, scene: `Unboxing ${product.title} at home and using it for the first time.`, says: `I'll tell you what I expected and what actually happened. ${angle}.`, shots: ['Box on the table, hands opening it', 'Product in hand, turned once', 'First use, real place', 'Reaction, no script', 'The result', 'Product back in frame with the one-line verdict'], format: 'talking-head', angle, disclosure: 'creator content' },
    { title: 'What I tried before', who, scene: `The old solution on the left, ${product.title} on the right.`, says: `Here is what I used before and why it did not work. Here is the difference.`, shots: ['The old thing failing', 'The label of who this is for', 'The mechanism close up', 'It working', 'Side by side'], format: 'subtitles-b-roll', angle, disclosure: 'creator content' },
    { title: 'A day with it', who, scene: 'Three moments in one day where it is used.', says: 'Morning, afternoon, evening. Same product, three jobs.', shots: ['Morning use', 'Midday use', 'Evening use', 'One line on the outcome'], format: 'pov', angle, disclosure: 'creator content' },
  ]
}

export async function authorUgcConcepts(choice: ModelChoice | null, product: Product, avatar: Avatar | null, research: Research | null): Promise<{ concepts: UgcConcept[]; source: 'model' | 'rules' }> {
  const rules = rulesUgcConcepts(product, avatar, research)
  if (!choice) return { concepts: rules, source: 'rules' }
  try {
    const prompt = [
      `Product: ${product.title}${product.subtitle ? ` — ${product.subtitle}` : ''}. ${product.description.slice(0, 800)}`,
      avatar ? `Avatar: ${JSON.stringify({ name: avatar.name, who: avatar.who, wants: avatar.wants, fears: avatar.fears, angle: avatar.angle, label: avatar.label, hooks: avatar.hooks })}` : '',
      research ? `Research: ${JSON.stringify({ triggers: research.triggers, objections: research.objections.slice(0, 3), proofPoints: research.proofPoints })}` : '',
      'Write three creator-content concepts for a real person to film. Every claim spoken must be one the product can keep. Each concept carries one angle and states how it will be disclosed.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const parsed = await completeJson<{ concepts: UgcConcept[] }>(choice, {
      task: 'ads',
      system: `You write briefs for creator content (UGC) for a dropshipping brand. The result is filmed by a real person; nothing you write is presented as a customer review.\n\n${knowledge('creatives', 'avatars', 'honesty')}`,
      prompt,
      schema: UGC_SCHEMA,
      name: 'ugc_concepts',
    })
    return { concepts: (parsed.concepts ?? []).slice(0, 3).map((concept) => ({ ...concept, disclosure: concept.disclosure || 'creator content' })), source: 'model' }
  } catch (error) {
    log.warn(`${describe(choice)} could not write UGC concepts; using the rules: ${error instanceof Error ? error.message : String(error)}`)
    return { concepts: rules, source: 'rules' }
  }
}

/** Concepts land in the queue as pending. They never touch the reviews table. */
export async function queueUgcConcepts(db: Db, storeId: string, product: Product, avatar: Avatar | null, research: Research | null, choice: ModelChoice | null): Promise<Array<QueueItem<UgcConcept>>> {
  const { concepts } = await authorUgcConcepts(choice, product, avatar, research)
  return concepts.map((concept) => enqueue<UgcConcept>(db, storeId, { productId: product.id, kind: 'ugc-concept', title: `${product.title}: ${concept.title}`, body: concept }))
}

/* ------------------------------------------------------- block suggestions */

export type PageGoal = 'offer' | 'advertorial' | 'quiz' | 'pdp' | 'home' | 'science' | 'checkout'

export const PAGE_GOALS: PageGoal[] = ['offer', 'advertorial', 'quiz', 'pdp', 'home', 'science', 'checkout']
export type CatalogEntry = { type: string; name: string; description: string; fields?: string[] }

export type BlockSuggestion = { type: string; why: string; settings?: Record<string, unknown> }

const CATALOG = BLOCKS.map((block) => ({ type: block.type, name: block.name, description: block.description }))

const SUGGEST_SCHEMA = S.obj({
  blocks: S.arr(S.obj({ type: S.str('A block type from the catalog, exactly; "custom-html" for a section no block does, with its HTML in html; "custom-code" for css or a script the page needs, in css and js.'), why: S.str('One line: the job this block does at this point on the page.'), html: S.str('Only for custom-html: the section\'s HTML, using the theme classes (head, lead, cols, col, checks, btn, micro). Empty otherwise.'), css: S.str('Only for custom-code: CSS for this page. Empty otherwise.'), js: S.str('Only for custom-code: a script for this page, no external scripts. Empty otherwise.') }), 'The page, top to bottom: eight to twenty blocks.'),
  note: S.str('One sentence on the shape chosen and why.'),
})

/** The default orders, from the pages knowledge. */
export function rulesSuggestBlocks(goal: PageGoal, product: { id: string } | null): BlockSuggestion[] {
  const buy = product ? { type: 'buy-box', why: 'The offer: same photo, badge, was/now, tiers, guarantee.', settings: { productId: product.id, buyNow: true, background: 'raise' } } : { type: 'offer-box', why: 'The offer.' }
  switch (goal) {
    case 'offer':
      return [
        { type: 'header', why: 'Brand mark and one button; no navigation out.' },
        { type: 'countdown', why: 'The saving, ending soon.' },
        { type: 'rating-strip', why: 'The rating from real reviews, before any claim.', settings: product ? { productId: product.id } : {} },
        { type: 'hero', why: 'The promise above the fold with the CTA.' },
        { type: 'trust-badges', why: 'Guarantee, delivery, credential, shipping.' },
        { type: 'image-grid', why: 'The problem as four image scenes with a caption each, then the reframe.' },
        { type: 'alternatives', why: 'Each failed alternative and what it cost, dismissed in two sentences.' },
        { type: 'image-with-text', why: 'The product reveal with the named mechanism.' },
        { type: 'multicolumn', why: 'How it works in three verbs.' },
        { type: 'timeline', why: 'What to expect, week by week, past the guarantee window.' },
        { type: 'review-wall', why: 'Proof from people like them.' },
        buy,
        { type: 'included', why: 'What is in the box, gifts with their value.' },
        { type: 'comparison', why: 'The mechanism against the category, never a brand.' },
        { type: 'cost-comparison', why: 'What the alternatives cost, added up.' },
        { type: 'faq', why: 'The objections, answered.' },
        { type: 'guarantee', why: 'The risk removed, named and numbered.' },
        { type: 'sticky-cta', why: 'The button follows the reader.' },
        { type: 'footer', why: 'Legal links and contact.' },
      ]
    case 'advertorial':
      return [
        { type: 'publication-bar', why: 'Reads as editorial.' },
        { type: 'headline', why: 'The listicle or story headline.' },
        { type: 'byline', why: 'Author and read time.' },
        { type: 'image', why: 'The lead image.' },
        { type: 'rich-text', why: 'The lead: what was tried and why.' },
        { type: 'numbered-reason', why: 'One argument.' },
        { type: 'numbered-reason', why: 'One argument.' },
        { type: 'numbered-reason', why: 'One argument.' },
        { type: 'pull-quote', why: 'A real quote.' },
        { type: 'comparison', why: 'Against what they were going to buy.' },
        { type: 'review-wall', why: 'Proof.' },
        buy,
        { type: 'faq', why: 'Objections.' },
        { type: 'guarantee', why: 'Risk removed.' },
        { type: 'comments', why: 'Social proof in the reader\'s register.' },
        { type: 'sticky-cta', why: 'The button follows.' },
        { type: 'disclaimer', why: 'It says it is an advertisement.' },
        { type: 'footer', why: 'Legal links.' },
      ]
    case 'quiz':
      return [
        { type: 'header', why: 'Brand mark, no distractions.' },
        { type: 'quiz', why: 'One question per screen; the result names the sub-avatar and its offer.', settings: product ? { productId: product.id } : {} },
        { type: 'trust-badges', why: 'Guarantee and delivery under the quiz.' },
        { type: 'footer', why: 'Legal links.' },
      ]
    case 'home':
      return [
        { type: 'announcement-bar', why: 'The offer in one line, with its value.' },
        { type: 'header', why: 'Navigation and cart.' },
        { type: 'hero', why: 'The promise with three bullets.' },
        { type: 'logos', why: 'Press, if real.' },
        { type: 'featured-products', why: 'The catalog with prices.' },
        { type: 'image-with-text', why: 'One idea, one number.' },
        { type: 'review-wall', why: 'Proof.' },
        { type: 'trust-badges', why: 'Guarantee and shipping.' },
        { type: 'email-signup', why: 'The list.' },
        { type: 'footer', why: 'Legal links and real contact details.' },
      ]
    case 'science':
      return [
        { type: 'header', why: 'Brand mark and one button.' },
        { type: 'hero', why: 'The claim, with the rating under it.' },
        { type: 'rating-strip', why: 'The rating from real reviews.', settings: product ? { productId: product.id } : {} },
        { type: 'stats', why: 'The numbers buyers reported, with their source.' },
        { type: 'multicolumn', why: 'What is different, in icon bullets.' },
        { type: 'image-with-text', why: 'The mechanism in plain words.' },
        { type: 'studies', why: 'The peer-reviewed evidence, cited.' },
        { type: 'timeline', why: 'What to expect and when.' },
        { type: 'comparison', why: 'Against the usual alternative.' },
        { type: 'video-wall', why: 'Customers on camera.' },
        { type: 'letter', why: 'A note from the specialist.' },
        { type: 'value-stack', why: 'What they get and what it is worth.' },
        buy,
        { type: 'guarantee', why: 'Risk removed.' },
        { type: 'faq', why: 'Objections.' },
        { type: 'sticky-cta', why: 'The button follows.' },
        { type: 'footer', why: 'Legal links.' },
      ]
    case 'checkout':
      return [
        { type: 'header', why: 'The logo, nothing to click away to.' },
        { type: 'checkout-steps', why: 'Where they are in the process.' },
        { type: 'countdown', why: 'The cart is reserved for ten minutes.', settings: { text: 'Your cart is reserved for', minutes: 10 } },
        { type: 'rating-strip', why: 'The rating, right above the form.', settings: product ? { productId: product.id } : {} },
        { type: 'checkout-form', why: 'The real form with the summary beside it and the bump before payment.' },
        { type: 'guarantee', why: 'Risk removed at the moment of doubt.' },
        { type: 'trust-badges', why: 'Secure, tracked, supported.' },
        { type: 'review-wall', why: 'Three buyers, under the button.', settings: { count: 3, ...(product ? { productId: product.id } : {}) } },
        { type: 'faq', why: 'The last questions before paying.' },
        { type: 'payment-icons', why: 'The marks that say it is a real shop.' },
        { type: 'footer', why: 'Legal links.' },
      ]
    default:
      return [
        { type: 'announcement-bar', why: 'The offer in one line.' },
        { type: 'header', why: 'Navigation and cart.' },
        { type: 'rating-strip', why: 'The rating from real reviews.', settings: product ? { productId: product.id } : {} },
        buy,
        { type: 'trust-badges', why: 'Secure checkout, returns, shipping.' },
        { type: 'delivery-estimate', why: 'When it arrives.', settings: product ? { productId: product.id } : {} },
        { type: 'guarantee', why: 'Risk removed, next to the price.' },
        { type: 'multicolumn', why: 'Benefits with images.' },
        { type: 'image-with-text', why: 'The mechanism with a picture.' },
        { type: 'how-it-works', why: 'How to use it, in three steps.' },
        { type: 'specs', why: 'The facts: size, materials, what is in the box.' },
        { type: 'comparison', why: 'The mechanism against the usual.' },
        { type: 'expert-quote', why: 'A professional who uses it.' },
        { type: 'review-wall', why: 'Proof, with the star breakdown.', settings: { histogram: true, ...(product ? { productId: product.id } : {}) } },
        { type: 'faq', why: 'Objections.' },
        { type: 'sticky-cta', why: 'The button follows.' },
        { type: 'footer', why: 'Legal links.' },
      ]
  }
}

/**
 * What the model returned, kept to what can render: catalog types, the
 * store's own blocks, and a custom-html section when it wrote one. A
 * buy box is wired to the product; anything unknown is dropped.
 */
export function acceptSuggestion(parsed: { blocks?: Array<BlockSuggestion & { html?: string; css?: string; js?: string }>; note?: string }, custom: CatalogEntry[], product: { id: string } | null): BlockSuggestion[] {
  const known = new Set([...CATALOG.map((entry) => entry.type), ...custom.map((entry) => entry.type)])
  return (parsed.blocks ?? [])
    .filter((entry) => known.has(entry.type))
    .filter((entry) => (entry.type !== 'custom-html' || Boolean(entry.html?.trim())) && (entry.type !== 'custom-code' || Boolean(entry.css?.trim() || entry.js?.trim())))
    .map(({ html, css, js, ...entry }) => {
      if (entry.type === 'buy-box' && product) return { ...entry, settings: { productId: product.id, buyNow: true } }
      if (entry.type === 'custom-html') return { ...entry, settings: { html: String(html ?? '') } }
      if (entry.type === 'custom-code') return { ...entry, settings: { css: String(css ?? ''), js: String(js ?? '') } }
      return entry
    })
}

export async function suggestBlocks(choice: ModelChoice | null, input: { goal: PageGoal; product: Product | null; research: Research | null; avatar: Avatar | null; direction?: string; custom?: CatalogEntry[] }): Promise<{ blocks: BlockSuggestion[]; note: string; source: 'model' | 'rules' }> {
  const rules = rulesSuggestBlocks(input.goal, input.product)
  if (!choice) return { blocks: rules, note: 'The default order for this kind of page.', source: 'rules' }
  try {
    const custom = input.custom ?? []
    const prompt = [
      `Kind of page: ${input.goal}. ${input.direction ? `Direction: ${input.direction}` : ''}`,
      input.product ? `Product: ${input.product.title} — ${input.product.subtitle}. ${input.product.description.slice(0, 600)}` : 'No product yet.',
      input.avatar ? `Avatar: ${input.avatar.name}: ${input.avatar.who} Angle: ${input.avatar.angle}` : '',
      input.research ? `Research: ${JSON.stringify({ positioning: input.research.positioning, triggers: input.research.triggers, objections: input.research.objections.map((entry) => entry.objection), competitors: input.research.competitors.map((entry) => entry.name) })}` : '',
      `Blocks available (use the type exactly):\n${JSON.stringify(CATALOG)}`,
      custom.length ? `Blocks this store defined for itself (use these too):\n${JSON.stringify(custom)}` : '',
      'Choose the blocks and their order for this page, with the job each does. Every page ends with a footer; a selling page has a buy-box (or offer-box) and a sticky-cta. If the page needs a section no block does, add it as type "custom-html" with the section\'s HTML in html, using the theme classes (head, lead, eyebrow, cols, col, checks, btn, micro) so it matches the rest; if it needs styling or behaviour no block provides (an animation, a tab switcher, a sticky element), add one "custom-code" block with css and js for this page; prefer a catalog block whenever one fits.',
    ]
      .filter(Boolean)
      .join('\n\n')
    const parsed = await completeJson<{ blocks: Array<BlockSuggestion & { html?: string }>; note: string }>(choice, {
      task: 'pages',
      system: `You lay out direct-response pages for a dropshipping brand from a block catalog, and you can write a section yourself when the catalog has none for it. You decide order and purpose, not copy.\n\n${knowledge('pages', 'offers')}`,
      prompt,
      schema: SUGGEST_SCHEMA,
      name: 'page_layout',
    })
    const blocks = acceptSuggestion(parsed, custom, input.product)
    return blocks.length >= 3 ? { blocks, note: parsed.note ?? '', source: 'model' } : { blocks: rules, note: 'The model returned too little; the default order stands.', source: 'rules' }
  } catch (error) {
    log.warn(`${describe(choice)} could not suggest a layout; using the rules: ${error instanceof Error ? error.message : String(error)}`)
    return { blocks: rules, note: 'The default order for this kind of page.', source: 'rules' }
  }
}
