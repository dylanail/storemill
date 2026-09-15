import { now, type Db } from '../lib/db.ts'
import { logger } from '../lib/log.ts'
import { getStore } from '../control/stores.ts'
import { getProduct } from '../domain/catalog.ts'
import { publicStoreUrl } from '../lib/urls.ts'
import { sendEmail } from './send.ts'

const log = logger('reviews')
const sweeping = new WeakSet<Db>()

/**
 * The review request the admin promises.
 *
 * Marking an order delivered told the merchant "the review request goes out a
 * week from now", and nothing sent it: the `review_request` template carries
 * `delayHours: 168` and the only thing that ever used it was the manual
 * `request_reviews` tool. This is the sweep that makes the sentence true —
 * one ask per order, ever, recorded on the row the way abandoned carts are.
 */
export async function sweepReviewRequests(db: Db, opts: { hours?: number; limit?: number } = {}): Promise<number> {
  if (sweeping.has(db)) return 0
  sweeping.add(db)
  try { return await sweep(db, opts) } finally { sweeping.delete(db) }
}

async function sweep(db: Db, opts: { hours?: number; limit?: number }): Promise<number> {
  const cutoff = new Date(Date.now() - (opts.hours ?? 168) * 3600_000).toISOString()
  const rows = db.all<{ id: string; store_id: string; email: string; items: string }>(
    `SELECT id, store_id, email, items FROM orders
     WHERE delivered_at IS NOT NULL AND delivered_at < ? AND review_requested_at IS NULL AND email != '' AND status != 'cancelled'
     ORDER BY delivered_at LIMIT ?`,
    cutoff,
    opts.limit ?? 50,
  )
  let sent = 0
  for (const row of rows) {
    const store = getStore(db, row.store_id)
    const first = (JSON.parse(row.items || '[]') as Array<{ productId: string; title: string }>)[0]
    if (!store || !first) {
      db.run('UPDATE orders SET review_requested_at = ? WHERE id = ?', now(), row.id)
      continue
    }
    const handle = getProduct(db, row.store_id, first.productId)?.handle ?? ''
    try {
      const result = await sendEmail(db, row.store_id, {
        template: 'review_request',
        to: row.email,
        context: { product: { title: first.title }, reviewUrl: `${publicStoreUrl(db, store)}/products/${handle}#review` },
      })
      if (result.status !== 'sent') continue
      sent++
    } catch (error) {
      log.warn(`could not ask ${row.email}: ${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    db.run('UPDATE orders SET review_requested_at = ? WHERE id = ?', now(), row.id)
  }
  if (sent) log.info(`asked for ${sent} review(s)`)
  return sent
}
