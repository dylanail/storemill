import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { releaseInventory, reserveInventory } from './catalog.ts'
import { getCart, totals as computeTotals, type Cart } from './cart.ts'
import { recordPurchase, upsertCustomer } from './customers.ts'
import { recordPromotionUse } from './promotions.ts'
import { convertCents, getRegion, toBaseCents } from './regions.ts'
import type { Address, LineItem, Order } from './types.ts'

export function rowToOrder(row: Row): Order {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    displayId: row.display_id as number,
    email: row.email as string,
    items: json(row.items, [] as LineItem[]),
    currency: row.currency as string,
    subtotalCents: row.subtotal_cents as number,
    discountCents: row.discount_cents as number,
    shippingCents: row.shipping_cents as number,
    taxCents: row.tax_cents as number,
    totalCents: row.total_cents as number,
    baseTotalCents: (row.base_total_cents as number | null) ?? row.total_cents as number,
    discountCode: row.discount_code as string,
    status: row.status as Order['status'],
    paymentStatus: row.payment_status as Order['paymentStatus'],
    fulfillmentStatus: row.fulfillment_status as Order['fulfillmentStatus'],
    address: json(row.address, {} as Address),
    fulfillments: json(row.fulfillments, []),
    refunds: json(row.refunds, []),
    paymentProvider: ((row.payment_provider as string) || 'demo') as Order['paymentProvider'],
    paymentIntentId: (row.payment_intent_id as string) ?? '',
    paymentCustomerId: (row.payment_customer_id as string) ?? '',
    paymentMethodId: (row.payment_method_id as string) ?? '',
    shippingOptionId: (row.shipping_option_id as string) ?? '',
    upsell: json(row.upsell, {}),
    downsell: json(row.downsell, {}),
    supplierOrder: json(row.supplier_order, {}),
    deliveredAt: (row.delivered_at as string | null) ?? null,
    notes: (row.notes as string) ?? '',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function listOrders(db: Db, storeId: string, opts: { status?: string; limit?: number; email?: string } = {}): Order[] {
  const where = ['store_id = ?']
  const params: unknown[] = [storeId]
  if (opts.status && opts.status !== 'all') {
    where.push('status = ?')
    params.push(opts.status)
  }
  if (opts.email) {
    where.push('email = ? COLLATE NOCASE')
    params.push(opts.email)
  }
  return db
    .all(`SELECT * FROM orders WHERE ${where.join(' AND ')} ORDER BY display_id DESC LIMIT ?`, ...params, opts.limit ?? 100)
    .map(rowToOrder)
}

export function getOrder(db: Db, storeId: string, orderId: string): Order | null {
  const row = db.one('SELECT * FROM orders WHERE store_id = ? AND (id = ? OR display_id = ?)', storeId, orderId, Number(orderId) || -1)
  return row ? rowToOrder(row) : null
}

export class CheckoutError extends Error {}

/**
 * Completing a cart is the one place inventory, promotions, the customer
 * record and the order all move together. It runs in a single transaction: a
 * payment that fails after inventory came down would otherwise leave a store
 * short of stock it still has on the shelf.
 */
export function completeCart(
  db: Db,
  storeId: string,
  cartId: string,
  input: {
    email: string
    name?: string
    address?: Address
    marketing?: boolean
    payment?: { provider: 'demo' | 'stripe'; intentId?: string; customerId?: string; methodId?: string; status?: Order['paymentStatus'] }
  },
): Order {
  const cart = getCart(db, storeId, cartId)
  if (!cart) throw new CheckoutError('No cart')
  if (cart.orderId) return getOrder(db, storeId, cart.orderId) as Order
  if (!cart.items.length) throw new CheckoutError('Your cart is empty')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw new CheckoutError('Enter a valid email address')

  const priorOrders = db.one<{ c: number }>('SELECT COUNT(*) c FROM orders WHERE store_id = ? AND email = ? COLLATE NOCASE', storeId, input.email)?.c ?? 0
  const amounts = computeTotals(db, storeId, cart, { isFirstOrder: priorOrders === 0 })

  const orderId = id('order')
  const timestamp = now()
  const region = cart.regionId ? getRegion(db, storeId, cart.regionId) : null
  const sourceCurrency = db.one<{ currency: string }>('SELECT currency FROM stores WHERE id = ?', storeId)?.currency ?? 'USD'
  const localizedItems = cart.items.map((item) => ({ ...item, unitCents: convertCents(item.unitCents, region, sourceCurrency) }))
  return db.tx(() => {
    const reserved: LineItem[] = []
    for (const item of cart.items) {
      if (!reserveInventory(db, item.variantId, item.quantity)) {
        for (const done of reserved) releaseInventory(db, done.variantId, done.quantity)
        throw new CheckoutError(`${item.title} — ${item.variantTitle} is out of stock`)
      }
      reserved.push(item)
    }
    const nextDisplay = (db.one<{ max: number | null }>('SELECT MAX(display_id) max FROM orders WHERE store_id = ?', storeId)?.max ?? 1000) + 1
    const customer = upsertCustomer(db, storeId, {
      email: input.email,
      ...(input.name ? { name: input.name } : {}),
      ...(input.address ? { address: input.address } : {}),
      ...(input.marketing === undefined ? {} : { marketing: input.marketing }),
    })
    db.insert('orders', {
      id: orderId,
      store_id: storeId,
      display_id: nextDisplay,
      email: input.email.toLowerCase(),
      customer_id: customer.id,
      items: localizedItems,
      currency: amounts.currency,
      subtotal_cents: amounts.subtotalCents,
      discount_cents: amounts.discountCents,
      shipping_cents: amounts.shippingCents,
      tax_cents: amounts.taxCents,
      total_cents: amounts.totalCents,
      base_total_cents: toBaseCents(amounts.totalCents, region, sourceCurrency),
      discount_code: cart.discountCode,
      status: 'completed',
      // Demo orders capture on completion. A Stripe order arrives here only
      // after the PaymentIntent succeeded, so it is captured too; the webhook
      // is the second opinion that can also move it to refunded.
      payment_status: input.payment?.status ?? 'captured',
      fulfillment_status: 'unfulfilled',
      address: input.address ?? {},
      fulfillments: [],
      refunds: [],
      payment_provider: input.payment?.provider ?? 'demo',
      payment_intent_id: input.payment?.intentId ?? '',
      payment_customer_id: input.payment?.customerId ?? '',
      payment_method_id: input.payment?.methodId ?? '',
      shipping_option_id: amounts.shippingOptionId,
      upsell: {},
      created_at: timestamp,
      updated_at: timestamp,
    })
    recordPurchase(db, customer.id, toBaseCents(amounts.totalCents, region, sourceCurrency))
    recordPromotionUse(db, amounts.appliedPromotions.map((entry) => entry.id))
    db.update('carts', cart.id, { order_id: orderId, email: input.email, updated_at: timestamp })
    return getOrder(db, storeId, orderId) as Order
  })
}

export function orderByPaymentIntent(db: Db, storeId: string, intentId: string): Order | null {
  const row = db.one('SELECT * FROM orders WHERE store_id = ? AND payment_intent_id = ?', storeId, intentId)
  return row ? rowToOrder(row) : null
}

export function setPaymentStatus(db: Db, storeId: string, orderId: string, status: Order['paymentStatus']) {
  db.run('UPDATE orders SET payment_status = ?, updated_at = ? WHERE id = ? AND store_id = ?', status, now(), orderId, storeId)
}

/**
 * The post-purchase offer. Accepting adds the line to the same order and
 * charges it — off-session against the saved method on Stripe, on the spot in
 * demo mode. Declining is recorded too, so the offer is shown exactly once.
 */
export function recordUpsell(
  db: Db,
  storeId: string,
  orderId: string,
  outcome: { offered: string; accepted: boolean; line?: LineItem; amountCents?: number; baseAmountCents?: number; paymentIntentId?: string },
): Order {
  const order = getOrder(db, storeId, orderId)
  if (!order) throw new Error('No order')
  const items = outcome.accepted && outcome.line ? [...order.items, outcome.line] : order.items
  const extra = outcome.accepted ? (outcome.amountCents ?? 0) : 0
  const baseExtra = outcome.accepted ? (outcome.baseAmountCents ?? extra) : 0
  db.tx(() => {
    // completeCart refuses a checkout when the stock is not there; the
    // post-purchase offer threw the same answer away and charged the saved
    // card anyway, leaving negative inventory and a line nobody could ship.
    if (outcome.accepted && outcome.line && !reserveInventory(db, outcome.line.variantId, outcome.line.quantity)) {
      throw new CheckoutError('That is out of stock.')
    }
    db.update('orders', order.id, {
      items,
      subtotal_cents: order.subtotalCents + extra,
      total_cents: order.totalCents + extra,
      base_total_cents: order.baseTotalCents + baseExtra,
      upsell: { offered: outcome.offered, accepted: outcome.accepted, ...(outcome.line ? { variantId: outcome.line.variantId } : {}), amountCents: extra, ...(outcome.paymentIntentId ? { paymentIntentId: outcome.paymentIntentId } : {}) },
      updated_at: now(),
    })
  })
  return getOrder(db, storeId, order.id) as Order
}

export function recordDownsell(db: Db, storeId: string, orderId: string, outcome: { offered: string; accepted: boolean; line?: LineItem; amountCents?: number; baseAmountCents?: number }): Order {
  const order = getOrder(db, storeId, orderId)
  if (!order) throw new Error('No order')
  const extra = outcome.accepted ? (outcome.amountCents ?? 0) : 0
  const baseExtra = outcome.accepted ? (outcome.baseAmountCents ?? extra) : 0
  db.tx(() => {
    if (outcome.accepted && outcome.line && !reserveInventory(db, outcome.line.variantId, outcome.line.quantity)) {
      throw new CheckoutError('That is out of stock.')
    }
    db.update('orders', order.id, {
      items: outcome.accepted && outcome.line ? [...order.items, outcome.line] : order.items,
      subtotal_cents: order.subtotalCents + extra,
      total_cents: order.totalCents + extra,
      base_total_cents: order.baseTotalCents + baseExtra,
      downsell: { offered: outcome.offered, accepted: outcome.accepted, ...(outcome.line ? { variantId: outcome.line.variantId } : {}), amountCents: extra },
      updated_at: now(),
    })
  })
  return getOrder(db, storeId, order.id) as Order
}

/** The supplier side of an order: placed with whom, for how much, and how it moves. */
export function recordSupplierOrder(db: Db, storeId: string, orderId: string, input: { supplier?: string; orderId?: string; costCents?: number; shippingCents?: number; carrier?: string; tracking?: string }): Order {
  const order = getOrder(db, storeId, orderId)
  if (!order) throw new Error('No order')
  const supplierOrder = { ...order.supplierOrder, ...input, placedAt: order.supplierOrder.placedAt ?? now() }
  delete (supplierOrder as { tracking?: string }).tracking
  db.update('orders', order.id, { supplier_order: supplierOrder, updated_at: now() })
  if (input.tracking) return fulfillOrder(db, storeId, order.id, { provider: input.supplier ?? 'supplier', tracking: input.tracking, ...(input.carrier ? { carrier: input.carrier } : {}) })
  return getOrder(db, storeId, order.id) as Order
}

export function markDelivered(db: Db, storeId: string, orderId: string): Order {
  db.run("UPDATE orders SET fulfillment_status = 'delivered', delivered_at = ?, updated_at = ? WHERE id = ? AND store_id = ?", now(), now(), orderId, storeId)
  return getOrder(db, storeId, orderId) as Order
}

export function fulfillOrder(db: Db, storeId: string, orderId: string, input: { provider?: string; tracking?: string; carrier?: string } = {}): Order {
  const order = getOrder(db, storeId, orderId)
  if (!order) throw new Error('No order')
  const fulfillments = [
    ...order.fulfillments,
    { id: id('ful'), provider: input.provider ?? 'manual', tracking: input.tracking ?? '', ...(input.carrier ? { carrier: input.carrier } : {}), createdAt: now() },
  ]
  db.update('orders', order.id, { fulfillments, fulfillment_status: input.tracking ? 'shipped' : 'fulfilled', updated_at: now() })
  return getOrder(db, storeId, order.id) as Order
}

export function refundOrder(db: Db, storeId: string, orderId: string, input: { amountCents?: number; reason?: string } = {}): Order {
  const order = getOrder(db, storeId, orderId)
  if (!order) throw new Error('No order')
  const alreadyRefunded = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
  const amount = Math.min(input.amountCents ?? order.totalCents - alreadyRefunded, order.totalCents - alreadyRefunded)
  if (amount <= 0) throw new Error('Nothing left to refund on this order')
  const refunds = [...order.refunds, { id: id('ref'), amountCents: amount, reason: input.reason ?? '', createdAt: now() }]
  const total = alreadyRefunded + amount
  db.update('orders', order.id, {
    refunds,
    payment_status: total >= order.totalCents ? 'refunded' : 'partially_refunded',
    updated_at: now(),
  })
  return getOrder(db, storeId, order.id) as Order
}

export function cancelOrder(db: Db, storeId: string, orderId: string): Order {
  const order = getOrder(db, storeId, orderId)
  if (!order) throw new Error('No order')
  if (order.status === 'cancelled') return order
  db.tx(() => {
    for (const item of order.items) releaseInventory(db, item.variantId, item.quantity)
    db.update('orders', order.id, { status: 'cancelled', fulfillment_status: 'unfulfilled', updated_at: now() })
  })
  return getOrder(db, storeId, order.id) as Order
}

export function returnOrder(db: Db, storeId: string, orderId: string, reason = ''): Order {
  const order = getOrder(db, storeId, orderId)
  if (!order) throw new Error('No order')
  // Idempotent, the way cancelOrder is. Without this a second call put every
  // line back into inventory again and only then hit "Nothing left to refund",
  // so the stock was already wrong by the time anything complained.
  if (order.fulfillmentStatus === 'returned') return order
  db.tx(() => {
    for (const item of order.items) releaseInventory(db, item.variantId, item.quantity)
    db.update('orders', order.id, { fulfillment_status: 'returned', updated_at: now() })
  })
  return refundOrder(db, storeId, orderId, { reason: reason || 'Return accepted' })
}

export function salesSummary(db: Db, storeId: string, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString()
  const rows = db.all<{ day: string; orders: number; revenue: number }>(
    `SELECT substr(created_at, 1, 10) day, COUNT(*) orders, SUM(COALESCE(base_total_cents, total_cents)) revenue
     FROM orders WHERE store_id = ? AND created_at >= ? AND status != 'cancelled'
     GROUP BY day ORDER BY day`,
    storeId,
    since,
  )
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  const orders = rows.reduce((sum, row) => sum + row.orders, 0)
  return { series: rows, revenueCents: revenue, orders, aovCents: orders ? Math.round(revenue / orders) : 0 }
}

export type { Cart }
