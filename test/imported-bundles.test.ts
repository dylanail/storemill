import test from 'node:test'
import assert from 'node:assert/strict'
import { fresh } from './helpers.ts'
import { copiedBundleFixture } from './fixtures/copied-bundle.ts'
import { planImportedBundle, installImportedBundle, repairImportedBundleHtml } from '../src/pages/imported-bundles.ts'
import { createStore } from '../src/control/stores.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { seedDefaultRegion, defaultRegion, createRegion, minorUnitRate } from '../src/domain/regions.ts'
import { addToCart, createCart, setQuantity, totals } from '../src/domain/cart.ts'
import { applyPromotions, createPromotion } from '../src/domain/promotions.ts'
import { upsertBundle } from '../src/domain/bundles.ts'
import { importedCommerceConfig } from '../src/storefront/imported-commerce.ts'
import { duplicateAsset } from '../src/control/duplicate-asset.ts'
import { blockContextFor, createPage } from '../src/pages/store.ts'
import { templateHtml } from '../src/pages/library.ts'
import { format } from '../src/lib/money.ts'

function setup() {
  const { db, user } = fresh()
  const store = createStore(db,user.id,{name:'Copied bundles'})
  seedDefaultRegion(db,store.id,'USD')
  const product = createProduct(db,store.id,{title:'Cushion',status:'published',variants:[{title:'Default',priceCents:5495,inventory:100}]})
  const original = copiedBundleFixture()
  const plan = planImportedBundle(original,'https://source.example/products/cushion')!
  return {db,store,product,original,plan}
}

test('source bundle extraction preserves captured cards, explicit prices and notes inconsistent marketing without retaining source configuration',()=>{
  const plan=planImportedBundle(copiedBundleFixture(),'https://source.example/products/cushion')!
  assert.deepEqual(plan.tiers.map(tier=>[tier.quantity,tier.totalCents,tier.unitPriceCents]),[[1,5495,5495],[2,9342,4671],[4,17584,4396]])
  assert.ok(plan.html.includes('Extra 16% OFF'))
  assert.ok(plan.notes.some(note=>note.includes('16%')&&note.includes('15.00%')))
  assert.ok(!/source-only-token|storefrontAccessToken|config=|deal-block=|product=/.test(plan.html))
  assert.ok(plan.css.includes('kaching-bundles-styles'))
  assert.equal(plan.hostId,'shopify-block-kaching_bundles-test')
})

test('bundle installation and repeated page repair preserve surrounding edits and install one enforcing rule',()=>{
  const {db,store,product,original,plan}=setup()
  const installed=installImportedBundle(db,store.id,product.id,plan)
  for(let index=0;index<12;index++){
    const saved=original.replace('My edited product title',`Edited page ${index}`)
    const repaired=repairImportedBundleHtml(saved,plan,installed)
    assert.ok(repaired.changed)
    assert.ok(repaired.html.includes(`Edited page ${index}`)&&repaired.html.includes('My edited guarantee'))
    assert.match(repaired.html,/data-copy-bundle-quantity="2" data-copy-bundle-total="9342"/)
    assert.ok(!repaired.html.includes('source-only-token'))
    assert.equal(repairImportedBundleHtml(repaired.html,plan,installed).changed,false)
  }
  assert.equal(installImportedBundle(db,store.id,product.id,plan).bundle.id,installed.bundle.id)
  assert.equal(db.one<{count:number}>('SELECT count(*) count FROM bundles')?.count,1)
  const missing=repairImportedBundleHtml('<h1>Unrelated page</h1>',plan,installed)
  assert.equal(missing.changed,false)
  assert.ok(missing.reason)
  const empty=original.replace(/<kaching-bundle\b[\s\S]*?<\/kaching-bundle>/,'')
  assert.ok(repairImportedBundleHtml(empty,plan,installed).html.includes('data-copy-bundle-quantity="4"'))
})

test('exact server pricing matches the displayed packages, survives cart quantity edits and never discounts an unrelated product',()=>{
  const {db,store,product,plan}=setup()
  installImportedBundle(db,store.id,product.id,plan)
  let cart=addToCart(db,store.id,createCart(db,store.id).id,product.variants[0]!.id,1)
  for(const [quantity,expected] of [[1,5495],[2,9342],[3,14013],[4,17584],[5,21980],[1,5495]]){
    cart=setQuantity(db,store.id,cart.id,product.variants[0]!.id,quantity!)
    const quoted=totals(db,store.id,cart)
    assert.equal(quoted.subtotalCents-quoted.discountCents,expected)
  }
  cart=setQuantity(db,store.id,cart.id,product.variants[0]!.id,2)
  const other=createProduct(db,store.id,{title:'Unrelated',status:'published',variants:[{title:'Default',priceCents:2000,inventory:10}]})
  cart=addToCart(db,store.id,cart.id,other.variants[0]!.id,1)
  const combined=totals(db,store.id,cart)
  assert.equal(combined.subtotalCents-combined.discountCents,9342+2000)
})

test('source and catalog validation reject unsupported subscriptions, price mismatches, unrelated variants and conflicting merchant rules',()=>{
  const {db,store,product,original,plan}=setup()
  assert.throws(()=>planImportedBundle(original.replace('sellingPlanEnabled&quot;:false','sellingPlanEnabled&quot;:true'),plan.sourceUrl),/unsupported subscription/)
  assert.throws(()=>planImportedBundle(original.replace('$93.42','$93.41'),plan.sourceUrl),/visible price differs/)
  const wrong=createProduct(db,store.id,{title:'Wrong price',variants:[{title:'Default',priceCents:5000,inventory:1}]})
  assert.throws(()=>installImportedBundle(db,store.id,wrong.id,plan),/unit price matches/)
  db.update('products',product.id,{metadata:{['sourceVariant:'+product.variants[0]!.id]:'another-source'}})
  assert.throws(()=>installImportedBundle(db,store.id,product.id,plan),/different source variant/)
  db.update('products',product.id,{metadata:{}})
  upsertBundle(db,store.id,{productId:product.id,tiers:[{quantity:2,discountPercent:10,label:'Merchant deal'}]})
  assert.throws(()=>installImportedBundle(db,store.id,product.id,plan),/different bundle rules/)
})

