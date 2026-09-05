import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { customDefinition, type BlockDefinition, type CustomBlockInput, type CustomField } from './blocks.ts'

/**
 * Blocks a store defines for itself.
 *
 * The catalog is sixty-odd blocks; a page sometimes needs a section none of
 * them is. The owner, or the model working for them, can define one here:
 * a type, a name, the fields its settings panel shows, an HTML template
 * over those fields (the small language in blocks.ts#renderTemplate) and
 * its CSS. It then appears in the builder palette under "Custom", the
 * layout suggester can pick it, the page writers can add it, and it
 * renders through the same validated path as everything else. A block the
 * model writes is marked as such so the owner can see what it made.
 */
export type CustomBlock = CustomBlockInput & { id: string; storeId: string; source: 'owner' | 'model'; createdAt: string; updatedAt: string }

function rowToBlock(row: Row): CustomBlock {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    type: row.type as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    icon: (row.icon as string) || '✚',
    fields: json<CustomField[]>(row.fields, []),
    template: row.template as string,
    css: (row.css as string) ?? '',
    js: (row.js as string) ?? '',
    source: (row.source as CustomBlock['source']) ?? 'owner',
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function listCustomBlocks(db: Db, storeId: string): CustomBlock[] {
  return db.all('SELECT * FROM custom_blocks WHERE store_id = ? ORDER BY created_at', storeId).map(rowToBlock)
}

/**
 * Custom definitions are part of this personal owner's library, even when
 * they were first made while editing another asset. Prefer a local definition
 * when two assets happened to use the same type name.
 */
export function listAvailableCustomBlocks(db: Db, storeId: string): CustomBlock[] {
  const rows = db.all(
    `SELECT cb.* FROM custom_blocks cb
     JOIN stores source ON source.id = cb.store_id
     JOIN stores current ON current.id = ?
     WHERE source.owner_id = current.owner_id
     ORDER BY CASE WHEN cb.store_id = ? THEN 0 ELSE 1 END, cb.updated_at DESC`,
    storeId,
    storeId,
  ).map(rowToBlock)
  const seen = new Set<string>()
  return rows.filter((block) => seen.has(block.type) ? false : (seen.add(block.type), true))
}

export function getCustomBlock(db: Db, storeId: string, typeOrId: string): CustomBlock | null {
  const row = db.one('SELECT * FROM custom_blocks WHERE store_id = ? AND (type = ? OR id = ?)', storeId, typeOrId, typeOrId)
  return row ? rowToBlock(row) : null
}

export function slugType(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `custom-${slug || 'block'}`
}

/**
 * Creates or replaces a block. The definition is built once here so a bad
 * template is refused before it is stored, and rendered once with its
 * defaults so a template that throws never reaches a page.
 */
export function upsertCustomBlock(db: Db, storeId: string, input: Partial<CustomBlockInput> & { name: string; template: string; source?: CustomBlock['source'] }): CustomBlock {
  const type = input.type?.trim() || slugType(input.name)
  const candidate: CustomBlockInput = { type, name: input.name, description: input.description ?? '', icon: input.icon ?? '✚', fields: input.fields ?? [], template: input.template, css: input.css ?? '', js: input.js ?? '' }
  const definition = customDefinition(candidate)
  const defaults = Object.fromEntries(Object.entries(definition.schema).map(([key, field]) => [key, 'default' in field ? field.default : undefined]))
  definition.render(defaults, { storeName: 'Store', base: '', currency: 'USD', brand: {}, products: [], reviews: [], bundles: [] }, { id: 'probe', type, settings: defaults })
  const existing = getCustomBlock(db, storeId, type)
  const timestamp = now()
  if (existing) {
    db.run('UPDATE custom_blocks SET name = ?, description = ?, icon = ?, fields = ?, template = ?, css = ?, js = ?, source = ?, updated_at = ? WHERE id = ?', candidate.name, candidate.description, candidate.icon, JSON.stringify(candidate.fields), candidate.template, candidate.css, candidate.js, input.source ?? existing.source, timestamp, existing.id)
    return getCustomBlock(db, storeId, type) as CustomBlock
  }
  db.insert('custom_blocks', { id: id('cblk'), store_id: storeId, type, name: candidate.name, description: candidate.description, icon: candidate.icon, fields: candidate.fields, template: candidate.template, css: candidate.css, js: candidate.js, source: input.source ?? 'owner', created_at: timestamp, updated_at: timestamp })
  return getCustomBlock(db, storeId, type) as CustomBlock
}

export function deleteCustomBlock(db: Db, storeId: string, typeOrId: string) {
  db.run('DELETE FROM custom_blocks WHERE store_id = ? AND (type = ? OR id = ?)', storeId, typeOrId, typeOrId)
}

/** The store's blocks as definitions, skipping any whose stored template no longer validates. */
export function customDefinitions(db: Db, storeId: string): BlockDefinition[] {
  const out: BlockDefinition[] = []
  for (const block of listAvailableCustomBlocks(db, storeId)) {
    try { out.push(customDefinition(block)) } catch { /* a broken one is left out of the palette, never breaks a page */ }
  }
  return out
}

/** A catalog entry for the model: what the store's own blocks are, in one line each. */
export function customCatalog(db: Db, storeId: string): Array<{ type: string; name: string; description: string; fields: string[] }> {
  return listAvailableCustomBlocks(db, storeId).map((block) => ({ type: block.type, name: block.name, description: block.description ?? '', fields: block.fields.map((field) => field.key) }))
}
