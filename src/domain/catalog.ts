import { bool, json, now, type Db, type Row } from '../lib/db.ts'
import { handle as toHandle, id } from '../lib/ids.ts'
import type { Media, Product, ProductContent, ProductOption, Supplier, Variant } from './types.ts'

export function rowToVariant(row: Row): Variant {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    title: row.title as string,
    sku: row.sku as string,
    priceCents: row.price_cents as number,
    compareAtCents: (row.compare_at_cents as number | null) ?? null,
    inventory: row.inventory as number,
    allowBackorder: bool(row.allow_backorder),
    optionValues: json(row.option_values, {} as Record<string, string>),
    image: row.image as string,
    position: row.position as number,
  }
}

export function rowToProduct(row: Row, variants: Variant[]): Product {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    title: row.title as string,
    handle: row.handle as string,
    subtitle: row.subtitle as string,
    description: row.description as string,
    status: row.status as Product['status'],
    heroImage: row.hero_image as string,
    media: json(row.media, [] as Media[]),
    options: json(row.options, [] as ProductOption[]),
    metadata: json(row.metadata, {} as Record<string, string>),
    seo: json(row.seo, {}),
    tags: json(row.tags, [] as string[]),
    subscription: json(row.subscription, {}),
    content: json(row.content, {} as ProductContent),
    supplier: json(row.supplier, {} as Supplier),
    position: row.position as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    variants,
  }
}

function attach(db: Db, rows: Row[]): Product[] {
  if (!rows.length) return []
  const ids = rows.map((row) => row.id as string)
  const placeholders = ids.map(() => '?').join(', ')
  const variants = db.all(`SELECT * FROM variants WHERE product_id IN (${placeholders}) ORDER BY position, rowid`, ...ids)
  const byProduct = new Map<string, Variant[]>()
  for (const row of variants) {
    const variant = rowToVariant(row)
    const list = byProduct.get(variant.productId) ?? []
    list.push(variant)
    byProduct.set(variant.productId, list)
  }
  return rows.map((row) => rowToProduct(row, byProduct.get(row.id as string) ?? []))
}

export function listProducts(
  db: Db,
  storeId: string,
  opts: { status?: string; search?: string; limit?: number; collectionId?: string; includeHidden?: boolean } = {},
): Product[] {
  const where: string[] = ['p.store_id = ?']
  const params: unknown[] = [storeId]
  // Order bumps and shipping protection are products, so the cart and the
  // order can carry them, but they are not catalog: nothing lists them.
  if (!opts.includeHidden) where.push("json_extract(p.metadata, '$.hidden') IS NULL")
  if (opts.status && opts.status !== 'all') {
    where.push('p.status = ?')
    params.push(opts.status)
  }
  if (opts.search) {
    where.push('(p.title LIKE ? OR p.handle LIKE ? OR p.description LIKE ?)')
    const like = `%${opts.search}%`
    params.push(like, like, like)
  }
  const joinCollection = opts.collectionId
    ? 'JOIN collection_products cp ON cp.product_id = p.id AND cp.collection_id = ?'
    : ''
  if (opts.collectionId) params.unshift(opts.collectionId)
  const sql = `SELECT p.* FROM products p ${joinCollection} WHERE ${where.join(' AND ')} ORDER BY p.position, p.created_at DESC LIMIT ?`
  const rows = db.all(sql, ...params, opts.limit ?? 200)
  return attach(db, rows)
}

export function getProduct(db: Db, storeId: string, idOrHandle: string): Product | null {
  const row = db.one('SELECT * FROM products WHERE store_id = ? AND (id = ? OR handle = ?)', storeId, idOrHandle, idOrHandle)
  return row ? (attach(db, [row])[0] ?? null) : null
}

