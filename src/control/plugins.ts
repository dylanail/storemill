import { bool, json, now, type Db, type Row } from '../lib/db.ts'
import { open, seal } from '../lib/crypto.ts'
import { badRequest, forbidden } from '../lib/http.ts'
import { id } from '../lib/ids.ts'
import { check } from '../lib/validate.ts'
import { findPlugin, type Plugin } from './catalog-plugins.ts'
import { getStore } from './stores.ts'
import type { SlotName } from './plugin-types.ts'

export type InstalledPlugin = {
  id: string
  storeId: string
  pluginId: string
  enabled: boolean
  settings: Record<string, unknown>
  /** Chosen slot per `merchant_choice` component. */
  slots: Record<string, SlotName>
  installedAt: string
  plugin: Plugin
}

function rowToInstalled(row: Row): InstalledPlugin | null {
  const plugin = findPlugin(row.plugin_id as string)
  if (!plugin) return null
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    pluginId: row.plugin_id as string,
    enabled: bool(row.enabled),
    settings: json(row.settings, {} as Record<string, unknown>),
    slots: json(row.slots, {} as Record<string, SlotName>),
    installedAt: row.installed_at as string,
    plugin,
  }
}

export function listInstalled(db: Db, storeId: string): InstalledPlugin[] {
  return db
    .all('SELECT * FROM store_plugins WHERE store_id = ? ORDER BY installed_at', storeId)
    .map(rowToInstalled)
    .filter((entry): entry is InstalledPlugin => entry !== null)
}

export function getInstalled(db: Db, storeId: string, pluginId: string): InstalledPlugin | null {
  const row = db.one('SELECT * FROM store_plugins WHERE store_id = ? AND plugin_id = ?', storeId, pluginId)
  return row ? rowToInstalled(row) : null
}

/**
 * Install validates the settings against the plugin's own schema before
 * anything is written, splits declared secret fields into the sealed
 * credentials table, and refuses a plan-gated plugin rather than installing a
 * broken one.
 */
export function install(db: Db, storeId: string, pluginId: string, settings: Record<string, unknown> = {}): InstalledPlugin {
  const plugin = findPlugin(pluginId)
  if (!plugin) throw badRequest(`No plugin called ${pluginId}`)
  if (plugin.source !== 'first-party') {
    throw badRequest(`${plugin.name} is a directory listing, not an installable integration yet.`)
  }
  const store = getStore(db, storeId)
  if (!store) throw badRequest('No such store')

  const schema = plugin.manifest.admin?.settingsSchema ?? {}
  const existing = getInstalled(db, storeId, pluginId)
  const secretFields = plugin.manifest.admin?.secretFields ?? []
  // A sealed secret is not in store_plugins.settings, so the settings form
  // posts it back empty and the validator saw a required field missing:
  // saving any Stripe or Klaviyo setting after install always failed, with no
  // way to re-supply the key short of uninstalling. What is already sealed
  // counts as present, and a blank field leaves it alone.
  const kept = readCredentials(db, storeId, pluginId)
  const supplied = Object.fromEntries(Object.entries(settings).filter(([key, value]) => !(secretFields.includes(key) && value === '')))
  const merged = { ...(existing?.settings ?? {}), ...kept, ...supplied }
  const result = check(schema, merged)
  if (!result.ok) throw badRequest(`${plugin.name} settings are not valid`, result.issues)

  const currentSecrets = kept
  const secrets: Record<string, unknown> = {}
  const publicSettings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(result.value)) {
    if (secretFields.includes(key)) {
      if (value === '' && currentSecrets[key] !== undefined) continue
      secrets[key] = value
    }
    else publicSettings[key] = value
  }

  const timestamp = now()
  db.tx(() => {
    if (existing) {
      db.update('store_plugins', existing.id, { settings: publicSettings, enabled: true })
    } else {
      const slots: Record<string, SlotName> = {}
      for (const component of plugin.manifest.storefront?.components ?? []) {
        if (component.placement === 'merchant_choice' && component.defaultSlot) slots[component.id] = component.defaultSlot
        else if (component.slot) slots[component.id] = component.slot
      }
      db.insert('store_plugins', {
        id: id('sp'),
        store_id: storeId,
        plugin_id: pluginId,
        enabled: true,
        settings: publicSettings,
        slots,
        installed_at: timestamp,
      })
    }
    if (Object.keys(secrets).length) {
      const previous = readCredentials(db, storeId, pluginId)
      const sealed = seal(JSON.stringify({ ...previous, ...secrets }))
      const row = db.one<{ id: string }>('SELECT id FROM store_plugin_credentials WHERE store_id = ? AND plugin_id = ?', storeId, pluginId)
      if (row) db.update('store_plugin_credentials', row.id, { sealed, updated_at: timestamp })
      else db.insert('store_plugin_credentials', { id: id('spc'), store_id: storeId, plugin_id: pluginId, sealed, updated_at: timestamp })
    }
  })
  return getInstalled(db, storeId, pluginId) as InstalledPlugin
}

