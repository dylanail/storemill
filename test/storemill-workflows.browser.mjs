import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'storemill-workflows-'));
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',AMBORAS_STOREFRONT_HOST:'',AMBORAS_PUBLIC_ORIGIN:'',AMBORAS_ADMIN_HOST:'',OPENAI_API_KEY:'test-key',AMBORAS_TEXT_PROVIDER:'openai',ANTHROPIC_API_KEY:'',STRIPE_SECRET_KEY:''});
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');
const {register}=await import('../src/control/auth.ts');
const {createBlankAsset}=await import('../src/control/assets.ts');
const {createPage,updatePage,getPage,savePageRevision,listPageRevisions}=await import('../src/pages/store.ts');
const {upsertFunnel,listFunnels}=await import('../src/domain/funnels.ts');
const {pageRevisionToken}=await import('../src/pages/revision-token.ts');
const {useModelTransport}=await import('../src/agent/models.ts');
const db=getDb(),user=register(db,{email:'workflows@example.com',password:'test-password-long'}),store=createBlankAsset(db,user.id,{name:'Storemill Test Studio',kind:'funnel'});
const source='<!doctype html><html lang="en"><head><title>Our offer</title><style>body{font:16px system-ui}:focus-visible{outline:2px solid}</style></head><body><a href="#main">Skip to content</a><main id="main"><h1>Our offer</h1><p>Existing facts.</p></main></body></html>';
const saved=createPage(db,store.id,{title:'Our offer',mode:'html',rawHtml:source,role:'offer'});
upsertFunnel(db,store.id,{name:'Original funnel',offerPageId:saved.id,steps:[{pageId:saved.id,label:'Offer'}]});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(async()=>{useModelTransport(null);await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true});});
await test('Storemill repair, cloning and save-conflict workflows',async t=>{
 const ctx=await browser.newContext({viewport:{width:1440,height:950}}),errors=[];
 await ctx.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await ctx.request.post(origin+'/login',{form:{email:user.email,password:'test-password-long'}});
 const p=await ctx.newPage();p.setDefaultTimeout(10000);p.on('pageerror',error=>errors.push(error.message));
 try{
  await t.test('a suggested repair is applied, verified and undoable from the speed page',async()=>{
   useModelTransport(async()=>new Response(JSON.stringify({id:'resp_test',object:'response',status:'completed',output:[{type:'message',id:'msg_test',role:'assistant',status:'completed',content:[{type:'output_text',text:JSON.stringify({summary:'Added the mobile viewport.',edits:[{target:'rawHtml',find:'<head>',replacement:'<head><meta name="viewport" content="width=device-width,initial-scale=1">'}]}),annotations:[]}]}]}),{headers:{'content-type':'application/json'}}));
   await p.goto(origin+'/admin/speed');
   const fix=p.locator('[data-health-fix][data-check="viewport"][data-path="/pages/our-offer"]');
   assert.equal(await fix.count(),1);assert.match(await fix.locator('..').textContent(),/Suggested fix:/);
   if(process.env.SPEED_SCREENSHOT)await p.screenshot({path:process.env.SPEED_SCREENSHOT,fullPage:true});
   await fix.click();await p.getByText('Added the mobile viewport. Recheck passed.',{exact:true}).waitFor();
   assert.match(getPage(db,store.id,saved.id).rawHtml,/name="viewport"/);assert.equal(await fix.count(),0);
   await p.getByRole('button',{name:'Undo fix',exact:true}).click();await p.getByText('Fix undone.',{exact:true}).waitFor();
   assert.equal(getPage(db,store.id,saved.id).rawHtml,source);assert.equal(await fix.count(),1);
   assert.equal(await p.locator('.top .storemill-wordmark').evaluate(el=>getComputedStyle(el).width),'114px');
   await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.setViewportSize({width:1440,height:950});
  });
  await t.test('the editor rejects stale saves and restores without losing the latest source',async()=>{
   const before=getPage(db,store.id,saved.id),revision=pageRevisionToken(before);savePageRevision(db,before,'Original');
   updatePage(db,store.id,saved.id,{rawHtml:source+'<!--newer edit-->'});
   const result=await ctx.request.post(origin+'/admin/pages/'+saved.id+'/save',{data:{...before,revision}});
   assert.match((await result.json()).error,/changed in another tab/);assert.match(getPage(db,store.id,saved.id).rawHtml,/newer edit/);
   const restore=await ctx.request.post(origin+'/admin/pages/'+saved.id+'/revisions/'+listPageRevisions(db,store.id,saved.id)[0].id+'/restore',{data:{revision}});
   assert.match((await restore.json()).error,/changed in another tab/);
   const current=getPage(db,store.id,saved.id),accepted=await ctx.request.post(origin+'/admin/pages/'+saved.id+'/save',{data:{...current,revision:pageRevisionToken(current),rawHtml:source}});
   assert.equal((await accepted.json()).ok,true);assert.equal(getPage(db,store.id,saved.id).rawHtml,source);
  });
  await t.test('the whole-funnel clone button creates independent steps with paused traffic',async()=>{
   await p.goto(origin+'/admin/funnels');await p.getByRole('button',{name:'Clone whole funnel',exact:true}).click();await p.waitForURL('**/admin/funnels?flash=*');
   const copy=listFunnels(db,store.id).find(funnel=>funnel.name==='Original funnel (copy)');assert.ok(copy);assert.equal(copy.status,'paused');assert.notEqual(copy.steps[0].pageId,saved.id);
   assert.equal(getPage(db,store.id,copy.steps[0].pageId).status,'draft');
   await p.goto(origin+'/admin/pages');await p.getByLabel('What to clone',{exact:true}).selectOption('funnel');assert.equal(await p.getByLabel('What to clone',{exact:true}).inputValue(),'funnel');
  });
  assert.deepEqual(errors,[]);
 }finally{await ctx.close();}
});
