import { productGalleryMedia } from './product-data.ts'
import { bool, json, now, type Db, type Row } from '../lib/db.ts'
import { handle as toHandle, id } from '../lib/ids.ts'
import { bundleFor, renderBundleWidget } from '../domain/bundles.ts'
import { listProducts } from '../domain/catalog.ts'
import { listReviews } from '../domain/reviews.ts'
import { deliveryEstimate, listQuestions, recentPurchases, viewersNow } from '../domain/ops.ts'
import type { Store } from '../control/stores.ts'
import { BLOCK_RUNTIME, blockDefinition, defaultsFor, inlineScript, renderBlocks, type BlockContext, type BlockDefinition, type BlockInstance } from './blocks.ts'
import { customDefinitions } from './custom-blocks.ts'
import { minorUnitRate } from '../domain/regions.ts'

export const PAGE_ROLES = { page: 'General page', pdp: 'Product page', advertorial: 'Advertorial', offer: 'Offer / sales page', cart: 'Cart', checkout: 'Checkout', upsell: 'Upsell', downsell: 'Downsell', thankyou: 'Thank you' } as const
export type PageRole = keyof typeof PAGE_ROLES
export function pageRole(value: unknown): PageRole {
  if (typeof value !== 'string' || !Object.hasOwn(PAGE_ROLES, value)) throw new Error('Choose a valid page type')
  return value as PageRole
}

export type Page = {
  id: string
  storeId: string
  title: string
  handle: string
  kind: 'landing' | 'advertorial' | 'product' | 'custom' | 'checkout'
  mode: 'blocks' | 'html'
  blocks: BlockInstance[]
  rawHtml: string
  headHtml: string
  seo: { title?: string; description?: string; image?: string }
  status: 'draft' | 'published'
  sourceUrl: string
  isHome: boolean
  /** A version of a product's page (role 'pdp') or an advertorial for it. */
  productId: string
  /** 'checkout' makes this page the store's checkout: the most recently updated published one wins. */
  role: PageRole
  /** Split-test weight among a product's pdp versions; 0 = not in the test. */
  weight: number
  format: string
  direction: string
  createdAt: string
  updatedAt: string
}

export type PageRevision = {
  id: string
  pageId: string
  storeId: string
  version: number
  note: string
  createdAt: string
  snapshot: Pick<Page, 'title' | 'handle' | 'kind' | 'role' | 'productId' | 'mode' | 'blocks' | 'rawHtml' | 'headHtml' | 'seo' | 'status' | 'isHome'>
}

function rowToPage(row: Row): Page {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    title: row.title as string,
    handle: row.handle as string,
    kind: row.kind as Page['kind'],
    mode: row.mode as Page['mode'],
    blocks: json(row.blocks, [] as BlockInstance[]),
    rawHtml: row.raw_html as string,
    headHtml: row.head_html as string,
    seo: json(row.seo, {}),
    status: row.status as Page['status'],
    sourceUrl: row.source_url as string,
    isHome: bool(row.is_home),
    productId: (row.product_id as string) ?? '',
    role: ((row.role as string) || 'page') as Page['role'],
    weight: (row.weight as number) ?? 0,
    format: (row.format as string) ?? '',
    direction: (row.direction as string) ?? '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function listPages(db: Db, storeId: string): Page[] {
  return db.all('SELECT * FROM pages WHERE store_id = ? ORDER BY updated_at DESC', storeId).map(rowToPage)
}

export function getPage(db: Db, storeId: string, idOrHandle: string): Page | null {
  const row = db.one('SELECT * FROM pages WHERE store_id = ? AND (id = ? OR handle = ?)', storeId, idOrHandle, idOrHandle)
  return row ? rowToPage(row) : null
}

function pageSnapshot(page: Page): PageRevision['snapshot'] {
  return {
    title: page.title,
    handle: page.handle,
    kind: page.kind,
    role: page.role,
    productId: page.productId,
    mode: page.mode,
    blocks: page.blocks,
    rawHtml: page.rawHtml,
    headHtml: page.headHtml,
    seo: page.seo,
    status: page.status,
    isHome: page.isHome,
  }
}

function rowToRevision(row: Row): PageRevision {
  return {
    id: row.id as string,
    pageId: row.page_id as string,
    storeId: row.store_id as string,
    version: row.version as number,
    snapshot: json(row.snapshot, {} as PageRevision['snapshot']),
    note: row.note as string,
    createdAt: row.created_at as string,
  }
}

export function listPageRevisions(db: Db, storeId: string, pageId: string, limit = 40): PageRevision[] {
  return db.all('SELECT * FROM page_revisions WHERE store_id = ? AND page_id = ? ORDER BY version DESC LIMIT ?', storeId, pageId, limit).map(rowToRevision)
}

export function savePageRevision(db: Db, page: Page, note = 'Saved'): PageRevision {
  const version = (db.one<{ version: number | null }>('SELECT MAX(version) version FROM page_revisions WHERE page_id = ?', page.id)?.version ?? 0) + 1
  const revisionId = id('rev')
  db.insert('page_revisions', {
    id: revisionId,
    page_id: page.id,
    store_id: page.storeId,
    version,
    snapshot: pageSnapshot(page),
    note: note.slice(0, 120) || 'Saved',
    created_at: now(),
  })
  return rowToRevision(db.one('SELECT * FROM page_revisions WHERE id = ?', revisionId) as Row)
}

export function ensurePageRevision(db: Db, page: Page): PageRevision {
  return listPageRevisions(db, page.storeId, page.id, 1)[0] ?? savePageRevision(db, page, 'Original')
}

export function restorePageRevision(db: Db, storeId: string, pageId: string, revisionId: string): Page {
  const row = db.one('SELECT * FROM page_revisions WHERE id = ? AND page_id = ? AND store_id = ?', revisionId, pageId, storeId)
  if (!row) throw new Error('No such page revision')
  const revision = rowToRevision(row)
  const restored = updatePage(db, storeId, pageId, revision.snapshot)
  savePageRevision(db, restored, `Restored version ${revision.version}`)
  return restored
}

/** The chosen home page. Draft homes are visible in preview before publication. */
export function homePage(db: Db, storeId: string, opts: { preview?: boolean } = {}): Page | null {
  const row = db.one(`SELECT * FROM pages WHERE store_id = ? AND is_home = 1 ${opts.preview ? '' : "AND status = 'published'"}`, storeId)
  return row ? rowToPage(row) : null
}

/** Copied and native checkouts use the same store-owned payment endpoints. */
export function liveCheckoutPage(db: Db, storeId: string, opts: { preview?: boolean; productId?: string } = {}): Page | null {
  if(opts.productId){const matching=db.one(`SELECT * FROM pages WHERE store_id=? AND role='checkout' AND product_id=? ${opts.preview?'':"AND status='published'"} ORDER BY created_at,rowid LIMIT 1`,storeId,opts.productId);if(matching)return rowToPage(matching)}
  const row = db.one(`SELECT * FROM pages WHERE store_id = ? AND role = 'checkout' ${opts.preview ? '' : "AND status = 'published'"} ORDER BY updated_at DESC LIMIT 1`, storeId)
  return row ? rowToPage(row) : null
}

export function liveCartPage(db: Db, storeId: string, opts: { preview?: boolean } = {}): Page | null {
  const row = db.one(`SELECT * FROM pages WHERE store_id = ? AND role = 'cart' ${opts.preview ? '' : "AND status = 'published'"} ORDER BY updated_at DESC LIMIT 1`, storeId)
  return row ? rowToPage(row) : null
}

function uniqueHandle(db: Db, storeId: string, title: string, ignoreId?: string): string {
  const base = toHandle(title)
  let candidate = base
  let suffix = 2
  while (db.one('SELECT id FROM pages WHERE store_id = ? AND handle = ? AND id != ?', storeId, candidate, ignoreId ?? '')) candidate = `${base}-${suffix++}`
  return candidate
}

export function newBlock(type: string, settings: Record<string, unknown> = {}, definition: BlockDefinition | null = blockDefinition(type)): BlockInstance {
  return { id: id('blk', 8), type, settings: { ...(definition ? defaultsFor(definition) : {}), ...settings } }
}

