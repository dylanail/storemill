import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Db } from '../lib/db.ts'
import { readCredentials, getInstalled } from '../control/plugins.ts'
import type { Order } from '../domain/types.ts'

/**
 * A Stripe client with no SDK.
 *
 * Stripe's API is form-encoded requests and JSON replies, which is well within
 * `fetch`. Keeping it this thin means the only thing the platform trusts is
 * the secret key it sealed at install, resolved per store, per request.
 *
 * `transport` exists so tests can stand in for Stripe without touching the
 * network: the shape of every call is exercised, the wire is not.
 */
export type StripeTransport = (path: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

export type StripeClient = {
  paymentIntents: {
    create: (input: { amountCents: number; currency: string; customerId?: string; metadata?: Record<string, string>; saveForLater?: boolean; receiptEmail?: string; idempotencyKey?: string }) => Promise<PaymentIntent>
    retrieve: (id: string) => Promise<PaymentIntent>
    cancel: (id: string) => Promise<PaymentIntent>
    /** Re-price the intent a shopper is already looking at, rather than opening another one. */
    update: (id: string, input: { amountCents?: number; customerId?: string; saveForLater?: boolean; receiptEmail?: string }) => Promise<PaymentIntent>
    /** The one-click upsell: charge a saved method with the customer away. */
    chargeOffSession: (input: { amountCents: number; currency: string; customerId: string; paymentMethodId: string; idempotencyKey?: string; metadata?: Record<string, string> }) => Promise<PaymentIntent>
  }
  customers: { create: (input: { email: string; name?: string }) => Promise<{ id: string }> }
  refunds: { create: (input: { paymentIntentId: string; amountCents?: number; reason?: string }) => Promise<{ id: string; status: string }> }
}

export type PaymentIntent = {
  id: string
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'requires_capture' | 'succeeded' | 'canceled'
  client_secret?: string
  amount: number
  currency: string
  customer?: string | null
  payment_method?: string | null
  metadata?: Record<string, string>
}

function encode(input: Record<string, unknown>, prefix = ''): string[] {
  const parts: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (typeof value === 'object' && !Array.isArray(value)) parts.push(...encode(value as Record<string, unknown>, name))
    else if (Array.isArray(value)) value.forEach((entry, index) => parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(entry))}`))
    else parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
  }
  return parts
}

export function formBody(input: Record<string, unknown>): string {
  return encode(input).join('&')
}

export const defaultTransport: StripeTransport = async (path, init) => {
  const response = await fetch(`https://api.stripe.com${path}`, init)
  return { ok: response.ok, status: response.status, json: () => response.json() }
}

export function stripeClient(secretKey: string, transport: StripeTransport = defaultTransport): StripeClient {
  const call = async <T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> => {
    const response = await transport(path, {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Stripe-Version': '2024-06-20',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      ...(body ? { body: formBody(body) } : {}),
    })
    const payload = (await response.json()) as { error?: { message?: string } } & T
    if (!response.ok) throw new Error(payload.error?.message ?? `Stripe answered ${response.status}`)
    return payload
  }
  return {
    paymentIntents: {
      create: (input) =>
        call<PaymentIntent>('POST', '/v1/payment_intents', {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          automatic_payment_methods: { enabled: true },
          ...(input.customerId ? { customer: input.customerId } : {}),
          ...(input.saveForLater ? { setup_future_usage: 'off_session' } : {}),
          ...(input.receiptEmail ? { receipt_email: input.receiptEmail } : {}),
          ...(input.metadata ? { metadata: input.metadata } : {}),
        }, input.idempotencyKey),
      retrieve: (id) => call<PaymentIntent>('GET', `/v1/payment_intents/${encodeURIComponent(id)}`),
      cancel: (id) => call<PaymentIntent>('POST', `/v1/payment_intents/${encodeURIComponent(id)}/cancel`),
      update: (id, input) =>
        call<PaymentIntent>('POST', `/v1/payment_intents/${encodeURIComponent(id)}`, {
          ...(input.amountCents === undefined ? {} : { amount: input.amountCents }),
          ...(input.customerId ? { customer: input.customerId } : {}),
          ...(input.saveForLater ? { setup_future_usage: 'off_session' } : {}),
          ...(input.receiptEmail ? { receipt_email: input.receiptEmail } : {}),
        }),
      chargeOffSession: (input) =>
        call<PaymentIntent>('POST', '/v1/payment_intents', {
          amount: input.amountCents,
          currency: input.currency.toLowerCase(),
          customer: input.customerId,
          payment_method: input.paymentMethodId,
          off_session: true,
          confirm: true,
          ...(input.metadata ? { metadata: input.metadata } : {}),
        }, input.idempotencyKey),
    },
    customers: { create: (input) => call<{ id: string }>('POST', '/v1/customers', { email: input.email, ...(input.name ? { name: input.name } : {}) }) },
    refunds: {
      create: (input) =>
        call<{ id: string; status: string }>('POST', '/v1/refunds', {
          payment_intent: input.paymentIntentId,
          ...(input.amountCents ? { amount: input.amountCents } : {}),
          ...(input.reason ? { reason: input.reason } : {}),
        }),
    },
  }
}

