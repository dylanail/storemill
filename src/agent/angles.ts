import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import { latestResearch, type Research } from './research.ts'
import { saveAvatar, listAvatars, angleFromWants } from './avatars.ts'
import { completeJson, describe, S, type ModelChoice } from './models.ts'
import { knowledge } from './knowledge.ts'

const log = logger('angles')

/**
 * Competitor angles.
 *
 * A dropshipper's first research step is someone else's page for the same
 * product: what they lead with, what they charge, what they promise, who they
 * say it is for. This reads such a page into a structured, editable record —
 * the headline, the hooks, the offer, the proof, the audience, the angle it is
 * running — and never treats any of it as settled. Every field is a form
 * input, because the point is to take what works and change what does not.
 *
 * Fetching is best effort: many sites block bots, and the merchant can paste
 * the page's HTML (or just its text) instead. The extraction is the same:
 * rules pull the obvious fields out of the markup, then a model reads the
 * page as a whole and writes the record properly when one is configured.
 */
export type AngleKind = 'problem-solution' | 'offer' | 'risk-reversal' | 'clinical' | 'social-proof' | 'comparison' | 'urgency' | 'premium' | 'story' | 'benefit'

export type CompetitorAngle = {
  brand: string
  url: string
  headline: string
  subheadline: string
  hooks: string[]
  benefits: string[]
  offer: { price: string; comparePrice: string; discount: string; shipping: string; guarantee: string; bundle: string }
  proof: { reviewCount: string; rating: string; badges: string[] }
  ctas: string[]
  audience: string
  angle: AngleKind
  images: string[]
  notes: string[]
  /** What to keep, in the merchant's words. Blank until they write it. */
  take: string
}

export type CompetitorRecord = CompetitorAngle & { id: string; productId: string; createdAt: string; updatedAt: string }

const ANGLE_RULES: Array<[AngleKind, RegExp]> = [
  ['urgency', /\b(only \d+ left|\d+ left in stock|selling fast|ends (tonight|today|soon)|limited (time|stock)|last chance|hurry|this week only|today only|\d+ (hours|days) left)\b/i],
  ['offer', /\b(\d{1,2}% off|save \$?\d+|buy \d+ get|bundle|free gift|today only|flash sale)\b/i],
  ['risk-reversal', /\b(money[- ]back|risk[- ]free|\d+[- ]day (guarantee|trial|returns?)|no questions asked|lifetime (warranty|guarantee)|guaranteed for life|guarantee[sd]?)\b/i],
  ['clinical', /\b(clinically|dermatologist|lab[- ]tested|proven|study|studies|patented|certified)\b/i],
  ['social-proof', /\b([\d,]{4,}\+? (happy )?customers|[\d,]{3,}\+? (5-star )?reviews|as seen (on|in)|loved by)\b/i],
  ['comparison', /\b(vs\.?|versus|compared to|unlike (other|the))\b/i],
  ['premium', /\b(handmade|hand-crafted|artisan|luxury|premium|heirloom|small batch)\b/i],
  ['story', /\b(i started|our story|we started|founded by|my (wife|husband|daughter|son))\b/i],
  ['problem-solution', /\b(tired of|sick of|stop (wasting|struggling)|finally|say goodbye|no more)\b/i],
]

export function classifyAngle(text: string): AngleKind {
  return ANGLE_RULES.find(([, pattern]) => pattern.test(text))?.[0] ?? 'benefit'
}

/* --------------------------------------------------------------- extraction */

function strip(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function meta(html: string, key: string): string {
  const pattern = new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']{1,400})`, 'i')
  const reversed = new RegExp(`<meta[^>]+content=["']([^"']{1,400})["'][^>]+(?:property|name)=["']${key}["']`, 'i')
  return strip(pattern.exec(html)?.[1] ?? reversed.exec(html)?.[1] ?? '')
}

function tags(html: string, tag: string, max = 12): string[] {
  const pattern = new RegExp(`<${tag}[^>]*>([\\s\\S]{1,300}?)<\\/${tag}>`, 'gi')
  const out: string[] = []
  for (const match of html.matchAll(pattern)) {
    const text = strip(match[1] ?? '')
    if (text.length >= 3 && !out.includes(text)) out.push(text)
    if (out.length >= max) break
  }
  return out
}

function money(text: string): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(/(?:[$€£]\s?\d{1,4}(?:[.,]\d{2})?|\d{1,4}(?:[.,]\d{2})?\s?(?:USD|EUR|GBP))/g)) {
    seen.add(match[0].replace(/\s+/g, ''))
  }
  return [...seen]
}

