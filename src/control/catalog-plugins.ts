import { metaClient } from '../analytics/meta-browser.ts'
import { minorDigits } from '../lib/money.ts'
import { escapeHtml } from '../lib/http.ts'
import type { Plugin } from './plugin-types.ts'

export type { Plugin }

/**
 * The first-party catalog: the plugins that actually install and do something.
 *
 * The public directory carries a few hundred more entries that are name,
 * category and website only — a "we know this exists" listing. Those are
 * generated in `directoryEntries()` below and are deliberately not installable,
 * because a settings form for an integration nobody wrote is a lie.
 */
export const FIRST_PARTY: Plugin[] = [
  {
    id: 'stripe',
    name: 'Stripe',
    version: '1.0.0',
    npmPackage: '@storemill/stripe',
    category: 'Payments',
    source: 'first-party',
    regions: [],
    featured: true,
    description: 'Card, Apple Pay, Google Pay and Link, paid out directly to your account.',
    longDescription:
      'Connect once and charges settle to your own Stripe account. storemill never sits in the flow of funds and adds no platform fee, so a chargeback or a payout hold is between you and Stripe.',
    manifest: {
      kind: 'integration',
      api: { admin: ['POST /admin/plugins/stripe/connect', 'GET /admin/plugins/stripe/status'], store: ['POST /store/payments/stripe/intent'] },
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/stripe/settings',
        settingsSchema: {
          publishableKey: { type: 'string', label: 'Publishable key', pattern: '^pk_(test|live)_', required: true, help: 'Safe to expose; the storefront reads it.' },
          secretKey: { type: 'string', label: 'Secret key', pattern: '^sk_(test|live)_', required: true, help: 'Sealed at rest and never returned to the browser.' },
          webhookSecret: { type: 'string', label: 'Webhook signing secret', pattern: '^whsec_', help: 'Use the webhook URL shown in Payments: /s/<store slug>/webhooks/stripe on the shared host, or /webhooks/stripe on your store domain. Sealed at rest.' },
          captureMode: { type: 'string', label: 'Capture', enum: ['automatic'], default: 'automatic', help: 'Checkout currently supports automatic capture. Existing manual settings must be explicitly changed before taking payments.' },
          saveCards: { type: 'boolean', label: 'Save cards for one-click post-purchase offers', default: true },
        },
        secretFields: ['secretKey', 'webhookSecret'],
        aiTools: [
          {
            name: 'connect_stripe',
            description: 'Connect a Stripe account so the store can take payments.',
            schema: {
              publishableKey: { type: 'string', required: true, pattern: '^pk_(test|live)_' },
              secretKey: { type: 'string', required: true, pattern: '^sk_(test|live)_' },
              webhookSecret: { type: 'string', pattern: '^whsec_' },
            },
            example: "connect_stripe({ publishableKey: 'pk_test_...', secretKey: 'sk_test_...' })",
          },
        ],
      },
      capabilities: [{ id: 'stripe', type: 'payment_provider', label: 'Stripe' }],
    },
  },
  {
    id: 'product-reviews',
    name: 'Product Reviews',
    version: '1.2.0',
    npmPackage: '@storemill/product-reviews',
    category: 'Brand & Reputation',
    source: 'first-party',
    regions: [],
    featured: true,
    description: 'Collect, moderate and display reviews, with photo uploads and an extractive summary.',
    manifest: {
      kind: 'hybrid',
      api: { admin: ['GET /admin/reviews', 'POST /admin/reviews/:id/moderate'], store: ['POST /store/reviews'] },
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/product-reviews/settings',
        settingsSchema: {
          autoRequest: { type: 'boolean', label: 'Email a review request 7 days after delivery', default: true },
          requestDiscount: { type: 'string', label: 'Discount code to include', help: 'Leave empty to ask without an incentive.' },
          component: { type: 'string', label: 'Storefront component', enum: ['grid', 'horizontal', 'quote', 'bubbles'], default: 'grid' },
        },
        aiTools: [
          { name: 'list_reviews', description: 'List reviews, optionally filtered by product or moderation status.', schema: { productId: { type: 'string' }, status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'all'] } }, example: "list_reviews({ status: 'pending' })" },
        ],
      },
      storefront: {
        components: [
          { id: 'ReviewBadge', slot: 'pdpBelowAddToCart', placement: 'fixed' },
          { id: 'ReviewWall', placement: 'merchant_choice', validSlots: ['pdpBelowAddToCart', 'accountOverview'], defaultSlot: 'pdpBelowAddToCart' },
        ],
      },
    },
  },
  {
    id: 'shippo',
    name: 'Shippo',
    version: '0.4.0',
    npmPackage: '@storemill/shippo',
    category: 'Shipping & Fulfillment',
    source: 'first-party',
    regions: ['US'],
    description: 'Buy and print labels from the order page; tracking flows back automatically.',
    manifest: {
      kind: 'integration',
      api: { admin: ['POST /admin/plugins/shippo/connect', 'POST /admin/orders/:id/label'], store: [] },
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/shippo/settings',
        settingsSchema: {
          apiToken: { type: 'string', label: 'API token', required: true, help: 'Sealed at rest.' },
          defaultService: { type: 'string', label: 'Default service', enum: ['usps_priority', 'ups_ground', 'fedex_home'], default: 'usps_priority' },
        },
        secretFields: ['apiToken'],
        aiTools: [
          { name: 'connect_shippo', description: 'Connect a Shippo account for label buying and tracking.', schema: { apiToken: { type: 'string', required: true } }, example: "connect_shippo({ apiToken: 'shippo_live_...' })" },
        ],
      },
      capabilities: [{ id: 'shippo', type: 'fulfillment_provider', label: 'Shippo' }],
    },
  },
  {
    id: 'ga4',
    name: 'Google Analytics 4',
    version: '1.0.0',
    npmPackage: '@storemill/ga4',
    category: 'Analytics',
    source: 'first-party',
    regions: [],
    description: 'Send page views and purchases to GA4 alongside the first-party analytics.',
    manifest: {
      kind: 'ux_module',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/ga4/settings',
        settingsSchema: { measurementId: { type: 'string', label: 'Measurement ID', pattern: '^G-[A-Z0-9]+$', required: true } },
        aiTools: [{ name: 'connect_ga4', description: 'Add a GA4 measurement ID to the storefront.', schema: { measurementId: { type: 'string', required: true, pattern: '^G-[A-Z0-9]+$' } }, example: "connect_ga4({ measurementId: 'G-ABC123' })" }],
      },
      storefront: {
        components: [
          {
            id: 'Ga4Tag',
            slot: 'headEnd',
            placement: 'fixed',
            render: ({ settings }) =>
              `<script async src="https://www.googletagmanager.com/gtag/js?id=${escapeHtml(settings.measurementId)}"></script>` +
              `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${escapeHtml(settings.measurementId)}')</script>`,
          },
          { id: 'Ga4Purchase', slot: 'orderConfirmed', placement: 'fixed', render: ({ context }) => `<script>window.gtag&&gtag('event','purchase',{transaction_id:'${escapeHtml(context.orderId ?? '')}',value:${Number(context.total ?? 0) / 100},currency:'${escapeHtml(context.currency ?? 'USD')}'})</script>` },
          { id: 'Ga4AddToCart', slot: 'cartUpdate', placement: 'fixed', render: ({ context }) => `<script>window.gtag&&gtag('event','add_to_cart',{value:${Number(context.amount ?? 0) / 100},currency:'${escapeHtml(context.currency ?? 'USD')}'})</script>` },
        ],
      },
      disableInPreview: true,
    },
  },
  {
    id: 'meta-pixel',
    name: 'Meta Pixel + CAPI',
    version: '1.1.0',
    npmPackage: '@storemill/meta-ads',
    category: 'Marketing & Email',
    source: 'first-party',
    regions: [],
    description: 'Browser pixel plus durable server-side conversions; purchases share one event id for deduplication.',
    manifest: {
      kind: 'integration',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/meta-pixel/settings',
        settingsSchema: {
          pixelId: { type: 'string', label: 'Pixel ID', pattern: '^[0-9]{8,20}$', required: true },
          testEventCode: { type:'string', label:'Meta Test Events code', help:'Optional. Remove after verifying delivery in Events Manager.', pattern:'^[A-Za-z0-9_-]*$' },
          accessToken: { type: 'string', label: 'Conversions API token', help: 'Sealed at rest. Without it only the browser pixel fires.' },
        },
        secretFields: ['accessToken'],
        aiTools: [{ name: 'connect_meta_pixel', description: 'Install the Meta pixel and, if a token is given, the Conversions API.', schema: { pixelId: { type: 'string', required: true }, accessToken: { type: 'string' } }, example: "connect_meta_pixel({ pixelId: '123456789' })" }],
      },
      storefront: {
        components: [
          {
            id: 'MetaPixel',
            slot: 'headEnd',
            placement: 'fixed',
            render: ({ settings }) =>
              `<script data-meta-pixel>(${metaClient.toString()})(${JSON.stringify(String(settings.pixelId)).replace(/</g,'\\u003c')})</script>`,
          },
          { id: 'MetaPurchase', slot: 'orderConfirmed', placement: 'fixed', render: ({ context }) => `<script>window.amborasMeta&&window.amborasMeta(${JSON.stringify({id:String(context.orderId||''),name:'Purchase',data:{value:Number(context.total||0)/10**minorDigits(String(context.currency||'USD')),currency:String(context.currency||'USD')}}).replace(/</g,'\\u003c')})</script>` },
        ],
      },
      capabilities: [{ id: 'meta', type: 'analytics_sink', label: 'Meta Conversions API' }],
      disableInPreview: true,
    },
  },
  {
    id: 'tiktok-pixel',
    name: 'TikTok Pixel + Events API',
    version: '1.1.0',
    npmPackage: '@storemill/tiktok-ads',
    category: 'Marketing & Email',
    source: 'first-party',
    regions: [],
    description: 'Browser pixel plus durable server-side web events; purchases share one event id for deduplication.',
    manifest: {
      kind: 'integration',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/tiktok-pixel/settings',
        settingsSchema: {
          pixelId: { type: 'string', label: 'Pixel ID', pattern: '^[A-Z0-9]{10,30}$', required: true },
          accessToken: { type: 'string', label: 'Events API access token', help: 'Sealed at rest. Without it only the browser pixel fires.' },
        },
        secretFields: ['accessToken'],
        aiTools: [{ name: 'connect_tiktok_pixel', description: 'Install the TikTok pixel and, if a token is given, the Events API.', schema: { pixelId: { type: 'string', required: true }, accessToken: { type: 'string' } }, example: "connect_tiktok_pixel({ pixelId: 'CABC123…' })" }],
      },
      storefront: {
        components: [
          { id: 'TikTokPixel', slot: 'headEnd', placement: 'fixed', render: ({ settings }) => `<script>!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${escapeHtml(settings.pixelId)}');ttq.page();}(window,document,'ttq');</script>` },
          { id: 'TikTokPurchase', slot: 'orderConfirmed', placement: 'fixed', render: ({ context }) => `<script>window.ttq&&ttq.track('CompletePayment',{value:${Number(context.total ?? 0) / 100},currency:'${escapeHtml(context.currency ?? 'USD')}',content_id:'${escapeHtml(context.orderId ?? '')}'},{event_id:'${escapeHtml(context.orderId ?? '')}'})</script>` },
          { id: 'TikTokAddToCart', slot: 'cartUpdate', placement: 'fixed', render: ({ context }) => `<script>window.ttq&&ttq.track('AddToCart',{value:${Number(context.amount ?? 0) / 100},currency:'${escapeHtml(context.currency ?? 'USD')}'})</script>` },
        ],
      },
      capabilities: [{ id: 'tiktok', type: 'analytics_sink', label: 'TikTok Events API' }],
      disableInPreview: true,
    },
  },
  {
    id: 'exit-intent',
    name: 'Exit Intent',
    version: '0.9.0',
    npmPackage: '@storemill/exit-intent',
    category: 'Conversion & Upsell',
    source: 'first-party',
    regions: [],
    description: 'Catch a leaving visitor with one offer, once per session.',
    manifest: {
      kind: 'ux_module',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/exit-intent/settings',
        settingsSchema: {
          headline: { type: 'string', label: 'Headline', default: 'Before you go', required: true },
          body: { type: 'string', label: 'Body', default: 'Take 10% off your first order.', multiline: true },
          code: { type: 'string', label: 'Discount code', default: 'WELCOME10' },
        },
        aiTools: [{ name: 'configure_exit_intent', description: 'Set the exit-intent offer copy and code.', schema: { headline: { type: 'string' }, body: { type: 'string' }, code: { type: 'string' } }, example: "configure_exit_intent({ code: 'STAY15' })" }],
      },
      storefront: {
        components: [
          {
            id: 'ExitIntentModal',
            slot: 'bodyEnd',
            placement: 'fixed',
            render: ({ settings }) => `
<dialog id="exit-intent" class="exit-intent">
  <form method="dialog">
    <h3>${escapeHtml(settings.headline ?? 'Before you go')}</h3>
    <p>${escapeHtml(settings.body ?? '')}</p>
    <p class="code">${escapeHtml(settings.code ?? '')}</p>
    <button class="btn">Keep shopping</button>
  </form>
</dialog>
<script>(function(){var d=document.getElementById('exit-intent');if(!d||sessionStorage.getItem('ei'))return;
document.addEventListener('mouseout',function(e){if(e.clientY<=0&&!d.open){sessionStorage.setItem('ei','1');d.showModal()}})})()</script>`,
          },
        ],
      },
      disableInPreview: true,
    },
  },
  {
    id: 'upsells',
    name: 'Upsells & Cross-sells',
    version: '1.0.0',
    npmPackage: '@storemill/upsells',
    category: 'Conversion & Upsell',
    source: 'first-party',
    regions: [],
    featured: true,
    description: 'Frequently-bought-together and cart-drawer offers, ranked from your own order history.',
    manifest: {
      kind: 'ux_module',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/upsells/settings',
        settingsSchema: {
          placement: { type: 'string', label: 'Placement', enum: ['pdpBelowAddToCart', 'cartDrawer'], default: 'pdpBelowAddToCart' },
          headline: { type: 'string', label: 'Headline', default: 'Goes with this' },
          maxItems: { type: 'number', label: 'How many to show', integer: true, min: 1, max: 4, default: 2 },
        },
        aiTools: [{ name: 'configure_upsells', description: 'Set where the upsell widget appears and what it says.', schema: { placement: { type: 'string', enum: ['pdpBelowAddToCart', 'cartDrawer'] }, headline: { type: 'string' } }, example: "configure_upsells({ placement: 'cartDrawer' })" }],
      },
      storefront: { components: [{ id: 'FrequentlyBoughtTogether', placement: 'merchant_choice', validSlots: ['pdpBelowAddToCart', 'cartDrawer'], defaultSlot: 'pdpBelowAddToCart' }] },
    },
  },
  {
    id: 'contact-form',
    name: 'Contact Form',
    version: '0.5.0',
    npmPackage: '@storemill/contact-form',
    category: 'Customer Support',
    source: 'first-party',
    regions: [],
    description: 'A contact form with an inbox in the admin. No third party involved.',
    manifest: {
      kind: 'ux_module',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/contact-form/settings',
        settingsSchema: { forwardTo: { type: 'string', label: 'Forward submissions to', help: 'Leave empty to keep them in the admin only.' } },
      },
      storefront: { components: [{ id: 'ContactForm', placement: 'merchant_choice', validSlots: ['accountOverview'], defaultSlot: 'accountOverview' }] },
    },
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    version: '1.0.0',
    npmPackage: '@storemill/klaviyo',
    category: 'Marketing & Email',
    source: 'first-party',
    regions: [],
    planGated: true,
    allowedPlanIds: ['starter', 'scale', 'enterprise'],
    description: 'Sync customers and orders to Klaviyo through a durable outbox.',
    manifest: {
      kind: 'integration',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/klaviyo/settings',
        settingsSchema: { apiKey: { type: 'string', label: 'Private API key', required: true }, listId: { type: 'string', label: 'List ID' } },
        secretFields: ['apiKey'],
        aiTools: [{ name: 'connect_klaviyo', description: 'Connect Klaviyo and start syncing customers.', schema: { apiKey: { type: 'string', required: true }, listId: { type: 'string' } }, example: "connect_klaviyo({ apiKey: 'pk_...' })" }],
      },
      capabilities: [{ id: 'klaviyo', type: 'analytics_sink', label: 'Klaviyo' }],
    },
  },
  {
    id: 'engraving',
    name: 'Engraving',
    version: '0.3.0',
    npmPackage: '@storemill/engraving',
    category: 'Conversion & Upsell',
    source: 'first-party',
    regions: [],
    description: 'Sell personalisation as a paid option on any product.',
    manifest: {
      kind: 'ux_module',
      admin: {
        hasSettings: true,
        settingsRoute: '/plugins/engraving/settings',
        settingsSchema: {
          label: { type: 'string', label: 'Button label', default: 'Add engraving' },
          feeCents: { type: 'number', label: 'Fee (minor units)', integer: true, min: 0, default: 4500 },
          maxCharacters: { type: 'number', label: 'Max characters', integer: true, min: 1, max: 40, default: 12 },
        },
      },
      storefront: { components: [{ id: 'EngravingButton', placement: 'merchant_choice', validSlots: ['pdpBelowAddToCart'], defaultSlot: 'pdpBelowAddToCart' }] },
    },
  },
]

