import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { getProduct } from '../domain/catalog.ts'
import { getStore } from '../control/stores.ts'
import { createPage, newBlock, pageRole, type Page, type PageRole } from './store.ts'
import type { BlockInstance } from './blocks.ts'
import { decodeLink } from './site-copy.ts'
import { mapMediaDocument } from './clone-media.ts'

export type TemplateSnapshot = Pick<Page, 'title' | 'kind' | 'role' | 'mode' | 'blocks' | 'rawHtml' | 'headHtml' | 'seo' | 'sourceUrl' | 'productId'> & { sourceStoreSlug?: string }
export type SavedPageTemplate = { id: string; ownerId: string; sourceStoreId: string; name: string; role: PageRole; snapshot: TemplateSnapshot; createdAt: string; updatedAt: string }

function fromRow(row: Row): SavedPageTemplate {
  return { id: String(row.id), ownerId: String(row.owner_id), sourceStoreId: String(row.source_store_id ?? ''), name: String(row.name), role: pageRole(row.role), snapshot: json(row.snapshot, {} as TemplateSnapshot), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
}

export function listPageTemplates(db: Db, ownerId: string): SavedPageTemplate[] {
  return db.all('SELECT * FROM page_templates WHERE owner_id = ? ORDER BY updated_at DESC, id DESC', ownerId).map(fromRow)
}

export function getPageTemplate(db: Db, ownerId: string, templateId: string): SavedPageTemplate | null {
  const row = db.one('SELECT * FROM page_templates WHERE id = ? AND owner_id = ?', templateId, ownerId)
  return row ? fromRow(row) : null
}

export function savePageTemplate(db: Db, ownerId: string, sourceStoreId: string, name: string, input: TemplateSnapshot): SavedPageTemplate {
  const clean = name.trim().replace(/\s+/g, ' ').slice(0, 100)
  if (clean.length < 2) throw new Error('Give the template a name of at least two characters')
  const role = pageRole(input.role)
  if (input.mode !== 'html' && input.mode !== 'blocks') throw new Error('Choose HTML or blocks')
  if (!Array.isArray(input.blocks) || input.blocks.some(block => !block || typeof block.type !== 'string' || !block.settings || typeof block.settings !== 'object')) throw new Error('Invalid template blocks')
  if (JSON.stringify(input).length > 4_000_000) throw new Error('This page is too large for the template library')
  const templateId = id('tpl'), timestamp = now()
  const snapshot = { ...input, sourceStoreSlug: getStore(db, sourceStoreId)?.slug }
  db.insert('page_templates', { id: templateId, owner_id: ownerId, source_store_id: sourceStoreId, name: clean, role, snapshot, created_at: timestamp, updated_at: timestamp })
  return getPageTemplate(db, ownerId, templateId) as SavedPageTemplate
}

export function deletePageTemplate(db: Db, ownerId: string, templateId: string): boolean {
  return Number(db.run('DELETE FROM page_templates WHERE id = ? AND owner_id = ?', templateId, ownerId).changes) > 0
}

/** Product connections belong to the destination catalog, never the source store. */
export function templateBlocks(blocks: BlockInstance[], productId = '', sourceSlug = ''): BlockInstance[] {
  const rewrite = (value: unknown, key = ''): unknown => {
    if (key === 'productId') return productId
    if (key === 'variantId') return ''
    if (key === 'html' && typeof value === 'string') return templateHtml(value, productId, sourceSlug)
    if (key === 'productIds') return productId ? [productId] : []
    if (Array.isArray(value)) return value.map(entry => rewrite(entry))
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rewrite(v, k)]))
    if (typeof value === 'string') return templateDestination(value, sourceSlug)
    return value
  }
  return blocks.map(block => newBlock(block.type, rewrite(block.settings) as Record<string, unknown>))
}

