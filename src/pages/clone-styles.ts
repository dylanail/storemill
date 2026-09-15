import { resolveMediaUrl, rewriteCssImages } from './clone-media.ts'
import { assertPublicNetworkUrl } from './public-network.ts'

const stylesheetSources = new WeakMap<Map<string, string>, Map<string, string>>()

type StyleOptions = {
  fetchImpl: typeof fetch
  signal?: AbortSignal
  cache?: Map<string, string>
  notes: string[]
  issues?: string[]
  userAgent: string
}

export function absoluteCssUrls(css: string, source: string): string {
  return rewriteCssImages(css, (url) => resolveMediaUrl(url, source), true)
}

/** Own imported CSS in place, including mobile imports, while retaining media/layer/supports conditions. */
export async function copyStylesheet(url: string, options: StyleOptions, ancestors: string[] = []): Promise<{ css: string; count: number }> {
  if (ancestors.includes(url)) return { css: '/* circular stylesheet import omitted */', count: 0 }
  if (ancestors.length >= 8) throw new Error('Stylesheet imports exceed eight nested levels')
  let source = options.cache && stylesheetSources.get(options.cache)?.get(url) || url
  let css = options.cache?.get(url)
  if (css === undefined) {
    const fetched = await fetchStylesheet(url, options)
    const response = fetched.response
    source = fetched.url
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    css = await response.text()
    if (css.length > 5_000_000) throw new Error('Stylesheet exceeds 5MB')
    options.cache?.set(url, css)
    if (options.cache) { let sources = stylesheetSources.get(options.cache); if (!sources) { sources = new Map(); stylesheetSources.set(options.cache, sources) } sources.set(url, source) }
  }
  return expandStyleImports(css, source, options, [...ancestors, url], 1)
}

async function fetchStylesheet(url: string, options: StyleOptions): Promise<{ response: Response; url: string }> {
  let target = url
  for (let redirects = 0; redirects <= 20; redirects++) {
    options.signal?.throwIfAborted()
    if (options.fetchImpl === globalThis.fetch) await assertPublicNetworkUrl(target, { signal: options.signal })
    const response = await options.fetchImpl(target, { headers: { 'user-agent': options.userAgent, accept: 'text/css,*/*;q=0.2' }, redirect: 'manual', signal: options.signal })
    if (options.signal?.aborted) { void response.body?.cancel().catch(() => {}); options.signal.throwIfAborted() }
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return { response, url: target }
    await response.body?.cancel()
    if (redirects === 20) throw new Error('Stylesheet exceeds the 20-redirect limit')
    const next = new URL(location, target)
    if (!/^https?:$/.test(next.protocol) || next.username || next.password) throw new Error('Unsupported stylesheet redirect URL')
    next.hash = ''
    target = next.href
  }
  throw new Error('Stylesheet redirect failed')
}

export async function expandStyleImports(css: string, source: string, options: StyleOptions, ancestors: string[] = [], count = 0): Promise<{ css: string; count: number }> {
  const imports = [...css.matchAll(/@import\s+(?:url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)|"([^"]+)"|'([^']+)')\s*([^;]*);/gi)]
  for (const match of imports) {
    const raw = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''
    const condition = match[6]?.trim() ?? ''
    let target: string
    try { target = new URL(raw.replace(/&amp;/g, '&'), source).toString() } catch { continue }
    if (!/^https?:/i.test(target)) continue
    try {
      const imported = await copyStylesheet(target, options, ancestors)
      css = css.replace(match[0], wrapImport(imported.css.replace(/@charset\s+[^;]+;/gi, ''), condition))
      count += imported.count
    } catch (error) {
      if (options.signal?.aborted) throw options.signal.reason instanceof Error ? options.signal.reason : new DOMException('Clone cancelled', 'AbortError')
      // A failed import still works if the source returns later; dropping it permanently loses mobile CSS.
      css = css.replace(match[0], `@import url("${target.replace(/"/g, '%22')}")${condition ? ` ${condition}` : ''};`)
      options.notes.push(`Kept stylesheet import ${target}: ${error instanceof Error ? error.message : 'could not read it'}`)
      options.issues?.push(`Stylesheet import could not be saved: ${target}. Its styles and images need review.`)
    }
  }
  return { css: absoluteCssUrls(css, source), count }
}

function wrapImport(css: string, condition: string): string {
  let rest = condition.trim()
  let layer: string | undefined
  const layerMatch = /^layer(?:\(\s*([^)]*)\))?(?:\s+|$)/i.exec(rest)
  if (layerMatch) { layer = layerMatch[1]?.trim() ?? ''; rest = rest.slice(layerMatch[0].length).trim() }
  let supports = ''
  if (/^supports\(/i.test(rest)) {
    let depth = 1, index = rest.indexOf('(') + 1
    const start = index
    while (index < rest.length && depth) { if (rest[index] === '(') depth++; if (rest[index] === ')') depth--; index++ }
    if (!depth) { supports = rest.slice(start, index - 1); rest = rest.slice(index).trim() }
  }
  if (rest) css = `@media ${rest}{${css}}`
  if (supports) css = `@supports ${supports.startsWith('(') || /^(?:not |selector\(|font-)/i.test(supports) ? supports : `(${supports})`}{${css}}`
  if (layer !== undefined) css = `@layer${layer ? ` ${layer}` : ''}{${css}}`
  return css
}