const DIRECTORY_CATEGORIES: Array<[string, number, string[]]> = [
  ['Shipping & Fulfillment', 33, ['US', 'EU', 'MX', 'IN', 'GB', 'VN']],
  ['Inventory & Ops', 15, []],
  ['Analytics', 13, []],
  ['Marketing & Email', 12, []],
  ['Accounting & Tax', 12, ['EU', 'DE']],
  ['Customer Support', 11, []],
  ['Loyalty', 9, []],
  ['Subscriptions', 9, []],
  ['Conversion & Upsell', 9, []],
  ['SMS', 8, ['US']],
  ['Sales Channels', 8, []],
  ['Payments', 8, ['TR', 'VN', 'IN']],
  ['SEO', 8, []],
  ['Page Builders', 8, []],
  ['Fraud', 8, []],
  ['Translation', 8, []],
  ['Brand & Reputation', 8, []],
]

const NOUNS = ['Flow', 'Desk', 'Hub', 'Loop', 'Bridge', 'Sync', 'Pilot', 'Ledger', 'Signal', 'Atlas', 'Beacon', 'Forge', 'Relay', 'Vault', 'Compass', 'Anchor', 'Prism']
const PREFIXES = ['Ship', 'Order', 'Stock', 'Track', 'Bright', 'Clear', 'North', 'Swift', 'Iron', 'Open', 'True', 'Bold', 'Quick', 'Sun', 'Blue', 'Ever', 'Fair']

