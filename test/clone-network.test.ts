import assert from 'node:assert/strict'
import test from 'node:test'
import { assertPublicNetworkUrl, isPublicAddress, isPublicHost } from '../src/pages/public-network.ts'
import { localizeMediaUrls } from '../src/pages/clone-media.ts'
import { copyStylesheet } from '../src/pages/clone-styles.ts'

test('asset guard rejects private, mapped and reserved addresses and mixed DNS answers', async () => {
  for (const address of ['0.0.0.0', '10.0.0.1', '127.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '192.0.2.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '255.255.255.255', '::1', '::ffff:127.0.0.1', '64:ff9b::7f00:1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '2002:7f00:1::', '3fff::1']) assert.equal(isPublicAddress(address), false, address)
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '2001:4860:4860::8888']) assert.equal(isPublicAddress(address), true, address)
  assert.equal(await isPublicHost('assets.example', async () => [{ address: '8.8.8.8' }, { address: '192.168.1.1' }]), false)
  assert.equal(await isPublicHost('assets.example', async () => [{ address: '8.8.8.8' }, { address: '2606:4700::1' }]), true)
  assert.equal(await isPublicHost('assets.example', async () => []), false)
  for (const raw of ['http://localhost./a.png', 'http://2130706433/a.png', 'http://0177.0.0.1/a.png', 'http://[::ffff:127.0.0.1]/a.png', 'file:///a.png', 'https://user:password@8.8.8.8/a.png']) await assert.rejects(assertPublicNetworkUrl(raw), /private|public HTTP|Invalid/)
  await assert.rejects(assertPublicNetworkUrl('https://assets.example/a.png', { resolve: async () => [{ address: '127.0.0.1' }] }), /private/)
})

test('production image localization blocks private initial targets and private redirect hops before transport', async (t) => {
  const requests: Array<{ url: string; redirect?: RequestInit['redirect']; referer: string | null }> = []
  t.mock.method(globalThis, 'fetch', async (raw: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(raw), redirect: options?.redirect, referer: new Headers(options?.headers).get('referer') })
    return new Response('', { status: 302, headers: { location: 'http://169.254.169.254/private.png' } })
  })
  const direct = await localizeMediaUrls(['http://127.0.0.1/private.png'], 'https://8.8.8.8/source', { storeId: 'guard_fixture' })
  assert.equal(direct.report.failed, 1); assert.match(direct.report.entries[0]!.reason!, /private/); assert.equal(requests.length, 0)
  const redirect = await localizeMediaUrls(['https://8.8.8.8/start.png'], 'https://8.8.8.8/source?offer=public', { storeId: 'guard_fixture' })
  assert.equal(redirect.report.failed, 1); assert.match(redirect.report.entries[0]!.reason!, /private/)
  assert.deepEqual(requests, [{ url: 'https://8.8.8.8/start.png', redirect: 'manual', referer: 'https://8.8.8.8/source?offer=public' }])
})

test('production stylesheet guard applies to redirects and nested imports while retaining failure reports', async (t) => {
  const requests: string[] = []
  t.mock.method(globalThis, 'fetch', async (raw: string | URL | Request, options?: RequestInit) => {
    const url = String(raw); requests.push(url); assert.equal(options?.redirect, 'manual')
    if (url.endsWith('/redirect.css')) return new Response('', { status: 307, headers: { location: 'http://127.0.0.1/theme.css' } })
    return new Response('@import "http://127.0.0.1/private.css"; .hero{color:red}', { headers: { 'content-type': 'text/css' } })
  })
  const options = { fetchImpl: globalThis.fetch, notes: [] as string[], issues: [] as string[], userAgent: 'fixture' }
  await assert.rejects(copyStylesheet('http://127.0.0.1/direct.css', options), /private/); assert.equal(requests.length, 0)
  await assert.rejects(copyStylesheet('https://8.8.8.8/redirect.css', options), /private/)
  const nested = await copyStylesheet('https://8.8.8.8/theme.css', options)
  assert.match(nested.css, /color:red/); assert.equal(options.issues.length, 1)
  assert.deepEqual(requests, ['https://8.8.8.8/redirect.css', 'https://8.8.8.8/theme.css'])
})

test('explicit fixture transports remain usable and redirected CSS uses its final asset base on cache hits', async () => {
  const requests: string[] = []
  const fetchImpl = (async (raw: string | URL | Request) => {
    const url = String(raw); requests.push(url)
    if (url.endsWith('/start.css')) return new Response('', { status: 302, headers: { location: '/assets/theme.css' } })
    return new Response('.hero{background:url(hero.png)}', { headers: { 'content-type': 'text/css' } })
  }) as typeof fetch
  const options = { fetchImpl, cache: new Map<string, string>(), notes: [], userAgent: 'fixture' }
  for (let n = 0; n < 2; n++) assert.match((await copyStylesheet('http://127.0.0.1/start.css', options)).css, /http:\/\/127\.0\.0\.1\/assets\/hero\.png/)
  assert.deepEqual(requests, ['http://127.0.0.1/start.css', 'http://127.0.0.1/assets/theme.css'])
})

test('stylesheet redirect budget remains twenty hops', async () => {
  let calls = 0
  const fetchImpl = (async () => { calls++; return new Response('', { status: 302, headers: { location: '/again.css' } }) }) as typeof fetch
  await assert.rejects(copyStylesheet('http://127.0.0.1/start.css', { fetchImpl, notes: [], userAgent: 'fixture' }), /20-redirect limit/)
  assert.equal(calls, 21)
})
