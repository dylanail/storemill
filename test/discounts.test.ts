import test from 'node:test'
import assert from 'node:assert/strict'
import { fresh } from './helpers.ts'
import { createStore } from '../src/control/stores.ts'
import { createProduct, createCollection } from '../src/domain/catalog.ts'
import { createRegion, seedDefaultRegion, defaultRegion } from '../src/domain/regions.ts'
import { createPromotion, listPromotions, applyPromotions } from '../src/domain/promotions.ts'
import { upsertBundle, listBundles, renderBundleWidget } from '../src/domain/bundles.ts'
import { addToCart, createCart, setQuantity, totals } from '../src/domain/cart.ts'
import { discountData, saveDiscount, previewDiscount, changeDiscountStatus } from '../src/control/discounts.ts'
import { cartDisplayLines } from '../src/domain/cart-prices.ts'
import { quantityPrice } from '../src/domain/quantity-pricing.ts'
import type { LineItem } from '../src/domain/types.ts'

function setup(currency='USD') {
 const {db,user}=fresh(),store=createStore(db,user.id,{name:'Discount studio',currency})
 seedDefaultRegion(db,store.id,currency)
 const product=createProduct(db,store.id,{title:'Cushion',status:'published',variants:[{title:'Black',priceCents:5495,compareAtCents:10990,inventory:100},{title:'Gray',priceCents:5995,compareAtCents:11990,inventory:100}]})
 const gift=createProduct(db,store.id,{title:'Travel cover',status:'published',variants:[{title:'Default',priceCents:1500,inventory:100}]})
 const draft=(patch:any={})=>({type:'amount',title:'Test offer',entity:'promotion',method:'automatic',amountType:'percentage',value:'10',scope:'all',combinable:true,regionScope:'all',...patch})
 const line=(p=product,quantity=1):LineItem=>({productId:p.id,variantId:p.variants[0]!.id,title:p.title,variantTitle:p.variants[0]!.title,image:'',unitCents:p.variants[0]!.priceCents,quantity})
 return {db,user,store,product,gift,draft,line}
}

test('Nuvana exact source tiers round trip through named controls, preserve originals and stay one visible offer',()=>{
 const {db,user,store,product}=setup()
 upsertBundle(db,store.id,{productId:product.id,title:'Choose your cushion',tiers:[{quantity:1,discountPercent:0,unitPriceCents:5495,compareAtTotalCents:10990,label:'Buy 1'},{quantity:2,discountPercent:15,unitPriceCents:4671,compareAtTotalCents:21980,label:'Buy 2',badge:'Most popular'},{quantity:4,discountPercent:20,unitPriceCents:4396,compareAtTotalCents:43960,label:'Buy 4',badge:'Best value'}]})
 const offer=discountData(db,store).offers[0]!
 assert.deepEqual(offer.tiers.map((t:any)=>[t.quantity,t.value,t.compare]),[[1,'54.95','109.90'],[2,'93.42','219.80'],[4,'175.84','439.60']])
 const saved=saveDiscount(db,store,offer,user.id)
 assert.equal(saved.offers.length,1);assert.equal(saved.id,offer.id);assert.equal(saved.offers[0].pricingMode,'bulk')
 assert.equal(listPromotions(db,store.id).filter(p=>p.status==='active').length,1)
 let cart=addToCart(db,store.id,createCart(db,store.id).id,product.variants[0]!.id,1)
 for(const [qty,expected] of [[1,5495],[2,9342],[3,14013],[4,17584],[5,21980]]){cart=setQuantity(db,store.id,cart.id,product.variants[0]!.id,qty!);const result=totals(db,store.id,cart);assert.equal(result.subtotalCents-result.discountCents,expected)}
})