export function uninstall(db: Db, storeId: string, pluginId: string): boolean {
  return db.tx(() => {
    db.run('DELETE FROM store_plugin_credentials WHERE store_id = ? AND plugin_id = ?', storeId, pluginId)
    return Number(db.run('DELETE FROM store_plugins WHERE store_id = ? AND plugin_id = ?', storeId, pluginId).changes) > 0
  })
}

export function setEnabled(db: Db, storeId: string, pluginId: string, enabled: boolean) {
  db.run('UPDATE store_plugins SET enabled = ? WHERE store_id = ? AND plugin_id = ?', enabled ? 1 : 0, storeId, pluginId)
}

export function setSlot(db: Db, storeId: string, pluginId: string, componentId: string, slot: SlotName) {
  const installed = getInstalled(db, storeId, pluginId)
  if (!installed) throw badRequest('That plugin is not installed')
  const component = installed.plugin.manifest.storefront?.components?.find((entry) => entry.id === componentId)
  if (!component) throw badRequest(`${installed.plugin.name} has no component ${componentId}`)
  if (component.placement !== 'merchant_choice') throw badRequest(`${componentId} has a fixed placement`)
  if (component.validSlots && !component.validSlots.includes(slot)) {
    throw badRequest(`${componentId} cannot go in ${slot}`, component.validSlots)
  }
  db.update('store_plugins', installed.id, { slots: { ...installed.slots, [componentId]: slot } })
}

/** Per-tenant credential resolver. Nothing else in the platform decrypts. */
export function readCredentials(db: Db, storeId: string, pluginId: string): Record<string, unknown> {
  const row = db.one<{ sealed: string }>('SELECT sealed FROM store_plugin_credentials WHERE store_id = ? AND plugin_id = ?', storeId, pluginId)
  if (!row) return {}
  const plaintext = open(row.sealed)
  if (!plaintext) return {}
  try {
    return JSON.parse(plaintext) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function hasCredentials(db: Db, storeId: string, pluginId: string): boolean {
  return Object.keys(readCredentials(db, storeId, pluginId)).length > 0
}

/** What the storefront may read: public settings only, no secrets, 60s cache. */
const publicCache = new Map<string, { at: number; value: unknown }>()

export function activeStorefrontConfig(db: Db, storeId: string) {
  const cached = publicCache.get(storeId)
  if (cached && Date.now() - cached.at < 60_000) return cached.value
  const value = listInstalled(db, storeId)
    .filter((entry) => entry.enabled)
    .map((entry) => ({
      id: entry.pluginId,
      name: entry.plugin.name,
      settings: entry.settings,
      slots: entry.slots,
      capabilities: entry.plugin.manifest.capabilities ?? [],
    }))
  publicCache.set(storeId, { at: Date.now(), value })
  return value
}

export function invalidateStorefrontConfig(storeId: string) {
  publicCache.delete(storeId)
}

export function providersOf(db: Db, storeId: string, type: 'payment_provider' | 'fulfillment_provider') {
  return listInstalled(db, storeId)
    .filter((entry) => entry.enabled)
    .flatMap((entry) => (entry.plugin.manifest.capabilities ?? []).filter((capability) => capability.type === type).map((capability) => ({ ...capability, pluginId: entry.pluginId })))
}

/**
 * Slot rendering. A `disableInPreview` plugin renders nothing when the
 * storefront is being drawn inside the admin's preview iframe — an analytics
 * pixel that counts the merchant's own dashboard visits is worse than no pixel.
 */
export function renderSlot(
  db: Db,
  storeId: string,
  slot: SlotName,
  context: Record<string, unknown> = {},
  opts: { preview?: boolean } = {},
): string {
  const out: string[] = []
  for (const entry of listInstalled(db, storeId)) {
    if (!entry.enabled) continue
    if (opts.preview && entry.plugin.manifest.disableInPreview) continue
    for (const component of entry.plugin.manifest.storefront?.components ?? []) {
      const resolved = entry.slots[component.id] ?? component.slot ?? component.defaultSlot
      if (resolved !== slot) continue
      if (component.render) out.push(component.render({ settings: entry.settings, context }))
      else out.push(`<!-- slot ${slot}: ${entry.pluginId}/${component.id} rendered by the theme -->`)
    }
  }
  return out.join('\n')
}

/** Which built-in theme components a plugin has switched on for this store. */
export function slotComponentIds(db: Db, storeId: string, slot: SlotName): string[] {
  const out: string[] = []
  for (const entry of listInstalled(db, storeId)) {
    if (!entry.enabled) continue
    for (const component of entry.plugin.manifest.storefront?.components ?? []) {
      const resolved = entry.slots[component.id] ?? component.slot ?? component.defaultSlot
      if (resolved === slot && !component.render) out.push(`${entry.pluginId}/${component.id}`)
    }
  }
  return out
}
