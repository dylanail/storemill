import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright';
const dir=mkdtempSync(join(tmpdir(),'media-browser-'));
Object.assign(process.env,{AMBORAS_DB:join(dir,'test.db'),PORT:'0',AMBORAS_LOG_LEVEL:'error',AMBORAS_STOREFRONT_HOST:'',AMBORAS_PUBLIC_ORIGIN:'',AMBORAS_ADMIN_HOST:'',OPENAI_API_KEY:'test-image-key',GEMINI_API_KEY:'',ANTHROPIC_API_KEY:'',RUNWAYML_API_SECRET:'test-runway-key',STRIPE_SECRET_KEY:''});
const {server}=await import('../src/main.ts');
const {getDb}=await import('../src/lib/db.ts');const {register}=await import('../src/control/auth.ts');
const {createBlankAsset}=await import('../src/control/assets.ts');const {createPage}=await import('../src/pages/store.ts');
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
 assert.deepEqual(errors,[]);
});
