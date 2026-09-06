import { now, type Db } from '../lib/db.ts'
import { logger } from '../lib/log.ts'
import { getCart, totals } from '../domain/cart.ts'
import { getStore } from '../control/stores.ts'
import { lineTotals } from './templates.ts'
import { sendEmail } from './send.ts'
import { publicStoreUrl } from '../lib/urls.ts'

const log = logger('abandoned')

/**
 * Abandoned-cart recovery. A cart that has an email (the shopper got as far
 * as the checkout form), has items, has not become an order, and has been
 * quiet for the window gets one email with its contents and a link back.
 * One, ever, per cart — the flag is on the row.
 */
export async function sweepAbandonedCarts(db: Db, opts: { hours?: number; origin?: string } = {}): Promise<number> {
  const cutoff = new Date(Date.now() - (opts.hours ?? 4) * 3600_000).toISOString()
  const rows = db.all<{ id: string; store_id: string; email: string }>(
    "SELECT id, store_id, email FROM carts WHERE email != '' AND order_id IS NULL AND abandon_emailed_at IS NULL AND items != '[]' AND updated_at < ? LIMIT 50",
    cutoff,
  )
  let sent = 0
  for (const row of rows) {
    const cart = getCart(db, row.store_id, row.id)
    const store = getStore(db, row.store_id)
    if (!cart || !store || !cart.items.length) continue
    const amounts = totals(db, row.store_id, cart)
    // The origin handed in is the deployment's — the admin host in the
    // documented setup — so a recovery link built from it sent the shopper to
    // the merchant's login page. The store's own address is the one it answers
    // at: its custom domain, its subdomain, or this origin's /s/<slug>.
    const base = publicStoreUrl(db, store)
    try {
      await sendEmail(db, row.store_id, {
        template: 'abandoned_cart',
        to: row.email,
        context: { cart: { items: lineTotals(cart.items, amounts.currency) }, cartUrl: `${base}/cart?resume=${cart.id}`, storeUrl: base },
      })
      sent++
    } catch (error) {
      log.warn(`could not email ${row.email}: ${error instanceof Error ? error.message : String(error)}`)
    }
    db.run('UPDATE carts SET abandon_emailed_at = ? WHERE id = ?', now(), row.id)
  }
  if (sent) log.info(`sent ${sent} abandoned-cart email(s)`)
  return sent
}
