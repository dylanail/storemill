import { createHash } from 'node:crypto'
import type { Db } from '../lib/db.ts'
import { getProduct } from '../domain/catalog.ts'
import type { Product } from '../domain/types.ts'
import type { Store } from '../control/stores.ts'
import { readBrief } from '../agent/copy.ts'
import { ADVERTORIAL_FORMATS, PDP_FORMATS, authorBlocks, formatById, readDirection, writeAdvertorial, writePdp } from '../agent/directions.ts'
import { catalog, modelFor, parseChoice } from '../agent/models.ts'
import { latestResearch, rulesResearch } from '../agent/research.ts'
import { directionFor, getAvatar, listAvatars } from '../agent/avatars.ts'
import { createPage, getPage, listPages, updatePage, type Page } from './store.ts'

/**
 * Versions.
 *
 * A product can have any number of page versions — each a format plus a
 * direction — and any number of advertorials. The versions with a weight are
 * in a split test: a visitor is assigned one by a hash of their session and
 * sees the same one every time, and the numbers per version come from the
 * same events everything else is measured by.
 */
export type VersionRequest = {
  productId: string
  kind: 'pdp' | 'advertorial'
  formats?: string[]
  direction?: string
  /** An avatar id fills the audience, angle and tone the direction left blank. 'none' skips the default. */
  avatarId?: string
  count?: number
  publish?: boolean
  /** Optional one-run override; the store's Pages model remains the default. */
  model?: string
}

export async function generateVersions(db: Db, store: Store, request: VersionRequest): Promise<Page[]> {
  const product = getProduct(db, store.id, request.productId)
  if (!product) throw new Error('No product with that id')
  const brief = readBrief(`${store.prompt} ${product.title}`)
  const research = latestResearch(db, store.id) ?? rulesResearch(brief)
  const avatar = request.avatarId === 'none' ? null : request.avatarId ? getAvatar(db, store.id, request.avatarId) : listAvatars(db, store.id).find((entry) => entry.selected) ?? null
  const direction = directionFor(request.direction ?? '', avatar)
  const wanted = request.formats?.length ? request.formats : suggestFormats(request.kind, direction).slice(0, request.count ?? 3)
  const requested = parseChoice(request.model)
  const model = requested && catalog().some((entry) => entry.available && entry.provider === requested.provider && entry.model === requested.model) ? requested : modelFor(db, store.id, 'pages')
  const created: Page[] = []
  for (const formatId of wanted) {
    const format = formatById(formatId, request.kind)
    const input = { product, store: { name: store.name, prompt: store.prompt }, research, brief, direction, format }
    const drafted = request.kind === 'pdp' ? writePdp(input) : writeAdvertorial(input)
    const { blocks } = await authorBlocks(model, drafted, input)
    created.push(
      createPage(db, store.id, {
        title: `${product.title} — ${format.name}${avatar ? ` · ${avatar.name}` : ''}${direction.raw ? ` (${direction.raw.slice(0, 40)})` : ''}`,
        kind: request.kind === 'pdp' ? 'product' : 'advertorial',
        blocks,
        status: request.publish ? 'published' : 'draft',
        productId: product.id,
        role: request.kind,
        format: format.id,
        direction: direction.raw,
        weight: 0,
      }),
    )
  }
  return created
}

/** Which formats to reach for first, given the direction. Everything is available; this is the default order. */
export function suggestFormats(kind: 'pdp' | 'advertorial', direction: ReturnType<typeof readDirection>): string[] {
  if (kind === 'pdp') {
    if (direction.urgency) return ['urgency', 'offer', 'benefit', 'ugc']
    if (direction.priceLed) return ['offer', 'benefit', 'comparison']
    if (direction.tone === 'premium') return ['premium', 'story', 'benefit']
    if (direction.tone === 'clinical') return ['comparison', 'benefit', 'ugc']
    return ['benefit', 'ugc', 'story', 'comparison']
  }
  if (direction.tone === 'clinical') return ['roundup', 'expert', 'listicle']
  if (direction.tone === 'warm') return ['story', 'listicle', 'pas']
  if (direction.urgency) return ['pas', 'listicle', 'mistakes']
  return ['listicle', 'story', 'pas', 'expert']
}

export function versionsFor(db: Db, storeId: string, productId: string): Page[] {
  return listPages(db, storeId).filter((page) => page.productId === productId && (page.role === 'pdp' || page.role === 'advertorial'))
}

/** The pdp version a session sees, or null to render the built-in product page. */
export function pickPdpVersion(db: Db, storeId: string, product: Product, sessionKey: string): Page | null {
  const live = versionsFor(db, storeId, product.id).filter((page) => page.role === 'pdp' && page.status === 'published' && page.weight > 0)
  if (!live.length) return null
  const total = live.reduce((sum, page) => sum + page.weight, 0)
  const hash = parseInt(createHash('sha256').update(`${sessionKey}|${product.id}`).digest('hex').slice(0, 8), 16)
  let point = hash % total
  for (const page of live) {
    point -= page.weight
    if (point < 0) return page
  }
  return live[0] ?? null
}

export type VersionStats = { pageId: string; title: string; format: string; weight: number; status: string; views: number; carts: number; purchases: number; revenueCents: number; conversion: number; revenuePerSessionCents: number }

/** Per-version numbers from the event stream: a view carries the page it was; a cart add and a purchase are attributed to the version the session saw. */
export function versionStats(db: Db, storeId: string, productId: string): VersionStats[] {
  const pages = versionsFor(db, storeId, productId).filter((page) => page.role === 'pdp')
  return pages.map((page) => {
    const seen = db.all<{ session_id: string; at: string }>(
      "SELECT session_id, MIN(created_at) at FROM analytics_events WHERE store_id = ? AND type = 'view.product' AND json_extract(meta, '$.pageId') = ? GROUP BY session_id",
      storeId,
      page.id,
    )
    const empty = { pageId: page.id, title: page.title, format: page.format, weight: page.weight, status: page.status, views: 0, carts: 0, purchases: 0, revenueCents: 0, conversion: 0, revenuePerSessionCents: 0 }
    if (!seen.length) return empty
    const after = seen.map(() => '(session_id = ? AND created_at >= ?)').join(' OR ')
    const params = seen.flatMap((row) => [row.session_id, row.at])
    const carts = db.one<{ c: number }>(
      `SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'cart.add' AND product_id = ? AND (${after})`,
      storeId,
      productId,
      ...params,
    )?.c ?? 0
    const purchases = db.one<{ c: number; total: number | null }>(
      `SELECT COUNT(DISTINCT session_id) c, SUM(amount_cents) total FROM analytics_events WHERE store_id = ? AND type = 'checkout.complete' AND (${after})`,
      storeId,
      ...params,
    )
    const revenue = purchases?.total ?? 0
    return { ...empty, views: seen.length, carts, purchases: purchases?.c ?? 0, revenueCents: revenue, conversion: seen.length ? (purchases?.c ?? 0) / seen.length : 0, revenuePerSessionCents: seen.length ? Math.round(revenue / seen.length) : 0 }
  })
}

export function setVersionWeight(db: Db, storeId: string, pageId: string, weight: number): Page {
  return updatePage(db, storeId, pageId, { weight: Math.max(0, Math.round(weight)), ...(weight > 0 ? { status: 'published' as const } : {}) })
}

export function pageForVersion(db: Db, storeId: string, pageId: string): Page | null {
  return getPage(db, storeId, pageId)
}
