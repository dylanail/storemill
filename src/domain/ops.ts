import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { createProduct, getProduct, listProducts } from './catalog.ts'
import { createReview } from './reviews.ts'
import { listOrders } from './orders.ts'
import type { Order, Product, Supplier } from './types.ts'
import type { TrackingEvent, TrackingSnapshot } from '../shipping/seventeen-track.ts'

/**
 * The operations a dropshipper runs a store on: where products come from,
 * what they cost, what the ads cost, what is actually left; where an order
 * is; what customers ask; who wants to know when it is back.
 */

/* ------------------------------------------------------------- profit */

export type Margin = {
  priceCents: number
  costCents: number
  shippingCents: number
  feesCents: number
  profitCents: number
  marginPercent: number
  /** 1 ÷ gross margin, rounded up: below this a sale loses money. Null when there is no margin to divide into. */
  breakevenRoas: number | null
  /** Breakeven + 1: the line the course scales above and holds below. */
  targetRoas: number | null
}

/**
 * The two lines every scaling decision is made against.
 *
 * Breakeven ROAS is 1 ÷ gross margin rounded up (67% → 1.5, 55% → 1.82) and
 * target is breakeven + 1. Everything needed for them was already on file —
 * price, supplier cost, supplier shipping, card fees — and stopping at "42%
 * margin" left the operator to do this arithmetic in their head every time
 * they looked at a campaign.
 */
export function roasLines(marginPercent: number): { breakevenRoas: number | null; targetRoas: number | null } {
  if (marginPercent <= 0) return { breakevenRoas: null, targetRoas: null }
  const breakeven = Math.ceil((100 / marginPercent) * 100) / 100
  return { breakevenRoas: breakeven, targetRoas: Math.round((breakeven + 1) * 100) / 100 }
}

/** Card fees at 2.9% + 30c; the platform fee is not charged in personal mode. */
export function marginFor(priceCents: number, supplier: Supplier): Margin {
  const cost = supplier.costCents ?? 0
  const shipping = supplier.shippingCents ?? 0
  const fees = Math.round(priceCents * 0.029) + 30
  const profit = priceCents - cost - shipping - fees
  const marginPercent = priceCents ? Math.round((profit / priceCents) * 100) : 0
  return { priceCents, costCents: cost, shippingCents: shipping, feesCents: fees, profitCents: profit, marginPercent, ...roasLines(marginPercent) }
}

export function recordAdSpend(db: Db, storeId: string, input: { day: string; platform: string; amountCents: number; clicks?: number; note?: string }) {
  db.insert('ad_spend', {
    id: id('ads'),
    store_id: storeId,
    day: input.day.slice(0, 10),
    platform: input.platform,
    amount_cents: input.amountCents,
    clicks: Math.max(0, Math.round(input.clicks ?? 0)),
    note: input.note ?? '',
    created_at: now(),
  })
}

export function listAdSpend(db: Db, storeId: string, days = 30) {
  const from = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)
  return db.all<{ id: string; day: string; platform: string; amount_cents: number; clicks: number; note: string }>(
    'SELECT id, day, platform, amount_cents, clicks, note FROM ad_spend WHERE store_id = ? AND day >= ? ORDER BY day DESC',
    storeId,
    from,
  )
}

export type ProfitReport = {
  days: number
  revenueCents: number
  refundsCents: number
  cogsCents: number
  supplierShippingCents: number
  feesCents: number
  adSpendCents: number
  profitCents: number
  orders: number
  roas: number | null
  /** Clicks bought over the window, and what each one cost. Null when no clicks were logged. */
  clicks: number
  cpcCents: number | null
  /** Blended gross margin over the window, and the two lines that follow from it. */
  marginPercent: number
  breakevenRoas: number | null
  targetRoas: number | null
  /**
   * What the course does with those lines: above target, scale; between the
   * lines, hold; below breakeven, scale down. Null when there is no spend to
   * judge, and never trusted on fewer than three days of it.
   */
  verdict: 'scale' | 'hold' | 'cut' | null
  spendDays: number
  perDay: Array<{ day: string; revenue: number; spend: number; profit: number }>
}

