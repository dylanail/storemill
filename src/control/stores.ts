import { json, now, type Db, type Row } from '../lib/db.ts'
import { id, storeSlug, token } from '../lib/ids.ts'
import type { Brand, Theme } from '../domain/types.ts'
import type { Task } from '../agent/models.ts'

export type StoreEnvironment = {
  id: string
  storeId: string
  kind: 'draft' | 'live'
  theme: Theme
  brand: Brand
  buildState: 'idle' | 'building' | 'ready' | 'failed'
  buildLog: Array<{ at: string; message: string; level: string }>
  version: number
  publishedAt: string | null
  updatedAt: string
}

export type Store = {
  id: string
  ownerId: string
  /** Top-level asset shape. Funnels get a conversion path; stores get a catalog storefront. */
  kind: 'store' | 'funnel'
  name: string
  slug: string
  currency: string
  brand: Brand
  status: 'draft' | 'live' | 'paused'
  prompt: string
  /** Which model writes what for this store; empty entries take the environment default. */
  models: Partial<Record<Task, string>>
  referenceImage: string
  referenceUrl: string
  createdAt: string
}

export const DEFAULT_THEME: Theme = {
  template: 'atelier',
  sections: ['announcement', 'hero', 'featured', 'story', 'collection-grid', 'reviews', 'newsletter', 'footer'],
  radius: '2px',
  density: 'roomy',
  nav: [],
  slots: {},
}

function rowToStore(row: Row): Store {
  const build = json<{ shape?: string }>(row.build, {})
  return {
    id: row.id as string,
    ownerId: row.owner_id as string,
    kind: build.shape === 'funnel' ? 'funnel' : 'store',
    name: row.name as string,
    slug: row.slug as string,
    currency: row.currency as string,
    brand: json(row.brand, {} as Brand),
    status: row.status as Store['status'],
    prompt: row.prompt as string,
    models: json(row.models, {} as Partial<Record<Task, string>>),
    referenceImage: (row.reference_image as string) ?? '',
    referenceUrl: (row.reference_url as string) ?? '',
    createdAt: row.created_at as string,
  }
}

export function createStore(
  db: Db,
  ownerId: string,
  input: { name: string; kind?: Store['kind']; prompt?: string; currency?: string; referenceImage?: string; referenceUrl?: string },
): Store {
  const storeId = id('store')
  const timestamp = now()
  db.tx(() => {
    db.insert('stores', {
      id: storeId,
      owner_id: ownerId,
      name: input.name,
      slug: storeSlug(input.name),
      currency: (input.currency ?? 'USD').toUpperCase(),
      brand: {},
      status: 'draft',
      prompt: input.prompt ?? '',
      models: {},
      reference_image: input.referenceImage ?? '',
      reference_url: input.referenceUrl ?? '',
      ...(input.kind ? { build: { shape: input.kind } } : {}),
      created_at: timestamp,
    })
    for (const kind of ['draft', 'live'] as const) {
      db.insert('store_environments', {
        id: id('env'),
        store_id: storeId,
        kind,
        theme: DEFAULT_THEME,
        build_state: 'idle',
        build_log: [],
        version: 1,
        published_at: null,
        updated_at: timestamp,
      })
    }
  })
  return getStore(db, storeId) as Store
}

export function getStore(db: Db, storeId: string): Store | null {
  const row = db.one('SELECT * FROM stores WHERE id = ?', storeId)
  return row ? rowToStore(row) : null
}

export function getStoreBySlug(db: Db, slug: string): Store | null {
  const row = db.one('SELECT * FROM stores WHERE slug = ?', slug)
  return row ? rowToStore(row) : null
}

export function listStores(db: Db, userId: string): Store[] {
  return db
    .all(
      `SELECT s.* FROM stores s
       LEFT JOIN team_members t ON t.store_id = s.id AND t.user_id = ? AND t.status = 'active'
       WHERE s.owner_id = ? OR t.id IS NOT NULL
       ORDER BY s.created_at DESC`,
      userId,
      userId,
    )
    .map(rowToStore)
}