test('complete multipacks and bulk thresholds intentionally give different prices for leftover units',()=>{
 const {db,user,store,gift,draft}=setup()
 const offer=draft({type:'quantity',entity:'bundle',productId:gift.id,pricingMode:'multiples',tiers:[{quantity:2,priceType:'total',value:'19.99',label:'Buy 2'}]})
 saveDiscount(db,store,offer,user.id)
 let cart=addToCart(db,store.id,createCart(db,store.id).id,gift.variants[0]!.id,1)
 for(const [qty,expected] of [[1,1500],[2,1999],[3,3499],[4,3998],[5,5498],[6,5997]]){cart=setQuantity(db,store.id,cart.id,gift.variants[0]!.id,qty!);const result=totals(db,store.id,cart);assert.equal(result.subtotalCents-result.discountCents,expected)}
 const edit=discountData(db,store).offers[0];edit.pricingMode='bulk';saveDiscount(db,store,edit,user.id)
 cart=setQuantity(db,store.id,cart.id,gift.variants[0]!.id,3);const result=totals(db,store.id,cart);assert.equal(result.subtotalCents-result.discountCents,2999)
})

test('pack combinations choose the best fitting price and percentage bulk discounts round only once',()=>{
 const tiers=[{quantity:2,totalPriceCents:1999},{quantity:3,totalPriceCents:2400}]
 assert.equal(quantityPrice(tiers,7,1500,'multiples'),6300)
 assert.equal(quantityPrice(tiers,6,1500,'multiples'),4800)
 assert.equal(quantityPrice([{quantity:2,percent:15}],3,5495,'bulk'),14012)
})

test('price preview is read-only and matches the actual cart for exact packs, shipping and tier gifts',()=>{
 const {db,user,store,product,gift,draft}=setup()
 const offer=draft({type:'quantity',entity:'bundle',productId:product.id,pricingMode:'multiples',tiers:[{quantity:1,priceType:'percent',value:'0'},{quantity:2,priceType:'total',value:'93.41',freeShipping:true,giftVariantId:gift.variants[0]!.id,giftLabel:'Free travel cover'}]})
 const before=db.one<{n:number}>('SELECT total_changes() n')!.n
 const preview=previewDiscount(db,store,{...offer,sample:[{variantId:product.variants[0]!.id,quantity:2}]})
 assert.equal(db.one<{n:number}>('SELECT total_changes() n')!.n,before)
 assert.equal(preview.totalCents,9341);assert.equal(preview.freeShipping,true);assert.equal(preview.gift,'Free travel cover')
 saveDiscount(db,store,offer,user.id)
 let cart=addToCart(db,store.id,createCart(db,store.id).id,product.variants[0]!.id,2)
 let result=totals(db,store.id,cart);assert.equal(result.subtotalCents-result.discountCents,preview.totalCents);assert.equal(result.shippingCents,0);assert.ok(cart.items.some(i=>i.giftOf))
 cart=setQuantity(db,store.id,cart.id,product.variants[0]!.id,1);result=totals(db,store.id,cart);assert.equal(result.discountCents,0);assert.equal(cart.items.some(i=>i.giftOf),false)
})

test('more than five tiers survive saving; duplicates and invalid prices never silently clamp',()=>{
 const {db,user,store,product,draft}=setup()
 const offer=draft({type:'quantity',entity:'bundle',productId:product.id,pricingMode:'bulk',tiers:Array.from({length:8},(_,i)=>({quantity:i+1,priceType:'percent',value:String(i*5)}))})
 const saved=saveDiscount(db,store,offer,user.id);assert.equal(saved.offers[0].tiers.length,8)
 for(const tiers of [[],Array.from({length:21},(_,i)=>({quantity:i+1,priceType:'percent',value:'5'})),[{quantity:2,priceType:'percent',value:'10'},{quantity:2,priceType:'percent',value:'20'}],[{quantity:1.5,priceType:'percent',value:'10'}],[{quantity:2,priceType:'percent',value:'101'}],[{quantity:2,priceType:'total',value:'200'}],[{quantity:2,priceType:'total',value:'19.999'}],[{quantity:2,priceType:'total',value:'19.99',compare:'10.00'}]]) assert.throws(()=>saveDiscount(db,store,{...saved.offers[0],tiers},user.id))
 assert.equal(listBundles(db,store.id)[0]!.tiers.length,8)
})