/**
 * Profit is computed from what is on file, not estimated: order totals less
 * refunds, less the supplier cost of every line (the order's recorded supplier
 * cost when it was placed with the supplier, else the product's current cost),
 * less card fees, less the ad spend logged for the period.
 */
export function profitReport(db: Db, storeId: string, days = 30): ProfitReport {
  const from = new Date(Date.now() - days * 86400000).toISOString()
  const orders = listOrders(db, storeId, { limit: 5000 }).filter((order) => order.createdAt >= from && order.status !== 'cancelled')
  const products = new Map(listProducts(db, storeId, { limit: 1000, includeHidden: true }).map((product) => [product.id, product]))
  let revenue = 0
  let refunds = 0
  let cogs = 0
  let supplierShipping = 0
  let fees = 0
  const byDay = new Map<string, { revenue: number; spend: number; profit: number }>()
  for (const order of orders) {
    const baseTotal = order.baseTotalCents
    revenue += baseTotal
    const refundedCharged = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
    const refunded = order.totalCents ? Math.round(refundedCharged * baseTotal / order.totalCents) : refundedCharged
    refunds += refunded
    const orderCogs = order.supplierOrder.costCents ?? order.items.reduce((sum, item) => sum + (products.get(item.productId)?.supplier.costCents ?? 0) * item.quantity, 0)
    const orderShip = order.supplierOrder.shippingCents ?? order.items.reduce((sum, item) => sum + (products.get(item.productId)?.supplier.shippingCents ?? 0), 0)
    const orderFees = Math.round(baseTotal * 0.029) + 30
    cogs += orderCogs
    supplierShipping += orderShip
    fees += orderFees
    const day = order.createdAt.slice(0, 10)
    const entry = byDay.get(day) ?? { revenue: 0, spend: 0, profit: 0 }
    entry.revenue += baseTotal
    entry.profit += baseTotal - refunded - orderCogs - orderShip - orderFees
    byDay.set(day, entry)
  }
  let adSpend = 0
  let clicks = 0
  // Cost per click divides only the spend that has clicks recorded against it.
  // Blending in the rows logged without clicks would inflate it silently, and
  // the number decides whether a page is worth its traffic.
  let clickedSpend = 0
  const spendDays = new Set<string>()
  for (const row of listAdSpend(db, storeId, days)) {
    adSpend += row.amount_cents
    if (row.clicks > 0) {
      clicks += row.clicks
      clickedSpend += row.amount_cents
    }
    if (row.amount_cents > 0) spendDays.add(row.day)
    const entry = byDay.get(row.day) ?? { revenue: 0, spend: 0, profit: 0 }
    entry.spend += row.amount_cents
    entry.profit -= row.amount_cents
    byDay.set(row.day, entry)
  }
  const profit = revenue - refunds - cogs - supplierShipping - fees - adSpend
  // Gross margin is what is left of revenue before a penny of ad spend: the
  // denominator of the breakeven line, so ad spend must stay out of it.
  const grossMargin = revenue - refunds - cogs - supplierShipping - fees
  const marginPercent = revenue ? Math.round((grossMargin / revenue) * 100) : 0
  const lines = roasLines(marginPercent)
  const roas = adSpend ? Math.round((revenue / adSpend) * 100) / 100 : null
  const verdict =
    roas === null || lines.breakevenRoas === null || lines.targetRoas === null
      ? null
      : roas >= lines.targetRoas
        ? ('scale' as const)
        : roas >= lines.breakevenRoas
          ? ('hold' as const)
          : ('cut' as const)
  return {
    days,
    revenueCents: revenue,
    refundsCents: refunds,
    cogsCents: cogs,
    supplierShippingCents: supplierShipping,
    feesCents: fees,
    adSpendCents: adSpend,
    profitCents: profit,
    orders: orders.length,
    roas,
    clicks,
    cpcCents: clicks ? Math.round(clickedSpend / clicks) : null,
    marginPercent,
    ...lines,
    verdict,
    spendDays: spendDays.size,
    perDay: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, entry]) => ({ day, ...entry })),
  }
}

/* ------------------------------------------------------------ tracking */

