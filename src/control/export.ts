import { now, type Db, type Row } from '../lib/db.ts'

export type StoreExport = {
  format: 'storemill-store-backup'
  version: 1
  exportedAt: string
  storeId: string
  tables: Record<string, Row[]>
}

/**
 * A portable, store-scoped backup. Authentication rows and web sessions are
 * deliberately excluded; sealed integration credentials remain sealed.
 */
export function exportStore(db: Db, storeId: string): StoreExport {
  if (!db.one('SELECT id FROM stores WHERE id = ?', storeId)) throw new Error('No such store')
  const tables: Record<string, Row[]> = {
    stores: db.all('SELECT * FROM stores WHERE id = ?', storeId),
  }
  const names = db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .map((row) => row.name)
  for (const table of names) {
    if (['stores', 'users', 'sessions', 'migrations', 'collection_products', 'shipping_options'].includes(table)) continue
    const columns = db.all<{ name: string }>(`PRAGMA table_info(${table})`)
    if (columns.some((column) => column.name === 'store_id')) tables[table] = db.all(`SELECT * FROM ${table} WHERE store_id = ?`, storeId)
  }
  tables.collection_products = db.all('SELECT cp.* FROM collection_products cp JOIN collections c ON c.id = cp.collection_id WHERE c.store_id = ?', storeId)
  tables.shipping_options = db.all('SELECT so.* FROM shipping_options so JOIN regions r ON r.id = so.region_id WHERE r.store_id = ?', storeId)
  return { format: 'storemill-store-backup', version: 1, exportedAt: now(), storeId, tables }
}
