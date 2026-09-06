import assert from 'node:assert/strict'
import test from 'node:test'
import { Db } from '../src/lib/db.ts'
import { register } from '../src/control/auth.ts'
import { createBlankAsset } from '../src/control/assets.ts'
import { duplicateAsset } from '../src/control/duplicate-asset.ts'
import { createProduct, getProduct, updateProduct } from '../src/domain/catalog.ts'
import { createPage } from '../src/pages/store.ts'
import { productMediaRevision, updateProductMedia } from '../src/control/product-media.ts'
import { pageProductData } from '../src/pages/product-data.ts'
import { mapProductGalleries } from '../src/pages/product-gallery-runtime.ts'
import { templateHtml } from '../src/pages/library.ts'
import { escapeHtml } from '../src/lib/http.ts'

test('gallery catalog updates, independent duplicates and template retargeting',()=>{
 const db=new Db(':memory:')
 try{
  const user=register(db,{email:'gallery@test.example',password:'long-testing-password'}),store=createBlankAsset(db,user.id,{name:'Gallery original',kind:'funnel',currency:'USD'})
  const media=[{url:'https://example.com/a.png',alt:'First'},{url:'https://example.com/b.png',alt:'Second'}]
  const product=createProduct(db,store.id,{title:'Product',media,heroImage:media[0]!.url,metadata:{private:'private'}})
  const gallery={mode:'product',productId:product.id,items:media,settings:{loop:true}}
  const raw='<div data-pb-gallery="'+escapeHtml(JSON.stringify(gallery))+'"><p>Preserve styling and copy</p></div>'
  createPage(db,store.id,{title:'Gallery',mode:'html',rawHtml:raw,productId:product.id})
  const copy=duplicateAsset(db,user.id,store.id)
  const copied=copy.products[0]!
  assert.notEqual(copied.id,product.id)
  assert.ok(copy.pages.find(page=>page.title==='Gallery')!.rawHtml.includes(copied.id));assert.ok(!copy.pages.find(page=>page.title==='Gallery')!.rawHtml.includes(product.id))
  const revision=productMediaRevision(copied)
  const changed=updateProductMedia(db,copy.store.id,copied.id,{revision,media:[media[1],media[0]]})
  assert.equal(changed.heroImage,media[1]!.url)
  assert.deepEqual(getProduct(db,store.id,product.id)!.media,media)
  assert.throws(()=>updateProductMedia(db,copy.store.id,copied.id,{revision,media:[]}),/changed in another tab/)
  assert.throws(()=>updateProductMedia(db,store.id,copied.id,{revision:productMediaRevision(changed),media:[]}),/from this site/)
  assert.throws(()=>updateProductMedia(db,copy.store.id,copied.id,{revision:productMediaRevision(changed),media:[{url:'javascript:alert(1)'}]}),/from this asset/)
  assert.throws(()=>updateProductMedia(db,copy.store.id,copied.id,{revision:productMediaRevision(changed),media:[{url:`/_uploads/${store.id}/up_other.png`}]}),/from this asset/)
  const restored=updateProductMedia(db,copy.store.id,copied.id,{revision:productMediaRevision(changed),media})
  assert.deepEqual(restored.media.map(item=>item.url),media.map(item=>item.url))
  const data=pageProductData(restored,'USD');assert.equal(data.media.length,2);assert.ok(!JSON.stringify(data).includes('private'))
  updateProduct(db,copy.store.id,copied.id,{heroImage:'https://example.com/new.png'})
  assert.equal(pageProductData(getProduct(db,copy.store.id,copied.id)!,'USD').media[0]!.url,'https://example.com/new.png')
  let mapped:any
  const retargeted=templateHtml(raw,copied.id)
  mapProductGalleries(retargeted,g=>{mapped=g;return g})
  assert.equal(mapped.productId,copied.id);assert.equal(mapped.mode,'product')
  mapProductGalleries(templateHtml(raw),g=>{mapped=g;return g})
  assert.equal(mapped.mode,'custom');assert.equal(mapped.productId,'')
  const empty=updateProductMedia(db,copy.store.id,copied.id,{revision:productMediaRevision(getProduct(db,copy.store.id,copied.id)!),media:[]})
  assert.equal(empty.heroImage,'');assert.deepEqual(empty.media,[])
 }finally{db.handle.close()}
})
