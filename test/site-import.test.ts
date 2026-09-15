import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { importAssetFromUrl } from '../src/control/assets.ts'
import { getProduct, updateProduct } from '../src/domain/catalog.ts'
import { addToCart, createCart, reconcileGifts } from '../src/domain/cart.ts'
import { currentOfferStep, respondToOffer, offerReceipts } from '../src/domain/post-purchase.ts'
import { completeCart, getOrder } from '../src/domain/orders.ts'
import { listFunnels, resolveBump } from '../src/domain/funnels.ts'
import { listPromotions, applyPromotions } from '../src/domain/promotions.ts'
import { relatedSiteOrigin, canonicalPageUrl } from '../src/pages/site-copy.ts'
import { readSourceCommerce } from '../src/pages/source-commerce.ts'
import { stripeClient } from '../src/payments/stripe.ts'
import { readCopyReport } from '../src/pages/clone-report.ts'
import { startImport, getImport, cancelImport, drainImports } from '../src/control/asset-import-jobs.ts'
import { duplicateWholeFunnel } from '../src/pages/funnel-clone.ts'

const origin='https://try.brand.example'
const product=(id:number,name:string,price:number,extra={})=>({id,name,price,options:[{id:id+1000,title:'Default'}],...extra})
function source(type:number,order:number,products:unknown,body:string){return `<html><head><title>Brand step ${order}</title><meta name="pageid" content="${order+100}"></head><body>${body}<script>window.FUNNEL={"id":77,"currency_code":"USD"};window.STEP={"id":${order},"user_id":1,"type":${type},"order_index":${order},"funnel_id":77};window.PRODUCTS=${JSON.stringify(products)};</script><!-- funnelish --></body></html>`}
function fixture(){
  const pages:Record<string,string>={
    [origin+'/products/start']:source(5,1,null,'<a href="#next-step">Buy</a><a href="https://brand.example/">Home</a>'),
    [origin+'/checkout']:source(1,2,[product(10,'1 x Bottle',59.95,{displayPrice:'<s>$150</s> $59.95'}),product(11,'Buy 2 Get 1 FREE',119.85,{config:{default:true},displayPrice:'<s>$450</s> $39.95 per bottle'}),product(12,'Priority shipping',4.95,{isOb:true}),product(13,'Free guide',0),product(14,'Free shipping',0)],'<main class="basic-information-section"><div class="product-list"><div class="pl-item" data-pid="10">1 Bottle</div><div class="pl-item" data-pid="11">3 Bottles</div></div></main><a href="#submit-step">Pay</a><script>switch(pid){case "11":updateCartWithGifts([13,14]);break;}</script>'),
    [origin+'/offer-one']:source(2,3,[product(20,'Extra bottle',39.99),product(21,'Two extra bottles',59.99)],'<a href="#yes-link-21">Add two</a><a href="#no-link">No thanks</a>'),
    [origin+'/offer-two']:source(2,4,[product(30,'Companion',19.99)],'<a href="#yes-link-30">Add companion</a><a href="#no-link">No thanks</a>'),
    [origin+'/thank-you']:source(3,5,null,'<h1>Your order</h1>'),
    'https://brand.example/':'<title>Home</title><nav><a href="/policies/privacy">Privacy</a><a href="/menu">Menu</a></nav>',
    'https://brand.example/menu':'<title>Menu</title><a href="/">Home</a><a href="/policies/terms">Terms</a>',
    'https://brand.example/policies/privacy':'<title>Privacy</title><a href="/policies/terms">Terms</a>',
    'https://brand.example/policies/terms':'<title>Terms</title><p>Terms</p>',
  }
  const calls:Array<{url:string;method:string;body:any}>=[]
  const fetchImpl=(async(input:any,init?:RequestInit)=>{
    const url=String(input),method=init?.method||'GET';calls.push({url,method,body:init?.body?JSON.parse(String(init.body)):null})
    if(method==='POST'){
      assert.equal(url,origin+'/next-step');const body=JSON.parse(String(init?.body));assert.deepEqual(body.customer,{});assert.equal(body.test_mode,1);assert.ok(!init?.headers||!('Cookie' in init.headers));
      const next=['','', '/checkout','/offer-one','/offer-two','/thank-you'][body.step_id+1]
      return Response.json({status:'ok',data:{next:origin+next}})
    }
    const response=new Response(pages[url]||'Not found',{status:pages[url]?200:404,headers:{'content-type':'text/html'}});Object.defineProperty(response,'url',{value:url});return response
  }) as typeof fetch
  return {fetchImpl,calls,pages}
}

