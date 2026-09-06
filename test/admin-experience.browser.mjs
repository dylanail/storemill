import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'admin-experience-'));
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',AMBORAS_STOREFRONT_HOST:'',AMBORAS_PUBLIC_ORIGIN:'',AMBORAS_ADMIN_HOST:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',STRIPE_SECRET_KEY:''});
const fetchOriginal=globalThis.fetch;globalThis.fetch=(url,init)=>String(url).includes('graph.facebook.com')?Promise.resolve(new Response('{"events_received":1}',{status:200})):fetchOriginal(url,init);
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');const {register}=await import('../src/control/auth.ts');
const {createBlankAsset}=await import('../src/control/assets.ts');const {publish}=await import('../src/control/stores.ts');
const {createProduct}=await import('../src/domain/catalog.ts');const {createPage,updatePage}=await import('../src/pages/store.ts');const {install}=await import('../src/control/plugins.ts');
const db=getDb(),user=register(db,{email:'experience-tests@example.com',password:'test-password-long'}),store=createBlankAsset(db,user.id,{name:'Everyday Studio',kind:'store',currency:'USD'});
const product=createProduct(db,store.id,{title:'Everyday tote',status:'published',variants:[{title:'Natural',priceCents:5495,inventory:200}]});
const source='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;font:16px system-ui;background:white;color:#222}.source-header{position:fixed;inset:0 0 auto;height:50px;background:#185546;color:white;z-index:999;display:grid;place-items:center}main{padding:90px 24px 40px;max-width:1000px;margin:auto}button{background:#d72d77;color:white;border:0;border-radius:8px;padding:14px 20px;font:600 16px system-ui}h1{font-size:38px}form{display:flex;gap:12px;align-items:center}input{width:70px;padding:12px}.below{height:900px;background:#faf4f6;margin-top:32px;padding:32px}</style></head><body><header class="source-header">Everyday Studio · Free shipping</header><main><h1>Made for your everyday</h1><p>Thoughtful essentials, made to last.</p><form action="https://source.example/cart/add"><input type="hidden" name="id" value="'+product.variants[0].id+'"><input name="quantity" type="number" value="1" aria-label="Quantity"><button type="submit">Add to cart</button></form><div class="below">A little more room for what matters.</div></main></body></html>';
const copied=createPage(db,store.id,{title:'Imported home',mode:'html',rawHtml:source,sourceUrl:'https://source.example',isHome:true,status:'published',productId:product.id});updatePage(db,store.id,copied.id,{isHome:true});publish(db,store.id);
install(db,store.id,'meta-pixel',{pixelId:'1234567890123',accessToken:'fixture-private-token',testEventCode:'TESTFIXTURE'});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));globalThis.fetch=fetchOriginal;rmSync(dir,{recursive:true,force:true});});
const errors=[];
async function context(admin=false){const events=[];const ctx=await browser.newContext({viewport:{width:1600,height:1050}});await ctx.exposeBinding('reportMeta',(_source,args)=>events.push(args));await ctx.route('**/*',route=>{const url=route.request().url();if(url.startsWith(origin)||url.startsWith('data:'))return route.continue();if(url.includes('connect.facebook.net'))return route.fulfill({contentType:'application/javascript',body:"window.__META=[];window.fbq.callMethod=function(){window.__META.push(Array.from(arguments));window.reportMeta(Array.from(arguments))};window.fbq.queue.forEach(function(args){window.fbq.callMethod.apply(null,args)})"});return route.abort();});if(admin)await ctx.request.post(origin+'/login',{form:{email:user.email,password:'test-password-long'}});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);return {ctx,p,events};}
await test('admin controls and tracking browser workflows',async t=>{
 await t.test('theme toolbar and assistant work at desktop, tablet, and mobile widths',async()=>{
  const {ctx,p}=await context(true);await p.goto(origin+'/admin/store');
  for(const width of [1600,820,390]){await p.setViewportSize({width,height:1050});assert.equal(await p.locator('#business-assistant').isVisible(),false);assert.equal(await p.getByRole('button',{name:'Open business assistant',exact:true}).isVisible(),true);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   await p.getByRole('button',{name:'Open business assistant',exact:true}).click();await p.getByLabel('Message business assistant').fill('Keep this draft message');await p.getByRole('button',{name:'Minimize business assistant',exact:true}).last().click();assert.equal(await p.locator('#business-assistant').isVisible(),false);await p.getByRole('button',{name:'Open business assistant',exact:true}).click();assert.equal(await p.getByLabel('Message business assistant').inputValue(),'Keep this draft message');await p.getByLabel('Message business assistant').press('Escape');
  }
  await p.setViewportSize({width:1600,height:1050});await p.waitForFunction(()=>document.querySelector('#theme-source-label')?.textContent==='Colors detected from your site');assert.equal(await p.getByLabel('Text hex',{exact:true}).inputValue(),'#222222');
  for(const name of ['Desktop','Tablet','Mobile']){const b=p.getByRole('button',{name:name+' preview',exact:true});await b.click();assert.equal(await b.getAttribute('aria-pressed'),'true');assert.equal(await b.locator('svg').count(),1);}
  await p.getByRole('button',{name:'Live',exact:true}).click();await p.frameLocator('#designer-preview').locator('[data-preview-bar]').getByText('LIVE THEME PREVIEW',{exact:false}).waitFor();
  await p.getByRole('button',{name:'Draft',exact:true}).click();await p.getByRole('button',{name:'Desktop preview',exact:true}).click();
  if(process.env.ADMIN_TOOLBAR_SCREENSHOT)await p.screenshot({path:process.env.ADMIN_TOOLBAR_SCREENSHOT});
  await p.getByRole('button',{name:'Open business assistant',exact:true}).click();await p.getByLabel('Message business assistant').fill('Create a 10% discount on code HELLO10');await p.getByRole('button',{name:'Send',exact:true}).click();await p.waitForFunction(()=>document.querySelector('#thread .msg.assistant'));
  const request=db.one('SELECT page FROM assistant_queue WHERE store_id=? ORDER BY created_at DESC LIMIT 1',store.id);assert.match(request.page,/\/admin\/store/);assert.match(request.page,/visibleTheme/);assert.ok(db.one("SELECT id FROM promotions WHERE store_id=? AND code='HELLO10'",store.id));
  if(process.env.ASSISTANT_SCREENSHOT)await p.screenshot({path:process.env.ASSISTANT_SCREENSHOT});if(process.env.ASSISTANT_MOBILE_SCREENSHOT){await p.setViewportSize({width:390,height:844});await p.screenshot({path:process.env.ASSISTANT_MOBILE_SCREENSHOT});}
  await p.goto(origin+'/admin/pages/'+copied.id+'/edit');assert.equal(await p.getByRole('button',{name:'Open business assistant',exact:true}).isVisible(),true);await p.getByRole('button',{name:'Open business assistant',exact:true}).click();assert.match(await p.locator('.assistant-context').textContent(),/Imported home/);await ctx.close();
 });
 await t.test('draft preview content and fixed headers begin below the bar; previews send no Meta events',async()=>{
  const {ctx,p}=await context(true);const before=db.one("SELECT COUNT(*) n FROM server_event_deliveries WHERE store_id=?",store.id).n;
  for(const width of [1440,820,390]){await p.setViewportSize({width,height:900});await p.goto(origin+'/preview/'+store.slug);const geometry=await p.evaluate(()=>({bar:document.querySelector('[data-preview-bar]').getBoundingClientRect().bottom,header:document.querySelector('.source-header').getBoundingClientRect().top,heading:document.querySelector('h1').getBoundingClientRect().top}));assert.ok(geometry.header>=geometry.bar);assert.ok(geometry.heading>=geometry.bar);assert.equal(await p.locator('[data-meta-pixel]').count(),0);}
  assert.equal(db.one("SELECT COUNT(*) n FROM server_event_deliveries WHERE store_id=?",store.id).n,before);await ctx.close();
 });
 await t.test('copied and generated pages pair Pixel and CAPI identities through cart and checkout',async()=>{
  const {ctx,p,events}=await context();const base='/s/'+store.slug;
  await p.goto(origin+base+'/products/'+product.handle);await p.waitForFunction(()=>window.__META?.some(e=>e[2]==='ViewContent'));
  for(const name of ['PageView','ViewContent']){const ev=await p.evaluate(name=>window.__META.find(e=>e[2]===name),name);const row=db.one('SELECT payload FROM server_event_deliveries WHERE store_id=? AND event_id=? AND provider=?',store.id,ev[4].eventID,'meta');assert.equal(JSON.parse(row.payload).event_name,name);}
  await p.goto(origin+base);await p.waitForFunction(()=>window.__COPY_COMMERCE_READY);await p.getByRole('button',{name:'Add to cart',exact:true}).click();await p.waitForURL('**/cart');
  const add=events.find(e=>e[2]==='AddToCart');assert.ok(add,'Successful copied add-to-cart emits a browser event before navigation');assert.equal(add[3].value,54.95);assert.equal(JSON.parse(db.one("SELECT payload FROM server_event_deliveries WHERE event_id=? AND provider='meta'",add[4].eventID).payload).custom_data.value,54.95);
  await p.goto(origin+base+'/checkout');await p.waitForFunction(()=>window.__META?.some(e=>e[2]==='InitiateCheckout'));const checkout=await p.evaluate(()=>window.__META.find(e=>e[2]==='InitiateCheckout'));assert.ok(db.one("SELECT id FROM server_event_deliveries WHERE event_id=? AND event_name='InitiateCheckout'",checkout[4].eventID));
  const html=await p.content();assert.doesNotMatch(html,/fixture-private-token|TESTFIXTURE/);
  const completed=await ctx.request.post(origin+base+'/checkout',{form:{email:'buyer@example.com',firstName:'Test',lastName:'Buyer',line1:'1 Road',city:'Austin',postal:'78701',country:'US'},maxRedirects:0});assert.equal(completed.status(),302);
  const order=db.one('SELECT id FROM orders WHERE store_id=? ORDER BY created_at DESC LIMIT 1',store.id);assert.ok(order);await p.goto(origin+base+'/orders/'+order.id);await p.waitForFunction(()=>window.__META?.some(e=>e[2]==='Purchase'));const purchase=await p.evaluate(()=>window.__META.find(e=>e[2]==='Purchase'));assert.equal(purchase[4].eventID,order.id);const serverPurchase=JSON.parse(db.one("SELECT payload FROM server_event_deliveries WHERE event_id=? AND provider='meta'",order.id).payload);assert.equal(serverPurchase.event_name,'Purchase');assert.equal(serverPurchase.custom_data.value,purchase[3].value);assert.equal(serverPurchase.custom_data.currency,purchase[3].currency);
  await p.reload();await p.waitForFunction(()=>window.__META?.some(e=>e[2]==='PageView'));assert.equal(await p.evaluate(()=>window.__META.filter(e=>e[2]==='Purchase').length),0,'Refreshing the receipt does not send another browser purchase');await ctx.close();
 });
 await t.test('deletion has a deliberate confirmation page and server-side password guard',async()=>{
  const disposable=createBlankAsset(db,user.id,{name:'Autumn offer test',kind:'funnel',currency:'USD'});const {ctx,p}=await context(true);await p.goto(origin+'/admin/stores/'+disposable.id+'/delete');const button=p.getByRole('button',{name:'Permanently delete funnel'});assert.equal(await button.isEnabled(),false);await p.locator('[name=name]').fill(disposable.name);await p.locator('[name=password]').fill('wrong-password');await p.locator('[name=acknowledged]').check();assert.equal(await button.isEnabled(),true);
  const token=await p.locator('[name=token]').inputValue();const rejected=await ctx.request.post(origin+'/admin/stores/'+disposable.id+'/delete',{form:{name:disposable.name,password:'wrong-password',acknowledged:'yes',token},maxRedirects:0});assert.equal(rejected.status(),401);assert.ok(db.one('SELECT id FROM stores WHERE id=?',disposable.id));
  await p.locator('[name=password]').fill('test-password-long');if(process.env.DELETE_SCREENSHOT)await p.screenshot({path:process.env.DELETE_SCREENSHOT});await button.click();await p.waitForURL('**/admin/stores?*');assert.equal(db.one('SELECT id FROM stores WHERE id=?',disposable.id),null);assert.ok(db.one('SELECT id FROM stores WHERE id=?',store.id));await ctx.close();
 });
 await t.test('clone progress is hidden when idle, toggles during work, and resets after cancellation and completion',async()=>{
  const {ctx,p}=await context(true);
  let requests=0, pending=[];
  await ctx.route(origin+'/admin/assets/import',route=>{requests++;pending.push(route)});
  try {
   await p.goto(origin+'/admin/stores');
   const submit=p.getByRole('button',{name:'Clone and open',exact:true});
   const progress=p.locator('#clone-asset-progress');
   assert.equal(await progress.isVisible(),false,'An idle form must not claim it is cloning');
   assert.equal(await submit.isVisible(),true);
   await p.locator('#clone-asset-form [name=url]').fill('https://source.example/');
   const started=p.waitForRequest(origin+'/admin/assets/import');await submit.click();await started;
   assert.equal(await progress.isVisible(),true);assert.equal(await submit.isVisible(),false);
   await p.getByRole('button',{name:'Cancel clone',exact:true}).click();
   await p.waitForFunction(()=>!document.querySelector('#clone-asset-form').hasAttribute('aria-busy')||document.querySelector('#clone-asset-form').getAttribute('aria-busy')==='false');
   assert.equal(await progress.isVisible(),false);assert.equal(await submit.isVisible(),true);
   await pending.shift().abort().catch(()=>{});
   const again=p.waitForRequest(origin+'/admin/assets/import');await submit.click();await again;
   assert.equal(await progress.isVisible(),true);assert.equal(requests,2,'Cancel must allow a fresh attempt');
   await pending.shift().fulfill({status:302,headers:{location:'/admin/stores?flash=Clone%20completed'},body:''});
   await p.waitForURL('**/admin/stores?flash=Clone%20completed');
   assert.equal(await p.locator('#clone-asset-progress').isVisible(),false);assert.equal(await p.getByRole('button',{name:'Clone and open',exact:true}).isVisible(),true);
  } finally {for(const route of pending)await route.abort().catch(()=>{});await ctx.close();}
 });
 for(const failure of ['network','server','unexpected response']) await t.test('clone '+failure+' failure returns to a usable form',async()=>{
  const {ctx,p}=await context(true);
  await ctx.route(origin+'/admin/assets/import',route=>failure==='network'?route.abort('failed'):route.fulfill({status:failure==='server'?503:200,body:'The request did not complete'}));
  try {await p.goto(origin+'/admin/stores');await p.locator('#clone-asset-form [name=url]').fill('https://source.example/');await p.getByRole('button',{name:'Clone and open',exact:true}).click();await p.waitForURL('**/admin/stores?flash=*');assert.match(new URL(p.url()).searchParams.get('flash'),/Could not clone/);assert.equal(await p.locator('#clone-asset-progress').isVisible(),false);assert.equal(await p.getByRole('button',{name:'Clone and open',exact:true}).isVisible(),true);}finally{await ctx.close();}
 });
 assert.deepEqual(errors,[]);
});