test('editing is scoped, rejects stale revisions and cannot replace another product offer accidentally',()=>{
 const {db,user,store,product,draft}=setup()
 const saved=saveDiscount(db,store,draft({type:'quantity',productId:product.id,pricingMode:'bulk',tiers:[{quantity:2,priceType:'percent',value:'10'}]}),user.id)
 const original=saved.offers[0];saveDiscount(db,store,{...original,title:'Changed elsewhere'},user.id)
 assert.throws(()=>saveDiscount(db,store,original,user.id),/another tab/)
 assert.throws(()=>saveDiscount(db,store,{...original,id:undefined},user.id),/already has/)
 const other=createStore(db,user.id,{name:'Other shop'})
 assert.throws(()=>saveDiscount(db,other,original,user.id),/from this store/)
 assert.throws(()=>previewDiscount(db,store,draft({sample:[{variantId:'foreign',quantity:1}]})),/test item from this store/)
})

test('deactivation and reactivation keep all product pricing and perks together',()=>{
 const {db,user,store,product,draft,line}=setup()
 const saved=saveDiscount(db,store,draft({type:'quantity',productId:product.id,pricingMode:'multiples',tiers:[{quantity:2,priceType:'percent',value:'15',freeShipping:true}]}),user.id)
 const items=[line(product,2)],quote=()=>applyPromotions(db,store.id,items,{subtotalCents:10990})
 assert.equal(quote().discountCents,1648);assert.equal(quote().freeShipping,true)
 changeDiscountStatus(db,store,{id:saved.id,entity:'bundle',active:false});assert.equal(quote().discountCents,0);assert.equal(quote().freeShipping,false)
 changeDiscountStatus(db,store,{id:saved.id,entity:'bundle',active:true});assert.equal(quote().discountCents,1648);assert.equal(listBundles(db,store.id)[0]!.pricingMode,'multiples')
})

for(const [amountType,value,expected] of [['percentage','10',550],['fixed','19.99',1999]] as const)test(`${amountType} codes apply only after entering the code`,()=>{
 const {db,user,store,draft,line}=setup()
 saveDiscount(db,store,draft({method:'code',code:'hello10',amountType,value}),user.id)
 const items=[line()];assert.equal(applyPromotions(db,store.id,items,{subtotalCents:5495}).discountCents,0)
 assert.equal(applyPromotions(db,store.id,items,{subtotalCents:5495,code:'HELLO10'}).discountCents,expected)
 assert.throws(()=>saveDiscount(db,store,draft({method:'code',code:'HELLO10'}),user.id),/already exists/)
})

test('mixed product, variant and collection selection and multiple markets round trip without losing restrictions',()=>{
 const {db,user,store,product,gift,line}=setup(),collection=createCollection(db,store.id,{title:'Accessories',productIds:[gift.id]}),region=defaultRegion(db,store.id)!,canada=createRegion(db,store.id,{name:'Canada',currency:'CAD',countries:['CA']})
 const promotion=createPromotion(db,store.id,{kind:'percentage',title:'Member offer',value:10,automatic:true,rules:{productIds:[product.id],variantIds:[gift.variants[0]!.id],collectionIds:[collection.id],regionIds:[region.id,canada.id],firstOrderOnly:true,maxUses:10,minSubtotalCents:6000}})
 const dto=discountData(db,store).offers[0];assert.equal(dto.scope,'selection');assert.equal(dto.regionIds.length,2)
 saveDiscount(db,store,dto,user.id)
 const saved=listPromotions(db,store.id).find(p=>p.id===promotion.id)!;assert.deepEqual(saved.rules.productIds,[product.id]);assert.deepEqual(saved.rules.collectionIds,[collection.id]);assert.deepEqual(saved.rules.variantIds,[gift.variants[0]!.id]);assert.deepEqual(saved.rules.regionIds,[region.id,canada.id])
 const items=[line(),line(gift)],opts={subtotalCents:6995,regionId:canada.id,isFirstOrder:true}
 assert.equal(applyPromotions(db,store.id,items,opts).discountCents,700)
 for(const patch of [{regionId:'other'},{isFirstOrder:false},{subtotalCents:5999}])assert.equal(applyPromotions(db,store.id,items,{...opts,...patch}).discountCents,0)
 db.update('promotions',promotion.id,{usage_count:10});assert.equal(applyPromotions(db,store.id,items,opts).discountCents,0)
})

