import { escapeHtml } from '../lib/http.ts'
import { format } from '../lib/money.ts'
import type { Brand } from '../domain/types.ts'

/** A deliberately small Handlebars subset: `{{path}}`, `{{#each}}`, `{{#if}}`.
 * Merchants edit these templates, so the language has to be small enough that
 * a broken edit fails visibly rather than executing something. */
export function render(template: string, context: Record<string, unknown>): string {
  return template
    .replace(/\{\{#each\s+([\w.]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (_, path: string, body: string) => {
      const list = resolve(context, path)
      if (!Array.isArray(list)) return ''
      return list.map((item) => render(body, { ...context, this: item, ...(item && typeof item === 'object' ? (item as object) : {}) })).join('')
    })
    .replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_, path: string, yes: string, no = '') =>
      truthy(resolve(context, path)) ? render(yes, context) : render(no, context),
    )
    .replace(/\{\{\{([\w.]+)\}\}\}/g, (_, path: string) => String(resolve(context, path) ?? ''))
    .replace(/\{\{([\w.]+)\}\}/g, (_, path: string) => escapeHtml(resolve(context, path) ?? ''))
}

function truthy(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

function resolve(context: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[key] : undefined), context)
}

export type TemplateKey =
  | 'order_confirmation'
  | 'order_shipped'
  | 'order_delivered'
  | 'order_cancelled'
  | 'refund_issued'
  | 'welcome'
  | 'back_in_stock'
  | 'password_reset'
  | 'abandoned_cart'
  | 'review_request'
  | 'payment_failed'

export type EmailTemplate = {
  key: TemplateKey
  name: string
  trigger: string
  /** Delay after the trigger event, in hours. */
  delayHours: number
  subject: string
  body: string
}

const BODY = (inner: string) => `<h1>{{heading}}</h1>${inner}`

export const TEMPLATES: EmailTemplate[] = [
  {
    key: 'order_confirmation',
    name: 'Order confirmation',
    trigger: 'order.placed',
    delayHours: 0,
    subject: 'Order #{{order.displayId}} confirmed',
    body: BODY(`<p>Thanks {{customer.firstName}} — we have your order.</p>
<table class="items">{{#each order.items}}<tr><td>{{title}} — {{variantTitle}}</td><td class="qty">x{{quantity}}</td><td class="amt">{{lineTotal}}</td></tr>{{/each}}</table>
<table class="totals"><tr><td>Subtotal</td><td>{{order.subtotal}}</td></tr>
{{#if order.discount}}<tr><td>Discount {{order.discountCode}}</td><td>-{{order.discount}}</td></tr>{{/if}}
<tr><td>Shipping</td><td>{{order.shipping}}</td></tr><tr class="grand"><td>Total</td><td>{{order.total}}</td></tr></table>
<p><a class="btn" href="{{orderUrl}}">View your order</a></p>`),
  },
  { key: 'order_shipped', name: 'Shipped', trigger: 'order.fulfilled', delayHours: 0, subject: 'Order #{{order.displayId}} is on its way', body: BODY(`<p>Your order left the workshop.</p>{{#if tracking}}<p>Tracking: <strong>{{tracking}}</strong></p>{{/if}}<p><a class="btn" href="{{orderUrl}}">Track it</a></p>`) },
  { key: 'order_delivered', name: 'Delivered', trigger: 'order.delivered', delayHours: 0, subject: 'Order #{{order.displayId}} was delivered', body: BODY(`<p>It arrived. If anything is not right, reply to this email.</p>`) },
  { key: 'order_cancelled', name: 'Cancelled', trigger: 'order.cancelled', delayHours: 0, subject: 'Order #{{order.displayId}} was cancelled', body: BODY(`<p>Your order was cancelled and nothing was charged.</p>`) },
  { key: 'refund_issued', name: 'Refund', trigger: 'order.refunded', delayHours: 0, subject: 'Refund for order #{{order.displayId}}', body: BODY(`<p>We refunded {{amount}} to your original payment method. Banks usually take 5–10 days to show it.</p>`) },
  { key: 'welcome', name: 'Welcome', trigger: 'customer.created', delayHours: 0, subject: 'Welcome to {{store.name}}', body: BODY(`<p>{{store.slogan}}</p><p><a class="btn" href="{{storeUrl}}">Have a look around</a></p>`) },
  { key: 'back_in_stock', name: 'Back in stock', trigger: 'inventory.restocked', delayHours: 0, subject: '{{product.title}} is back in stock', body: BODY(`<p>You asked to hear when this came back. It has.</p><p><a class="btn" href="{{storeUrl}}">Get it before it goes again</a></p>`) },
  { key: 'password_reset', name: 'Password reset', trigger: 'auth.reset_requested', delayHours: 0, subject: 'Reset your password', body: BODY(`<p>This link works once and expires in an hour.</p><p><a class="btn" href="{{resetUrl}}">Set a new password</a></p>`) },
  { key: 'abandoned_cart', name: 'Abandoned cart', trigger: 'cart.abandoned', delayHours: 4, subject: 'You left something behind', body: BODY(`<p>Your cart is still here.</p><table class="items">{{#each cart.items}}<tr><td>{{title}}</td><td class="amt">{{lineTotal}}</td></tr>{{/each}}</table><p><a class="btn" href="{{cartUrl}}">Finish checking out</a></p>`) },
  { key: 'review_request', name: 'Review request', trigger: 'order.delivered', delayHours: 168, subject: 'How is your {{product.title}}?', body: BODY(`<p>You have had it a week. Would you tell other people what you think?</p>{{#if code}}<p>There is {{code}} in it for you — {{discount}} off your next order.</p>{{/if}}<p><a class="btn" href="{{reviewUrl}}">Leave a review</a></p>`) },
  { key: 'payment_failed', name: 'Payment failed', trigger: 'subscription.payment_failed', delayHours: 0, subject: 'Your payment did not go through', body: BODY(`<p>We will try again in 24 hours. Attempt {{attempt}} of 3.</p><p><a class="btn" href="{{updateUrl}}">Update your card</a></p>`) },
]

