import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'checkout-experience-'));process.env.AMBORAS_DB=join(dir,'test.db');process.env.PORT='0';process.env.AMBORAS_LOG_LEVEL='error';process.env.AMBORAS_STOREFRONT_HOST='';process.env.AMBORAS_PUBLIC_ORIGIN='';process.env.AMBORAS_ADMIN_HOST='';
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');
const {register,startSession,SESSION_COOKIE}=await import('../src/control/auth.ts');
const {createStore,updateStore,publish}=await import('../src/control/stores.ts');
const {createProduct}=await import('../src/domain/catalog.ts');
const {seedDefaultRegion,createRegion}=await import('../src/domain/regions.ts');
const {createPromotion}=await import('../src/domain/promotions.ts');
const {ensureCopiedCheckout}=await import('../src/pages/commerce-pages.ts');
const {updatePage}=await import('../src/pages/store.ts');
const {install}=await import('../src/control/plugins.ts');
const db=getDb(),user=register(db,{email:'checkout-layout@example.com',password:'test-password-long'});
const store=createStore(db,user.id,{name:'Nuvana checkout fixture'});seedDefaultRegion(db,store.id,'USD');
updateStore(db,store.id,{brand:{paper:'#ffffff',surface:'#080d30',ink:'#222222',primary:'#318330',bodyFont:'Arial'}});publish(db,store.id);
const product=createProduct(db,store.id,{title:'Nuvana Orthopedic Cushion',status:'published',variants:[{title:'Default Title',priceCents:5495,compareAtCents:10990,inventory:100}]});
const checkout=ensureCopiedCheckout(db,store.id);updatePage(db,store.id,checkout.id,{status:'published'});
createPromotion(db,store.id,{title:'Welcome savings',kind:'percentage',code:'SAVE10',value:10});
install(db,store.id,'stripe',{publishableKey:'pk_test_fixture',secretKey:'sk_test_fixture'});
const canada=createRegion(db,store.id,{name:'Canada',currency:'CAD',countries:['CA'],exchangeRate:1.3});
// Create the rate through the region model's supported primitive below.
db.insert('shipping_options',{id:'test_canada_rate',region_id:canada.id,name:'Canada standard',amount_cents:800,free_above_cents:null,position:0});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port,base='/s/'+store.slug;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
const stripeMock=`window.STRIPE_EVENTS={};window.Stripe=()=>({elements:options=>{window.STRIPE_OPTIONS=options;return{create:(kind,settings)=>{window[kind+'Options']=settings;return{mount:selector=>{if(kind==='payment')document.querySelector(selector).innerHTML='<div style="border:1px solid #ccc;padding:18px">Secure card form</div>';},on:(name,fn)=>{if(kind==='expressCheckout')window.STRIPE_EVENTS[name]=fn;} }},submit:async()=>({}),update:next=>{window.STRIPE_AMOUNT=next.amount}}},confirmPayment:async options=>{window.CONFIRM_OPTIONS=options;return{error:{message:'Fixture decline'}}}});`;
async function open(width=1440,preview=false){const context=await browser.newContext({viewport:{width,height:900}});await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.request().url()==='https://js.stripe.com/v3/'?route.fulfill({contentType:'text/javascript',body:stripeMock}):route.abort());if(preview)await context.addCookies([{name:SESSION_COOKIE,value:startSession(db,user.id),url:origin}]);const urlBase=preview?'/preview/'+store.slug:base;await context.request.post(origin+urlBase+'/cart/add',{data:{variantId:product.variants[0].id,quantity:1},headers:{accept:'application/json'}});const page=await context.newPage();await page.goto(origin+urlBase+'/checkout');return{context,page,urlBase};}
for(const width of [320,390,820,1440])test(`checkout stays readable and usable with a dark imported surface at ${width}px`,async()=>{
 const {context,page}=await open(width,true),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const metrics=await page.locator('#co-email').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color,height:el.getBoundingClientRect().height,font:parseFloat(getComputedStyle(el).fontSize)}));
 assert.equal(metrics.bg,'rgb(255, 255, 255)');assert.equal(metrics.color,'rgb(26, 26, 26)');assert.equal(metrics.height,52);if(width<1000)assert.ok(metrics.font>=16);
 assert.equal(await page.locator('.co-header').count(),1);assert.equal(await page.locator('.checkout-steps').count(),0);assert.equal(await page.getByText('Default Title',{exact:true}).count(),0);
 assert.equal(await page.locator('#pay').isDisabled(),true);assert.equal(await page.locator('[name=preview-card]').isDisabled(),true);
 if(width<1000){await page.locator('.co-summary-mobile summary').click();assert.equal(await page.locator('.co-summary-mobile .summary-body').isVisible(),true);assert.equal(await page.locator('.co-side').isVisible(),false);}
 else{const [main,side]=await Promise.all([page.locator('.co-main').boundingBox(),page.locator('.co-side').boundingBox()]);assert.ok(side.x>=main.x+main.width-1);await page.evaluate(()=>scrollTo(0,500));assert.ok((await page.locator('.co-side').boundingBox()).y>=-1);}
 await page.locator('[name=billingSame]').uncheck();assert.equal(await page.locator('[name=billingLine1]').isVisible(),true);await page.locator('[name=billingSame]').check();assert.equal(await page.locator('[name=billingLine1]').isEnabled(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await context.close();
});
test('discounts apply/remove in place, invalid codes preserve the prior price, and shipping uses server totals',async()=>{
 const {context,page}=await open();const original=await page.locator('[data-pay-total]').textContent();
 const code=page.locator('.co-side form.code');await code.locator('input').fill('BADCODE');await code.locator('button').click();await page.locator('.co-side [data-code-error]').filter({hasText:'not valid'}).waitFor();assert.equal(await page.locator('[data-pay-total]').textContent(),original);
 await code.locator('input').fill('SAVE10');await code.locator('button').click();await page.locator('.co-side [data-remove-code]').waitFor();assert.notEqual(await page.locator('[data-pay-total]').textContent(),original);assert.equal(new URL(page.url()).pathname,base+'/checkout');
 await page.locator('.co-side [data-remove-code]').click();await page.waitForFunction(value=>document.querySelector('[data-pay-total]').textContent===value,original);
 const shipping=page.locator('#methods input').last();const result=page.waitForResponse(r=>r.url().endsWith('/checkout/shipping'));await shipping.check();const data=await(await result).json();assert.equal(await page.locator('[data-pay-total]').textContent(),'$'+(data.totalCents/100).toFixed(2));
 const invalid=await context.request.post(origin+base+'/checkout/shipping',{data:{shippingOptionId:'foreign-rate'}});assert.equal(invalid.status(),400);await context.close();
});
test('required fields show inline errors; separate billing details persist and country changes preserve contact',async()=>{
 const {context,page}=await open();await page.locator('#pay').click();assert.equal(await page.locator('#co-email').getAttribute('aria-invalid'),'true');assert.equal(await page.locator('#co-email').evaluate(el=>el===document.activeElement),true);
 const values={email:'buyer@example.com',firstName:'Test',lastName:'Buyer',line1:'123 Test St',city:'Phoenix',state:'AZ',postal:'85001'};for(const[name,value]of Object.entries(values))await page.locator('#checkout-form [name='+name+']').fill(value);
 await page.locator('[name=billingSame]').uncheck();for(const[name,value]of Object.entries({billingFirstName:'Billing',billingLastName:'Buyer',billingLine1:'456 Test Ave',billingCity:'Tucson',billingState:'AZ',billingPostal:'85701'}))await page.locator('[name='+name+']').fill(value);
 const body=await page.locator('#checkout-form').evaluate(form=>Object.fromEntries(new FormData(form)));const prepared=await context.request.post(origin+base+'/checkout/prepare',{data:body});assert.equal((await prepared.json()).ok,true);
 const cookies=await context.cookies();const cartId=cookies.find(c=>c.name==='amboras_cart_'+store.id).value;const saved=JSON.parse(db.one('SELECT checkout FROM carts WHERE id=?',cartId).checkout);assert.equal(saved.billingSame,false);assert.equal(saved.billingAddress.line1,'456 Test Ave');
 await page.locator('[name=country]').selectOption('CA');await page.waitForFunction(()=>document.querySelector('#methods')?.textContent.includes('Canada standard'));assert.equal(await page.locator('[name=email]').inputValue(),'buyer@example.com');assert.equal(await page.locator('[name=country]').inputValue(),'CA');assert.equal(await page.locator('.co-side .grand [data-currency]').getAttribute('data-currency'),'CAD');await context.close();
});
test('wallets collect addresses and send separate billing to Stripe without creating real payments',async()=>{
 const {context,page}=await open();await page.route('**/checkout/intent',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({clientSecret:'pi_mock_secret'})}));
 await page.evaluate(async()=>{window.WALLET_FAILURE=false;await window.STRIPE_EVENTS.confirm({shippingAddress:{name:'Ship Buyer',address:{line1:'123 Test St',city:'Phoenix',state:'AZ',postal_code:'85001',country:'US'}},billingDetails:{name:'Bill Buyer',email:'wallet@example.com',address:{line1:'456 Bill St',city:'Tucson',state:'AZ',postal_code:'85701',country:'US'}},paymentFailed:()=>{window.WALLET_FAILURE=true;}});});
 await page.waitForFunction(()=>window.CONFIRM_OPTIONS);const options=await page.evaluate(()=>({options:window.CONFIRM_OPTIONS,express:window.expressCheckoutOptions}));assert.equal(options.express.shippingAddressRequired,true);assert.equal(options.options.confirmParams.payment_method_data.billing_details.address.line1,'456 Bill St');assert.equal(options.options.clientSecret,'pi_mock_secret');await context.close();
});
