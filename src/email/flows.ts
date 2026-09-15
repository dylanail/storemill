import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { getStore } from '../control/stores.ts'
import { getCart, totals } from '../domain/cart.ts'
import { getOrder } from '../domain/orders.ts'
import { lineTotals } from './templates.ts'
import { orderContext, sendCustomEmail } from './send.ts'

export type FlowTrigger = 'welcome' | 'abandoned_cart' | 'post_purchase' | 'win_back'
export type MarketingFlow = {
  id: string
  storeId: string
  name: string
  trigger: FlowTrigger
  delayHours: number
  subject: string
  body: string
  status: 'active' | 'paused'
  sentCount: number
  createdAt: string
  updatedAt: string
}

const DEFAULTS: Array<Omit<MarketingFlow, 'id' | 'storeId' | 'sentCount' | 'createdAt' | 'updatedAt'>> = [
  { name: 'Welcome new subscribers', trigger: 'welcome', delayHours: 0, status: 'active', subject: 'Welcome to {{store.name}}', body: '<h1>Welcome, {{customer.firstName}}</h1><p>Thanks for joining us. You will hear about useful launches and offers—not inbox filler.</p><p><a class="btn" href="{{storeUrl}}">Visit the store</a></p>' },
  { name: 'Recover abandoned checkouts', trigger: 'abandoned_cart', delayHours: 4, status: 'active', subject: 'You left something at {{store.name}}', body: '<h1>Your cart is still here</h1><p>Pick up where you left off.</p><table class="items">{{#each cart.items}}<tr><td>{{title}}</td><td class="amt">{{lineTotal}}</td></tr>{{/each}}</table><p><a class="btn" href="{{cartUrl}}">Return to checkout</a></p>' },
  { name: 'Post-purchase follow-up', trigger: 'post_purchase', delayHours: 48, status: 'active', subject: 'How is order #{{order.displayId}} going?', body: '<h1>Checking in</h1><p>We hope everything with order #{{order.displayId}} is going well. You can see its latest delivery status below.</p><p><a class="btn" href="{{orderUrl}}">Track the order</a></p>' },
  { name: 'Win back past customers', trigger: 'win_back', delayHours: 720, status: 'active', subject: 'A quick hello from {{store.name}}', body: '<h1>It has been a while</h1><p>Come see what is new since your last order.</p><p><a class="btn" href="{{storeUrl}}">See what is new</a></p>' },
]

function rowToFlow(row: Row): MarketingFlow {
  return {
    id: row.id as string, storeId: row.store_id as string, name: row.name as string,
    trigger: row.trigger_kind as FlowTrigger, delayHours: row.delay_hours as number,
    subject: row.subject as string, body: row.body as string,
    status: row.status as MarketingFlow['status'], sentCount: row.sent_count as number,
    createdAt: row.created_at as string, updatedAt: row.updated_at as string,
  }
}

