import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'funnel-checkout-'));process.env.AMBORAS_DB=join(dir,'test.db');process.env.PORT='0';process.env.AMBORAS_LOG_LEVEL='error';process.env.AMBORAS_STOREFRONT_HOST='';process.env.AMBORAS_PUBLIC_ORIGIN='';process.env.AMBORAS_ADMIN_HOST='';
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');
const {register}=await import('../src/control/auth.ts');
const {createStore}=await import('../src/control/stores.ts');
const {createProduct}=await import('../src/domain/catalog.ts');
const {seedDefaultRegion}=await import('../src/domain/regions.ts');
const {createPage}=await import('../src/pages/store.ts');
const {upsertBundle}=await import('../src/domain/bundles.ts');
const {install}=await import('../src/control/plugins.ts');
const {useStripeTransport}=await import('../src/payments/stripe.ts');
const {editorPage}=await import('../src/admin/editor.ts');
const db=getDb(),user=register(db,{email:'funnel-checkout@example.com',password:'test-password-long'});
const funnel=createStore(db,user.id,{name:'Funnel checkout',kind:'funnel'}),store=createStore(db,user.id,{name:'Store drawer',kind:'store'}),unavailable=createStore(db,user.id,{name:'Draft funnel',kind:'funnel'});
for(const asset of[funnel,store,unavailable]){seedDefaultRegion(db,asset.id,'USD');db.update('stores',asset.id,{status:'live'});}
const product=createProduct(db,funnel.id,{title:'Cushion',status:'published',variants:[{title:'Default',priceCents:5495,inventory:100}]});
upsertBundle(db,funnel.id,{productId:product.id,title:'Buy more',tiers:[{quantity:1,unitPriceCents:5495},{quantity:2,unitPriceCents:4671},{quantity:4,unitPriceCents:4396}]});
const draft=createProduct(db,funnel.id,{title:'Unpublished secret',status:'draft',variants:[{title:'Draft',priceCents:999,inventory:100}]});
createProduct(db,unavailable.id,{title:'Draft package',status:'draft',variants:[{title:'Draft',priceCents:5495,inventory:100}]});
const storeProduct=createProduct(db,store.id,{title:'Store cushion',status:'published',variants:[{title:'Blue',priceCents:5495,inventory:100},{title:'Green',priceCents:5995,inventory:100}]});
const drawer='<cart-drawer id="CartDrawer" hidden><div class="drawer__inner"><h2>Our cart design</h2><button class="drawer__close">Close cart</button><div data-cart-items></div><a href="/checkout">Checkout</a></div></cart-drawer>';
const source='<html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px system-ui}main{padding:20px}button{padding:12px}cart-drawer{position:fixed;inset:0;display:none;background:#0002}.drawer__inner{width:360px;max-width:100%;height:100%;margin-left:auto;padding:20px;box-sizing:border-box;background:white;transform:translateX(100%)}cart-drawer.active{display:flex}</style></head><body><main><h1>Original sales page</h1><button name="add">Add to cart</button><a href="/cart">Cart</a></main>'+drawer+'</body></html>';
for(const[asset,item]of[[funnel,product],[store,storeProduct]])createPage(db,asset.id,{title:'Sales',handle:'sales',mode:'html',role:'pdp',status:'published',sourceUrl:'https://source.example/products/cushion',productId:item.id,rawHtml:source.replace('<button name="add">','<button name="add" data-variant-id="'+item.variants[0].id+'">')});
createPage(db,funnel.id,{title:'Copied checkout',handle:'copied-checkout',mode:'html',role:'checkout',status:'published',sourceUrl:'https://source.example/checkout',rawHtml:'<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><h1>Original checkout design</h1><div><main class="basic-information-section">Source payment form</main><aside class="sidebar">Old source order</aside></div></body></html>'});
install(db,funnel.id,'stripe',{publishableKey:'pk_test_fixture',secretKey:'sk_test_fixture'});
const intents=new Map();let sequence=0,beforeCancel=null;
useStripeTransport(async(path,init)=>{
  if(path==='/v1/customers')return{ok:true,status:200,json:async()=>({id:'cus_fixture'})};
  let intent;
  if(path==='/v1/payment_intents'){const body=new URLSearchParams(init.body);intent={id:'pi_fixture_'+(++sequence),status:'requires_payment_method',amount:Number(body.get('amount')),currency:body.get('currency'),metadata:{storeId:body.get('metadata[storeId]'),cartId:body.get('metadata[cartId]')}};intent.client_secret=intent.id+'_secret';intents.set(intent.id,intent);}
  else{const bits=path.split('/');intent=intents.get(bits[3]);if(intent&&bits[4]==='cancel'){if(beforeCancel){const hook=beforeCancel;beforeCancel=null;hook(intent);}intent.status='canceled';}else if(intent&&init.method==='POST'){const body=new URLSearchParams(init.body);intent.amount=Number(body.get('amount')||intent.amount);}}
  return{ok:!!intent,status:intent?200:404,json:async()=>intent||{error:{message:'No fixture intent'}}};
});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port,base='/s/'+funnel.slug,storeBase='/s/'+store.slug;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));useStripeTransport(null);rmSync(dir,{recursive:true,force:true});});
const stripeMock=`window.Stripe=function(){return {elements:function(options){window.STRIPE_AMOUNT=options.amount;return {create:function(){return {mount:function(){},on:function(){}}},submit:async()=>({}),update:function(next){window.STRIPE_AMOUNT=next.amount}}},confirmPayment:async function(input){window.CONFIRMED_SECRET=input.clientSecret;return {error:{message:'Fixture card declined'}}}}};`;
async function contextFor(width=390){const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.request().url()==='https://js.stripe.com/v3/'?route.fulfill({contentType:'text/javascript',body:stripeMock}):route.abort());return context;}
const post=(context,path,data)=>context.request.post(origin+path,{headers:{accept:'application/json'},data});

