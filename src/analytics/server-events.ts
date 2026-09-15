import { createHash } from 'node:crypto'
import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import { minorDigits } from '../lib/money.ts'
import { getInstalled, readCredentials } from '../control/plugins.ts'
import type { EventType } from './events.ts'

const log = logger('server-events')

export type ServerEventInput = {
  eventId: string
  type: EventType
  url: string
  referrer?: string
  ip: string
  userAgent: string
  currency?: string
  valueCents?: number
  productId?: string
  email?: string
  phone?: string
  externalId?: string
  fbp?: string
  fbc?: string
  ttp?: string
  ttclid?: string
}

const EVENT_NAMES: Partial<Record<EventType, { meta: string; tiktok: string }>> = {
  'view.page': { meta: 'PageView', tiktok: 'Pageview' },
  'view.collection': { meta: 'ViewContent', tiktok: 'ViewContent' },
  'view.product': { meta: 'ViewContent', tiktok: 'ViewContent' },
  'cart.add': { meta: 'AddToCart', tiktok: 'AddToCart' },
  'checkout.start': { meta: 'InitiateCheckout', tiktok: 'InitiateCheckout' },
  'checkout.complete': { meta: 'Purchase', tiktok: 'CompletePayment' },
  signup: { meta: 'Lead', tiktok: 'Subscribe' },
}

const sha256 = (value?: string) => value ? createHash('sha256').update(value.trim().toLowerCase()).digest('hex') : undefined

function metaPayload(input: ServerEventInput) {
  const scale = 10 ** minorDigits(input.currency ?? 'USD')
  const user: Record<string, unknown> = {
    ...(input.ip?{client_ip_address:input.ip}:{}),
    ...(input.userAgent?{client_user_agent:input.userAgent}:{}),
    ...(input.email ? { em: [sha256(input.email)] } : {}),
    ...(input.phone ? { ph: [sha256(input.phone.replace(/\D/g, ''))] } : {}),
    ...(input.externalId ? { external_id: [sha256(input.externalId)] } : {}),
    ...(input.fbp ? { fbp: input.fbp } : {}),
    ...(input.fbc ? { fbc: input.fbc } : {}),
  }
  return {
    event_name: EVENT_NAMES[input.type]?.meta,
    event_time: Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    action_source: 'website',
    event_source_url: input.url,
    user_data: user,
    custom_data: {
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.valueCents !== undefined ? { value: input.valueCents / scale } : {}),
      ...(input.productId ? { content_ids: [input.productId], content_type: 'product' } : {}),
    },
  }
}

function tiktokPayload(input: ServerEventInput) {
  const scale = 10 ** minorDigits(input.currency ?? 'USD')
  const user: Record<string, unknown> = {
    ip: input.ip,
    user_agent: input.userAgent,
    ...(input.email ? { email: sha256(input.email) } : {}),
    ...(input.phone ? { phone: sha256(input.phone.replace(/\D/g, '')) } : {}),
    ...(input.externalId ? { external_id: sha256(input.externalId) } : {}),
    ...(input.ttp ? { ttp: input.ttp } : {}),
    ...(input.ttclid ? { ttclid: input.ttclid } : {}),
  }
  return {
    event: EVENT_NAMES[input.type]?.tiktok,
    event_time: Math.floor(Date.now() / 1000),
    event_id: input.eventId,
    user,
    properties: {
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.valueCents !== undefined ? { value: input.valueCents / scale } : {}),
      ...(input.productId ? { content_type: 'product', contents: [{ content_id: input.productId, quantity: 1 }] } : {}),
    },
    page: { url: input.url, ...(input.referrer ? { referrer: input.referrer } : {}) },
  }
}

/** Persist conversions before any network request. The dispatcher may safely
 * retry because provider + event id is unique and shared with browser pixels. */
