import type { Db } from '../lib/db.ts'
import { logger } from '../lib/log.ts'
import type { Store } from '../control/stores.ts'
import { getProduct } from '../domain/catalog.ts'
import { extractAngle, realFetcher, type CompetitorAngle, type Fetcher } from '../agent/angles.ts'
import { readBrief } from '../agent/copy.ts'
import { authorBlocks, type Format } from '../agent/directions.ts'
import { directionFor, getAvatar, listAvatars } from '../agent/avatars.ts'
import { modelFor, type ModelChoice } from '../agent/models.ts'
import { latestResearch, rulesResearch } from '../agent/research.ts'
import { latestDoc, type MarketAnalysis } from '../agent/market.ts'
import type { BlockInstance } from './blocks.ts'
import { createPage, newBlock, type Page } from './store.ts'

const log = logger('rip')

/**
 * The funnel rip.
 *
 * A page that sells is read for its shape: which sections it has, in what
 * order, and what job each one does. That shape comes back as a block
 * outline the owner's own product fills. Two things never come across: the
 * words (every text setting is a placeholder that says what the section did,
 * and the rewrite is told not to reuse a phrase) and the images (each one
 * becomes a photo brief describing the shot, so the owner's product is
 * photographed the same way, not pasted over someone else's picture).
 *
 * With the angle kept, the rewrite sells the same reason to buy in new
 * words; without it, the direction the owner picked replaces it.
 */
export type RipSection = { type: string; job: string; text: string; imageBrief?: string }

