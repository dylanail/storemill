import { parse } from 'parse5'
import type { Media } from '../domain/types.ts'
import { originalMediaSource } from './original-media-source.js'

type Node = { tagName?: string; attrs?: Array<{name:string;value:string}>; childNodes?: Node[]; parentNode?: Node; value?: string }
const attrs = (node:Node) => Object.fromEntries((node.attrs || []).map(a=>[a.name,a.value]))
const has = (node:Node, ...names:string[]) => names.some(name=>(attrs(node).class || '').split(/\s+/).includes(name))
const all = (node:Node):Node[] => [node,...(node.childNodes || []).flatMap(all)]
const absolute = (raw:string, source:string) => {
  if (/^\/_uploads\//.test(raw)) return raw
  try { const url=new URL(raw,source);return raw && /^https?:$/.test(url.protocol)?url.href:'' } catch { return '' }
}
const originalLink = (node:Node) => { let current:Node|undefined=node;for(let i=0;current&&i<3;i++,current=current.parentNode){const href=attrs(current).href;if(current.tagName==='a'&&/\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i.test(href||''))return href}return '' }

/** Main slides only. Thumbnails, cloned loop slides, badges and recommendations are not product photos. */
export function readImportedGallery(html:string, source:string):Media[] {
  const nodes=all(parse(html) as Node)
  const root=nodes.find(n=>has(n,'product-gallery')||n.tagName==='media-gallery'||'data-pb-gallery' in attrs(n))
    || nodes.find(n=>has(n,'swiper_main','mainImage')||has(n,'product__media-list'))
  if(!root)return []
  const descendants=all(root)
  const track=descendants.find(n=>'data-pg-track' in attrs(n)||has(n,'product__media-list','splide__list')||has(n,'swiper-wrapper')&&!has(n.parentNode||{},'swiper_thumbs','thumbImage'))
  const outsideThumbs=(node:Node)=>{for(let current:Node|undefined=node;current&&current!==root;current=current.parentNode)if(has(current,'swiper_thumbs','thumbImage','thumbnail-list','gal-thumbs'))return false;return true}
  const slideNodes=track?(track.childNodes||[]).filter(n=>n.tagName):descendants.filter(n=>['img','video'].includes(n.tagName||'')&&outsideThumbs(n))
  const items:Media[]=[]
  for(const slide of slideNodes){
    if(has(slide,'swiper-slide-duplicate')||'data-copy-gallery-continuation' in attrs(slide))continue
    const descendants=all(slide).filter(n=>{
      for(let current:Node|undefined=n;current&&current!==slide;current=current.parentNode)if(has(current,'swiper_thumbs','thumbImage','thumbnail-list','gal-thumbs'))return false
      return true
    })
    const videos=descendants.filter(n=>n.tagName==='video')
    for(const node of videos.length?videos:descendants.filter(n=>n.tagName==='img')){
      const attributes=attrs(node),kind=node.tagName==='video'?'video':'image'
      const sources=all(kind==='video'?node:node.parentNode?.tagName==='picture'?node.parentNode:node).filter(n=>n.tagName==='source').map(attrs)
      const link=kind==='image'?originalLink(node):''
      const url=absolute(originalMediaSource({...attributes,...(link?{'data-full':link}:{})},sources,kind),source)
      if(!url)continue
      const poster=kind==='video'?absolute(attributes.poster||'',source):''
      items.push({url,alt:attributes.alt||attributes['aria-label']||'',kind,...(poster?{poster}:{})})
    }
  }
  return items
}

/** Structured Product images are the only generic fallback. Never scrape every img on the page. */
export function readProductImages(html:string, source:string):Media[] {
  const gallery=readImportedGallery(html,source)
  if(gallery.length)return gallery
  const nodes=all(parse(html) as Node),products:any[]=[]
  const visit=(value:any)=>{
    if(!value||typeof value!=='object')return
    if(Array.isArray(value)){value.forEach(visit);return}
    if([value['@type']].flat().includes('Product'))products.push(value)
    visit(value['@graph']);visit(value.mainEntity)
  }
  for(const node of nodes.filter(n=>n.tagName==='script'&&attrs(n).type==='application/ld+json'))try{visit(JSON.parse((node.childNodes||[]).map(n=>n.value||'').join('')))}catch{/* Optional malformed schema. */}
  const path=(url:string)=>{try{return new URL(url,source).pathname.replace(/\/$/,'')}catch{return ''}}
  const product=products.find(p=>[p.url,p['@id']].some(url=>url&&path(url)===path(source)))||(products.length===1?products[0]:undefined)
  const images:Media[]=[product?.image].flat().filter(Boolean).map((image:any)=>({url:absolute(typeof image==='string'?image:image.contentUrl||image.url||'',source),alt:typeof image==='object'?image.caption||'':''})).filter(item=>item.url)
  if(images.length)return [...new Map(images.map(item=>[item.url,item])).values()]
  const og=nodes.find(n=>n.tagName==='meta'&&['og:image','og:image:secure_url'].includes(attrs(n).property||attrs(n).name||''))
  const url=og?absolute(attrs(og).content||'',source):''
  return url?[{url,alt:''}]:[]
}