export function createPage(
  db: Db,
  storeId: string,
  input: { title: string; kind?: Page['kind']; mode?: Page['mode']; blocks?: BlockInstance[]; rawHtml?: string; headHtml?: string; seo?: Page['seo']; status?: Page['status']; sourceUrl?: string; handle?: string; productId?: string; role?: Page['role']; weight?: number; format?: string; direction?: string },
): Page {
  const pageId = id('page')
  const timestamp = now()
  db.insert('pages', {
    id: pageId,
    store_id: storeId,
    title: input.title,
    handle: uniqueHandle(db, storeId, input.handle ?? input.title),
    kind: input.kind ?? 'landing',
    mode: input.mode ?? (input.rawHtml ? 'html' : 'blocks'),
    blocks: input.blocks ?? [],
    raw_html: input.rawHtml ?? '',
    head_html: input.headHtml ?? '',
    seo: input.seo ?? {},
    status: input.status ?? 'draft',
    source_url: input.sourceUrl ?? '',
    is_home: false,
    product_id: input.productId ?? '',
    role: input.role ?? 'page',
    weight: input.weight ?? 0,
    format: input.format ?? '',
    direction: input.direction ?? '',
    created_at: timestamp,
    updated_at: timestamp,
  })
  const page = getPage(db, storeId, pageId) as Page
  savePageRevision(db, page, 'Created')
  return page
}

export function updatePage(db: Db, storeId: string, pageId: string, patch: Partial<Omit<Page, 'id' | 'storeId' | 'createdAt' | 'updatedAt'>>): Page {
  const page = getPage(db, storeId, pageId)
  if (!page) throw new Error('No such page')
  const values: Row = { updated_at: now() }
  if (patch.title !== undefined) values.title = patch.title
  if (patch.handle !== undefined) values.handle = uniqueHandle(db, storeId, patch.handle, page.id)
  if (patch.kind !== undefined) values.kind = patch.kind
  if (patch.mode !== undefined) values.mode = patch.mode
  if (patch.blocks !== undefined) values.blocks = patch.blocks
  if (patch.rawHtml !== undefined) values.raw_html = patch.rawHtml
  if (patch.headHtml !== undefined) values.head_html = patch.headHtml
  if (patch.seo !== undefined) values.seo = { ...page.seo, ...patch.seo }
  if (patch.status !== undefined) values.status = patch.status
  if (patch.isHome !== undefined) {
    if (patch.isHome) db.run('UPDATE pages SET is_home = 0 WHERE store_id = ?', storeId)
    values.is_home = patch.isHome
  }
  if (patch.productId !== undefined) values.product_id = patch.productId
  if (patch.role !== undefined) values.role = patch.role
  if (patch.weight !== undefined) values.weight = patch.weight
  if (patch.format !== undefined) values.format = patch.format
  if (patch.direction !== undefined) values.direction = patch.direction
  db.update('pages', page.id, values)
  return getPage(db, storeId, page.id) as Page
}

export function deletePage(db: Db, storeId: string, pageId: string): boolean {
  return Number(db.run('DELETE FROM pages WHERE id = ? AND store_id = ?', pageId, storeId).changes) > 0
}

export function duplicatePage(db: Db, storeId: string, pageId: string): Page {
  const page = getPage(db, storeId, pageId)
  if (!page) throw new Error('No such page')
  return createPage(db, storeId, {
    title: `${page.title} (copy)`,
    kind: page.kind,
    mode: page.mode,
    blocks: page.blocks.map((block) => ({ ...block, id: id('blk', 8) })),
    rawHtml: page.rawHtml,
    headHtml: page.headHtml,
    seo: page.seo,
    sourceUrl: page.sourceUrl,
    productId: page.productId,
    role: page.role,
    format: page.format,
    direction: page.direction,
  })
}

/* ------------------------------------------------------------- templates */

export type TemplateInput = { storeName: string; product?: { id: string; title: string; image: string; subtitle: string }; research?: { triggers: string[]; objections: Array<{ objection: string; answer: string }>; comparison: { rows: Array<{ label: string; us: string; them: string }> }; competitors: Array<{ name: string }> } | null }

/** The advertorial listicle: the DTC workhorse, as blocks, ready to edit. */
export function advertorialTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  const reasons = (input.research?.triggers ?? ['It lasts', 'It is repairable', 'It is honest about the wait']).slice(0, 5)
  return [
    newBlock('publication-bar', { name: `${input.storeName} Journal`, section: 'Reviews' }),
    newBlock('headline', { level: 'h1', eyebrow: 'Editor’s pick', text: `${reasons.length} reasons people are switching to ${product?.title ?? input.storeName}`, sub: product?.subtitle ?? '', width: 'narrow', padding: 'small' }),
    newBlock('byline', { author: 'By the editorial team', readTime: '4 min read' }),
    ...(product?.image ? [newBlock('image', { src: product.image, alt: product.title, width: 'narrow', padding: 'none' })] : []),
    newBlock('rich-text', { text: 'We spent three months with it. Here is what held up, what did not, and who should skip it.' }),
    ...reasons.map((reason, index) => newBlock('numbered-reason', { number: index + 1, headline: reason, text: 'Say what happened, not what it means. One specific detail beats three adjectives.' })),
    newBlock('pull-quote', { quote: 'I stopped thinking about my gear. That is the whole point.', who: 'A customer, verified' }),
    ...(input.research?.comparison.rows.length ? [newBlock('comparison', { themLabel: input.research.competitors[0]?.name ?? 'The usual', rows: input.research.comparison.rows.map((row) => `${row.label}|${row.us}|${row.them}`).join('\n') })] : []),
    newBlock('review-wall', { headline: 'From people who bought it', count: 6, ...(product ? { productId: product.id } : {}) }),
    ...(product ? [newBlock('buy-box', { productId: product.id, buyNow: true, background: 'raise' })] : [newBlock('offer-box', {})]),
    ...(input.research?.objections.length ? [newBlock('faq', { headline: 'Before you decide', items: input.research.objections.map((entry) => `${entry.objection}|${entry.answer}`).join('\n') })] : []),
    newBlock('guarantee', {}),
    newBlock('comments', {}),
    newBlock('sticky-cta', { label: product ? `Get ${product.title}` : 'Get the offer', href: '#offer' }),
    newBlock('disclaimer', {}),
    newBlock('footer', {}),
  ]
}

/** A product landing page: banner, benefits, offer, proof, questions. */
export function landingTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  return [
    newBlock('announcement-bar', {}),
    newBlock('header', { cta: 'Buy now', ctaHref: '#offer' }),
    newBlock('hero', { headline: product?.title ?? `Introducing ${input.storeName}`, sub: product?.subtitle ?? '', image: product?.image ?? '', cta: 'Get yours', ctaHref: '#offer', height: 'large' }),
    newBlock('logos', {}),
    newBlock('multicolumn', { headline: 'Why this one' }),
    ...(product ? [newBlock('image-with-text', { image: product.image, headline: 'Built where the load goes', text: 'Doubled where it matters. Burnished, not painted. Hardware a size up.', cta: 'See the offer', ctaHref: '#offer' })] : []),
    ...(product ? [newBlock('bundle-offer', { productId: product.id, background: 'raise' })] : [newBlock('offer-box', {})]),
    newBlock('review-wall', { count: 6, ...(product ? { productId: product.id } : {}) }),
    ...(input.research?.comparison.rows.length ? [newBlock('comparison', { rows: input.research.comparison.rows.map((row) => `${row.label}|${row.us}|${row.them}`).join('\n') })] : []),
    newBlock('faq', { ...(input.research?.objections.length ? { items: input.research.objections.map((entry) => `${entry.objection}|${entry.answer}`).join('\n') } : {}) }),
    newBlock('guarantee', {}),
    newBlock('trust-badges', {}),
    newBlock('countdown', { text: 'This offer ends in' }),
    newBlock('sticky-cta', { label: 'Claim the offer', href: '#offer' }),
    newBlock('footer', {}),
  ]
}