/** Stripe-Signature: t=<ts>,v1=<hmac>. Verified before a webhook can move an order. */
export function verifyWebhookSignature(payload: string, header: string, secret: string, toleranceSeconds = 300, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(',').map((pair) => pair.trim().split('=') as [string, string]))
  const timestamp = Number(parts.t)
  const signature = parts.v1
  if (!timestamp || !signature) return false
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false
  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function signWebhook(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`
}

/* --------------------------------------------------------------- per store */

export type StoreStripe = { publishableKey: string; secretKey: string; webhookSecret: string; captureMode: string } | null

let transportOverride: StripeTransport | null = null

/** Tests point every store's client at a stand-in. */
export function useStripeTransport(transport: StripeTransport | null) {
  transportOverride = transport
}

/**
 * Move the money for a refund, wherever the refund was asked for.
 *
 * The admin's Refund button did this; the assistant's `refund_order` and
 * `accept_return` tools wrote the refund row and reported "Refunded $89.00"
 * without ever calling Stripe, so the card was untouched. One function now,
 * called by all three.
 *
 * A post-purchase upsell is charged on its own PaymentIntent. Refunding the
 * order in full has to give back both, or the customer is short the upsell
 * while the order reads "refunded" and the profit report has already
 * subtracted the whole amount.
 */
export async function refundThroughProvider(
  db: Db,
  storeId: string,
  order: Order,
  amountCents?: number,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (order.paymentProvider !== 'stripe' || !order.paymentIntentId) return { ok: true }
  const stripe = stripeFor(db, storeId)
  if (!stripe) return { ok: false, message: 'This order was paid through Stripe, which is no longer connected.' }
  const already = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
  const outstanding = Math.max(0, order.totalCents - already)
  const asked = amountCents ?? outstanding
  const upsell = order.upsell.accepted ? (order.upsell.amountCents ?? 0) : 0
  const upsellIntent = order.upsell.paymentIntentId ?? ''
  // The upsell's own charge is given back only when the refund covers it,
  // and the original intent is never asked for more than it took.
  const onUpsell = upsellIntent && upsell ? Math.min(upsell, asked) : 0
  const onOriginal = asked - onUpsell
  try {
    if (onOriginal > 0) await stripe.client.refunds.create({ paymentIntentId: order.paymentIntentId, amountCents: onOriginal, reason: 'requested_by_customer' })
    if (onUpsell > 0) await stripe.client.refunds.create({ paymentIntentId: upsellIntent, amountCents: onUpsell, reason: 'requested_by_customer' })
  } catch (error) {
    return { ok: false, message: `Stripe refused the refund: ${error instanceof Error ? error.message : 'unknown error'}` }
  }
  return { ok: true }
}

export function stripeFor(db: Db, storeId: string): { client: StripeClient; config: NonNullable<StoreStripe> } | null {
  const installed = getInstalled(db, storeId, 'stripe')
  if (!installed || !installed.enabled) return null
  const secrets = readCredentials(db, storeId, 'stripe')
  const secretKey = String(secrets.secretKey ?? '')
  const publishableKey = String(installed.settings.publishableKey ?? '')
  if (!secretKey || !publishableKey) return null
  return {
    client: stripeClient(secretKey, transportOverride ?? defaultTransport),
    config: { publishableKey, secretKey, webhookSecret: String(secrets.webhookSecret ?? ''), captureMode: String(installed.settings.captureMode ?? 'automatic') },
  }
}
