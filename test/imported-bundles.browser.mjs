import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'copied-bundles-'));process.env.AMBORAS_DB=join(dir,'test.db');process.env.PORT='0';process.env.AMBORAS_LOG_LEVEL='error';process.env.AMBORAS_STOREFRONT_HOST='';process.env.AMBORAS_PUBLIC_ORIGIN='';process.env.AMBORAS_ADMIN_HOST='';
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');
const {register,startSession,SESSION_COOKIE}=await import('../src/control/auth.ts');
const {createStore}=await import('../src/control/stores.ts');
const {createProduct}=await import('../src/domain/catalog.ts');
const {seedDefaultRegion}=await import('../src/domain/regions.ts');
const {createPage}=await import('../src/pages/store.ts');
const {planImportedBundle,installImportedBundle,repairImportedBundleHtml}=await import('../src/pages/imported-bundles.ts');
const {copiedBundleFixture}=await import('./fixtures/copied-bundle.ts');
const {ensureCopiedCheckout}=await import('../src/pages/commerce-pages.ts');
const {templateHtml}=await import('../src/pages/library.ts');
const db=getDb(),user=register(db,{email:'bundle-browser@example.com',password:'test-password-long'}),store=createStore(db,user.id,{name:'Bundle browser'});
seedDefaultRegion(db,store.id,'USD');db.update('stores',store.id,{status:'live'});
const product=createProduct(db,store.id,{title:'Cushion',status:'published',variants:[{title:'Default',priceCents:5495,compareAtCents:10990,inventory:100}]});
db.update('products',product.id,{metadata:{['sourceVariant:'+product.variants[0].id]:'source_variant'}});
const original=copiedBundleFixture(),sourceUrl='https://source.example/products/cushion',plan=planImportedBundle(original,sourceUrl),installed=installImportedBundle(db,store.id,product.id,plan);
const drawer='<cart-drawer id="CartDrawer" hidden style="position:fixed;right:0;top:0;width:360px;max-width:100vw;background:white;z-index:99"><div id="CartDrawer-Overlay" style="position:fixed;inset:0;z-index:-1"></div><button class="drawer__close">Close cart</button><div data-cart-items></div><span data-cart-subtotal></span><a href="/checkout">Checkout</a></cart-drawer>';
createPage(db,store.id,{title:'Verified bundles',handle:'verified-bundles',mode:'html',role:'pdp',status:'published',sourceUrl,productId:product.id,rawHtml:repairImportedBundleHtml(original,plan,installed).html.replace('</body>',drawer+'</body>')});
createPage(db,store.id,{title:'Unmapped bundles',handle:'unmapped-bundles',mode:'html',role:'pdp',status:'published',sourceUrl,productId:product.id,rawHtml:original.replace('display:none','display:block')});
const protection=createProduct(db,store.id,{title:'Shipping Protection',handle:'shipping-protection',status:'published',variants:[{title:'Default',priceCents:299,inventory:100}]});
db.update('products',protection.id,{metadata:{['sourceVariant:'+protection.variants[0].id]:'protection-source'}});
const sourceDrawer=`<style>.drawer{position:fixed;inset:0;visibility:hidden;display:flex;justify-content:flex-end;z-index:99}.drawer__inner{background:#fff;width:400px;max-width:100vw;transform:translateX(100%);padding:16px;box-sizing:border-box}.cart-drawer__overlay{position:absolute;inset:0;background:#0008;z-index:-1}.is-empty .drawer__footer,.is-empty cart-drawer-items{display:none}</style><cart-drawer class="drawer is-empty"><div id="CartDrawer" class="cart-drawer"><div id="CartDrawer-Overlay" class="cart-drawer__overlay"></div><div class="drawer__inner"><div class="drawer__inner-empty">Your cart is empty</div><div class="drawer__header"><h2 class="drawer__heading">Cart • 0 items</h2><button class="drawer__close" aria-label="Close cart">×</button></div><div class="cart-drawer__body"><div class="cart-progress"><p class="cart-progress__text">Spend $50 more to get FREE shipping!</p><div class="cart-progress__bar"><div class="cart-progress__bar__progress" style="width:0%"></div></div></div><cart-drawer-items class="is-empty" data-subtotal="0"><form action="/cart"><div id="CartDrawer-CartItems"></div></form></cart-drawer-items></div><div class="drawer__footer"><cart-drawer-upsell data-selected="true" data-handle="shipping-protection" data-id="protection-source"><span>Shipping Protection $2.99</span><button>Toggle protection</button></cart-drawer-upsell><p>Subtotal <strong class="cart-drawer__totals__row__money"></strong></p><button id="CartDrawer-Checkout" name="checkout" disabled><span class="button__label">Check out • $0.00</span></button></div></div></div></cart-drawer>`;
createPage(db,store.id,{title:'Nuvana structure',handle:'nuvana-structure',mode:'html',role:'pdp',status:'published',sourceUrl,productId:product.id,rawHtml:repairImportedBundleHtml(original,plan,installed).html.replace('</body>',sourceDrawer+'</body>')});
createPage(db,store.id,{title:'Copied empty cart',handle:'copied-cart',mode:'html',role:'cart',status:'published',sourceUrl:'https://source.example/cart',rawHtml:'<html><body><main id="MainContent"><cart-items class="is-empty"><div class="cart__warnings">Your cart is empty</div></cart-items></main>'+sourceDrawer+'</body></html>'});
const {installSourceCartShipping}=await import('../src/pages/imported-cart.ts');installSourceCartShipping(db,store.id,sourceDrawer);
const destination=createProduct(db,store.id,{title:'Connected cushion',status:'published',variants:[{title:'Default',priceCents:5495,inventory:100}]});
installImportedBundle(db,store.id,destination.id,plan);
createPage(db,store.id,{title:'Reused bundle template',handle:'bundle-template',mode:'html',role:'pdp',status:'published',sourceUrl,productId:destination.id,rawHtml:templateHtml(repairImportedBundleHtml(original,plan,installed).html,destination.id).replace('</body>',drawer+'</body>')});
const unmatched=createProduct(db,store.id,{title:'Unmatched cushion',status:'published',variants:[{title:'Default',priceCents:4995,inventory:100}]});
createPage(db,store.id,{title:'Unmatched bundle template',handle:'bundle-template-unmatched',mode:'html',role:'pdp',status:'published',sourceUrl,productId:unmatched.id,rawHtml:templateHtml(repairImportedBundleHtml(original,plan,installed).html,unmatched.id)});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port,base='/s/'+store.slug;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});