/** The offer page: the order that turned 1.18x into 3.59x — the saving above the fold, proof, the problem, the mechanism, the buy box, the objections. */
export function offerTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  return [
    newBlock('header', { cta: 'Claim the offer', ctaHref: '#offer' }),
    newBlock('countdown', { text: 'Save on your first order — ending soon' }),
    newBlock('hero', { headline: product ? `${product.title}: the one that works when the others did not` : `Introducing ${input.storeName}`, sub: product?.subtitle ?? '', image: product?.image ?? '', cta: 'Get it and save', ctaHref: '#offer', height: 'medium' }),
    newBlock('trust-badges', {}),
    // The combined proof bar and the authority section were missing, and the
    // order they sit in is the whole point of the case: the rating and the
    // count answer "is this real" before the problem is named, and the
    // authority line answers "who says so" before the story of the failures.
    newBlock('rating-strip', { ...(product ? { productId: product.id } : {}) }),
    newBlock('headline', { level: 'h2', text: 'Why the usual fix keeps failing', sub: 'Say what the alternatives do wrong, in one line each.' }),
    newBlock('expert-quote', {
      headline: 'Who says so',
      quotes: 'One sentence from the person who stands behind it, in their own words.|Their name|Their credential — maker, clinician, coach|',
    }),
    newBlock('rich-text', { text: 'The cheap version fails in a month. The expensive one asks for a routine nobody keeps. Name each one, what it cost, and what happened next.' }),
    ...(product ? [newBlock('image-with-text', { image: product.image, headline: `What ${product.title} does differently`, text: 'The mechanism: how it creates the result, in two sentences an eleven-year-old follows.', cta: 'See the offer', ctaHref: '#offer' })] : []),
    newBlock('multicolumn', { headline: 'How it works' }),
    newBlock('review-wall', { headline: 'From people who bought it', count: 6, ...(product ? { productId: product.id } : {}) }),
    ...(product ? [newBlock('buy-box', { productId: product.id, buyNow: true, background: 'raise' })] : [newBlock('offer-box', {})]),
    // "Deeper education" after the buy box: whoever scrolled past the offer
    // has a question the offer did not answer, and this is where the case put
    // the answer rather than sending them away to look for it.
    newBlock('how-it-works', { headline: 'In more detail' }),
    ...(input.research?.comparison.rows.length ? [newBlock('comparison', { themLabel: input.research.competitors[0]?.name ?? 'The usual', rows: input.research.comparison.rows.map((row) => `${row.label}|${row.us}|${row.them}`).join('\n') })] : []),
    ...(input.research?.objections.length ? [newBlock('faq', { headline: 'Before you decide', items: input.research.objections.map((entry) => `${entry.objection}|${entry.answer}`).join('\n') })] : [newBlock('faq', {})]),
    newBlock('guarantee', {}),
    newBlock('sticky-cta', { label: product ? `Get ${product.title}` : 'Claim the offer', href: '#offer' }),
    newBlock('footer', {}),
  ]
}

/** The quiz funnel: one question per screen, the result names the sub-avatar and shows the offer. */
export function quizTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  const triggers = (input.research?.triggers ?? []).slice(0, 3)
  const steps = [
    `What brought you here?|${triggers.length ? triggers.join('|') : 'The last one broke|A recommendation|Curiosity'}`,
    'What did you try before?|Nothing yet|Something cheap that did not last|Something expensive that disappointed',
    'What matters most to you?|It lasts|It is easy|It looks right',
  ].join('\n')
  return [
    newBlock('header', {}),
    newBlock('quiz', { headline: `Find the right ${product?.title ?? 'one'} for you`, steps, resultHeadline: 'Here is the one for you', resultText: 'Based on what you told us, this is the build to start with.', ctaLabel: 'See the offer', ctaHref: '#offer', ...(product ? { productId: product.id } : {}) }),
    newBlock('trust-badges', {}),
    ...(product ? [newBlock('buy-box', { productId: product.id, buyNow: true, background: 'raise' })] : [newBlock('offer-box', {})]),
    newBlock('guarantee', {}),
    newBlock('footer', {}),
  ]
}

export function blankTemplate(): BlockInstance[] {
  return [newBlock('header', {}), newBlock('headline', { level: 'h1', text: 'A new page' }), newBlock('rich-text', {}), newBlock('footer', {})]
}

function faqFrom(input: TemplateInput, headline = 'Questions'): BlockInstance {
  return newBlock('faq', { headline, ...(input.research?.objections.length ? { items: input.research.objections.map((entry) => `${entry.objection}|${entry.answer}`).join('\n') } : {}) })
}

function comparisonFrom(input: TemplateInput): BlockInstance[] {
  return input.research?.comparison.rows.length ? [newBlock('comparison', { themLabel: input.research.competitors[0]?.name ?? 'The usual', rows: input.research.comparison.rows.map((row) => `${row.label}|${row.us}|${row.them}`).join('\n') })] : []
}

function offerFrom(input: TemplateInput, opts: { buyNow?: boolean } = {}): BlockInstance {
  return input.product ? newBlock('buy-box', { productId: input.product.id, buyNow: opts.buyNow ?? true, background: 'raise' }) : newBlock('offer-box', {})
}

/**
 * The Shopify-style product page as blocks, in the order the GemPages product
 * pages run: rating under the header, the buy box with its bundle, the trust
 * row and delivery date, the guarantee, then the education — benefits with
 * pictures, the steps, the specs, the comparison, an expert, reviews with the
 * star breakdown, customer photos, questions.
 */
export function productTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  const triggers = input.research?.triggers ?? []
  return [
    newBlock('announcement-bar', {}),
    newBlock('header', { showNav: true }),
    newBlock('rating-strip', { ...(product ? { productId: product.id } : {}) }),
    offerFrom(input, { buyNow: false }),
    newBlock('trust-badges', { padding: 'none' }),
    ...(product ? [newBlock('delivery-estimate', { productId: product.id, padding: 'small', width: 'narrow' })] : []),
    newBlock('guarantee', { padding: 'small', width: 'narrow' }),
    newBlock('multicolumn', { headline: 'Why this one', ...(triggers.length >= 3 ? { columns: triggers.slice(0, 4).map((trigger) => `✓|${trigger}|Say what happens, in one line.`).join('\n'), perRow: Math.min(4, triggers.length) } : {}) }),
    ...(product ? [newBlock('image-with-text', { image: product.image, eyebrow: 'The mechanism', headline: `What ${product.title} does differently`, text: 'How it creates the result, in two sentences an eleven-year-old follows.' })] : []),
    ...(product ? [newBlock('image-with-text', { image: product.image, imageSide: 'right', eyebrow: 'Built for it', headline: 'Made where the load goes', text: 'Doubled where it matters. Name the material, the maker, the run size.' })] : []),
    newBlock('how-it-works', { headline: 'How to use it' }),
    newBlock('specs', {}),
    ...comparisonFrom(input),
    newBlock('expert-quote', {}),
    newBlock('review-wall', { headline: 'Verified customer reviews', histogram: true, count: 6, ...(product ? { productId: product.id } : {}) }),
    newBlock('ugc-gallery', { ...(product ? { productId: product.id } : {}) }),
    faqFrom(input, 'Common questions'),
    ...(product ? [newBlock('product-qa', { productId: product.id })] : []),
    newBlock('sticky-cta', { label: product ? `Get ${product.title}` : 'Get yours', href: '#offer' }),
    newBlock('footer', {}),
  ]
}

/**
 * The science page: the mechanism, the evidence, then the offer. Hero with
 * the rating, the numbers buyers reported, the icon bullets, how it works,
 * the studies, what to expect and when, the comparison, video reviews, a
 * note from the specialist, the value stack and the buy box.
 */