function amount(value: string): number {
  return Number(value.replace(/[^\d.]/g, '').replace(/^(\d+),(\d{2})$/, '$1.$2')) || 0
}

/** Reads a page's HTML — or plain pasted text — into an angle record. */
export function extractAngle(html: string, url = ''): CompetitorAngle {
  const isHtml = /<[a-z][\s\S]*>/i.test(html)
  const body = isHtml ? html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ') : html
  const text = isHtml ? strip(body) : html.replace(/\s+/g, ' ').trim()
  const title = strip(/<title[^>]*>([^<]{1,200})<\/title>/i.exec(body)?.[1] ?? '')
  const siteName = meta(body, 'og:site_name')
  const brand = siteName || (title.split(/\s[|–—-]\s/).pop() ?? '').trim() || hostnameOf(url)
  const h1 = tags(body, 'h1', 2)
  const h2 = tags(body, 'h2', 12)
  const h3 = tags(body, 'h3', 12)
  const headline = h1[0] || meta(body, 'og:title') || (isHtml ? '' : (/^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text).slice(0, 120))
  const subheadline = meta(body, 'og:description') || meta(body, 'description') || h2[0] || ''
  const hookLike = (line: string) => /\?$/.test(line) || /\b(you|your|finally|stop|tired|why|how|what|secret|never|imagine)\b/i.test(line)
  const hooks = [...h2, ...h3].filter((line) => line.length <= 120 && hookLike(line)).slice(0, 8)
  const benefits = tags(body, 'li', 60).filter((line) => line.length >= 12 && line.length <= 90 && !/^(home|shop|cart|about|contact|menu|log in|sign in|search)\b/i.test(line)).slice(0, 8)
  const prices = money(text).sort((a, b) => amount(a) - amount(b))
  const discount = /(\d{1,2})%\s*off|save\s+(\d{1,2})%/i.exec(text)
  const shipping = /free (?:worldwide |express |fast )?shipping[^.!<]{0,60}/i.exec(text)?.[0] ?? ''
  const guarantee = /(?:\d+[- ]day[^.!<]{0,40}(?:guarantee|trial|returns?)|money[- ]back guarantee[^.!<]{0,40}|risk[- ]free[^.!<]{0,40}|lifetime warranty)/i.exec(text)?.[0] ?? ''
  const bundle = /buy\s+\d+[^.!<]{0,50}(?:get|save|free)[^.!<]{0,40}/i.exec(text)?.[0] ?? ''
  const reviewCount = /([\d,]{2,}\+?)\s*(?:verified\s+)?(?:reviews|ratings|happy customers|customers)/i.exec(text)?.[1] ?? ''
  const rating = /(\d\.\d)\s*(?:\/\s*5|out of 5|stars|★)/i.exec(text)?.[1] ?? ''
  const badges = [...new Set([...text.matchAll(/\b(as seen (?:on|in) [A-Z][\w\s]{2,30}|dermatologist[- ]recommended|vet[- ]approved|clinically tested|fda[- ]registered|made in [A-Z][a-z]+|cruelty[- ]free|vegan|eco[- ]friendly)\b/gi)].map((match) => match[0]))].slice(0, 6)
  const ctas = [...new Set([...tags(body, 'button', 20), ...[...body.matchAll(/<a[^>]*class=["'][^"']*(?:btn|button|cta)[^"']*["'][^>]*>([\s\S]{1,80}?)<\/a>/gi)].map((match) => strip(match[1] ?? ''))].filter((line) => line.length >= 3 && line.length <= 40))].slice(0, 6)
  const audience = /\b(?:for|designed for|made for|perfect for|built for)\s+([a-z][a-z\s-]{3,40}?)(?:[.,;!<]|$|\s+who\b)/i.exec(`${subheadline} ${text}`)?.[1]?.trim() ?? ''
  const images = [...new Set([meta(body, 'og:image'), ...[...body.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((match) => match[1] ?? '')].filter((src) => src && /\.(jpe?g|png|webp)(\?|$)/i.test(src) && !/logo|icon|sprite|pixel|badge/i.test(src)))].slice(0, 6)
  const notes: string[] = []
  if (!isHtml) notes.push('Read from pasted text, not HTML: prices and buttons may be incomplete.')
  if (!headline) notes.push('No H1 found; the headline is the first sentence.')
  const angle = classifyAngle([headline, subheadline, ...hooks, bundle, guarantee, ...badges].join(' ') || text.slice(0, 3000))
  return {
    brand,
    url,
    headline,
    subheadline,
    hooks,
    benefits,
    offer: {
      price: prices[0] ?? '',
      comparePrice: prices.length > 1 ? (prices[prices.length - 1] as string) : '',
      discount: discount ? `${discount[1] ?? discount[2]}% off` : '',
      shipping,
      guarantee,
      bundle,
    },
    proof: { reviewCount, rating, badges },
    ctas,
    audience,
    angle,
    images,
    notes,
    take: '',
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

export type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: string }>

export const realFetcher: Fetcher = async (url) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; storemillResearch/1.0)', accept: 'text/html' } })
    return { ok: response.ok, status: response.status, text: (await response.text()).slice(0, 600_000) }
  } catch (error) {
    return { ok: false, status: 0, text: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

const ANGLE_KINDS: AngleKind[] = ['problem-solution', 'offer', 'risk-reversal', 'clinical', 'social-proof', 'comparison', 'urgency', 'premium', 'story', 'benefit']

const ANGLE_SCHEMA = S.obj({
  brand: S.str('The brand selling on the page.'),
  headline: S.str('The main promise, as written on the page.'),
  subheadline: S.str('The supporting line.'),
  hooks: S.arr(S.str(), 'Up to eight lines on the page that work as hooks: questions, callouts, "tired of…".'),
  benefits: S.arr(S.str(), 'Up to eight benefits the page claims, as written.'),
  offer: S.obj({
    price: S.str('The selling price as written, or empty.'),
    comparePrice: S.str('The struck-through price, or empty.'),
    discount: S.str('"40% off", or empty.'),
    shipping: S.str('The shipping promise, or empty.'),
    guarantee: S.str('The guarantee or returns promise, or empty.'),
    bundle: S.str('Any buy-more offer, or empty.'),
  }),
  proof: S.obj({ reviewCount: S.str('As written, or empty.'), rating: S.str('As written, or empty.'), badges: S.arr(S.str(), 'Trust badges and claims: "as seen on", "vet approved".') }),
  ctas: S.arr(S.str(), 'The button texts.'),
  audience: S.str('Who the page says it is for, or empty.'),
  angle: S.enumOf(ANGLE_KINDS, 'The angle the page runs above all others.'),
})

/**
 * The model reads the page as a page. The rules extraction found what the
 * markup gave away; this pass reads the words and fills the record with what
 * the page actually says, in its own phrasing, so the merchant edits a real
 * reading rather than a regex's guess.
 */
export async function refineAngle(choice: ModelChoice, text: string, rules: CompetitorAngle): Promise<CompetitorAngle> {
  const prompt = [
    `Page URL: ${rules.url || '(pasted)'}`,
    `What the markup gave away (may be incomplete or wrong): ${JSON.stringify({ brand: rules.brand, headline: rules.headline, subheadline: rules.subheadline, hooks: rules.hooks, offer: rules.offer, proof: rules.proof, ctas: rules.ctas, audience: rules.audience })}`,
    `The page text:\n${text.slice(0, 20000)}`,
    'Read the page and write the record. Quote the page\'s own words for the headline, hooks, benefits, offer and proof; leave a field empty rather than guessing. Classify the angle it runs.',
  ].join('\n\n')
  const parsed = await completeJson<Omit<CompetitorAngle, 'url' | 'images' | 'notes' | 'take'>>(choice, {
    task: 'extraction',
    system: `You read competitor product pages for a dropshipper and record exactly what they say: the promise, the hooks, the offer, the proof, the audience, the angle. You never add claims the page does not make. Note which awareness level the page speaks to and which sophistication stage its claims sit at.\n\n${knowledge('sophistication')}`,
    prompt,
    schema: ANGLE_SCHEMA,
    name: 'competitor_angle',
  })
  return {
    ...rules,
    brand: parsed.brand?.trim() || rules.brand,
    headline: parsed.headline?.trim() || rules.headline,
    subheadline: parsed.subheadline?.trim() || rules.subheadline,
    hooks: parsed.hooks?.length ? parsed.hooks.slice(0, 8) : rules.hooks,
    benefits: parsed.benefits?.length ? parsed.benefits.slice(0, 8) : rules.benefits,
    offer: { ...rules.offer, ...Object.fromEntries(Object.entries(parsed.offer ?? {}).filter(([, value]) => typeof value === 'string' && value.trim())) },
    proof: { reviewCount: parsed.proof?.reviewCount || rules.proof.reviewCount, rating: parsed.proof?.rating || rules.proof.rating, badges: parsed.proof?.badges?.length ? parsed.proof.badges.slice(0, 6) : rules.proof.badges },
    ctas: parsed.ctas?.length ? parsed.ctas.slice(0, 6) : rules.ctas,
    audience: parsed.audience?.trim() || rules.audience,
    angle: ANGLE_KINDS.includes(parsed.angle) ? parsed.angle : rules.angle,
    notes: [...rules.notes.filter((note) => !/^Read from pasted text|^No H1/.test(note)), `Read by ${describe(choice)}.`],
  }
}

/** Reads a competitor URL; pasted HTML wins over the fetch when both are given. A model, when given, reads the page after the rules. */
export async function readCompetitor(input: { url?: string; html?: string }, fetcher: Fetcher = realFetcher, model: ModelChoice | null = null): Promise<CompetitorAngle> {
  let source = ''
  let angle: CompetitorAngle
  if (input.html?.trim()) {
    source = input.html
    angle = extractAngle(input.html, input.url ?? '')
  } else {
    if (!input.url) throw new Error('Give a URL or paste the page')
    const response = await fetcher(input.url)
    if (!response.ok) {
      angle = extractAngle('', input.url)
      angle.brand = hostnameOf(input.url)
      angle.notes.push(response.status ? `The site answered ${response.status}; paste the page's HTML instead (view-source, select all, copy).` : `Could not reach the site (${response.text.slice(0, 80)}); paste the page's HTML instead.`)
      return angle
    }
    source = response.text
    angle = extractAngle(response.text, input.url)
  }
  if (!model) return angle
  try {
    const isHtml = /<[a-z][\s\S]*>/i.test(source)
    const text = isHtml ? strip(source.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')) : source
    return await refineAngle(model, text, angle)
  } catch (error) {
    log.warn(`${describe(model)} could not read the page; keeping the rules extraction: ${error instanceof Error ? error.message : String(error)}`)
    return angle
  }
}

/* ------------------------------------------------------------------ storage */

type CompetitorRow = { id: string; product_id: string; url: string; body: string; created_at: string; updated_at: string }

function rowToRecord(row: CompetitorRow): CompetitorRecord {
  const body = json<Partial<CompetitorAngle>>(row.body, {})
  const empty = extractAngle('', row.url)
  return { ...empty, ...body, offer: { ...empty.offer, ...(body.offer ?? {}) }, proof: { ...empty.proof, ...(body.proof ?? {}) }, id: row.id, productId: row.product_id, url: row.url, createdAt: row.created_at, updatedAt: row.updated_at }
}

export function saveCompetitor(db: Db, storeId: string, input: { id?: string; productId?: string; angle: Partial<CompetitorAngle> }): CompetitorRecord {
  const current = input.id ? getCompetitor(db, storeId, input.id) : null
  const merged = { ...(current ?? extractAngle('', input.angle.url ?? '')), ...input.angle, offer: { ...(current?.offer ?? {}), ...(input.angle.offer ?? {}) }, proof: { ...(current?.proof ?? {}), ...(input.angle.proof ?? {}) } }
  const { id: _id, productId: _pid, createdAt: _c, updatedAt: _u, ...body } = merged as CompetitorRecord
  if (current) {
    db.update('competitor_sites', current.id, { product_id: input.productId ?? current.productId, url: body.url, body, updated_at: now() })
    return getCompetitor(db, storeId, current.id) as CompetitorRecord
  }
  const recordId = id('cmp')
  db.insert('competitor_sites', { id: recordId, store_id: storeId, product_id: input.productId ?? '', url: body.url ?? '', body, created_at: now(), updated_at: now() })
  return getCompetitor(db, storeId, recordId) as CompetitorRecord
}

export function listCompetitors(db: Db, storeId: string, productId?: string): CompetitorRecord[] {
  return db
    .all<CompetitorRow>(productId ? 'SELECT * FROM competitor_sites WHERE store_id = ? AND product_id = ? ORDER BY created_at DESC' : 'SELECT * FROM competitor_sites WHERE store_id = ? ORDER BY created_at DESC', ...(productId ? [storeId, productId] : [storeId]))
    .map(rowToRecord)
}

export function getCompetitor(db: Db, storeId: string, recordId: string): CompetitorRecord | null {
  const row = db.one<CompetitorRow>('SELECT * FROM competitor_sites WHERE store_id = ? AND id = ?', storeId, recordId)
  return row ? rowToRecord(row) : null
}

export function deleteCompetitor(db: Db, storeId: string, recordId: string) {
  db.run('DELETE FROM competitor_sites WHERE store_id = ? AND id = ?', storeId, recordId)
}

/* ---------------------------------------------------------------- applying */

const ANGLE_WORDS: Record<AngleKind, string> = {
  'problem-solution': 'name the problem, then the fix',
  offer: 'lead with the deal',
  'risk-reversal': 'lead with the guarantee',
  clinical: 'evidence and specifics',
  'social-proof': 'what customers say, first',
  comparison: 'us against the usual option',
  urgency: 'scarcity and the deadline',
  premium: 'materials and craft, few words',
  story: 'the founder story',
  benefit: 'what it does for you',
}

/** The direction text this angle turns into. Editable before use, like any direction. */
export function directionFrom(angle: CompetitorAngle): string {
  const parts: string[] = []
  if (angle.angle === 'urgency') parts.push('urgent')
  if (angle.angle === 'premium') parts.push('premium')
  if (angle.angle === 'clinical') parts.push('clinical')
  if (angle.audience) parts.push(`for ${angle.audience}`)
  parts.push(`focus on ${ANGLE_WORDS[angle.angle]}`)
  if (angle.hooks[0]) parts.push(`"${angle.hooks[0].slice(0, 60)}"`)
  if (angle.offer.guarantee) parts.push(`"${angle.offer.guarantee.slice(0, 60)}"`)
  return parts.join(', ')
}

/**
 * Folds the competitor into the research on file: a competitor row, an avatar
 * from its audience, and what it promises recorded as notes about them. A new
 * research record is written so the old one stays in the history. The merchant
 * edits the result like any research.
 *
 * What it deliberately does not do is put their words into the store's own.
 * Proof points are printed on pages as trust lines and pull-quotes, and
 * triggers are what the copy writers turn into sentences — so folding a
 * competitor's guarantee in as "Match or beat: 60-night trial" and their ad
 * hooks in as triggers put a promise the merchant had never made, in a
 * competitor's wording, on the merchant's product page. Their claims belong on
 * the competitor's row, where the comparison table and the writers read them
 * as theirs.
 */
export function applyCompetitor(db: Db, storeId: string, recordId: string): Research {
  const record = getCompetitor(db, storeId, recordId)
  if (!record) throw new Error('No such competitor record')
  const current = latestResearch(db, storeId)
  if (!current) throw new Error('Run customer research first; the competitor is folded into it')
  const promises = [record.offer.guarantee, record.offer.shipping, ...record.proof.badges].filter(Boolean)
  const competitor = {
    name: record.brand || hostnameOf(record.url) || 'Competitor',
    angle: `${ANGLE_WORDS[record.angle]}${record.headline ? ` — "${record.headline.slice(0, 80)}"` : ''}`,
    priceBand: [record.offer.price, record.offer.comparePrice].filter(Boolean).join('–') || 'unknown',
    weakness: record.take || 'Not stated yet — write what they get wrong.',
  }
  const notes = [
    `Competitor ${competitor.name} (${record.url || 'pasted'}): ${record.angle} angle, ${competitor.priceBand}`,
    ...(promises.length ? [`${competitor.name} promises: ${promises.join('; ')}. Decide what this store offers before any of it goes on a page.`] : []),
    ...(record.hooks.length ? [`${competitor.name}'s hooks, as theirs, not to reuse: ${record.hooks.slice(0, 3).map((hook) => `"${hook}"`).join(' ')}`] : []),
  ]
  const next: Research = {
    ...current,
    competitors: [...current.competitors.filter((entry) => entry.name !== competitor.name), competitor],
    sourceNotes: [...current.sourceNotes, ...notes],
  }
  const { id: _id, source: _s, brief, createdAt: _c, ...body } = { ...next, id: current.id, source: current.source, brief: current.brief, createdAt: current.createdAt }
  db.insert('store_research', { id: id('res'), store_id: storeId, source: current.source, brief, body, created_at: now() })
  if (record.audience && !listAvatars(db, storeId).some((avatar) => avatar.who.toLowerCase().includes(record.audience.toLowerCase()))) {
    saveAvatar(db, storeId, {
      name: `${capitalize(record.audience)} (from ${competitor.name})`,
      who: record.audience,
      wants: record.benefits[0] ?? record.subheadline,
      fears: record.hooks.find((hook) => /\?$/.test(hook)) ?? '',
      buysWhen: record.offer.discount ? `A deal like ${record.offer.discount}` : '',
      angle: angleFromWants(record.benefits[0] ?? record.headline),
      hooks: record.hooks.slice(0, 4),
      source: 'competitor',
    })
  }
  return next
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}