for(const width of [390,820,1440])test(`copied bundle cards choose 1/2/4 and charge verified totals at ${width}px`,async()=>{
  for(const [quantity,expected]of [[1,5495],[2,9342],[4,17584]]){
    const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390});
    await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    const page=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(origin+base+'/pages/verified-bundles');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
    const bar=page.locator(`[data-copy-bundle-quantity="${quantity}"]`);
    await bar.click();assert.equal(await bar.getAttribute('aria-checked'),'true');
    const pending=page.waitForResponse(response=>response.url().endsWith('/cart/add')&&response.request().method()==='POST');
    await page.getByRole('button',{name:'Add to cart',exact:true}).click();
    const response=await pending,data=await response.json(),sent=response.request().postDataJSON();
    assert.equal(sent.quantity,quantity);assert.equal(sent.variantId,product.variants[0].id);assert.equal(Object.hasOwn(sent,'price'),false);
    assert.equal(data.items[0].quantity,quantity);assert.equal(data.items[0].lineCents,expected);assert.equal(data.items[0].compareAtLineCents,10990*quantity);
    await page.locator('[data-copy-drawer-open]').waitFor();assert.equal(await page.locator('[data-cart-subtotal]').textContent(),'$'+(expected/100).toFixed(2));assert.equal(data.totals.subtotalCents-data.totals.discountCents,expected);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
    await context.close();
  }
});

test('bundle radios support keyboard choice, and unverified source widgets cannot silently add a single unit',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin+base+'/pages/verified-bundles');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  await page.locator('[data-copy-bundle-quantity="1"]').focus();await page.keyboard.press('End');
  assert.equal(await page.locator('[data-copy-bundle-quantity="4"]').getAttribute('aria-checked'),'true');
  await page.goto(origin+base+'/pages/unmapped-bundles');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  let purchases=0;page.on('request',request=>{if(request.url().endsWith('/cart/add')&&request.method()==='POST')purchases++;});
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.getByRole('status').filter({hasText:'verified product pricing'}).waitFor();assert.equal(purchases,0);
  await context.close();
});

