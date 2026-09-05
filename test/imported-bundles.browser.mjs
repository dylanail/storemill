import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'copied-bundles-'));process.env.AMBORAS_DB=join(dir,'test.db');process.env.PORT='0';process.env.AMBORAS_LOG_LEVEL='error';process.env.AMBORAS_STOREFRONT_HOST='';process.env.AMBORAS_PUBLIC_ORIGIN='';process.env.AMBORAS_ADMIN_HOST='';
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');
const {register}=await import('../src/control/auth.ts');
const {createStore}=await import('../src/control/stores.ts');
const {createProduct}=await import('../src/domain/catalog.ts');
const {seedDefaultRegion}=await import('../src/domain/regions.ts');
const {createPage}=await import('../src/pages/store.ts');
const {planImportedBundle,installImportedBundle,repairImportedBundleHtml}=await import('../src/pages/imported-bundles.ts');
const {copiedBundleFixture}=await import('./fixtures/copied-bundle.ts');
const {templateHtml}=await import('../src/pages/library.ts');
const db=getDb(),user=register(db,{email:'bundle-browser@example.com',password:'test-password-long'}),store=createStore(db,user.id,{name:'Bundle browser'});
seedDefaultRegion(db,store.id,'USD');db.update('stores',store.id,{status:'live'});
const product=createProduct(db,store.id,{title:'Cushion',status:'published',variants:[{title:'Default',priceCents:5495,inventory:100}]});
db.update('products',product.id,{metadata:{['sourceVariant:'+product.variants[0].id]:'source_variant'}});
const original=copiedBundleFixture(),sourceUrl='https://source.example/products/cushion',plan=planImportedBundle(original,sourceUrl),installed=installImportedBundle(db,store.id,product.id,plan);
const drawer='<cart-drawer id="CartDrawer" hidden style="position:fixed;right:0;top:0;width:360px;max-width:100vw;background:white;z-index:99"><button class="drawer__close">Close cart</button><div data-cart-items></div><span data-cart-subtotal></span><a href="/checkout">Checkout</a></cart-drawer>';
createPage(db,store.id,{title:'Verified bundles',handle:'verified-bundles',mode:'html',role:'pdp',status:'published',sourceUrl,productId:product.id,rawHtml:repairImportedBundleHtml(original,plan,installed).html.replace('</body>',drawer+'</body>')});
createPage(db,store.id,{title:'Unmapped bundles',handle:'unmapped-bundles',mode:'html',role:'pdp',status:'published',sourceUrl,productId:product.id,rawHtml:original.replace('display:none','display:block')});
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
    assert.equal(data.items[0].quantity,quantity);assert.equal(data.totals.subtotalCents-data.totals.discountCents,expected);
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
