import { json, now, type Db } from '../lib/db.ts'
import { fingerprint } from '../lib/crypto.ts'
import { id } from '../lib/ids.ts'
import { minorDigits } from '../lib/money.ts'

export type EventType =
  | 'view.page'
  | 'view.product'
  | 'view.collection'
  | 'cart.add'
  | 'checkout.start'
  | 'checkout.complete'
  | 'signup'
  | 'review.submit'
  /* Behaviour, posted by the page itself: how far it was read, what was seen, what was pressed. */
  | 'scroll'
  | 'section.view'
  | 'cta.click'
  | 'popup.show'
  | 'popup.submit'
  | 'quiz.step'
  | 'quiz.complete'
  | 'funnel.enter'

export const BEHAVIOUR_EVENTS: EventType[] = ['scroll', 'section.view', 'cta.click', 'popup.show', 'popup.submit', 'quiz.step', 'quiz.complete']

/**
 * First-party analytics.
 *
 * No cookie, no pixel, no SDK. A visitor is identified by an HMAC of ip, user
 * agent and the current day — stable enough to count a session, useless as a
 * cross-site identifier, and it rotates itself at midnight.
 */
export type Touch = {
  source?: string
  medium?: string
  campaign?: string
  content?: string
  term?: string
  landingPage?: string
  referrer?: string
  gclid?: string
  fbclid?: string
  ttclid?: string
  at: string
}

export type Attribution = { first?: Touch; last?: Touch }

export function captureAttribution(url: URL, referrer = ''): Touch {
  const read = (name: string) => url.searchParams.get(name)?.trim() || undefined
  let externalReferrer = referrer
  if (externalReferrer) {
    try {
      if (new URL(externalReferrer).hostname === url.hostname) externalReferrer = ''
    } catch { /* keep malformed referrers as a generic referral signal */ }
  }
  let source = read('utm_source')
  if (!source && externalReferrer) {
    try { source = new URL(externalReferrer).hostname.replace(/^www\./, '') } catch { source = 'referral' }
  }
  if (!source && read('gclid')) source = 'google'
  if (!source && read('fbclid')) source = 'meta'
  if (!source && read('ttclid')) source = 'tiktok'
  return {
    ...(source ? { source } : {}),
    ...(read('utm_medium') ? { medium: read('utm_medium') } : {}),
    ...(read('utm_campaign') ? { campaign: read('utm_campaign') } : {}),
    ...(read('utm_content') ? { content: read('utm_content') } : {}),
    ...(read('utm_term') ? { term: read('utm_term') } : {}),
    landingPage: `${url.pathname}${url.search}`,
    ...(externalReferrer ? { referrer: externalReferrer } : {}),
    ...(read('gclid') ? { gclid: read('gclid') } : {}),
    ...(read('fbclid') ? { fbclid: read('fbclid') } : {}),
    ...(read('ttclid') ? { ttclid: read('ttclid') } : {}),
    at: now(),
  }
}

function meaningful(touch: Touch): boolean {
  return Boolean(touch.source || touch.medium || touch.campaign || touch.gclid || touch.fbclid || touch.ttclid || touch.referrer)
}

export function sessionFor(db: Db, storeId: string, input: { ip: string; userAgent: string; visitor?: string; referrer?: string; country?: string; city?: string; touch?: Touch }): string {
  const day = new Date().toISOString().slice(0, 10)
  const key = input.visitor ? fingerprint('visitor', input.visitor, day) : fingerprint(input.ip, input.userAgent, day)
  const existing = db.one<{ id: string; attribution: string }>('SELECT id, attribution FROM sessions_analytics WHERE store_id = ? AND fingerprint = ?', storeId, key)
  if (existing) {
    const attribution = json(existing.attribution, {} as Attribution)
    if (input.touch && meaningful(input.touch)) attribution.last = input.touch
    db.update('sessions_analytics', existing.id, { last_seen: now(), attribution })
    return existing.id
  }
  const sessionId = id('as')
  db.insert('sessions_analytics', {
    id: sessionId,
    store_id: storeId,
    fingerprint: key,
    country: input.country ?? geoGuess(input.ip).country,
    city: input.city ?? geoGuess(input.ip).city,
    referrer: input.referrer ?? '',
    variant: Math.random() < 0.5 ? 'a' : 'b',
    attribution: input.touch ? { ...(meaningful(input.touch) ? { first: input.touch } : {}), last: input.touch } : {},
    first_seen: now(),
    last_seen: now(),
  })
  return sessionId
}