test('template bundles rebind only to the explicitly connected product with verified local quantity pricing',async()=>{
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin+base+'/pages/bundle-template');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  await page.locator('[data-copy-bundle-quantity="2"]').click();
  const pending=page.waitForResponse(response=>response.url().endsWith('/cart/add')&&response.request().method()==='POST');
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();const response=await pending,data=await response.json();
  assert.equal(response.request().postDataJSON().variantId,destination.variants[0].id);
  assert.equal(data.totals.subtotalCents-data.totals.discountCents,9342);
  await page.goto(origin+base+'/pages/bundle-template-unmatched');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  let purchases=0;page.on('request',request=>{if(request.url().endsWith('/cart/add')&&request.method()==='POST')purchases++;});
  await page.getByRole('button',{name:'Add to cart',exact:true}).click();await page.getByRole('status').filter({hasText:'verified product pricing'}).waitFor();
  assert.equal(purchases,0);assert.equal(await page.locator('[data-copy-bundle]').getAttribute('data-copy-bundle'),'');
  await context.close();
});

for (const width of [390,1440]) test(`a duplicated draft can select bundles, edit its slide cart and open editable checkout at ${width}px`, async()=>{
  const {duplicateAsset}=await import('../src/control/duplicate-asset.ts');
  const copy=duplicateAsset(db,user.id,store.id,{name:'Draft bundle test '+width});
  assert.ok(copy.pages.some(page=>page.role==='checkout'));
  const copiedProduct=copy.products.find(p=>p.title==='Cushion');
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
  await context.addCookies([{name:SESSION_COOKIE,value:startSession(db,user.id),url:origin}]);
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  const preview=origin+'/preview/'+copy.store.slug;
  await page.goto(preview+'/pages/verified-bundles');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  assert.equal(await page.locator('[data-copy-bundle-quantity="2"]').getAttribute('aria-disabled'),'false');
  await page.locator('[data-copy-bundle-quantity="2"]').click();await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.locator('[data-copy-drawer-open]').waitFor();await page.waitForFunction(()=>document.querySelector('[data-copy-line-total]')?.textContent==='$93.42');
  assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
  for(const [qty,price] of [[4,'$175.84'],[1,'$54.95']]){
    const updated=page.waitForResponse(r=>r.url().endsWith('/cart/update'));
    await page.locator('[data-copy-quantity]').fill(String(qty));await page.locator('[data-copy-quantity]').dispatchEvent('change');await updated;
    await page.waitForFunction(price=>document.querySelector('[data-copy-line-total]')?.textContent===price,price);
  }
  await page.getByRole('button',{name:'Increase quantity for Cushion',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-copy-line-total]')?.textContent==='$93.42');
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.body.style.overflow),'');
  await page.goto(preview+'/cart');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY||document.querySelector('.cart-layout'));
  await page.goto(preview+'/checkout');assert.equal(await page.locator('#checkout-form').count(),1);assert.equal(await page.locator('#pay').isDisabled(),true);
  assert.ok((await page.textContent('body')).includes('93.42'));
  const denied=await page.request.post(preview+'/checkout/intent',{data:{}});assert.equal(denied.status(),400);
  const order=await page.request.post(preview+'/checkout',{data:{email:'test@example.com'}});assert.equal(order.status(),409);
  assert.equal(db.one('SELECT COUNT(*) n FROM orders WHERE store_id=?',copy.store.id).n,0);
  assert.equal(db.one('SELECT status FROM products WHERE id=?',copiedProduct.id).status,'draft');
  // A preview cart cannot be resumed under a public cookie, even after publication.
  db.update('stores',copy.store.id,{status:'live'});
  const live=await page.request.get(origin+'/s/'+copy.store.slug+'/cart/state');assert.equal((await live.json()).count,0);
  const rejected=await page.request.post(origin+'/s/'+copy.store.slug+'/cart/add',{data:{variantId:copiedProduct.variants[0].id,quantity:2}});assert.ok(rejected.status()>=400);
  await context.close();
});

