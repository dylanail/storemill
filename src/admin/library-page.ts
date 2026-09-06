import { escapeHtml as e } from '../lib/http.ts'
import type { SavedPageTemplate } from '../pages/library.ts'
import type { BlockPreset } from '../pages/presets.ts'
import { PAGE_ROLES, type PageRole } from '../pages/store.ts'

export function roleOptions(selected: PageRole = 'page'): string {
  return Object.entries(PAGE_ROLES).map(([value, label]) => `<option value="${value}" ${value === selected ? 'selected' : ''}>${e(label)}</option>`).join('')
}

export function templateLibraryPage(input: { templates: SavedPageTemplate[]; blocks: BlockPreset[]; products: Array<{ id: string; title: string }>; query?: string; flash?: string }): string {
  const q = (input.query ?? '').trim().toLowerCase()
  const templates = input.templates.filter(item => !q || `${item.name} ${PAGE_ROLES[item.role]} ${item.snapshot.sourceUrl}`.toLowerCase().includes(q))
  const blocks = input.blocks.filter(item => !q || `${item.name} ${item.type}`.toLowerCase().includes(q))
  const productOptions = '<option value="">Match this site’s catalog automatically</option>' + input.products.map(product => `<option value="${e(product.id)}">${e(product.title)}</option>`).join('')
  return `<style>.template-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:16px}.template-card{display:flex;flex-direction:column;gap:12px}.template-card h3{margin:0}.template-card .muted{overflow-wrap:anywhere;font-size:12px}.template-card form{margin:0}.template-card .field{margin-bottom:10px}.template-card .btn,.template-import .btn{min-height:40px}.template-label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}.template-search{display:flex;gap:8px;margin:20px 0}.template-search input{min-width:0;flex:1}.template-import{margin-bottom:22px}.template-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.template-section{margin:28px 0 14px}.template-section h2{margin:0}.template-section p{color:var(--muted);font-size:13px}.template-empty{padding:24px;border:1px dashed var(--line);border-radius:10px;color:var(--muted)}</style>
    ${input.flash ? `<div class="notice">${e(input.flash)}</div>` : ''}
    <div class="head"><div><div class="eyebrow">Reusable designs</div><h1 class="serif">Template library</h1><p class="muted">Pages and blocks saved here are available across your sites. Using a template creates a new draft.</p></div><a class="btn" href="/admin/pages">Open page editor</a></div>
    <form class="card template-import" method="post" action="/admin/templates/import"><h2>Save a page from a link</h2><div class="grid3">
      <div class="field"><label for="template-url">Page URL</label><input id="template-url" name="url" type="url" placeholder="https://example.com/page" required></div>
      <div class="field"><label for="template-name">Template name</label><input id="template-name" name="name" placeholder="Optional · use the page title"></div>
      <div class="field"><label for="template-role">Page type</label><select id="template-role" name="role">${roleOptions()}</select></div></div>
      <button class="btn primary" type="submit">Copy page to library</button></form>
    <form class="template-search" method="get" action="/admin/templates"><input name="q" type="search" aria-label="Find a template" value="${e(input.query ?? '')}" placeholder="Find a page or block…"><button class="btn">Search</button></form>
    <div class="template-section"><h2>Pages <span class="muted">${templates.length}</span></h2><p>Whole page layouts, including their responsive styles.</p></div>
    <div class="template-grid">${templates.map(item => `<article class="card template-card"><div class="template-label">${e(PAGE_ROLES[item.role])} · ${item.snapshot.mode === 'html' ? 'Copied design' : 'Blocks'}</div><h3>${e(item.name)}</h3>${item.snapshot.sourceUrl ? `<a class="muted" href="${e(item.snapshot.sourceUrl)}" target="_blank" rel="noopener noreferrer">${e(item.snapshot.sourceUrl)}</a>` : '<span class="muted">Saved from your editor</span>'}<a class="btn" href="/admin/templates/${item.id}/preview" target="_blank" rel="noopener">Preview design</a>
      <form method="post" action="/admin/templates/${item.id}/use"><label class="field">New page title<input name="title" value="${e(item.name)}" required></label><label class="field">Page type<select name="role">${roleOptions(item.role)}</select></label><label class="field">Use with product<select name="productId">${productOptions}</select></label><button class="btn primary" type="submit">Use on this site</button></form>
      <form method="post" action="/admin/templates/${item.id}/delete"><button class="btn" type="submit">Remove from library</button></form></article>`).join('')}</div>
    ${templates.length ? '' : '<div class="template-empty">Save a URL above, or choose “Save page to library” in the editor’s Page settings.</div>'}
    <div class="template-section"><h2>Blocks &amp; sections <span class="muted">${blocks.length}</span></h2><p>Select a section in the editor and choose Save section. Saved blocks also appear under Add in every site’s editor.</p></div>
    <div class="template-grid">${blocks.map(item => `<article class="card template-card"><div class="template-label">${e(item.type === 'custom-html' ? 'Copied section' : item.type)}</div><h3>${e(item.name)}</h3><form method="post" action="/admin/templates/blocks/${item.id}/use"><label class="field">Use with product<select name="productId">${productOptions}</select></label><button class="btn primary">Open in a new page</button></form></article>`).join('')}</div>${blocks.length ? '' : '<div class="template-empty">Your saved blocks will appear here.</div>'}`
}
