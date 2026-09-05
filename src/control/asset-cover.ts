import type { Db } from '../lib/db.ts'
import { environment } from './stores.ts'
import { getProduct, listProducts } from '../domain/catalog.ts'
import { homePage } from '../pages/store.ts'
import type { BlockInstance } from '../pages/blocks.ts'
import { decodeMediaAttribute, srcsetUrls } from '../pages/clone-media.ts'

function imageUrl(value: unknown, source = ''): string {
  if (typeof value !== 'string') return ''
  const url = decodeMediaAttribute(value).trim()
  if (/^\/(?!\/)/.test(url) || /^https?:\/\//i.test(url) || /^data:image\/(?:png|jpe?g|webp|avif|gif);base64,/i.test(url)) return url
  if (source && url) {
    try { const absolute = new URL(url, source); return /^https?:$/.test(absolute.protocol) ? absolute.href : '' } catch {}
  }
  return ''
}

/** Rank the opening page's actual media, excluding navigation, badges and thumbnails. */
export function pageHeroImage(raw: string, source = ''): string {
  const html = raw.replace(/<!--[^]*?-->|<(script|style|template|noscript)\b[^>]*>[^]*?<\/\1\s*>/gi, '')
  const stack: Array<{ tag: string; context: string; hidden: boolean }> = []
  const candidates: Array<{ url: string; score: number }> = []
  let social = ''
  for (const match of html.matchAll(/<\/?([a-z][\w-]*)\b[^>]*>/gi)) {
    const token = match[0], tag = match[1]!.toLowerCase()
    if (token.startsWith('</')) {
      const index = stack.findLastIndex(node => node.tag === tag)
      if (index >= 0) stack.length = index
      continue
    }
    const attrs: Record<string, string> = {}
    for (const attr of token.matchAll(/\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[attr[1]!.toLowerCase()] = decodeMediaAttribute(attr[2] ?? attr[3] ?? attr[4] ?? '')
    if (tag === 'meta' && /^(?:og:image|twitter:image)$/i.test(attrs.property || attrs.name || '')) social ||= imageUrl(attrs.content, source)
    const context = [tag, attrs.id, attrs.class, attrs.role, attrs.alt, ...stack.map(node => node.context)].filter(Boolean).join(' ')
    const hidden = stack.some(node => node.hidden) || /\shidden(?:\s|=|>)/i.test(token) || attrs['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style || '')
    const excluded = /(?:header|footer|navigation|(?:^|\s)nav(?:\s|$)|logo|icon|badge|avatar|rating|payment|thumbnail|thumbImage|cart-drawer|menu-drawer)/i.test(context)
    const hero = /(?:hero|banner|mainImage|product[-_ ]?(?:gallery|media)|product__media)/i.test(context)
    const main = /(?:^|\s)main(?:\s|$)/i.test(context)
    const width = parseFloat(attrs.width || ''), height = parseFloat(attrs.height || '')
    if (!hidden && !excluded && !(width > 0 && width < 120) && !(height > 0 && height < 90)) {
      let url = ''
      if (tag === 'img') {
        url = imageUrl(attrs.src, source)
        if (!url || /^data:/.test(url)) url = imageUrl(attrs['data-src'] || attrs['data-lazy-src'], source) || url
        if (!url) url = imageUrl(srcsetUrls(attrs.srcset || attrs['data-srcset'] || '').at(-1)?.value, source)
      } else if (hero) {
        url = imageUrl(/(?:background(?:-image)?)\s*:[^;]*?url\(\s*["']?([^"')]+)/i.exec(attrs.style || '')?.[1], source)
      }
      if (url && (hero || !/\.svg(?:[?#]|$)/i.test(url))) candidates.push({ url, score: (hero ? 1000 : 0) + (main ? 100 : 0) + (attrs.fetchpriority === 'high' ? 50 : 0) - candidates.length })
    }
    if (!/^(?:area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag) && !/\/\s*>$/.test(token)) stack.push({ tag, context: [tag, attrs.id, attrs.class, attrs.role].filter(Boolean).join(' '), hidden })
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.url || social
}

function blockHeroImage(blocks: BlockInstance[], db: Db, storeId: string): string {
  for (const block of blocks) {
    const settings = block.settings
    if (/header|footer|announcement|logo/.test(block.type)) continue
    const explicit = imageUrl(settings.image || settings.src || settings.backgroundImage)
    if (explicit) return explicit
    if (typeof settings.html === 'string') {
      const image = pageHeroImage(settings.html)
      if (image) return image
    }
    if (typeof settings.productId === 'string') {
      const image = getProduct(db, storeId, settings.productId)?.heroImage
      if (image) return imageUrl(image)
    }
    if (typeof settings.images === 'string') {
      const image = imageUrl(settings.images.split('\n')[0])
      if (image) return image
    }

  }
  return ''
}

/** Asset cards follow saved home edits, never the media library's upload order. */
export function assetHeroImage(db: Db, storeId: string): string {
  const home = homePage(db, storeId, { preview: true })
  if (home) {
    const image = home.mode === 'html' ? pageHeroImage(home.rawHtml, home.sourceUrl) : blockHeroImage(home.blocks, db, storeId)
    if (image) return image
    if (home.productId) {
      const product = getProduct(db, storeId, home.productId)
      if (product?.heroImage) return imageUrl(product.heroImage)
    }
    if (home.seo.image) return imageUrl(home.seo.image)
  }
  const theme = environment(db, storeId, 'draft').theme
  return imageUrl(theme.heroImage) || imageUrl(listProducts(db, storeId, { status: 'published', limit: 1 })[0]?.heroImage)
}
