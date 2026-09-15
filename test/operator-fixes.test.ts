import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { cartEventClient, browserCartEvent, browserCartEventsHtml } from '../src/analytics/browser-cart-events.ts'
import { metaClient, metaEvent } from '../src/analytics/meta-browser.ts'
import { parseQualificationAmount, qualifyProduct } from '../src/domain/qualify.ts'
import { rebrandPrompt, type RebrandSpec } from '../src/control/media-render.ts'
import { imageModels } from '../src/agent/images.ts'
import { fresh } from './helpers.ts'
import { createBlankAsset } from '../src/control/assets.ts'
import { environment } from '../src/control/stores.ts'
import { install } from '../src/control/plugins.ts'
import type { StoreView } from '../src/storefront/render.ts'

test('GA4 and TikTok receive one add-to-cart while Meta retains the same deduplicated event ID', () => {
  const calls: {provider:string;args:any[]}[] = [], listeners = new Map<string,Function[]>(), storage = new Map<string,string>()
  const window:any={gtag:(...args:any[])=>calls.push({provider:'ga4',args}),ttq:{track:(...args:any[])=>calls.push({provider:'tiktok',args})}}
  const document={head:{appendChild(){}},createElement:()=>({}),addEventListener:(name:string,fn:Function)=>listeners.set(name,[...(listeners.get(name)||[]),fn]),dispatchEvent:(event:any)=>listeners.get(event.type)?.forEach(fn=>fn(event))}
  window.sessionStorage={getItem:(key:string)=>storage.get(key),setItem:(key:string,value:string)=>storage.set(key,value)}
  const globals={window,document,CustomEvent,sessionStorage:window.sessionStorage}
  runInNewContext(`(${metaClient.toString()})('123456789');(${cartEventClient.toString()})({ga4:'G-TEST123',tiktok:'TEST1234567'},[])`,globals)
  window.fbq.callMethod=(...args:any[])=>calls.push({provider:'meta',args})
  const event=metaEvent({eventId:'shared-cart-id',type:'cart.add',valueCents:6495,currency:'USD',productId:'beetroot',url:'https://example.com',ip:'',userAgent:''})!
  const cart=browserCartEvent({eventId:event.id,type:'cart.add',valueCents:6495,currency:'USD',productId:'beetroot',url:'https://example.com',ip:'',userAgent:''})!
  window.amborasMeta(event);window.amborasMeta(event);window.storemillCartEvent(cart);window.storemillCartEvent(cart)
  assert.equal(calls.filter(c=>c.provider==='ga4').length,1)
  assert.equal(calls.find(c=>c.provider==='ga4')!.args[2].value,64.95)
  assert.equal(calls.find(c=>c.provider==='tiktok')!.args[2].event_id,event.id)
  assert.equal(calls.filter(c=>c.provider==='meta').length,1)
  assert.equal(calls.find(c=>c.provider==='meta')!.args[4].eventID,event.id)
  const purchase={...event,id:'order-1',name:'Purchase'}
  window.amborasMeta(purchase);window.amborasMeta(purchase)
  assert.equal(calls.filter(c=>c.provider==='meta'&&c.args[2]==='Purchase').length,1)
})

test('cart tracking mounts with only GA4 or TikTok installed and is suppressed in preview', () => {
  const {db,user}=fresh(), store=createBlankAsset(db,user.id,{name:'Browser events',kind:'store'})
  install(db,store.id,'ga4',{measurementId:'G-TEST123'})
  install(db,store.id,'tiktok-pixel',{pixelId:'TEST1234567'})
  const view:StoreView={db,store,env:environment(db,store.id,'live'),base:'/s/test',preview:false,cart:null,totals:null}
  const html=browserCartEventsHtml(view)
  assert.match(html,/data-cart-events/)
  assert.match(html,/G-TEST123/)
  assert.match(html,/TEST1234567/)
  assert.equal(browserCartEventsHtml({...view,preview:true}),'')
})

test('qualification accepts major currency units and rejects ambiguous amounts', () => {
  assert.equal(parseQualificationAmount('60','USD'),6000)
  assert.equal(parseQualificationAmount('60.95','USD'),6095)
  assert.equal(parseQualificationAmount('6000','JPY'),6000)
  for(const amount of ['-5','60.999','1,200','NaN'])assert.throws(()=>parseQualificationAmount(amount,'USD'))
  assert.throws(()=>parseQualificationAmount('6000.25','JPY'))
  const report=qualifyProduct({currency:'EUR',sellPriceCents:5000,landedCostCents:1000,aovCents:6095})
  assert.match(report.checks.find(c=>c.key==='aov')!.detail,/60.95.*EUR/)
  assert.equal(report.checks.find(c=>c.key==='aov')!.verdict,'warn','USD benchmarks are not silently applied to another currency')
})

test('similar variations and text edits never implicitly replace a logo', () => {
  const spec={brandName:'New Brand',logo:'/logo.png',oldBrand:'',direction:'Slightly warmer light',method:'ai',provider:'openai',position:'center',width:20,frame:0} as RebrandSpec
  assert.match(rebrandPrompt({...spec,intent:'variation'}),/similar pose, setting/)
  assert.doesNotMatch(rebrandPrompt({...spec,intent:'variation'}),/Image 2 is the exact desired logo/)
  assert.match(rebrandPrompt({...spec,intent:'text',direction:'Change DAILY to EVERYDAY'}),/Change only the words/)
  assert.match(rebrandPrompt({...spec,intent:'rebrand'}),/Image 2 is the exact desired logo/)
  assert.match(imageModels().find(m=>m.id==='openai')!.name,/GPT Image 2.5/)
})
