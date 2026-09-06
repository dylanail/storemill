import { copyStylesheet, expandStyleImports } from './clone-styles.ts'
import { decodeLink, discoverPageLinks, type CopyReport } from './site-copy.ts'
import { localizeHtmlImages, localizeMediaUrls, mapMediaDocument, resolveMediaUrl, rewriteHtmlImages, type ImageCopyOptions, type ImageLocalizationReport } from './clone-media.ts'
import { captureCloneSource, type CapturedSource, type CaptureReport } from './clone-capture.ts'
import { resolveSourceNavigation } from './source-navigation.ts'
import { mergeImageReports } from './clone-report.ts'

export type { ImageLocalizationReport, ImageCopyEntry } from './clone-media.ts'

/**
 * Reference-page cloning.
 *
 * The merchant pastes a URL and gets that page back as a document they own:
 * stylesheets inlined, every relative URL made absolute, images copied into
 * their own uploads so the clone survives the source going away. Scripts are
 * dropped unless asked for — a competitor's pixel firing on your store is not
 * a feature — and nothing is "improved": what comes back is the page.
 *
 * It is then either edited as HTML, or read into blocks as a starting point.
 */
export type CloneOptions = ImageCopyOptions & {
  keepScripts?: boolean
  /** Reuse fetched stylesheet bytes across pages without changing their cascade order. */
  stylesheetCache?: Map<string, string>
  /** Optional rendered source; the capture's final URL remains the base for all relative assets. */
  sourceCapture?: Pick<CapturedSource, 'html' | 'url'> & Partial<CapturedSource>
  /** Static fixture/import mode is explicit; public URL copies render before scripts are stripped. */
  captureMode?: 'rendered' | 'static'
  discoverSite?: boolean
  onProgress?: (message: string) => void
}

export type CloneResult = {
  html: string
  title: string
  description: string
  sourceUrl: string
  stylesheets: number
  imagesLocalized: number
  imageReport?: ImageLocalizationReport
  captureReport?: CaptureReport
  notes: string[]
  links?: string[]
  hasProductData?: boolean
  report?: CopyReport
  commerceHtml?: string
  nextStep?: string
}

const UA = 'Mozilla/5.0 (compatible; storemillClone/1.0)'

