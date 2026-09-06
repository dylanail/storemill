import { parse } from 'parse5'
import type { ImportedProduct } from '../domain/ops.ts'
import type { Product } from '../domain/types.ts'
import { minorDigits } from '../lib/money.ts'
import { assignedJson } from './source-data.ts'
import { mapMediaDocument, decodeMediaAttribute } from './clone-media.ts'

export type SourceProduct = { key: string; product: ImportedProduct; purpose: 'primary'|'bump'|'gift'; sourceIds: string[]; defaultSourceId?: string }
export type SourceCommerce = { products: SourceProduct[]; issues: string[]; giftRules: Record<string,string[]>; platform?: string; stepType?: number; funnelId?: string; stepOrder?: number }
const plain = (value: unknown) => decodeMediaAttribute(String(value ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
const amount = (value: unknown, currency: string) => {
  if (typeof value !== 'number' && typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(String(value))) return null
  const result = Math.round(Number(value) * 10 ** minorDigits(currency))
  return Number.isSafeInteger(result) && result >= 0 ? result : null
}
const image = (value: unknown, source: string) => { try { const url = new URL(String(value || ''), source); return value && /^https?:$/.test(url.protocol) ? url.href : '' } catch { return '' } }

/** Extract authoritative public prices before scripts disappear, without executing merchant code. */
export function readSourceCommerce(html: string, source: string, fallbackCurrency: string): SourceCommerce {
  const out: SourceCommerce = { products: [], issues: [], giftRules: {} }
  const funnel = assignedJson(html, 'FUNNEL'), step = assignedJson(html, 'STEP'), sourceProducts = assignedJson(html, 'PRODUCTS')
  if (funnel?.id && step?.id) {
    out.platform = 'funnelish'; out.funnelId = String(funnel.id); out.stepType = Number(step.type); out.stepOrder=Number(step.order_index||0)
    if (!Array.isArray(sourceProducts)) return out
    const currency = /^[A-Z]{3}$/.test(funnel.currency_code) ? funnel.currency_code : fallbackCurrency
    const entries = sourceProducts.filter((entry: any) => entry && (typeof entry.id === 'number' || typeof entry.id === 'string') && typeof entry.name === 'string')
    const primary: Array<{entry:any;variant:ImportedProduct['variants'][number]}> = []
    for (const entry of entries) {
      if (entry.isSub) { out.issues.push(`Recurring offer ${plain(entry.name)} needs a recurring payment integration; it was not converted to a one-time charge.`); continue }
      let matrix; try { matrix = typeof entry.variants === 'string' ? JSON.parse(entry.variants) : entry.variants } catch { matrix = null }
      if (matrix?.variants?.length) { out.issues.push(`Variant matrix for ${plain(entry.name)} needs review.`); continue }
      const cents = amount(entry.price, currency)
      if (cents === null) { out.issues.push(`No explicit price for ${plain(entry.name)}.`); continue }
      const purpose = entry.isOb ? 'bump' : cents === 0 ? 'gift' : 'primary'
      const variants: ImportedProduct['variants'] = []
      const options = Array.isArray(entry.options) && entry.options.length ? entry.options : [{ id: entry.id, title: 'Default' }]
      const struck = /<(?:s|del|strike)\b[^>]*>([\s\S]*?)<\/(?:s|del|strike)>/i.exec(String(entry.displayPrice || ''))?.[1]
      const compareAt = struck ? amount(plain(struck).replace(/[^\d.]/g, ''), currency) : null
      for (const option of options) {
        const price = option.price == null ? cents : amount(option.price, currency)
        if (price === null) { out.issues.push(`Unclear option price for ${plain(entry.name)}.`); continue }
        variants.push({ title: plain(entry.name) + (options.length > 1 ? ' — ' + plain(option.title) : ''), priceCents: price, sourceId: options.length > 1 ? String(option.id) : String(entry.id), sourceAliases: [String(entry.id), String(option.id)], ...(compareAt !== null && compareAt > price ? {compareAtCents:compareAt} : {}), image: image(option.imageUrl || entry.imageUrl, source), ...(option.soldout ? {inventory:0} : {}) })
      }
      if (!variants.length) continue
      if (purpose === 'primary') { for (const variant of variants) primary.push({entry,variant}); continue }
      out.products.push({ key:`funnelish:${funnel.id}:${entry.id}`, purpose, sourceIds:[String(entry.id)], product:{title:plain(entry.name),description:'',images:[image(entry.imageUrl,source)].filter(Boolean),priceCents:cents,currency,variants,options:[],source,metadata:{hidden:'true',sourcePlatform:'funnelish',sourceProductId:String(entry.id),sourcePurpose:purpose}} })
    }
    if (primary.length) {
      const actionId=/#yes-link-(\d+)/.exec(html)?.[1]
      const defaultId=String(primary.find(p=>String(p.entry.id)===actionId)?.entry.id||primary.find(p=>p.entry.config?.default)?.entry.id||primary[0]!.entry.id)
      const title = plain(primary[0]!.entry.name).replace(/^\d+\s*x\s*/i, '')
      out.products.unshift({key:`funnelish:${funnel.id}:packages:${primary.map(p=>p.entry.id).join(',')}`,purpose:'primary',sourceIds:[...new Set(primary.map(p=>String(p.entry.id)))],defaultSourceId:defaultId,product:{title,description:'',images:[...new Set(primary.map(p=>image(p.entry.imageUrl,source)).filter(Boolean))],priceCents:primary[0]!.variant.priceCents,currency,variants:primary.map(p=>p.variant),options:[],source,metadata:{sourcePlatform:'funnelish',sourcePurpose:'primary',sourceDefaultVariant:defaultId}}})
    }
    // Literal source gift assignments are data, not inferred from claims such as "free" or "% off".
    const freeIds = new Set(entries.filter((e:any)=>!e.isSub && Number(e.price)===0).map((e:any)=>String(e.id)))
    for (const match of html.matchAll(/case\s*["'](\d+)["']\s*:([\s\S]*?)(?:break\s*;|case\s*["']|default\s*:)/g)) {
      const gifts = /updateCartWithGifts\(\s*\[([\d\s,]+)\]\s*\)/.exec(match[2]!)?.[1]
      if (gifts) out.giftRules[match[1]!] = gifts.split(',').map(v=>v.trim()).filter(v=>freeIds.has(v))
    }
    if (!Object.keys(out.giftRules).length) {
      const defaults=entries.filter((entry:any)=>freeIds.has(String(entry.id))&&entry.config?.default===true).map((entry:any)=>String(entry.id))
      if(defaults.length)for(const {entry} of primary)out.giftRules[String(entry.id)]=defaults
    }
    return out
  }
  const document = parse(html) as any
  const nodes: any[] = []; const walk = (node:any) => { nodes.push(node); for (const child of node.childNodes || []) walk(child) }; walk(document)
  const attr = (node:any, name:string) => node.attrs?.find((a:any)=>a.name===name)?.value || ''
  const visit = (data:any) => {
    if (!data || typeof data !== 'object') return
    if (Array.isArray(data)) { data.forEach(visit); return }
    if ([data['@type']].flat().includes('Product')) {
      const offers = [data.offers].flat().filter(Boolean)
      const currency = offers.map((offer:any)=>offer.priceCurrency).find((c:any)=>/^[A-Z]{3}$/.test(c)) || fallbackCurrency
      const variants: ImportedProduct['variants'] = []
      for (const offer of offers.flatMap((o:any)=>o.offers ? [o.offers].flat() : [o])) {
        const price = amount(offer.price, currency)
        if (price === null || price === 0) continue
        variants.push({title:plain(offer.name || 'Default'),priceCents:price,sourceId:String(offer.sku || data.sku || data.productID || ''),...(offer.availability && /OutOfStock|SoldOut|Discontinued/.test(offer.availability)?{inventory:0}:{})})
      }
      if (data.name && variants.length) {
        const images=[data.image].flat().filter(Boolean).map((i:any)=>image(i.url || i,source)).filter(Boolean)
        out.products.push({key:'schema:'+String(data['@id']||data.url||data.sku||data.productID||source),purpose:'primary',sourceIds:[String(data.productID||data.sku||'')].filter(Boolean),product:{title:plain(data.name),description:plain(data.description),images,priceCents:variants[0]!.priceCents,currency,variants,options:[],source}})
      }
    }
    if (data['@graph']) visit(data['@graph'])
    if (data.mainEntity) visit(data.mainEntity)
    if (data.itemListElement) data.itemListElement.forEach((entry:any)=>visit(entry.item || entry))
  }
  for (const node of nodes.filter(node=>node.tagName==='script'&&attr(node,'type').toLowerCase()==='application/ld+json')) {
    try { visit(JSON.parse((node.childNodes||[]).map((part:any)=>part.value||'').join(''))) } catch { /* malformed optional metadata */ }
  }
  return out
}

/** Map captured package cards to owned variants, retaining their source layout. */
export function bindSourceProducts(html: string, products: Product[]): string {
  const bindings = new Map<string,{product:Product;variant:Product['variants'][number]}>()
  for (const product of products) for (const variant of product.variants) {
    const sources=[product.metadata['sourceVariant:'+variant.id]]
    try { sources.push(...JSON.parse(product.metadata['sourceVariantAliases:'+variant.id] || '[]')) } catch { /* optional metadata */ }
    for (const source of sources) if (source && !bindings.has(source)) bindings.set(source,{product,variant})
  }
  return mapMediaDocument(html,tag=>{
    const action=/(?:href|data-yes-link)\s*=\s*["']?#yes-link-(\d+)(?=["'\s>])/.exec(tag)
    const raw=/\s(?:data-pid|data-product-id)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag)
    const binding=action?bindings.get(action[1]!):raw ? bindings.get(decodeMediaAttribute(raw[1]??raw[2]??raw[3]??'')) : undefined
    if(!binding)return tag
    return tag.replace(/\sdata-copy-(?:product-id|variant-id|purchase-type)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi,'').replace(/\/?>(?=$)/,` data-copy-product-id="${binding.product.id}" data-copy-variant-id="${binding.variant.id}" data-copy-purchase-type="one-time">`)
  })
}