export function ensureDefaultFlows(db: Db, storeId: string): void {
  const timestamp = now()
  for (const flow of DEFAULTS) {
    db.run(
      `INSERT OR IGNORE INTO marketing_flows
       (id, store_id, name, trigger_kind, delay_hours, subject, body, status, sent_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      id('mf'), storeId, flow.name, flow.trigger, flow.delayHours, flow.subject, flow.body, flow.status, timestamp, timestamp,
    )
  }
}

export function listFlows(db: Db, storeId: string): MarketingFlow[] {
  ensureDefaultFlows(db, storeId)
  return db.all(
    `SELECT * FROM marketing_flows WHERE store_id = ? ORDER BY CASE trigger_kind
      WHEN 'welcome' THEN 1 WHEN 'abandoned_cart' THEN 2 WHEN 'post_purchase' THEN 3 WHEN 'win_back' THEN 4 ELSE 5 END`,
    storeId,
  ).map(rowToFlow)
}

export function updateFlow(db: Db, storeId: string, flowId: string, input: Partial<Pick<MarketingFlow, 'name' | 'delayHours' | 'subject' | 'body' | 'status'>>): MarketingFlow {
  const values: Record<string, unknown> = { updated_at: now() }
  if (input.name !== undefined) values.name = input.name
  if (input.delayHours !== undefined) values.delay_hours = Math.max(0, Math.round(input.delayHours))
  if (input.subject !== undefined) values.subject = input.subject
  if (input.body !== undefined) values.body = input.body
  if (input.status !== undefined) values.status = input.status
  const row = db.one<Row>('SELECT * FROM marketing_flows WHERE id = ? AND store_id = ?', flowId, storeId)
  if (!row) throw new Error('No such marketing flow')
  db.update('marketing_flows', flowId, values)
  return rowToFlow(db.one('SELECT * FROM marketing_flows WHERE id = ?', flowId) as Row)
}

type Candidate = { key: string; to: string; context: Record<string, unknown> }

function candidates(db: Db, flow: MarketingFlow, origin: string): Candidate[] {
  const store = getStore(db, flow.storeId)
  if (!store) return []
  const cutoff = new Date(Date.now() - flow.delayHours * 3600_000).toISOString()
  const storeUrl = `${origin}/s/${store.slug}`
  if (flow.trigger === 'welcome') {
    return db.all<{ id: string; email: string; name: string }>(
      'SELECT id, email, name FROM customers WHERE store_id = ? AND marketing = 1 AND created_at >= ? AND created_at <= ? ORDER BY created_at LIMIT 100', flow.storeId, flow.createdAt, cutoff,
    ).map((row) => ({ key: `customer:${row.id}`, to: row.email, context: { customer: { firstName: (row.name || row.email).split(/[\s@]/)[0] }, storeUrl } }))
  }
  if (flow.trigger === 'abandoned_cart') {
    return db.all<{ id: string; email: string; checkout: string }>(
      "SELECT id, email, checkout FROM carts WHERE store_id = ? AND email != '' AND order_id IS NULL AND items != '[]' AND created_at >= ? AND updated_at <= ? ORDER BY updated_at LIMIT 100", flow.storeId, flow.createdAt, cutoff,
    ).flatMap((row) => {
      if (!json(row.checkout, {} as { marketing?: boolean }).marketing) return []
      const cart = getCart(db, flow.storeId, row.id)
      if (!cart) return []
      const amounts = totals(db, flow.storeId, cart)
      return [{ key: `cart:${row.id}`, to: row.email, context: { cart: { items: lineTotals(cart.items, amounts.currency) }, cartUrl: `${storeUrl}/cart?resume=${cart.id}`, storeUrl } }]
    })
  }
  if (flow.trigger === 'post_purchase') {
    return db.all<{ id: string; email: string }>(
      `SELECT o.id, o.email FROM orders o JOIN customers c ON c.id = o.customer_id
       WHERE o.store_id = ? AND c.marketing = 1 AND o.status != 'cancelled' AND o.created_at >= ? AND o.created_at <= ? ORDER BY o.created_at LIMIT 100`, flow.storeId, flow.createdAt, cutoff,
    ).flatMap((row) => {
      const order = getOrder(db, flow.storeId, row.id)
      return order ? [{ key: `order:${row.id}`, to: row.email, context: orderContext(order, storeUrl) }] : []
    })
  }
  return db.all<{ id: string; email: string; name: string; last_order: string }>(
    `SELECT c.id, c.email, c.name, MAX(o.created_at) last_order FROM customers c JOIN orders o ON o.customer_id = c.id
     WHERE c.store_id = ? AND c.marketing = 1 AND o.status != 'cancelled'
     GROUP BY c.id HAVING MAX(o.created_at) >= ? AND MAX(o.created_at) <= ? ORDER BY last_order LIMIT 100`, flow.storeId, flow.createdAt, cutoff,
  ).map((row) => ({ key: `customer:${row.id}:${row.last_order.slice(0, 10)}`, to: row.email, context: { customer: { firstName: (row.name || row.email).split(/[\s@]/)[0] }, storeUrl } }))
}

export async function runFlow(db: Db, flow: MarketingFlow, origin = ''): Promise<number> {
  if (flow.status !== 'active') return 0
  let sent = 0
  for (const candidate of candidates(db, flow, origin)) {
    const deliveryId = id('mfd')
    const claim = db.run(
      `INSERT OR IGNORE INTO marketing_flow_deliveries
       (id, store_id, flow_id, event_key, recipient, status, error, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', '', ?)`,
      deliveryId, flow.storeId, flow.id, candidate.key, candidate.to, now(),
    )
    if (!Number(claim.changes)) continue
    try {
      const result = await sendCustomEmail(db, flow.storeId, {
        template: `flow:${flow.trigger}`, to: candidate.to, subject: flow.subject, body: flow.body, context: candidate.context,
      })
      db.update('marketing_flow_deliveries', deliveryId, {
        status: result.status, email_send_id: result.id, error: result.status === 'failed' ? 'Email delivery failed' : '',
        ...(result.status === 'sent' ? { sent_at: now() } : {}),
      })
      if (result.status === 'sent') {
        db.run('UPDATE marketing_flows SET sent_count = sent_count + 1, updated_at = ? WHERE id = ?', now(), flow.id)
        sent++
      }
    } catch (error) {
      db.update('marketing_flow_deliveries', deliveryId, { status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
  }
  return sent
}

export async function sweepMarketingFlows(db: Db, opts: { storeId?: string; origin?: string } = {}): Promise<number> {
  const stores = opts.storeId ? [{ id: opts.storeId }] : db.all<{ id: string }>('SELECT id FROM stores')
  let sent = 0
  for (const store of stores) {
    for (const flow of listFlows(db, store.id)) sent += await runFlow(db, flow, opts.origin ?? '')
  }
  return sent
}

export function recentFlowDeliveries(db: Db, storeId: string, limit = 30) {
  return db.all<{ flow_name: string; recipient: string; status: string; created_at: string; sent_at: string | null }>(
    `SELECT f.name flow_name, d.recipient, d.status, d.created_at, d.sent_at
     FROM marketing_flow_deliveries d JOIN marketing_flows f ON f.id = d.flow_id
     WHERE d.store_id = ? ORDER BY d.created_at DESC LIMIT ?`, storeId, limit,
  )
}
