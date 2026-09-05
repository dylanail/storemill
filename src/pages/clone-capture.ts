import { sourceThemeScript } from './source-theme.ts'
import { existsSync, readFileSync } from 'node:fs'
import { chromium, devices, type Page, type Frame } from 'playwright'
import { isPaymentUrl } from './site-copy.ts'
import { mapMediaDocument } from './clone-media.ts'
import { isPublicHost } from './public-network.ts'

export type CaptureReport = {
  mode: 'rendered' | 'static'
  complete: boolean
  viewports: Array<{ width: number; images: number; broken: string[]; reachedBottom: boolean }>
  issues: string[]
  excludedWidgets?: string[]
}
export type CapturedSource = { html: string; url: string; notes: string[]; captureReport: CaptureReport; embeddedDocuments?: Array<{ marker: string; html: string; url: string }> }
type CaptureOptions = { signal?: AbortSignal; executablePath?: string; allowPrivateNetwork?: boolean; timeoutMs?: number }
const snapshotScript = readFileSync(new URL('./clone-capture.js', import.meta.url), 'utf8')
type CapturedImage = { index: number; key: string; alt: string; src: string; srcset: string; picture: boolean; width: string | null; height: string | null }
type SnapshotState = { images: number; broken: string[]; imageUrls: string[]; declaredImageUrls: string[]; imageElements: CapturedImage[]; issues: string[]; shadowRoots: number; shadowWidgets: Array<{ host: string; provider: boolean }> }

