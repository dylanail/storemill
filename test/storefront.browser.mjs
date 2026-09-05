import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { mkdtempSync, rmSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { chromium } from 'playwright';

// A real isolated storefront. These browser journeys never use merchant data,
// send a real payment, or depend on an external reference staying online.
const dir=mkdtempSync(join(tmpdir(),'amboras-storefront-browser-'));
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',AMBORAS_STOREFRONT_HOST:'',AMBORAS_PUBLIC_ORIGIN:'',AMBORAS_ADMIN_HOST:''});
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');
const {register}=await import('../src/control/auth.ts');
const {createStore,publish,setTheme}=await import('../src/control/stores.ts');
const {seedDefaultRegion}=await import('../src/domain/regions.ts');
const {createProduct,updateProduct}=await import('../src/domain/catalog.ts');
const {createPage,updatePage,PAGE_TEMPLATES,newBlock}=await import('../src/pages/store.ts');
const {clonePage}=await import('../src/pages/clone.ts');
const {createPromotion}=await import('../src/domain/promotions.ts');
const {upsertBundle}=await import('../src/domain/bundles.ts');
const {mapMediaDocument}=await import('../src/pages/clone-media.ts');
const db=getDb();
const user=register(db,{email:'browser@example.test',password:'only-for-an-isolated-browser-test'});
const store=createStore(db,user.id,{name:'Everyday Essentials',prompt:'Everyday comfort with considered details.'});
seedDefaultRegion(db,store.id,'USD');
setTheme(db,store.id,{nav:[{label:'Shop all',href:'/collections/all'},{label:'Our story',href:'/pages/about'},{label:'Shipping & returns',href:'/pages/shipping'}]});
const picture='/_media/render.svg?kind=product&seed=browser&title=Everyday+Cushion';
const product=createProduct(db,store.id,{title:'The Everyday Cushion',subtitle:'Comfort wherever the day takes you',status:'published',heroImage:picture,media:[{url:picture+'&view=two',alt:'Cushion side view',type:'image'}],options:[{title:'Size',values:[{value:'Standard'},{value:'Large'}]}],variants:[{title:'Standard',priceCents:4900,inventory:100,optionValues:{Size:'Standard'}},{title:'Large',priceCents:6900,inventory:100,optionValues:{Size:'Large'}}],content:{benefits:[{title:'Comfort for the whole day',body:'An everyday shape for a familiar seat.'}],faq:[{q:'How do I choose a size?',a:'Measure your chair and compare the dimensions.'}],specs:[{label:'Care',value:'Wipe clean with a damp cloth.'}]}});
createPromotion(db,store.id,{title:'Browser test discount',kind:'percentage',value:10,code:'TEN'});
const templateInput={storeName:store.name,product:{id:product.id,title:product.title,subtitle:product.subtitle,image:picture,description:'Considered details for everyday comfort.'},research:{triggers:['Comfort that lasts','A shape that fits'],objections:[{objection:'How does it fit?',answer:'Measure the seat before ordering.'}],comparison:{rows:[{label:'Shape',us:'Designed for everyday use',them:'One size only'}]},competitors:[{name:'A standard cushion'}]}};
const pages=PAGE_TEMPLATES.filter(t=>t.key!=='checkout').map(template=>createPage(db,store.id,{title:template.name,handle:'template-'+template.key,kind:template.kind,blocks:template.build(templateInput),status:'published'}));
const interactive=createPage(db,store.id,{title:'Interactive blocks',handle:'interactive',kind:'landing',status:'published',blocks:[newBlock('header',{showNav:true}),newBlock('gallery',{images:picture+'\n'+picture+'&view=two',alt:'Product details'}),newBlock('buy-box',{productId:product.id,buyNow:false}),newBlock('faq',{items:'How does it fit?|Measure the seat before ordering.'}),newBlock('footer')]});
updateProduct(db,store.id,product.id,{metadata:{['sourceVariant:'+product.variants[0].id]:'original-standard',['sourceVariant:'+product.variants[1].id]:'original-large'}});
const svg=(color)=>'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="'+color+'"/><circle cx="300" cy="300" r="160" fill="#fff"/></svg>').toString('base64');
const sourceFixture=readFileSync(new URL('./fixtures/storefront/copied-product.html',import.meta.url),'utf8').replace('PICTURE_ONE',svg('#b2cbc0')).replace('PICTURE_TWO',svg('#7d9eb0'));
const cloned=await clonePage('https://reference.example/products/everyday',{storeId:store.id,localizeImages:false,fetchImpl:async()=>new Response(sourceFixture,{headers:{'content-type':'text/html'}})});
const copied=createPage(db,store.id,{title:'Copied product',handle:'copied-product',kind:'product',mode:'html',productId:product.id,rawHtml:cloned.html,sourceUrl:cloned.sourceUrl,status:'published'});
let actualImported=null,actualVariantId='',actualBundleId='';
if(process.env.STOREFRONT_IMPORT_FIXTURE){
 const actualProduct=createProduct(db,store.id,{title:'Nuvana™ Orthopedic Cushion',heroImage:picture,status:'published',variants:[{title:'Default Title',priceCents:5495,inventory:100}]});
 actualVariantId=actualProduct.variants[0].id;
 let raw=readFileSync(process.env.STOREFRONT_IMPORT_FIXTURE,'utf8');
 if(/\sdata-copy-bundle=/.test(raw)){
  // These observed source prices are installed only in this temporary catalog.
  // Remap explicit binding attributes without touching source layout, copy, or media.
  const expected=new Map([[1,5495],[2,9342],[4,17584]]),observed=new Map();
  mapMediaDocument(raw,tag=>{const quantity=/\sdata-copy-bundle-quantity="(\d+)"/.exec(tag),total=/\sdata-copy-bundle-total="(\d+)"/.exec(tag);if(quantity&&total)observed.set(Number(quantity[1]),Number(total[1]));return tag;});
  assert.deepEqual(observed,expected,'actual bundle fixture must retain verified source totals');
  const bundle=upsertBundle(db,store.id,{productId:actualProduct.id,title:'Verified source quantity offers',tiers:[{quantity:1,unitPriceCents:5495},{quantity:2,unitPriceCents:4671},{quantity:4,unitPriceCents:4396}]});actualBundleId=bundle.id;
  raw=mapMediaDocument(raw,tag=>tag.replace(/\sdata-copy-bundle=(['"])[^'"]*\1/g,' data-copy-bundle="'+bundle.id+'"').replace(/\sdata-copy-product-id=(['"])[^'"]*\1/g,' data-copy-product-id="'+actualProduct.id+'"').replace(/\sdata-copy-variant-id=(['"])[^'"]*\1/g,' data-copy-variant-id="'+actualVariantId+'"'));
 }
 actualImported=createPage(db,store.id,{title:'Actual imported source regression',handle:'actual-copy',kind:'product',mode:'html',productId:actualProduct.id,rawHtml:raw,sourceUrl:'https://shopnuvanahealth.com/products/cushion',status:'published'});
}
publish(db,store.id);
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const base=origin+'/s/'+store.slug;
const launch={headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})};
const browser=await chromium.launch(launch);
after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));db.handle.close();rmSync(dir,{recursive:true,force:true});});
const errors=[];
async function newPage(width,height=width>=1000?900:width>=768?1180:width===320?568:844){const context=await browser.newContext({viewport:{width,height},isMobile:width<=390||height<500,hasTouch:width<=390||height<500});await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin===origin&&/^\/_uploads\/[a-z0-9_]+\/up_[a-z0-9]+\.[a-z]+$/.test(url.pathname)){const roots=[process.env.STOREFRONT_IMPORT_ASSETS_ROOT,...(process.env.STOREFRONT_IMPORT_ASSETS_ROOTS||'').split(delimiter)].filter(Boolean);const path=roots.map(root=>join(root,url.pathname.slice('/_uploads/'.length))).find(path=>existsSync(path));if(path){const extension=path.split('.').pop();return r.fulfill({body:readFileSync(path),contentType:({jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',avif:'image/avif',svg:'image/svg+xml',ico:'image/x-icon'})[extension]||'application/octet-stream'});}}return r.request().url().startsWith(origin)||r.request().url().startsWith('data:')?r.continue():r.abort();});const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',e=>errors.push(e.message));return {context,page};}
async function fits(page,label){const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,body:document.body.scrollWidth}));assert.ok(dimensions.scroll<=dimensions.width+1&&dimensions.body<=dimensions.width+1,label+' horizontal overflow: '+JSON.stringify(dimensions));}
async function screenshot(page,name,width){if(process.env.STOREFRONT_SCREENSHOTS){mkdirSync(process.env.STOREFRONT_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.STOREFRONT_SCREENSHOTS,name+'-'+width+'.png'),animations:'disabled'});}}
async function copiedSearch(page){const original=page.url(),search=page.locator('details-modal.header__search:visible').first(),details=search.locator('details');await search.locator('summary').click();assert.equal(await search.locator('[name=q]').isVisible(),true);await search.locator('.search-modal__close-button').click();assert.equal(await details.getAttribute('open'),null,'Search close button closes copied modal');await search.locator('summary').click();await page.keyboard.press('Escape');assert.equal(await details.getAttribute('open'),null,'Escape closes copied search');await search.locator('summary').click();await search.locator('[name=q]').fill('Cushion');await search.locator('[name=q]').press('Enter');await page.waitForURL('**/search?**');assert.match(await page.locator('main').textContent(),/Cushion/);await fits(page,'Search results');await page.goto(original);await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);}