export function updateStore(
  db: Db,
  storeId: string,
  patch: Partial<Pick<Store, 'name' | 'currency' | 'status' | 'referenceImage' | 'referenceUrl' | 'models'>> & { brand?: Brand },
): Store {
  const store = getStore(db, storeId)
  if (!store) throw new Error(`No store ${storeId}`)
  const values: Row = {}
  if (patch.name !== undefined) values.name = patch.name
  if (patch.currency !== undefined) values.currency = patch.currency.toUpperCase()
  if (patch.status !== undefined) values.status = patch.status
  if (patch.models !== undefined) values.models = patch.models
  if (patch.referenceImage !== undefined) values.reference_image = patch.referenceImage
  if (patch.referenceUrl !== undefined) values.reference_url = patch.referenceUrl
  const brand = patch.brand === undefined ? undefined : { ...store.brand, ...patch.brand }
  if (brand !== undefined) values.brand = brand
  // The store row is the editable working copy used by the admin and the
  // assistant. Mirror brand edits into the draft environment so preview and
  // live can both render through the same explicit environment boundary.
  db.tx(() => {
    db.update('stores', storeId, values)
    if (brand !== undefined) {
      const draft = environment(db, storeId, 'draft')
      db.update('store_environments', draft.id, { brand, updated_at: now() })
    }
  })
  return getStore(db, storeId) as Store
}

/* --------------------------------------------------------------- environments */

function rowToEnvironment(row: Row): StoreEnvironment {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    kind: row.kind as 'draft' | 'live',
    theme: { ...DEFAULT_THEME, ...json(row.theme, {} as Theme) },
    brand: json(row.brand, {} as Brand),
    buildState: row.build_state as StoreEnvironment['buildState'],
    buildLog: json(row.build_log, []),
    version: row.version as number,
    publishedAt: (row.published_at as string | null) ?? null,
    updatedAt: row.updated_at as string,
  }
}

export function environment(db: Db, storeId: string, kind: 'draft' | 'live'): StoreEnvironment {
  const row = db.one('SELECT * FROM store_environments WHERE store_id = ? AND kind = ?', storeId, kind)
  if (!row) throw new Error(`Store ${storeId} has no ${kind} environment`)
  return rowToEnvironment(row)
}

export function setTheme(db: Db, storeId: string, patch: Partial<Theme>, options: { build?: string } = {}): StoreEnvironment {
  const draft = environment(db, storeId, 'draft')
  const theme = { ...draft.theme, ...patch }
  const buildLog = options.build
    ? [...draft.buildLog, { at: now(), message: options.build, level: 'info' }].slice(-40)
    : draft.buildLog
  db.update('store_environments', draft.id, { theme, build_log: buildLog, build_state: 'ready', updated_at: now() })
  return environment(db, storeId, 'draft')
}

export function appendBuildLog(db: Db, storeId: string, kind: 'draft' | 'live', message: string, level = 'info') {
  const env = environment(db, storeId, kind)
  db.update('store_environments', env.id, {
    build_log: [...env.buildLog, { at: now(), message, level }].slice(-40),
    updated_at: now(),
  })
}

/**
 * Publish copies draft over live and bumps the version. Rollback swaps the
 * other way, which is why live keeps its own theme blob rather than pointing
 * at the draft: there is always exactly one previous good version to return to.
 */
export function publish(db: Db, storeId: string): StoreEnvironment {
  const draft = environment(db, storeId, 'draft')
  const live = environment(db, storeId, 'live')
  const timestamp = now()
  db.tx(() => {
    db.update('store_environments', live.id, {
      theme: draft.theme,
      brand: draft.brand,
      version: live.version + 1,
      build_state: 'ready',
      build_log: [...live.buildLog, { at: timestamp, message: `Published draft v${draft.version}`, level: 'info' }].slice(-40),
      published_at: timestamp,
      updated_at: timestamp,
    })
    db.update('stores', storeId, { status: 'live' })
  })
  return environment(db, storeId, 'live')
}