test('whole-site clone resolves opaque checkout, follows branded subdomains, wires packages, gifts, bumps and every offer',async()=>{
  const {db,user}=fresh(),{fetchImpl,calls}=fixture(),progress:any[]=[]
  const result=await importAssetFromUrl(db,user.id,{url:origin+'/products/start',kind:'funnel',fetchImpl,onProgress:p=>progress.push(p)})
  assert.equal(result.pages.length,9)
  assert.equal(result.report.complete,true)
  assert.equal(result.products.length,6)
  assert.equal(result.report.commerce?.upsells,2)
  const main=result.products.find(p=>p.title==='Bottle')!
  assert.ok(main)
  assert.deepEqual(main.variants.map(v=>[v.priceCents,v.compareAtCents]),[[5995,15000],[11985,45000]])
  assert.equal(result.page.productId,main.id,'initial page resolves its product from checkout')
  assert.match(result.page.rawHtml,/href="\/checkout"/)
  const checkout=result.pages.find(p=>p.role==='checkout')!
  assert.equal(checkout.productId,main.id)
  assert.match(checkout.rawHtml,new RegExp('data-copy-variant-id="'+main.variants[1]!.id+'"'))
  const funnel=listFunnels(db,result.store.id)[0]!
  assert.equal(resolveBump(db,result.store.id,funnel)?.priceCents,495)
  const extras=funnel.steps.filter(s=>s.offer)
  assert.equal(extras.length,2)
  assert.equal(extras[0]!.nextPageId,extras[1]!.pageId)
  assert.equal(getProduct(db,result.store.id,result.pages.find(p=>p.id===extras[0]!.pageId)!.productId)?.metadata.sourcePurpose,'upsell')
  assert.equal(getProduct(db,result.store.id,result.pages.find(p=>p.id===extras[0]!.pageId)!.productId)?.variants[1]!.id,extras[0]!.offer!.variantId,'fixed source CTA is mapped to the exact package')
  const item={productId:main.id,variantId:main.variants[1]!.id,title:main.title,variantTitle:'3 Bottles',image:'',unitCents:11985,quantity:1}
  const gifted=reconcileGifts(db,result.store.id,[item]);assert.equal(gifted.length,2);assert.equal(gifted[1]!.unitCents,0)
  assert.equal(reconcileGifts(db,result.store.id,gifted.filter(line=>line.giftOf)).length,0,'a gift cannot survive removing its package')
  assert.equal(listPromotions(db,result.store.id).length,1)
  assert.equal(applyPromotions(db,result.store.id,[item],{subtotalCents:11985}).freeShipping,true)
  assert.equal(applyPromotions(db,result.store.id,[{...item,variantId:main.variants[0]!.id}],{subtotalCents:5995}).freeShipping,false)
  assert.equal(readCopyReport(db,result.store.id,result.page.id)?.pages?.length,9)
  assert.ok(!result.clone.notes.some(note=>/No explicit.*price/.test(note)))
  assert.equal(progress.at(-1).percent,100);assert.ok(progress.every((p,i)=>!i||p.percent>=progress[i-1].percent))
  assert.ok(calls.filter(call=>call.method==='POST').every(call=>call.url.endsWith('/next-step')))
  const copy=duplicateWholeFunnel(db,result.store.id,funnel.id)
  const copiedSteps=copy.funnel.steps.filter(s=>s.offer)
  assert.equal(copiedSteps[0]?.nextPageId,copiedSteps[1]?.pageId)
  assert.notEqual(copiedSteps[0]?.offer?.pageId,extras[0]?.offer?.pageId)
})

