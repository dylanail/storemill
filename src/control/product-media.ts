import { createHash } from 'node:crypto'
import type { Db } from '../lib/db.ts'
import type { Product, Media } from '../domain/types.ts'
import { getProduct, updateProduct } from '../domain/catalog.ts'
import { listStoreMedia } from './media.ts'

export const productMediaRevision = (product: Product) => createHash('sha256').update(JSON.stringify([product.heroImage, product.media])).digest('hex')

export function updateProductMedia(db: Db, storeId: string, productId: string, input: { revision?: unknown; media?: unknown }) {
  const product = getProduct(db, storeId, productId)
  if (!product) throw new Error('Choose a product from this site')
  if (input.revision !== productMediaRevision(product)) throw new Error('Product media changed in another tab. Reload product media before saving; your gallery edits are still here.')
  if (!Array.isArray(input.media) || input.media.length > 100) throw new Error('Use up to 100 slides')
  const available = new Set(listStoreMedia(db, storeId).map(item => item.url))
  const media: Media[] = input.media.map(item => {
    if (!item || typeof item.url !== 'string' || !available.has(item.url) || (/^\/_uploads\//.test(item.url) && !item.url.startsWith(`/_uploads/${storeId}/`))) throw new Error('Choose or upload media from this asset')
    if (item.poster && (typeof item.poster !== 'string' || !available.has(item.poster) || (/^\/_uploads\//.test(item.poster) && !item.poster.startsWith(`/_uploads/${storeId}/`)))) throw new Error('Choose a poster from this asset')
    return { url: item.url, alt: String(item.alt ?? '').slice(0, 500), kind: item.kind === 'video' || /\.(mp4|webm|mov)([?#]|$)/i.test(item.url) ? 'video' : 'image', ...(item.poster ? { poster: item.poster } : {}) }
  })
  return updateProduct(db, storeId, productId, { media, heroImage: media.find(item => item.kind !== 'video')?.url || '' })
}