export function templateFor(key: TemplateKey): EmailTemplate {
  return TEMPLATES.find((template) => template.key === key) ?? (TEMPLATES[0] as EmailTemplate)
}

/**
 * The layout every transactional email shares. Table-based and inline-styled
 * on purpose: Outlook does not do flexbox, and a receipt that renders badly is
 * a support ticket.
 */
export function layout(brand: Brand, inner: string, storeName: string): string {
  const ink = brand.ink ?? '#1a1a1a'
  const paper = brand.paper ?? '#faf6f2'
  const accent = brand.primary ?? '#7a4a2b'
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<style>
body{margin:0;background:${paper};color:${ink};font:16px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif}
.wrap{max-width:560px;margin:0 auto;padding:32px 20px}
.card{background:#fff;border:1px solid rgba(0,0,0,.08);padding:28px}
h1{font:400 26px/1.2 Georgia,'Times New Roman',serif;margin:0 0 16px}
a.btn{display:inline-block;background:${accent};color:#fff;padding:12px 22px;text-decoration:none;margin-top:12px}
table{width:100%;border-collapse:collapse;margin:16px 0}
.items td{padding:8px 0;border-bottom:1px solid rgba(0,0,0,.06)}
.qty{text-align:center;color:#666;width:56px}.amt{text-align:right;width:88px}
.totals td{padding:4px 0}.totals .grand td{font-weight:600;border-top:1px solid rgba(0,0,0,.12);padding-top:10px}
.brand{font:400 13px/1 Georgia,serif;letter-spacing:.22em;text-transform:uppercase;margin-bottom:22px;color:${accent}}
.foot{color:#8a8078;font-size:12px;margin-top:22px}
</style></head><body><div class="wrap"><div class="brand">${escapeHtml(storeName)}</div><div class="card">${inner}</div>
<p class="foot">Sent by ${escapeHtml(storeName)} on storemill. Reply to this email and a person will read it.</p></div></body></html>`
}

export function lineTotals<T extends { unitCents: number; quantity: number }>(items: T[], currency: string) {
  return items.map((item) => ({ ...item, lineTotal: format(item.unitCents * item.quantity, currency) }))
}
