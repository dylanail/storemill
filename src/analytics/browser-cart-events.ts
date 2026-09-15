import { getInstalled } from '../control/plugins.ts'
import { minorDigits } from '../lib/money.ts'
import type { ServerEventInput } from './server-events.ts'
import type { StoreView } from '../storefront/render.ts'

declare const window: any

export type BrowserCartEvent = { id: string; currency: string; value: number; productId?: string }

export function browserCartEvent(input: ServerEventInput): BrowserCartEvent | null {
  if (input.type !== 'cart.add') return null
  return { id: input.eventId, currency: input.currency || 'USD', value: (input.valueCents || 0) / 10 ** minorDigits(input.currency || 'USD'), ...(input.productId ? { productId: input.productId } : {}) }
}

/** Redirects and AJAX cart responses deliver the same server-owned event ID.
 * This dispatcher does not emit Meta events; that integration has its own client. */
export function browserCartEventsHtml(view: StoreView): string {
  if (view.preview) return ''
  const ga4 = getInstalled(view.db, view.store.id, 'ga4'), tiktok = getInstalled(view.db, view.store.id, 'tiktok-pixel')
  const config = { ga4: ga4?.enabled ? String(ga4.settings.measurementId || '') : '', tiktok: tiktok?.enabled ? String(tiktok.settings.pixelId || '') : '' }
  if (!config.ga4 && !config.tiktok) return ''
  return `<script data-cart-events>(${cartEventClient.toString()})(${JSON.stringify(config).replace(/</g, '\\u003c')},${JSON.stringify(view.cartEvents || []).replace(/</g, '\\u003c')})</script>`
}

/** Serialized into storefront HTML, including copied pages. */
export function cartEventClient(config: { ga4: string; tiktok: string }, pending: BrowserCartEvent[]) {
  const w = window, seen = new Set<string>()
  w.storemillCartEvent = (event: BrowserCartEvent) => {
    if (!event?.id || !Number.isFinite(event.value) || !event.currency) return
    const emit = (provider: string, pixel: string, send: () => void) => {
      const key = `storemill:cart:${provider}:${pixel}:${event.id}`
      if (seen.has(key)) return
      try { if (w.sessionStorage.getItem(key)) return } catch { /* memory still deduplicates this document */ }
      send(); seen.add(key)
      try { w.sessionStorage.setItem(key, '1') } catch { /* private/storage-restricted browsers */ }
    }
    if (config.ga4 && w.gtag) emit('ga4', config.ga4, () => w.gtag('event', 'add_to_cart', { send_to: config.ga4, currency: event.currency, value: event.value, ...(event.productId ? { items: [{ item_id: event.productId }] } : {}) }))
    if (config.tiktok && w.ttq) emit('tiktok', config.tiktok, () => w.ttq.track('AddToCart', { currency: event.currency, value: event.value, ...(event.productId ? { content_id: event.productId, content_type: 'product' } : {}) }, { event_id: event.id }))
  }
  pending.forEach(w.storemillCartEvent)
}
