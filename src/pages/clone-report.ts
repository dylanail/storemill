import type { ImageCopyEntry, ImageLocalizationReport } from './clone-media.ts'
import type { Db } from '../lib/db.ts'
import type { CaptureReport } from './clone-capture.ts'
import { recordAudit } from '../control/todos.ts'

export type SavedCopyReport = { images?: ImageLocalizationReport; capture?: CaptureReport; notes: string[] }
export function saveCopyReport(db: Db, storeId: string, pageId: string, report: SavedCopyReport): void {
  recordAudit(db, { storeId, actorType: 'system', action: 'copy_media_report', target: pageId, diff: report })
}
export function readCopyReport(db: Db, storeId: string, pageId: string): SavedCopyReport | null {
  const found = db.one<{ diff: string }>('SELECT diff FROM audit_log WHERE store_id = ? AND target = ? AND action = ? ORDER BY created_at DESC, rowid DESC LIMIT 1', storeId, pageId, 'copy_media_report')
  if (!found) return null
  try { return JSON.parse(found.diff) as SavedCopyReport } catch { return null }
}

/** Count unique source assets across documents, embeds, product variants and responsive candidates. */
export function mergeImageReports(reports: Array<ImageLocalizationReport | undefined>): ImageLocalizationReport {
  const assets = new Map<string, ImageCopyEntry>()
  for (const report of reports) for (const entry of report?.entries ?? []) {
    const key = entry.resolvedUrl || entry.url
    const old = assets.get(key)
    // A later successful download does not rewrite an earlier failed document.
    const priority = { failed: 5, skipped: 4, localized: 3, reused: 2, embedded: 1 }
    const preferred = old && priority[old.status] >= priority[entry.status] ? old : entry
    assets.set(key, { ...preferred, contexts: [...new Set([...(old?.contexts ?? []), ...entry.contexts])], occurrences: (old?.occurrences ?? 0) + entry.occurrences })
  }
  const entries = [...assets.values()]
  const count = (status: ImageCopyEntry['status']) => entries.filter(entry => entry.status === status).length
  return { discovered: entries.length, localized: count('localized'), reused: count('reused'), embedded: count('embedded'), failed: count('failed'), skipped: count('skipped'), complete: !entries.some(entry => ['failed', 'skipped'].includes(entry.status)), entries }
}
