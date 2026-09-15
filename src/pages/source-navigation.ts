import { assignedJson } from './source-data.ts'
import { assertPublicNetworkUrl } from './public-network.ts'
import { isCopyablePageUrl } from './site-copy.ts'
import { mapMediaDocument, decodeMediaAttribute } from './clone-media.ts'

export type SourceNavigation = { html: string; links: string[]; issues: string[]; next?: string }

/** Funnelish uses a navigation resolver instead of hrefs. Never call its order/opt-in endpoints. */
export async function resolveSourceNavigation(html: string, source: string, options: { fetchImpl?: typeof fetch; signal?: AbortSignal }): Promise<SourceNavigation> {
  const result: SourceNavigation = { html, links: [], issues: [] }
  const step = assignedJson(html, 'STEP'), funnel = assignedJson(html, 'FUNNEL')
  if (!step?.id || !funnel?.id || !step.user_id || !/funnelish|\$store\.interactions/i.test(html)) return result
  const pageId = /<meta\b[^>]*name=["']?pageid["']?[^>]*content=["']?(\d+)/i.exec(html)?.[1]
  if (!pageId) return result
  const routes = new Map<string, string>()
  const markers = new Set<string>()
  if (/#(?:next-step|submit-step|yes-link(?:-\d+)?|no-link)(?:["'\s>]|$)/i.test(html)) markers.add('next-step')
  for (const match of html.matchAll(/#(go-to-step-\d+|go-to-stage-\d+|go-to-next-stage)(?=["'\s>])/gi)) markers.add(match[1]!)
  for (const marker of [...markers].slice(0, 30)) {
    options.signal?.throwIfAborted()
    const endpoint = new URL('/' + marker, source).href
    try {
      if (!options.fetchImpl) await assertPublicNetworkUrl(endpoint, { signal: options.signal })
      const response = await (options.fetchImpl ?? fetch)(endpoint, {
        method: 'POST', redirect: 'manual', signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        // Only public page identity; no cookies, customer/contact/payment data, products or purchase event.
        body: JSON.stringify({ step_id: step.id, page_id: Number(pageId), user_id: step.user_id, funnel_id: funnel.id, page_url: source, event: marker, customer: {}, is_oto: true, test_mode: 1, currency: funnel.currency_code || 'USD', country: 'US' }),
      })
      if (!response.ok || Number(response.headers.get('content-length')) > 100_000) throw Error('Navigation resolver answered ' + response.status)
      const body = await response.text(); if (body.length > 100_000) throw Error('Navigation response was too large')
      const data = JSON.parse(body), value = data.data?.next || data.data?.goto || data.url
      if (typeof value !== 'string' || !isCopyablePageUrl(new URL(value,source).href)) throw Error('No public next-page destination was returned')
      routes.set('#' + marker, new URL(value, source).href)
      if(marker==='next-step')result.next=new URL(value,source).href
      result.links.push(new URL(value, source).href)
    } catch (error) { options.signal?.throwIfAborted(); result.issues.push(`Could not resolve ${marker}: ${error instanceof Error ? error.message : 'unavailable'}`) }
  }
  result.html = mapMediaDocument(html, tag => tag.replace(/(\s(?:href|data-next-step|data-href)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (original, prefix, a, b, c) => {
    const marker = decodeMediaAttribute(a ?? b ?? c ?? ''), value = routes.get(marker)
    // Submit/accept controls stay actions. Their destination only enters discovery.
    return value ? prefix + '"' + value.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '"' : original
  }))
  return result
}
