import type { Page } from './store.ts'
import type { ImageLocalizationReport } from './clone-media.ts'

export type CopyReport = {
  discovered: number
  copied: number
  /** All discovered eligible pages were copied. Unlinked or login-only steps cannot be discovered automatically. */
  complete: boolean
  failed: Array<{ url: string; reason: string }>
  remaining: string[]
  externalSteps: string[]
  images?: ImageLocalizationReport
  captureIssues?: Array<{ url: string; reason: string }>
  interactionIssues?: Array<{ url: string; reason: string }>
  commerce?: { products: number; linkedPages: number; bundles: number; bumps: number; upsells: number; downsells: number; issues: Array<{url:string;reason:string}> }
}

export type CopyRoute = { source: string; target: string }

const tracking = /^(?:utm_.+|pr_.+|fbclid|gclid|dclid|msclkid|ttclid|srsltid|_gl|_ga|_pos|_sid|_ss|referrer|from|session_id|sessionid|cid|fnsh\.core\.cid)$/i
const paymentHost = /(?:^|\.)(?:stripe\.com|paypal\.com|klarna\.com|afterpay\.com|shop\.app)$/i
const nonPage = /\.(?:avif|gif|jpe?g|png|svg|webp|ico|css|js|mjs|json|xml|txt|woff2?|ttf|otf|eot|pdf|zip|mp4|webm|mp3)(?:$|\/)/i

export function decodeLink(value: string): string {
  return value.replace(/&(?:amp|#38|#x26);/gi, '&').replace(/&quot;|&#34;|&#x22;/gi, '"').replace(/&apos;|&#39;|&#x27;/gi, "'").trim()
}

export function canonicalPageUrl(value: string): string {
  try {
    const url = new URL(decodeLink(value))
    url.hash = ''
    url.pathname = url.pathname.replace(/\/+$/, '') || '/'
    url.pathname = url.pathname.replace(/^\/collections\/[^/]+(\/products\/[^/]+)$/i, '$1')
    for (const key of [...url.searchParams.keys()]) {
      if (tracking.test(key) || (key === 'variant' && /^\/products\/[^/]+\/?$/i.test(url.pathname))) url.searchParams.delete(key)
    }
    url.searchParams.sort()
    return url.toString()
  } catch { return value }
}

export function isPaymentUrl(value: string): boolean {
  try { return paymentHost.test(new URL(value).hostname) } catch { return false }
}

export function isCopyablePageUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || isPaymentUrl(value) || nonPage.test(url.pathname)) return false
    // Only read documents. Never follow a state-changing cart, account or subscription action.
    if (/^\/(?:admin|api|apps|accounts?|customer_authentication|login|logout|search|cdn|webhooks?)(?:\/|$)/i.test(url.pathname)) return false
    if (/^\/(?:cart\/(?:add|change|update|clear)|checkout\/(?:process|complete)|orders?\/(?:cancel|refund)|unsubscribe)(?:\/|$)/i.test(url.pathname)) return false
    if (/\/(?:undefined|null)(?:\/|$)/.test(url.pathname)) return false
    if ([...url.searchParams.keys()].some((key) => /^(?:add-to-cart|remove_item|delete|logout|unsubscribe|wc-ajax)$/i.test(key))) return false
    return true
  } catch { return false }
}