export function scienceTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  return [
    newBlock('header', { cta: 'Get the offer', ctaHref: '#offer' }),
    newBlock('hero', { eyebrow: 'Designed by people who measure it', headline: product ? `${product.title}: the mechanism, the evidence, the offer` : `How ${input.storeName} works`, sub: product?.subtitle ?? '', image: product?.image ?? '', cta: 'See the evidence', ctaHref: '#evidence', cta2: 'Get the offer', cta2Href: '#offer', height: 'medium' }),
    newBlock('rating-strip', { ...(product ? { productId: product.id } : {}) }),
    newBlock('stats', { headline: 'What buyers reported', source: 'Say where the numbers come from, and when. Delete this block if you have none.' }),
    newBlock('multicolumn', { headline: 'What is different about it', perRow: 3 }),
    ...(product ? [newBlock('image-with-text', { image: product.image, eyebrow: 'How it works', headline: 'The mechanism, in plain words', text: 'One cause, one intervention, one result. Name the part that does the work.' })] : []),
    newBlock('how-it-works', { headline: 'Step by step' }),
    newBlock('headline', { level: 'h2', eyebrow: 'Peer-reviewed evidence', text: 'The research behind it', width: 'narrow', padding: 'small' }),
    newBlock('custom-html', { html: '<a id="evidence"></a>', padding: 'none' }),
    newBlock('studies', { eyebrow: '', headline: '' }),
    newBlock('timeline', { headline: 'What to expect, and when' }),
    ...comparisonFrom(input),
    newBlock('video-wall', { headline: 'Watch unfiltered reviews' }),
    newBlock('letter', { eyebrow: 'A note from the designer', headline: 'Why we built it this way' }),
    newBlock('value-stack', { headline: 'Try it risk-free: here is what you get' }),
    offerFrom(input),
    newBlock('guarantee', {}),
    faqFrom(input, 'Before you decide'),
    newBlock('sticky-cta', { label: 'Get the offer', href: '#offer' }),
    newBlock('footer', {}),
  ]
}

/**
 * The story landing page: a first-person headline, the pain in pictures, the
 * real cause, the product introduced as the answer, relief hour by hour, the
 * three things it does, a letter from the specialist, buyers in their own
 * words, the offer with a deadline.
 */
export function storyTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  return [
    newBlock('countdown', { text: 'Today only: the launch price ends in', minutes: 60 * 12, padding: 'small', background: 'ink' }),
    newBlock('header', { cta: 'Get the offer', ctaHref: '#offer' }),
    newBlock('hero', { headline: product ? `The one that finally worked: ${product.title}` : 'The one that finally worked', sub: 'Write it the way a customer would say it: what stopped, what came back, what they can do again.', image: product?.image ?? '', cta: 'Get the offer', ctaHref: '#offer', height: 'medium' }),
    newBlock('trust-badges', { padding: 'small' }),
    newBlock('multicolumn', { headline: 'If this has become the worst part of your day, you are not imagining it', columns: '|By mid-afternoon|Say where it hurts and when.\n|On the drive home|The moment it gets worse.\n|By the weekend|What they have stopped doing because of it.\n|At night|What it costs them in sleep.', perRow: 4 }),
    newBlock('headline', { level: 'h2', eyebrow: 'The real cause', text: 'It was never you. It was the gap.', sub: 'Name the mechanism nobody told them about.', width: 'narrow' }),
    newBlock('rich-text', { text: 'Three ways the usual fix fails, in one line each. Then the arrow: finally, something that works the second you use it.' }),
    ...(product ? [newBlock('image-with-text', { image: product.image, eyebrow: 'Introducing', headline: product.title, text: product.subtitle || 'Built to end it at the source.', cta: 'Get the offer', ctaHref: '#offer' })] : []),
    newBlock('timeline', { headline: 'What relief feels like, hour by hour', steps: '30 seconds|Sit down|What changes at once.\n1 week|The habit|What they notice by the end of the week.\n4 weeks|The pattern|What has stopped happening.\n3 months|Forgotten|They forget it is there.', note: 'Individual results vary.' }),
    newBlock('how-it-works', { headline: 'It takes one second', steps: 'Offload|Takes the weight off the part that hurts.|\nAlign|Puts the rest where it should be.|\nHold|Stays that way all day.|' }),
    newBlock('letter', { eyebrow: 'Meet the specialist behind it', headline: 'Twenty years of watching the same mistake', name: 'The designer', title: 'Say who they are and why they are qualified.' }),
    newBlock('review-wall', { headline: 'People who refuse to go back', count: 3, ...(product ? { productId: product.id } : {}) }),
    ...(product ? [newBlock('bundle-offer', { productId: product.id, headline: 'Claim the offer while stock lasts', background: 'raise' })] : [newBlock('offer-box', {})]),
    newBlock('guarantee', {}),
    faqFrom(input),
    newBlock('sticky-cta', { label: 'Get the offer', href: '#offer' }),
    newBlock('footer', {}),
  ]
}

/**
 * The long-form sales page, the way a Checkout Champ funnel's "sp" step runs:
 * the gallery and a customer's words above the headline, the check bullets,
 * the delivery date and the first button, the guarantee, the accordions, then
 * the long argument — the problem, the numbers, what it replaces, the promise
 * row, the timeline, the comparison, the steps, the value stack, the doctor,
 * the reviews with the star breakdown — and the offer twice.
 */
export function salesTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  const triggers = input.research?.triggers ?? []
  return [
    newBlock('announcement-bar', { text: 'SPECIAL OFFER NOW: SAVE ON YOUR FIRST ORDER' }),
    newBlock('header', {}),
    ...(product?.image ? [newBlock('gallery', { images: product.image, alt: product.title, width: 'narrow' })] : []),
    newBlock('pull-quote', { quote: 'I tried everything for this. This is the one that finally worked.', who: 'A customer, verified — replace with a real one or delete' }),
    newBlock('headline', { level: 'h1', text: product ? `Tired of fixes that come with side effects, cost a fortune, or do nothing at all?` : `Tired of fixes that do nothing?`, sub: product?.subtitle ?? '', width: 'narrow', padding: 'small' }),
    newBlock('multicolumn', { columns: (triggers.length >= 3 ? triggers.slice(0, 4) : ['It works from the first use', 'Nothing to learn', 'Made properly', 'Backed for 90 days']).map((line) => `✓|${line}|`).join('\n'), perRow: 2, width: 'narrow', padding: 'small' }),
    ...(product ? [newBlock('delivery-estimate', { productId: product.id, width: 'narrow', padding: 'small' })] : []),
    newBlock('button', { label: 'Buy now & save', href: '#offer', style: 'wide', note: 'In stock · 90-day money-back guarantee' }),
    newBlock('guarantee', { days: 90, headline: 'Feel the difference or it is free', text: 'If it is not what you hoped within 90 days, we refund you in full. No hassle, no questions.', width: 'narrow', padding: 'small' }),
    newBlock('faq', { headline: '', items: 'How does it work?|The mechanism, in three sentences.\nWhen will I see results?|First days, first weeks, ongoing.\nWho is it for?|Say who, and who should skip it.\nHow long until I get it?|Ships in one to three days; delivered in five to nine.', width: 'narrow', padding: 'small' }),
    newBlock('headline', { level: 'h2', text: 'This is not a life sentence. You just have not found the right support yet.', width: 'narrow' }),
    newBlock('rich-text', { text: 'The problem, in the reader\'s words. What they have tried. Why each one failed.' }),
    newBlock('image-grid', { headline: 'If this has become the worst part of your day, you are not imagining it', sub: 'The moments customers described to us before they found it.', items: '|By mid-afternoon it turns into a deep ache.\n|Long drives leave it on fire.\n|Getting up takes a brace and a deep breath.\n|You shift and shift and never get comfortable.', perRow: 4, bridge: 'Here is what nobody told you: it was never you. It is the gap the usual fix leaves.' }),
    newBlock('alternatives', {}),
    newBlock('stats', { headline: 'What customers reported', source: 'Results from a voluntary, self-reported survey; say when and how many. Delete if you have none.' }),
    newBlock('cost-comparison', { headline: 'One thing, instead of all of this' }),
    newBlock('testimonials', { headline: 'Why it is loved daily' }),
    newBlock('trust-badges', { items: '✓|Whole, named ingredients\n✓|Made in a registered facility\n✓|Third-party tested\n✓|Nothing artificial', padding: 'small' }),
    newBlock('timeline', { headline: 'What to expect from consistent use' }),
    newBlock('audience', {}),
    ...comparisonFrom(input),
    newBlock('how-it-works', { headline: 'How to use it' }),
    newBlock('value-stack', { eyebrow: 'Special offer on now', headline: 'Act now and you get' }),
    newBlock('expert-quote', { headline: 'Reviewed by a professional' }),
    newBlock('payment-icons', {}),
    newBlock('review-wall', { headline: 'What customers say', histogram: true, count: 8, ...(product ? { productId: product.id } : {}) }),
    product ? newBlock('buy-box', { productId: product.id, buyNow: true, background: 'raise', bullets: (triggers.length >= 3 ? triggers.slice(0, 4) : ['It works from the first use', 'Nothing to learn', 'Made properly']).map((line) => `${line}|`).join('\n'), offerLabel: 'Limited time offer', cta: 'Buy now & save', chips: '🚚|Free shipping\n⛨|90-day money-back guarantee\n🔒|Secure checkout', guaranteeHeadline: 'Feel the difference or it is free', guaranteeText: 'Use it every day for 90 days. If it is not what you hoped, email us and we refund every penny.' }) : newBlock('offer-box', {}),
    faqFrom(input, 'Frequently asked questions'),
    newBlock('sticky-cta', { label: 'Buy now & save', href: '#offer', ...(product ? { productId: product.id } : {}) }),
    newBlock('footer', {}),
  ]
}

