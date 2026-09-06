import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createStore, environment } from '../src/control/stores.ts'
import { createProduct, getVariant } from '../src/domain/catalog.ts'
import { seedDefaultRegion } from '../src/domain/regions.ts'
import { createCart, addToCart, attachPaymentIntent, saveCheckoutDraft, getCart } from '../src/domain/cart.ts'
import { completeStripeCart, paymentTotals } from '../src/payments/checkout.ts'
import { importedCommerceConfig, protectImportedForms } from '../src/storefront/imported-commerce.ts'
import { createFromImport, importProductFromUrl } from '../src/domain/ops.ts'
import { createPage } from '../src/pages/store.ts'
import type { PaymentIntent } from '../src/payments/stripe.ts'

function checkout() {
  const {db,user}=fresh();const store=createStore(db,user.id,{name:'Copied shop'});seedDefaultRegion(db,store.id,'USD');
  const product=createProduct(db,store.id,{title:'Cushion',status:'published',metadata:{private:'do not expose'},supplier:{url:'https://source.example/products/cushion',costCents:100},variants:[{title:'Blue',priceCents:5495,inventory:20}]});
  const variant=product.variants[0]!;let cart=addToCart(db,store.id,createCart(db,store.id).id,variant.id,2);
  saveCheckoutDraft(db,store.id,cart.id,{email:'shopper@example.com',name:'Test Shopper',address:{line1:'1 Main Street',city:'Phoenix',postal:'85001',country:'US'}});attachPaymentIntent(db,store.id,cart.id,'pi_ours');cart=getCart(db,store.id,cart.id)!;
  const amount=paymentTotals(db,store.id,cart);
  const intent:PaymentIntent={id:'pi_ours',status:'succeeded',amount:amount.totalCents,currency:'usd',metadata:{storeId:store.id,cartId:cart.id}};
  return {db,store,product,variant,cart,intent};
}

test('Stripe completion checks cart ownership, amount, currency and succeeded before creating an order',()=>{
  const {db,store,variant,cart,intent}=checkout();
  for(const wrong of [{id:'pi_other'},{metadata:{storeId:store.id,cartId:'other'}},{metadata:{storeId:'other',cartId:cart.id}},{metadata:{}},{amount:intent.amount-1},{currency:'eur'},{status:'processing'},{status:'requires_action'}]) {
    assert.throws(()=>completeStripeCart(db,store.id,cart,{...intent,...wrong} as PaymentIntent));
    assert.equal(db.one<{c:number}>('SELECT COUNT(*) c FROM orders')?.c,0);
    assert.equal(getVariant(db,store.id,variant.id)?.inventory,20);
  }
  const paid=completeStripeCart(db,store.id,cart,intent);assert.equal(paid.created,true);assert.equal(paid.order.paymentStatus,'captured');assert.equal(getVariant(db,store.id,variant.id)?.inventory,18);
  const duplicate=completeStripeCart(db,store.id,cart,intent);assert.equal(duplicate.created,false);assert.equal(duplicate.order.id,paid.order.id);assert.equal(getVariant(db,store.id,variant.id)?.inventory,18);
});

test('imported checkout exposes public catalog data and neutralizes source submissions and scripts',()=>{
  const {db,store,product,cart}=checkout();const page=createPage(db,store.id,{title:'Copied',sourceUrl:'https://source.example',productId:product.id});
  const config=JSON.stringify(importedCommerceConfig({db,store,cart,env:environment(db,store.id,'draft'),base:'/s/copied',preview:false,totals:null},page));
  assert.ok(config.includes('Cushion'));assert.ok(!config.includes('costCents'));assert.ok(!config.includes('do not expose'));
  const html=protectImportedForms('<form action="https://payments.source.example/pay" onsubmit=send()><input name="email"><button formaction="https://source.example/charge">Pay</button></form><script src="https://source.example/pay.js"></script><script type="application/json" data-pb-document>{}</script>','/s/copied');
  assert.match(html,/action="\/s\/copied\/checkout"/);assert.doesNotMatch(html,/onsubmit=|formaction=|<script src=/);assert.match(html,/data-pb-document/);
});

test('Shopify imports retain exact source variant mapping and option values without exposing supplier data',async()=>{
  const {db,store}=checkout();
  const imported=await importProductFromUrl('https://source.example/products/shirt',(async()=>new Response(JSON.stringify({product:{title:'Shirt',options:[{name:'Size',values:['Small','Large']}],variants:[{id:101,title:'Small',option1:'Small',price:'19.00'},{id:102,title:'Large',option1:'Large',price:'21.00'}]}}),{headers:{'content-type':'application/json'}})) as typeof fetch);
  const product=createFromImport(db,store.id,imported,{status:'published'});
  assert.equal(product.metadata[`sourceVariant:${product.variants[1]!.id}`],'102');assert.deepEqual(product.variants[1]!.optionValues,{Size:'Large'});
});


test('editor payment placeholders cannot collect or submit card data', () => {
  const source = '<form class="fk-card-payment-container"><input id="source-card" name="cardNumber" value="sensitive-source-value" autocomplete="cc-number" placeholder="Card number"><button>Pay now</button></form>'
  const preview = protectImportedForms(source, '/s/copy', { previewPaymentFields: true })
  assert.match(preview, /data-copy-payment-placeholder/)
  assert.match(preview, /disabled readonly/)
  assert.match(preview, /action="\/s\/copy\/checkout"/)
  assert.doesNotMatch(preview, /name="cardNumber"|sensitive-source-value|autocomplete="cc-number"/)
  assert.doesNotMatch(protectImportedForms(source, '/s/copy'), /<input/)
})
