import test from 'node:test'
import assert from 'node:assert/strict'
import {readBrief} from '../src/agent/copy.ts'
import {rulesResearch} from '../src/agent/research.ts'
import {writeProductContent} from '../src/agent/pages.ts'
import {readSourceCurrency} from '../src/pages/source-commerce.ts'
import {importProductFromUrl} from '../src/domain/ops.ts'
test('fallback copy cannot invent returns, tracking, material, proof or comparison claims',()=>{
 const brief=readBrief('A zip-closure lunch bag. No confirmed material, returns policy, tracking or reviews.');const content=writeProductContent(rulesResearch(brief),brief,{title:'Lunch bag',priceCents:2900});
 assert.equal(content.trust?.length,0);assert.equal(content.comparison?.rows.length,0)
 assert.doesNotMatch(JSON.stringify(content),/thirty days|full refund|tracked the whole|repaired|leather/i)
 assert.match(content.guarantee??'',/confirmation/)
})
test('Shopify import uses declared source currency and preserves sold-out availability',async()=>{
 const sourceCurrency=readSourceCurrency('<meta content="CAD" property="og:price:currency">');assert.equal(sourceCurrency,'CAD');assert.equal(readSourceCurrency('<div>USD destination</div>'),undefined)
 const fetcher=(async(input:string|URL|Request)=>new Response(JSON.stringify(String(input).endsWith('.json')?{product:{title:'Bag',variants:[{id:42,title:'Blue',price:'320.00',compare_at_price:'395.00'}]}}:{variants:[{id:42,available:false}],media:[]}))) as typeof fetch
 const product=await importProductFromUrl('https://source.example/products/bag',fetcher,{sourceCurrency});assert.equal(product.currency,'CAD');assert.equal(product.variants[0]?.priceCents,32000);assert.equal(product.variants[0]?.inventory,0)
 const yen=await importProductFromUrl('https://source.example/products/bag',fetcher,{sourceCurrency:'JPY'});assert.equal(yen.variants[0]?.priceCents,320)
})
import {fresh} from './helpers.ts'
import {createStore} from '../src/control/stores.ts'
import {legalFor,saveLegal} from '../src/storefront/legal.ts'
import {newBlock} from '../src/pages/store.ts'
test('unconfigured policy cannot imply a return window or guarantee; explicit merchant terms survive',()=>{
 const{db,user}=fresh();const store=createStore(db,user.id,{name:'Unconfirmed policy'});assert.equal(legalFor(db,store).returnsDays,0);assert.equal(legalFor(db,store).guaranteeDays,0);saveLegal(db,store.id,{returnsDays:45,guaranteeDays:60});assert.equal(legalFor(db,store).returnsDays,45);assert.equal(legalFor(db,store).guaranteeDays,60);db.handle.close()
})
test('new proof and policy blocks start empty instead of inventing customers or promises',()=>{
 for(const[type,key]of[['testimonials','quotes'],['logos','names'],['comments','comments'],['trust-badges','items'],['comparison','rows'],['stats','items'],['value-stack','items']] as const)assert.equal(newBlock(type,{}).settings[key],'',type)
 const guarantee=newBlock('guarantee',{});assert.equal(guarantee.settings.days,0);assert.doesNotMatch(JSON.stringify(guarantee.settings),/thirty|refund the lot|return label/i)
})
