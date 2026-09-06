import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'media-browser-'));
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',AMBORAS_STOREFRONT_HOST:'',AMBORAS_PUBLIC_ORIGIN:'',AMBORAS_ADMIN_HOST:'',OPENAI_API_KEY:'test-image-key',GEMINI_API_KEY:'',ANTHROPIC_API_KEY:'',RUNWAYML_API_SECRET:'test-runway-key',STRIPE_SECRET_KEY:''});
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');const {register}=await import('../src/control/auth.ts');
const {createBlankAsset}=await import('../src/control/assets.ts');const {createPage,newBlock,getPage}=await import('../src/pages/store.ts');
const {saveUpload,saveMediaUpload}=await import('../src/lib/uploads.ts');const {useMediaTransport,rasterizeSvg}=await import('../src/control/media-render.ts');
const db=getDb(),user=register(db,{email:'media-browser@example.com',password:'test-password-long'}),store=createBlankAsset(db,user.id,{name:'Northline Studio',kind:'store',currency:'USD'}),other=createBlankAsset(db,user.id,{name:'Separate Store',kind:'store',currency:'USD'});
const run=(args)=>execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args]);
writeFileSync(join(dir,'source.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e9e8df"/><ellipse cx="405" cy="405" rx="180" ry="22" fill="#d3d0c5"/><rect x="320" y="105" width="160" height="295" rx="35" fill="#738b69"/><rect x="350" y="75" width="100" height="60" rx="10" fill="#353b31"/><rect x="337" y="220" width="126" height="100" rx="5" fill="#f7f2e7"/><text x="400" y="260" font-family="sans-serif" font-size="20" text-anchor="middle" fill="#333">OLD BRAND</text><text x="400" y="290" font-family="sans-serif" font-size="12" text-anchor="middle" fill="#666">DAILY ESSENTIALS</text></svg>');
writeFileSync(join(dir,'logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="320" height="90"><rect width="320" height="90" rx="8" fill="#193c34"/><text x="160" y="55" font-family="sans-serif" font-size="34" font-weight="bold" text-anchor="middle" fill="white">NORTHLINE</text></svg>');
writeFileSync(join(dir,'source.png'),await rasterizeSvg(readFileSync(join(dir,'source.svg')),AbortSignal.timeout(30000)));writeFileSync(join(dir,'logo.png'),await rasterizeSvg(readFileSync(join(dir,'logo.svg')),AbortSignal.timeout(30000)));
run(['-loop','1','-i',join(dir,'source.png'),'-t','2.5','-r','24','-c:v','libx264','-pix_fmt','yuv420p',join(dir,'source.mp4')]);
const source=saveUpload({name:'product.png',type:'image/png',data:readFileSync(join(dir,'source.png'))},store.id).url;
const logo=saveUpload({name:'logo.png',type:'image/png',data:readFileSync(join(dir,'logo.png'))},store.id).url;
const clip=saveMediaUpload({name:'product.mp4',type:'video/mp4',data:readFileSync(join(dir,'source.mp4'))},store.id).url;
createPage(db,store.id,{title:'Duplicated product page',mode:'html',rawHtml:'<html><body><img src="'+source+'"><video controls src="'+clip+'"></video></body></html>'});
db.run('UPDATE stores SET brand=? WHERE id=?',JSON.stringify({name:'Northline',logoSvg:logo}),store.id);
let providerMode='success',release;
useMediaTransport(async()=>{if(providerMode==='hold')await new Promise(resolve=>release=resolve);if(providerMode==='failure')return new Response('',{status:503});return Response.json({data:[{b64_json:readFileSync(join(dir,'source.png')).toString('base64')}]})});
await new Promise(resolve=>server.listening?resolve():server.once('listening',resolve));const origin='http://127.0.0.1:'+server.address().port;
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
const errors=[];let active;
async function context(){const ctx=await browser.newContext({viewport:{width:1440,height:1050}});await ctx.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());await ctx.request.post(origin+'/login',{form:{email:user.email,password:'test-password-long'}});const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(20000);active={ctx,p};return active}
const media='/admin/media?storeId='+store.id;
const form=(url)=>origin+'/admin/media/rebrand?storeId='+store.id+'&source='+encodeURIComponent(url);
after(async()=>{release?.();useMediaTransport(null);await active?.ctx.close();await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(dir,{recursive:true,force:true})});
await test('media rebrand browser workflows',async t=>{
 await t.test('library exposes image and video rebrand actions; form works on desktop and mobile',async()=>{
  const {ctx,p}=await context();await p.goto(origin+media);assert.ok(await p.getByRole('link',{name:'Rebrand',exact:true}).count()>=3);assert.ok(await p.locator('.media-card video').count());
  await p.goto(form(source));assert.equal(await p.getByLabel('Desired brand name').inputValue(),'Northline');await p.getByLabel('Desired logo',{exact:true}).selectOption(logo);
  for(const width of [1440,820,390]){await p.setViewportSize({width,height:1050});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await p.getByRole('button',{name:'Create preview'}).isVisible(),true);}
  await p.getByLabel('How to redo it').selectOption('overlay');assert.equal(await p.getByLabel('Logo position').isVisible(),true);assert.equal(await p.getByLabel('What should change? (optional)').isVisible(),false);
  if(process.env.MEDIA_FORM_SCREENSHOT)await p.screenshot({path:process.env.MEDIA_FORM_SCREENSHOT});await ctx.close();
 });
 await t.test('creates a real overlay preview, applies it, and undoes it',async()=>{
  const {ctx,p}=await context();await p.goto(form(source));await p.getByLabel('Desired logo',{exact:true}).selectOption(logo);await p.getByLabel('How to redo it').selectOption('overlay');await p.getByLabel('Or upload a new logo').setInputFiles(join(dir,'logo.svg'));await p.getByRole('button',{name:'Create preview'}).click();await p.waitForURL(/\/rebrand\/rebrand_/);
  await p.getByRole('button',{name:'Apply to this asset',exact:true}).waitFor();const reviewUrl=p.url();assert.ok(await p.getByRole('img',{name:'Rebranded image'}).evaluate(img=>img.complete&&img.naturalWidth>0));
  if(process.env.MEDIA_REVIEW_SCREENSHOT)await p.screenshot({path:process.env.MEDIA_REVIEW_SCREENSHOT});
  await p.getByRole('button',{name:'Apply to this asset',exact:true}).click();await p.getByRole('button',{name:'Undo replacement'}).waitFor();assert.equal(db.one('SELECT status FROM media_rebrands ORDER BY created_at DESC LIMIT 1').status,'applied');
  await p.getByRole('button',{name:'Undo replacement'}).click();await p.getByText('Original media restored.',{exact:true}).waitFor();assert.equal(db.one('SELECT status FROM media_rebrands ORDER BY created_at DESC LIMIT 1').status,'undone');
  const foreign=await ctx.request.get(reviewUrl.replace('storeId='+store.id,'storeId='+other.id));assert.ok(foreign.status()>=400);await ctx.close();
 });
 await t.test('AI progress survives navigation, cancellation stops work, and failures expose a retry',async()=>{
  const {ctx,p}=await context();providerMode='hold';await p.goto(form(source));await p.getByLabel('How to redo it').selectOption('ai');await p.getByRole('button',{name:'Create preview'}).click();await p.waitForURL(/\/rebrand\/rebrand_/);const jobUrl=p.url();await p.getByText('Replacing image branding',{exact:true}).waitFor();
  await p.goto(origin+media);await p.getByRole('region',{name:'Recent media edits'}).waitFor();await p.goto(jobUrl);await p.getByRole('button',{name:'Cancel edit'}).click();await p.getByText('Edit cancelled. Your original has been kept.',{exact:true}).waitFor();release?.();providerMode='failure';
  await p.getByRole('link',{name:'Redo with different branding'}).click();await p.getByRole('button',{name:'Create preview'}).click();await p.waitForURL(/\/rebrand\/rebrand_/);await p.getByRole('alert').filter({hasText:'503'}).waitFor();assert.equal(await p.getByRole('button',{name:'Apply to this asset'}).count(),0);providerMode='success';await ctx.close();
 });
 await t.test('form recovers from network failures and duplicate request keys create one job',async()=>{
  const {ctx,p}=await context();await p.goto(form(source));await p.getByLabel('How to redo it').selectOption('overlay');await p.getByLabel('Desired logo',{exact:true}).selectOption(logo);
  await ctx.route('**/admin/media/rebrand?*',route=>route.request().method()==='POST'?route.abort():route.continue());await p.getByRole('button',{name:'Create preview'}).click();await p.locator('#rebrand-error').waitFor({state:'visible'});assert.equal(await p.getByRole('button',{name:'Create preview'}).isEnabled(),true);await ctx.unroute('**/admin/media/rebrand?*');
  const fields=await p.locator('#rebrand-form').evaluate(form=>Object.fromEntries(new FormData(form)));delete fields.logoFile;
  const a=await ctx.request.post(origin+'/admin/media/rebrand?storeId='+store.id,{form:fields,headers:{Accept:'application/json'}}),b=await ctx.request.post(origin+'/admin/media/rebrand?storeId='+store.id,{form:fields,headers:{Accept:'application/json'}});assert.equal(a.status(),200);assert.equal((await a.json()).url,(await b.json()).url);await ctx.close();
 });
 await t.test('video seeking supports ranges and upload enforces same-origin authorization',async()=>{
  const {ctx,p}=await context();const partial=await ctx.request.get(origin+clip,{headers:{Range:'bytes=0-31'}});assert.equal(partial.status(),206);assert.equal((await partial.body()).length,32);assert.match(partial.headers()['content-range'],/^bytes 0-31\//);const invalid=await ctx.request.get(origin+clip,{headers:{Range:'bytes=900000000-'}});assert.equal(invalid.status(),416);
  await p.goto(form(clip));assert.equal(await p.getByLabel('Branding reference time (seconds)').isVisible(),true);const blocked=await ctx.request.post(origin+'/admin/media/rebrand?storeId='+store.id,{headers:{Origin:'https://unrelated.example',Accept:'application/json'},form:{source,method:'overlay',brandName:'test',logo}});assert.equal(blocked.status(),400);assert.match((await blocked.json()).error,/Open Media/);await ctx.close();
 });

 await t.test('editor regeneration accepts logo uploads and references, preserves unsaved copy, and supports undo',async()=>{
  const fixture=createPage(db,store.id,{title:'Editor media test',mode:'html',rawHtml:'<!doctype html><html><body><section style="padding:40px"><h1>Original copy</h1><img id="photo" src="'+source+'" width="400" height="250"><video id="clip" controls poster="'+source+'"><source src="'+clip+'" type="video/mp4"></video></section></body></html>'});
  let sent;useMediaTransport(async(_url,init)=>{sent=init.body;return Response.json({data:[{b64_json:readFileSync(join(dir,'source.png')).toString('base64')}]});});
  const {ctx,p}=await context();await p.goto(origin+'/admin/pages/'+fixture.id+'/edit?storeId='+store.id);await p.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length);
  const canvas=p.frameLocator('#edit-frame');
  const select=async selector=>p.locator('#edit-frame').evaluate((frame,s)=>window.__PAGE_EDITOR.select(frame.contentDocument.querySelector(s).getAttribute('data-pb-id')),selector);
  await select('h1');await p.locator('[data-content=text]').fill('My unsaved copy');await select('#photo');
  await p.getByRole('button',{name:'Regenerate with branding',exact:true}).click();const dialog=p.getByRole('dialog',{name:'Edit media'});await dialog.getByLabel('Edit suggestions',{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('Edit suggestions',{exact:true}).evaluate(el=>el===document.activeElement),true);
  await dialog.locator('[name=logoUpload]').setInputFiles(join(dir,'logo.svg'));await dialog.getByText('Logo saved in Logos.',{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Choose reference image',exact:true}).click();await dialog.locator('.em-picker-grid img').first().locator('..').click();
  await dialog.getByLabel('Edit suggestions',{exact:true}).fill('Place the desired logo on the bottle. Use reference 1 for color and lighting.');
  await dialog.getByLabel('Keep unchanged',{exact:true}).fill('Keep the bottle shape and factual label text.');await dialog.getByLabel('Edit goal').selectOption('custom');
  await dialog.getByText('More options',{exact:true}).click();await dialog.getByLabel('Output shape').selectOption('square');
  await dialog.evaluate(el=>el.scrollTop=0);
  if(process.env.EDITOR_MEDIA_SCREENSHOT)await p.screenshot({path:process.env.EDITOR_MEDIA_SCREENSHOT});
  await p.setViewportSize({width:390,height:850});assert.equal(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),true);assert.ok((await dialog.boundingBox()).width<=390);
  if(process.env.EDITOR_MEDIA_SCREENSHOT)await p.screenshot({path:process.env.EDITOR_MEDIA_SCREENSHOT.replace('.png','-mobile.png')});
  await p.setViewportSize({width:1440,height:1050});
  await dialog.getByRole('button',{name:'Create preview',exact:true}).focus();const selectedBefore=await p.evaluate(()=>window.__PAGE_EDITOR.getSelected());await p.keyboard.press('Delete');assert.equal(await p.evaluate(()=>window.__PAGE_EDITOR.getSelected()),selectedBefore,'Media dialog keys cannot delete canvas nodes');
  await dialog.getByRole('button',{name:'Create preview',exact:true}).click();await dialog.getByRole('button',{name:'Use this version',exact:true}).waitFor();
  assert.equal(sent.getAll('image[]').length,3);assert.match(sent.get('prompt'),/reference 1 for color/);assert.match(sent.get('prompt'),/bottle shape/);assert.equal(sent.get('size'),'1024x1024');
  assert.match(getPage(db,store.id,fixture.id).rawHtml,/Original copy/,'Opening/generating does not save the page');
  await dialog.getByRole('button',{name:'Use this version',exact:true}).click();assert.equal(await dialog.isVisible(),false);assert.notEqual(await canvas.locator('#photo').getAttribute('src'),source);assert.equal(await canvas.locator('#clip').getAttribute('poster'),source);
  assert.equal(await canvas.locator('h1').textContent(),'My unsaved copy');await p.locator('#undo').click();await canvas.locator('#photo').waitFor();assert.equal(await canvas.locator('#photo').getAttribute('src'),source);assert.equal(await canvas.locator('h1').textContent(),'My unsaved copy');
  await select('section');const plus=p.getByRole('button',{name:'Add after selection',exact:true}),symbol=plus.locator('svg');const box=await plus.boundingBox(),glyph=await symbol.boundingBox();assert.ok(Math.abs((box.x+box.width/2)-(glyph.x+glyph.width/2))<.6);assert.ok(Math.abs((box.y+box.height/2)-(glyph.y+glyph.height/2))<.6);
  await p.locator('#save').click();await p.waitForFunction(()=>document.getElementById('status').textContent==='Saved');assert.match(getPage(db,store.id,fixture.id).rawHtml,/My unsaved copy/);
  await p.goto(origin+media);assert.ok(await p.getByRole('region',{name:'Logo assets',exact:true}).locator('.media-card').count()>0);assert.equal(await p.getByRole('region',{name:'Images and videos',exact:true}).locator('[data-category=logo]').count(),0);
  await ctx.close();
 });
 await t.test('native media controls upload a replacement without saving and preserve page undo',async()=>{
  const fixture=createPage(db,store.id,{title:'Native media test',blocks:[newBlock('image',{src:source,alt:'Product'}),newBlock('video',{url:clip,poster:source}),newBlock('image',{src:source+'?size=2',alt:'Separate variant'})]});
  const {ctx,p}=await context();await p.goto(origin+'/admin/pages/'+fixture.id+'/edit?storeId='+store.id);await p.locator('.canvas-block').first().click();await p.getByRole('button',{name:'Upload / choose asset',exact:true}).click();const dialog=p.getByRole('dialog',{name:'Edit media'});await dialog.getByLabel('Apply replacement to').selectOption('page');await dialog.locator('[name=replacementUpload]').setInputFiles(join(dir,'logo.png'));await dialog.waitFor({state:'hidden'});
  await p.locator('.canvas-block').nth(2).click();assert.equal(await p.locator('[data-k=src]').inputValue(),source+'?size=2','All matching replacements leave separate variants intact');await p.locator('.canvas-block').first().click();
  assert.equal(getPage(db,store.id,fixture.id).blocks[0].settings.src,source);assert.notEqual(await p.locator('[data-k=src]').inputValue(),source);await p.locator('#undo').click();assert.equal(await p.locator('[data-k=src]').inputValue(),source);
  await p.locator('.canvas-block').nth(1).click();assert.equal(await p.getByRole('button',{name:'Regenerate with branding',exact:true}).count(),2);
  await ctx.close();
 });
 await t.test('video regeneration has audio controls, creates a real overlay and replaces only the selected video',async()=>{
  const fixture=createPage(db,store.id,{title:'Video editor test',mode:'html',rawHtml:'<html><body><video id="movie" controls poster="'+source+'"><source src="'+clip+'" type="video/mp4"></video></body></html>'});
  const {ctx,p}=await context();await p.goto(origin+'/admin/pages/'+fixture.id+'/edit?storeId='+store.id);await p.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length);await p.locator('#edit-frame').evaluate(frame=>window.__PAGE_EDITOR.select(frame.contentDocument.querySelector('video').getAttribute('data-pb-id')));
  await p.locator('[data-edit-media="0"]').click();const dialog=p.getByRole('dialog',{name:'Edit media'});await dialog.getByLabel('Editing method').selectOption('overlay');await dialog.getByLabel('Video audio').selectOption('mute');await dialog.getByLabel('Logo position').selectOption('center');
  await dialog.getByRole('button',{name:'Choose logo asset',exact:true}).click();await dialog.locator('.em-picker-grid button').first().click();
  await dialog.getByRole('button',{name:'Create preview',exact:true}).click();await dialog.getByRole('button',{name:'Use this version',exact:true}).waitFor();await dialog.getByRole('button',{name:'Use this version',exact:true}).click();
  const movie=p.frameLocator('#edit-frame').locator('#movie');assert.ok((await movie.getAttribute('src')).startsWith('/_uploads/'));assert.equal(await movie.locator('source').count(),0);assert.equal(await movie.getAttribute('poster'),source);assert.equal(await movie.getAttribute('controls'),'');
  await p.locator('#undo').click();await p.frameLocator('#edit-frame').locator('#movie source').waitFor({state:'attached'});assert.equal(await p.frameLocator('#edit-frame').locator('#movie source').getAttribute('src'),clip);await ctx.close();
 });
 await t.test('replacing all matching image placements updates pictures and backgrounds without changing text and links',async()=>{
  const fixture=createPage(db,store.id,{title:'Repeated image',mode:'html',rawHtml:'<html><body><section style="padding:20px"><p>'+source+'</p><a href="'+source+'">Download</a><picture><source srcset="'+source+' 1x, https://example.com/large.png 2x"><img id="repeat" src="'+source+'"></picture><div id="background" style="width:200px;height:100px;background-image:url('+source+')"></div><video poster="'+source+'" src="'+clip+'"></video></section></body></html>'});
  const {ctx,p}=await context();await p.goto(origin+'/admin/pages/'+fixture.id+'/edit?storeId='+store.id);await p.frameLocator('#edit-frame').locator('#repeat').waitFor();await p.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length);
  await p.locator('#edit-frame').evaluate(frame=>window.__PAGE_EDITOR.select(frame.contentDocument.querySelector('#repeat').getAttribute('data-pb-id')));
  await p.getByRole('button',{name:'Upload / choose asset',exact:true}).click();const dialog=p.getByRole('dialog',{name:'Edit media'});await dialog.getByLabel('Apply replacement to').selectOption('page');await dialog.locator('[name=replacementUpload]').setInputFiles(join(dir,'logo.png'));await dialog.waitFor({state:'hidden'});
  const canvas=p.frameLocator('#edit-frame'),replacement=await canvas.locator('#repeat').getAttribute('src');assert.notEqual(replacement,source);assert.equal(await canvas.locator('#repeat').evaluate(el=>getComputedStyle(el).objectFit),'contain');assert.equal(await canvas.locator('picture source[srcset]').count(),0);assert.equal(await canvas.locator('video').getAttribute('poster'),replacement);
  assert.ok((await canvas.locator('#background').evaluate(el=>getComputedStyle(el).backgroundImage)).includes(replacement));assert.equal(await canvas.locator('p').textContent(),source);assert.equal(await canvas.locator('a').getAttribute('href'),source);
  await p.locator('#undo').click();await canvas.locator('picture source').waitFor({state:'attached'});assert.equal(await canvas.locator('#repeat').getAttribute('src'),source);assert.ok((await canvas.locator('#background').evaluate(el=>getComputedStyle(el).backgroundImage)).includes(source));await ctx.close();
 });
 await t.test('editor media endpoints isolate pages and reject foreign uploads and references',async()=>{
  const fixture=createPage(db,store.id,{title:'Isolated media',mode:'html',rawHtml:'<img src="'+source+'">'});const {ctx}=await context();
  assert.equal((await ctx.request.get(origin+'/admin/pages/'+fixture.id+'/media/options?storeId='+other.id)).status(),404);
  const foreign=saveUpload({name:'foreign.png',type:'image/png',data:readFileSync(join(dir,'logo.png'))},other.id).url;
  const response=await ctx.request.post(origin+'/admin/pages/'+fixture.id+'/media/rebrand?storeId='+store.id,{data:{source,kind:'image',method:'ai',references:[foreign]}});assert.equal(response.status(),400);assert.match((await response.json()).error,/reference images/);
  const denied=await ctx.request.post(origin+'/admin/pages/'+fixture.id+'/media/rebrand?storeId='+store.id,{data:{source:foreign,kind:'image',method:'overlay',logo}});assert.equal(denied.status(),400);assert.match((await denied.json()).error,/owned by this asset/);
  const unsaved='data:image/png;base64,'+readFileSync(join(dir,'source.png')).toString('base64'),fields={source:unsaved,kind:'image',method:'overlay',logo,requestKey:'editor_unsaved_idempotency'};
  const first=await ctx.request.post(origin+'/admin/pages/'+fixture.id+'/media/rebrand?storeId='+store.id,{data:fields});assert.equal(first.status(),200);const started=await first.json();assert.ok(started.source.startsWith('/_uploads/'+store.id+'/'));
  const retry=await ctx.request.post(origin+'/admin/pages/'+fixture.id+'/media/rebrand?storeId='+store.id,{data:fields});assert.equal((await retry.json()).id,started.id);assert.equal(db.one('SELECT COUNT(*) n FROM media_rebrands WHERE request_key=?',fields.requestKey).n,1);
  await ctx.request.post(origin+'/admin/media/rebrand/'+started.id+'/cancel?storeId='+store.id,{headers:{Accept:'application/json'}});assert.equal(getPage(db,store.id,fixture.id).rawHtml,'<img src="'+source+'">');await ctx.close();
 });
 assert.deepEqual(errors,[]);
});
