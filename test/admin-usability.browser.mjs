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
 assert.equal(await p.locator('.rail [aria-current=page]').count(),1,path+' has exactly one selected navigation item');
 report.push(state);assert.ok(state.scrollWidth<=width+1,`${path} overflows to ${state.scrollWidth}px at ${width}px`);assert.deepEqual(state.unnamed,[],path+' needs accessible names');
 if(process.env.QA_OUTPUT_DIR&&width===390&&path==='/admin/orders'){mkdirSync(process.env.QA_OUTPUT_DIR,{recursive:true});await p.screenshot({path:join(process.env.QA_OUTPUT_DIR,'orders-mobile.png')});}
});
await t.test('mobile navigation exposes state, closes with Escape and returns focus',async()=>{
 await p.setViewportSize({width:390,height:844});await p.goto(origin+'/admin');const toggle=p.getByRole('button',{name:'Open navigation',exact:true});await toggle.click();await p.waitForFunction(()=>Math.abs(document.getElementById('admin-navigation').getBoundingClientRect().left)<1);const close=p.getByRole('button',{name:'Close navigation',exact:true});assert.equal(await close.getAttribute('aria-expanded'),'true');await close.press('Escape');assert.equal(await toggle.getAttribute('aria-expanded'),'false');assert.equal(await toggle.evaluate(e=>document.activeElement===e),true);
});
await t.test('visible labels focus their controls and overflowing tables support keyboard scrolling',async()=>{
 await p.goto(origin+'/admin/stores');const label=p.locator('.field>label').first();const id=await label.getAttribute('for');assert.ok(id);await label.click();assert.equal(await p.locator('#'+id).evaluate(e=>document.activeElement===e),true);
 await p.goto(origin+'/admin/orders');const region=p.getByRole('region',{name:/Orders table/});assert.ok(await region.evaluate(e=>e.scrollWidth>e.clientWidth));await region.focus();await region.click({position:{x:5,y:5}});await region.press('ArrowRight');await p.waitForFunction(()=>document.querySelector('.data-scroll').scrollLeft>0);assert.equal(await p.evaluate(()=>document.documentElement.scrollLeft),0);
});
await t.test('navigation groups reveal selected pages and remember explicit expansion',async()=>{
 await p.setViewportSize({width:1440,height:900});await p.goto(origin+'/admin/collections');
 const products=p.locator('[data-nav-group=products]');assert.equal(await products.locator('button').getAttribute('aria-expanded'),'true');
 assert.equal(await products.locator('[aria-current=page]').textContent(),'Collections');
 const active=await products.locator('[aria-current=page]').evaluate(el=>({background:getComputedStyle(el).backgroundColor,shadow:getComputedStyle(el).boxShadow}));assert.equal(active.background,'rgb(255, 255, 255)');assert.ok(!active.shadow.includes('inset'));
 await p.locator('.rail').getByRole('link',{name:'Orders',exact:true}).click();await p.waitForURL('**/admin/orders');
 await products.getByRole('button',{name:'Expand Products'}).click();await p.locator('.rail').getByRole('link',{name:'Customers',exact:true}).click();await p.waitForURL('**/admin/customers');assert.equal(await products.locator('button').getAttribute('aria-expanded'),'true');
 await products.getByRole('button',{name:'Collapse Products'}).click();await p.reload();assert.equal(await products.locator('button').getAttribute('aria-expanded'),'false');
});
await t.test('store picker searches and switches context with the keyboard; mobile navigation traps focus and closes outside',async()=>{
 const {getDb}=await import('../src/lib/db.ts');const {createBlankAsset}=await import('../src/control/assets.ts');const db=getDb();
 const user=db.one('SELECT id FROM users WHERE email=?','usability@example.com');
 const funnel=createBlankAsset(db,user.id,{name:'Winter offer fixture',kind:'funnel',currency:'USD'});
 await p.goto(origin+'/admin');await p.locator('#store-switcher>summary').click();const search=p.getByRole('searchbox',{name:'Search stores and funnels'});await search.fill('no matching site');assert.equal(await p.getByText('No matching stores or funnels.',{exact:true}).isVisible(),true);
 await search.fill('winter offer');assert.equal(await p.locator('.switcher-option:visible').count(),1);await search.press('ArrowDown');assert.equal(await p.locator('.switcher-option:visible').evaluate(el=>el===document.activeElement),true);await p.keyboard.press('Enter');await p.waitForFunction(name=>document.querySelector('.switcher-current').textContent===name,funnel.name);
 assert.equal(await p.locator('.switcher-current').textContent(),funnel.name);await p.locator('[data-nav-group=channel-funnel]>.nav-group-row>button').click();assert.equal(await p.locator('.rail').getByRole('link',{name:'Funnel flow',exact:true}).isVisible(),true);assert.equal(await p.locator('.rail').getByRole('link',{name:'Theme & navigation',exact:true}).count(),0);
 await p.locator('#store-switcher>summary').click();await p.keyboard.press('Escape');assert.equal(await p.locator('#store-switcher').getAttribute('open'),null);assert.equal(await p.locator('#store-switcher>summary').evaluate(el=>el===document.activeElement),true);
 await p.setViewportSize({width:390,height:844});await p.locator('#nav-toggle').click();assert.equal(await p.locator('main.page').evaluate(el=>el.inert),true);await p.locator('.rail-foot').getByRole('link',{name:'Settings',exact:true}).focus();await p.keyboard.press('Tab');assert.equal(await p.locator('#nav-toggle').evaluate(el=>el===document.activeElement),true);await p.locator('.nav-backdrop').click({position:{x:370,y:120}});assert.equal(await p.locator('#nav-toggle').getAttribute('aria-expanded'),'false');assert.equal(await p.locator('main.page').evaluate(el=>el.inert),false);
 if(process.env.QA_OUTPUT_DIR){await p.setViewportSize({width:1440,height:1000});await p.goto(origin+'/admin/pages');await p.screenshot({path:join(process.env.QA_OUTPUT_DIR,'navigation-desktop.png')});await p.locator('#store-switcher>summary').click();await p.screenshot({path:join(process.env.QA_OUTPUT_DIR,'navigation-switcher.png')});await p.keyboard.press('Escape');await p.setViewportSize({width:390,height:844});await p.locator('#nav-toggle').click();await p.waitForFunction(()=>Math.abs(document.getElementById('admin-navigation').getBoundingClientRect().left)<1);await p.screenshot({path:join(process.env.QA_OUTPUT_DIR,'navigation-mobile.png'),animations:'disabled'});}
});
await t.test('admin traversal has no uncaught JavaScript exceptions',()=>assert.deepEqual(errors,[]));

});
