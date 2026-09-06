import { escapeHtml as e } from '../lib/http.ts'
import type { SavedCopyReport } from '../pages/clone-report.ts'
import type { Page } from '../pages/store.ts'

export function copyReportPage(page: Page, report: SavedCopyReport | null): string {
  const site=report?.site
  const siteReport=site?`<section class="card"><h2>${site.complete?'Site clone complete':'Site clone — review needed'}</h2><p>${site.copied} of ${site.discovered} discovered pages copied · ${site.commerce?.products||0} products · ${site.commerce?.linkedPages||0} pages connected to products · ${site.commerce?.bundles||0} bundles · ${site.commerce?.bumps||0} order bumps · ${site.commerce?.upsells||0} upsells · ${site.commerce?.downsells||0} downsells.</p><p>Products and pages are saved as drafts. Review offers and connect this asset’s payment account before publishing.</p>
  ${[...site.failed,...(site.commerce?.issues||[]),...(site.interactionIssues||[]),...site.remaining.map(url=>({url,reason:'Page limit reached'})),...site.externalSteps.map(url=>({url,reason:'External checkout or payment session needs a connected account'}))].map(issue=>`<p style="overflow-wrap:anywhere"><strong>${e(issue.reason)}</strong><br>${e(issue.url)}</p>`).join('')}
  <div style="overflow:auto"><table><thead><tr><th>Copied page</th><th>Role</th><th>Product</th><th>Source</th></tr></thead><tbody>${(report?.pages||[]).map(p=>`<tr><td><a href="/admin/pages/${e(p.id)}/edit">${e(p.title)}</a></td><td>${e(p.role)}</td><td>${p.productId?`<a href="/admin/products/${e(p.productId)}">View product</a>`:'—'}</td><td style="max-width:360px;overflow-wrap:anywhere">${e(p.source)}</td></tr>`).join('')}</tbody></table></div></section>`:''
  const images = report?.images
  const entries = [...(images?.entries ?? [])].sort((a, b) => Number(['failed', 'skipped'].includes(b.status)) - Number(['failed', 'skipped'].includes(a.status)))
  return `<div class="page-head"><div><h1>Copy report</h1><p>${e(page.title)}</p></div><a class="button" href="/admin/pages/${e(page.id)}/edit">Back to editor</a></div>
  ${siteReport}<section class="card"><h2>${!report ? 'This copy predates image verification' : images?.complete && report.capture?.complete ? 'All discovered images saved' : 'Copy needs review'}</h2>
  <p>${images ? `${images.discovered} unique image references: ${images.localized + images.reused} saved, ${images.embedded} embedded, ${images.failed} failed, ${images.skipped} skipped.` : 'No image inventory is available for this saved page.'}</p>
  <p>${report?.capture?.mode === 'rendered' ? 'Source rendered at desktop, tablet and mobile widths.' : 'Dynamic source content has not been verified.'} This inventory checks discovered assets; visual parity still requires reviewing the page at each size.</p>
  ${(report?.capture?.issues ?? []).map(issue => `<p>${e(issue)}</p>`).join('')}
  ${report?.capture?.excludedWidgets?.length ? '<p>Source payment widgets are replaced by this site’s connected checkout.</p>' : ''}
  ${report?.notes.length ? `<details><summary>Copy notes</summary><ul>${[...new Set(report.notes)].map(note => `<li style="overflow-wrap:anywhere">${e(note)}</li>`).join('')}</ul></details>` : ''}</section>
  ${entries.length ? `<div style="overflow:auto"><table><thead><tr><th>Status</th><th>Source image</th><th>Details</th></tr></thead><tbody>${entries.map(entry => `<tr><td>${e(entry.status)}</td><td style="max-width:600px;overflow-wrap:anywhere">${e(entry.resolvedUrl || entry.url)}</td><td>${e(entry.reason || entry.contexts.join(', '))}</td></tr>`).join('')}</tbody></table></div>` : ''}`
}
