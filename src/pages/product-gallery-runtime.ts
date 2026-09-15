import { readFileSync } from 'node:fs'
import { mapMediaDocument, decodeMediaAttribute } from './clone-media.ts'
import { escapeHtml } from '../lib/http.ts'
import type { Media } from '../domain/types.ts'
const originalMediaSource = readFileSync(new URL('./original-media-source.js', import.meta.url), 'utf8').replace('export function', 'function')
export const productGallerySource = originalMediaSource + '\n' + readFileSync(new URL('./product-gallery.js', import.meta.url), 'utf8').replace('export function', 'function')
export const productGalleryRuntime = `${productGallerySource}\nproductGalleries(document).start(id => {const prefix=/^\\/(preview|s)\\//.test(location.pathname)?location.pathname.split('/').slice(0,3).join('/'):'';return fetch(prefix+'/api/page-products/'+encodeURIComponent(id),{cache:'no-store'}).then(r=>r.ok?r.json():null);});`


/** Refresh data without serializing or restyling the imported source document. */
export function mapProductGalleries(html: string, change: (gallery: {mode:string;productId?:string;items:Media[];[key:string]:unknown}) => unknown) {
  return mapMediaDocument(html, tag => tag.replace(/\sdata-pb-gallery=(['"])(.*?)\1/gi, (attribute, _quote:string, raw:string) => {
    try { return ` data-pb-gallery="${escapeHtml(JSON.stringify(change(JSON.parse(decodeMediaAttribute(raw)))))}"` } catch { return attribute }
  }))
}