export type RipResult = {
  sourceUrl: string
  title: string
  angle: CompetitorAngle
  sections: RipSection[]
  blocks: BlockInstance[]
  imageBriefs: string[]
  notes: string[]
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/** The outline of a page: what each part is for, in order, with none of its words kept. */
export function outlinePage(html: string): { sections: RipSection[]; imageBriefs: string[] } {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  const cleaned = body.replace(/<(script|style|noscript|svg|nav|iframe)\b[\s\S]*?<\/\1>/gi, '')
  const sections: RipSection[] = []
  const imageBriefs: string[] = []
  const pattern = /<(h1|h2|h3|p|blockquote|ul|ol|table|form|button|video)\b([^>]*)>([\s\S]*?)<\/\1>|<img\b([^>]*)\/?>/gi
  let match: RegExpExecArray | null
  let paragraphs: string[] = []
  let imageCount = 0
  const flush = () => {
    if (paragraphs.length) sections.push({ type: 'rich-text', job: paragraphs.length > 2 ? 'Explains: the story, the mechanism or the education' : 'A short lead paragraph', text: paragraphs.join(' ').slice(0, 400) })
    paragraphs = []
  }
  const describeImage = (attrs: string, nearby: string): string => {
    const alt = strip(/alt=["']([^"']*)/i.exec(attrs)?.[1] ?? '')
    const src = /src=["']([^"']+)/i.exec(attrs)?.[1] ?? ''
    const name = src.split('/').pop()?.split(/[?#]/)[0]?.replace(/[-_]/g, ' ').replace(/\.\w+$/, '') ?? ''
    const hint = alt || (name && !/^\d+$/.test(name) && name.length > 3 ? name : '')
    return `Photo ${++imageCount}: ${hint ? `the source showed "${hint.slice(0, 80)}"` : 'a product image'}${nearby ? `, placed under "${nearby.slice(0, 60)}"` : ''}. Shoot the same kind of shot with your product.`
  }
  let lastHeading = ''
  while ((match = pattern.exec(cleaned)) && sections.length < 120) {
    const tag = (match[1] ?? 'img').toLowerCase()
    const attrs = match[2] ?? match[4] ?? ''
    const inner = match[3] ?? ''
    const text = strip(inner)
    if (tag === 'img') {
      const src = /src=["']([^"']+)/i.exec(attrs)?.[1] ?? ''
      if (!src || /\.(svg)(\?|$)/i.test(src) || /logo|icon|sprite|pixel|badge|payment|flag/i.test(`${src} ${attrs}`)) continue
      flush()
      const brief = describeImage(attrs, lastHeading)
      imageBriefs.push(brief)
      sections.push({ type: 'image', job: 'Shows: a product photo the reader needs to see here', text: '', imageBrief: brief })
      continue
    }
    if (tag === 'video') { flush(); sections.push({ type: 'video', job: 'Shows: the product working', text: '' }); continue }
    if (!text || text.length < 3) continue
    if (tag === 'h1') { flush(); lastHeading = text; sections.push({ type: 'headline', job: 'The promise: the headline of the page', text: text.slice(0, 160) }); continue }
    if (tag === 'h2' || tag === 'h3') {
      flush()
      lastHeading = text
      const job = /\?$/.test(text) ? 'A question the reader has' : /guarantee|risk|refund/i.test(text) ? 'Removes the risk' : /how it works|works|why/i.test(text) ? 'Explains the mechanism' : /review|customer|love|people|say/i.test(text) ? 'Introduces proof' : /reason|#?\d+[.)]/i.test(text) ? 'One argument in a list of reasons' : 'A section heading'
      sections.push({ type: 'headline', job, text: text.slice(0, 160) })
      continue
    }
    if (tag === 'blockquote') { flush(); sections.push({ type: 'pull-quote', job: 'Proof: a quote from a customer or an expert', text: text.slice(0, 200) }); continue }
    if (tag === 'ul' || tag === 'ol') {
      flush()
      const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => strip(item[1] ?? '')).filter((item) => item.length > 2 && item.length < 160)
      if (items.length >= 2 && items.length <= 8) sections.push({ type: items.some((item) => item.includes('?')) ? 'faq' : 'multicolumn', job: items.some((item) => item.includes('?')) ? 'Answers the objections' : `Lists ${items.length} points: benefits, what is included, or reasons`, text: items.join(' | ').slice(0, 400) })
      continue
    }
    if (tag === 'table') { flush(); sections.push({ type: 'comparison', job: 'Compares against the alternative', text: text.slice(0, 200) }); continue }
    if (tag === 'form') { flush(); if (/email/i.test(inner)) sections.push({ type: 'email-signup', job: 'Collects an email', text: '' }); else if (/quantity|add to cart|buy|checkout|variant/i.test(inner)) sections.push({ type: 'buy-box', job: 'The offer: price, options, add to cart', text: '' }); continue }
    if (tag === 'button') { if (/buy|cart|order|get|claim|shop|add/i.test(text)) sections.push({ type: 'button', job: 'A call to action', text: text.slice(0, 60) }); continue }
    if (tag === 'p' && text.length > 20) paragraphs.push(text)
  }
  flush()
  const page = strip(cleaned)
  if (/\b(ends in|hours?|minutes?|seconds?)\b/i.test(page) && /\b(offer|sale|ends|expires)\b/i.test(page) && !sections.some((section) => section.type === 'countdown')) sections.unshift({ type: 'countdown', job: 'Urgency: a timer on the saving', text: '' })
  if (/\b(money[- ]back|guarantee)\b/i.test(page) && !sections.some((section) => section.type === 'guarantee')) sections.push({ type: 'guarantee', job: 'Removes the risk', text: '' })
  if (/★|stars?|reviews?\b/i.test(page) && !sections.some((section) => section.type === 'review-wall')) sections.push({ type: 'review-wall', job: 'Proof: reviews', text: '' })
  return { sections: dedupe(sections), imageBriefs }
}

function dedupe(sections: RipSection[]): RipSection[] {
  const out: RipSection[] = []
  for (const section of sections) {
    const previous = out[out.length - 1]
    if (previous && previous.type === section.type && previous.type !== 'image' && previous.type !== 'headline') continue
    out.push(section)
  }
  return out
}

/** The outline as blocks the owner's product fills: placeholders say what the section did; no image URL comes across. */
export function blocksFromOutline(sections: RipSection[], product: { id: string; title: string; image: string } | null, storeName: string): BlockInstance[] {
  const blocks: BlockInstance[] = [newBlock('header', { cta: 'Buy now', ctaHref: '#offer' })]
  let reasons = 0
  let hasBuyBox = false
  for (const section of sections) {
    switch (section.type) {
      case 'headline': {
        const level = blocks.some((block) => block.type === 'headline' && block.settings.level === 'h1') ? 'h2' : 'h1'
        if (section.job === 'One argument in a list of reasons') { blocks.push(newBlock('numbered-reason', { number: ++reasons, headline: `[Reason ${reasons}: ${section.job}]`, text: '[One argument, one concrete detail.]' })); break }
        blocks.push(newBlock('headline', { level, text: `[${section.job}]`, sub: level === 'h1' ? `[The sub-headline: what ${product?.title ?? 'the product'} does for the reader]` : '' }))
        break
      }
      case 'rich-text': blocks.push(newBlock('rich-text', { text: `[${section.job}. About ${Math.max(1, Math.round(section.text.length / 120))} short paragraphs.]` })); break
      case 'image': blocks.push(newBlock('image', { src: '', alt: section.imageBrief ?? 'Product photo', caption: '' })); break
      case 'video': blocks.push(newBlock('video', {})); break
      case 'pull-quote': blocks.push(newBlock('pull-quote', { quote: '[A real customer quote goes here once you have one]', who: '' })); break
      case 'multicolumn': blocks.push(newBlock('multicolumn', { headline: `[${section.job}]` })); break
      case 'faq': blocks.push(newBlock('faq', { headline: 'Before you decide' })); break
      case 'comparison': blocks.push(newBlock('comparison', {})); break
      case 'countdown': blocks.push(newBlock('countdown', { text: '[The saving, ending soon]' })); break
      case 'guarantee': blocks.push(newBlock('guarantee', {})); break
      case 'review-wall': blocks.push(newBlock('review-wall', { count: 6, ...(product ? { productId: product.id } : {}) })); break
      case 'email-signup': blocks.push(newBlock('email-signup', {})); break
      case 'buy-box':
      case 'button':
        if (hasBuyBox) { blocks.push(newBlock('button', { label: section.text.replace(/[^\w\s]/g, '').trim() ? `[${section.job}]` : 'Get yours', href: '#offer' })); break }
        hasBuyBox = true
        blocks.push(product ? newBlock('buy-box', { productId: product.id, buyNow: true, background: 'raise' }) : newBlock('offer-box', {}))
        break
      default: break
    }
  }
  if (!hasBuyBox) blocks.push(product ? newBlock('buy-box', { productId: product.id, buyNow: true, background: 'raise' }) : newBlock('offer-box', {}))
  blocks.push(newBlock('sticky-cta', { label: product ? `Get ${product.title}` : 'Get the offer', href: '#offer' }), newBlock('footer', {}))
  void storeName
  return blocks
}

const UA = 'Mozilla/5.0 (compatible; storemillRip/1.0)'

export async function ripFunnel(url: string, fetcher: Fetcher = realFetcher): Promise<Omit<RipResult, 'blocks'>> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error(`That page answered ${response.status}. Paste its HTML instead.`)
  return ripHtml(response.text, url)
}

export function ripHtml(html: string, url = ''): Omit<RipResult, 'blocks'> {
  const angle = extractAngle(html, url)
  const { sections, imageBriefs } = outlinePage(html)
  const title = strip(/<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1] ?? '') || angle.brand || 'Ripped page'
  const notes = [`${sections.length} sections and ${imageBriefs.length} images read. No copy and no image was kept; the outline is the shape, the briefs are the shots.`]
  if (!sections.some((section) => section.type === 'buy-box' || section.type === 'button')) notes.push('No buy box or button was found; one was added at the end.')
  void UA
  return { sourceUrl: url, title, angle, sections, imageBriefs, notes }
}

export type RipRequest = { url?: string; html?: string; productId: string; keepAngle: boolean; direction?: string; avatarId?: string; fetcher?: Fetcher; model?: ModelChoice | null }

/**
 * Reads the funnel, builds the outline for the owner's product, and writes
 * the words: in the source's angle when asked, in the owner's direction
 * otherwise. The page lands as a draft with the source URL on it.
 */
export async function ripToPage(db: Db, store: Store, request: RipRequest): Promise<{ page: Page; rip: RipResult; source: 'model' | 'rules' }> {
  const product = getProduct(db, store.id, request.productId)
  if (!product) throw new Error('Pick the product this page will sell')
  const read = request.html?.trim() ? ripHtml(request.html, request.url ?? '') : await ripFunnel(request.url ?? '', request.fetcher)
  const blocks = blocksFromOutline(read.sections, { id: product.id, title: product.title, image: product.heroImage }, store.name)
  const brief = readBrief(`${store.prompt} ${product.title}`)
  const research = latestResearch(db, store.id) ?? rulesResearch(brief)
  const avatar = request.avatarId ? getAvatar(db, store.id, request.avatarId) : listAvatars(db, store.id).find((entry) => entry.selected) ?? null
  const direction = directionFor(request.direction ?? '', avatar)
  const format: Format = { id: 'ripped', kind: 'pdp', name: 'Copied funnel structure', description: `The section order of ${read.sourceUrl || 'the pasted page'}, filled for ${product.title}.`, headline: ({ product: name }) => name }
  const choice = request.model === undefined ? modelFor(db, store.id, 'pages') : request.model
  const extra = request.keepAngle
    ? `The structure was copied from a competitor's page that ran this angle: ${read.angle.angle}${read.angle.headline ? ` — its headline promised "${read.angle.headline}"` : ''}${read.angle.audience ? `, aimed at ${read.angle.audience}` : ''}. Sell the SAME reason to buy for ${product.title}, but do not reuse any phrase, sentence or claim from the source; every word must be yours and every claim must be true of this product. Where a placeholder says [Reason N] or [Explains …], write that section for this product.`
    : `The structure was copied from a competitor's page; its angle is NOT to be used. Write every section for ${product.title} in the direction given above, reusing no phrase from any competitor, and replace every bracketed placeholder with real copy for this product.`
  const market = latestDoc<MarketAnalysis>(db, store.id, 'analysis')?.body ?? null
  const authored = await authorBlocks(choice, blocks, { product, store: { name: store.name, prompt: store.prompt }, research, brief, direction, format, market }, extra)
  const page = createPage(db, store.id, {
    title: `${product.title} — copied structure${request.keepAngle ? ` (${read.angle.angle} angle)` : ' (new angle)'}`,
    kind: 'landing',
    blocks: authored.blocks,
    status: 'draft',
    sourceUrl: read.sourceUrl,
    productId: product.id,
    role: 'pdp',
    format: 'ripped',
    direction: direction.raw,
  })
  log.info(`ripped ${read.sourceUrl || 'pasted html'} into ${page.id} (${authored.source})`)
  return { page, rip: { ...read, blocks: authored.blocks }, source: authored.source }
}