export function rollback(db: Db, storeId: string): StoreEnvironment {
  const live = environment(db, storeId, 'live')
  const draft = environment(db, storeId, 'draft')
  db.tx(() => {
    db.update('store_environments', draft.id, { theme: live.theme, brand: live.brand, updated_at: now() })
    if (Object.keys(live.brand).length) db.update('stores', storeId, { brand: live.brand })
  })
  return environment(db, storeId, 'draft')
}

/**
 * The state-aware publish CTA. The admin never shows a bare "Publish" button;
 * it shows what the store still needs, because that is the question the
 * merchant actually has.
 */
export function publishState(db: Db, storeId: string): { label: string; ready: boolean; reason: string } {
  const store = getStore(db, storeId)
  if (!store) return { label: 'Publish asset', ready: false, reason: 'No asset' }
  const noun = store.kind === 'funnel' ? 'funnel' : 'store'
  const products = db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND status = 'published'", storeId)?.c ?? 0
  if (!products) return { label: 'Add a product to publish', ready: false, reason: `A live ${noun} needs at least one published product.` }
  const draft = environment(db, storeId, 'draft')
  const live = environment(db, storeId, 'live')
  if (store.status !== 'live') return { label: `Publish ${noun}`, ready: true, reason: `Your ${noun} goes live at its address.` }
  if (JSON.stringify(draft.theme) !== JSON.stringify(live.theme) || JSON.stringify(draft.brand) !== JSON.stringify(live.brand)) {
    return { label: 'Publish changes', ready: true, reason: 'The draft has edits that are not live yet.' }
  }
  return { label: `${noun === 'store' ? 'Store' : 'Funnel'} is live`, ready: false, reason: `Live since ${live.publishedAt?.slice(0, 10) ?? 'today'}.` }
}

/* -------------------------------------------------------------------- domains */

export function addDomain(db: Db, storeId: string, hostname: string) {
  const clean = hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) throw new Error('That does not look like a domain name')
  const domainId = id('dom')
  const verification = token(12)
  db.run('DELETE FROM domains WHERE store_id = ? AND hostname = ?', storeId, clean)
  db.insert('domains', {
    id: domainId,
    store_id: storeId,
    hostname: clean,
    status: 'pending',
    verification_token: verification,
    ssl: 'pending',
    created_at: now(),
  })
  return {
    hostname: clean,
    records: [
      { type: 'CNAME', name: clean.split('.').length > 2 ? (clean.split('.')[0] as string) : 'www', value: 'edge.amboras.app' },
      { type: 'TXT', name: `_storemill.${clean}`, value: `storemill-verify=${verification}` },
    ],
  }
}

export function verifyDomain(db: Db, storeId: string, hostname: string) {
  const row = db.one<{ id: string }>('SELECT id FROM domains WHERE store_id = ? AND hostname = ?', storeId, hostname)
  if (!row) throw new Error('That domain is not attached to this store')
  db.update('domains', row.id, { status: 'verified', ssl: 'issued' })
  return { hostname, status: 'verified', ssl: 'issued' }
}

export function listDomains(db: Db, storeId: string) {
  return db.all('SELECT hostname, status, ssl, verification_token, created_at FROM domains WHERE store_id = ? ORDER BY created_at', storeId)
}

export function storeForHost(db: Db, hostname: string, rootDomain: string): Store | null {
  // www.brand.com and brand.com are one store: whichever was attached answers for both.
  const bare = hostname.replace(/^www\./, '')
  const custom = db.one<{ store_id: string }>("SELECT store_id FROM domains WHERE hostname IN (?, ?, ?) AND status = 'verified' AND mode = 'host'", hostname, bare, `www.${bare}`)
  if (custom) return getStore(db, custom.store_id)
  if (rootDomain && hostname.endsWith(`.${rootDomain}`)) {
    return getStoreBySlug(db, hostname.slice(0, -(rootDomain.length + 1)))
  }
  return null
}