const CARRIERS: Array<{ id: string; name: string; test: RegExp; url: (tracking: string) => string }> = [
  { id: 'ups', name: 'UPS', test: /^1Z[0-9A-Z]{16}$/i, url: (tracking) => `https://www.ups.com/track?tracknum=${tracking}` },
  { id: 'usps', name: 'USPS', test: /^(94|93|92|91|95)\d{18,20}$|^[A-Z]{2}\d{9}US$/i, url: (tracking) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}` },
  { id: 'fedex', name: 'FedEx', test: /^\d{12}$|^\d{15}$|^\d{20}$/, url: (tracking) => `https://www.fedex.com/fedextrack/?trknbr=${tracking}` },
  { id: 'dhl', name: 'DHL', test: /^\d{10}$|^JD\d{18}$/i, url: (tracking) => `https://www.dhl.com/en/express/tracking.html?AWB=${tracking}` },
  { id: 'cainiao', name: 'Cainiao / AliExpress Standard', test: /^(LP|YT|CNP|ZA|SF)\w{10,}$/i, url: (tracking) => `https://global.cainiao.com/detail.htm?mailNoList=${tracking}` },
  { id: 'yunexpress', name: 'YunExpress', test: /^YT\d{16}$/i, url: (tracking) => `https://www.yuntrack.com/parcelTracking?id=${tracking}` },
  { id: 'universal', name: 'Universal postal', test: /^[A-Z]{2}\d{9}[A-Z]{2}$/i, url: (tracking) => `https://www.17track.net/en/track?nums=${tracking}` },
]

export function carrierFor(tracking: string, hint?: string) {
  const byHint = hint ? CARRIERS.find((carrier) => carrier.id === hint.toLowerCase() || carrier.name.toLowerCase().includes(hint.toLowerCase())) : null
  const carrier = byHint ?? CARRIERS.find((entry) => entry.test.test(tracking.trim())) ?? { id: 'other', name: 'Carrier', url: (value: string) => `https://www.17track.net/en/track?nums=${value}` }
  return { id: carrier.id, name: carrier.name, url: carrier.url(tracking.trim()) }
}

export type TrackingView = {
  order: Order
  steps: Array<{ key: string; label: string; at: string | null; done: boolean; detail?: string }>
  tracking: { number: string; carrier: string; url: string } | null
  estimate: { from: string; to: string } | null
  live: { status: string; subStatus: string; syncedAt: string | null; events: TrackingEvent[] } | null
}

export function trackingFor(db: Db, storeId: string, order: Order, snapshot?: TrackingSnapshot | null): TrackingView {
  const shipment = order.fulfillments.find((entry) => entry.tracking)
  const tracking = shipment ? (() => { const carrier = carrierFor(shipment.tracking, snapshot?.carrier || shipment.carrier); return { number: shipment.tracking, carrier: snapshot?.carrier || carrier.name, url: carrier.url } })() : null
  const first = order.items[0]
  const product = first ? getProduct(db, storeId, first.productId) : null
  const fallbackEstimate = product ? deliveryEstimate(product.supplier, order.createdAt) : null
  const estimate = snapshot?.estimate.from || snapshot?.estimate.to
    ? { from: snapshot.estimate.from ?? snapshot.estimate.to ?? '', to: snapshot.estimate.to ?? snapshot.estimate.from ?? '' }
    : fallbackEstimate
  const shippedAt = shipment?.createdAt ?? null
  const normalized = `${snapshot?.status ?? ''} ${snapshot?.subStatus ?? ''}`.toLowerCase()
  const inTransit = /transit|pickup|delivered|exception/.test(normalized)
  const delivered = Boolean(order.deliveredAt || /delivered/.test(normalized))
  return {
    order,
    tracking,
    estimate,
    live: snapshot ? { status: snapshot.status, subStatus: snapshot.subStatus, syncedAt: snapshot.syncedAt, events: snapshot.events } : null,
    steps: [
      { key: 'placed', label: 'Order placed', at: order.createdAt, done: true },
      { key: 'processing', label: 'Being prepared', at: order.supplierOrder.placedAt ?? null, done: Boolean(order.supplierOrder.placedAt || shippedAt || order.deliveredAt), detail: product?.supplier.processingDays ? `Usually ${product.supplier.processingDays} days` : undefined },
      { key: 'shipped', label: 'Shipped', at: shippedAt, done: Boolean(shippedAt || inTransit || delivered), detail: tracking ? `${tracking.carrier} ${tracking.number}` : undefined },
      { key: 'delivered', label: 'Delivered', at: order.deliveredAt ?? (delivered ? snapshot?.events[0]?.at ?? null : null), done: delivered, detail: estimate && !delivered ? `Estimated ${estimate.from} – ${estimate.to}` : undefined },
    ],
  }
}