/** The single-product home page: the promise, the press, the film, two benefits, the numbers, the catalog, the proof, the list. */
export function homeTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  return [
    newBlock('announcement-bar', {}),
    newBlock('header', { showNav: true }),
    newBlock('hero', { headline: 'People do not believe it. Until they try it.', sub: product?.subtitle ?? input.storeName, image: product?.image ?? '', cta: 'Shop now', ctaHref: product ? `/products/${product.id}` : '/collections/all', height: 'large' }),
    newBlock('logos', {}),
    newBlock('video', { url: '', caption: 'Thirty seconds of it being used.' }),
    ...(product ? [newBlock('image-with-text', { image: product.image, headline: 'The first thing it fixes', text: 'One benefit, one picture, one line of proof.' })] : []),
    ...(product ? [newBlock('image-with-text', { image: product.image, imageSide: 'right', headline: 'The second thing it fixes', text: 'One benefit, one picture, one line of proof.' })] : []),
    newBlock('stats', { headline: 'The one that pays for itself' }),
    newBlock('featured-products', { headline: 'What we make' }),
    newBlock('review-wall', { count: 6 }),
    newBlock('email-signup', { headline: 'Get the next drop first', text: 'No spam. Offers and news only.' }),
    newBlock('footer', {}),
  ]
}

/**
 * The funnel checkout, the way Funnelish and Checkout Champ lay one out: logo
 * and a secure line, the steps, a reservation timer, the form with the summary
 * beside it and the bump before payment, then the reasons to finish — the
 * guarantee, what buyers said, the marks that say this is a real shop.
 */
export function checkoutTemplate(input: TemplateInput): BlockInstance[] {
  const product = input.product
  return [
    newBlock('header', { cta: '', showNav: false }),
    newBlock('checkout-steps', { steps: 'Cart\nInformation\nPayment', current: 2 }),
    newBlock('countdown', { text: 'Limited stock: your cart is reserved for', minutes: 10, padding: 'small' }),
    newBlock('rating-strip', { text: 'Rated {rating}/5 by {count}+ verified buyers', ...(product ? { productId: product.id } : {}) }),
    ...(product ? [newBlock('delivery-estimate', { productId: product.id, width: 'narrow', padding: 'small' })] : []),
    newBlock('checkout-form', { layout: 'two-column', showBump: true, buttonLabel: 'Complete order', note: '🔒 Secure 256-bit encrypted checkout · Try it risk-free with the money-back guarantee' }),
    newBlock('guarantee', { padding: 'small', width: 'narrow' }),
    newBlock('trust-badges', { items: '🔒|SSL secure payment\n↩|Money-back guarantee\n🚚|Tracked shipping\n💬|Real people on support', padding: 'small' }),
    newBlock('review-wall', { headline: 'Trusted customer reviews', count: 3, ...(product ? { productId: product.id } : {}) }),
    newBlock('multicolumn', { headline: 'Why choose us', columns: '✓|Money-back guarantee|Say the days and the terms.\n✓|Orders shipped|Say the real count, or delete.', perRow: 2, width: 'narrow' }),
    faqFrom(input, 'Questions before you pay'),
    newBlock('payment-icons', {}),
    newBlock('footer', {}),
  ]
}

/* ------------------------------------------------------ the template list */

export type PageTemplate = {
  key: string
  name: string
  /** One line for the picker: what the page is for and where it came from. */
  description: string
  kind: Page['kind']
  role: Page['role']
  title: (input: TemplateInput) => string
  build: (input: TemplateInput) => BlockInstance[]
}

/** Every template the picker, the assistant's `create_page` tool and the seed can start from. */
export const PAGE_TEMPLATES: PageTemplate[] = [
  { key: 'offer', name: 'Offer page', description: 'The funnel landing page, in the order that turned 1.18x into 3.59x.', kind: 'landing', role: 'page', title: (input) => `${input.product?.title ?? input.storeName} — save today`, build: offerTemplate },
  { key: 'sales', name: 'Long-form sales page', description: 'The Checkout Champ sales page: gallery and a customer above the headline, check bullets, delivery date, guarantee, then the long argument — numbers, what it replaces, timeline, comparison, value stack, the doctor, reviews.', kind: 'landing', role: 'page', title: (input) => `${input.product?.title ?? input.storeName} — the full story`, build: salesTemplate },
  { key: 'product', name: 'Product page', description: 'The Shopify-style product page as blocks: rating, buy box with the bundle, trust and delivery, benefits with pictures, steps, specs, comparison, an expert, reviews with the star breakdown, questions.', kind: 'product', role: 'page', title: (input) => input.product?.title ?? `${input.storeName} — product page`, build: productTemplate },
  { key: 'science', name: 'Science page', description: 'The mechanism, the evidence, the offer: numbers, how it works, the studies, what to expect, video reviews, a note from the designer, the value stack.', kind: 'landing', role: 'page', title: (input) => `The science behind ${input.product?.title ?? input.storeName}`, build: scienceTemplate },
  { key: 'story', name: 'Story landing page', description: 'A first-person headline, the pain in pictures, the real cause, the product as the answer, relief hour by hour, a letter from the specialist, the offer with a deadline.', kind: 'landing', role: 'page', title: (input) => `${input.product?.title ?? input.storeName} — the one that finally worked`, build: storyTemplate },
  { key: 'advertorial', name: 'Advertorial (listicle)', description: 'Publication bar, numbered reasons, proof, the offer after the reader has learned something.', kind: 'advertorial', role: 'page', title: (input) => `Why people are switching to ${input.product?.title ?? input.storeName}`, build: advertorialTemplate },
  { key: 'quiz', name: 'Quiz funnel', description: 'One question per screen; the result names the buyer and shows the offer.', kind: 'landing', role: 'page', title: (input) => `Find your ${input.product?.title ?? 'fit'}`, build: quizTemplate },
  { key: 'landing', name: 'Product landing page', description: 'Banner, benefits, the bundle, proof, questions.', kind: 'landing', role: 'page', title: (input) => `${input.product?.title ?? input.storeName} — offer`, build: landingTemplate },
  { key: 'home', name: 'Home page', description: 'The single-product home: the promise, the press, the film, two benefits, the numbers, the catalog, the proof, the list. Tick "Home page" in the editor to make it the front door.', kind: 'landing', role: 'page', title: (input) => `${input.storeName} — home`, build: homeTemplate },
  { key: 'checkout', name: 'Checkout page', description: 'The real checkout form laid out with blocks: steps, a timer, the rating, the delivery date, the bump, the guarantee and proof around it. Publish it and /checkout uses it.', kind: 'checkout', role: 'checkout', title: (input) => `${input.storeName} — checkout`, build: checkoutTemplate },
  { key: 'blank', name: 'Blank', description: 'A header, a headline, a paragraph, a footer.', kind: 'landing', role: 'page', title: () => 'New page', build: () => blankTemplate() },
]

export function pageTemplate(key: string): PageTemplate {
  return PAGE_TEMPLATES.find((template) => template.key === key) ?? (PAGE_TEMPLATES.find((template) => template.key === 'blank') as PageTemplate)
}