export function queueServerEvents(db: Db, storeId: string, input: ServerEventInput): number {
  if (!EVENT_NAMES[input.type]) return 0
  let queued = 0
  const providers = [
    { provider: 'meta', pluginId: 'meta-pixel', make: metaPayload },
    { provider: 'tiktok', pluginId: 'tiktok-pixel', make: tiktokPayload },
  ] as const
  for (const provider of providers) {
    const installed = getInstalled(db, storeId, provider.pluginId)
    const credentials = readCredentials(db, storeId, provider.pluginId)
    if (!installed?.enabled || !installed.settings.pixelId || !credentials.accessToken) continue
    const result = db.run(
      `INSERT OR IGNORE INTO server_event_deliveries
       (id, store_id, provider, event_id, event_name, payload, status, attempts, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, '', ?)`,
      id('sed'), storeId, provider.provider, input.eventId,
      EVENT_NAMES[input.type]?.[provider.provider], JSON.stringify(provider.make(input)), now(),
    )
    queued += Number(result.changes)
  }
  return queued
}

export type EventTransport = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>

export async function dispatchServerEvents(db: Db, transport: EventTransport = fetch, limit = 40): Promise<{ sent: number; failed: number }> {
  const rows = db.all<{ id: string; store_id: string; provider: string; payload: string; attempts: number }>(
    "SELECT id, store_id, provider, payload, attempts FROM server_event_deliveries WHERE status IN ('queued','retry') AND attempts < 5 AND (next_attempt_at IS NULL OR next_attempt_at <= ?) ORDER BY created_at LIMIT ?", now(), limit,
  )
  let sent = 0
  let failed = 0
  for (const row of rows) {
    const pluginId = row.provider === 'meta' ? 'meta-pixel' : 'tiktok-pixel'
    const installed = getInstalled(db, row.store_id, pluginId)
    const credentials = readCredentials(db, row.store_id, pluginId)
    const pixelId = String(installed?.settings.pixelId ?? '')
    const accessToken = String(credentials.accessToken ?? '')
    if (!installed?.enabled || !pixelId || !accessToken) {
      db.update('server_event_deliveries', row.id, { status: 'failed', attempts: row.attempts + 1, error: 'Integration is no longer configured' })
      failed++
      continue
    }
    const payload = json(row.payload, {} as Record<string, unknown>)
    try {
      const response = row.provider === 'meta'
        ? await transport(`https://graph.facebook.com/${process.env.AMBORAS_META_API_VERSION ?? 'v25.0'}/${encodeURIComponent(pixelId)}/events`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: [payload], access_token: accessToken, ...(installed?.settings.testEventCode?{test_event_code:installed.settings.testEventCode}:{}) }),
          })
        : await transport('https://business-api.tiktok.com/open_api/v1.3/event/track/', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
            body: JSON.stringify({ event_source: 'web', event_source_id: pixelId, data: [payload] }),
          })
      if (!response.ok) throw new Error(`${row.provider} replied ${response.status}: ${(await response.text()).slice(0, 180)}`)
      if(row.provider==='meta'){
        const acknowledgement=JSON.parse(await response.text());
        if(acknowledgement.error||Number(acknowledgement.events_received)<1||!Number.isFinite(Number(acknowledgement.events_received)))throw new Error('Meta did not acknowledge receipt of this event. Check the Pixel ID and token in Events Manager.');
      }
      db.update('server_event_deliveries', row.id, { status: 'sent', attempts: row.attempts + 1, error: '', sent_at: now() })
      sent++
    } catch (error) {
      const attempts = row.attempts + 1
      db.update('server_event_deliveries', row.id, {
        status: attempts >= 5 ? 'failed' : 'retry', attempts,
        error: (error instanceof Error ? error.message : String(error)).split(accessToken).join('[redacted]'),
        next_attempt_at: new Date(Date.now() + Math.min(3600_000, 2 ** attempts * 60_000)).toISOString(),
      })
      failed++
    }
  }
  if (sent || failed) log.info(`server events: ${sent} sent, ${failed} waiting/failed`)
  return { sent, failed }
}

export function serverEventSummary(db: Db, storeId: string) {
  return db.all<{ provider: string; status: string; count: number; latest: string }>(
    'SELECT provider, status, COUNT(*) count, MAX(created_at) latest FROM server_event_deliveries WHERE store_id = ? GROUP BY provider, status ORDER BY provider, status', storeId,
  )
}