export function templateHtml(rawHtml: string, productId = '', sourceSlug = ''): string {
  const ids = new Set<string>()
  let html = rawHtml.replace(/(<script\b(?=[^>]*\bdata-pb-document\b)[^>]*>)([\s\S]*?)(<\/script>)/gi, (_match, open: string, raw: string, close: string) => {
    let data: { nodes?: Record<string, { binding?: { productId?: string } }> }
    try { data = JSON.parse(raw) } catch { return '' }
    for (const node of Object.values(data.nodes ?? {})) {
      if (node.binding?.productId) ids.add(node.binding.productId)
      if (node.binding) { if (productId) node.binding.productId = productId; else delete node.binding }
    }
    return open + JSON.stringify(data).replace(/</g, '\\u003c') + close
  })
  html = html.replace(/\s(data-pb-product(?:-id)?|data-copy-product-id)=(['"])(.*?)\2/gi, (_match, attribute: string, _quote: string, previous: string) => {
    ids.add(previous)
    return productId ? ` ${attribute}="${productId}"` : ''
  })
  // A variant identifier is meaningful only in its original catalog. The
  // destination runtime requires an exact variant selection before purchase.
  html = html.replace(/\sdata-copy-variant-id=(['"])(.*?)\1/gi, '')
  html = mapMediaDocument(html, tag => tag.replace(/\sdata-copy-bundle-template(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?/gi, '').replace(/\sdata-copy-bundle=(['"])(.*?)\1/gi, ' data-copy-bundle="" data-copy-bundle-template=""'))
  html = html.replace(/(<script\b(?=[^>]*\bdata-pb-bindings\b)[^>]*>)([\s\S]*?)(<\/script>)/gi, (_match, open: string, script: string, close: string) => {
    if (!productId) return ''
    for (const previous of ids) script = script.replaceAll(JSON.stringify(previous), JSON.stringify(productId))
    return open + script + close
  })
  // Only the known source asset loses its deployment prefix. Other stores,
  // external destinations, image URLs, CSS and script bodies retain their URLs.
  return html.replace(/<(script|style)\b[\s\S]*?<\/\1>|<(?:a|area|form|button|input|div|span)\b[^>]*>/gi, (tag) => {
    if (/^<(?:script|style)\b/i.test(tag)) return tag
    return tag.replace(/(\s(?:href|action|formaction|data-copy-href|data-href|data-url|data-next-url|data-next-step|data-checkout-url)\s*=\s*)(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (attribute: string, prefix: string, double: string | undefined, single: string | undefined, bare: string | undefined) => {
      const value = double ?? single ?? bare ?? '', destination = templateDestination(value, sourceSlug)
      if (destination === value) return attribute
      const quote = single === undefined ? '"' : "'"
      const escaped = destination.replace(/&/g, '&amp;').replace(quote === "'" ? /'/g : /"/g, quote === "'" ? '&#39;' : '&quot;')
      return `${prefix}${quote}${escaped}${quote}`
    })
  })
}

function templateDestination(raw: string, sourceSlug: string): string {
  if (!sourceSlug) return raw
  const value = decodeLink(raw)
  if (!/^(?:https?:\/\/|\/)/i.test(value)) return raw
  try {
    const url = new URL(value, 'https://template.invalid')
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return raw
    const parts = url.pathname.split('/')
    if (!['s', 'preview'].includes(parts[1] ?? '') || decodeURIComponent(parts[2] ?? '') !== sourceSlug) return raw
    return `/${parts.slice(3).join('/')}${url.search}${url.hash}`
  } catch { return raw }
}

export function usePageTemplate(db: Db, ownerId: string, storeId: string, templateId: string, input: { title?: string; role?: PageRole; productId?: string } = {}): Page {
  const template = getPageTemplate(db, ownerId, templateId)
  if (!template) throw new Error('No such page template')
  const productId = input.productId || ''
  if (productId && !getProduct(db, storeId, productId)) throw new Error('Choose a product from this site')
  const snapshot = template.snapshot
  const sourceSlug = snapshot.sourceStoreSlug || (template.sourceStoreId ? getStore(db, template.sourceStoreId)?.slug ?? '' : '')
  const role = pageRole(input.role ?? template.role)
  return createPage(db, storeId, {
    ...snapshot, title: input.title?.trim() || template.name, role,
    kind: role === 'checkout' ? 'checkout' : snapshot.kind,
    productId, blocks: templateBlocks(snapshot.blocks, productId, sourceSlug),
    rawHtml: templateHtml(snapshot.rawHtml, productId, sourceSlug), headHtml: templateHtml(snapshot.headHtml, productId, sourceSlug), status: 'draft',
  })
}
