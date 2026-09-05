import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {mkdtempSync,rmSync,existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'storemill-usability-'));
for(const name of Object.keys(process.env)) if(/^(STOREMILL_|AMBORAS_|RAILWAY_|ANTHROPIC_|OPENAI_|GEMINI_|RESEND_|STRIPE_)/.test(name)) delete process.env[name];
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',NODE_ENV:'test',SEED_EMAIL:'usability@example.com',SEED_PASSWORD:'test-password-long'});
await import('../src/seed.ts');
const {server}=await import('../src/main.ts');
await new Promise(r=>server.listening?r():server.once('listening',r));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
const context=await browser.newContext();
await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
await context.request.post(origin+'/login',{form:{email:'usability@example.com',password:'test-password-long'}});
const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
const report=[];
after(async()=>{if(process.env.QA_OUTPUT_DIR){mkdirSync(process.env.QA_OUTPUT_DIR,{recursive:true});writeFileSync(join(process.env.QA_OUTPUT_DIR,'admin-usability.json'),JSON.stringify(report,null,2));}await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});});
const paths=['/admin','/admin/stores','/admin/ai','/admin/orders','/admin/products','/admin/customers','/admin/store','/admin/pages','/admin/templates','/admin/collections','/admin/media','/admin/bundles','/admin/marketing','/admin/promotions','/admin/ads','/admin/analytics','/admin/cro','/admin/profit','/admin/build','/admin/research','/admin/market','/admin/creative','/admin/settings','/admin/domains','/admin/plugins','/admin/reviews','/admin/funnels','/admin/settings/payments'];
await test('admin usability across the operator workspace',async t=>{
for(const width of [320,390,820,1440]) for(const path of paths) await t.test(`${path} has named controls and contained layout at ${width}px`,async()=>{
 await p.setViewportSize({width,height:900});const response=await p.goto(origin+path);assert.equal(response.status(),200,path);
 const state=await p.evaluate(()=>({path:location.pathname,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,unnamed:[...document.querySelectorAll('main input:not([type=hidden]),main select,main textarea,main button')].filter(e=>e.getClientRects().length&&!e.closest('details:not([open])')&&!((e.labels&&[...e.labels].some(l=>l.textContent.trim()))||e.getAttribute('aria-label')||e.getAttribute('aria-labelledby')||e.getAttribute('title')||(e.matches('button')&&e.textContent.trim()))).map(e=>({tag:e.tagName,name:e.getAttribute('name'),html:e.outerHTML.slice(0,200)}))}));
 report.push(state);assert.ok(state.scrollWidth<=width+1,`${path} overflows to ${state.scrollWidth}px at ${width}px`);assert.deepEqual(state.unnamed,[],path+' needs accessible names');
 if(process.env.QA_OUTPUT_DIR&&width===390&&path==='/admin/orders'){mkdirSync(process.env.QA_OUTPUT_DIR,{recursive:true});await p.screenshot({path:join(process.env.QA_OUTPUT_DIR,'orders-mobile.png')});}
});
await t.test('mobile navigation exposes state, closes with Escape and returns focus',async()=>{
 await p.setViewportSize({width:390,height:844});await p.goto(origin+'/admin');const toggle=p.getByRole('button',{name:'Open navigation',exact:true});await toggle.click();const close=p.getByRole('button',{name:'Close navigation',exact:true});assert.equal(await close.getAttribute('aria-expanded'),'true');await close.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.evaluate(e=>document.activeElement===e),true);
});
await t.test('visible labels focus their controls and overflowing tables support keyboard scrolling',async()=>{
 await p.goto(origin+'/admin/stores');const label=p.locator('.field>label').first();const id=await label.getAttribute('for');assert.ok(id);await label.click();assert.equal(await p.locator('#'+id).evaluate(e=>document.activeElement===e),true);
 await p.goto(origin+'/admin/orders');const region=p.getByRole('region',{name:/Orders table/});assert.ok(await region.evaluate(e=>e.scrollWidth>e.clientWidth));await region.focus();await region.click({position:{x:5,y:5}});await region.press('ArrowRight');await p.waitForFunction(()=>document.querySelector('.data-scroll').scrollLeft>0);assert.equal(await p.evaluate(()=>document.documentElement.scrollLeft),0);
});
await t.test('admin traversal has no uncaught JavaScript exceptions',()=>assert.deepEqual(errors,[]));

});