test('source drawer keeps its right panel, default add-on, close controls, cart page and checkout destination',async()=>{
  const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage();
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin+base+'/pages/nuvana-structure');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  await page.locator('[data-copy-bundle-quantity="2"]').click();await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.locator('[data-copy-drawer-open]').waitFor();await page.waitForFunction(()=>document.querySelector('.cart-drawer__totals__row__money')?.textContent==='$96.41');
  assert.equal(await page.locator('cart-drawer-upsell').getAttribute('data-selected'),'true');
  assert.equal(await page.locator('.cart-progress__text').textContent(),'You qualify for free shipping');
  assert.equal(await page.locator('.cart-progress__bar__progress').count(),1,'keep the source progress bar markup');
  assert.equal(await page.locator('#CartDrawer-Checkout .button__label').textContent(),'Check out • $96.41');
  const panel=await page.locator('.drawer__inner').boundingBox();assert.ok(panel.x>900&&panel.x+panel.width<=1440);
  await page.getByRole('button',{name:'Toggle Shipping Protection'}).click();
  await page.waitForFunction(()=>document.querySelector('.cart-drawer__totals__row__money')?.textContent==='$93.42');
  await page.locator('#CartDrawer-Overlay').click({position:{x:10,y:10}});assert.equal(await page.locator('cart-drawer').getAttribute('aria-hidden'),'true');
  await page.goto(origin+base+'/cart');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  await page.locator('main [data-owned-cart-line]').waitFor();assert.equal(await page.locator('main .cart__warnings').isVisible(),false);
  await page.locator('main [data-copy-remove]').click();await page.waitForFunction(()=>document.querySelector('main [data-owned-cart-lines]')?.textContent.includes('Your cart is empty'));
  assert.equal(await page.locator('main [data-copy-checkout]').getAttribute('aria-disabled'),'true');
  await context.close();
});

test('editing exact bundle prices in the backend updates copied cards and keeps comparison prices',async()=>{
  const {duplicateAsset}=await import('../src/control/duplicate-asset.ts');
  const copy=duplicateAsset(db,user.id,store.id,{name:'Price edit test'}),copied=copy.products.find(product=>product.title==='Cushion');
  const bundle=db.one('SELECT id FROM bundles WHERE store_id=? AND product_id=?',copy.store.id,copied.id);
  const context=await browser.newContext(),page=await context.newPage();
  await context.addCookies([{name:SESSION_COOKIE,value:startSession(db,user.id),url:origin},{name:'amboras_store',value:copy.store.id,url:origin}]);
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin+'/admin/bundles');
  const form=page.locator('form[action="/admin/bundles/'+bundle.id+'/prices"]');
  assert.equal(await form.getByLabel('Buy 2 sale total',{exact:true}).inputValue(),'93.42');
  assert.equal(await form.getByLabel('Buy 2 original total',{exact:true}).inputValue(),'219.80');
  await form.getByLabel('Buy 2 sale total',{exact:true}).fill('90.00');
  await form.getByRole('button',{name:'Save bundle prices'}).click();
  await page.goto(origin+'/preview/'+copy.store.slug+'/pages/verified-bundles');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);
  assert.equal(await page.locator('[data-copy-bundle-quantity="2"] .kaching-bundles__bar-price').textContent(),'$90.00');
  await page.locator('[data-copy-bundle-quantity="2"]').click();await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-copy-line-total]')?.textContent==='$90.00');
  assert.equal(await page.locator('[data-owned-cart-line] s').textContent(),'$219.80');
  await context.close();
});

test('draft funnels can test package selection while payment stays disabled',async()=>{
  const funnel=createStore(db,user.id,{name:'Draft funnel packages',kind:'funnel'});seedDefaultRegion(db,funnel.id,'USD');
  const item=createProduct(db,funnel.id,{title:'Draft cushion',variants:[{title:'Default',priceCents:5495,inventory:100}]});
  installImportedBundle(db,funnel.id,item.id,plan);ensureCopiedCheckout(db,funnel.id);
  const context=await browser.newContext(),page=await context.newPage();
  await context.addCookies([{name:SESSION_COOKIE,value:startSession(db,user.id),url:origin}]);
  await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
  await page.goto(origin+'/preview/'+funnel.slug+'/checkout');
  const selected=page.waitForResponse(response=>response.url().endsWith('/checkout/selection'));
  await page.locator('[data-funnel-quantity="2"]').check();
  const quote=await (await selected).json();assert.equal(quote.subtotalCents-quote.discountCents,9342);
  assert.equal(await page.locator('#pay').isDisabled(),true);
  await context.close();
});