/** "Order today, arrives Sep 12–16": processing plus the shipping window, skipping Sundays. */
export function deliveryEstimate(supplier: Supplier, fromIso = now()): { from: string; to: string; fromDate: Date; toDate: Date } {
  const processing = supplier.processingDays ?? 2
  const min = supplier.shippingDaysMin ?? 7
  const max = supplier.shippingDaysMax ?? 14
  const add = (days: number) => {
    const date = new Date(fromIso)
    let left = days
    while (left > 0) {
      date.setDate(date.getDate() + 1)
      if (date.getDay() !== 0) left--
    }
    return date
  }
  const fromDate = add(processing + min)
  const toDate = add(processing + max)
  const format = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return { from: format(fromDate), to: format(toDate), fromDate, toDate }
}

/* ------------------------------------------------------------ questions */

export type Question = { id: string; productId: string; question: string; answer: string; asker: string; email: string; status: 'pending' | 'answered' | 'hidden'; createdAt: string }

function rowToQuestion(row: Row): Question {
  return { id: row.id as string, productId: row.product_id as string, question: row.question as string, answer: row.answer as string, asker: row.asker as string, email: row.email as string, status: row.status as Question['status'], createdAt: row.created_at as string }
}

export function askQuestion(db: Db, storeId: string, input: { productId: string; question: string; asker?: string; email?: string }): Question {
  const questionId = id('q')
  db.insert('questions', { id: questionId, store_id: storeId, product_id: input.productId, question: input.question.trim().slice(0, 500), answer: '', asker: input.asker ?? '', email: input.email ?? '', status: 'pending', created_at: now() })
  return rowToQuestion(db.one('SELECT * FROM questions WHERE id = ?', questionId) as Row)
}

export function answerQuestion(db: Db, storeId: string, questionId: string, answer: string) {
  db.run("UPDATE questions SET answer = ?, status = 'answered' WHERE id = ? AND store_id = ?", answer.trim(), questionId, storeId)
}

export function hideQuestion(db: Db, storeId: string, questionId: string) {
  db.run("UPDATE questions SET status = 'hidden' WHERE id = ? AND store_id = ?", questionId, storeId)
}

export function listQuestions(db: Db, storeId: string, opts: { productId?: string; status?: string } = {}): Question[] {
  const where = ['store_id = ?']
  const params: unknown[] = [storeId]
  if (opts.productId) { where.push('product_id = ?'); params.push(opts.productId) }
  if (opts.status && opts.status !== 'all') { where.push('status = ?'); params.push(opts.status) }
  return db.all(`SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 200`, ...params).map(rowToQuestion)
}

/* ---------------------------------------------------------- stock alerts */

export function requestStockAlert(db: Db, storeId: string, variantId: string, email: string) {
  db.run('INSERT OR IGNORE INTO stock_alerts (id, store_id, variant_id, email, notified_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)', id('sa'), storeId, variantId, email.toLowerCase(), now())
}

export function pendingStockAlerts(db: Db, storeId: string) {
  return db.all<{ id: string; variant_id: string; email: string; created_at: string }>('SELECT id, variant_id, email, created_at FROM stock_alerts WHERE store_id = ? AND notified_at IS NULL ORDER BY created_at DESC', storeId)
}

export function markStockAlertsNotified(db: Db, ids: string[]) {
  for (const alertId of ids) db.run('UPDATE stock_alerts SET notified_at = ? WHERE id = ?', now(), alertId)
}