test('bulk percentages span eligible collections; exact bulk prices require one product',()=>{
 const {db,user,store,product,gift,draft,line}=setup(),collection=createCollection(db,store.id,{title:'Comfort',productIds:[product.id,gift.id]})
 const offer=draft({type:'tiered',scope:'collections',collectionIds:[collection.id],tiers:[{quantity:2,priceType:'percent',value:'10'},{quantity:4,priceType:'percent',value:'20'}]})
 saveDiscount(db,store,offer,user.id)
 assert.equal(applyPromotions(db,store.id,[line(product,2),line(gift,2)],{subtotalCents:13990}).discountCents,2798)
 assert.throws(()=>saveDiscount(db,store,{...offer,tiers:[{quantity:2,priceType:'total',value:'19.99'}]},user.id),/one eligible product/)
})

test('buy X get Y supports same-item rewards and different products without discounting order bumps',()=>{
 const {db,user,store,product,gift,draft,line}=setup()
 let saved=saveDiscount(db,store,draft({type:'bogo',value:'100',buyQuantity:2,getQuantity:1,rewardScope:'same',scope:'products',productIds:[product.id]}),user.id)
 assert.equal(applyPromotions(db,store.id,[line(product,2)],{subtotalCents:10990}).discountCents,0)
 assert.equal(applyPromotions(db,store.id,[line(product,3)],{subtotalCents:16485}).discountCents,5495)
 changeDiscountStatus(db,store,{id:saved.id,active:false})
 saved=saveDiscount(db,store,draft({type:'bogo',value:'50',buyQuantity:1,getQuantity:2,rewardScope:'different',buyProductIds:[product.id],getProductIds:[gift.id]}),user.id)
 assert.equal(applyPromotions(db,store.id,[line(product,1),line(gift,3)],{subtotalCents:9995}).discountCents,1500)
 assert.equal(applyPromotions(db,store.id,[line(),{...line(gift,2),source:'order-bump'}],{subtotalCents:8495}).discountCents,0)
 assert.throws(()=>saveDiscount(db,store,draft({type:'bogo',value:100,buyQuantity:1,getQuantity:1,rewardScope:'different',buyProductIds:[product.id],getProductIds:[product.id]}),user.id),/different buy and reward/)
})

test('mix-and-match requires different products, and set prices repeat only on complete sets',()=>{
 const {db,user,store,product,gift,draft,line}=setup()
 const saved=saveDiscount(db,store,draft({type:'mix_match',value:'20',requiredDistinctProducts:2}),user.id)
 assert.equal(applyPromotions(db,store.id,[line(product,2)],{subtotalCents:10990}).discountCents,0)
 assert.equal(applyPromotions(db,store.id,[line(),line(gift)],{subtotalCents:6995}).discountCents,1399)
 changeDiscountStatus(db,store,{id:saved.id,active:false})
 saveDiscount(db,store,draft({type:'fixed_bundle',setQuantity:2,bundlePrice:'60.00'}),user.id)
 for(const [qty,expected] of [[2,4990],[3,4990],[4,9980],[5,9980]])assert.equal(applyPromotions(db,store.id,[line(product,qty!)],{subtotalCents:5495*qty!}).discountCents,expected)
 assert.equal(applyPromotions(db,store.id,[line(product,2),line(gift)],{subtotalCents:12490}).discountCents,4990,'the spare gift keeps its full price')
})

test('exclusive offers apply alone, including free delivery, and scheduled dates are enforced',()=>{
 const {db,user,store,draft,line}=setup()
 saveDiscount(db,store,draft({value:'10',priority:100}),user.id)
 let saved=saveDiscount(db,store,draft({value:'20',combinable:false}),user.id)
 const quote=()=>applyPromotions(db,store.id,[line()],{subtotalCents:5495})
 assert.equal(quote().discountCents,1099);assert.equal(quote().applied.length,1)
 changeDiscountStatus(db,store,{id:saved.id,active:false})
 saved=saveDiscount(db,store,draft({type:'free_shipping',combinable:false,minSubtotal:'50.00'}),user.id)
 assert.equal(quote().discountCents,0);assert.equal(quote().freeShipping,true)
 changeDiscountStatus(db,store,{id:saved.id,active:false})
 saved=saveDiscount(db,store,draft({value:'50',startsAt:'2099-01-01T00:00:00Z',endsAt:'2099-02-01T00:00:00Z'}),user.id)
 assert.equal(saved.offers.find(o=>o.id===saved.id).status,'scheduled');assert.equal(quote().discountCents,550)
 assert.throws(()=>saveDiscount(db,store,draft({startsAt:'2099-02-01',endsAt:'2099-01-01'}),user.id),/end date/)
})