for(const width of[320,390,820,1440])test(`empty copied funnel checkout selects owned bundles before Stripe at ${width}px`,async()=>{
  const context=await contextFor(width),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+base+'/checkout');assert.equal(new URL(page.url()).pathname,base+'/checkout');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  assert.equal(await page.getByRole('heading',{name:'Original checkout design'}).isVisible(),true);assert.equal(await page.locator('#pay').isDisabled(),true);assert.equal(await page.evaluate(()=>window.STRIPE_AMOUNT),undefined);
  assert.equal(await page.getByText('Unpublished secret').count(),0);
  for(const[quantity,expected]of[[1,5495],[2,9342],[4,17584]]){
    const response=page.waitForResponse(response=>response.url().endsWith('/checkout/selection'));await page.locator(`[data-funnel-quantity="${quantity}"]`).check();const data=await(await response).json();
    assert.equal(data.subtotalCents-data.discountCents,expected);await page.waitForFunction(amount=>window.STRIPE_AMOUNT===amount,data.totalCents);
    const cart=await context.request.get(origin+base+'/cart/state').then(response=>response.json());assert.equal(cart.items.length,1);assert.equal(cart.items[0].quantity,quantity);assert.equal(cart.items[0].variantId,product.variants[0].id);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  }
  await page.getByLabel('Email',{exact:true}).fill('buyer@example.com');await page.getByLabel('First name',{exact:true}).fill('Test');await page.getByLabel('Last name',{exact:true}).fill('Buyer');await page.getByLabel('Address',{exact:true}).fill('1 Main Street');await page.getByLabel('City',{exact:true}).fill('Phoenix');await page.getByLabel('Postal code',{exact:true}).fill('85001');
  const intentResponse=page.waitForResponse(response=>response.url().endsWith('/checkout/intent'));await page.locator('#pay').click();const created=await(await intentResponse).json();await page.waitForFunction(()=>window.CONFIRMED_SECRET);
  const intent=intents.get(created.intentId),cart=await context.request.get(origin+base+'/cart/state').then(response=>response.json());assert.equal(intent.amount,cart.totals.totalCents);assert.equal(intent.metadata.storeId,funnel.id);assert.equal(intent.amount-cart.totals.shippingCents-cart.totals.taxCents,17584);
  // A changed package cancels a declined/retry intent, then confirms the new server total.
  const selection=page.waitForResponse(response=>response.url().endsWith('/checkout/selection'));await page.locator('[data-funnel-quantity="2"]').check();await selection;assert.equal(intent.status,'canceled');
  const next=await post(context,base+'/checkout/intent',{}).then(response=>response.json());const final=intents.get(next.intentId);assert.notEqual(next.intentId,created.intentId);const finalCart=await context.request.get(origin+base+'/cart/state').then(response=>response.json());assert.equal(final.amount,finalCart.totals.totalCents);assert.equal(final.amount-finalCart.totals.shippingCents-finalCart.totals.taxCents,9342);
  final.status='succeeded';await context.request.get(origin+base+'/checkout/complete?payment_intent='+final.id);const order=db.one('SELECT total_cents,items FROM orders WHERE payment_intent_id=?',final.id);assert.equal(order.total_cents,final.amount);assert.equal(JSON.parse(order.items)[0].quantity,2);assert.deepEqual(errors,[]);await context.close();
});

