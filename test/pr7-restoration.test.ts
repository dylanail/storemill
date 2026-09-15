import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { fresh } from './helpers.ts'
import { createStore, environment } from '../src/control/stores.ts'
import { seedTodos, refreshTodos, listTodos } from '../src/control/todos.ts'
import { install } from '../src/control/plugins.ts'
import { browserCartEvent, browserCartEventsHtml, cartEventClient } from '../src/analytics/browser-cart-events.ts'
import { healthCard } from '../src/admin/plan-pages.ts'
import { createPage } from '../src/pages/store.ts'
import { htmlPage } from '../src/storefront/render.ts'
import { startImport } from '../src/control/asset-import-jobs.ts'

test('GA4 and TikTok cart events share server IDs, respect currency units and deduplicate repeated delivery without emitting Meta', () => {
  const event=browserCartEvent({eventId:'cart-event',type:'cart.add',url:'https://shop.test/cart/add',ip:'',userAgent:'',currency:'JPY',valueCents:2500,productId:'product'})!
  assert.equal(event.value,2500)
  const calls: unknown[][]=[],storage=new Map<string,string>()
  const window={gtag:(...args:unknown[])=>calls.push(['ga4',...args]),ttq:{track:(...args:unknown[])=>calls.push(['tiktok',...args])},fbq:()=>assert.fail('Meta must retain its own dispatcher'),sessionStorage:{getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)}}
  const context=runInNewContext(`(${cartEventClient.toString()})({ga4:'G-TEST',tiktok:'PIXEL'},[${JSON.stringify(event)}]);window`,{window})
  context.storemillCartEvent(event)
  runInNewContext(`(${cartEventClient.toString()})({ga4:'G-TEST',tiktok:'PIXEL'},[${JSON.stringify(event)}])`,{window})
  assert.equal(calls.length,2)
  assert.equal(JSON.stringify(calls[1]?.at(-1)),JSON.stringify({event_id:'cart-event'}))
  context.storemillCartEvent({...event,id:'another-add'})
  assert.equal(calls.length,4,'a second real add remains a separate event')
})

test('cart integration bootstrap works without Meta and is absent from private previews',()=>{
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'Pixels'})
  install(db,store.id,'tiktok-pixel',{pixelId:'CABC1234567890'})
  const view={db,store,env:environment(db,store.id,'draft'),base:'/s/pixels',preview:false,cart:null,totals:null}
  assert.match(browserCartEventsHtml(view),/storemillCartEvent/)
  assert.equal(browserCartEventsHtml({...view,preview:true}),'')
})

test('domain checklist is visible and recomputes real verification state',()=>{
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'Domains'})
  seedTodos(db,store.id);refreshTodos(db,store.id)
  assert.equal(listTodos(db,store.id).find(todo=>todo.key==='domain')?.status,'waiting')
  db.insert('domains',{id:'audit-domain',store_id:store.id,hostname:'shop.example',status:'verified',verification_token:'fixture-token',created_at:new Date().toISOString()})
  refreshTodos(db,store.id)
  assert.equal(listTodos(db,store.id).find(todo=>todo.key==='domain')?.status,'done')
})

test('live health report uses live pages and keeps repair controls on the draft report',()=>{
  const {db,user}=fresh(),store={...createStore(db,user.id,{name:'Live audit'}),status:'live' as const}
  createPage(db,store.id,{title:'Unpublished page',mode:'html',rawHtml:'<html><body>Needs repairs</body></html>',status:'draft'})
  const ctx={db,store,userName:'Owner',storeUrl:'/s/live-audit'}
  const live=healthCard(ctx,true),draft=healthCard(ctx,true,'draft')
  assert.match(live,/published pages and live theme/)
  assert.doesNotMatch(live,/Unpublished page|data-health-fix data-path/)
  assert.match(draft,/Unpublished page/)
  assert.match(draft,/data-health-fix data-path/)
})

test('HTML product versions inherit the product identity while ordinary pages keep theirs',()=>{
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'SEO'})
  const page=createPage(db,store.id,{title:'Variant headline',mode:'html',rawHtml:'<html><head><title>Source title</title><link rel="canonical" href="https://source.test/variation"></head><body>Product</body></html>',seo:{title:'Variant title'}})
  const view={db,store,env:environment(db,store.id,'draft'),base:'/s/seo',preview:false,cart:null,totals:null}
  const rendered=htmlPage(view,page,undefined,{title:'Product title',description:'Product description',canonical:'/s/seo/products/widget'})
  assert.match(rendered,/<title>Product title<\/title>/)
  assert.match(rendered,/<link rel="canonical" href="[^"]*\/s\/seo\/products\/widget">/)
  assert.doesNotMatch(rendered,/Source title|Variant title|https:\/\/source.test\/variation/)
  assert.match(htmlPage(view,page),new RegExp('/pages/'+page.handle))
})

test('durable import jobs preserve selected scope and reject contradictory page requests',()=>{
  const {db,user}=fresh()
  const job=startImport(db,user.id,{url:'https://source.test/',kind:'store',scope:'selected',additionalUrls:['https://source.test/offer']})
  assert.equal(JSON.parse(job.input).scope,'selected')
  assert.throws(()=>startImport(db,user.id,{url:'https://source.test/',kind:'store',scope:'page',additionalUrls:['https://source.test/offer']}),/Only the pages I list/)
})

test('switching the default region is atomic and cannot silently leave checkout without a default',async()=>{
  const {createRegion,updateRegion,listRegions}=await import('../src/domain/regions.ts')
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'Markets'})
  const first=createRegion(db,store.id,{name:'US',currency:'USD',countries:['US']})
  const second=createRegion(db,store.id,{name:'UK',currency:'GBP',countries:['GB']})
  db.exec("CREATE TRIGGER reject_default_test BEFORE UPDATE ON regions WHEN NEW.name='Reject' BEGIN SELECT RAISE(ABORT,'fixture failure'); END")
  assert.throws(()=>updateRegion(db,store.id,second.id,{isDefault:true,name:'Reject'}),/fixture failure/)
  assert.deepEqual(listRegions(db,store.id).filter(region=>region.isDefault).map(region=>region.id),[first.id])
  updateRegion(db,store.id,first.id,{isDefault:false})
  assert.equal(listRegions(db,store.id).filter(region=>region.isDefault).length,1)
  updateRegion(db,store.id,second.id,{isDefault:true,exchangeRate:0.8,locale:'en-GB'})
  assert.deepEqual(listRegions(db,store.id).filter(region=>region.isDefault).map(region=>region.id),[second.id])
})
