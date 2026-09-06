import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'discount-builder-'));
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',AMBORAS_STOREFRONT_HOST:'',AMBORAS_PUBLIC_ORIGIN:'',AMBORAS_ADMIN_HOST:'',OPENAI_API_KEY:'',ANTHROPIC_API_KEY:'',STRIPE_SECRET_KEY:''});
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');const {register}=await import('../src/control/auth.ts');
const {createBlankAsset}=await import('../src/control/assets.ts');const {publish}=await import('../src/control/stores.ts');
const {createProduct}=await import('../src/domain/catalog.ts');const {upsertBundle,listBundles}=await import('../src/domain/bundles.ts');
const {listPromotions}=await import('../src/domain/promotions.ts');
const {createPage}=await import('../src/pages/store.ts');
const db=getDb(),user=register(db,{email:'discount-tests@example.com',password:'test-password-long'}),store=createBlankAsset(db,user.id,{name:'Nuvana Health',kind:'store',currency:'USD'});
const product=createProduct(db,store.id,{title:'Nuvana Orthopedic Cushion',status:'published',options:[{title:'Color',values:[{value:'Black'},{value:'Gray'}]}],variants:[{title:'Black',priceCents:5495,compareAtCents:10990,inventory:200,optionValues:{Color:'Black'}},{title:'Gray',priceCents:5995,compareAtCents:11990,inventory:200,optionValues:{Color:'Gray'}}]});
const gift=createProduct(db,store.id,{title:'Travel cover',status:'published',variants:[{title:'Default',priceCents:1500,inventory:100}]});
upsertBundle(db,store.id,{productId:product.id,title:'Bundle & save',tiers:[{quantity:1,discountPercent:0,unitPriceCents:5495,compareAtTotalCents:10990,label:'Buy 1'},{quantity:2,discountPercent:15,unitPriceCents:4671,compareAtTotalCents:21980,label:'Buy 2',badge:'Most popular'},{quantity:4,discountPercent:20,unitPriceCents:4396,compareAtTotalCents:43960,label:'Buy 4',badge:'Best value'}]});
const buyPage=createPage(db,store.id,{title:'Cushion offer',status:'published',mode:'blocks',handle:'cushion-offer',blocks:[{id:'buy',type:'buy-box',settings:{productId:product.id,buyNow:false}}]});
publish(db,store.id);
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(async()=>{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
const errors=[];
async function context(){const ctx=await browser.newContext({viewport:{width:1440,height:1000}});await ctx.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());await ctx.request.post(origin+'/login',{form:{email:user.email,password:'test-password-long'}});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(10000);return {ctx,p};}
async function save(p){const response=p.waitForResponse(r=>r.url().includes('/admin/discounts/save'));await p.locator('[data-discount-save]').click();const result=await response;assert.equal(result.status(),200,await result.text());await p.locator('dialog').waitFor({state:'hidden'});}
async function quote(p,total){await p.waitForFunction(value=>document.querySelector('.discount-quote .discount-total')?.textContent.includes(value),total);}
await test('visual discount builder browser workflows',async t=>{
 await t.test('existing imported prices populate editable cards and preview never mutates offers',async()=>{
  const {ctx,p}=await context();try{
   await p.goto(origin+'/admin/bundles');assert.equal(await p.locator('textarea[name=tiers]').count(),0);assert.equal(await p.locator('.discount-offer').count(),1);assert.match(await p.locator('.discount-pills').textContent(),/93.42/);
   const before=listPromotions(db,store.id).length;await p.getByRole('button',{name:'Edit Bundle & save',exact:true}).click();assert.equal(await p.locator('.discount-tier').count(),3);
   for(const [i,q,total,compare] of [[0,'1','54.95','109.90'],[1,'2','93.42','219.80'],[2,'4','175.84','439.60']]){assert.equal(await p.locator(`[name="tier.${i}.quantity"]`).inputValue(),q);assert.equal(await p.locator(`[name="tier.${i}.value"]`).inputValue(),total);assert.equal(await p.locator(`[name="tier.${i}.compare"]`).inputValue(),compare);}
   await quote(p,'$93.42');await p.locator('[name="sample.0.quantity"]').fill('4');await quote(p,'$175.84');assert.equal(listPromotions(db,store.id).length,before);
   if(process.env.DISCOUNT_EDITOR_SCREENSHOT)await p.screenshot({path:process.env.DISCOUNT_EDITOR_SCREENSHOT});
   await save(p);await p.reload();assert.equal(await p.locator('.discount-offer').count(),1);assert.equal(listBundles(db,store.id)[0].tiers[2].quantity,4);
  }finally{await ctx.close()}
 });
 await t.test('multipacks support odd total prices, named gifts, test quantities and recovery from server validation',async()=>{
  const {ctx,p}=await context();try{
   await p.goto(origin+'/admin/bundles');await p.getByRole('button',{name:'Create product offer',exact:true}).click();await p.getByLabel('Product',{exact:true}).selectOption(gift.id);await p.getByRole('button',{name:'Remove tier 3',exact:true}).click();await p.getByRole('button',{name:'Remove tier 1',exact:true}).click();await p.locator('[name="tier.0.priceType"]').selectOption('total');await p.locator('[name="tier.0.value"]').fill('19.99');await quote(p,'$19.99');await p.locator('[name="sample.0.quantity"]').fill('3');await quote(p,'$34.99');
   await p.getByLabel('Offer title',{exact:true}).fill('Two covers');await p.locator('[name="tier.0.value"]').fill('199.99');await p.locator('[data-discount-save]').click();await p.getByRole('alert').filter({hasText:'cannot exceed'}).waitFor();assert.equal(await p.getByLabel('Offer title',{exact:true}).inputValue(),'Two covers');assert.equal(await p.locator('dialog').isVisible(),true);
   await p.locator('[name="tier.0.value"]').fill('19.99');await p.locator('[name="sample.0.quantity"]').fill('0');await save(p);assert.equal(listBundles(db,store.id).find(b=>b.productId===gift.id).tiers[0].totalPriceCents,1999,'an invalid test cart cannot prevent saving a valid offer');
   await p.getByRole('button',{name:'Edit Two covers',exact:true}).click();await p.getByRole('button',{name:'Add tier',exact:true}).click();assert.equal(await p.locator('.discount-tier').count(),2);await p.getByRole('button',{name:'Remove tier 2',exact:true}).click();await p.keyboard.press('Escape');assert.equal(await p.locator('dialog').isVisible(),false);assert.equal(await p.getByRole('button',{name:'Edit Two covers',exact:true}).evaluate(el=>el===document.activeElement),true);
   await p.getByRole('button',{name:'Deactivate Two covers',exact:true}).click();await p.getByRole('button',{name:'Activate Two covers',exact:true}).waitFor();assert.equal(listBundles(db,store.id).find(b=>b.productId===gift.id).status,'paused');
  }finally{await ctx.close()}
 });
 await t.test('every discount type has relevant controls and general codes use product names instead of IDs',async()=>{
  const {ctx,p}=await context();try{
   await p.goto(origin+'/admin/promotions');await p.getByRole('button',{name:'Create discount',exact:true}).click();assert.equal(await p.locator('[data-discount-type]').count(),7);
   for(const [type,selector] of [['quantity','[name=productId]'],['tiered','[name="tier.0.quantity"]'],['bogo','[name=buyQuantity]'],['mix_match','[name=requiredDistinctProducts]'],['fixed_bundle','[name=bundlePrice]'],['free_shipping','[name=minSubtotal]'],['amount','[name=value]']]){await p.locator(`[data-discount-type="${type}"]`).click();assert.equal(await p.locator(selector).isVisible(),true)}
   if(process.env.DISCOUNT_TYPES_SCREENSHOT)await p.screenshot({path:process.env.DISCOUNT_TYPES_SCREENSHOT});
   await p.getByLabel('Discount name',{exact:true}).fill('Welcome cushion offer');await p.getByLabel('Discount method',{exact:true}).selectOption('code');await p.getByLabel('Discount code',{exact:true}).fill('WELCOME10');await p.getByLabel('Applies to',{exact:true}).selectOption('products');await p.getByLabel('Search eligible products',{exact:true}).fill('cushion');assert.equal(await p.locator('[data-pick-list=productIds] label:visible').count(),1);await p.locator(`[data-pick=productIds][value="${product.id}"]`).check();await p.getByLabel('Can combine with other discounts',{exact:true}).check();await save(p);
   const promo=listPromotions(db,store.id).find(p=>p.code==='WELCOME10');assert.deepEqual(promo.rules.productIds,[product.id]);
   await p.getByRole('button',{name:'Edit Welcome cushion offer',exact:true}).click();assert.equal(await p.getByLabel('Discount code',{exact:true}).inputValue(),'WELCOME10');await p.getByRole('button',{name:'Cancel',exact:true}).click();
   await p.getByRole('button',{name:'Deactivate Welcome cushion offer',exact:true}).click();await p.getByRole('button',{name:'Activate Welcome cushion offer',exact:true}).waitFor();
  }finally{await ctx.close()}
 });
 await t.test('failed saves preserve the draft and retry successfully',async()=>{
  const {ctx,p}=await context();try{
   await p.goto(origin+'/admin/promotions');await p.getByRole('button',{name:'Create discount',exact:true}).click();await p.getByLabel('Discount name',{exact:true}).fill('Retry offer');
   await ctx.route('**/admin/discounts/save?*',route=>route.abort('failed'));await p.locator('[data-discount-save]').click();await p.locator('[data-discount-error]').filter({hasText:/fetch|network|load/i}).waitFor();assert.equal(await p.getByLabel('Discount name',{exact:true}).inputValue(),'Retry offer');assert.equal(await p.locator('[data-discount-save]').isEnabled(),true);
   await ctx.unroute('**/admin/discounts/save?*');await save(p);await p.getByRole('button',{name:'Deactivate Retry offer',exact:true}).click();await p.getByRole('button',{name:'Activate Retry offer',exact:true}).waitFor();
  }finally{await ctx.close()}
 });
 await t.test('dialog and footer remain usable without horizontal overflow on desktop and phones',async()=>{
  const {ctx,p}=await context();try{
   await p.goto(origin+'/admin/bundles');await p.getByRole('button',{name:'Edit Bundle & save',exact:true}).click();
   for(const width of [1440,820,390,320]){await p.setViewportSize({width,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const geometry=await p.locator('dialog').evaluate(el=>({left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,scroll:el.querySelector('.discount-dialog-body').scrollWidth,client:el.querySelector('.discount-dialog-body').clientWidth,foot:el.querySelector('.discount-dialog-foot').getBoundingClientRect().bottom}));assert.ok(geometry.left>=0&&geometry.right<=width);assert.ok(geometry.scroll<=geometry.client+1);assert.ok(geometry.foot<=844);
    await p.locator('[data-discount-save]').scrollIntoViewIfNeeded();assert.equal(await p.locator('[data-discount-save]').isVisible(),true);if(width===390&&process.env.DISCOUNT_MOBILE_SCREENSHOT)await p.screenshot({path:process.env.DISCOUNT_MOBILE_SCREENSHOT});
   }
  }finally{await ctx.close()}
 });
 await t.test('product variant changes preserve exact offer and original prices through add-to-cart',async()=>{
  const {ctx,p}=await context();try{
   await p.goto(origin+'/s/'+store.slug+'/products/'+product.handle);await p.locator('#pdp-form').waitFor();assert.match(await p.locator('.tier').nth(1).textContent(),/93.42/);assert.match(await p.locator('.tier').nth(1).textContent(),/219.80/);
   await p.locator('[data-option][data-value=Gray]').click();assert.match(await p.locator('.tier').nth(1).textContent(),/93.42/);assert.match(await p.locator('.tier').nth(1).textContent(),/219.80/);await p.locator('#pdp-cta').click();await p.waitForURL('**/cart');assert.match(await p.locator('body').textContent(),/93.42/);
   await p.goto(origin+'/s/'+store.slug+'/pages/'+buyPage.handle);await p.locator('.buyform').waitFor();await p.locator('select[name=variantId]').selectOption(product.variants[1].id);assert.match(await p.locator('.tier').nth(1).textContent(),/93.42/);assert.match(await p.locator('.tier').nth(1).textContent(),/219.80/);
  }finally{await ctx.close()}
 });
 assert.deepEqual(errors,[]);
});