/** Directory-only listings. Discoverable, honestly marked, never installable. */
export function directoryEntries(): Plugin[] {
  const out: Plugin[] = []
  for (const [category, count, regions] of DIRECTORY_CATEGORIES) {
    for (let index = 0; index < count; index++) {
      const name = `${PREFIXES[(index * 7 + category.length) % PREFIXES.length]}${NOUNS[(index * 5 + category.length) % NOUNS.length]}`
      const slug = `${name.toLowerCase()}-${category.toLowerCase().replace(/[^a-z]+/g, '')}`.slice(0, 40)
      out.push({
        id: slug,
        name,
        version: '0.0.0',
        npmPackage: '',
        category,
        source: 'third-party',
        regions: regions.length ? [regions[index % regions.length] as string] : [],
        website: `https://${name.toLowerCase()}.example.com`,
        description: `${category} for stores that already run ${name}. Listed in the directory; not yet a first-party integration.`,
        manifest: { kind: 'integration' },
      })
    }
  }
  return out
}

let cached: Plugin[] | null = null

export function allPlugins(): Plugin[] {
  if (!cached) cached = [...FIRST_PARTY, ...directoryEntries()]
  return cached
}

export function findPlugin(pluginId: string): Plugin | null {
  return allPlugins().find((plugin) => plugin.id === pluginId) ?? null
}

export function pluginCategories(): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const plugin of allPlugins()) counts.set(plugin.category, (counts.get(plugin.category) ?? 0) + 1)
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}