test('funnel CTAs bypass cart; store drawers carry existing items into checkout',async()=>{
  const context=await contextFor(),page=await context.newPage();
  await page.goto(origin+base+'/pages/sales');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);await page.getByRole('button',{name:'Add to cart',exact:true}).click();await page.waitForURL('**/checkout');assert.equal(await page.locator('#pay').isDisabled(),true);
  await page.goto(origin+storeBase+'/pages/sales');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);await post(context,storeBase+'/cart/add',{variantId:storeProduct.variants[1].id,quantity:2});
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();await page.locator('[data-copy-drawer-open]').waitFor();assert.equal(new URL(page.url()).pathname,storeBase+'/pages/sales');
  assert.equal(await page.getByRole('heading',{name:'Our cart design'}).isVisible(),true);await page.locator('#CartDrawer').getByRole('link',{name:'Checkout',exact:true}).click();await page.waitForURL('**/checkout');assert.equal(await page.locator('[data-funnel-selection]').count(),0);
  const state=await context.request.get(origin+storeBase+'/cart/state').then(response=>response.json());assert.equal(state.items.length,2);assert.equal(state.items.find(item=>item.variantId===storeProduct.variants[1].id).quantity,2);
  const refused=await post(context,storeBase+'/checkout/selection',{variantId:storeProduct.variants[0].id,quantity:4});assert.equal(refused.status(),400);await context.close();
});