/* ------------------------------------------------------------- rendering */

export function blockContextFor(db: Db, store: Store, base: string, localized?: { currency: string; exchangeRate: number; locale?: string }): BlockContext {
  const rawProducts = listProducts(db, store.id, { status: 'published', limit: 60 })
  const rate = minorUnitRate(localized, store.currency)
  const products = rawProducts.map((product) => ({
    ...product,
    variants: product.variants.map((variant) => ({
      ...variant,
      priceCents: Math.round(variant.priceCents * rate),
      compareAtCents: variant.compareAtCents === null ? null : Math.round(variant.compareAtCents * rate),
    })),
  }))
  const currency = localized?.currency ?? store.currency
  return {
    storeName: store.name,
    base,
    currency,
    brand: store.brand,
    custom: customDefinitions(db, store.id),
    products: products.map((product) => ({
      id: product.id,
      handle: product.handle,
      title: product.title,
      subtitle: product.subtitle,
      image: product.heroImage,
      media: productGalleryMedia(product),
      priceCents: Math.min(...product.variants.map((variant) => variant.priceCents)),
      variants: product.variants.map((variant) => ({ id: variant.id, title: variant.title, priceCents: variant.priceCents })),
      options: product.options,
    })),
    reviews: listReviews(db, store.id, { status: 'approved', limit: 60 }).map((review) => ({ productId: review.productId, rating: review.rating, title: review.title, body: review.body, author: review.author, verified: review.verified, media: review.media })),
    live: {
      purchases: recentPurchases(db, store.id, 10),
      viewers: Object.fromEntries(products.map((product) => [product.id, viewersNow(db, store.id, product.id)])),
      stock: Object.fromEntries(products.map((product) => [product.id, product.variants.reduce((sum, variant) => sum + Math.max(0, variant.inventory), 0)])),
      estimates: Object.fromEntries(products.map((product) => { const estimate = deliveryEstimate(product.supplier); return [product.id, { from: estimate.from, to: estimate.to }] })),
      questions: listQuestions(db, store.id, { status: 'answered' }).map((entry) => ({ productId: entry.productId, question: entry.question, answer: entry.answer, asker: entry.asker })),
      sizeCharts: Object.fromEntries(products.filter((product) => product.metadata.sizeChart).map((product) => [product.id, product.metadata.sizeChart as string])),
    },
    bundles: products
      .map((product) => {
        const bundle = bundleFor(db, store.id, product.id)
        return bundle ? { productId: product.id, html: renderBundleWidget({ ...bundle, tiers: bundle.tiers.map(tier => ({ ...tier, ...(tier.unitPriceCents!==undefined?{unitPriceCents: Math.round(tier.unitPriceCents * rate)}:{}), ...(tier.totalPriceCents!==undefined?{totalPriceCents:Math.round(tier.totalPriceCents*rate)}:{}), ...(tier.compareAtTotalCents !== undefined ? { compareAtTotalCents: Math.round(tier.compareAtTotalCents * rate) } : {}) })) }, product, currency, { locale: localized?.locale }) } : null
      })
      .filter((entry): entry is { productId: string; html: string } => entry !== null),
  }
}

/** The blocks, the runtime, and the script of every custom block the page uses, once each. */
export function renderPageBody(page: Page, context: BlockContext): string {
  const used = new Set(page.blocks.map((block) => block.type))
  const scripts = (context.custom ?? []).filter((definition) => definition.js && used.has(definition.type)).map((definition) => `<script data-custom-js="${definition.type}">(function(){\n${inlineScript(definition.js)}\n})();</script>`)
  return `${renderBlocks(page.blocks, context)}<script>${BLOCK_RUNTIME}</script>${scripts.join('')}`
}

export { BLOCK_RUNTIME }