export type ProductInput = {
  title: string
  subtitle?: string
  description?: string
  status?: Product['status']
  heroImage?: string
  media?: Media[]
  options?: ProductOption[]
  metadata?: Record<string, string>
  seo?: { title?: string; description?: string }
  tags?: string[]
  subscription?: Product['subscription']
  content?: ProductContent
  supplier?: Supplier
  variants?: Array<Partial<Variant> & { title: string; priceCents: number }>
}

/** Creating a product creates its variants in the same transaction: a product
 * with no purchasable variant is not a product, it is a draft page. */
export function createProduct(db: Db, storeId: string, input: ProductInput): Product {
  const productId = id('prod')
  const timestamp = now()
  const uniqueHandle = ensureHandle(db, storeId, input.title)
  db.tx(() => {
    const count = db.one<{ c: number }>('SELECT COUNT(*) c FROM products WHERE store_id = ?', storeId)?.c ?? 0
    db.insert('products', {
      id: productId,
      store_id: storeId,
      title: input.title,
      handle: uniqueHandle,
      subtitle: input.subtitle ?? '',
      description: input.description ?? '',
      status: input.status ?? 'published',
      hero_image: input.heroImage ?? input.media?.[0]?.url ?? '',
      media: input.media ?? [],
      options: input.options ?? [],
      metadata: input.metadata ?? {},
      seo: input.seo ?? {},
      tags: input.tags ?? [],
      subscription: input.subscription ?? {},
      content: input.content ?? {},
      supplier: input.supplier ?? {},
      position: count,
      created_at: timestamp,
      updated_at: timestamp,
    })
    const variants = input.variants?.length ? input.variants : [{ title: 'Default', priceCents: 0 }]
    variants.forEach((variant, index) => {
      db.insert('variants', {
        id: variant.id ?? id('var'),
        product_id: productId,
        store_id: storeId,
        title: variant.title,
        sku: variant.sku ?? `${uniqueHandle.toUpperCase().replace(/-/g, '-').slice(0, 12)}-${index + 1}`,
        price_cents: variant.priceCents,
        compare_at_cents: variant.compareAtCents ?? null,
        inventory: variant.inventory ?? 25,
        allow_backorder: variant.allowBackorder ?? false,
        option_values: variant.optionValues ?? {},
        image: variant.image ?? '',
        position: index,
      })
    })
  })
  return getProduct(db, storeId, productId) as Product
}

export function updateProduct(db: Db, storeId: string, productId: string, patch: Partial<ProductInput>): Product {
  const existing = getProduct(db, storeId, productId)
  if (!existing) throw new Error(`No product ${productId}`)
  const values: Row = { updated_at: now() }
  if (patch.title !== undefined) values.title = patch.title
  if (patch.subtitle !== undefined) values.subtitle = patch.subtitle
  if (patch.description !== undefined) values.description = patch.description
  if (patch.status !== undefined) values.status = patch.status
  if (patch.heroImage !== undefined) values.hero_image = patch.heroImage
  if (patch.media !== undefined) values.media = patch.media
  if (patch.options !== undefined) values.options = patch.options
  if (patch.metadata !== undefined) values.metadata = { ...existing.metadata, ...patch.metadata }
  if (patch.seo !== undefined) values.seo = { ...existing.seo, ...patch.seo }
  if (patch.tags !== undefined) values.tags = patch.tags
  if (patch.subscription !== undefined) values.subscription = patch.subscription
  if (patch.content !== undefined) values.content = { ...existing.content, ...patch.content }
  if (patch.supplier !== undefined) values.supplier = { ...existing.supplier, ...patch.supplier }
  db.update('products', existing.id, values)
  return getProduct(db, storeId, existing.id) as Product
}

export function deleteProduct(db: Db, storeId: string, productId: string): boolean {
  const result = db.run('DELETE FROM products WHERE store_id = ? AND id = ?', storeId, productId)
  return Number(result.changes) > 0
}