/** Read static links and declared next-step URLs; do not run the source's scripts or submit forms. */
export function discoverPageLinks(html: string, sourceUrl: string): string[] {
  const urls = new Set<string>()
  const add = (raw: string) => {
    if (!raw || /^(?:#|javascript:|mailto:|tel:|data:|blob:)/i.test(raw.trim())) return
    try {
      const url = new URL(decodeLink(raw).replace(/\\\//g, '/'), sourceUrl)
      if (/^https?:$/.test(url.protocol)) {
        const identity = new URL(canonicalPageUrl(url.toString()))
        // Keep the directory slash: it determines how a document resolves its relative assets and next-step links.
        identity.pathname = url.pathname
        urls.add(identity.toString())
      }
    } catch { /* malformed links are not pages */ }
  }
  for (const tag of html.match(/<(?:a|area|form|button|input|div)\b[^>]*>/gi) ?? []) {
    for (const attribute of tag.matchAll(/\s(?:href|action|formaction|data-copy-href|data-href|data-url|data-next-url|data-next-step|data-checkout-url)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) add(attribute[1] ?? attribute[2] ?? attribute[3] ?? '')
    const navigation = /\bonclick\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2] ?? ''
    const destination = /(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|(?:window\.)?location\.(?:assign|replace)\(\s*["']([^"']+)["']\s*\)/i.exec(decodeLink(navigation))
    if (destination) add(destination[1] ?? destination[2] ?? '')
  }
  for (const match of html.matchAll(/["']?(?:nextStepUrl|nextPageUrl|checkoutUrl|upsellUrl|downsellUrl|thankYouUrl|successUrl)["']?\s*:\s*["']([^"']+)["']/gi)) add(match[1] ?? '')
  return [...urls]
}

export function copyUrlPriority(value: string): number {
  const role = inferCopiedPage(value, '', false).role
  if (['offer', 'checkout', 'upsell', 'downsell', 'thankyou', 'cart'].includes(role)) return 0
  if (role === 'pdp' || role === 'advertorial') return 1
  return /\/(?:blogs|policies|terms|privacy)(?:\/|$)/i.test(new URL(value).pathname) ? 3 : 2
}

export function inferCopiedPage(value: string, html: string, funnel: boolean, first = false): { kind: Page['kind']; role: Page['role'] } {
  const url = new URL(value)
  const explicit = /\bdata-(?:page|step)-type=["']([^"']+)/i.exec(html)?.[1] ?? ''
  const title = /<title\b[^>]*>([^<]*)<\/title>/i.exec(html)?.[1] ?? ''
  const identity = `${url.pathname} ${[...url.searchParams].filter(([key]) => /^(?:step|page|view|type|route)$/i.test(key)).map(([, part]) => part).join(' ')} ${explicit} ${title}`.replace(/[^\w/\s-]/g, ' ')
  if (/\bclass=["'][^"']*\bfk-card-payment-container\b/i.test(html) || (/\bname=["'](?:cardNumber|card_number)["']/i.test(html) && /\bname=["'](?:shipAddress1|billing_address_1|shippingAddress)["']/i.test(html))) return { kind: 'checkout', role: 'checkout' }
  if (/(?:^|[\s/_-])(?:thank[\s_-]?you|thankyou|confirmation|order[\s_-]received|success)(?:$|[\s/_-])/i.test(identity)) return { kind: 'custom', role: 'thankyou' }
  if (/(?:^|[\s/_-])(?:checkout|check[\s_-]out|order[\s_-]form|payment)(?:$|[\s/_-])/i.test(identity)) return { kind: 'checkout', role: 'checkout' }
  if (/(?:^|[\s/_-])(?:cart|basket)(?:$|[\s/_-])/i.test(identity)) return { kind: 'custom', role: 'cart' }
  if (/(?:^|[\s/_-])(?:downsell|down[\s_-]sell)(?:\d|$|[\s/_-])/i.test(identity)) return { kind: 'custom', role: 'downsell' }
  if (/(?:^|[\s/_-])(?:upsell|up[\s_-]sell|oto)(?:\d|$|[\s/_-])/i.test(identity)) return { kind: 'custom', role: 'upsell' }
  if (/(?:^|[\s/_-])(?:advertorial|presell|pre[\s_-]sell|story)(?:$|[\s/_-])/i.test(identity)) return { kind: 'advertorial', role: 'advertorial' }
  if (/^\/products\/[^/]+\/?$/i.test(url.pathname)) return { kind: 'product', role: 'pdp' }
  if ((funnel && first) || /(?:^|[\s/_-])(?:offer|sales|landing)(?:$|[\s/_-])/i.test(identity)) return { kind: 'landing', role: 'offer' }
  return { kind: 'custom', role: 'page' }
}

/** Rewrite navigation attributes only: never replace a source origin inside CSS, text or image URLs. */
export function rewriteCopiedLinks(html: string, sourceUrl: string, routes: CopyRoute[]): string {
  const bySource = new Map(routes.map((route) => [canonicalPageUrl(route.source), route.target]))
  const escapeAttribute = (value: string, quote: string) => value.replace(/&/g, '&amp;').replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;')
  return html.replace(/<(?:a|area|form|button|input|div)\b[^>]*>/gi, (tag) => tag.replace(/(\s(?:href|action|formaction|data-copy-href|data-href|data-url|data-next-url|data-next-step|data-checkout-url)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (attribute: string, prefix: string, double: string | undefined, single: string | undefined, bare: string | undefined) => {
    const raw = double ?? single ?? bare ?? ''
    if (!raw || /^(?:#|javascript:|mailto:|tel:|data:|blob:)/i.test(raw)) return attribute
    try {
      const url = new URL(decodeLink(raw), sourceUrl)
      const target = bySource.get(canonicalPageUrl(url.toString()))
      if (!target) return attribute
      const local = new URL(target, 'https://copy.local')
      // Product selection is state, not a separate page; leave it available to the commerce bridge.
      if (url.searchParams.has('variant')) local.searchParams.set('variant', url.searchParams.get('variant') as string)
      local.hash = url.hash
      const quote = single === undefined ? '"' : "'"
      return `${prefix}${quote}${escapeAttribute(`${local.pathname}${local.search}${local.hash}`, quote)}${quote}`
    } catch { return attribute }
  }))
}

/** Follow a brand between its landing subdomain, shop and main website, excluding shared platform hosts. */
export function relatedSiteOrigin(value: string, origins: Set<string>): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase()
    const brand = (hostname: string) => hostname.replace(/^(?:(?:www|try|get|go|shop|store|checkout|buy|secure|pay|offer|offers|lp|funnel|landing)\.)+/, '')
    const shared = /(?:^|\.)(?:myshopify\.com|funnelish\.com|webflow\.io|pages\.dev|vercel\.app|netlify\.app)$/
    return [...origins].some(origin => { const other = new URL(origin).hostname.toLowerCase(); return host === other || !shared.test(host) && !shared.test(other) && brand(host) === brand(other) && brand(host).includes('.') })
  } catch { return false }
}
