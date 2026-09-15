import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const dir = mkdtempSync(join(tmpdir(), 'clone-capture-'))
process.env.AMBORAS_DB = join(dir, 'capture.db')
const { captureCloneSource } = await import('../src/pages/clone-capture.ts')
const { clonePage } = await import('../src/pages/clone.ts')
const { brandFromClone } = await import('../src/control/assets.ts')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')

await test('rendered copy includes below-fold dynamic images, responsive candidates, CSSOM and scriptless owned embedded reviews', async () => {
  const mutations = []
  const server = createServer((request, response) => {
    if (request.method !== 'GET' || request.url === '/cart/add.js' || request.url === '/cart/123:1' || request.url === '/submit-test') { mutations.push(request.url); response.end('unexpected mutation'); return }
    if (request.url.endsWith('.png')) { response.writeHead(200, { 'content-type': 'image/png' }); response.end(png); return }
    response.setHeader('content-type', 'text/html')
    if (request.url === '/reviews') { response.end('<html><body><style>body{margin:0}img{width:100px}</style><img src="/review.png"><script>window.foreign=true</script></body></html>'); return }
    response.end(`<html><head><style id="injected"></style><style>:root{--primary:#007bff}body{background:#fff}h1{font:700 32px Georgia}button{background:#c21882;color:#fff}</style></head><body><h1>Source heading</h1><button>Add to cart</button><picture><source media="(max-width:600px)" srcset="/mobile.png"><img src="/desktop.png"></picture><div style="height:2400px"></div><section id="lazy"></section><iframe src="/reviews" style="width:100%;height:180px"></iframe><iframe srcdoc="&lt;img src=&quot;/inline.png&quot;&gt;" style="width:100%;height:180px"></iframe><form id="blocked-form" action="/submit-test"></form><script>
    fetch('/do-not-submit',{method:'POST',body:'no data'}).catch(()=>{});
    fetch('/cart/add.js').catch(()=>{});fetch('/cart/123:1').catch(()=>{});document.querySelector('#blocked-form').submit();
    document.querySelector('#injected').sheet.insertRule('.review{background-image:url(/cssom.png)}');
    new IntersectionObserver((entries,observer)=>{if(entries.some(entry=>entry.isIntersecting)){document.querySelector('#lazy').innerHTML='<img src="/dynamic.png"><div class="review">Hydrated</div>';observer.disconnect()}}).observe(document.querySelector('#lazy'));
    </script></body></html>`)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  try {
    const capture = await captureCloneSource(url, { allowPrivateNetwork: true, timeoutMs: 45_000 })
    assert.equal(mutations.length, 0)
    assert.deepEqual(capture.captureReport.viewports.map(view => view.width), [1440, 820, 390])
    assert.equal(capture.captureReport.complete, true, JSON.stringify(capture.captureReport))
    assert.equal(capture.embeddedDocuments.length, 2)
    assert.match(capture.html, /dynamic\.png/)
    assert.match(capture.html, /background-image:\s*url/)
    const result = await clonePage(url, { storeId: 'store_capture', sourceCapture: capture, fetchImpl: (...args) => fetch(...args) })
    assert.equal(brandFromClone(result.html).primary,'#c21882','Rendered source color takes precedence over framework tokens')
    assert.equal(brandFromClone(result.html).displayWeight,700)
    assert.equal(brandFromClone(result.html).displayFont,'Georgia')
    assert.equal(result.imageReport.complete, true, JSON.stringify(result.imageReport))
    for (const name of ['desktop', 'mobile', 'dynamic', 'cssom', 'review', 'inline']) assert.ok(result.imageReport.entries.some(entry => entry.resolvedUrl?.endsWith('/' + name + '.png') && entry.localUrl), name)
    assert.match(result.html, /srcdoc="/)
    assert.match(result.html, /sandbox="allow-same-origin"/)
    assert.doesNotMatch(result.html, /<script\b|window\.foreign|fetch\('/)
    assert.doesNotMatch(result.html.replace(/\ssrcdoc="[^"]*"/g, ''), /<iframe[^>]*\ssrc=/)
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }) }
})