await test('responsive storefront browser journeys',async suite=>{
for(const width of [1440,820,390,320])await suite.test('generated pages, buttons and checkout at '+width+'px',async t=>{
 const {context,page}=await newPage(width);
 try{
  await t.test('every built-in generation template fits and has a usable call to action',async()=>{
   for(const entry of pages){const response=await page.goto(base+'/pages/'+entry.handle);assert.equal(response.status(),200,entry.title);await fits(page,entry.title);const cta=page.locator('a.btn:visible,button.btn:visible').first();if(await cta.count()){await cta.scrollIntoViewIfNeeded();assert.equal(await cta.isVisible(),true,entry.title+' CTA visible');const r=await cta.boundingBox();assert.ok(r.x>=-1&&r.x+r.width<=width+1,entry.title+' CTA fits');}await page.evaluate(()=>scrollTo(0,0));await screenshot(page,entry.handle,width);}
  });
  await t.test('store navigation remains reachable on mobile and tablet',async()=>{
   await page.goto(base+'/collections/all');
   if(width<=900){const toggle=page.locator('[data-nav-toggle]');assert.equal(await toggle.isVisible(),true);await toggle.click();assert.equal(await toggle.getAttribute('aria-expanded'),'true');assert.equal(await page.locator('nav.main').isVisible(),true);await page.keyboard.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');await toggle.click();}
   await page.locator('nav.main').getByRole('link',{name:'Our story',exact:true}).click();assert.match(page.url(),/\/pages\/about$/);await fits(page,'Navigation');
  });
  await t.test('product gallery and variants update, cart quantities and discount work, checkout fits',async()=>{
   await page.goto(base+'/products/'+product.handle);await fits(page,'Product');
   await page.getByRole('button',{name:'Show image 2',exact:true}).click();assert.match(await page.locator('#pdp-main').getAttribute('src'),/view=two/);
   await page.getByRole('button',{name:'Large',exact:true}).click();assert.equal(await page.locator('#pdp-variant').inputValue(),product.variants[1].id);assert.match(await page.locator('#pdp-price').textContent(),/69\.00/);
   await page.locator('#pdp-cta').click();await page.waitForURL('**/cart');await fits(page,'Cart');await screenshot(page,'cart',width);
   await page.getByRole('spinbutton',{name:'Quantity',exact:true}).fill('2');await page.getByRole('button',{name:'Set',exact:true}).click();assert.equal(await page.getByRole('spinbutton',{name:'Quantity',exact:true}).inputValue(),'2');
   await page.getByRole('textbox',{name:'Discount code',exact:true}).fill('TEN');await page.getByRole('button',{name:'Apply',exact:true}).click();assert.match(await page.locator('main').textContent(),/13\.80/);
   await page.getByRole('link',{name:'Checkout',exact:true}).click();await page.waitForURL('**/checkout');await fits(page,'Checkout');
   if(width<=900){const summary=page.locator('.co-summary-mobile');assert.equal(await summary.isVisible(),true);await summary.locator('summary').click();assert.equal(await summary.getAttribute('open'),'');}
   if(width<=640){for(const name of ['line2','state','phone']){const field=await page.locator('#checkout-form [name='+name+']').boundingBox();assert.ok(field.width>=width-80,'Phone checkout '+name+' field uses the available row width');}}
   assert.equal(await page.locator('#checkout-form [name=email]').isVisible(),true);assert.equal(await page.locator('#pay').isEnabled(),true);await screenshot(page,'checkout',width);
  });
  await t.test('copied gallery, price, mobile menu and cart drawer stay functional',async()=>{
   await page.goto(base+'/pages/'+copied.handle);await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);await fits(page,'Copied product');
   const image=page.getByRole('img',{name:'Everyday cushion',exact:true});assert.equal(await image.isVisible(),true);assert.ok(await image.evaluate(img=>img.naturalWidth>0));assert.equal(await page.locator('.product-page-price').isVisible(),true);
   await page.getByRole('button',{name:'Next image',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.product__media-list').scrollLeft>100);
   if(width<=900){await page.getByLabel('Menu',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('#Details-menu-drawer-container').classList.contains('menu-opening'));await page.locator('#menu-drawer').waitFor({state:'visible'});assert.equal(await page.locator('#menu-drawer').isVisible(),true);await page.getByRole('button',{name:'Close menu',exact:true}).click();assert.equal(await page.locator('#Details-menu-drawer-container').getAttribute('open'),null);}
   await copiedSearch(page);
   await page.locator('select[name=id]').selectOption('original-large');assert.match(await page.locator('[data-product-price]').textContent(),/69\.00/);
   await page.getByRole('button',{name:'Add to cart',exact:true}).click();await page.waitForFunction(()=>document.querySelector('cart-drawer').hasAttribute('data-copy-drawer-open'));assert.match(await page.locator('[data-owned-cart-lines]').textContent(),/Large/);assert.equal(await page.locator('[data-owned-cart-lines]').isVisible(),true);assert.equal(await page.locator('cart-drawer button[name=checkout]').isEnabled(),true);assert.doesNotMatch(await page.locator('.cart-drawer__totals__row__money').textContent(),/\$0\.00/);await fits(page,'Copied drawer');await screenshot(page,'copied-cart-drawer',width);
   const quantity=page.locator('[data-copy-quantity]').last();const changed=page.waitForResponse(response=>response.url().endsWith('/cart/update')&&response.request().method()==='POST');await quantity.fill('2');await quantity.press('Tab');assert.equal((await changed).status(),200);await page.waitForFunction(()=>[...document.querySelectorAll('[data-copy-quantity]')].some(i=>i.value==='2'));
   await page.keyboard.press('Escape');assert.equal(await page.locator('cart-drawer').getAttribute('aria-hidden'),'true');await page.locator('.header__icon--cart').click();await page.waitForFunction(()=>document.querySelector('cart-drawer').hasAttribute('data-copy-drawer-open'));
   await page.locator('cart-drawer').getByRole('button',{name:'Checkout',exact:true}).click();await page.waitForURL('**/checkout');assert.equal(await page.locator('#checkout-form').isVisible(),true);await fits(page,'Copied checkout');
  });
  await t.test('generated quiz advances to a working offer link',async()=>{
   await page.goto(base+'/pages/template-quiz');const quiz=page.locator('[data-quiz]');const count=await quiz.locator('.qstep').count();for(let i=0;i<count;i++)await quiz.locator('.qstep:visible .qopt').first().click();assert.equal(await quiz.locator('.qresult').isVisible(),true);await fits(page,'Quiz result');const cta=quiz.locator('[data-quiz-cta]');assert.equal(await cta.isVisible(),true);const href=await cta.getAttribute('href');await cta.click();if(href.startsWith('#'))assert.equal(await page.locator(href).count()>0,true,'Quiz target exists');else assert.match(page.url(),/quiz=/);
  });
  await t.test('block buy box uses selected variant and native FAQ expands',async()=>{
   await page.goto(base+'/pages/'+interactive.handle);
   if(width<=900){await page.locator('[data-nav-toggle]').click();assert.equal(await page.locator('nav.main').isVisible(),true);await page.keyboard.press('Escape');}
   await page.getByRole('button',{name:'Image 2',exact:true}).click();assert.match(await page.locator('.gal-main').getAttribute('src'),/view=two/);
   await page.locator('.buyform select[name=variantId]').selectOption(product.variants[1].id);assert.match(await page.locator('.buyform [data-total]').textContent(),/69\.00/);assert.match(await page.locator('[data-variant-price]').textContent(),/69\.00/);
   const faq=page.locator('details').filter({hasText:'How does it fit?'}).first();const initial=await faq.getAttribute('open');await faq.locator('summary').click();assert.notEqual(await faq.getAttribute('open'),initial);
   await page.locator('.buyform button[type=submit]').click();await page.waitForURL('**/cart');assert.match(await page.locator('main').textContent(),/Large/);await fits(page,'Block cart');
  });
 }finally{await context.close();}
});
if(actualImported)for(const width of [1440,820,390,320])await suite.test('actual imported source gallery, menu and cart shell at '+width+'px',async()=>{const {context,page}=await newPage(width);try{
 await page.goto(base+'/pages/'+actualImported.handle);await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);const gallery=page.locator('media-gallery .product__media-list img').first();assert.equal(await gallery.isVisible(),true);await gallery.evaluate(img=>img.decode());assert.ok(await gallery.evaluate(img=>img.naturalWidth>0));await fits(page,'Actual source product');
 if(width<=900){const menu=page.locator('#Details-menu-drawer-container > summary');if(await menu.isVisible()){await menu.click();await page.waitForFunction(()=>document.querySelector('#Details-menu-drawer-container').classList.contains('menu-opening'));await page.locator('#menu-drawer').waitFor({state:'visible'});assert.equal(await page.locator('#menu-drawer').isVisible(),true);await page.locator('.menu-drawer__close-menu-btn').first().click();}}
 await copiedSearch(page);
 if(actualBundleId){assert.equal(await page.locator('[data-copy-bundle]').getAttribute('data-copy-bundle'),actualBundleId);assert.equal(await page.locator('[data-copy-bundle-quantity][aria-checked=\"true\"]').getAttribute('data-copy-bundle-quantity'),'1','the source Buy 1 selection is preserved');}
 await page.locator('product-form button[name=add],product-form button.product-form__submit').first().click();await page.waitForFunction(()=>document.querySelector('cart-drawer').hasAttribute('data-copy-drawer-open'));assert.equal(await page.locator('[data-owned-cart-line]').first().isVisible(),true);assert.match(await page.locator('.drawer__heading').textContent(),/1/);assert.match(await page.locator('.cart-drawer__totals__row__money').last().textContent(),/54\.95/);assert.equal(await page.locator('#CartDrawer-Checkout').isEnabled(),true);await fits(page,'Actual source drawer');await screenshot(page,'actual-nuvana-cart',width);
 const ownedCart=await context.request.get(base+'/cart/state').then(response=>response.json());assert.equal(ownedCart.items.length,1);assert.equal(ownedCart.items[0].variantId,actualVariantId);assert.equal(ownedCart.items[0].quantity,1);assert.equal(ownedCart.totals.subtotalCents-ownedCart.totals.discountCents,5495);
 await page.locator('#CartDrawer-Checkout').click();await page.waitForURL('**/checkout');assert.equal(await page.locator('#checkout-form').isVisible(),true);assert.deepEqual((await context.request.get(base+'/cart/state').then(response=>response.json())).items,ownedCart.items,'checkout keeps exactly the selected source cart items');await fits(page,'Actual source checkout');await screenshot(page,'actual-nuvana-checkout',width);
}finally{await context.close();}});
const checkoutTemplate=PAGE_TEMPLATES.find(template=>template.key==='checkout');
const blockCheckout=createPage(db,store.id,{title:'Block checkout',handle:'block-checkout',kind:'checkout',role:'checkout',blocks:checkoutTemplate.build(templateInput),status:'published'});
for(const width of [1440,820,390,320])await suite.test('generated checkout template at '+width+'px',async()=>{const {context,page}=await newPage(width);try{await page.goto(base+'/products/'+product.handle);await page.getByRole('button',{name:'Buy it now',exact:true}).click();await page.waitForURL('**/checkout');assert.equal(await page.locator('.checkout--blk').count(),1);await fits(page,'Block checkout');await screenshot(page,'block-checkout',width);if(width<=900){await page.locator('.co-summary-mobile summary').click();assert.equal(await page.locator('.co-summary-mobile').getAttribute('open'),'');}assert.equal(await page.locator('#pay').isEnabled(),true);}finally{await context.close();}});
await suite.test('landscape phone keeps product and checkout controls reachable',async()=>{const {context,page}=await newPage(844,390);try{await page.goto(base+'/products/'+product.handle);await fits(page,'Landscape product');await page.getByRole('button',{name:'Buy it now',exact:true}).click();await page.waitForURL('**/checkout');await fits(page,'Landscape checkout');await page.locator('#pay').scrollIntoViewIfNeeded();const pay=await page.locator('#pay').boundingBox();assert.ok(pay.height>=44&&pay.y>=0&&pay.y+pay.height<=390,'Landscape pay button is visible and touch sized');await screenshot(page,'landscape-checkout',844);}finally{await context.close();}});
upsertBundle(db,store.id,{productId:product.id});
for(const width of [1440,820,390,320])await suite.test('selected bundle total follows variant and quantity at '+width+'px',async()=>{const {context,page}=await newPage(width);try{
 await page.goto(base+'/pages/'+interactive.handle);const form=page.locator('.buyform');assert.equal(await form.locator('[name=quantity]:checked').inputValue(),'2');assert.match(await form.locator('button [data-total]').textContent(),/83\.30/);
 await form.locator('select[name=variantId]').selectOption(product.variants[1].id);assert.match(await form.locator('button [data-total]').textContent(),/117\.30/);assert.match(await form.locator('.tier:has(input:checked) [data-tier-total]').textContent(),/117\.30/);
 await form.locator('[name=quantity][value="3"]').check();assert.match(await form.locator('button [data-total]').textContent(),/155\.25/);await fits(page,'Bundle purchase block');
 await form.locator('button[type=submit]').click();await page.waitForURL('**/cart');assert.equal(await page.getByRole('spinbutton',{name:'Quantity',exact:true}).inputValue(),'3');assert.match(await page.locator('main').textContent(),/155\.25/);
}finally{await context.close();}});
{
 const checkoutFixture=process.env.STOREFRONT_CHECKOUT_FIXTURE||new URL('./fixtures/storefront/copied-checkout.html',import.meta.url);
 createPage(db,store.id,{title:'Copied checkout regression',handle:'actual-checkout-copy',kind:'checkout',role:'checkout',mode:'html',rawHtml:readFileSync(checkoutFixture,'utf8'),sourceUrl:'https://reference.example/checkout',status:'published'});
 for(const width of [1440,820,390,320])await suite.test((process.env.STOREFRONT_CHECKOUT_FIXTURE?'actual funnel':'copied fixture')+' checkout form and summary at '+width+'px',async()=>{const {context,page}=await newPage(width);try{
  assert.equal((await context.request.post(base+'/cart/add',{data:{variantId:product.variants[0].id,quantity:1},headers:{accept:'application/json'}})).status(),200);
  await page.goto(base+'/checkout');await page.waitForFunction(()=>window.__COPY_COMMERCE_READY);assert.equal(await page.locator('#checkout-form').count(),1);assert.equal(await page.locator('#checkout-form [name=email]').isVisible(),true);assert.equal(await page.locator('[name=cardNumber],[name=cardDate],[name=cardSecurityCode],[name=emailAddress]').count(),0);assert.equal(await page.locator('#pay').isEnabled(),true);await fits(page,'Actual copied checkout');
  for(const name of ['email','country','firstName','lastName','line1','line2','city','state','postal','phone']){const field=page.locator('#checkout-form [name='+name+']');await field.scrollIntoViewIfNeeded();const box=await field.boundingBox();assert.ok(box&&box.width>=100&&box.height>=44&&box.x>=0&&box.x+box.width<=width+1,'Source styles must not collapse, float or clip '+name+' at '+width+'px');}
  await page.locator('#pay').scrollIntoViewIfNeeded();const pay=await page.locator('#pay').boundingBox();assert.ok(pay&&pay.height>=44&&pay.x>=0&&pay.x+pay.width<=width+1,'Copied checkout payment button is touch sized and reachable');
  const summary=page.locator('[data-owned-summary-details]');if(await summary.count()){assert.equal(await summary.getAttribute('open'),width<=740?null:'');if(width<=740){await summary.locator('summary').click();assert.equal(await summary.getAttribute('open'),'');}}
  if(width>740){const summaryBox=await summary.locator('summary').boundingBox(),emailBox=await page.locator('#checkout-form [name=email]').boundingBox();assert.ok(summaryBox.y<=emailBox.y+80,'Copied tablet/desktop summary begins beside the form, not at the bottom of its column');}
  assert.match(await page.locator('[data-owned-checkout-summary]').textContent(),/The Everyday Cushion/);await page.evaluate(()=>scrollTo(0,0));await screenshot(page,'actual-funnel-checkout',width);
 }finally{await context.close();}});
}
await suite.test('storefront interactions produce no JavaScript exceptions',()=>assert.deepEqual(errors,[]));
});
