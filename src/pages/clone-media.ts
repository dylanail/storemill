import { createHash } from 'node:crypto'
import { MAX_UPLOAD_BYTES, saveUpload, sniffImageType } from '../lib/uploads.ts'
import { assertPublicNetworkUrl, PublicNetworkError } from './public-network.ts'

export type ImageCopyStatus = 'localized' | 'reused' | 'embedded' | 'failed' | 'skipped'
export type ImageCopyEntry = {
  url: string
  resolvedUrl?: string
  status: ImageCopyStatus
  reason?: string
  localUrl?: string
  mime?: string
  bytes?: number
  contexts: string[]
  occurrences: number
}
export type ImageLocalizationReport = {
  discovered: number
  localized: number
  reused: number
  embedded: number
  failed: number
  skipped: number
  complete: boolean
  entries: ImageCopyEntry[]
}
export type ImageCopyOptions = {
  storeId: string
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  localizeImages?: boolean
  /** Explicit limits are reported as skipped images; there is no default count limit. */
  maxImages?: number
  imageBudget?: { remaining: number }
  localizedImages?: Map<string, string>
  /** Share with all pages/products in one import to avoid storing identical bytes twice. */
  localizedImageBytes?: Map<string, string>
  imageConcurrency?: number
  imageTimeoutMs?: number
  imageRetries?: number
}

type Span = { start: number; end: number; value: string; quote?: string; stylesheet?: boolean }
type Attribute = Span & { name: string }
type Reference = { url: string; context: string }
type Rewrite = (url: string, context: string) => string
const UA = 'Mozilla/5.0 (compatible; storemillClone/1.0)'
const fontExtension = /\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i
const byteCaches = new WeakMap<Map<string, string>, Map<string, string>>()

/** Decode entities only at an HTML boundary; JSON, CSS strings and URL commas remain intact. */
export function decodeMediaAttribute(value: string): string {
  return value.replace(/&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/gi, (entity) => {
    const named: Record<string, string> = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': '\u00a0' }
    if (named[entity.toLowerCase()] !== undefined) return named[entity.toLowerCase()]!
    const code = entity[2]?.toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10)
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
  })
}

function attributes(tag: string): Attribute[] {
  const result: Attribute[] = []
  const pattern = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g
  for (const match of tag.matchAll(pattern)) {
    const raw = match[2] ?? match[3] ?? match[4] ?? ''
    const quote = match[2] !== undefined ? '"' : match[3] !== undefined ? "'" : ''
    const start = match.index! + match[0].length - raw.length - (quote ? 1 : 0)
    result.push({ name: (match[1] ?? '').toLowerCase(), start, end: start + raw.length, value: raw, quote })
  }
  return result
}

function replaceSpans(value: string, spans: Span[], replace: (span: Span) => string): string {
  let result = value
  // Visit references in source order for the report, then apply offsets back-to-front.
  for (const { span, next } of spans.map((span) => ({ span, next: replace(span) })).reverse()) {
    if (next !== span.value) result = result.slice(0, span.start) + next + result.slice(span.end)
  }
  return result
}

