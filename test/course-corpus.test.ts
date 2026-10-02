import test from 'node:test'
import assert from 'node:assert/strict'
import { retrieveCourse, courseContext } from '../src/agent/course-corpus.ts'
import { knowledge } from '../src/agent/knowledge.ts'
test('retrieval grounds checkout decisions in owned checkout source, with source fingerprints', () => {
  const found = retrieveCourse(['pages'], 'billing address wallet provider preview', 9000)
  assert.ok(found.some(p => p.source.endsWith('checkout-design.md') && /preview/i.test(p.text)))
  assert.ok(found.every(p => /^[a-f0-9]{64}$/.test(p.sha256)))
  assert.ok(found.reduce((n,p) => n+p.text.length, 0) <= 9000)
  assert.deepEqual(found, retrieveCourse(['pages'], 'billing address wallet provider preview', 9000))
})
test('topic selection excludes unrelated ad material and routes offer and testing lessons', () => {
  const found = retrieveCourse(['offers', 'testing'], 'breakeven margin revenue session')
  assert.ok(found.some(p => p.source.endsWith('offers.md')))
  assert.ok(found.some(p => p.source.endsWith('testing.md')))
  assert.ok(found.every(p => /offers|testing/.test(p.source)))
  assert.deepEqual(retrieveCourse(['unknown']), [])
  assert.deepEqual(retrieveCourse(['pages'], '', 0), [])
})
test('actual generation prompts include source excerpts with truth and consent precedence', () => {
  assert.match(knowledge('pages', 'offers', 'honesty'), /docs\/knowledge\/checkout-design.md/)
  assert.match(courseContext(['offers']), /Merchant facts and HONESTY rules override/)
  assert.match(knowledge('product'), /docs\/knowledge\/product-research.md/)
})
test('deployment includes the source corpus rather than excluding all docs', async () => {
  const { readFileSync } = await import('node:fs')
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8')
  const ignore = readFileSync(new URL('../.dockerignore', import.meta.url), 'utf8')
  assert.match(docker, /COPY docs\/knowledge/)
  assert.match(ignore, /!docs\/knowledge\//)
  assert.doesNotMatch(ignore, /^docs$/m)
})