test('invalid exact-unit rules cannot become zero-price, unscoped, negative or more expensive offers',()=>{
  const {db,store,product}=setup()
  for(const tier of [{quantity:0,unitPriceCents:4671},{quantity:2,unitPriceCents:0},{quantity:2,unitPriceCents:-1},{quantity:2,unitPriceCents:6000}]) assert.throws(()=>upsertBundle(db,store.id,{productId:product.id,tiers:[{...tier,discountPercent:0,label:'Invalid'}]}))
  for(const rules of [{tiers:[{quantity:2,percent:0,unitPriceCents:1}]},{productIds:[product.id],tiers:[{quantity:0,percent:0,unitPriceCents:1}]},{productIds:[product.id],tiers:[{quantity:2,percent:0,unitPriceCents:-1}]}]) createPromotion(db,store.id,{kind:'tiered',title:'Invalid direct rule',automatic:true,rules})
  const items=[{productId:product.id,variantId:product.variants[0]!.id,title:product.title,variantTitle:'Default',image:'',unitCents:5495,quantity:2}]
  assert.equal(applyPromotions(db,store.id,items,{subtotalCents:10990}).discountCents,0)
})

test('the runtime receives bundle quotes calculated by the active server promotion engine',()=>{
  const {db,store,product,plan}=setup()
  const installed=installImportedBundle(db,store.id,product.id,plan)
  const config=importedCommerceConfig({db,store,region:defaultRegion(db,store.id),base:'/s/test',preview:false} as never,{role:'pdp',productId:product.id,sourceUrl:plan.sourceUrl} as never)
  assert.deepEqual(config.products[0]!.bundle!.tiers.map(tier=>[tier.quantity,tier.totalCents]),[[1,5495],[2,9342],[4,17584]])
  db.update('promotions',installed.bundle.promotionId!,{status:'disabled'})
  const changed=importedCommerceConfig({db,store,region:defaultRegion(db,store.id),base:'/s/test',preview:false} as never,{role:'pdp',productId:product.id,sourceUrl:plan.sourceUrl} as never)
  assert.equal(changed.products[0]!.bundle!.tiers.find(tier=>tier.quantity===2)?.totalCents,10990,'disabled rules cannot leave a stale discounted quote')
})

test('non-USD exact bundle prices use one unrounded conversion in cart, copied cards and native widgets',()=>{
  const {db,store,product,plan}=setup()
  installImportedBundle(db,store.id,product.id,plan)
  for(const [currency,exchangeRate] of [['EUR',1.234567],['JPY',140.635]] as const){
    const region=createRegion(db,store.id,{name:currency,currency,exchangeRate,countries:[currency==='JPY'?'JP':'FR']})
    const rate=minorUnitRate(region,store.currency)
    const expected=Math.round(4671*rate)*2
    const cart=addToCart(db,store.id,createCart(db,store.id,region.id).id,product.variants[0]!.id,2)
    const price=totals(db,store.id,cart)
    assert.equal(price.subtotalCents-price.discountCents,expected)
    const config=importedCommerceConfig({db,store,region,base:'/s/test',preview:false} as never,{role:'pdp',productId:product.id,sourceUrl:plan.sourceUrl} as never)
    assert.equal(config.products[0]!.bundle!.tiers.find(tier=>tier.quantity===2)?.totalCents,expected)
    assert.equal(config.products[0]!.bundle!.tiers.find(tier=>tier.quantity===2)?.baseTotalCents,9342)
    const native=blockContextFor(db,store,'/s/test',region).bundles?.[0]?.html??''
    assert.ok(native.includes(format(expected,currency,region.locale)))
  }
})

test('duplicating a store remaps bundle, product and variant bindings; cross-site templates discard the old bundle identifier',()=>{
  const {db,store,product,plan}=setup()
  const installed=installImportedBundle(db,store.id,product.id,plan)
  createPage(db,store.id,{title:'Bundle page',handle:'bundle-page',mode:'html',rawHtml:installed.html,productId:product.id})
  const copy=duplicateAsset(db,store.ownerId,store.id,{name:'Independent bundle copy'})
  const copiedPage=copy.pages.find(page=>page.handle==='bundle-page')!
  const copiedBundle=db.one<{id:string;product_id:string}>('SELECT id,product_id FROM bundles WHERE store_id = ?',copy.store.id)!
  assert.notEqual(copiedBundle.id,installed.bundle.id)
  assert.ok(copiedPage.rawHtml.includes(`data-copy-bundle="${copiedBundle.id}"`))
  assert.ok(copiedPage.rawHtml.includes(`data-copy-product-id="${copiedBundle.product_id}"`))
  assert.ok(!copiedPage.rawHtml.includes(product.variants[0]!.id))
  const reused=templateHtml(installed.html,'prod_destination')
  assert.ok(!reused.includes(installed.bundle.id)&&!reused.includes(product.variants[0]!.id))
  assert.ok(reused.includes('data-copy-bundle="" data-copy-bundle-template=""'))
  assert.ok(reused.includes('data-copy-product-id="prod_destination"'))
  assert.equal(templateHtml(reused,'prod_destination'),reused)
})