export function addVariant(db: Db, storeId: string, productId: string, input: Partial<Variant> & { title: string; priceCents: number }): Variant {
  const product = getProduct(db, storeId, productId)
  if (!product) throw new Error(`No product ${productId}`)
  const variantId = input.id ?? id('var')
  db.insert('variants', {
    id: variantId,
    product_id: product.id,
    store_id: storeId,
    title: input.title,
    sku: input.sku ?? `${product.handle.toUpperCase().slice(0, 12)}-${product.variants.length + 1}`,
    price_cents: input.priceCents,
    compare_at_cents: input.compareAtCents ?? null,
    inventory: input.inventory ?? 25,
    allow_backorder: input.allowBackorder ?? false,
    option_values: input.optionValues ?? {},
    image: input.image ?? '',
    position: product.variants.length,
  })
  return rowToVariant(db.one('SELECT * FROM variants WHERE id = ?', variantId) as Row)
}

export function updateVariant(db: Db, storeId: string, variantId: string, patch: Partial<Variant>): Variant | null {
  const row = db.one('SELECT * FROM variants WHERE id = ? AND store_id = ?', variantId, storeId)
  if (!row) return null
  const values: Row = {}
  if (patch.title !== undefined) values.title = patch.title
  if (patch.sku !== undefined) values.sku = patch.sku
  if (patch.priceCents !== undefined) values.price_cents = patch.priceCents
  if (patch.compareAtCents !== undefined) values.compare_at_cents = patch.compareAtCents
  if (patch.inventory !== undefined) values.inventory = patch.inventory
  if (patch.allowBackorder !== undefined) values.allow_backorder = patch.allowBackorder
  if (patch.image !== undefined) values.image = patch.image
  if (patch.optionValues !== undefined) values.option_values = patch.optionValues
  db.update('variants', variantId, values)
  return rowToVariant(db.one('SELECT * FROM variants WHERE id = ?', variantId) as Row)
}

export function getVariant(db: Db, storeId: string, variantId: string): Variant | null {
  const row = db.one('SELECT * FROM variants WHERE id = ? AND store_id = ?', variantId, storeId)
  return row ? rowToVariant(row) : null
}

/**
 * Inventory moves only here. `allow_backorder` is the per-variant escape hatch
 * the admin exposes; without it a sold-out variant refuses the reservation
 * rather than letting the storefront oversell.
 */
/** Whether a reserve would succeed, without moving anything: the check a post-purchase offer needs before it charges. */
export function canReserve(db: Db, variantId: string, quantity: number): boolean {
  const row = db.one<{ inventory: number; allow_backorder: number }>('SELECT inventory, allow_backorder FROM variants WHERE id = ?', variantId)
  if (!row) return false
  return row.inventory >= quantity || bool(row.allow_backorder)
}

export function reserveInventory(db: Db, variantId: string, quantity: number): boolean {
  const row = db.one<{ inventory: number; allow_backorder: number }>(
    'SELECT inventory, allow_backorder FROM variants WHERE id = ?',
    variantId,
  )
  if (!row) return false
  if (row.inventory < quantity && !bool(row.allow_backorder)) return false
  db.run('UPDATE variants SET inventory = inventory - ? WHERE id = ?', quantity, variantId)
  return true
}

export function releaseInventory(db: Db, variantId: string, quantity: number) {
  db.run('UPDATE variants SET inventory = inventory + ? WHERE id = ?', quantity, variantId)
}

export function lowStock(db: Db, storeId: string, threshold = 5) {
  return db.all(
    `SELECT v.id, v.title, v.inventory, v.sku, p.title AS product_title, p.handle
     FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.store_id = ? AND v.inventory <= ? AND v.allow_backorder = 0
     ORDER BY v.inventory ASC LIMIT 20`,
    storeId,
    threshold,
  )
}

function ensureHandle(db: Db, storeId: string, title: string): string {
  const base = toHandle(title)
  let candidate = base
  let suffix = 2
  while (db.one('SELECT id FROM products WHERE store_id = ? AND handle = ?', storeId, candidate)) {
    candidate = `${base}-${suffix++}`
  }
  return candidate
}

