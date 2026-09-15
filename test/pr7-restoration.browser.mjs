import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'storemill-restoration-'));
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',AMBORAS_STOREFRONT_HOST:'',AMBORAS_PUBLIC_ORIGIN:'',AMBORAS_ADMIN_HOST:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',GEMINI_API_KEY:'',RESEND_API_KEY:'',STRIPE_SECRET_KEY:''});
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');const {register}=await import('../src/control/auth.ts');
const {createBlankAsset}=await import('../src/control/assets.ts');const {publish}=await import('../src/control/stores.ts');
const {createProduct,getProduct}=await import('../src/domain/catalog.ts');const {createPage}=await import('../src/pages/store.ts');const {install}=await import('../src/control/plugins.ts');
const db=getDb(),user=register(db,{email:'restore@example.test',password:'fixture-long-password'});
const store=createBlankAsset(db,user.id,{name:'Restoration shop',kind:'store'});
const product=createProduct(db,store.id,{title:'Everyday bag',status:'published',variants:[{title:'Standard',priceCents:2500,inventory:50}]});
const copied=createPage(db,store.id,{title:'Copied offer',mode:'html',role:'page',productId:product.id,status:'published',sourceUrl:'https://source.example/offer',rawHtml:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Copied title</title></head><body><main><h1>Copied offer</h1><form action="/cart/add"><input type="hidden" name="id" value="'+product.variants[0].id+'"><button>Add to cart</button></form></main><div id="CartDrawer" hidden><div class="drawer__inner"><div data-cart-items></div></div></div></body></html>'});
publish(db,store.id);install(db,store.id,'ga4',{measurementId:'G-RESTORE1'});install(db,store.id,'tiktok-pixel',{pixelId:'CABC1234567890'});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
async function context(admin=false,width=1280){const ctx=await browser.newContext({viewport:{width,height:1000}});await ctx.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.fulfill({body:'',contentType:'application/javascript'}));if(admin)await ctx.request.post(origin+'/login',{form:{email:user.email,password:'fixture-long-password'}});const page=await ctx.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));return {ctx,page,errors};}
const events=page=>page.evaluate(()=>({ga4:(window.dataLayer||[]).map(args=>Array.from(args)).filter(args=>args[0]==='event'&&args[1]==='add_to_cart'),tiktok:(window.ttq||[]).filter(args=>args[0]==='track'&&args[1]==='AddToCart')}));

for(const mode of ['native','copied'])test(mode+' add-to-cart reaches GA4 and browser-only TikTok once per action',async()=>{
 const {ctx,page,errors}=await context();
 try{
  await page.goto(origin+'/s/'+store.slug+(mode==='native'?'/products/'+product.handle:'/pages/'+copied.handle));
  const responsePromise=page.waitForResponse(response=>response.url().endsWith('/cart/add')&&response.request().method()==='POST');
  if(mode==='native'){await page.locator('#pdp-cta').click();await page.waitForURL('**/cart');}else await page.getByRole('button',{name:'Add to cart',exact:true}).click();
  const response=await responsePromise;assert.ok(response.status()<400);
  await page.waitForFunction(()=>Array.from(window.dataLayer||[]).some(args=>args[1]==='add_to_cart'));
  const fired=await events(page);assert.equal(fired.ga4.length,1);assert.equal(fired.tiktok.length,1);assert.equal(fired.ga4[0][2].value,25);assert.equal(fired.tiktok[0][2].currency,'USD');
  if(mode==='copied'){
   const body=await response.json();assert.equal(fired.tiktok[0][3].event_id,body.cartEvents[0].id);
   await page.evaluate(body=>(body.cartEvents||[]).forEach(event=>window.storemillCartEvent(event)),body);assert.equal((await events(page)).tiktok.length,1);
  }
  await page.reload();assert.equal((await events(page)).ga4.length,0,'reloading must not replay the add');assert.equal((await events(page)).tiktok.length,0);
  assert.deepEqual(errors,[]);
 }finally{await ctx.close();}
});