export async function clonePage(url: string, options: CloneOptions): Promise<CloneResult> {
  stopIfAborted(options.signal)
  const capture = options.sourceCapture ?? (options.captureMode !== 'static' && !options.fetchImpl ? await captureCloneSource(url, { signal: options.signal, onProgress: options.onProgress }) : undefined)
  options = { ...options, sourceCapture: capture, localizedImages: options.localizedImages ?? new Map<string, string>() }
  const fetchImpl = options.fetchImpl ?? fetch
  const notes: string[] = [...(options.sourceCapture?.notes ?? [])]
  const copyIssues: string[] = []
  let html: string
  let finalUrl: URL
  if (options.sourceCapture) {
    finalUrl = new URL(options.sourceCapture.url)
    html = options.sourceCapture.html
  } else {
    const source = new URL(url)
    const response = await fetchImpl(source, { headers: { 'user-agent': UA, accept: 'text/html,*/*' }, redirect: 'follow', signal: options.signal })
    if (!response.ok) throw new Error(`The page answered ${response.status}`)
    finalUrl = new URL(response.url || url)
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType && !/^(?:text\/(?:html|plain)|application\/xhtml\+xml)(?:;|$)/i.test(contentType)) throw new Error(`Expected an HTML page, received ${contentType.split(';')[0]}`)
    html = await response.text()
  }
  if (html.length > 12_000_000) throw new Error('That page is over 12MB of HTML; capture its pages separately')

  const hasProductData = /["']@type["']\s*:\s*(?:\[[^\]]*)?["']Product["']|(?:property|name)=["']product:price:amount["']/i.test(html)
  const title = decodeText(/<title[^>]*>([^<]*)<\/title>/i.exec(html)?.[1]?.trim() ?? finalUrl.hostname)
  const description = decodeText(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)/i.exec(html)?.[1]?.trim() ?? '')

  // <base> would re-root every relative URL on the clone; we resolve them ourselves.
  const base = /<base[^>]+href=["']([^"']+)/i.exec(html)?.[1]
  const root = base ? new URL(base, finalUrl) : finalUrl
  const commerceHtml = html
  const navigation = options.discoverSite ? await resolveSourceNavigation(html, finalUrl.href, options) : undefined
  if (navigation) { html = navigation.html; notes.push(...navigation.issues); copyIssues.push(...navigation.issues) }
  const links = [...new Set([...discoverPageLinks(html, root.toString()), ...(capture?.links ?? []), ...(navigation?.links ?? [])])]
  html = html.replace(/<base[^>]*>/gi, '')
  // Source policies and refresh redirects cannot control the owned document.
  html = mapMediaDocument(html, tag => /^<meta\b/i.test(tag) && /\shttp-equiv\s*=\s*(?:"(?:content-security-policy|refresh)"|'(?:content-security-policy|refresh)'|(?:content-security-policy|refresh)(?=\s|>))/i.test(tag) ? '' : tag)

  const absolute = (value: string) => {
    const trimmed = decodeLink(value)
    if (!trimmed || /^(data:|blob:|javascript:|#|mailto:|tel:)/i.test(trimmed)) return trimmed
    try {
      return new URL(trimmed, root).toString()
    } catch {
      return trimmed
    }
  }

  // Inline stylesheets without losing their breakpoint conditions or nested imports.
  let stylesheets = 0
  const styleOptions = { fetchImpl, signal: options.signal, cache: options.stylesheetCache, notes, issues: copyIssues, userAgent: UA }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (!/rel=["'][^"']*stylesheet/i.test(tag) || /rel=["'][^"']*alternate/i.test(tag) || /\sdisabled(?:\s|=|>)/i.test(tag)) continue
    const href = /href=["']([^"']+)/i.exec(tag)?.[1]
    if (!href) continue
    const cssUrl = absolute(href)
    try {
      const copied = await copyStylesheet(cssUrl, styleOptions)
      const media = /\smedia\s*=\s*(["'])(.*?)\1/i.exec(tag)?.[2]
      html = html.replace(tag, `<style data-cloned-from="${cssUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"${media ? ` media="${media.replace(/"/g, '&quot;')}"` : ''}>${copied.css.replace(/<\/style/gi, '<\\/style')}</style>`)
      stylesheets += copied.count
    } catch (error) {
      stopIfAborted(options.signal)
      notes.push(`Kept a link to ${cssUrl} — it could not be fetched (${error instanceof Error ? error.message : 'error'})`)
      copyIssues.push(`Stylesheet could not be saved: ${cssUrl}. Its styles and images need review.`)
      html = html.replace(tag, tag.replace(/href=["'][^"']+["']/i, `href="${cssUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`))
    }
  }
  // Inline <style> imports use the document base, while external CSS has already been rebased.
  for (const match of [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)]) {
    if (/data-cloned-from=/i.test(match[1] ?? '')) continue
    const copied = await expandStyleImports(match[2] ?? '', root.toString(), styleOptions)
    html = html.replace(match[0], `<style${match[1] ?? ''}>${copied.css.replace(/<\/style/gi, '<\\/style')}</style>`)
    stylesheets += copied.count
  }

  // Resolve image URLs only in their actual HTML/CSS contexts. In particular,
  // data URLs and commas in srcset URLs must not be split or rewritten as JSON.
  html = rewriteHtmlImages(html, (value) => resolveMediaUrl(value, root.toString()))
  html = mapMediaDocument(html, (tag) => tag.replace(/(\s(?:href|src|action|formaction|data-href|data-url|data-next-url|data-next-step|data-checkout-url))\s*=\s*(["'])([\s\S]*?)\2/gi,
    (_match, attribute: string, quote: string, value: string) => {
      // Media were resolved above. Local upload references must stay local.
      const target = /^\/(?:_uploads|_media)\//.test(decodeLink(value)) ? decodeLink(value) : absolute(value)
      return `${attribute}=${quote}${target.replace(/&/g, '&amp;').replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`
    }))

  if (!options.keepScripts) {
    // Preserve simple declared navigation without executing foreign JavaScript.
    html = html.replace(/<(?:a|button|input|div)\b[^>]*>/gi, (tag) => {
      if (/\s(?:href|data-copy-href)=/i.test(tag)) return tag
      const handler = /\sonclick\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag)?.[2] ?? ''
      const navigation = /^\s*(?:(?:window\.)?location(?:\.href)?\s*=\s*["']([^"']+)["']|(?:window\.)?location\.(?:assign|replace)\(\s*["']([^"']+)["']\s*\))\s*;?\s*(?:return false;?)?\s*$/i.exec(decodeLink(handler))
      const target = navigation ? absolute(navigation[1] ?? navigation[2] ?? '') : ''
      return target && /^https?:|^#/i.test(target) ? tag.replace(/\s*\/?>(?=$)/, (end) => ` data-copy-href="${target.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"${end}`) : tag
    })
    const count = (html.match(/<script\b/gi) ?? []).length
    html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/\s(?:href|action|formaction)\s*=\s*(["'])\s*javascript:[\s\S]*?\1/gi, '')
    if (count) notes.push(`Dropped ${count} script${count === 1 ? '' : 's'} (tracking, chat widgets, the source's own app). Menus, forms and commerce controls need the copied site's interaction bridge.`)
    html = restoreLazyMedia(html)
    html = html.replace(/<html\b[^>]*>/i, (tag) => tag.replace(/(\sclass\s*=\s*)(["'])(.*?)\2/i, (_attribute, prefix: string, quote: string, classes: string) => `${prefix}${quote}${classes.replace(/\bno-js\b/g, 'js')}${quote}`))
  }

  if (!/<meta\b[^>]*name=["']viewport["']/i.test(html)) {
    const viewport = '<meta name="viewport" content="width=device-width, initial-scale=1">'
    html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (head) => head + viewport) : viewport + html
  }

  // The report includes disabled/limited/failed images too, so a partial copy
  // is never silently presented as complete.
  options.onProgress?.('Copying images and styles from ' + finalUrl.href)
  const localized = await localizeClonedHtml(html, root.toString(), options)
  html = localized.html
  const reports = [localized.report]
  let imagesLocalized = localized.copied
  for (const document of capture?.embeddedDocuments ?? []) {
    const embedded = await clonePage(document.url, { ...options, keepScripts: false, sourceCapture: { ...document, ...(capture?.captureReport?.mode === 'rendered' ? { captureReport: { mode: 'rendered', complete: true, viewports: [], issues: [] } as CaptureReport } : {}) } })
    if (embedded.captureReport?.mode === 'rendered' && !embedded.captureReport.complete) copyIssues.push(...embedded.captureReport.issues.map(issue => `Embedded document ${document.url}: ${issue}`))
    imagesLocalized += embedded.imagesLocalized
    stylesheets += embedded.stylesheets
    reports.push(embedded.imageReport!)
    const srcdoc = embedded.html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    html = html.replace(/<iframe\b[^>]*>/gi, (tag) => {
      if (!tag.includes(`data-copy-embedded="${document.marker}"`)) return tag
      return tag.replace(/\s(?:src|srcdoc|sandbox)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '').replace(/>$/, ` sandbox="allow-same-origin" srcdoc="${srcdoc}">`)
    })
  }
  if (!options.keepScripts) {
    // Unavailable/hidden embedded apps must not retain a live foreign execution context.
    // Captured documents already have their own scriptless same-origin sandbox for resizing.
    html = html.replace(/<iframe\b[^>]*>/gi, (tag) => /\sdata-copy-embedded=/.test(tag) && /\ssrcdoc=/.test(tag) ? tag : tag.replace(/\ssandbox(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '').replace(/>$/, ' sandbox="">'))
  }
  const imageReport = mergeImageReports(reports)
  if (!imageReport.complete) notes.unshift(`Image copy incomplete: ${imageReport.failed} failed and ${imageReport.skipped} skipped. See the image report for every source URL and reason.`)
  const captureReport: CaptureReport = capture?.captureReport ? { ...capture.captureReport, issues: [...capture.captureReport.issues] } : { mode: 'static', complete: false, viewports: [], issues: ['Static HTML only: JavaScript-generated images and embedded widgets were not verified.'] }
  if (copyIssues.length) { captureReport.complete = false; captureReport.issues = [...new Set([...captureReport.issues, ...copyIssues])]; notes.push(...copyIssues) }
  return { html, title, description, sourceUrl: finalUrl.toString(), stylesheets, imagesLocalized, imageReport, captureReport, notes, links, hasProductData, ...(options.discoverSite ? {commerceHtml,nextStep:navigation?.next} : {}) }

}

function decodeText(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', trade: '™', reg: '®', copy: '©' }
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match
    const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  }).replace(/\s+/g, ' ').trim()
}

/** Lazy-load libraries disappear with source scripts; native image attributes must still contain the real media. */
function restoreLazyMedia(html: string, onlyMissing = true): string {
  return mapMediaDocument(html, (original) => {
    let tag = original
    const read = (name: string) => {
      const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)
      return match?.[1] ?? match?.[2] ?? match?.[3] ?? ''
    }
    const write = (name: string, value: string) => {
      const attribute = `${name}="${value.replace(/"/g, '&quot;')}"`
      const pattern = new RegExp(`\\s${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s>]+)`, 'i')
      tag = pattern.test(tag) ? tag.replace(pattern, ` ${attribute}`) : tag.replace(/\s*\/?>$/, (end) => ` ${attribute}${end}`)
    }
    const isImage = /^<(?:img|source)\b/i.test(tag)
    const lazySrc = read('data-src') || read('data-original') || read('data-lazy-src')
    const lazySet = read('data-srcset') || read('data-lazy-srcset')
    if (isImage && lazySrc && (!onlyMissing || !read('src') || /^(?:data:|#|about:blank)/i.test(read('src')))) {
      const widths = (read('data-widths').match(/\d+/g) ?? []).map(Number).filter((width) => width > 0 && width <= 4000)
      const templated = /\{width\}|%7Bwidth%7D/i.test(lazySrc)
      if (templated && widths.length && !read('srcset') && !lazySet) write('srcset', widths.map((width) => `${lazySrc.replace(/\{width\}|%7Bwidth%7D/gi, String(width))} ${width}w`).join(', '))
      write('src', lazySrc.replace(/\{width\}|%7Bwidth%7D/gi, String(Math.max(...widths, 1200))))
    }
    if (isImage && lazySet && (!onlyMissing || !read('srcset'))) write('srcset', lazySet)
    if (isImage && (lazySrc || lazySet)) {
      if (!read('sizes') && /\d+w(?:\s*,|\s*$)/.test(read('srcset'))) write('sizes', read('data-sizes') && read('data-sizes') !== 'auto' ? read('data-sizes') : '100vw')
      const classes = read('class')
      if (classes) write('class', classes.replace(/\blazyload(?:ing)?\b/g, 'lazyloaded'))
    }
    const background = read('data-bg') || read('data-background-image') || read('data-background')
    if (background && /^(?:https?:|\/|(?:url|(?:-webkit-)?image-set)\s*\()/i.test(decodeLink(background))) {
      const style = read('style')
      const value = /^(?:url|(?:-webkit-)?image-set)\s*\(/i.test(decodeLink(background)) ? background : `url('${background.replace(/'/g, '%27')}')`
      if (!/background(?:-image)?\s*:/i.test(style)) write('style', `${style}${style && !style.endsWith(';') ? ';' : ''}background-image:${value}`)
    }
    return tag
  })
}

/**
 * Plan a repair of an existing saved copy without fetching its source or writing
 * anything. Callers can preview this HTML and save it through normal page history.
 * A real current src/srcset is retained so image replacements made in the editor win.
 */
export function planClonedMediaRepair(original: string): { html: string; changed: boolean; repairs: string[] } {
  let repairedUrls = 0
  const repairUrls = (value: string) => value.replace(/(\/_uploads\/[a-z0-9_]+\/up_[a-z0-9]+\.(?:avif|gif|ico|jpe?g|png|svg|webp))&(?:amp;)?(?:width|height|crop|v|format|quality|fit|dpr)=[^\s"'<>),]*/gi, (_match, upload: string) => { repairedUrls++; return upload })
  let html = rewriteHtmlImages(original, repairUrls)
  const hydrated = restoreLazyMedia(html, true)
  const restoredMedia = hydrated !== html
  html = hydrated
  const withJavascript = html.replace(/<html\b[^>]*>/i, (tag) => tag.replace(/(\sclass\s*=\s*)(["'])(.*?)\2/i, (_attribute, prefix: string, quote: string, classes: string) => `${prefix}${quote}${classes.replace(/\bno-js\b/g, 'js')}${quote}`))
  const revealed = withJavascript !== html
  html = withJavascript
  return {
    html, changed: html !== original,
    repairs: [
      ...(repairedUrls ? [`Repaired ${repairedUrls} malformed responsive image URLs.`] : []),
      ...(restoredMedia ? ['Restored missing native lazy-image attributes and backgrounds.'] : []),
      ...(revealed ? ['Enabled content hidden by the source no-js class.'] : []),
    ],
  }
}

/**
 * Finish owning the image references in already-cloned HTML without fetching
 * the page again or overwriting edits made since it was cloned.
 */
export async function localizeClonedHtml(html: string, sourceUrl: string, options: CloneOptions): Promise<{ html: string; copied: number; report: ImageLocalizationReport }> {
  return localizeHtmlImages(html, sourceUrl, options)
}

/** Own a product's complete source-image list, with the same audit trail as document images. */
export async function localizeImageUrls(urls: string[], options: CloneOptions, sourceUrl?: string): Promise<{ urls: string[]; copied: number; report: ImageLocalizationReport }> {
  const root = sourceUrl ?? urls.find((url) => /^https?:/i.test(url)) ?? 'https://invalid.local/'
  return localizeMediaUrls(urls, root, options)
}

function stopIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Clone cancelled', 'AbortError')
}

/**
 * A rough read of a cloned page into blocks — headings, paragraphs and images
 * in document order — so it can be used as a template for the merchant's own
 * product rather than edited as a wall of markup. It is a starting point and
 * says so; nothing about a stranger's layout survives except the words and
 * the pictures.
 */
export function extractBlocks(html: string): Array<{ type: string; settings: Record<string, unknown> }> {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html
  const cleaned = body.replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, '')
  const blocks: Array<{ type: string; settings: Record<string, unknown> }> = []
  const pattern = /<(h1|h2|h3|p|img|blockquote|li)\b([^>]*)>([\s\S]*?)<\/\1>|<img\b([^>]*)\/?>/gi
  let match: RegExpExecArray | null
  let paragraphs: string[] = []
  const flush = () => {
    if (paragraphs.length) blocks.push({ type: 'rich-text', settings: { text: paragraphs.join('\n\n') } })
    paragraphs = []
  }
  while ((match = pattern.exec(cleaned)) && blocks.length < 80) {
    const tag = (match[1] ?? 'img').toLowerCase()
    const attrs = match[2] ?? match[4] ?? ''
    const text = strip(match[3] ?? '')
    if (tag === 'img') {
      const src = /src=["']([^"']+)/i.exec(attrs)?.[1]
      if (src && !/\.(svg|gif)(\?|$)/i.test(src) && !/logo|icon|sprite/i.test(src)) {
        flush()
        blocks.push({ type: 'image', settings: { src, alt: /alt=["']([^"']*)/i.exec(attrs)?.[1] ?? '' } })
      }
      continue
    }
    if (!text || text.length < 3) continue
    if (tag === 'h1') { flush(); blocks.push({ type: 'headline', settings: { text, level: 'h1' } }) }
    else if (tag === 'h2' || tag === 'h3') { flush(); blocks.push({ type: 'headline', settings: { text, level: tag } }) }
    else if (tag === 'blockquote') { flush(); blocks.push({ type: 'pull-quote', settings: { quote: text } }) }
    else if (text.length > 20) paragraphs.push(text)
  }
  flush()
  return blocks
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}