/** Without a geo database, the demo derives a stable pseudo-location from the
 * address so the live map has something honest-looking to draw. Swap for
 * MaxMind at deploy time; nothing else reads the ip. */
const PLACES = [
  ['US', 'Austin'], ['US', 'Brooklyn'], ['US', 'Portland'], ['DE', 'Berlin'], ['FR', 'Lyon'],
  ['GB', 'Manchester'], ['MX', 'Mexico City'], ['ES', 'Valencia'], ['CA', 'Montreal'], ['JP', 'Osaka'],
] as const

function geoGuess(ip: string) {
  let hash = 0
  for (const character of ip) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  const place = PLACES[hash % PLACES.length] as readonly [string, string]
  return { country: place[0], city: place[1] }
}

export function track(
  db: Db,
  storeId: string,
  sessionId: string,
  type: EventType,
  detail: { path?: string; productId?: string; amountCents?: number; meta?: Record<string, unknown> } = {},
) : string {
  const eventId = id('ev')
  db.insert('analytics_events', {
    id: eventId,
    store_id: storeId,
    session_id: sessionId,
    type,
    path: detail.path ?? '',
    product_id: detail.productId ?? null,
    amount_cents: detail.amountCents ?? 0,
    meta: detail.meta ?? {},
    created_at: now(),
  })
  return eventId
}

