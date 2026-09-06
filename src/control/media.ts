import { id } from '../lib/ids.ts'
import { json, type Db } from '../lib/db.ts'
import { listUploads } from '../lib/uploads.ts'
import { assetHeroImage } from './asset-cover.ts'
import { htmlMedia } from './media-references.ts'

export type StoreMedia = {
  url: string
  category: 'logo' | 'media'
  kind: 'image' | 'video' | 'embed'
  source: 'Brand' | 'Product' | 'Variant' | 'Collection' | 'Page' | 'Review' | 'Creative' | 'Upload'
  label: string
  uploadedAt: string | null
  bytes: number | null
}

const explicitImage = /(?:\.(?:avif|gif|jpe?g|png|svg|webp|mp4|webm|mov)(?:[?#]|$)|\/_uploads\/|\/_media\/)/i
export function mediaKind(url: string): StoreMedia['kind'] {
  if (/\.(?:mp4|webm|mov)(?:[?#]|$)/i.test(url)) return 'video'
  if (/(?:youtube(?:-nocookie)?\.com\/embed|youtu\.be\/|player\.vimeo\.com\/video)/i.test(url)) return 'embed'
  return 'image'
}

/**
 * A store's image library is a view over the source of truth, not another
 * gallery a caller has to remember to update. It includes owned files plus
 * images referenced by commerce records, block pages and imported HTML.
 */
export function listStoreMedia(db: Db, storeId: string): StoreMedia[] {
  const found = new Map<string, StoreMedia>()
  const add = (value: unknown, source: StoreMedia['source'], label: string, options: { uploadedAt?: string | null; bytes?: number | null; trusted?: boolean; kind?: StoreMedia['kind']; category?: StoreMedia['category'] } = {}) => {
    if (typeof value !== 'string') return
    const url = value.trim()
    if (!url || url.startsWith('data:') || url.startsWith('<svg')) return
    if (!options.trusted && !explicitImage.test(url)) return
    if (!/^(?:https?:\/\/|\/)/i.test(url)) return
    const current = found.get(url)
    if (current) {
      if (options.category) current.category = options.category
      if (options.kind) current.kind = options.kind
      if (!current.uploadedAt && options.uploadedAt) current.uploadedAt = options.uploadedAt
      if (current.bytes === null && options.bytes !== undefined) current.bytes = options.bytes
      return
    }
    found.set(url, { url, category: options.category ?? 'media', kind: options.kind ?? mediaKind(url), source, label, uploadedAt: options.uploadedAt ?? null, bytes: options.bytes ?? null })
  }
  const walk = (value: unknown, source: StoreMedia['source'], label: string, key = '') => {
    if (typeof value === 'string') {
      if (/image|photo|video|media|hero|logo|poster|background|src|url/i.test(key) || explicitImage.test(value)) add(value, source, label, { ...(/logo/i.test(key)?{category:'logo' as const}:{}), trusted: /image|photo|video|media|hero|logo|poster|background|src/i.test(key), ...(/video/i.test(key) ? { kind: mediaKind(value) === 'embed' ? 'embed' : 'video' } : {}) })
      return
    }
    if (Array.isArray(value)) value.forEach((entry) => walk(entry, source, label, key))
    else if (value && typeof value === 'object') Object.entries(value as Record<string, unknown>).forEach(([childKey, entry]) => walk(entry, source, label, childKey))
  }

  const store = db.one<{ brand: string; reference_image: string }>('SELECT brand, reference_image FROM stores WHERE id = ?', storeId)
  if (store) {
    add(store.reference_image, 'Brand', 'Reference image', { trusted: true })
    const brand = json<Record<string, unknown>>(store.brand, {})
    add(brand.logoSvg, 'Brand', 'Logo', { trusted: true, category:'logo' })
    walk(brand, 'Brand', 'Brand kit')
  }

  for (const product of db.all<{ id: string; title: string; hero_image: string; media: string; metadata: string; updated_at: string }>('SELECT id, title, hero_image, media, metadata, updated_at FROM products WHERE store_id = ?', storeId)) {
    add(product.hero_image, 'Product', `${product.title} hero`, { trusted: true, uploadedAt: product.updated_at })
    walk(json(product.media, []), 'Product', product.title)
    walk(json(product.metadata, {}), 'Product', product.title)
  }
  for (const variant of db.all<{ title: string; image: string }>('SELECT title, image FROM variants WHERE store_id = ?', storeId)) add(variant.image, 'Variant', variant.title, { trusted: true })
  for (const collection of db.all<{ title: string; image: string }>('SELECT title, image FROM collections WHERE store_id = ?', storeId)) add(collection.image, 'Collection', collection.title, { trusted: true })
  for (const page of db.all<{ title: string; blocks: string; raw_html: string; seo: string; updated_at: string }>('SELECT title, blocks, raw_html, seo, updated_at FROM pages WHERE store_id = ?', storeId)) {
    walk(json(page.blocks, []), 'Page', page.title)
    walk(json(page.seo, {}), 'Page', page.title)
    for (const media of htmlMedia(page.raw_html)) add(media.url, 'Page', page.title, { trusted: true, kind: media.kind, uploadedAt: page.updated_at })
  }
  for (const block of db.all<{ name: string; fields: string; template: string; css: string }>('SELECT name, fields, template, css FROM custom_blocks WHERE store_id = ?', storeId)) {
    walk(json(block.fields, []), 'Page', block.name)
    for (const media of htmlMedia(block.template + '<style>' + block.css + '</style>')) add(media.url, 'Page', block.name, { trusted: true, kind: media.kind })
  }
  for (const review of db.all<{ author: string; media: string }>('SELECT author, media FROM reviews WHERE store_id = ?', storeId)) walk(json(review.media, []), 'Review', review.author || 'Customer photo')
  for (const creative of db.all<{ title: string; body: string }>('SELECT title, body FROM creative_queue WHERE store_id = ?', storeId)) walk(json(creative.body, {}), 'Creative', creative.title || 'Creative')
  for (const env of db.all<{ theme: string; brand: string }>("SELECT theme, brand FROM store_environments WHERE store_id = ? AND kind = 'draft'", storeId)) {
    walk(json(env.theme, {}), 'Brand', 'Draft theme'); walk(json(env.brand, {}), 'Brand', 'Draft brand')
  }

  for (const upload of listUploads(storeId)) add(upload.url, 'Upload', upload.url.split('/').pop() ?? 'Upload', { trusted: true, uploadedAt: upload.uploadedAt, bytes: upload.bytes })

  for(const item of db.all<{url:string;category:StoreMedia['category'];label:string}>('SELECT url,category,label FROM media_labels WHERE store_id=?',storeId)){const media=found.get(item.url);if(media){media.category=item.category;if(item.label)media.label=item.label}}

  return [...found.values()].sort((a, b) => {
    const date = (b.uploadedAt ?? '').localeCompare(a.uploadedAt ?? '')
    return date || a.source.localeCompare(b.source) || a.label.localeCompare(b.label)
  })
}

export function storeCoverImage(db: Db, storeId: string): string {
  return assetHeroImage(db, storeId)
}

/** Classification never changes the image itself or its existing placements. */
export function setMediaDetails(db:Db,storeId:string,url:string,category:'logo'|'media',label='') {
  const media=listStoreMedia(db,storeId).find(item=>item.url===url)
  if(!media)throw new Error('Choose media from this asset')
  if(!['logo','media'].includes(category)||category==='logo'&&media.kind!=='image')throw new Error('Logo assets must be images')
  db.run('INSERT INTO media_labels (id,store_id,url,category,label) VALUES (?,?,?,?,?) ON CONFLICT(store_id,url) DO UPDATE SET category=excluded.category,label=excluded.label',id('media'),storeId,url,category,String(label).trim().slice(0,100))
  return {...media,category,label:label.trim().slice(0,100)||media.label}
}