test('direct funnel checkout rejects unavailable/foreign quantities and cannot change a processing payment',async()=>{
  const context=await contextFor(),page=await context.newPage();await page.goto(origin+'/s/'+unavailable.slug+'/checkout');assert.equal(await page.getByText('No packages are available yet.').isVisible(),true);assert.equal(await page.locator('#pay').isDisabled(),true);
  await context.request.get(origin+base+'/checkout');for(const body of[{variantId:storeProduct.variants[0].id,quantity:1},{variantId:draft.variants[0].id,quantity:1},{variantId:product.variants[0].id,quantity:0},{variantId:product.variants[0].id,quantity:1.5},{variantId:product.variants[0].id,quantity:1000}])assert.equal((await post(context,base+'/checkout/selection',body)).status(),400);
  const selected=await post(context,base+'/checkout/selection',{variantId:product.variants[0].id,quantity:2,priceCents:1}).then(response=>response.json());assert.equal(selected.subtotalCents-selected.discountCents,9342);
  const intent=await post(context,base+'/checkout/intent',{}).then(response=>response.json());intents.get(intent.intentId).status='processing';assert.equal((await post(context,base+'/checkout/selection',{variantId:product.variants[0].id,quantity:1})).status(),400);
  const state=await context.request.get(origin+base+'/cart/state').then(response=>response.json());assert.equal(state.items[0].quantity,2);
  // A different payment may attach while Stripe cancellation is in flight; retain its cart unchanged.
  intents.get(intent.intentId).status='requires_payment_method';beforeCancel=old=>db.update('carts',old.metadata.cartId,{payment_intent_id:'pi_concurrent_payment'});
  const raced=await post(context,base+'/checkout/selection',{variantId:product.variants[0].id,quantity:4});assert.equal(raced.status(),400);assert.match((await raced.json()).error,/order changed/);
  const after=db.one('SELECT items,payment_intent_id FROM carts WHERE id=?',intents.get(intent.intentId).metadata.cartId);assert.equal(after.payment_intent_id,'pi_concurrent_payment');assert.equal(JSON.parse(after.items)[0].quantity,2);await context.close();
});

test('copied cart drawer opens for visual editing without saving temporary visibility',async()=>{
  const context=await contextFor(1500),page=await context.newPage();const raw=source;let saved;
  const fixture={id:'cart-editor',storeId:store.id,title:'Cart editor',handle:'cart-editor',kind:'custom',mode:'html',blocks:[],rawHtml:raw,headHtml:'',seo:{},status:'draft',sourceUrl:'https://source.example',isHome:false,productId:'',role:'page',weight:0,format:'',direction:'',createdAt:'',updatedAt:''};
  await context.route('**/cart-editor-fixture',route=>route.fulfill({contentType:'text/html',body:editorPage({page:fixture,storeSlug:store.slug,products:[]})}));await context.route('**/admin/pages/cart-editor/canvas?*',route=>route.fulfill({contentType:'text/html',body:raw}));
  await context.route('**/admin/pages/cart-editor/save?*',route=>{saved=route.request().postDataJSON();return route.fulfill({contentType:'application/json',body:JSON.stringify({ok:true,handle:'cart-editor',status:'draft',revisions:[]})});});
  await page.goto(origin+'/cart-editor-fixture');await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length);await page.getByRole('button',{name:'Edit cart drawer',exact:true}).click();
  const frame=page.frameLocator('#edit-frame');assert.equal(await frame.getByRole('heading',{name:'Our cart design'}).isVisible(),true);assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.serialize()),raw);
  await frame.getByRole('heading',{name:'Our cart design'}).dblclick({position:{x:15,y:15}});await page.keyboard.insertText('Your bag');await page.keyboard.press('Enter');
  await page.locator('#edit-frame').evaluate(el=>window.__PAGE_EDITOR.select(el.contentDocument.querySelector('.drawer__inner').getAttribute('data-pb-id')));await page.locator('[data-tab="design"]').click();await page.locator('[data-style="padding-top"]').fill('28');await page.locator('[data-style="padding-top"]').press('Tab');
  const edited=await page.evaluate(()=>window.__PAGE_EDITOR.serialize());assert.match(edited,/Your bag/);assert.match(edited,/padding-top:28px/);assert.doesNotMatch(edited,/data-pb-cart-editing|data-pb-temporary/);assert.match(edited,/<cart-drawer[^>]*hidden/);
  await page.getByRole('button',{name:'Close cart drawer',exact:true}).click();assert.equal(await frame.getByRole('heading',{name:'Your bag'}).isVisible(),false);
  const saving=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/cart-editor/save'));await page.getByRole('button',{name:'Save',exact:true}).click();await saving;assert.match(saved.rawHtml,/Your bag/);assert.match(saved.rawHtml,/padding-top:28px/);assert.doesNotMatch(saved.rawHtml,/data-pb-cart-editing|data-pb-temporary|class="active"/);await context.close();
});
