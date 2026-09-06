import test from 'node:test'
import assert from 'node:assert/strict'
import { fresh } from './helpers.ts'
import { createStore } from '../src/control/stores.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { seedDefaultRegion, defaultRegion } from '../src/domain/regions.ts'
import { createCart, addToCart, totals } from '../src/domain/cart.ts'
import { upsertBundle, listBundles } from '../src/domain/bundles.ts'
import { cartDisplayLines } from '../src/domain/cart-prices.ts'
import { sourceFreeShippingThreshold, installSourceCartShipping } from '../src/pages/imported-cart.ts'
import { completeCart } from '../src/domain/orders.ts'
import { ensureCopiedCheckout } from '../src/pages/commerce-pages.ts'
import { listPages } from '../src/pages/store.ts'
import { bundlesPage, promotionsPage } from '../src/admin/pages.ts'

const source='<cart-drawer><p class="cart-progress__text">Spend <span>$50</span> more to get FREE shipping!</p><cart-drawer-items class="is-empty" data-subtotal="0"></cart-drawer-items></cart-drawer>'
test('source cart shipping imports a stated full threshold, preserves the merchant rate and shows the qualified state',()=>{
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'Copied cart'})
  seedDefaultRegion(db,store.id,'USD')
  assert.equal(sourceFreeShippingThreshold(source,'USD'),5000)
  assert.equal(sourceFreeShippingThreshold(source.replace('data-subtotal="0"','data-subtotal="1000"'),'USD'),null)
  assert.equal(sourceFreeShippingThreshold(source,'EUR'),null)
  const before=defaultRegion(db,store.id)!.shipping[0]!
  assert.equal(installSourceCartShipping(db,store.id,source),true)
  assert.equal(defaultRegion(db,store.id)!.shipping[0]!.amountCents,before.amountCents)
  const product=createProduct(db,store.id,{title:'Cushion',status:'draft',variants:[{title:'Default',priceCents:5495,compareAtCents:10990,inventory:100}]})
  const cart=createCart(db,store.id,undefined,{preview:true})
  const selected=addToCart(db,store.id,cart.id,product.variants[0]!.id,1)
  assert.equal(totals(db,store.id,selected).shippingCents,0)
  assert.equal(totals(db,store.id,selected).freeShippingGapCents,0)
  assert.throws(()=>completeCart(db,store.id,cart.id,{email:'test@example.com'}),/Preview checkout/)
  assert.throws(()=>addToCart(db,store.id,createCart(db,store.id).id,product.variants[0]!.id,1),/not available/)
})

test('bundle and cart totals keep the exact sale, comparison and unrelated add-on prices',()=>{
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'Bundle cart'})
  seedDefaultRegion(db,store.id,'USD')
  const product=createProduct(db,store.id,{title:'Draft cushion',variants:[{title:'Default',priceCents:5495,compareAtCents:10990,inventory:100}]})
  const addon=createProduct(db,store.id,{title:'Shipping protection',variants:[{title:'Default',priceCents:299,inventory:100}]})
  upsertBundle(db,store.id,{productId:product.id,tiers:[{quantity:1,unitPriceCents:5495,compareAtTotalCents:10990,discountPercent:0,label:'Buy 1'},{quantity:2,unitPriceCents:4671,compareAtTotalCents:21980,discountPercent:0,label:'Buy 2'},{quantity:4,unitPriceCents:4396,compareAtTotalCents:43960,discountPercent:0,label:'Buy 4'}]})
  const cart=createCart(db,store.id,undefined,{preview:true})
  addToCart(db,store.id,cart.id,product.variants[0]!.id,2)
  const added=addToCart(db,store.id,cart.id,addon.variants[0]!.id,1)
  const quote=totals(db,store.id,added),lines=cartDisplayLines(db,store.id,added,quote)
  assert.deepEqual(lines.map(line=>[line.quantity,line.lineCents,line.compareAtLineCents]),[[2,9342,21980],[1,299,299]])
  assert.equal(lines.reduce((sum,line)=>sum+line.lineCents,0),quote.subtotalCents-quote.discountCents)
  const ctx={db,store,storeUrl:'/preview/test'} as never
  const backend=bundlesPage(ctx)
  assert.match(backend,/Draft cushion/)
  for(const amount of ['54.95','109.90','93.42','219.80','175.84','439.60']) assert.ok(backend.includes('value="'+amount+'"'))
  const discounts=promotionsPage(ctx);assert.ok(discounts.includes('Buy 2: $93.42')&&discounts.includes('View bundle prices'))
  assert.equal(listBundles(db,store.id).length,1)
})

test('a missing source checkout becomes one editable page, and an existing checkout is preserved',()=>{
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'Checkout copy'})
  const checkout=ensureCopiedCheckout(db,store.id)!
  assert.equal(checkout.role,'checkout');assert.equal(checkout.status,'draft')
  assert.equal(checkout.blocks.filter(block=>block.type==='checkout-form').length,1)
  assert.ok(checkout.blocks.every(block=>!['countdown','review-wall','guarantee'].includes(block.type)))
  assert.equal(ensureCopiedCheckout(db,store.id),null)
  assert.equal(listPages(db,store.id).length,1)
})

test('exact-unit discounts stay on the correct variants, including after currency conversion',async()=>{
  const {createRegion,minorUnitRate}=await import('../src/domain/regions.ts')
  const {db,user}=fresh(),store=createStore(db,user.id,{name:'Mixed variants'})
  seedDefaultRegion(db,store.id,'USD')
  const product=createProduct(db,store.id,{title:'Cushion sizes',status:'published',variants:[{title:'Small',priceCents:5495,inventory:100},{title:'Large',priceCents:6495,inventory:100}]})
  upsertBundle(db,store.id,{productId:product.id,tiers:[{quantity:2,unitPriceCents:4671,discountPercent:0,label:'Any two'}]})
  for(const region of [defaultRegion(db,store.id)!,createRegion(db,store.id,{name:'Europe',currency:'EUR',countries:['FR'],exchangeRate:1.234567})]){
    const cart=createCart(db,store.id,region.id)
    addToCart(db,store.id,cart.id,product.variants[0]!.id,1)
    const added=addToCart(db,store.id,cart.id,product.variants[1]!.id,1),quote=totals(db,store.id,added)
    const unit=Math.round(4671*minorUnitRate(region,'USD'))
    assert.deepEqual(cartDisplayLines(db,store.id,added,quote).map(line=>line.lineCents),[unit,unit])
  }
})
