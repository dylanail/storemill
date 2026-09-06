import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import type { BlockInstance } from './blocks.ts'

export type BlockPreset = {
  id: string
  ownerId: string
  sourceStoreId: string
  name: string
  type: string
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

function rowToPreset(row: Row): BlockPreset {
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    sourceStoreId: (row.source_store_id as string) ?? '',
    name: row.name as string,
    type: row.block_type as string,
    settings: json(row.settings, {} as Record<string, unknown>),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function listBlockPresets(db: Db, ownerId: string): BlockPreset[] {
  return db.all('SELECT * FROM block_presets WHERE owner_id = ? ORDER BY updated_at DESC', ownerId).map(rowToPreset)
}

export function saveBlockPreset(db: Db, ownerId: string, sourceStoreId: string, name: string, block: Pick<BlockInstance, 'type' | 'settings'>): BlockPreset {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 80)
  if (clean.length < 2) throw new Error('Give the saved block a name')
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/i.test(block.type)) throw new Error('That block type cannot be saved')
  const timestamp = now()
  const existing = db.one<{ id: string }>('SELECT id FROM block_presets WHERE owner_id = ? AND name = ?', ownerId, clean)
  if (existing) {
    db.update('block_presets', existing.id, { source_store_id: sourceStoreId, block_type: block.type, settings: block.settings, updated_at: timestamp })
    const row = db.one('SELECT * FROM block_presets WHERE id = ?', existing.id)
    if (!row) throw new Error('Saved block disappeared')
    return rowToPreset(row)
  }
  const presetId = id('preset')
  db.insert('block_presets', { id: presetId, owner_id: ownerId, source_store_id: sourceStoreId, name: clean, block_type: block.type, settings: block.settings, created_at: timestamp, updated_at: timestamp })
  return rowToPreset(db.one('SELECT * FROM block_presets WHERE id = ?', presetId) as Row)
}

export function deleteBlockPreset(db: Db, ownerId: string, presetId: string): boolean {
  return Number(db.run('DELETE FROM block_presets WHERE id = ? AND owner_id = ?', presetId, ownerId).changes) > 0
}