/* --------------------------------------------------------- social proof */

/** Real recent buyers, first name and city only, for the "someone just bought" popups. Never invented. */
export function recentPurchases(db: Db, storeId: string, limit = 10) {
  return listOrders(db, storeId, { status: 'completed', limit })
    .map((order) => {
      const line = order.items[0]
      const first = (order.address.name ?? order.email).split(/[\s@]/)[0] ?? 'Someone'
      return line ? { name: first.charAt(0).toUpperCase() + first.slice(1), city: order.address.city ?? '', product: line.title, productId: line.productId, image: line.image, at: order.createdAt } : null
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
}

export function viewersNow(db: Db, storeId: string, productId: string, minutes = 30): number {
  const from = new Date(Date.now() - minutes * 60000).toISOString()
  return db.one<{ c: number }>("SELECT COUNT(DISTINCT session_id) c FROM analytics_events WHERE store_id = ? AND product_id = ? AND type = 'view.product' AND created_at >= ?", storeId, productId, from)?.c ?? 0
}

/* -------------------------------------------------------- review import */

/**
 * Reviews come in as the CSV the review apps export — Loox, Judge.me and the
 * AliExpress scrapers share the same handful of columns under different
 * names. Photos come as URLs and are kept as URLs; a review that was imported
 * is marked so, never shown as verified.
 */
export function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []
  let field = ''
  let row: string[] = []
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index] as string
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index++ }
      else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') { row.push(field); field = '' }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(field); field = ''
      if (row.some((cell) => cell.trim())) rows.push(row)
      row = []
    } else field += char
  }
  if (field || row.length) { row.push(field); if (row.some((cell) => cell.trim())) rows.push(row) }
  const [header = [], ...body] = rows
  const keys = header.map((cell) => cell.trim().toLowerCase())
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, (cells[index] ?? '').trim()])))
}

const COLUMN_ALIASES: Record<string, string[]> = {
  rating: ['rating', 'stars', 'score', 'review_rating'],
  body: ['body', 'review', 'content', 'text', 'review_content', 'comment', 'review body'],
  title: ['title', 'review_title', 'headline'],
  author: ['author', 'name', 'reviewer', 'customer', 'reviewer_name', 'author name', 'nickname'],
  photos: ['photo_url', 'photos', 'image', 'images', 'picture_urls', 'photo', 'img', 'image_url', 'photo urls'],
  handle: ['product_handle', 'handle', 'product', 'product_id', 'product_url', 'sku'],
  date: ['created_at', 'date', 'review_date', 'created at'],
}

function column(row: Record<string, string>, key: string): string {
  for (const alias of COLUMN_ALIASES[key] ?? [key]) if (row[alias] !== undefined && row[alias] !== '') return row[alias] as string
  return ''
}

