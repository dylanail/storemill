import test from 'node:test'
import assert from 'node:assert/strict'
import { importProductFromUrl, createFromImport } from '../src/domain/ops.ts'
import { readImportedGallery, readProductImages } from '../src/pages/product-media-import.ts'
import { originalMediaSource } from '../src/pages/original-media-source.js'
import { readSourceCommerce } from '../src/pages/source-commerce.ts'
import { Db } from '../src/lib/db.ts'
import { register } from '../src/control/auth.ts'
import { createBlankAsset } from '../src/control/assets.ts'
import { productDetail } from '../src/admin/pages.ts'

test('imports every original Shopify image in source order and keeps video files separate from posters',async()=>{
  const images=Array.from({length:30},(_,i)=>({src:`https://cdn.example/original-${i}.webp?v=1`,alt:`View ${i}`,position:i+1}))
  const video={media_type:'video',alt:'Demonstration',preview_image:{src:'https://cdn.example/poster.jpg'},sources:[{url:'https://cdn.example/small.mp4',width:320,mime_type:'video/mp4'},{url:'https://cdn.example/original.mp4',width:1920,mime_type:'video/mp4'}]}
  const media=images.map(image=>({media_type:'image',...image}))
  const fetchImpl=(async(input:string|URL|Request)=>String(input).endsWith('.json')?new Response(JSON.stringify({product:{title:'Original product',images:[...images].reverse(),variants:[{title:'Default',price:'54.95'}]}})):new Response(JSON.stringify({media:[...media.slice(0,2),video,...media.slice(2)]}))) as typeof fetch
  const imported=await importProductFromUrl('https://store.example/products/original',fetchImpl)
  assert.deepEqual(imported.images,images.map(image=>image.src))
  assert.equal(imported.media?.length,31)
  assert.deepEqual(imported.media?.[2],{url:'https://cdn.example/original.mp4',alt:'Demonstration',kind:'video',poster:'https://cdn.example/poster.jpg'})
  const db=new Db(':memory:')
  try{
    const owner=register(db,{email:'originals@test.example',password:'a-long-test-password'}),store=createBlankAsset(db,owner.id,{name:'Originals',kind:'store'})
    const product=createFromImport(db,store.id,imported)
    assert.equal(product.media.length,31);assert.equal(product.media[30]?.alt,'View 29')
    const html=productDetail({db,store,userName:'Owner',storeUrl:'/s/originals'},product.id)
    assert.equal((html.match(/data-product-media-item/g)||[]).length,31)
    assert.match(html,/object-fit:contain/);assert.match(html,/31 of 31/)
    assert.match(html,/value="original" selected/)
    assert.match(html,/src="https:\/\/cdn.example\/original.mp4"/)
  }finally{db.handle.close()}
})

test('unavailable or incomplete Ajax media cannot truncate the original image feed',async()=>{
  const images=Array.from({length:28},(_,i)=>({src:`https://cdn.example/${i}.jpg`}))
  const imported=await importProductFromUrl('https://store.example/products/full',(async(input:string|URL|Request)=>String(input).endsWith('.json')?new Response(JSON.stringify({product:{title:'Full',images}})):new Response(JSON.stringify({media:[{media_type:'image',src:images[0]!.src}]}))) as typeof fetch)
  assert.equal(imported.images.length,28);assert.equal(imported.media?.length,28)
})

test('original media selection respects zoom files, responsive sizes, CDN commas, lazy images and videos',()=>{
  assert.equal(originalMediaSource({src:'/thumb.jpg','data-zoom-image':'/original.jpg',srcset:'/medium.jpg 800w'}),'/original.jpg')
  assert.equal(originalMediaSource({src:'/thumb.jpg',srcset:'https://cdn.example/image/w_80,q_auto/1.jpg 80w, https://cdn.example/image/w_2000,q_auto/1.jpg 2000w'}),'https://cdn.example/image/w_2000,q_auto/1.jpg')
  assert.equal(originalMediaSource({src:'data:image/gif;base64,AAAA','data-src':'/lazy-original.webp'}),'/lazy-original.webp')
  assert.equal(originalMediaSource({src:'/fallback.jpg'},[{media:'(max-width:600px)',srcset:'/mobile-crop.jpg 2200w'},{srcset:'/desktop-full.jpg 1800w'}]),'/desktop-full.jpg')
  assert.equal(originalMediaSource({poster:'/frame.jpg'},[{src:'/movie.mp4',type:'video/mp4'}],'video'),'/movie.mp4')
  assert.equal(originalMediaSource({poster:'/frame.jpg'},[],'video'),'')
})

