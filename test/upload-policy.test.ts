import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('copied SVG uploads retain image bytes while direct navigation is sandboxed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'amboras-upload-policy-'))
  Object.assign(process.env, { AMBORAS_DB: join(dir, 'test.db'), PORT: '0', AMBORAS_LOG_LEVEL: 'error', AMBORAS_STOREFRONT_HOST: '', AMBORAS_PUBLIC_ORIGIN: '', AMBORAS_ADMIN_HOST: '' })
  const { server } = await import('../src/main.ts')
  const { saveUpload } = await import('../src/lib/uploads.ts')
  const { getDb } = await import('../src/lib/db.ts')
  await new Promise<void>(resolve => server.listening ? resolve() : server.once('listening', resolve))
  try {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><script>parent.svgExecuted=true</script><rect width="20" height="20" fill="red"/></svg>'
    const saved = saveUpload({ name: 'source.svg', type: 'image/svg+xml', data: Buffer.from(svg) }, 'policy_fixture')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const response = await fetch(`http://127.0.0.1:${address.port}${saved.url}`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type') ?? '', /^image\/svg\+xml/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.match(response.headers.get('content-security-policy') ?? '', /sandbox; script-src 'none'/)
    assert.equal(await response.text(), svg)
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()))
    getDb().handle.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