/** A fresh, read-only browser loads the public visual document before foreign scripts are removed. */
export async function captureCloneSource(url: string, options: CaptureOptions = {}): Promise<CapturedSource> {
  const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), AbortSignal.timeout(options.timeoutMs ?? 150_000)])
  signal.throwIfAborted()
  const executablePath = options.executablePath || process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const abort = () => { void browser.close().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) { await browser.close(); signal.throwIfAborted() }
  const report: CaptureReport = { mode: 'rendered', complete: true, viewports: [], issues: [] }
  const allowedHosts = new Map<string, Promise<boolean>>()
  const allowHost = (hostname: string) => {
    if (options.allowPrivateNetwork) return Promise.resolve(true)
    let checked = allowedHosts.get(hostname)
    if (!checked) {
      checked = isPublicHost(hostname)
      allowedHosts.set(hostname, checked)
    }
    return checked
  }
  try {
    const target = new URL(url)
    if (!/^https?:$/.test(target.protocol) || target.username || target.password || isPaymentUrl(url) || !await allowHost(target.hostname)) throw new Error('Use a public website URL for copying')
    const captures: Array<{ width: number; html: string; url: string; states: SnapshotState[]; embeddedDocuments: NonNullable<CapturedSource['embeddedDocuments']> }> = []
    // Fresh contexts exercise initial mobile/tablet rendering as well as CSS.
    // Resizing one desktop DOM can miss server/UA/initial-width-only content.
    for (const width of [1440, 820, 390]) {
      signal.throwIfAborted()
      const device = width === 390 ? devices['Pixel 7'] : width === 820 ? devices['iPad (gen 7)'] : undefined
      const context = await browser.newContext({ ...(device ?? {}), viewport: { width, height: 1000 }, serviceWorkers: 'block', acceptDownloads: false })
      const documentStatuses = new Map<Frame, number>()
      context.on('response', response => { if (response.request().isNavigationRequest()) documentStatuses.set(response.request().frame(), response.status()) })
      await context.routeWebSocket('**/*', socket => socket.close())
      await context.addInitScript(`(() => { document.addEventListener('submit', event => event.preventDefault(), true); for (const name of ['submit', 'requestSubmit']) Object.defineProperty(HTMLFormElement.prototype, name, { value: function () {}, configurable: false, writable: false }); })()`)
      await context.route('**/*', async (route) => {
      const request = route.request()
      let target: URL
      try { target = new URL(request.url()) } catch { return route.abort() }
      // No source cart mutations, checkout submissions, subscriptions, or analytics events.
      if (request.method() !== 'GET' || !/^https?:$/.test(target.protocol) || target.username || target.password || isPaymentUrl(target.toString()) || /\/(?:cart\/(?:add|change|update|clear)(?:\.(?:js|json))?|checkout\/(?:process|complete)|orders?\/(?:cancel|refund)|logout|unsubscribe)(?:\/|$)/i.test(target.pathname) || /\/cart\/\d+:\d+/.test(target.pathname) || [...target.searchParams.keys()].some((key) => /^(?:add-to-cart|remove_item|delete|logout|unsubscribe|wc-ajax)$/i.test(key)) || !await allowHost(target.hostname)) return route.abort()
      if (/(?:^|\.)(?:google-analytics\.com|googletagmanager\.com|doubleclick\.net|facebook\.com|connect\.facebook\.net|clarity\.ms|hotjar\.com)$/i.test(target.hostname)) return route.abort()
      return route.continue()
      })
      const page = await context.newPage()
      page.on('dialog', (dialog) => { void dialog.dismiss() })
      context.on('page', (popup) => { if (popup !== page) void popup.close() })
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 40_000 })
      if (!response?.ok()) throw new Error(`The rendered page answered ${response?.status() ?? 'no response'}`)
      const contentType = response.headers()['content-type'] ?? ''
      if (contentType && !/html/i.test(contentType)) throw new Error(`Expected HTML, received ${contentType.split(';')[0]}`)
      await page.waitForTimeout(1800)
      const reachedBottom = await scrollDocument(page)
      await page.evaluate(snapshotScript)
      await settleImages(page)
      const state = await page.evaluate(snapshotScript) as SnapshotState
      const states = [state]
      const viewportReport = { width, images: state.images, broken: state.broken, reachedBottom }
      report.viewports.push(viewportReport)
      if (!reachedBottom) report.issues.push(`${width}px source did not finish loading before the scroll limit.`)
      const embeddedDocuments: NonNullable<CapturedSource['embeddedDocuments']> = []
      for (const frame of page.frames().filter(frame => frame !== page.mainFrame())) {
      try {
        const element = await frame.frameElement()
        const visible = await element.evaluate((node: any) => { const rect = node.getBoundingClientRect(); if (rect.width <= 10 || rect.height <= 10) return false; for (let parent = node; parent; parent = parent.parentElement) { const style = parent.ownerDocument.defaultView.getComputedStyle(parent); if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false } return true })
        if (!visible) continue
        if (frame.parentFrame() !== page.mainFrame()) { report.issues.push(`Nested embedded document needs review: ${frame.url()}`); continue }
        const attributes = await element.evaluate((node: any) => ({ src: node.getAttribute('src') || '', srcdoc: node.hasAttribute('srcdoc') }))
        if ((documentStatuses.get(frame) ?? 200) >= 400 || (frame.url() === 'about:blank' && (attributes.srcdoc || attributes.src && attributes.src !== 'about:blank'))) {
          report.issues.push(`Embedded document did not load: ${attributes.src || 'inline iframe'}`)
          continue
        }
        // Payment/provider frames remain outside a visual copy. Never preserve their execution context.
        const base = await frame.evaluate('document.baseURI') as string
        const documentUrl = /^https?:/.test(frame.url()) ? frame.url() : /^about:(?:srcdoc|blank)$/.test(frame.url()) ? base : ''
        if (!documentUrl || isPaymentUrl(documentUrl) || !/^https?:/.test(base) || !await allowHost(new URL(base).hostname)) { report.issues.push(`Embedded document needs review: ${frame.url()}`); continue }
        await frame.evaluate(snapshotScript)
        if (!await scrollDocument(frame, 40)) report.issues.push(`Embedded document did not finish loading before the scroll limit: ${documentUrl}`)
        await settleImages(frame)
        states.push(await frame.evaluate(snapshotScript) as SnapshotState)
        // srcdoc/about:blank inherit the parent's base. Make it explicit before
        // localization so relative review images keep their original meaning.
        await frame.evaluate(`(() => { const url = document.baseURI; let base = document.querySelector('base'); if (!base) { base = document.createElement('base'); document.head.prepend(base); } base.href = url; })()`)
        const marker = `embedded-${embeddedDocuments.length + 1}`
        await element.evaluate((node: any, marker: string) => node.setAttribute('data-copy-embedded', marker), marker)
        embeddedDocuments.push({ marker, html: await frame.content(), url: documentUrl })
      } catch (error) { report.issues.push(`Could not capture embedded document ${frame.url()}: ${error instanceof Error ? error.message : 'unavailable'}`) }
      }
      viewportReport.images = states.reduce((count, state) => count + state.images, 0)
      viewportReport.broken = [...new Set(states.flatMap(state => state.broken))]
      for (const state of states) {
        if (state.broken.length) report.issues.push(`${width}px source has ${state.broken.length} image(s) that did not load: ${state.broken.join(', ')}`)
        report.issues.push(...state.issues.map(issue => `${width}px: ${issue}`))
        for (const widget of state.shadowWidgets) {
          if (widget.provider) (report.excludedWidgets ??= []).push(widget.host)
          else report.issues.push(`${width}px visible shadow widget needs review: ${widget.host}.`)
        }
      }
      await page.evaluate('window.scrollTo(0, 0)')
      await page.evaluate(`(() => { ${sourceThemeScript}; let meta=document.querySelector('meta[name="amboras:source-theme"]');if(!meta){meta=document.createElement('meta');meta.name='amboras:source-theme';document.head.appendChild(meta);}meta.content=JSON.stringify(readSourceTheme(document)); })()` )
      const html = await page.content()
      if (html.length + embeddedDocuments.reduce((size, document) => size + document.html.length, 0) > 12_000_000) throw new Error('The rendered document exceeds 12MB; capture its pages separately')
      captures.push({ width, html, url: page.url(), states, embeddedDocuments })
      await context.close()
    }
    const primary = captures[0]!
    const preserved = new Set(primary.states.flatMap(state => state.declaredImageUrls))
    // Retain source images selected only at initial mobile/tablet load without
    // wrapping elements or breaking direct-child CSS selectors. Ambiguous DOM
    // changes still require review instead of guessing where a new image belongs.
    const variants = new Map<number, Array<{ width: number; image: CapturedImage }>>()
    for (const image of primary.states[0]?.imageElements ?? []) {
      if (image.picture || image.srcset) continue
      for (const capture of captures.slice(1)) {
        const images = capture.states[0]?.imageElements ?? []
        const matches = images.filter(candidate => candidate.key === image.key && candidate.alt === image.alt)
        const stableImageId = image.key.startsWith('id:') && !image.key.includes('/')
        if (matches.length !== 1 || (!stableImageId && images.length !== primary.states[0]?.imageElements.length)) continue
        const candidate = matches[0]!
        if (candidate.picture || candidate.srcset || !/^(?:https?:|data:image)/.test(candidate.src) || candidate.src === image.src) continue
        variants.set(image.index, [...(variants.get(image.index) ?? []), { width: capture.width, image: candidate }])
        preserved.add(candidate.src)
      }
    }
    const escapeAttribute = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
    primary.html = mapMediaDocument(primary.html, tag => {
      if (!/^<img\b/i.test(tag)) return tag
      const marker = /\sdata-copy-capture-image="(\d+)"/.exec(tag)
      if (!marker) return tag
      const index = Number(marker[1]), original = primary.states[0]?.imageElements[index]
      let next = tag.replace(/\sdata-copy-capture-image="\d+"/, '')
      if (!variants.has(index) || !original) return next
      const values = [{ width: 1440, image: original }, ...variants.get(index)!]
      for (const value of values) {
        const device = value.width === 390 ? 'mobile' : value.width === 820 ? 'tablet' : 'desktop'
        for (const [key, raw] of Object.entries({ src: value.image.src, width: value.image.width ?? '', height: value.image.height ?? '' })) next = next.replace(/\/?>(?=$)/, ` data-copy-${device}-${key}="${escapeAttribute(raw)}">`)
      }
      return next
    })
    for (const capture of captures.slice(1)) {
      const missing = [...new Set(capture.states.flatMap(state => state.imageUrls))].filter(url => !preserved.has(url))
      if (missing.length) report.issues.push(`${capture.width}px source generated ${missing.length} additional image(s) absent from the saved desktop DOM; responsive markup needs review: ${missing.map(url => url.startsWith('data:') ? 'inline browser-generated image' : url).join(', ')}`)
    }
    report.issues = [...new Set(report.issues)]
    report.excludedWidgets = [...new Set(report.excludedWidgets ?? [])]
    report.complete = !report.issues.length
    return { html: primary.html, url: primary.url, embeddedDocuments: primary.embeddedDocuments, notes: [`Rendered fresh desktop, tablet and mobile browser sessions and scrolled each before saving its images.`, ...report.excludedWidgets.map(widget => `Excluded source payment widget: ${widget}; checkout uses this store's payment integration.`), ...report.issues], captureReport: report }
  } catch (error) {
    signal.throwIfAborted()
    throw new Error(`Could not finish the visual source capture: ${error instanceof Error ? error.message : String(error)}. The copy was not saved; retry after the source or browser is available.`)
  } finally {
    signal.removeEventListener('abort', abort)
    await browser.close().catch(() => {})
  }
}

async function scrollDocument(page: Page | Frame, limit = 100): Promise<boolean> {
  let stable = 0
  for (let step = 0; step < limit; step++) {
    const atBottom = await page.evaluate(`(() => { const root = document.scrollingElement || document.documentElement; const end = root.scrollHeight - innerHeight; if (scrollY >= end - 4) return true; window.scrollBy(0, Math.max(500, innerHeight * .8)); return false })()`)
    await new Promise(resolve => setTimeout(resolve, atBottom ? 550 : 120))
    if (atBottom && ++stable >= 3) return true
    if (!atBottom) stable = 0
  }
  return false
}

async function settleImages(page: Page | Frame): Promise<void> {
  await page.evaluate(`Promise.race([Promise.all([...document.images].map(image => image.decode().catch(() => {}))), new Promise(resolve => setTimeout(resolve, 5000))])`)
}
