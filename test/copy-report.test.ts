import test from 'node:test'
import assert from 'node:assert/strict'
import { Db } from '../src/lib/db.ts'
import { mergeImageReports, readCopyReport, saveCopyReport } from '../src/pages/clone-report.ts'
import { copyReportPage } from '../src/admin/copy-report-page.ts'
import type { ImageLocalizationReport } from '../src/pages/clone-media.ts'
import type { Page } from '../src/pages/store.ts'

test('site report retains failures in earlier documents even if a later download succeeds', () => {
  const report = (status: 'failed' | 'localized') => ({ entries: [{ url: 'https://source.example/photo.png', status, contexts: ['img[src]'], occurrences: 1 }] }) as ImageLocalizationReport
  for (const statuses of [['failed', 'localized'], ['localized', 'failed']] as const) {
    const result = mergeImageReports(statuses.map(report))
    assert.equal(result.complete, false)
    assert.equal(result.discovered, 1)
    assert.equal(result.failed, 1)
    assert.equal(result.entries[0]?.occurrences, 2)
  }
})

test('saved copy reports are scoped by both store and page, and source text is escaped', () => {
  const db = new Db(':memory:')
  try {
    saveCopyReport(db, 'store_one', 'page_one', { notes: ['first'] })
    saveCopyReport(db, 'store_one', 'page_one', { notes: ['latest'] })
    saveCopyReport(db, 'store_two', 'page_two', { notes: ['private'] })
    assert.deepEqual(readCopyReport(db, 'store_one', 'page_one')?.notes, ['latest'])
    assert.equal(readCopyReport(db, 'store_two', 'page_one'), null)
    const html = copyReportPage({ id: 'page_one', title: '<script>bad</script>' } as Page, { notes: [], capture: { mode: 'rendered', complete: false, viewports: [], issues: ['<img src=x onerror=bad>'] } })
    assert.doesNotMatch(html, /<script>|<img src=x/)
    assert.match(html, /Copy needs review/)
  } finally { db.handle.close() }
})
