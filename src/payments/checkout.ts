import type { Db } from '../lib/db.ts'
import { totals, type Cart } from '../domain/cart.ts'
import { completeCart, CheckoutError, orderByPaymentIntent } from '../domain/orders.ts'
import type { PaymentIntent } from './stripe.ts'

/** Use exactly the same first-order discount decision when charging and creating the order. */
export function paymentTotals(db: Db, storeId: string, cart: Cart) {
  const prior = db.one<{ c: number }>('SELECT COUNT(*) c FROM orders WHERE store_id = ? AND email = ? COLLATE NOCASE', storeId, cart.checkout.email || cart.email)?.c ?? 0
  return totals(db, storeId, cart, { isFirstOrder: prior === 0 })
}

/** Both the redirect and signed webhook use this guard, before inventory or orders move. */
export function completeStripeCart(db: Db, storeId: string, cart: Cart, intent: PaymentIntent) {
  if (intent.id !== cart.paymentIntentId || intent.metadata?.storeId !== storeId || intent.metadata?.cartId !== cart.id) throw new CheckoutError('This payment does not belong to this cart.')
  const existing = orderByPaymentIntent(db, storeId, intent.id)
  if (existing) return { order: existing, created: false }
  if (intent.status !== 'succeeded') throw new CheckoutError(intent.status === 'processing' ? 'Your payment is processing. Your order will be confirmed when the payment succeeds.' : 'The payment has not completed. Please try another payment method.')
  const amount = paymentTotals(db, storeId, cart)
  if (intent.currency.toUpperCase() !== amount.currency.toUpperCase() || intent.amount !== amount.totalCents) throw new CheckoutError('The cart changed after payment started. Please contact the store so we can reconcile this payment.')
  const order = completeCart(db, storeId, cart.id, {
    email: cart.checkout.email || '', ...(cart.checkout.name ? { name: cart.checkout.name } : {}),
    ...(cart.checkout.address ? { address: cart.checkout.address } : {}), marketing: cart.checkout.marketing || false,
    payment: { provider:'stripe',intentId:intent.id,customerId:intent.customer || '',methodId:intent.payment_method || '',status:'captured' },
  })
  return { order, created: true }
}
