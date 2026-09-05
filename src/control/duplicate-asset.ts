import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { readUpload, saveMediaUpload } from '../lib/uploads.ts'
import { listProducts } from '../domain/catalog.ts'
import { listFunnels } from '../domain/funnels.ts'
import { listPages } from '../pages/store.ts'
import { createBlankAsset } from './assets.ts'
import { environment, getStore, type Store } from './stores.ts'

/** Duplicate the editable design and catalog as a separate draft; transactional customer and payment data never enters the copy. */
export function duplicateAsset(db: Db, ownerId: string, sourceStoreId: string, input: { name?: string; origin?: string } = {}) {
  const source = getStore(db, sourceStoreId)
  if (!source || source.ownerId !== ownerId) throw new Error('Choose one of your own stores or funnels to duplicate')
  const name = input.name?.trim() || `${source.name} copy`
  if (name.length < 2 || name.length > 100) throw new Error('Give the duplicate a name between 2 and 100 characters')
  // This whitelist deliberately excludes plugins/credentials, customers, orders, carts, domains, analytics and publication snapshots.
  const tables = ['regions', 'products', 'variants', 'collections', 'pages', 'promotions', 'bundles', 'funnels', 'custom_blocks', 'redirects'] as const
  const rows = new Map<string, Row[]>(tables.map((table) => [table, db.all(`SELECT * FROM ${table} WHERE store_id = ? ORDER BY rowid`, source.id)]))
  rows.set('shipping_options', db.all('SELECT so.* FROM shipping_options so JOIN regions r ON r.id = so.region_id WHERE r.store_id = ? ORDER BY so.position', source.id))
  rows.set('collection_products', db.all('SELECT cp.* FROM collection_products cp JOIN collections c ON c.id = cp.collection_id WHERE c.store_id = ?', source.id))
  const draft = environment(db, source.id, 'draft')
  const brand = Object.keys(draft.brand).length ? draft.brand : source.brand
  const sourceHosts = new Set(db.all<{ hostname: string }>('SELECT hostname FROM domains WHERE store_id = ?', source.id).map((domain) => domain.hostname.toLowerCase()))
  const appOrigins = new Set<string>()
  for (const value of [input.origin, process.env.AMBORAS_PUBLIC_ORIGIN, `http://localhost:${process.env.PORT || 4100}`]) {
    try { if (value) appOrigins.add(new URL(value).origin) } catch { /* an unavailable deployment origin is not a navigation match */ }
  }
  const sourceRow = db.one('SELECT build, prompt, reference_image, reference_url FROM stores WHERE id = ?', source.id) as Row
  const copy = createBlankAsset(db, ownerId, { name, kind: source.kind, currency: source.currency })
  const replacements = new Map<string, string>([[source.id, copy.id]])
  const notes: string[] = []
  for (const entries of rows.values()) for (const row of entries) {
    if (typeof row.id === 'string') replacements.set(row.id, id(row.id.split('_')[0] || 'copy'))
  }
  for (const page of rows.get('pages') ?? []) {
    for (const block of json<Array<{ id?: string }>>(page.blocks, [])) if (block.id) replacements.set(block.id, id('blk'))
  }
  const allDesign = JSON.stringify({ rows: [...rows.values()], theme: draft.theme, brand, sourceRow })
  // Give the duplicate its own media files, so removing the original asset cannot break its images.
  for (const match of allDesign.matchAll(/\/_uploads\/[a-z0-9_]+\/up_[a-z0-9]+\.[a-z0-9]+/g)) {
    const url = match[0]
    if (replacements.has(url)) continue
    const upload = readUpload(url)
    if (!upload) { notes.push(`Could not copy missing media ${url}`); continue }
    try { replacements.set(url, saveMediaUpload({ name: url.split('/').at(-1) || 'media', type: upload.type, data: upload.data }, copy.id).url) }
    catch (error) { notes.push(`Could not copy media ${url}: ${error instanceof Error ? error.message : 'unreadable image'}`) }
  }
  // Longer tokens first prevents a store-id replacement from corrupting a still-unmapped upload path.
  const ordered = [...replacements].sort((a, b) => b[0].length - a[0].length)
  const stripAssetPrefix = (value: string) => {
    for (const prefix of [`/s/${source.slug}`, `/preview/${source.slug}`]) {
      if (value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}?`) || value.startsWith(`${prefix}#`)) return (value.slice(prefix.length).startsWith('/') ? '' : '/') + value.slice(prefix.length)
    }
    return value
  }
  const localDestination = (value: string) => {
    const relative = stripAssetPrefix(value)
    if (relative !== value) return relative
    try {
      const url = new URL(value)
      const path = `${url.pathname}${url.search}${url.hash}`
      if (sourceHosts.has(url.hostname.toLowerCase())) return stripAssetPrefix(path)
      const local = stripAssetPrefix(path)
      if (appOrigins.has(url.origin) && local !== path) return local
    } catch { /* ordinary text is not a navigation URL */ }
    return value
  }
  const rewrite = (value: unknown): unknown => {
    if (typeof value !== 'string') return value
    if (/^\s*[\[{]/.test(value)) {
      try {
        const walk = (entry: unknown): unknown => Array.isArray(entry) ? entry.map(walk) : entry && typeof entry === 'object' ? Object.fromEntries(Object.entries(entry).map(([key, part]) => [rewrite(key), walk(part)])) : rewrite(entry)
        return JSON.stringify(walk(JSON.parse(value)))
      } catch { /* HTML, CSS and plain copy can begin with brackets too */ }
    }
    let result = value
    // Store navigation without a deployment prefix, so it works in both the
    // duplicate's draft preview and its eventual public URL/custom domain.
    result = localDestination(result)
    result = result.replace(/<(?:a|area|button|input|form|div)\b[^>]*>/gi, (tag) => tag.replace(/(\s(?:href|action|formaction|data-copy-href|data-href|data-url)\s*=\s*)(["'])([\s\S]*?)\2/gi, (_attribute, prefix: string, quote: string, destination: string) => `${prefix}${quote}${localDestination(destination)}${quote}`))
    for (const [before, after] of ordered) result = result.split(before).join(after)
    return result
  }
  const rewriteJson = (value: unknown) => JSON.parse(rewrite(JSON.stringify(value)) as string) as unknown
  const timestamp = now()
  try {
    db.tx(() => {
      // createBlankAsset seeds one region. A design duplicate carries all configured markets/shipping options instead.
      if (rows.get('regions')?.length) db.run('DELETE FROM regions WHERE store_id = ?', copy.id)
      for (const table of [...tables, 'shipping_options', 'collection_products']) {
        for (const original of rows.get(table) ?? []) {
          const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [key, key === 'source_url' ? value : rewrite(value)]))
          if ('created_at' in row) row.created_at = timestamp
          if ('updated_at' in row) row.updated_at = timestamp
          if (table === 'pages' || table === 'products') row.status = 'draft'
          if (table === 'promotions') row.usage_count = 0
          db.insert(table, row)
        }
      }
      db.update('stores', copy.id, {
        brand: rewriteJson(brand),
        prompt: rewrite(sourceRow.prompt),
        build: rewrite(sourceRow.build),
        reference_image: rewrite(sourceRow.reference_image),
        reference_url: sourceRow.reference_url,
        status: 'draft',
      })
      const copyDraft = db.one<{ id: string }>("SELECT id FROM store_environments WHERE store_id = ? AND kind = 'draft'", copy.id) as { id: string }
      db.update('store_environments', copyDraft.id, {
        brand: rewriteJson(brand), theme: rewriteJson(draft.theme), build_state: 'ready', updated_at: timestamp,
        build_log: [{ at: timestamp, level: 'info', message: `Duplicated all ${rows.get('pages')?.length ?? 0} pages and ${rows.get('products')?.length ?? 0} products from ${source.name}. Connect this draft's payment provider before publishing.` }],
      })
    })
  } catch (error) {
    db.run('DELETE FROM stores WHERE id = ? AND owner_id = ?', copy.id, ownerId)
    throw error
  }
  return {
    store: getStore(db, copy.id) as Store,
    pages: listPages(db, copy.id),
    products: listProducts(db, copy.id, { includeHidden: true, limit: rows.get('products')?.length || 1 }),
    funnels: listFunnels(db, copy.id),
    notes,
  }
}
