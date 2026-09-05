import test from 'node:test'
import assert from 'node:assert/strict'
import { clonePage, localizeClonedHtml, localizeImageUrls, planClonedMediaRepair } from '../src/pages/clone.ts'
import { absoluteCssUrls } from '../src/pages/clone-styles.ts'
import { rewriteHtmlImages, srcsetUrls } from '../src/pages/clone-media.ts'
import { MAX_UPLOAD_BYTES, readUpload, sniffImageType } from '../src/lib/uploads.ts'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')
const response = (bytes = png, type = 'image/png') => new Response(bytes, { headers: { 'content-type': type } })
const fetchImages = (async () => response()) as typeof fetch

test('failed main, nested and embedded stylesheets keep the saved copy report incomplete', async () => {
  const captureReport = { mode: 'rendered' as const, complete: true, viewports: [], issues: [] }
  const sourceCapture = { url: 'https://source.example/', html: '<link rel="stylesheet" href="missing.css"><style>@import "nested.css";</style><iframe data-copy-embedded="review"></iframe>', captureReport,
    embeddedDocuments: [{ marker: 'review', url: 'https://reviews.example/', html: '<link rel="stylesheet" href="review.css">' }] }
  const result = await clonePage(sourceCapture.url, { storeId: 'store_image_styles', sourceCapture, fetchImpl: (async () => new Response('missing', { status: 404 })) as typeof fetch })
  assert.equal(result.captureReport?.complete, false)
  for (const file of ['missing.css', 'nested.css', 'review.css']) assert.ok(result.captureReport?.issues.some(issue => issue.includes(file)))
  assert.equal(captureReport.complete, true, 'caller capture evidence is not mutated')
})

test('source refresh redirects cannot navigate the copied document away', async () => {
  const result = await clonePage('https://source.example/', { storeId: 'store_image_refresh', fetchImpl: (async () => new Response('<meta content="10;url=https://source.example/checkout" http-equiv = "refresh"><meta HTTP-EQUIV=refresh content="0"><meta name="description" content="keep">')) as typeof fetch })
  assert.doesNotMatch(result.html, /http-equiv/i)
  assert.match(result.html, /content="keep"/)
})

test('captured initial-device image variants are all localized without changing their dimensions', async () => {
  const requested: string[] = []
  const result = await localizeClonedHtml('<img src="desktop.png" data-copy-desktop-src="desktop.png" data-copy-tablet-src="tablet.png" data-copy-mobile-src="mobile.png" data-copy-mobile-width="390" data-copy-mobile-height="500">', 'https://source.example/', {
    storeId: 'store_image_devices', fetchImpl: (async (url) => { requested.push(String(url)); return response() }) as typeof fetch,
  })
  assert.deepEqual(requested.sort(), ['https://source.example/desktop.png', 'https://source.example/mobile.png', 'https://source.example/tablet.png'])
  assert.equal(result.report.discovered, 3)
  assert.equal(result.report.complete, true)
  for (const device of ['desktop', 'tablet', 'mobile']) assert.match(result.html, new RegExp(`data-copy-${device}-src="/_uploads/`))
  assert.match(result.html, /data-copy-mobile-width="390" data-copy-mobile-height="500"/)
})