test('copy scope is explicit on both forms and a listed-page submission does not request whole-site copying',async()=>{
 const {ctx,page,errors}=await context(true,390);
 try{
  await page.goto(origin+'/admin/stores');assert.equal(await page.locator('.rail,#assistant-launcher').count(),0,'account hub has no selected-store rail or assistant');
  await page.locator('#asset-search').fill('not a store');assert.equal(await page.locator('.asset-card:visible').count(),0);await page.locator('#asset-search').fill('Restoration');assert.equal(await page.locator('.asset-card:visible').count(),1);
  const form=page.locator('#clone-asset-form');await form.locator('[name=url]').fill('https://source.example/offer');assert.equal(await form.getByLabel('Copy scope',{exact:true}).inputValue(),'page');assert.equal(await form.locator('[name=additionalUrls]').isDisabled(),true);
  await form.getByLabel('Copy scope',{exact:true}).selectOption('selected');await form.locator('[name=additionalUrls]').fill('https://source.example/checkout');assert.match(await form.locator('[data-copy-description]').textContent(),/only the starting URL/);assert.match(await form.locator('[data-copy-count]').textContent(),/2 requested pages/);
  let sent='';await ctx.route(origin+'/admin/assets/import',async route=>{sent=route.request().postData();await route.fulfill({status:302,headers:{location:'/admin/stores?flash=Scope+captured'},body:''});});
  await form.getByRole('button',{name:'Copy selected scope',exact:true}).click();await page.waitForURL('**/admin/stores?flash=*');assert.match(sent,/name="scope"\r\n\r\nselected/);assert.match(sent,/https:\/\/source.example\/checkout/);
  await page.goto(origin+'/admin/pages');const pageForm=page.locator('form[action="/admin/pages/clone"]');await pageForm.getByLabel('Copy scope',{exact:true}).selectOption('site');assert.equal(await pageForm.locator('[data-copy-page-settings]').isVisible(),false);assert.equal(await pageForm.locator('[name=productId]').isDisabled(),true);
  await pageForm.getByLabel('Copy scope',{exact:true}).selectOption('selected');await pageForm.locator('[name=additionalUrls]').fill('https://source.example/extra');await pageForm.getByLabel('Copy scope',{exact:true}).selectOption('page');assert.equal(await pageForm.locator('[name=additionalUrls]').isDisabled(),true);assert.equal(await pageForm.locator('[name=productId]').isDisabled(),false);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile form stays within the viewport');assert.deepEqual(errors,[]);
 }finally{await ctx.close();}
});

test('qualification saves displayed currency amounts, product HTML uses product SEO, and live audits have a draft choice',async()=>{
 const {ctx,page,errors}=await context(true);
 try{
  await page.goto(origin+'/admin/products/'+product.id);await page.locator('[name=aovAmount]').fill('80');await page.getByRole('button',{name:'Save qualification',exact:true}).click();assert.equal(getProduct(db,store.id,product.id).metadata.qualify.includes('8000'),true);assert.equal(await page.locator('[name=aovAmount]').inputValue(),'80.00');
  await page.goto(origin+'/s/'+store.slug+'/products/'+product.handle+'?version='+copied.id);assert.match(await page.locator('link[rel=canonical]').getAttribute('href'),new RegExp('/products/'+product.handle+'$'));assert.match(await page.title(),/Everyday bag/);
  await page.goto(origin+'/admin/speed');assert.match(await page.locator('#health').textContent(),/published pages and live theme/);await page.getByRole('link',{name:'Draft',exact:true}).click();assert.match(await page.locator('#health').textContent(),/saved pages and draft theme/);
  await page.goto(origin+'/preview/'+store.slug+'/products/'+product.handle);assert.equal(await page.locator('[data-cart-events]').count(),0);assert.deepEqual(errors,[]);
 }finally{await ctx.close();}
});
