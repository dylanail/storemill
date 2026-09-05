import { escapeHtml as e } from '../lib/http.ts'
import type { SavedCopyReport } from '../pages/clone-report.ts'
import type { Page } from '../pages/store.ts'

export function copyReportPage(page: Page, report: SavedCopyReport | null): string {
  const images = report?.images
  const entries = [...(images?.entries ?? [])].sort((a, b) => Number(['failed', 'skipped'].includes(b.status)) - Number(['failed', 'skipped'].includes(a.status)))
  return `<div class="page-head"><div><h1>Copy report</h1><p>${e(page.title)}</p></div><a class="button" href="/admin/pages/${e(page.id)}/edit">Back to editor</a></div>
  <section class="card"><h2>${!report ? 'This copy predates image verification' : images?.complete && report.capture?.complete ? 'All discovered images saved' : 'Copy needs review'}</h2>
  <p>${images ? `${images.discovered} unique image references: ${images.localized + images.reused} saved, ${images.embedded} embedded, ${images.failed} failed, ${images.skipped} skipped.` : 'No image inventory is available for this saved page.'}</p>
  <p>${report?.capture?.mode === 'rendered' ? 'Source rendered at desktop, tablet and mobile widths.' : 'Dynamic source content has not been verified.'} This inventory checks discovered assets; visual parity still requires reviewing the page at each size.</p>
  ${(report?.capture?.issues ?? []).map(issue => `<p>${e(issue)}</p>`).join('')}
  ${report?.capture?.excludedWidgets?.length ? '<p>Source payment widgets are replaced by this site’s connected checkout.</p>' : ''}
  ${report?.notes.length ? `<details><summary>Copy notes</summary><ul>${[...new Set(report.notes)].map(note => `<li style="overflow-wrap:anywhere">${e(note)}</li>`).join('')}</ul></details>` : ''}</section>
  ${entries.length ? `<div style="overflow:auto"><table><thead><tr><th>Status</th><th>Source image</th><th>Details</th></tr></thead><tbody>${entries.map(entry => `<tr><td>${e(entry.status)}</td><td style="max-width:600px;overflow-wrap:anywhere">${e(entry.resolvedUrl || entry.url)}</td><td>${e(entry.reason || entry.contexts.join(', '))}</td></tr>`).join('')}</tbody></table></div>` : ''}`
}