/* ------------------------------------------------------------------ collections */

export type Collection = {
  id: string
  storeId: string
  title: string
  handle: string
  description: string
  image: string
  position: number
  productIds: string[]
}

export function listCollections(db: Db, storeId: string): Collection[] {
  const rows = db.all('SELECT * FROM collections WHERE store_id = ? ORDER BY position, title', storeId)
  return rows.map((row) => ({
    id: row.id as string,
    storeId,
    title: row.title as string,
    handle: row.handle as string,
    description: row.description as string,
    image: row.image as string,
    position: row.position as number,
    productIds: db
      .all<{ product_id: string }>('SELECT product_id FROM collection_products WHERE collection_id = ? ORDER BY position', row.id)
      .map((entry) => entry.product_id),
  }))
}

export function getCollection(db: Db, storeId: string, idOrHandle: string): Collection | null {
  const row = db.one('SELECT id FROM collections WHERE store_id = ? AND (id = ? OR handle = ?)', storeId, idOrHandle, idOrHandle)
  if (!row) return null
  return listCollections(db, storeId).find((collection) => collection.id === row.id) ?? null
}

export function createCollection(db: Db, storeId: string, input: { title: string; description?: string; image?: string; productIds?: string[] }): Collection {
  const collectionId = id('col')
  const count = db.one<{ c: number }>('SELECT COUNT(*) c FROM collections WHERE store_id = ?', storeId)?.c ?? 0
  let uniqueHandle = toHandle(input.title)
  let suffix = 2
  while (db.one('SELECT id FROM collections WHERE store_id = ? AND handle = ?', storeId, uniqueHandle)) {
    uniqueHandle = `${toHandle(input.title)}-${suffix++}`
  }
  db.tx(() => {
    db.insert('collections', {
      id: collectionId,
      store_id: storeId,
      title: input.title,
      handle: uniqueHandle,
      description: input.description ?? '',
      image: input.image ?? '',
      position: count,
      created_at: now(),
    })
    input.productIds?.forEach((productId, index) => {
      db.insert('collection_products', { collection_id: collectionId, product_id: productId, position: index })
    })
  })
  return getCollection(db, storeId, collectionId) as Collection
}

export function setCollectionProducts(db: Db, storeId: string, collectionId: string, productIds: string[], mode: 'set' | 'add' | 'remove' = 'set') {
  const collection = getCollection(db, storeId, collectionId)
  if (!collection) throw new Error(`No collection ${collectionId}`)
  // The ids reach here from a model or from something pasted into the admin,
  // and the insert had no store check: a hallucinated or another store's id
  // was accepted, counted in the collection, and then dropped by every read —
  // a collection that says five products and shows three.
  if (mode !== 'remove') {
    const mine = new Set(
      db.all<{ id: string }>(`SELECT id FROM products WHERE store_id = ? AND id IN (${productIds.map(() => '?').join(',') || "''"})`, storeId, ...productIds).map((row) => row.id),
    )
    const strangers = productIds.filter((productId) => !mine.has(productId))
    if (strangers.length) throw new Error(`Not products of this store: ${strangers.join(', ')}`)
  }
  db.tx(() => {
    if (mode === 'set') db.run('DELETE FROM collection_products WHERE collection_id = ?', collection.id)
    if (mode === 'remove') {
      for (const productId of productIds) {
        db.run('DELETE FROM collection_products WHERE collection_id = ? AND product_id = ?', collection.id, productId)
      }
      return
    }
    const start = mode === 'add' ? collection.productIds.length : 0
    productIds.forEach((productId, index) => {
      if (mode === 'add' && collection.productIds.includes(productId)) return
      db.run(
        'INSERT OR REPLACE INTO collection_products (collection_id, product_id, position) VALUES (?, ?, ?)',
        collection.id,
        productId,
        start + index,
      )
    })
  })
  return getCollection(db, storeId, collection.id) as Collection
}