test('post-purchase chain advances repeatedly, validates choices and uses one quote and charge identity across retries',async()=>{
  const {db,user}=fresh(),{fetchImpl}=fixture()
  const imported=await importAssetFromUrl(db,user.id,{url:origin+'/products/start',kind:'funnel',fetchImpl})
  for(const product of imported.products)updateProduct(db,imported.store.id,product.id,{status:'published'})
  const funnel=listFunnels(db,imported.store.id)[0]!,main=getProduct(db,imported.store.id,funnel.productId)!
  const cart=createCart(db,imported.store.id);addToCart(db,imported.store.id,cart.id,main.variants[0]!.id)
  const order=completeCart(db,imported.store.id,cart.id,{email:'buyer@example.com',payment:{provider:'demo',status:'captured'}})
  const first=currentOfferStep(db,imported.store.id,order,funnel)!
  await assert.rejects(respondToOffer(db,imported.store.id,order.id,funnel,{pageId:first.pageId,accept:true,variantId:main.variants[0]!.id},n=>n,async()=>{throw Error('must not charge')}),/Choose a product/)
  const charges:any[]=[]
  const firstReply=await respondToOffer(db,imported.store.id,order.id,funnel,{pageId:first.pageId,accept:true},n=>n,async(quote,key)=>{charges.push({quote,key});return{ok:false,intentId:''}})
  assert.equal(firstReply,'pending');assert.equal(getOrder(db,imported.store.id,order.id)!.items.length,1)
  await respondToOffer(db,imported.store.id,order.id,funnel,{pageId:first.pageId,accept:true},n=>n,async(quote,key)=>{charges.push({quote,key});return{ok:true,intentId:'pi_test'}})
  assert.deepEqual(charges[0],charges[1]);assert.equal(charges[0].quote.amountCents,5999)
  await respondToOffer(db,imported.store.id,order.id,funnel,{pageId:first.pageId,accept:true},n=>n,async()=>{throw Error('duplicate must not charge')})
  const updated=getOrder(db,imported.store.id,order.id)!;assert.equal(updated.items.length,2);assert.equal(updated.totalCents-order.totalCents,5999)
  const second=currentOfferStep(db,imported.store.id,updated,funnel)!
  assert.notEqual(second.pageId,first.pageId)
  await respondToOffer(db,imported.store.id,order.id,funnel,{pageId:second.pageId,accept:false},n=>n,async()=>{throw Error('decline must not charge')})
  assert.equal(currentOfferStep(db,imported.store.id,getOrder(db,imported.store.id,order.id)!,funnel),null)
  assert.deepEqual(offerReceipts(db,imported.store.id,order.id).map(row=>row.status),['accepted','declined'])
})

test('background cloning retains progress, is owner-scoped, deduplicates requests and cancels independently of connections',async()=>{
  const {db,user}=fresh(),{fetchImpl}=fixture()
  const input={url:origin+'/products/start',kind:'funnel' as const}
  const job=startImport(db,user.id,input,'request_12345')
  assert.equal(startImport(db,user.id,input,'request_12345').id,job.id)
  assert.throws(()=>getImport(db,'another-owner',job.id),/not found/i)
  await drainImports(db,(database,owner,options)=>importAssetFromUrl(database,owner,{...options,fetchImpl}))
  const done=getImport(db,user.id,job.id);assert.equal(done.status,'done');assert.equal(JSON.parse(done.progress).percent,100);assert.equal(JSON.parse(done.result).pages,9)
  assert.equal(startImport(db,user.id,input,'request_12345').id,job.id)
  const cancelled=startImport(db,user.id,input,'request_cancel');cancelImport(db,user.id,cancelled.id)
  await drainImports(db,async()=>{throw Error('cancelled jobs must not run')});assert.equal(getImport(db,user.id,cancelled.id).status,'cancelled')
})

test('source prices remain authoritative, unknown recurring offers stay visible as gaps and unrelated tenants are excluded',()=>{
  const data=readSourceCommerce(source(1,1,[product(1,'Monthly',25,{isSub:true}),product(2,'One time',39.95)],''),origin,'USD')
  assert.equal(data.products.length,1);assert.match(data.issues[0]!,/recurring payment integration/)
  assert.equal(canonicalPageUrl('https://shop.example/collections/all/products/bottle?pr_ref_pid=2&pr_seq=uniform&variant=3'),'https://shop.example/products/bottle')
  const gift=readSourceCommerce(source(2,1,[product(90,'Soap',0,{config:{default:true,hidden:true}}),product(91,'Shipping',14.99,{config:{default:true,hidden:true}})],'<a href=#yes-link>Accept</a>'),origin,'USD');assert.deepEqual(gift.giftRules,{'91':['90']})
  assert.equal(relatedSiteOrigin('https://brand.example',new Set([origin])),true)
  assert.equal(relatedSiteOrigin('https://other.example',new Set([origin])),false)
  assert.equal(relatedSiteOrigin('https://shop.myshopify.com',new Set(['https://try.myshopify.com'])),false)
})


test('post-purchase Stripe retries carry a stable provider idempotency key',async()=>{
  const keys:string[]=[]
  const stripe=stripeClient('sk_fixture',async(_path,init)=>{keys.push((init.headers as Record<string,string>)['Idempotency-Key']!);return {ok:true,status:200,json:async()=>({id:'pi_fixture',status:'succeeded'})}})
  const input={amountCents:5999,currency:'USD',customerId:'cus_fixture',paymentMethodId:'pm_fixture',idempotencyKey:'offer_receipt_1'}
  await stripe.paymentIntents.chargeOffSession(input);await stripe.paymentIntents.chargeOffSession(input)
  assert.deepEqual(keys,['offer_receipt_1','offer_receipt_1'])
})
