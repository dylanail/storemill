import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import type { Order } from '../domain/types.ts'

const DEFAULT_BASE = 'https://api.17track.net/track/v2.4'
const CACHE_MS = 15 * 60_000

export type TrackingEvent = {
  at: string
  location: string
  description: string
  stage: string
}

export type TrackingSnapshot = {
  tracking: string
  carrier: string
  status: string
  subStatus: string
  estimate: { from?: string; to?: string }
  events: TrackingEvent[]
  syncedAt: string | null
  error: string
}

type Transport = (url: string, init: RequestInit) => Promise<Response>
let transport: Transport = (url, init) => fetch(url, init)

/** Tests can replace the wire without changing any production call site. */
export function useSeventeenTrackTransport(next: Transport | null) {
  transport = next ?? ((url, init) => fetch(url, init))
}

export const seventeenTrackConfigured = () => Boolean(process.env.AMBORAS_17TRACK_API_KEY)

function rowToSnapshot(row: Row): TrackingSnapshot {
  return {
    tracking: row.tracking as string,
    carrier: row.carrier as string,
    status: row.status as string,
    subStatus: row.sub_status as string,
    estimate: json(row.estimate, {}),
    events: json(row.events, [] as TrackingEvent[]),
    syncedAt: (row.synced_at as string | null) ?? null,
    error: row.error as string,
  }
}

export function cachedTracking(db: Db, storeId: string, tracking: string): TrackingSnapshot | null {
  const row = db.one('SELECT * FROM tracking_snapshots WHERE store_id = ? AND tracking = ?', storeId, tracking.trim())
  return row ? rowToSnapshot(row) : null
}

export async function registerOrderTracking(db: Db, storeId: string, order: Order): Promise<TrackingSnapshot | null> {
  return syncOrderTracking(db, storeId, order, { force: false, registerOnly: true })
}

export async function syncOrderTracking(
  db: Db,
  storeId: string,
  order: Order,
  opts: { force?: boolean; registerOnly?: boolean } = {},
): Promise<TrackingSnapshot | null> {
  const shipment = order.fulfillments.findLast((entry) => entry.tracking)
  if (!shipment) return null
  const number = shipment.tracking.trim()
  let row = db.one('SELECT * FROM tracking_snapshots WHERE store_id = ? AND tracking = ?', storeId, number)
  const cached = row ? rowToSnapshot(row) : null
  if (!seventeenTrackConfigured()) return cached
  if (!opts.force && cached?.syncedAt && Date.now() - Date.parse(cached.syncedAt) < CACHE_MS) return cached

  const timestamp = now()
  if (!row) {
    db.insert('tracking_snapshots', {
      id: id('trk'), store_id: storeId, order_id: order.id, tracking: number,
      carrier: shipment.carrier ?? '', status: '', sub_status: '', estimate: {}, events: [],
      registered_at: null, synced_at: null, error: '',
    })
    row = db.one('SELECT * FROM tracking_snapshots WHERE store_id = ? AND tracking = ?', storeId, number)
  }
  try {
    if (!row?.registered_at) {
      await request('register', [{ number }])
      db.run('UPDATE tracking_snapshots SET registered_at = ?, error = ? WHERE store_id = ? AND tracking = ?', timestamp, '', storeId, number)
    }
    if (opts.registerOnly) return cachedTracking(db, storeId, number)
    const payload = await request('gettrackinfo', [{ number }])
    const normalized = normalizeResponse(number, payload, shipment.carrier ?? '')
    db.run(
      'UPDATE tracking_snapshots SET carrier = ?, status = ?, sub_status = ?, estimate = ?, events = ?, synced_at = ?, error = ? WHERE store_id = ? AND tracking = ?',
      normalized.carrier, normalized.status, normalized.subStatus, JSON.stringify(normalized.estimate), JSON.stringify(normalized.events), timestamp, '', storeId, number,
    )
    return { ...normalized, syncedAt: timestamp, error: '' }
  } catch (error) {
    const message = error instanceof Error ? error.message : '17TRACK request failed'
    db.run('UPDATE tracking_snapshots SET error = ? WHERE store_id = ? AND tracking = ?', message.slice(0, 500), storeId, number)
    return cached ? { ...cached, error: message } : null
  }
}

async function request(path: 'register' | 'gettrackinfo', body: Array<{ number: string }>): Promise<unknown> {
  const token = process.env.AMBORAS_17TRACK_API_KEY
  if (!token) throw new Error('STOREMILL_17TRACK_API_KEY is not configured')
  const base = (process.env.AMBORAS_17TRACK_API_BASE ?? DEFAULT_BASE).replace(/\/$/, '')
  const response = await transport(`${base}/${path}`, {
    method: 'POST',
    headers: { '17token': token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`17TRACK returned HTTP ${response.status}`)
  const payload = await response.json() as { code?: number; data?: unknown; message?: string }
  if (payload.code !== undefined && payload.code !== 0) throw new Error(payload.message || `17TRACK returned code ${payload.code}`)
  return payload
}

/** Accept both current v2.4 nesting and the flatter webhook shape. */
export function normalizeResponse(number: string, payload: unknown, carrierHint = ''): Omit<TrackingSnapshot, 'syncedAt' | 'error'> {
  const root = object(payload)
  const data = object(root.data)
  const accepted = Array.isArray(data.accepted) ? data.accepted : Array.isArray(root.accepted) ? root.accepted : []
  const acceptedEntry = object(accepted.find((entry) => String(object(entry).number ?? '') === number) ?? accepted[0])
  const info = object(acceptedEntry.track_info ?? acceptedEntry.trackInfo ?? acceptedEntry.tracking ?? acceptedEntry)
  const tracking = object(info.tracking)
  const providers = Array.isArray(tracking.providers) ? tracking.providers : Array.isArray(info.providers) ? info.providers : []
  const provider = object(providers[0])
  const providerName = String(object(provider.provider).name ?? provider.name ?? acceptedEntry.carrier_name ?? carrierHint)
  const latestStatus = object(info.latest_status ?? info.latestStatus)
  const metrics = object(info.time_metrics ?? info.timeMetrics)
  const estimated = object(metrics.estimated_delivery_date ?? metrics.estimatedDeliveryDate)
  const rawEvents = providers.flatMap((entry) => {
    const item = object(entry)
    return Array.isArray(item.events) ? item.events : []
  })
  const events = rawEvents.map((entry) => {
    const event = object(entry)
    return {
      at: String(event.time_iso ?? event.time_utc ?? event.time ?? event.occurred_at ?? ''),
      location: String(event.location ?? event.address ?? ''),
      description: String(event.description ?? event.message ?? event.event ?? ''),
      stage: String(event.stage ?? event.status ?? ''),
    }
  }).filter((entry) => entry.at || entry.description)
  const unique = [...new Map(events.map((event) => [`${event.at}|${event.description}|${event.location}`, event])).values()]
    .sort((a, b) => Date.parse(b.at || '0') - Date.parse(a.at || '0'))
  return {
    tracking: number,
    carrier: providerName,
    status: String(latestStatus.status ?? info.status ?? ''),
    subStatus: String(latestStatus.sub_status ?? latestStatus.subStatus ?? ''),
    estimate: {
      ...(estimated.from ? { from: String(estimated.from) } : {}),
      ...(estimated.to ? { to: String(estimated.to) } : estimated.date ? { to: String(estimated.date) } : {}),
    },
    events: unique,
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