/** HTML start tags only; quoted > characters, comments and script bodies are not tags. */
export function mapMediaDocument(html: string, onTag: (tag: string) => string, onStyle: (css: string) => string = (css) => css): string {
  return html.replace(/<!--[\s\S]*?-->|<(script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/\1\s*>|<[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, (whole, rawText: string | undefined) => {
    if (whole.startsWith('<!--')) return whole
    if (rawText) {
      const open = /^<(?:script|style)\b(?:[^>"']|"[^"]*"|'[^']*')*>/i.exec(whole)![0]
      const close = /<\/(?:script|style)\s*>$/i.exec(whole)![0]
      return onTag(open) + (rawText.toLowerCase() === 'style' ? onStyle(whole.slice(open.length, -close.length)) : whole.slice(open.length, -close.length)) + close
    }
    return onTag(whole)
  })
}

/** WHATWG-style URL tokenization: commas inside a URL (notably data URLs/CDN transforms) belong to that URL. */
export function srcsetUrls(value: string): Span[] {
  const spans: Span[] = []
  let index = 0
  while (index < value.length) {
    while (/[\t\n\f\r ,]/.test(value[index] ?? '') && index < value.length) index++
    const start = index
    while (index < value.length && !/[\t\n\f\r ]/.test(value[index]!)) index++
    let end = index
    while (end > start && value[end - 1] === ',') end--
    if (end > start) spans.push({ start, end, value: value.slice(start, end) })
    if (end !== index) continue
    let parens = 0
    while (index < value.length) {
      const char = value[index++]
      if (char === '(') parens++
      else if (char === ')') parens = Math.max(0, parens - 1)
      else if (char === ',' && !parens) break
    }
  }
  return spans
}

function cssUnescape(value: string): string {
  return value.replace(/\\(?:([\da-f]{1,6})[\t\n\f\r ]?|([\s\S]))/gi, (_match, code: string | undefined, escaped: string | undefined) => code ? String.fromCodePoint(Math.min(parseInt(code, 16) || 0xfffd, 0x10ffff)) : escaped === '\n' || escaped === '\r' ? '' : escaped ?? '')
}

function quotedEnd(value: string, start: number): number {
  const quote = value[start]
  let index = start + 1
  for (; index < value.length; index++) {
    if (value[index] === '\\') index++
    else if (value[index] === quote) return index
  }
  return value.length
}

/** Only CSS URL tokens and image-set image strings; content strings and comments are deliberately opaque. */
function cssImageSpans(css: string): Span[] {
  const result: Span[] = []
  const functions: string[] = []
  let index = 0
  while (index < css.length) {
    if (css.startsWith('/*', index)) { const end = css.indexOf('*/', index + 2); index = end < 0 ? css.length : end + 2; continue }
    const char = css[index]
    if (char === '"' || char === "'") {
      const end = quotedEnd(css, index)
      if (/^(?:-webkit-)?image-set$/i.test(functions.at(-1) ?? '')) result.push({ start: index + 1, end, value: css.slice(index + 1, end), quote: char })
      index = Math.min(end + 1, css.length)
      continue
    }
    const fn = /^([-a-z][\w-]*)\s*\(/i.exec(css.slice(index))
    if (fn) {
      const name = fn[1]!.toLowerCase()
      index += fn[0].length
      if (name !== 'url') { functions.push(name); continue }
      while (/\s/.test(css[index] ?? '') && index < css.length) index++
      const quote = css[index] === '"' || css[index] === "'" ? css[index]! : ''
      const start = index + (quote ? 1 : 0)
      let end: number
      if (quote) { end = quotedEnd(css, index); index = Math.min(end + 1, css.length) }
      else {
        while (index < css.length && css[index] !== ')') { if (css[index] === '\\') index++; index++ }
        end = index
        while (end > start && /\s/.test(css[end - 1]!)) end--
      }
      if (end > start) result.push({ start, end, value: css.slice(start, end), quote, stylesheet: /@import\s*$/i.test(css.slice(Math.max(0, start - 40), start).replace(/url\(\s*["']?$/i, '')) })
      while (index < css.length && css[index] !== ')') index++
      if (css[index] === ')') index++
      continue
    }
    if (char === '(') functions.push('')
    else if (char === ')') functions.pop()
    index++
  }
  return result
}

export function rewriteCssImages(css: string, rewrite: Rewrite, includeOtherResources = false): string {
  return replaceSpans(css, cssImageSpans(css), (span) => {
    const decoded = cssUnescape(span.value)
    if (!includeOtherResources && (fontExtension.test(decoded) || span.stylesheet)) return span.value
    const next = rewrite(decoded, 'css')
    if (next === decoded) return span.value
    return span.quote ? next.replace(/\\/g, '\\\\').replace(new RegExp(span.quote, 'g'), `\\${span.quote}`) : next.replace(/[\s()'"\\]/g, (char) => `\\${char}`)
  })
}

export function resolveMediaUrl(raw: string, source: string): string {
  const value = raw.trim()
  if (!value || /^(?:data:|blob:|#)/i.test(value) || /^\/(?:_uploads|_media)\//.test(value)) return value
  try { return new URL(value, source).toString() } catch { return value }
}

function rewriteAttribute(tag: string, attr: Attribute, rewrite: Rewrite, all: Attribute[]): string {
  const kind = /^<([\w:-]+)/.exec(tag)?.[1]?.toLowerCase() ?? ''
  const name = attr.name
  const decoded = decodeMediaAttribute(attr.value)
  const read = (key: string) => decodeMediaAttribute(all.find((item) => item.name === key)?.value ?? '').toLowerCase()
  const context = `${kind}[${name}]`
  let next = decoded
  if (name === 'style') next = rewriteCssImages(decoded, (url) => rewrite(url, context))
  else if (/^(?:srcset|data-srcset|data-lazy-srcset|imagesrcset)$/.test(name) && /^(?:img|source|link)$/.test(kind)) next = replaceSpans(decoded, srcsetUrls(decoded), (span) => rewrite(span.value, context))
  else if (/^(?:data-bg|data-background|data-background-image)$/.test(name)) next = /(?:url|image-set)\s*\(/i.test(decoded) ? rewriteCssImages(decoded, (url) => rewrite(url, context)) : rewrite(decoded, context)
  else if ((/^(?:img|image|feimage|use)$/.test(kind) && /^(?:src|href|xlink:href|data-src|data-original|data-lazy-src|data-copy-(?:desktop|tablet|mobile)-src)$/.test(name))
    || (kind === 'source' && /^(?:data-src|data-original|data-lazy-src)$/.test(name))
    || (kind === 'input' && read('type') === 'image' && name === 'src')
    || (kind === 'video' && name === 'poster')
    || (kind === 'meta' && /^(?:og:image(?::(?:url|secure_url))?|twitter:image(?::src)?)$/.test(read('property') || read('name')) && name === 'content')
    || (kind === 'link' && name === 'href' && (/(?:^|\s)(?:icon|apple-touch-icon|apple-touch-startup-image)(?:\s|$)/.test(read('rel')) || /(?:^|\s)preload(?:\s|$)/.test(read('rel')) && read('as') === 'image')))
    next = rewrite(decoded, context)
  if (next === decoded) return attr.value
  const escaped = next.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return attr.quote ? escaped.replace(new RegExp(attr.quote, 'g'), attr.quote === '"' ? '&quot;' : '&#39;') : escaped.replace(/[\s"'`=]/g, (char) => `&#${char.charCodeAt(0)};`)
}

export function rewriteHtmlImages(html: string, rewrite: Rewrite): string {
  return mapMediaDocument(html, (tag) => {
    const attrs = attributes(tag)
    return replaceSpans(tag, attrs, (span) => rewriteAttribute(tag, span as Attribute, rewrite, attrs))
  }, (css) => rewriteCssImages(css, rewrite))
}

function summarize(entries: ImageCopyEntry[]): ImageLocalizationReport {
  const count = (status: ImageCopyStatus) => entries.filter((entry) => entry.status === status).length
  return { discovered: entries.length, localized: count('localized'), reused: count('reused'), embedded: count('embedded'), failed: count('failed'), skipped: count('skipped'), complete: !count('failed') && !count('skipped'), entries }
}

export async function localizeHtmlImages(html: string, sourceUrl: string, options: ImageCopyOptions): Promise<{ html: string; copied: number; report: ImageLocalizationReport }> {
  const refs: Reference[] = []
  rewriteHtmlImages(html, (url, context) => { if (url.trim()) refs.push({ url, context }); return url })
  const localized = await localizeReferences(refs, sourceUrl, options)
  return { html: rewriteHtmlImages(html, (url) => localized.replacements.get(url) ?? resolveMediaUrl(url, sourceUrl)), copied: localized.copied, report: localized.report }
}

export async function localizeMediaUrls(urls: string[], sourceUrl: string, options: ImageCopyOptions): Promise<{ urls: string[]; copied: number; report: ImageLocalizationReport }> {
  const localized = await localizeReferences(urls.filter((url) => url.trim()).map((url) => ({ url, context: 'product-image' })), sourceUrl, options)
  return { urls: urls.map((url) => localized.replacements.get(url) ?? resolveMediaUrl(url, sourceUrl)), copied: localized.copied, report: localized.report }
}

async function localizeReferences(refs: Reference[], sourceUrl: string, options: ImageCopyOptions): Promise<{ replacements: Map<string, string>; copied: number; report: ImageLocalizationReport }> {
  assertNotAborted(options.signal)
  const shared = options.localizedImages ?? new Map<string, string>()
  let bytesCache = options.localizedImageBytes ?? byteCaches.get(shared)
  if (!bytesCache) { bytesCache = new Map(); byteCaches.set(shared, bytesCache) }
  const entries: ImageCopyEntry[] = []
  const aliases = new Map<ImageCopyEntry, Set<string>>()
  const grouped = new Map<string, ImageCopyEntry>()
  const replacements = new Map<string, string>()
  const tasks: Array<{ entry: ImageCopyEntry; target: URL }> = []
  for (const ref of refs) {
    const url = ref.url.trim()
    const resolvedUrl = resolveMediaUrl(url, sourceUrl)
    let entry = grouped.get(resolvedUrl)
    if (entry) {
      entry.occurrences++
      if (!entry.contexts.includes(ref.context)) entry.contexts.push(ref.context)
      aliases.get(entry)!.add(ref.url)
      continue
    }
    entry = { url, resolvedUrl, status: 'skipped', contexts: [ref.context], occurrences: 1 }
    grouped.set(resolvedUrl, entry)
    aliases.set(entry, new Set([ref.url]))
    entries.push(entry)
    if (/^\/(?:_uploads|_media)\//.test(url)) { entry.status = 'reused'; entry.localUrl = url; entry.reason = 'Already owned media'; continue }
    if (/^data:image\//i.test(url) || url.startsWith('#')) { entry.status = 'embedded'; entry.reason = url.startsWith('#') ? 'Document-local SVG reference' : 'Image bytes embedded in document'; continue }
    if (/^blob:/i.test(url)) { entry.reason = 'Browser-scoped blob URL requires the source browser capture'; continue }
    let target: URL
    try { target = new URL(resolvedUrl) } catch { entry.reason = 'Invalid image URL'; continue }
    if (!/^https?:$/.test(target.protocol) || target.username || target.password) { entry.reason = 'Unsupported image URL scheme or embedded credentials'; continue }
    const hash = target.hash
    target.hash = ''
    const existing = shared.get(target.href) ?? shared.get(resolvedUrl)
    if (existing) { entry.status = 'reused'; entry.localUrl = existing + (existing.includes('#') ? '' : hash); entry.reason = 'Previously localized source URL'; continue }
    if (options.localizeImages === false) { entry.reason = 'Image localization explicitly disabled'; continue }
    tasks.push({ entry, target })
  }
  const limit = options.maxImages === undefined || options.maxImages === Infinity ? Infinity : Math.max(0, Number.isFinite(options.maxImages) ? Math.trunc(options.maxImages) : 0)
  const pending = new Map<string, Promise<{ url: string; mime: string; bytes: number; reused: boolean }>>()
  let scheduled = 0, cursor = 0, copied = 0
  const workers = boundedInteger(options.imageConcurrency, 6, 1, 16)
  await Promise.all(Array.from({ length: Math.min(workers, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      assertNotAborted(options.signal)
      const { entry, target } = tasks[cursor++]!
      let work = pending.get(target.href)
      const reusedRequest = !!work
      const existing = shared.get(target.href)
      if (existing) { entry.status = 'reused'; entry.localUrl = existing + new URL(entry.resolvedUrl!).hash; entry.reason = 'Previously localized source URL'; continue }
      if (!work) {
        if (scheduled >= limit || options.imageBudget && options.imageBudget.remaining <= 0) { entry.reason = scheduled >= limit ? `Explicit image limit of ${limit} reached` : 'Explicit site image budget exhausted'; continue }
        scheduled++
        if (options.imageBudget) options.imageBudget.remaining--
        work = (async () => {
          const file = await downloadImage(target.href, sourceUrl, options)
          assertNotAborted(options.signal)
          const digest = createHash('sha256').update(file.data).digest('hex')
          const previous = bytesCache!.get(digest)
          const owned = previous ?? saveUpload({ name: target.pathname.split('/').pop() || 'image', type: file.mime, data: file.data }, options.storeId).url
          bytesCache!.set(digest, owned)
          shared.set(target.href, owned)
          copied++
          return { url: owned, mime: file.mime, bytes: file.data.length, reused: !!previous }
        })()
        pending.set(target.href, work)
      }
      try {
        const result = await work
        entry.status = result.reused || reusedRequest ? 'reused' : 'localized'
        entry.localUrl = result.url + new URL(entry.resolvedUrl!).hash
        entry.mime = result.mime
        entry.bytes = result.bytes
        if (result.reused) entry.reason = 'Identical image bytes already owned'
        else if (reusedRequest) entry.reason = 'Shared image download with a different fragment'
      } catch (error) {
        assertNotAborted(options.signal)
        entry.status = 'failed'
        entry.reason = error instanceof Error ? error.message : String(error)
      }
    }
  }))
  for (const entry of entries) if (entry.localUrl) for (const alias of aliases.get(entry)!) replacements.set(alias, entry.localUrl)
  return { replacements, copied, report: summarize(entries) }
}

class ImageDownloadError extends Error {
  retryable: boolean
  constructor(message: string, retryable = false) { super(message); this.retryable = retryable }
}

/** Match the browser's strict-origin-when-cross-origin policy, including redirect hops. */
function imageReferer(sourceUrl: string, targetUrl: string): string | undefined {
  try {
    const source = new URL(sourceUrl), target = new URL(targetUrl)
    if (!/^https?:$/.test(source.protocol) || source.protocol === 'https:' && target.protocol === 'http:') return undefined
    source.username = ''; source.password = ''; source.hash = ''
    return source.origin === target.origin ? source.href : `${source.origin}/`
  } catch { return undefined }
}

async function fetchImage(url: string, sourceUrl: string, options: ImageCopyOptions, signal: AbortSignal): Promise<Response> {
  let target = url
  for (let redirects = 0; redirects <= 20; redirects++) {
    if (signal.aborted) throw signal.reason
    if (!options.fetchImpl || options.fetchImpl === globalThis.fetch) await assertPublicNetworkUrl(target, { signal })
    const referer = imageReferer(sourceUrl, target)
    const response = await (options.fetchImpl ?? fetch)(target, {
      headers: { 'user-agent': UA, accept: 'image/avif,image/webp,image/*,*/*;q=0.2', ...(referer ? { referer } : {}) },
      // A manually supplied Referer header is otherwise forwarded on a redirect.
      // Recalculate it per hop so a CDN never receives a source page's full path.
      redirect: 'manual', signal,
    })
    if (signal.aborted) { void response.body?.cancel().catch(() => {}); throw signal.reason }
    const location = response.headers.get('location')
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return response
    await response.body?.cancel()
    if (redirects === 20) throw new ImageDownloadError('Image exceeds the 20-redirect limit')
    const next = new URL(location, target)
    if (!/^https?:$/.test(next.protocol) || next.username || next.password) throw new ImageDownloadError('Unsupported image redirect URL')
    next.hash = ''
    target = next.href
  }
  throw new ImageDownloadError('Image redirect failed')
}

async function downloadImage(url: string, sourceUrl: string, options: ImageCopyOptions): Promise<{ data: Buffer; mime: string }> {
  const attempts = 1 + boundedInteger(options.imageRetries, 1, 0, 3)
  for (let attempt = 0; attempt < attempts; attempt++) {
    assertNotAborted(options.signal)
    const controller = new AbortController()
    const abort = () => controller.abort(options.signal?.reason)
    options.signal?.addEventListener('abort', abort, { once: true })
    const timeoutMs = boundedInteger(options.imageTimeoutMs, 20_000, 1, 300_000)
    const timer = setTimeout(() => controller.abort(new ImageDownloadError(`Image download timed out after ${timeoutMs}ms`, true)), timeoutMs)
    let stopRace: (() => void) | undefined
    const interrupted = new Promise<never>((_resolve, reject) => {
      stopRace = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', stopRace, { once: true })
    })
    try {
      return await Promise.race([interrupted, (async () => {
        const response = await fetchImage(url, sourceUrl, options, controller.signal)
        if (controller.signal.aborted) { void response.body?.cancel().catch(() => {}); throw controller.signal.reason }
        if (!response.ok) { await response.body?.cancel(); throw new ImageDownloadError(`HTTP ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500) }
        const length = Number(response.headers.get('content-length') ?? 0)
        if (length > MAX_UPLOAD_BYTES) { await response.body?.cancel(); throw new ImageDownloadError(`Image exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit`) }
        const reader = response.body?.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        if (reader) {
          const cancel = () => { void reader.cancel(controller.signal.reason).catch(() => {}) }
          controller.signal.addEventListener('abort', cancel, { once: true })
          try {
            while (true) {
              const chunk = await reader.read()
              if (chunk.done) break
              bytes += chunk.value.length
              if (bytes > MAX_UPLOAD_BYTES) { await reader.cancel(); throw new ImageDownloadError(`Image exceeds the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit`) }
              chunks.push(chunk.value)
            }
          } finally { controller.signal.removeEventListener('abort', cancel); reader.releaseLock() }
        }
        if (controller.signal.aborted) throw controller.signal.reason
        const data = Buffer.concat(chunks)
        if (!data.length) throw new ImageDownloadError('Empty image response')
        const sniffed = sniffImageType(data)
        const declared = (response.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase().replace(/^image\/(?:jpg|pjpeg)$/, 'image/jpeg').replace(/^image\/x-icon$/, 'image/vnd.microsoft.icon').replace(/^image\/x-png$/, 'image/png')
        if (!sniffed) throw new ImageDownloadError(`Response is not a supported image (${declared || 'missing Content-Type'}; bytes do not match JPEG, PNG, GIF, WebP, AVIF, SVG or ICO)`)
        const compatible = ['application/octet-stream', 'binary/octet-stream', sniffed, ...(sniffed === 'image/svg+xml' ? ['text/xml', 'application/xml'] : [])]
        if (declared && !compatible.includes(declared)) throw new ImageDownloadError(`Image MIME mismatch: declared ${declared}, received ${sniffed}`)
        return { data, mime: sniffed }
      })()])
    } catch (error) {
      assertNotAborted(options.signal)
      const retryable = error instanceof PublicNetworkError ? false : error instanceof ImageDownloadError ? error.retryable : true
      if (!retryable || attempt + 1 >= attempts) throw error
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      if (stopRace) controller.signal.removeEventListener('abort', stopRace)
    }
  }
  throw new ImageDownloadError('Image download failed')
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException('Clone cancelled', 'AbortError')
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value !== undefined && Number.isFinite(value) ? Math.trunc(value) : fallback))
}