/** Styles the blocks need on top of the theme. Tokens come from the theme; nothing here hard-codes a colour. */
export const PAGE_CSS = `
.blk-font{font-family:var(--block-font,var(--body))}.blk-font h1,.blk-font h2,.blk-font h3,.blk-font .name,.blk-font .word,.blk-font .title{font-family:var(--block-display,var(--display))}
.blk{padding-block:var(--pad)}
.pad-none{--pad:0}.pad-small{--pad:1.4rem}.pad-medium{--pad:3.2rem}.pad-large{--pad:5.5rem}
.blk-in{margin-inline:auto;width:min(92vw,var(--w))}
.w-narrow{--w:720px}.w-regular{--w:1080px}.w-wide{--w:1320px}.w-full{--w:100%}.w-full .blk-in{width:100%}
.al-center{text-align:center}.al-center .prose,.al-center p{margin-inline:auto}
.bg-paper{background:var(--paper)}.bg-raise{background:var(--raise)}
.bg-ink{background:var(--ink);color:var(--paper)}.bg-ink .eyebrow,.bg-ink .micro{color:color-mix(in srgb,var(--paper) 70%,transparent)}
.bg-primary{background:var(--primary);color:#fff}.bg-primary .eyebrow{color:rgba(255,255,255,.7)}
.head{margin:0 0 .6rem}.lead{font-size:1.1rem;color:var(--muted);max-width:60ch}
.eyebrow.light{color:rgba(255,255,255,.8)}
.hero--small{min-height:42vh}.hero--medium{min-height:62vh}.hero--large{min-height:82vh}
.hero::after{background:linear-gradient(to bottom,rgba(0,0,0,calc(var(--overlay,.45) * .7)),rgba(0,0,0,var(--overlay,.45)))}
.hero .ctas{display:flex;gap:.6rem;justify-content:center;flex-wrap:wrap;margin-top:1.4rem}
.hero .btn--ghost{color:#fff;border-color:#fff}
.rule{border:0;border-top:1px solid var(--line);margin:0}
.fig{margin:0}.fig img{width:100%;border-radius:var(--radius)}.fig figcaption{font-size:.8rem;color:var(--muted);margin-top:.5rem}
.ph{border:1px dashed var(--line);border-radius:var(--radius);padding:2rem;text-align:center;color:var(--muted);font-size:.9rem}
.iwt{display:grid;gap:2.5rem;grid-template-columns:1fr 1fr;align-items:center}
.iwt--right figure{order:2}.iwt figure{margin:0}.iwt img{width:100%;border-radius:var(--radius)}
.video{position:relative;aspect-ratio:16/9;background:#000;border-radius:var(--radius);overflow:hidden;cursor:pointer}
.video img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.85}
.video .play{position:absolute;inset:0;margin:auto;width:72px;height:72px;border-radius:999px;border:0;background:#fff;font-size:1.4rem;cursor:pointer}
.video iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
video.video{width:100%;height:auto;aspect-ratio:auto}
.carousel{display:flex;gap:1rem;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:.5rem}
.carousel img{flex:0 0 min(78vw,420px);aspect-ratio:4/5;object-fit:cover;border-radius:var(--radius);scroll-snap-align:start}
.ba{position:relative;aspect-ratio:4/3;border-radius:var(--radius);overflow:hidden}
.ba img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
.ba .after{clip-path:inset(0 0 0 var(--pos))}
.ba input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize;margin:0}
.ba .lbl{position:absolute;bottom:.7rem;font:600 11px/1 var(--body);letter-spacing:.14em;text-transform:uppercase;background:rgba(0,0,0,.55);color:#fff;padding:.4rem .6rem;border-radius:999px}
.ba .lbl.l{left:.7rem}.ba .lbl.r{right:.7rem}
.cols>.col{min-width:0;overflow-wrap:anywhere}.cols{display:grid;gap:1.6rem;grid-template-columns:var(--cols-desktop,repeat(var(--per,3),minmax(0,1fr)));margin-top:1.4rem}
.col .ico{font-size:1.6rem;color:var(--primary)}.col h3{margin:.5rem 0 .3rem}.col p{color:var(--muted);font-size:.94rem;margin:0}
.buybox-blk{display:grid;gap:2.5rem;grid-template-columns:1fr 1fr;align-items:start}
.buybox-blk figure{margin:0}.buybox-blk img{width:100%;border-radius:var(--radius)}
.buybox-blk h2{font-size:clamp(1.8rem,3.6vw,2.6rem)}
.buyform{display:grid;gap:.8rem;margin-top:1rem}
.logos{display:flex;flex-wrap:wrap;gap:1.2rem 2.4rem;justify-content:center;margin-top:1rem;font-family:var(--display);font-size:1.15rem;color:var(--muted);letter-spacing:.02em}
.badges{display:flex;flex-wrap:wrap;gap:.8rem 1.6rem;justify-content:center;font-size:.86rem;color:var(--muted)}
.badges i{font-style:normal;margin-right:.4rem}
.comments{display:grid;gap:1rem}
.comment{display:flex;gap:.8rem}.comment .av,.byline .av{flex:0 0 auto;width:36px;height:36px;border-radius:999px;background:var(--primary);color:#fff;display:grid;place-items:center;font-weight:600}
.comment .meta{font-size:.82rem;color:var(--muted)}.comment p{margin:.2rem 0 0;font-size:.94rem}
.countdown{display:inline-flex;gap:1rem;align-items:center;border:1px solid var(--line);border-radius:var(--radius);padding:.8rem 1.2rem;background:var(--raise)}
.countdown .lbl{font-size:.86rem;color:var(--muted)}.countdown .clock{font-family:var(--display);font-size:1.6rem;font-variant-numeric:tabular-nums}
.progress .meta{font-size:.86rem;margin-bottom:.4rem}.progress .track{height:10px;background:var(--line);border-radius:999px;overflow:hidden}.progress .fill{height:100%;background:var(--primary)}
.offer{border:2px solid var(--primary);border-radius:var(--radius);padding:1.8rem;background:var(--raise);max-width:32rem;margin-inline:auto}
.offer ul{padding-left:1.1rem;margin:.8rem 0}.offer li{margin:.25rem 0}
.pubbar{background:var(--ink);color:var(--paper);font:500 11px/1 var(--body);letter-spacing:.14em;text-transform:uppercase}
.pubbar .wrap{display:flex;gap:1.2rem;align-items:center;padding:.7rem 0}.pubbar .pub{font-family:var(--display);font-size:1rem;letter-spacing:.04em;text-transform:none}
.pubbar .sec{opacity:.7}.pubbar .adv{margin-left:auto;opacity:.6;border:1px solid currentColor;padding:.25rem .5rem;border-radius:999px}
.byline{display:flex;gap:.8rem;align-items:center}
.reason .num{font-family:var(--display);font-size:3rem;line-height:1;color:var(--primary)}
.reason h2{margin:.2rem 0 .8rem}.reason .fig{margin:1rem 0}
blockquote.pull{font-family:var(--display);font-size:clamp(1.4rem,2.6vw,2rem);line-height:1.25;margin:0;padding-left:1.2rem;border-left:3px solid var(--primary)}
blockquote.pull cite{display:block;font:400 .9rem var(--body);color:var(--muted);margin-top:.6rem;font-style:normal}
.disclaimer{opacity:.8}
.share{display:flex;gap:1rem;align-items:center}.share a{font-size:.86rem;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:.35rem .8rem}
.signup{display:flex;gap:.6rem;max-width:28rem;margin-inline:auto;margin-top:1rem}
.contact .two{margin-bottom:0}
.announce--rotate span{display:inline-block}
.salespop{position:fixed;bottom:1rem;left:1rem;z-index:60;display:flex;gap:.7rem;align-items:center;background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:var(--radius);padding:.6rem .8rem;box-shadow:0 10px 30px rgba(0,0,0,.14);max-width:320px;font-size:.85rem}
.salespop--bottom-right{left:auto;right:1rem}.salespop img{width:44px;height:44px;object-fit:cover;border-radius:var(--radius)}.salespop b{display:block}.salespop small{color:var(--muted);display:block;font-size:.72rem}
.viewers{display:inline-flex;gap:.5rem;align-items:center;font-size:.86rem;color:var(--muted)}.viewers i{width:8px;height:8px;border-radius:999px;background:#2f7a4f;box-shadow:0 0 0 4px rgba(47,122,79,.18)}
.scarcity .meta{font-size:.86rem;margin-bottom:.35rem}.scarcity .track{height:8px;background:var(--line);border-radius:999px;overflow:hidden}.scarcity .fill{height:100%;background:#b3261e}
.edd{display:flex;gap:.7rem;align-items:center;font-size:.9rem;border:1px solid var(--line);border-radius:var(--radius);padding:.7rem .9rem;background:var(--raise)}.edd .ico{font-size:1.2rem}
.shipbar{background:var(--ink);color:var(--paper);font-size:.8rem;text-align:center;padding:.5rem 1rem}.shipbar .track{display:block;height:3px;background:rgba(255,255,255,.2);margin-top:.35rem;border-radius:999px;overflow:hidden}.shipbar .fill{display:block;height:100%;background:var(--primary)}
.payicons{display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center}.payicons i{font:600 10px/1 var(--body);letter-spacing:.06em;border:1px solid var(--line);border-radius:4px;padding:.4rem .5rem;background:#fff;color:#1a1a1a;font-style:normal}
.sizechart summary{cursor:pointer;font-weight:500;padding:.6rem 0;border-bottom:1px solid var(--line)}
.ugc{display:grid;gap:.6rem;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}.ugc figure{margin:0}.ugc img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius)}.ugc figcaption{font-size:.75rem;color:var(--muted);margin-top:.25rem}
.qa-form{display:grid;gap:.5rem;margin-top:1rem}
.quiz{text-align:center}.qprogress{height:6px;background:var(--line);border-radius:999px;overflow:hidden;margin:.8rem auto 1.4rem;max-width:22rem}.qprogress span{display:block;height:100%;background:var(--primary);transition:width .3s}
.qstep{border:0;padding:0;margin:0}.qstep legend{margin-inline:auto}.qopts{display:grid;gap:.6rem;max-width:26rem;margin:1rem auto 0}
.qopt{border:1px solid var(--line);background:var(--raise);color:var(--ink);border-radius:var(--radius);padding:.9rem 1rem;font:inherit;cursor:pointer;text-align:left}.qopt:hover{border-color:var(--primary)}
.qresult .qproduct{display:flex;gap:1rem;align-items:center;justify-content:center;text-align:left;margin:1rem 0}.qresult .qproduct img{width:96px;height:96px;object-fit:cover;border-radius:var(--radius)}
.checks{list-style:none;padding:0;margin:.8rem 0;display:grid;gap:.45rem}.checks li{display:flex;gap:.6rem;align-items:flex-start}.checks i{font-style:normal;color:var(--primary);font-weight:700;flex:0 0 auto}
.offer-label{display:inline-block;font:600 11px/1 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--primary);border:1px solid var(--primary);border-radius:999px;padding:.35rem .6rem;margin:.6rem 0 .2rem}
.shipline{display:flex;gap:.5rem;align-items:center;font-size:.9rem;margin:0}.shipline .dot{width:9px;height:9px;border-radius:999px;background:#2f7a4f;box-shadow:0 0 0 3px rgba(47,122,79,.18)}
.chips{margin-top:.8rem;justify-content:flex-start}
.guarantee-inline{display:flex;gap:.8rem;align-items:flex-start;margin-top:1rem;border:1px solid var(--line);border-radius:var(--radius);padding:.8rem 1rem;background:var(--raise)}.guarantee-inline i{font-style:normal;font-size:1.4rem;color:var(--primary)}.guarantee-inline p{margin:.2rem 0 0;font-size:.9rem;color:var(--muted)}
.rating a{text-decoration:none;color:inherit}
.sticky-product{display:flex;gap:.6rem;align-items:center;min-width:0}.sticky-product img{width:40px;height:40px;object-fit:cover;border-radius:var(--radius)}.sticky-product b{display:block;font-size:.9rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.scenes .scene{margin:0}.scene img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius)}.scene figcaption{font-size:.9rem;margin-top:.5rem}.bridge{font-family:var(--display);font-size:1.25rem;margin-top:1.4rem}
.alts{margin:1rem 0 0;display:grid;gap:.9rem}.alts dt{font-weight:600}.alts dd{margin:.15rem 0 0;color:var(--muted)}
.included{list-style:none;padding:0;margin:1rem 0 .4rem;display:grid;gap:.5rem}.included li{display:flex;gap:.7rem;align-items:center;border:1px solid var(--line);border-radius:var(--radius);padding:.55rem .8rem;background:var(--raise)}.included img{width:40px;height:40px;object-fit:cover;border-radius:var(--radius)}.included i{font-style:normal}.included span{flex:1}.included em{font-style:normal;font-weight:600;color:var(--primary);font-size:.85rem}.included em s{color:var(--muted);font-weight:400}
.press{display:grid;gap:1.2rem;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:1rem}.press blockquote{margin:0;border:1px solid var(--line);border-radius:var(--radius);padding:1rem 1.1rem;background:var(--raise)}.press p{margin:0 0 .5rem;font-family:var(--display);font-size:1.05rem}.press cite{font-style:normal;font-size:.8rem;color:var(--muted);letter-spacing:.08em;text-transform:uppercase}
.ingredients img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius);margin-bottom:.5rem}
.ratingline{display:inline-flex;gap:.5rem;align-items:center;text-decoration:none;color:var(--ink);font-size:.92rem}.ratingline .stars{color:#e0a100}
.histo{display:grid;gap:.3rem;max-width:22rem;margin:.6rem 0 1rem;font-size:.82rem;color:var(--muted)}.histo div{display:grid;grid-template-columns:2.4rem 1fr 2.6rem;gap:.5rem;align-items:center}.histo i{display:block;height:8px;background:var(--line);border-radius:999px;overflow:hidden}.histo b{display:block;height:100%;background:#e0a100}
.stats{display:grid;gap:1.2rem;grid-template-columns:repeat(var(--per,3),1fr);margin-top:1rem}.stat b{display:block;font-family:var(--display);font-size:clamp(2rem,4.5vw,3rem);line-height:1;color:var(--primary)}.stat span{display:block;margin-top:.4rem;color:var(--muted);font-size:.92rem}
.tl{list-style:none;padding:0;margin:0;display:grid;gap:0}.tl li{display:grid;grid-template-columns:7rem 1fr;gap:1rem;padding:.9rem 0;border-bottom:1px solid var(--line)}.tl .when{font:600 11px/1.6 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--primary)}.tl p{margin:.2rem 0 0;color:var(--muted);font-size:.94rem}
.hiw{display:grid;gap:1.6rem;grid-template-columns:repeat(var(--per,3),1fr);margin-top:1.2rem}.hiw-step{position:relative}.hiw-step img{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:var(--radius);margin-bottom:.8rem}.hiw-step .num{display:inline-grid;place-items:center;width:32px;height:32px;border-radius:999px;background:var(--primary);color:#fff;font-weight:600;font-size:.9rem}.hiw-step h3{margin:.5rem 0 .3rem}.hiw-step p{margin:0;color:var(--muted);font-size:.94rem}
.vstack{border:2px solid var(--primary);border-radius:var(--radius);padding:1.8rem;background:var(--raise)}.vstack ul{list-style:none;padding:0;margin:1rem 0}.vstack li{display:flex;justify-content:space-between;gap:1rem;padding:.5rem 0;border-bottom:1px solid var(--line)}.vstack li b{color:var(--muted);font-weight:500;white-space:nowrap}
.vtotal,.vprice{display:flex;justify-content:space-between;align-items:baseline;gap:1rem;padding:.5rem 0}.vtotal s{color:var(--muted)}.vprice b{font-family:var(--display);font-size:2rem;color:var(--primary)}
.experts{display:grid;gap:1.2rem;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))}.expert{border:1px solid var(--line);border-radius:var(--radius);padding:1.2rem;background:var(--raise)}.expert img,.expert .av{width:56px;height:56px;border-radius:999px;object-fit:cover;display:grid;place-items:center;background:var(--primary);color:#fff;font-weight:600;margin-bottom:.8rem}.expert blockquote{margin:0;font-size:1.02rem}.expert .who{margin-top:.8rem;font-size:.85rem}.expert .who span{display:block;color:var(--muted)}
.letter{display:grid;gap:1.6rem;grid-template-columns:auto 1fr;align-items:start}.letter img{width:120px;height:120px;border-radius:999px;object-fit:cover}.letter .sig{margin-top:1rem;font-family:var(--display);font-size:1.2rem}.letter .sig span{display:block;font:400 .85rem var(--body);color:var(--muted)}
.costs{display:grid;gap:0;border:1px solid var(--line);border-radius:var(--radius);overflow:hidden}.costs div{display:flex;justify-content:space-between;gap:1rem;padding:.7rem 1rem;border-bottom:1px solid var(--line);font-size:.94rem}.costs div:last-child{border-bottom:0}.costs .total{background:var(--raise);font-weight:600}.costs .us{background:color-mix(in srgb,var(--primary) 10%,var(--paper));color:var(--primary);font-weight:600}
.vwall{display:grid;gap:1rem;grid-template-columns:repeat(var(--per,3),1fr);margin-top:1rem}.vwall figure{margin:0}.vwall .video{aspect-ratio:9/16}.vwall video.video{aspect-ratio:auto}
.studies{padding-left:1.2rem;margin:0}.studies li{padding:.8rem 0;border-bottom:1px solid var(--line)}.studies .src{font:600 11px/1.6 var(--body);letter-spacing:.14em;text-transform:uppercase;color:var(--muted)}.studies p{margin:.3rem 0}.studies a{font-size:.85rem}
.gal .gal-main{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--radius)}.gal-thumbs{display:flex;gap:.5rem;margin-top:.6rem;overflow-x:auto}.gal-thumbs button{flex:0 0 64px;padding:0;border:2px solid transparent;border-radius:var(--radius);background:none;cursor:pointer}.gal-thumbs button.on{border-color:var(--ink)}.gal-thumbs img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:calc(var(--radius) - 2px);display:block}
.col .ico img{width:56px;height:56px;object-fit:cover;border-radius:var(--radius)}
.checkout--blk{min-height:0;gap:2rem}
.checkout--blk .co-main{padding:0;max-width:none;justify-self:stretch}
.checkout--blk .co-side{height:auto;max-height:calc(100vh - 2rem);top:1rem;border:1px solid var(--line);border-radius:var(--radius);padding:1.4rem}
.checkout--stacked{grid-template-columns:1fr}
.co-h{font-family:var(--body);font-weight:600;font-size:1.05rem;margin:0 0 .8rem}
.co-sample{border:1px dashed var(--line);border-radius:var(--radius);padding:.5rem .8rem;margin-bottom:1rem}
.co-summary-blk{border:1px solid var(--line);border-radius:var(--radius);padding:1.2rem;background:var(--raise)}
.bump-blk .bump{margin-top:.6rem}
.costeps{display:flex;gap:.4rem;justify-content:center;list-style:none;padding:0;margin:0;font-size:.85rem;color:var(--muted);flex-wrap:wrap}
.al-left .costeps{justify-content:flex-start}
.costeps li{display:flex;align-items:center;gap:.4rem}.costeps li+li::before{content:'›';margin-right:.4rem;opacity:.5}
.costeps span{width:22px;height:22px;border-radius:999px;border:1px solid var(--line);display:grid;place-items:center;font-size:.72rem;font-weight:600}
.costeps .now{color:var(--ink);font-weight:600}.costeps .now span,.costeps .done span{background:var(--primary);color:#fff;border-color:var(--primary)}
@media (max-width:820px){.iwt,.buybox-blk{grid-template-columns:1fr}.iwt--right figure{order:0}.cols{grid-template-columns:var(--cols-tablet,repeat(2,minmax(0,1fr)))}.hiw,.vwall{grid-template-columns:repeat(2,1fr)}.stats{grid-template-columns:repeat(2,1fr)}.salespop{max-width:calc(100vw - 2rem)}.letter{grid-template-columns:1fr}}
@media (max-width:520px){.cols{grid-template-columns:var(--cols-mobile,minmax(0,1fr))}.hiw{grid-template-columns:1fr}.tl li{grid-template-columns:1fr;gap:.2rem}}
`