const gallery=`<img src="/logo.png"><div class="product-gallery"><div class="swiper_main"><div class="swiper-wrapper">
 <div class="swiper-slide-duplicate"><img src="/duplicate.jpg"></div>
 <div><a href="/full-1.webp"><img src="/tiny-1.webp" alt="First original"></a></div>
 <div><picture><source media="(max-width:600px)" srcset="/mobile-crop.webp 2400w"><img src="/tiny-2.webp" srcset="/medium-2.webp 600w, /full-2.webp 1800w" alt="Second original"></picture></div>
 <div><video poster="/poster.jpg"><source src="/movie.mp4" type="video/mp4"></video></div>
 </div></div><div class="swiper_thumbs"><div class="swiper-wrapper"><img src="/thumb-1.jpg"><img src="/thumb-2.jpg"></div></div></div><img src="/review-avatar.jpg">`
test('gallery import excludes loop duplicates, thumbnails, page decorations and video posters',()=>{
 const media=readImportedGallery(gallery,'https://store.example/item')
 assert.deepEqual(media.map(item=>item.url),['https://store.example/full-1.webp','https://store.example/full-2.webp','https://store.example/movie.mp4'])
 assert.equal(media[2]?.poster,'https://store.example/poster.jpg')
 assert.deepEqual(readProductImages(gallery,'https://store.example/item'),media)
})

test('a simple gallery keeps mixed media and deliberately repeated slides in their original order',()=>{
 const html='<div class="product-gallery"><img src="/front.jpg"><video src="/demo.mp4" poster="/poster.jpg"></video><img src="/front.jpg"><div class="gal-thumbs"><img src="/thumb.jpg"></div></div>'
 assert.deepEqual(readImportedGallery(html,'https://store.example/').map(item=>item.url),['https://store.example/front.jpg','https://store.example/demo.mp4','https://store.example/front.jpg'])
})

test('generic import uses the matching Product schema, never logos, banners, recommendations or every img',async()=>{
 const source='https://store.example/item'
 const schema=`<script type="application/ld+json">${JSON.stringify({'@graph':[
 {'@type':'Product',url:'/related',name:'Other',image:'/related.jpg'},
 {'@type':'Product',url:'/item',name:'This',image:[{contentUrl:'/full-1.jpg',caption:'Front'},'/full-2.jpg']}
 ]})}</script><img src="/logo.jpg"><img src="/banner.jpg"><img src="/avatar.jpg">`
 assert.deepEqual(readProductImages(schema,source).map(item=>item.url),['https://store.example/full-1.jpg','https://store.example/full-2.jpg'])
 assert.deepEqual(readProductImages('<img src="/logo.jpg"><img src="/related.jpg">',source),[])
 const imported=await importProductFromUrl(source,(async()=>new Response(schema)) as typeof fetch)
 assert.deepEqual(imported.images,['https://store.example/full-1.jpg','https://store.example/full-2.jpg'])
})

test('Funnelish packages use the page gallery, while package packshots remain variant-specific',()=>{
 const html=gallery+`<script>window.FUNNEL={"id":1,"currency_code":"USD"};window.STEP={"id":1};window.PRODUCTS=[{"id":1,"name":"One bottle","price":20,"imageUrl":"/package.jpg"}];</script>`
 const product=readSourceCommerce(html,'https://store.example/offer','USD').products[0]!.product
 assert.deepEqual(product.images,['https://store.example/full-1.webp','https://store.example/full-2.webp'])
 assert.equal(product.media?.[2]?.kind,'video')
 assert.equal(product.variants[0]?.image,'https://store.example/package.jpg')
})