test('srcset keeps commas in CDN and embedded URLs, descriptors, and exact whitespace', async () => {
  const data = `data:image/png;base64,${png.toString('base64')}`
  const candidates = `${data} 1x,  https://cdn.example/c_fill,w_800,h_600/a.png?x=1&amp;y=2 2x, /large.png 3x`
  assert.deepEqual(srcsetUrls(candidates).map((span) => span.value), [data, 'https://cdn.example/c_fill,w_800,h_600/a.png?x=1&amp;y=2', '/large.png'])
  const requested: string[] = []
  const result = await localizeClonedHtml(`<picture><source media="(max-width:600px)" data-lazy-srcset="${candidates}"><img srcset="${candidates}"></picture>`, 'https://source.example/path/', {
    storeId: 'store_image_tokens', fetchImpl: (async (input) => { requested.push(String(input)); return response() }) as typeof fetch,
  })
  assert.deepEqual(requested.sort(), ['https://cdn.example/c_fill,w_800,h_600/a.png?x=1&y=2', 'https://source.example/large.png'])
  assert.equal(result.report.discovered, 3)
  assert.equal(result.report.embedded, 1)
  assert.equal(result.report.complete, true)
  assert.equal(result.report.entries[0]?.occurrences, 2)
  assert.match(result.html, new RegExp(`${data.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} 1x,  /_uploads/`))
  assert.match(result.html, /\.png 2x, \/_uploads\/[^" ]+\.png 3x/)
})

test('image discovery covers lazy backgrounds, SVG, noscript, posters, metadata and image sets without touching JSON or copy', async () => {
  const source = 'https://source.example/dir/page'
  const script = `<script type="application/json">{"src":"https://source.example/dir/one.png","markup":"<img src='not-image.png'>","css":"url(also-not-image.png)"}</script>`
  const html = `${script}<p>https://source.example/dir/one.png</p><!-- <img src="comment.png"> -->
  <style>/* url(comment.png) */.hero{background:image-set("one.png" 1x,url('two.png') 2x);content:"url(copy.png)"} @font-face{src:url(font.woff2)} @import url("unavailable.css");</style>
  <div data-background="three.png" style="background-image:-webkit-image-set(&quot;four.png&quot; 1x, url('five.png') 2x)"></div>
  <div data-background-image="url('six.png')"></div><svg><image href="sprite.svg#main"/><image xlink:href="sprite.svg#second"/><image href="#embedded"/></svg>
  <noscript><picture><img src='seven.png'></picture></noscript><video src="movie.mp4" poster="eight.png"></video><iframe src="frame.html"></iframe>
  <link as="image" rel="preload" href="nine.png"><link rel="icon" href="ten.png"><meta content="eleven.png" property="og:image"><input src=button.png type=image><img src="/_uploads/already/up_image.png">`
  const requested: string[] = []
  const result = await localizeClonedHtml(html, source, { storeId: 'store_image_contexts', fetchImpl: (async (url) => { requested.push(String(url)); return String(url).endsWith('.svg') ? response(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'image/svg+xml') : response() }) as typeof fetch })
  assert.equal(requested.length, 13)
  assert.ok(requested.every((url) => !/copy|comment|font|unavailable|frame|movie|not-image/.test(url)))
  assert.ok(result.html.includes(script), 'JSON bytes must remain exact')
  assert.ok(result.html.includes('<p>https://source.example/dir/one.png</p>'))
  assert.ok(result.html.includes('content:"url(copy.png)"'))
  assert.ok(result.html.includes('src:url(font.woff2)'))
  assert.ok(result.html.includes('@import url("unavailable.css")'))
  assert.match(result.html, /image href="\/_uploads\/[^"#]+\.svg#main"/)
  assert.match(result.html, /image xlink:href="\/_uploads\/[^"#]+\.svg#second"/)
  assert.match(result.html, /<input src=\/_uploads\/[^ >]+\.png type=image>/)
  assert.equal(result.report.entries.find((entry) => entry.url === 'sprite.svg#second')?.status, 'reused')
  assert.equal(result.report.embedded, 1)
  assert.equal(result.report.complete, true)
})

test('CSS rebasing respects string/comment boundaries and rebases image sets and fonts relative to each stylesheet', () => {
  const css = `.x{background:image-set("../mobile,a.png" 1x,url('../hero\\(wide\\).png') 2x);content:'url(copy.png)'}/* url(comment.png) */ @font-face{src:url('../fonts/body.woff2')}`
  const rebased = absoluteCssUrls(css, 'https://source.example/css/main.css')
  assert.ok(rebased.includes('"https://source.example/mobile,a.png"'))
  assert.ok(rebased.includes("url('https://source.example/hero(wide).png')"))
  assert.ok(rebased.includes("content:'url(copy.png)'"))
  assert.ok(rebased.includes('/* url(comment.png) */'))
  assert.ok(rebased.includes("url('https://source.example/fonts/body.woff2')"))
})

test('default localization has no image-count ceiling; source URLs and identical bytes are deduplicated across pages', async () => {
  const shared = new Map<string, string>()
  const urls = Array.from({ length: 135 }, (_item, index) => `https://cdn.example/${index}.png`)
  let requests = 0
  const fetchImpl = (async () => { requests++; return response() }) as typeof fetch
  const first = await localizeImageUrls([...urls, urls[0]!], { storeId: 'store_image_count', localizedImages: shared, fetchImpl })
  assert.equal(requests, 135)
  assert.equal(first.copied, 135, 'legacy copied count remains newly owned source URLs')
  assert.equal(new Set(first.urls).size, 1, 'identical bytes occupy one upload')
  assert.equal(first.report.localized, 1)
  assert.equal(first.report.reused, 134)
  assert.equal(first.report.discovered, 135)
  assert.equal(first.report.complete, true)
  const second = await localizeImageUrls(urls, { storeId: 'store_image_count', localizedImages: shared, fetchImpl })
  assert.equal(requests, 135)
  assert.equal(second.copied, 0)
  assert.equal(second.report.reused, 135)
})

test('explicit limits, disabled downloads and unsupported URLs are recorded without pretending the copy is complete', async () => {
  const urls = ['https://cdn.example/a.png', 'https://cdn.example/b.png', 'https://cdn.example/c.png']
  const limited = await localizeImageUrls(urls, { storeId: 'store_image_limits', maxImages: 1, fetchImpl: fetchImages })
  assert.equal(limited.report.skipped, 2)
  assert.equal(limited.report.complete, false)
  assert.ok(limited.report.entries.slice(1).every((entry) => entry.reason?.includes('Explicit image limit')))
  assert.equal(limited.urls[1], urls[1])
  const budget = { remaining: 1 }
  const capped = await localizeImageUrls(urls, { storeId: 'store_image_limits', imageBudget: budget, fetchImpl: fetchImages })
  assert.equal(capped.report.skipped, 2)
  assert.equal(budget.remaining, 0)
  assert.match(capped.report.entries[1]!.reason!, /site image budget/)
  const disabled = await localizeImageUrls([urls[0]!, 'blob:https://source.example/id', 'javascript:alert(1)', 'https://user:password@source.example/a.png'], { storeId: 'store_image_limits', localizeImages: false, fetchImpl: (() => { throw new Error('must not fetch') }) as typeof fetch })
  assert.equal(disabled.report.skipped, 4)
  assert.ok(disabled.report.entries.every((entry) => entry.reason))
})

test('download failures retain exact source references and describe status, MIME and invalid bytes', async () => {
  const html = `<img src="https://cdn.example/a.png?v=1" srcset="https://cdn.example/a.png?v=1&amp;width=390 390w, https://cdn.example/b.png 820w"><img src="https://cdn.example/c.png">`
  const requested: string[] = []
  const result = await localizeClonedHtml(html, 'https://source.example/', { storeId: 'store_image_failures', fetchImpl: (async (input) => {
    const url = String(input); requested.push(url)
    if (url.includes('width=')) return new Response('unavailable', { status: 404 })
    if (url.endsWith('b.png')) return response(png, 'text/html')
    if (url.endsWith('c.png')) return new Response('not a png', { headers: { 'content-type': 'image/png' } })
    return response()
  }) as typeof fetch })
  assert.equal(requested.length, 4, 'permanent failures are not retried')
  assert.equal(result.report.failed, 3)
  assert.equal(result.report.complete, false)
  const failures = result.report.entries.filter((entry) => entry.status === 'failed')
  assert.equal(failures[0]?.reason, 'HTTP 404')
  assert.match(failures[1]!.reason!, /MIME mismatch/)
  assert.match(failures[2]!.reason!, /bytes do not match/)
  assert.ok(result.html.includes('srcset="https://cdn.example/a.png?v=1&amp;width=390 390w, https://cdn.example/b.png 820w"'))
  assert.ok(!/up_[^ ]+&(?:amp;)?width/.test(result.html))
})

test('valid image bytes may identify extensionless or generic-MIME images, including files between 6MB and 12MB', async () => {
  const large = Buffer.concat([png, Buffer.alloc(7 * 1024 * 1024)])
  const result = await localizeImageUrls(['https://cdn.example/large', 'https://cdn.example/empty', 'https://cdn.example/missing-type'], {
    storeId: 'store_image_bytes', fetchImpl: (async (url) => String(url).endsWith('/empty') ? response(Buffer.alloc(0)) : String(url).endsWith('missing-type') ? new Response(png) : response(large, 'application/octet-stream')) as typeof fetch,
  })
  assert.equal(result.report.localized, 2)
  assert.equal(result.report.failed, 1)
  assert.equal(result.report.entries[0]?.bytes, large.length)
  assert.equal(readUpload(result.urls[0]!)?.data.length, large.length)
  assert.equal(result.report.entries[2]?.mime, 'image/png')
  const oversized = await localizeImageUrls(['https://cdn.example/too-big'], { storeId: 'store_image_bytes', fetchImpl: (async () => new Response(png, { headers: { 'content-type': 'image/png', 'content-length': String(MAX_UPLOAD_BYTES + 1) } })) as typeof fetch })
  assert.match(oversized.report.entries[0]!.reason!, /12MB upload limit/)
  const streamed = await localizeImageUrls(['https://cdn.example/stream'], { storeId: 'store_image_bytes', fetchImpl: (async () => response(Buffer.concat([png, Buffer.alloc(MAX_UPLOAD_BYTES)]))) as typeof fetch })
  assert.match(streamed.report.entries[0]!.reason!, /12MB upload limit/)
})

test('downloads use bounded parallelism and retry transient failures only', async () => {
  let active = 0, peak = 0
  const calls = new Map<string, number>()
  const urls = Array.from({ length: 9 }, (_item, index) => `https://cdn.example/${index}.png`)
  const result = await localizeImageUrls(urls, { storeId: 'store_image_workers', imageConcurrency: 3, fetchImpl: (async (input) => {
    const url = String(input)
    calls.set(url, (calls.get(url) ?? 0) + 1)
    active++; peak = Math.max(peak, active)
    await new Promise((resolve) => setTimeout(resolve, 5))
    active--
    return url.endsWith('/0.png') && calls.get(url) === 1 ? new Response('try again', { status: 503 }) : response()
  }) as typeof fetch })
  assert.equal(peak, 3)
  assert.equal(calls.get(urls[0]!), 2)
  assert.equal([...calls.values()].reduce((sum, count) => sum + count, 0), 10)
  assert.equal(result.report.complete, true)
})

test('timeouts cover hung fetch/body reads; cancellation stops scheduling and rejects the import', async () => {
  const timed = await localizeImageUrls(['https://cdn.example/hang'], { storeId: 'store_image_abort', imageTimeoutMs: 5, imageRetries: 1, fetchImpl: (() => new Promise(() => {})) as typeof fetch })
  assert.equal(timed.report.failed, 1)
  assert.match(timed.report.entries[0]!.reason!, /timed out/)
  const stream = await localizeImageUrls(['https://cdn.example/hung-body'], { storeId: 'store_image_abort', imageTimeoutMs: 5, imageRetries: 0, fetchImpl: (async () => new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'image/png' } })) as typeof fetch })
  assert.match(stream.report.entries[0]!.reason!, /timed out/)
  const controller = new AbortController()
  let requests = 0
  const pending = localizeImageUrls(Array.from({ length: 10 }, (_item, index) => `https://cdn.example/${index}`), {
    storeId: 'store_image_abort', signal: controller.signal, imageConcurrency: 2,
    fetchImpl: (() => { requests++; return new Promise(() => {}) }) as typeof fetch,
  })
  controller.abort(new Error('Merchant cancelled'))
  await assert.rejects(pending, /Merchant cancelled/)
  assert.equal(requests, 2)
})

test('captured pages skip the original fetch, use the final base, preserve notes and emit an image audit', async () => {
  const requested: string[] = []
  const result = await clonePage('https://source.example/start', {
    storeId: 'store_image_capture', sourceCapture: { url: 'https://source.example/final/page', html: '<html><head><title>Rendered</title><base href="../assets/"></head><body><img data-lazy-src="hero.png"><img src="missing.png"></body></html>', notes: ['Captured after lazy images loaded'] },
    fetchImpl: (async (url) => { requested.push(String(url)); return String(url).endsWith('/missing.png') ? new Response('missing', { status: 404 }) : response() }) as typeof fetch,
  })
  assert.deepEqual(requested.sort(), ['https://source.example/assets/hero.png', 'https://source.example/assets/missing.png'])
  assert.equal(result.sourceUrl, 'https://source.example/final/page')
  assert.equal(result.title, 'Rendered')
  assert.ok(result.notes.includes('Captured after lazy images loaded'))
  assert.ok(result.notes.some((note) => note.startsWith('Image copy incomplete: 1 failed')))
  assert.equal(result.imageReport?.discovered, 2)
  assert.match(result.html, /<img data-lazy-src="\/_uploads\/[^ ]+" src="\/_uploads\//)
})

test('repair preserves user-selected media and image discovery does not mutate already-owned content', () => {
  const html = `<img src="/_uploads/edited/up_current.png" srcset="/_uploads/edited/up_current.png 1x" data-src="/_uploads/old/up_old.png" data-lazy-srcset="/_uploads/old/up_old.png 1x"><style>.x{content:"url(https://example.com/source.png)"}</style>`
  const plan = planClonedMediaRepair(html)
  assert.equal(plan.html, html)
  assert.equal(plan.changed, false)
  assert.equal(rewriteHtmlImages(html, (url) => url), html)
  const untouched = `<script type="application/json">{"markup":"<img src='/_uploads/old/up_image.png&width=390'>"}</script><style>.x{content:"url(/_uploads/old/up_image.png&width=390)"}</style>`
  const corrected = planClonedMediaRepair(`${untouched}<img src="/_uploads/old/up_image.png&amp;width=390">`)
  assert.ok(corrected.html.startsWith(untouched), 'repair uses the same strict HTML/CSS boundaries')
  assert.ok(corrected.html.endsWith('<img src="/_uploads/old/up_image.png">'))
})

test('SVG font prologs and ICO favicons are validated, localized and served with their actual format', async () => {
  const svg = Buffer.from(`<?xml version="1.0" encoding="utf-8"?>\n<!-- ${'Source font license. '.repeat(150)} -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "https://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><defs><font id="fontawesome"/></defs></svg>`)
  const ico = Buffer.alloc(22 + png.length)
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4)
  ico[6] = 1; ico[7] = 1; ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(png.length, 14); ico.writeUInt32LE(22, 18); png.copy(ico, 22)
  const requested: string[] = []
  const html = `<link rel="icon" href="/favicon.ico"><style>@font-face{font-family:icons;src:url("../webfonts/fa-brands.woff2") format("woff2"),url("../webfonts/fa-brands.svg#fontawesome") format("svg")}@media(max-width:600px){.icon{background:url("../sprite.svg#icon")}}</style><svg><use xlink:href="../sprite.svg#second"/></svg>`
  const result = await localizeClonedHtml(html, 'https://source.example/css/style.css', {
    storeId: 'store_image_svg', fetchImpl: (async (input) => { const url = String(input); requested.push(url); return url.endsWith('favicon.ico') ? response(ico, 'image/x-icon') : response(svg, 'image/svg+xml') }) as typeof fetch,
  })
  assert.deepEqual(requested.sort(), ['https://source.example/favicon.ico', 'https://source.example/sprite.svg', 'https://source.example/webfonts/fa-brands.svg'])
  assert.equal(result.report.complete, true)
  assert.ok(result.html.includes('@media(max-width:600px)'))
  assert.match(result.html, /\.svg#fontawesome"\) format\("svg"\)/)
  assert.match(result.html, /\.svg#second"/)
  assert.ok(result.html.includes('url("../webfonts/fa-brands.woff2") format("woff2")'))
  assert.equal(readUpload(result.report.entries.find((entry) => entry.url === '/favicon.ico')!.localUrl!)?.type, 'image/vnd.microsoft.icon')
  assert.equal(readUpload(result.report.entries.find((entry) => entry.url.includes('fa-brands.svg'))!.localUrl!.split('#')[0]!)?.data.toString(), svg.toString())
  assert.equal(sniffImageType(Buffer.from(`<html><!-- ${'x'.repeat(800)} --><svg></svg></html>`)), null, 'an HTML response with an embedded svg is not an SVG image')
})

test('relative saved CDN paths stay on the source after failure and stale lazy attributes never replace a selected native image', async () => {
  const remote = '/cdn/shop/files/full-banner.png?v=1&width=1200'
  const result = await localizeClonedHtml(`<img src="${remote.replace(/&/g, '&amp;')}">`, 'https://shop.example/products/offer', {
    storeId: 'store_image_relative', fetchImpl: (async () => new Response('Unavailable', { status: 404 })) as typeof fetch,
  })
  assert.match(result.html, /src="https:\/\/shop\.example\/cdn\/shop\/files\/full-banner\.png\?v=1&amp;width=1200"/)
  assert.equal(result.report.entries[0]?.resolvedUrl, `https://shop.example${remote}`)
  const cloned = await clonePage('https://shop.example/products/offer', {
    storeId: 'store_image_relative', sourceCapture: { html: '<img src="/_uploads/edited/up_real.png" srcset="/_uploads/edited/up_real.png 1x" data-src="old.png" data-srcset="old2.png 2x"><aside data-background="url(\'bg.png\')"></aside>', url: 'https://shop.example/products/offer' }, fetchImpl: fetchImages,
  })
  assert.match(cloned.html, /src="\/_uploads\/edited\/up_real.png" srcset="\/_uploads\/edited\/up_real.png 1x"/)
  assert.match(cloned.html, /<aside[^>]+style="background-image:url\('\/_uploads\//)
})

test('hotlink-protected images receive source-aware referrers without fragments or user information', async () => {
  const source = 'https://reader:private@shop.example/products/offer?variant=blue#gallery'
  const expected = new Map<string, string | null>([
    ['https://shop.example/cdn/hero.png', 'https://shop.example/products/offer?variant=blue'],
    ['https://images.example/hero.png', 'https://shop.example/'],
    ['https://shop.example:8443/hero.png', 'https://shop.example/'],
    ['http://images.example/hero.png', null],
  ])
  const seen = new Map<string, string | null>()
  const fetchImpl = (async (input, init) => {
    const url = String(input), headers = new Headers(init?.headers)
    const referer = headers.get('referer')
    seen.set(url, referer)
    assert.equal(headers.has('authorization'), false)
    assert.equal(headers.has('cookie'), false)
    return expected.get(url) === referer ? response() : new Response('Hotlink denied', { status: 403 })
  }) as typeof fetch
  const result = await localizeImageUrls([...expected.keys()], { storeId: 'store_image_referer', fetchImpl }, source)
  assert.equal(result.report.complete, true)
  assert.deepEqual(seen, expected)
  const html = await localizeClonedHtml('<img src="https://images.example/hero.png">', source, { storeId: 'store_image_referer', fetchImpl })
  assert.equal(html.report.complete, true)
  const cloned = await clonePage('https://shop.example/products/offer?variant=blue#gallery', {
    storeId: 'store_image_referer', sourceCapture: { url: source, html: '<img src="https://images.example/hero.png">' }, fetchImpl,
  })
  assert.equal(cloned.imageReport?.complete, true)
})

test('image redirects recalculate referrers when crossing origins or downgrading to HTTP', async () => {
  const seen: Array<[string, string | null]> = []
  const result = await localizeImageUrls(['https://shop.example/image'], {
    storeId: 'store_image_redirect_referer', fetchImpl: (async (input, init) => {
      const url = String(input)
      seen.push([url, new Headers(init?.headers).get('referer')])
      assert.equal(init?.redirect, 'manual')
      if (url === 'https://shop.example/image') return new Response(null, { status: 302, headers: { location: 'https://cdn.example/image' } })
      if (url === 'https://cdn.example/image') return new Response(null, { status: 307, headers: { location: 'http://cdn.example/image' } })
      return response()
    }) as typeof fetch,
  }, 'https://shop.example/products/offer?variant=blue#gallery')
  assert.equal(result.report.complete, true)
  assert.deepEqual(seen, [
    ['https://shop.example/image', 'https://shop.example/products/offer?variant=blue'],
    ['https://cdn.example/image', 'https://shop.example/'],
    ['http://cdn.example/image', null],
  ])
})