export function importReviews(db: Db, storeId: string, csv: string, opts: { productId?: string; status?: 'approved' | 'pending' } = {}): { imported: number; skipped: number; products: number } {
  const rows = parseCsv(csv)
  const products = listProducts(db, storeId, { limit: 1000 })
  const byHandle = new Map(products.flatMap((product) => [[product.handle, product], [product.id, product], [product.title.toLowerCase(), product]] as Array<[string, Product]>))
  let imported = 0
  let skipped = 0
  const touched = new Set<string>()
  for (const row of rows) {
    const body = column(row, 'body')
    const rating = Number(column(row, 'rating')) || 5
    const handleValue = column(row, 'handle').toLowerCase().split('/').pop() ?? ''
    const product = opts.productId ? getProduct(db, storeId, opts.productId) : byHandle.get(handleValue) ?? byHandle.get(column(row, 'handle').toLowerCase()) ?? null
    if (!product || !body) { skipped++; continue }
    const photos = column(row, 'photos').split(/[|;,\s]+/).map((entry) => entry.trim()).filter((entry) => /^https?:\/\/|^\/_uploads\//.test(entry))
    createReview(db, storeId, { productId: product.id, rating, title: column(row, 'title'), body, author: column(row, 'author') || 'Customer', media: photos, verified: false, status: opts.status ?? 'approved' })
    touched.add(product.id)
    imported++
  }
  return { imported, skipped, products: touched.size }
}

/* ------------------------------------------------------- product import */

export type ImportedProduct = { title: string; description: string; images: string[]; priceCents: number | null; currency: string; variants: Array<{ title: string; priceCents: number; compareAtCents?: number; inventory?: number; sku?: string; image?: string; sourceId?: string; sourceAliases?: string[]; optionValues?: Record<string, string> }>; options: Array<{ title: string; values: string[] }>; source: string; vendor?: string; metadata?: Record<string,string> }

/**
 * Import a product from a URL.
 *
 * Any Shopify store answers `/products/<handle>.json` with the whole product,
 * which is how the sourcing apps do it; that is tried first. Anything else
 * falls back to Open Graph and schema.org markup, which is enough for a
 * title, a price, a description and the pictures. The supplier link is kept.
 */
export async function importProductFromUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<ImportedProduct> {
  const source = new URL(url)
  const shopifyMatch = /\/products\/([^/?#]+)/.exec(source.pathname)
  if (shopifyMatch) {
    try {
      const jsonUrl = `${source.origin}/products/${shopifyMatch[1]}.json`
      const response = await fetchImpl(jsonUrl, { headers: { accept: 'application/json', 'user-agent': 'storemillImport/1.0' } })
      if (response.ok) {
        const payload = (await response.json()) as { product?: ShopifyProduct }
        if (payload.product) return fromShopify(payload.product, url)
      }
    } catch { /* fall through to the generic path */ }
  }
  const response = await fetchImpl(url, { headers: { 'user-agent': 'storemillImport/1.0', accept: 'text/html' } })
  if (!response.ok) throw new Error(`The page answered ${response.status}`)
  return fromHtml(await response.text(), url)
}

type ShopifyProduct = { title: string; body_html?: string; vendor?: string; images?: Array<{ id?: number; src: string }>; options?: Array<{ name: string; values: string[] }>; variants?: Array<{ id?: number; option1?: string; option2?: string; option3?: string; title: string; price: string; compare_at_price?: string; sku?: string; image_id?: number | null; featured_image?: { src?: string } | null }> }

function fromShopify(product: ShopifyProduct, url: string): ImportedProduct {
  const imagesById = new Map((product.images ?? []).flatMap((image) => image.id === undefined ? [] : [[image.id, image.src] as const]))
  const variants = (product.variants ?? []).map((variant) => {
    const image = variant.featured_image?.src || (variant.image_id === undefined || variant.image_id === null ? '' : imagesById.get(variant.image_id)) || ''
    return { title: variant.title, priceCents: Math.round(parseFloat(variant.price) * 100), ...(variant.compare_at_price && Number(variant.compare_at_price)>Number(variant.price)?{compareAtCents:Math.round(Number(variant.compare_at_price)*100)}:{}), ...(variant.id ? { sourceId: String(variant.id) } : {}), optionValues: Object.fromEntries((product.options ?? []).map((option, index) => [option.name, [variant.option1, variant.option2, variant.option3][index] || ''])), ...(variant.sku ? { sku: variant.sku } : {}), ...(image ? { image } : {}) }
  })
  return {
    title: product.title,
    description: stripHtml(product.body_html ?? ''),
    images: (product.images ?? []).map((image) => image.src).slice(0, 24),
    priceCents: variants[0]?.priceCents ?? null,
    currency: 'USD',
    variants,
    options: (product.options ?? []).filter((option) => option.name.toLowerCase() !== 'title').map((option) => ({ title: option.name, values: option.values })),
    source: url,
    ...(product.vendor ? { vendor: product.vendor } : {}),
  }
}

function fromHtml(html: string, url: string): ImportedProduct {
  const meta = (name: string) => new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']*)`, 'i').exec(html)?.[1] ?? new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${name}["']`, 'i').exec(html)?.[1] ?? ''
  const title = decode(meta('og:title') || /<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] || 'Imported product')
  const description = decode(meta('og:description') || meta('description'))
  const priceRaw = meta('product:price:amount') || meta('og:price:amount') || /"price"\s*:\s*"?([0-9]+(?:\.[0-9]+)?)/.exec(html)?.[1] || ''
  const currency = meta('product:price:currency') || meta('og:price:currency') || /"priceCurrency"\s*:\s*"([A-Z]{3})"/.exec(html)?.[1] || 'USD'
  const images = [...new Set([meta('og:image'), ...[...html.matchAll(/<img[^>]+src=["']([^"']+\.(?:avif|gif|jpe?g|png|webp)[^"']*)["']/gi)].map((match) => match[1] as string)].filter(Boolean).map((src) => { try { return new URL(src, url).toString() } catch { return '' } }).filter(Boolean))].slice(0, 24)
  const priceCents = priceRaw ? Math.round(parseFloat(priceRaw) * 100) : null
  return { title: title.replace(/\s+[-|–].{0,60}$/, '').trim(), description, images, priceCents, currency, variants: priceCents ? [{ title: 'Default', priceCents }] : [], options: [], source: url }
}

function stripHtml(input: string): string {
  return decode(input.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim()
}

function decode(input: string): string {
  return input.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').trim()
}

/**
 * Creates the product from an import, with a default markup when the supplier
 * price is the only price known.
 *
 * The markup is on the landed cost — the supplier's price plus their shipping
 * — not on the item alone. docs/knowledge/product-research.md asks for "at
 * least 3x landed cost (COGS + shipping)", and multiplying the item only put
 * $7 of freight through at cost: a $12 item at 2.5x came in at $29.99 against
 * a $19 landed cost, a 1.6x that no ad account can carry.
 */
export function createFromImport(
  db: Db,
  storeId: string,
  imported: ImportedProduct,
  opts: { markup?: number; asSupplier?: boolean; status?: 'draft' | 'published'; supplierShippingCents?: number } = {},
): Product {
  const markup = opts.markup ?? 3
  const supplierCost = opts.asSupplier ? (imported.priceCents ?? 0) : 0
  const supplierShipping = Math.max(0, Math.round(opts.supplierShippingCents ?? 0))
  const price = (cents: number) => (opts.asSupplier ? Math.max(100, Math.round(((cents + supplierShipping) * markup) / 100) * 100 - 1) : cents)
  const variants = imported.variants.length ? imported.variants.map((variant) => ({ title: variant.title, priceCents: price(variant.priceCents), ...(variant.compareAtCents!==undefined&&!opts.asSupplier?{compareAtCents:variant.compareAtCents}:{}), ...(variant.optionValues ? { optionValues: variant.optionValues } : {}), ...(variant.sku ? { sku: variant.sku } : {}), ...(variant.image ? { image: variant.image } : {}), inventory: variant.inventory ?? 100 })) : [{ title: 'Default', priceCents: price(imported.priceCents ?? 2999), inventory: 100 }]
  const product = createProduct(db, storeId, {
    title: imported.title,
    description: imported.description,
    status: opts.status ?? 'draft',
    heroImage: imported.images[0] ?? '',
    media: imported.images.map((url) => ({ url, alt: imported.title })),
    options: imported.options.map((option) => ({ title: option.title, values: option.values.map((value) => ({ value })) })),
    tags: ['imported'],
    metadata: imported.metadata ?? {},
    supplier: { url: imported.source, ...(imported.vendor ? { name: imported.vendor } : {}), ...(opts.asSupplier ? { costCents: supplierCost, shippingCents: supplierShipping, processingDays: 2, shippingDaysMin: 7, shippingDaysMax: 14 } : {}) },
    variants,
  })
  const mapping = Object.fromEntries(product.variants.flatMap((variant, index) => [...(imported.variants[index]?.sourceId ? [[`sourceVariant:${variant.id}`, imported.variants[index]!.sourceId!]] : []), ...(imported.variants[index]?.sourceAliases ? [[`sourceVariantAliases:${variant.id}`, JSON.stringify(imported.variants[index]!.sourceAliases)]] : [])]))
  if (Object.keys(mapping).length) {
    db.update('products', product.id, { metadata: { ...product.metadata, ...mapping } })
    return { ...product, metadata: { ...product.metadata, ...mapping } }
  }
  return product
}

export { json }