export function attributeOrder(db: Db, storeId: string, orderId: string, sessionId: string): void {
  const session = db.one<{ attribution: string }>('SELECT attribution FROM sessions_analytics WHERE id = ? AND store_id = ?', sessionId, storeId)
  if (!session) return
  const attribution = json(session.attribution, {} as Attribution)
  db.run(
    `INSERT OR IGNORE INTO order_attribution
      (id, store_id, order_id, session_id, first_touch, last_touch, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id('oa'), storeId, orderId, sessionId, JSON.stringify(attribution.first ?? {}), JSON.stringify(attribution.last ?? attribution.first ?? {}), now(),
  )
}

export type AttributionRow = { channel: string; campaign: string; orders: number; revenueCents: number; spendCents: number; roas: number | null }

export function attributionReport(db: Db, storeId: string, range: Range = '30d', model: 'first' | 'last' = 'last'): AttributionRow[] {
  const from = since(range)
  const storeCurrency = db.one<{ currency: string }>('SELECT currency FROM stores WHERE id = ?', storeId)?.currency ?? 'USD'
  const rows = db.all<{ touch: string; total_cents: number; base_total_cents: number | null; currency: string; exchange_rate: number | null }>(
    `SELECT ${model === 'first' ? 'a.first_touch' : 'a.last_touch'} touch,
            o.total_cents, o.base_total_cents, o.currency, r.exchange_rate
     FROM order_attribution a JOIN orders o ON o.id = a.order_id
     LEFT JOIN carts c ON c.order_id = o.id LEFT JOIN regions r ON r.id = c.region_id
     WHERE a.store_id = ? AND o.status != 'cancelled' AND o.created_at >= ?`,
    storeId, from,
  )
  const grouped = new Map<string, AttributionRow>()
  for (const row of rows) {
    const touch = json(row.touch, {} as Touch)
    const channel = touch.source || (touch.referrer ? 'referral' : 'direct')
    const campaign = touch.campaign || 'Unassigned'
    const key = `${channel}\u0000${campaign}`
    const current = grouped.get(key) ?? { channel, campaign, orders: 0, revenueCents: 0, spendCents: 0, roas: null }
    current.orders++
    if (row.base_total_cents !== null) current.revenueCents += row.base_total_cents
    else {
      const rate = row.exchange_rate && row.exchange_rate > 0 ? row.exchange_rate : 1
      const chargedAmount = row.total_cents / 10 ** minorDigits(row.currency)
      current.revenueCents += Math.round((chargedAmount / rate) * 10 ** minorDigits(storeCurrency))
    }
    grouped.set(key, current)
  }
  const days = range === '24h' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 90
  const spendFrom = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  for (const spend of db.all<{ platform: string; amount: number }>(
    'SELECT lower(platform) platform, SUM(amount_cents) amount FROM ad_spend WHERE store_id = ? AND day >= ? GROUP BY lower(platform)', storeId, spendFrom,
  )) {
    const normalized = spend.platform === 'facebook' || spend.platform === 'instagram' ? 'meta' : spend.platform
    const matching = [...grouped.values()].filter((row) => row.channel.toLowerCase().includes(normalized))
    if (!matching.length) continue
    for (const row of matching) row.spendCents += Math.round(spend.amount / matching.length)
  }
  return [...grouped.values()]
    .map((row) => ({ ...row, roas: row.spendCents ? Number((row.revenueCents / row.spendCents).toFixed(2)) : null }))
    .sort((a, b) => b.revenueCents - a.revenueCents)
}

export type Range = '24h' | '7d' | '30d' | '90d'

export function since(range: Range): string {
  const hours = range === '24h' ? 24 : range === '7d' ? 24 * 7 : range === '30d' ? 24 * 30 : 24 * 90
  return new Date(Date.now() - hours * 3600_000).toISOString()
}

export type Kpis = {
  sessions: number
  orders: number
  revenueCents: number
  conversionRate: number
  aovCents: number
  deltas: Record<string, number>
}

function windowKpis(db: Db, storeId: string, from: string, to: string): Omit<Kpis, 'deltas'> {
  const sessions = db.one<{ c: number }>('SELECT COUNT(*) c FROM sessions_analytics WHERE store_id = ? AND first_seen >= ? AND first_seen < ?', storeId, from, to)?.c ?? 0
  const orderRow = db.one<{ c: number; total: number | null }>(
    "SELECT COUNT(*) c, SUM(COALESCE(base_total_cents, total_cents)) total FROM orders WHERE store_id = ? AND created_at >= ? AND created_at < ? AND status != 'cancelled'",
    storeId, from, to,
  )
  const orders = orderRow?.c ?? 0
  const revenue = orderRow?.total ?? 0
  return {
    sessions,
    orders,
    revenueCents: revenue,
    conversionRate: sessions ? orders / sessions : 0,
    aovCents: orders ? Math.round(revenue / orders) : 0,
  }
}

/** Every KPI tile carries its delta against the immediately preceding window. */
export function kpis(db: Db, storeId: string, range: Range = '7d'): Kpis {
  // The window is half-open, [from, to), so the two windows cannot double-count
  // a row on the boundary. The upper bound is a millisecond ahead of now
  // because timestamps have millisecond resolution: a session written in this
  // very millisecond belongs to the window being asked about.
  const to = new Date(Date.now() + 1).toISOString()
  const from = since(range)
  const span = Date.parse(to) - Date.parse(from)
  const previousFrom = new Date(Date.parse(from) - span).toISOString()
  const current = windowKpis(db, storeId, from, to)
  const previous = windowKpis(db, storeId, previousFrom, from)
  const delta = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : 1) : (a - b) / b)
  return {
    ...current,
    deltas: {
      sessions: delta(current.sessions, previous.sessions),
      orders: delta(current.orders, previous.orders),
      revenueCents: delta(current.revenueCents, previous.revenueCents),
      conversionRate: delta(current.conversionRate, previous.conversionRate),
      aovCents: delta(current.aovCents, previous.aovCents),
    },
  }
}

export type FunnelStage = { stage: string; count: number; share: number; dropOff: number }

/** Industry comparison numbers are published DTC medians, held in one place so
 * nobody has to wonder whether a benchmark was invented at the call site. */
export const BENCHMARK = { addToCart: 0.28, checkout: 0.092, purchase: 0.034, topDecilePurchase: 0.081 }

export function funnel(db: Db, storeId: string, range: Range = '7d'): FunnelStage[] {
  const from = since(range)
  const count = (type: EventType) =>
    db.one<{ c: number }>('SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = ? AND created_at >= ?', storeId, type, from)?.c ?? 0
  const sessions = db.one<{ c: number }>('SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND created_at >= ?', storeId, from)?.c ?? 0
  const raw = [
    { stage: 'Sessions', count: sessions },
    { stage: 'Add to cart', count: count('cart.add') },
    { stage: 'Checkout', count: count('checkout.start') },
    { stage: 'Purchase', count: count('checkout.complete') },
  ]
  const top = raw[0]?.count ?? 0
  return raw.map((entry, index) => {
    const previous = raw[index - 1]?.count ?? entry.count
    return {
      stage: entry.stage,
      count: entry.count,
      share: top ? entry.count / top : 0,
      dropOff: previous ? 1 - entry.count / previous : 0,
    }
  })
}

export function liveVisitors(db: Db, storeId: string, minutes = 30) {
  const from = new Date(Date.now() - minutes * 60_000).toISOString()
  return db.all(
    `SELECT s.city, s.country, s.last_seen, (SELECT path FROM analytics_events e WHERE e.session_id = s.id ORDER BY created_at DESC LIMIT 1) path
     FROM sessions_analytics s WHERE s.store_id = ? AND s.last_seen >= ? ORDER BY s.last_seen DESC LIMIT 12`,
    storeId, from,
  )
}

export function recentEvents(db: Db, storeId: string, limit = 20) {
  return db.all(
    `SELECT e.type, e.path, e.amount_cents, e.created_at, s.city, s.country
     FROM analytics_events e LEFT JOIN sessions_analytics s ON s.id = e.session_id
     WHERE e.store_id = ? ORDER BY e.created_at DESC LIMIT ?`,
    storeId, limit,
  )
}

export function revenueSeries(db: Db, storeId: string, days = 14) {
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  const rows = db.all<{ day: string; revenue: number; orders: number }>(
    `SELECT substr(created_at,1,10) day, SUM(COALESCE(base_total_cents, total_cents)) revenue, COUNT(*) orders
     FROM orders WHERE store_id = ? AND substr(created_at,1,10) >= ? AND status != 'cancelled'
     GROUP BY day ORDER BY day`,
    storeId, from,
  )
  const byDay = new Map(rows.map((row) => [row.day, row]))
  const series: Array<{ day: string; revenue: number; orders: number }> = []
  for (let index = days - 1; index >= 0; index--) {
    const day = new Date(Date.now() - index * 86400000).toISOString().slice(0, 10)
    const row = byDay.get(day)
    series.push({ day, revenue: row?.revenue ?? 0, orders: row?.orders ?? 0 })
  }
  return series
}

export function topProducts(db: Db, storeId: string, limit = 5) {
  return db.all(
    `SELECT product_id, COUNT(*) views FROM analytics_events
     WHERE store_id = ? AND type = 'view.product' AND product_id IS NOT NULL
     GROUP BY product_id ORDER BY views DESC LIMIT ?`,
    storeId, limit,
  )
}

/**
 * Nightly affinity: which products actually get bought together, mined from
 * this store's own orders. Cross-sells and "goes with this" read this and
 * nothing else — no shared model, no other merchant's data.
 */
export function affinityPairs(db: Db, storeId: string, days = 90) {
  const from = new Date(Date.now() - days * 86400000).toISOString()
  const orders = db.all<{ items: string }>("SELECT items FROM orders WHERE store_id = ? AND created_at >= ? AND status != 'cancelled'", storeId, from)
  const pairs = new Map<string, number>()
  for (const order of orders) {
    let items: Array<{ productId: string }> = []
    try { items = JSON.parse(order.items) as Array<{ productId: string }> } catch { continue }
    const unique = [...new Set(items.map((item) => item.productId))].sort()
    for (let i = 0; i < unique.length; i++) {
      for (let j = i + 1; j < unique.length; j++) {
        const key = `${unique[i]}|${unique[j]}`
        pairs.set(key, (pairs.get(key) ?? 0) + 1)
      }
    }
  }
  return [...pairs.entries()]
    .map(([key, count]) => {
      const [a, b] = key.split('|')
      return { a: a as string, b: b as string, count }
    })
    .sort((x, y) => y.count - x.count)
}

/** What the PDP shows when there is not enough order history to mine yet. */
export function companionsFor(db: Db, storeId: string, productId: string, limit = 2): string[] {
  const mined = affinityPairs(db, storeId)
    .filter((pair) => pair.a === productId || pair.b === productId)
    .map((pair) => (pair.a === productId ? pair.b : pair.a))
  if (mined.length >= limit) return mined.slice(0, limit)
  const fallback = db
    .all<{ id: string }>("SELECT id FROM products WHERE store_id = ? AND id != ? AND status = 'published' ORDER BY position LIMIT ?", storeId, productId, limit)
    .map((row) => row.id)
  return [...new Set([...mined, ...fallback])].slice(0, limit)
}

/* ---------------------------------------------------------------- behaviour */

export type Behaviour = {
  sessions: number
  /** How many sessions reached each depth on any page. */
  scroll: { 25: number; 50: number; 75: number; 100: number }
  sections: Array<{ path: string; blockType: string; blockId: string; views: number }>
  ctas: Array<{ path: string; label: string; clicks: number }>
  popup: { shows: number; submits: number }
  quiz: Array<{ path: string; step: number; count: number; completes: number }>
  pages: Array<{ path: string; sessions: number; readHalf: number; ctaClicks: number; carts: number; purchases: number; revenueCents: number; revenuePerSessionCents: number }>
}

/**
 * The behaviour report: what visitors did on the pages, not just where they
 * went. Every number is a count of distinct sessions, so a visitor who
 * scrolls a page three times counts once.
 */
export function behaviour(db: Db, storeId: string, range: Range = '7d'): Behaviour {
  const from = since(range)
  const depth = (percent: number) => db.one<{ c: number }>("SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'scroll' AND created_at >= ? AND CAST(json_extract(meta, '$.depth') AS INTEGER) >= ?", storeId, from, percent)?.c ?? 0
  const sessions = db.one<{ c: number }>('SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND created_at >= ?', storeId, from)?.c ?? 0
  const sections = db.all<{ path: string; blockType: string; blockId: string; views: number }>(
    "SELECT path, json_extract(meta, '$.blockType') blockType, json_extract(meta, '$.blockId') blockId, COUNT(DISTINCT session_id) views FROM analytics_events WHERE store_id = ? AND type = 'section.view' AND created_at >= ? GROUP BY path, blockType, blockId ORDER BY views DESC LIMIT 40",
    storeId, from,
  )
  const ctas = db.all<{ path: string; label: string; clicks: number }>(
    "SELECT path, COALESCE(json_extract(meta, '$.label'), '') label, COUNT(DISTINCT session_id) clicks FROM analytics_events WHERE store_id = ? AND type = 'cta.click' AND created_at >= ? GROUP BY path, label ORDER BY clicks DESC LIMIT 40",
    storeId, from,
  )
  const popup = {
    shows: db.one<{ c: number }>("SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'popup.show' AND created_at >= ?", storeId, from)?.c ?? 0,
    submits: db.one<{ c: number }>("SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'popup.submit' AND created_at >= ?", storeId, from)?.c ?? 0,
  }
  const quizSteps = db.all<{ path: string; step: number; count: number }>(
    "SELECT path, CAST(json_extract(meta, '$.step') AS INTEGER) step, COUNT(DISTINCT session_id) count FROM analytics_events WHERE store_id = ? AND type = 'quiz.step' AND created_at >= ? GROUP BY path, step ORDER BY path, step",
    storeId, from,
  )
  const quizDone = new Map(db.all<{ path: string; c: number }>("SELECT path, COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'quiz.complete' AND created_at >= ? GROUP BY path", storeId, from).map((row) => [row.path, row.c]))
  const quiz = quizSteps.map((row) => ({ path: row.path, step: row.step, count: row.count, completes: quizDone.get(row.path) ?? 0 }))
  const paths = db.all<{ path: string; sessions: number }>(
    "SELECT path, COUNT(DISTINCT session_id) sessions FROM analytics_events WHERE store_id = ? AND type IN ('view.page','view.product') AND created_at >= ? GROUP BY path ORDER BY sessions DESC LIMIT 30",
    storeId, from,
  )
  const pages = paths.map((row) => {
    const viewers = db.all<{ session_id: string }>("SELECT DISTINCT session_id FROM analytics_events WHERE store_id = ? AND path = ? AND type IN ('view.page','view.product') AND created_at >= ?", storeId, row.path, from).map((entry) => entry.session_id)
    if (!viewers.length) return { path: row.path, sessions: 0, readHalf: 0, ctaClicks: 0, carts: 0, purchases: 0, revenueCents: 0, revenuePerSessionCents: 0 }
    const marks = viewers.map(() => '?').join(', ')
    const readHalf = db.one<{ c: number }>(`SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'scroll' AND path = ? AND CAST(json_extract(meta, '$.depth') AS INTEGER) >= 50 AND session_id IN (${marks})`, storeId, row.path, ...viewers)?.c ?? 0
    const ctaClicks = db.one<{ c: number }>(`SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'cta.click' AND path = ? AND session_id IN (${marks})`, storeId, row.path, ...viewers)?.c ?? 0
    const carts = db.one<{ c: number }>(`SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND type = 'cart.add' AND session_id IN (${marks})`, storeId, ...viewers)?.c ?? 0
    const bought = db.one<{ c: number; total: number | null }>(`SELECT COUNT(DISTINCT session_id) c, SUM(amount_cents) total FROM analytics_events WHERE store_id = ? AND type = 'checkout.complete' AND session_id IN (${marks})`, storeId, ...viewers)
    const revenue = bought?.total ?? 0
    return { path: row.path, sessions: viewers.length, readHalf, ctaClicks, carts, purchases: bought?.c ?? 0, revenueCents: revenue, revenuePerSessionCents: Math.round(revenue / viewers.length) }
  })
  return { sessions, scroll: { 25: depth(25), 50: depth(50), 75: depth(75), 100: depth(100) }, sections, ctas, popup, quiz, pages }
}

/** Revenue per session for a set of sessions: the number a split test is decided on. */
export function revenuePerSession(db: Db, storeId: string, sessions: string[]): { purchases: number; revenueCents: number; perSessionCents: number } {
  if (!sessions.length) return { purchases: 0, revenueCents: 0, perSessionCents: 0 }
  const marks = sessions.map(() => '?').join(', ')
  const row = db.one<{ c: number; total: number | null }>(`SELECT COUNT(DISTINCT session_id) c, SUM(amount_cents) total FROM analytics_events WHERE store_id = ? AND type = 'checkout.complete' AND session_id IN (${marks})`, storeId, ...sessions)
  const revenue = row?.total ?? 0
  return { purchases: row?.c ?? 0, revenueCents: revenue, perSessionCents: Math.round(revenue / sessions.length) }
}
