import { now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'

export type TodoStatus = 'done' | 'in_progress' | 'waiting'
export type Todo = { id: string; key: string; label: string; detail: string; status: TodoStatus; href: string; position: number }

/**
 * The punch list is the dashboard's onboarding and its ongoing to-do list at
 * once — colour-coded by who is blocked: green done, amber the agent is
 * working, grey waiting on the merchant.
 */
const SEED: Array<Omit<Todo, 'id'>> = [
  { key: 'catalog', label: 'Swap the sample catalog for your own products', detail: 'Import a CSV or ask the assistant to add them.', status: 'waiting', href: '/products', position: 0 },
  { key: 'payments', label: 'Set up payments', detail: 'Connect Stripe so you can take real money.', status: 'waiting', href: '/settings/payments', position: 1 },
  { key: 'shipping', label: 'Check your shipping rates', detail: 'A region with a delivery rate lets checkout price the order.', status: 'waiting', href: '/settings', position: 3 },
  { key: 'publish', label: 'Publish your store', detail: 'Take the draft live at its address.', status: 'waiting', href: '/store', position: 4 },
]

export function seedTodos(db: Db, storeId: string) {
  for (const todo of SEED) {
    const existing = db.one<{ id: string; href: string; label: string; detail: string }>('SELECT id, href, label, detail FROM todos WHERE store_id = ? AND key = ?', storeId, todo.key)
    if (!existing) db.insert('todos', { id: id('todo'), store_id: storeId, ...todo })
    else if (existing.href !== todo.href || existing.label !== todo.label || existing.detail !== todo.detail) {
      db.run('UPDATE todos SET href = ?, label = ?, detail = ? WHERE id = ?', todo.href, todo.label, todo.detail, existing.id)
    }
  }
}

export function listTodos(db: Db, storeId: string): Todo[] {
  return db.all<Todo>("SELECT id, key, label, detail, status, href, position FROM todos WHERE store_id = ? AND key <> 'domain' ORDER BY position", storeId)
}

export function setTodo(db: Db, storeId: string, key: string, status: TodoStatus) {
  db.run('UPDATE todos SET status = ? WHERE store_id = ? AND key = ?', status, storeId, key)
}

/** Recomputed from the world, not from what the agent claims it did. */
export function refreshTodos(db: Db, storeId: string) {
  const products = db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND status = 'published'", storeId)?.c ?? 0
  const ownProducts = db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND json_extract(metadata, '$.sample') IS NULL", storeId)?.c ?? 0
  const plugins = db.one<{ c: number }>("SELECT COUNT(*) c FROM store_plugins WHERE store_id = ? AND plugin_id = 'stripe'", storeId)?.c ?? 0
  const shipping = db.one<{ c: number }>('SELECT COUNT(*) c FROM shipping_options o JOIN regions r ON r.id = o.region_id WHERE r.store_id = ?', storeId)?.c ?? 0
  const live = db.one<{ status: string }>('SELECT status FROM stores WHERE id = ?', storeId)?.status === 'live'
  setTodo(db, storeId, 'catalog', products > 0 && ownProducts > 0 ? 'done' : 'waiting')
  setTodo(db, storeId, 'payments', plugins > 0 ? 'done' : 'waiting')
  setTodo(db, storeId, 'shipping', shipping > 0 ? 'done' : 'waiting')
  setTodo(db, storeId, 'publish', live ? 'done' : 'waiting')
}

export function recordAudit(
  db: Db,
  input: { storeId: string | null; actorType: 'user' | 'agent' | 'system'; actorId?: string; action: string; target?: string; diff?: unknown },
) {
  db.insert('audit_log', {
    id: id('aud'),
    store_id: input.storeId,
    actor_type: input.actorType,
    actor_id: input.actorId ?? '',
    action: input.action,
    target: input.target ?? '',
    diff: input.diff ?? {},
    created_at: now(),
  })
}

export function listAudit(db: Db, storeId: string, limit = 50) {
  return db.all('SELECT * FROM audit_log WHERE store_id = ? ORDER BY created_at DESC LIMIT ?', storeId, limit)
}