test('variant quotes preserve exact total and original prices; localized prices convert to minor units',()=>{
 const {db,store,product}=setup()
 const bundle=upsertBundle(db,store.id,{productId:product.id,pricingMode:'multiples',tiers:[{quantity:2,discountPercent:0,totalPriceCents:9341,compareAtTotalCents:21980,label:'Buy 2'}]})
 const html=renderBundleWidget(bundle,product,'USD')
 const quotes=JSON.parse(html.match(/data-variant-prices="([^"]*)"/)![1]!.replace(/&quot;/g,'"').replace(/&#39;/g,"'"))
 assert.equal(quotes[product.variants[1]!.id].total,'$93.41');assert.equal(quotes[product.variants[1]!.id].compare,'$219.80');assert.match(quotes[product.variants[1]!.id].each,/≈/)
 const localized=renderBundleWidget(bundle,product,'JPY',{currencyRate:1.5,locale:'ja-JP'})
 assert.match(localized,/14,012/)
 const result=applyPromotions(db,store.id,[{productId:product.id,variantId:product.variants[0]!.id,title:product.title,variantTitle:'Black',image:'',unitCents:8243,quantity:2}],{subtotalCents:16486,currencyRate:1.5})
 assert.equal(16486-result.discountCents,14012)
})

test('zero-decimal currencies accept whole prices and reject fractional currency input',()=>{
 const {db,user,store,product,draft}=setup('JPY')
 saveDiscount(db,store,draft({type:'quantity',productId:product.id,pricingMode:'multiples',tiers:[{quantity:2,priceType:'total',value:'1999'}]}),user.id)
 assert.equal(listBundles(db,store.id)[0]!.tiers[0]!.totalPriceCents,1999)
 const dto=discountData(db,store).offers[0];assert.throws(()=>saveDiscount(db,store,{...dto,tiers:[{quantity:2,priceType:'total',value:'1999.5'}]},user.id),/JPY/)
})

test('an exact price equal to the cheapest variant still discounts a more expensive variant',()=>{
 const {db,user,store,product,draft}=setup()
 saveDiscount(db,store,draft({type:'quantity',productId:product.id,pricingMode:'bulk',tiers:[{quantity:1,priceType:'total',value:'54.95'}]}),user.id)
 const cart=addToCart(db,store.id,createCart(db,store.id).id,product.variants[1]!.id,1),quote=totals(db,store.id,cart)
 assert.equal(quote.subtotalCents-quote.discountCents,5495)
})

test('set-price savings leave spare product lines at their original price',()=>{
 const {db,user,store,product,gift,draft}=setup()
 saveDiscount(db,store,draft({type:'fixed_bundle',setQuantity:2,bundlePrice:'60.00'}),user.id)
 let cart=addToCart(db,store.id,createCart(db,store.id).id,product.variants[0]!.id,2)
 cart=addToCart(db,store.id,cart.id,gift.variants[0]!.id,1)
 const lines=cartDisplayLines(db,store.id,cart,totals(db,store.id,cart))
 assert.deepEqual(lines.map(line=>line.lineCents),[6000,1500])
})

test('the list identifies ended and exhausted offers and activation explains which requirement needs editing',()=>{
 const {db,user,store,draft}=setup()
 const ended=saveDiscount(db,store,draft({endsAt:'2020-01-01T00:00:00Z'}),user.id)
 assert.equal(ended.offers.find(o=>o.id===ended.id).status,'expired')
 assert.throws(()=>changeDiscountStatus(db,store,{id:ended.id,active:true}),/end date/)
 const limited=saveDiscount(db,store,draft({maxUses:1}),user.id);db.update('promotions',limited.id,{usage_count:1})
 assert.equal(discountData(db,store).offers.find(o=>o.id===limited.id).status,'exhausted')
 assert.throws(()=>changeDiscountStatus(db,store,{id:limited.id,active:true}),/use limit/)
})
