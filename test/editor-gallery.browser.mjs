import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';
import {editorPage} from '../src/admin/editor.ts';
import {productGalleryRuntime} from '../src/pages/product-gallery-runtime.ts';
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#ace"/></svg>';
const media=[1,2,3].map(i=>({url:'/product-'+i+'.svg',alt:'Product photo '+i,kind:'image'}));
let product,saved,mode='html',updates=0;
const fixture=`<!doctype html><html><head><style>body{margin:0;padding:20px;font:16px Arial}.product-shell{max-width:700px;background:#f8f4ec;padding:12px;border-radius:20px}.swiper{overflow:hidden}.swiper-wrapper{display:flex}.swiper-slide{flex-shrink:0;width:650px}.swiper-slide img{width:100%;border-radius:16px}.swiper_thumbs .swiper-slide{width:66px}.swiper_outer_wrapper{position:relative}.swiper-button{position:absolute;top:50%;border-radius:50%;background:black;color:white;width:30px;height:30px;text-align:center}.swiper-button-next{right:0}.swiper-button-prev{left:0}</style></head><body><h1>Independent page text</h1><div id="AB-003-gallery" class="product-shell"><div class="swiper_outer_wrapper"><div class="swiper swiper_main"><div class="swiper-wrapper">${[1,2,3,4].map(i=>'<div class="swiper-slide"><picture><source srcset="/original-'+i+'.svg"><img src="/original-'+i+'.svg" alt="Original '+i+'"></picture></div>').join('')}</div></div><div class="swiper-button swiper-button-prev" role="button" aria-label="Previous slide">‹</div><div class="swiper-button swiper-button-next" role="button" aria-label="Next slide">›</div></div><div class="swiper swiper_thumbs"><div class="swiper-wrapper">${[1,2,3,4].map(i=>'<div class="swiper-slide"><img src="/original-'+i+'.svg" alt=""></div>').join('')}</div></div></div><div class="swiper reviews"><div class="swiper-wrapper"><div class="swiper-slide">A customer testimonial</div></div></div></body></html>`;
const base={id:'gallery',storeId:'store',title:'Gallery',handle:'gallery',kind:'custom',mode:'html',blocks:[],rawHtml:fixture,headHtml:'',seo:{},status:'draft',isHome:false,productId:'p',role:'page',weight:0,format:'',direction:'',createdAt:'',updatedAt:''};
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://local');res.setHeader('content-type','text/html');
 if(url.pathname==='/editor')return res.end(editorPage({page:{...base,mode,...saved,blocks:saved?.blocks||[{id:'gal',type:'gallery',settings:{images:'/original-1.svg\n/original-2.svg'}}]},storeSlug:'test',products:[{id:'p',title:'Owned product'},{id:'p2',title:'Other product'}]}));
 if(url.pathname==='/admin/pages/gallery/canvas')return res.end(saved?.rawHtml||fixture);
 if(url.pathname==='/live')return res.end(saved.rawHtml);
 if(url.pathname==='/standalone')return res.end(fixture.replace('</body>','<script>'+productGalleryRuntime+'</script></body>'));
 if(url.pathname.endsWith('.svg')){res.setHeader('content-type','image/svg+xml');return res.end(svg);}
 res.setHeader('content-type','application/json');
 if(url.pathname.includes('/product-data/')||url.pathname.includes('/api/page-products/'))return res.end(JSON.stringify(product));
 if(url.pathname.includes('/product-media/')){let body='';for await(const c of req)body+=c;const input=JSON.parse(body);if(input.revision!==product.mediaRevision){res.statusCode=409;return res.end(JSON.stringify({error:'Product media changed in another tab'}));}product={...product,media:input.media,mediaRevision:String(Number(product.mediaRevision)+1)};updates++;return res.end(JSON.stringify(product));}
 if(url.pathname.endsWith('/media/options'))return res.end(JSON.stringify({assets:[{url:'/replacement.svg',kind:'image',category:'media',label:'Replacement image'},{url:'/movie.mp4',kind:'video',category:'media',label:'Product video'}],defaults:{},available:{rendering:false,images:[]},jobs:[]}));
 if(url.pathname.endsWith('/save')){let body='';for await(const c of req)body+=c;saved=JSON.parse(body);return res.end(JSON.stringify({ok:true,handle:'gallery',status:'draft',revisions:[]}));}
 res.statusCode=404;res.end('{}');
});
await test('connected product galleries',async t=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 const context=await browser.newContext({viewport:{width:1900,height:1000}});await context.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
 const canvas=()=>page.frameLocator('#edit-frame'),panel=()=>page.locator('.gallery-editor');
 async function open(next='html'){mode=next;saved=null;product={id:'p',title:'Owned product',media:structuredClone(media),image:media[0].url,mediaRevision:'1'};updates=0;await page.goto(origin+'/editor');if(mode==='html'){await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length);await canvas().locator('#AB-003-gallery img').first().click({position:{x:60,y:60}});}else await page.locator('.canvas-block').click();await panel().waitFor();}
 async function save(){await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Saved');}
 async function connect(){await panel().locator('[data-gallery-product]').selectOption('p');await panel().getByRole('button',{name:'Connect product media',exact:true}).click();await panel().locator('[data-gallery-slide]').nth(2).waitFor();await page.waitForFunction(()=>document.querySelectorAll('[data-gallery-slide]').length===3);}
 async function selectGallery(){await page.locator('#edit-frame').evaluate(frame=>window.__PAGE_EDITOR.select(frame.contentDocument.querySelector('#AB-003-gallery').getAttribute('data-pb-id')));}
 try{
 await t.test('recognizes the complete imported gallery, leaves testimonial sliders alone and preserves untouched HTML',async()=>{await open();assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.getModel().filter(n=>n.type==='Product gallery').length),1);assert.equal(await panel().locator('[data-gallery-slide]').count(),4);assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.serialize()),fixture);});
 await t.test('connects all slides and thumbnails, supports selection, arrows and keyboard at three widths',async()=>{
  await open();const beforeWidth=await canvas().locator('#AB-003-gallery').evaluate(el=>el.getBoundingClientRect().width);await connect();assert.equal(await canvas().locator('#AB-003-gallery').evaluate(el=>el.getBoundingClientRect().width),beforeWidth,'Connection preserves imported gallery width');
  for(const device of ['Desktop','Tablet','Mobile']){await page.getByTitle(device,{exact:true}).click();assert.equal(await canvas().locator('[data-pg-slide]').count(),3);assert.equal(await canvas().locator('[data-pg-thumb]').count(),3);await canvas().locator('[data-pg-next]').click();await page.waitForFunction(()=>document.querySelector('#edit-frame').contentDocument.querySelector('[data-pg-thumb="1"]').getAttribute('aria-current')==='true');await canvas().locator('[data-pg-thumb="2"]').click();assert.equal(await canvas().locator('[data-pg-thumb="2"]').getAttribute('aria-current'),'true');await canvas().locator('[data-pg-thumb="2"]').press('Home');assert.equal(await canvas().locator('[data-pg-thumb="0"]').getAttribute('aria-current'),'true');}
  assert.equal(await canvas().locator('.reviews').textContent(),'A customer testimonial');
  if(process.env.GALLERY_SCREENSHOT){await page.getByTitle('Desktop',{exact:true}).click();await page.screenshot({path:process.env.GALLERY_SCREENSHOT});}
 });
 await t.test('page-only reorder, descriptions, replacement and deletion retain live carousel behavior after save/reload and undo',async()=>{
  await open();await connect();await panel().locator('[data-gallery-scope]').selectOption('custom');
  await panel().getByRole('button',{name:'Move slide 3 up',exact:true}).click();
  assert.equal(await canvas().locator('[data-pg-slide="1"] img').getAttribute('src'),'/product-3.svg');
  await panel().getByRole('textbox',{name:'Slide 2 description',exact:true}).fill('Changed description');await panel().getByRole('textbox',{name:'Slide 2 description',exact:true}).press('Tab');
  await panel().locator('[data-gallery-replace="1"]').click();await page.getByRole('button',{name:'Choose asset',exact:true}).click();await page.locator('[data-asset="0"]').click();
  assert.equal(await canvas().locator('[data-pg-slide="1"] img').getAttribute('src'),'/replacement.svg');assert.equal(await canvas().locator('[data-pg-thumb="1"] img').getAttribute('src'),'/replacement.svg');
  await panel().getByRole('button',{name:'Remove slide 3',exact:true}).click();assert.equal(await canvas().locator('[data-pg-slide]').count(),2);
  await page.locator('#undo').click();await page.waitForFunction(()=>!document.getElementById('save').disabled);await selectGallery();assert.equal(await canvas().locator('[data-pg-slide]').count(),3);
  await save();assert.equal(updates,0);assert.deepEqual(product.media,media);assert.ok(!saved.rawHtml.includes('data-pb-temporary'));
  const live=await context.newPage();live.on('pageerror',e=>errors.push(e.message));await live.goto(origin+'/live');await live.locator('[data-pg-next]').click();assert.equal(await live.locator('[data-pg-thumb="1"]').getAttribute('aria-current'),'true');assert.equal(await live.locator('[data-pg-slide="1"] img').getAttribute('src'),'/replacement.svg');await live.close();
  await page.reload();await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length);await selectGallery();assert.equal(await panel().getByRole('textbox',{name:'Slide 2 description',exact:true}).inputValue(),'Changed description');
 });
 await t.test('product updates are explicit, update all connected instances, and support conflict-aware product undo',async()=>{
  await open();await connect();await panel().getByRole('button',{name:'Move slide 2 up',exact:true}).click();assert.equal(updates,0);
  await panel().getByRole('button',{name:'Save product media',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-gallery-save]'));
  assert.equal(updates,1);assert.equal(product.media[0].url,'/product-2.svg');
  await save();product.media=[{url:'/replacement.svg',alt:'Updated elsewhere',kind:'image'}];product.mediaRevision='3';
  const live=await context.newPage();await live.goto(origin+'/live');await live.waitForFunction(()=>document.querySelectorAll('[data-pg-slide]').length===1);assert.equal(await live.locator('[data-pg-next]').isVisible(),false);await live.close();
  await panel().getByRole('button',{name:'Undo product media update',exact:true}).click();await panel().getByRole('status').filter({hasText:'changed in another tab'}).waitFor();assert.equal(product.media.length,1);
 });
 await t.test('duplicate gallery instances keep independent overrides and working controls',async()=>{
  await open();await connect();await page.evaluate(()=>window.__PAGE_EDITOR.action('duplicate'));
  assert.equal(await canvas().locator('[data-pb-gallery]').count(),2);
  const duplicate=canvas().locator('[data-pb-gallery]').nth(1);
  await duplicate.locator('[data-pg-next]').click();assert.equal(await duplicate.locator('[data-pg-thumb="1"]').getAttribute('aria-current'),'true');
  await panel().locator('[data-gallery-scope]').selectOption('custom');await panel().getByRole('button',{name:'Remove slide 3',exact:true}).click();
  assert.equal(await duplicate.locator('[data-pg-slide]').count(),2);assert.equal(await canvas().locator('[data-pb-gallery]').first().locator('[data-pg-slide]').count(),3);
  await panel().getByRole('button',{name:'Restore imported gallery',exact:true}).click();assert.equal(await duplicate.locator('[data-pg-slide]').count(),0);assert.equal(await canvas().locator('.swiper_main').nth(1).locator('img').count(),4);
 });
 await t.test('adding video, appearance settings, looping and empty galleries persist without stale thumbnails',async()=>{
  await open();await connect();await panel().locator('[data-gallery-scope]').selectOption('custom');
  await panel().getByRole('button',{name:'Add video',exact:true}).click();await page.getByRole('button',{name:'Choose asset',exact:true}).click();await page.locator('[data-asset="0"]').click();
  assert.equal(await canvas().locator('[data-pg-slide="3"] video').getAttribute('src'),'/movie.mp4');assert.equal(await canvas().locator('[data-pg-thumb]').count(),4);
  await panel().getByRole('checkbox',{name:'Loop slides',exact:true}).check();await canvas().locator('[data-pg-prev]').click();assert.equal(await canvas().locator('[data-pg-thumb="3"]').getAttribute('aria-current'),'true');
  await panel().getByRole('combobox',{name:'Image proportions',exact:true}).selectOption('square');await panel().getByRole('combobox',{name:'Image fit',exact:true}).selectOption('cover');
  assert.equal(await canvas().locator('[data-pg-slide="0"] img').evaluate(el=>getComputedStyle(el).objectFit),'cover');
  await panel().getByRole('checkbox',{name:'Show thumbnails',exact:true}).uncheck();assert.equal(await canvas().locator('[data-pg-thumbs]').isVisible(),false);
  for(let i=4;i>0;i--)await panel().getByRole('button',{name:'Remove slide '+i,exact:true}).click();
  assert.equal(await canvas().locator('[data-pg-empty]').textContent(),'No product media');assert.equal(await canvas().locator('[data-pg-next]').isVisible(),false);
  await panel().getByRole('button',{name:'Add image',exact:true}).click();await page.getByRole('button',{name:'Choose asset',exact:true}).click();await page.locator('[data-asset="0"]').click();assert.equal(await canvas().locator('[data-pg-slide]').count(),1);
  await save();assert.equal(updates,0);
 });
 await t.test('touch gestures advance and loop a saved gallery',async()=>{
  await open();await connect();await panel().getByRole('checkbox',{name:'Loop slides',exact:true}).check();await save();
  const touchContext=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const live=await touchContext.newPage();await live.goto(origin+'/live');
  await live.locator('[data-pg-thumb="2"]').click();
  const client=await touchContext.newCDPSession(live),box=await live.locator('[data-pg-track]').boundingBox();
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width-30,y:box.y+80}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+30,y:box.y+80}]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await live.waitForFunction(()=>document.querySelector('[data-pg-thumb="0"]').getAttribute('aria-current')==='true');await touchContext.close();
 });
 await t.test('a reopened connected gallery refreshes its product revision before editing',async()=>{
  await open();await connect();await save();product.mediaRevision='2';product.media=[...media,{url:'/replacement.svg',alt:'New photo',kind:'image'}];
  await page.reload();await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length);await selectGallery();await page.waitForFunction(()=>document.querySelectorAll('[data-gallery-slide]').length===4);
  await panel().getByRole('button',{name:'Move slide 2 up',exact:true}).click();await panel().getByRole('button',{name:'Save product media',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-gallery-save]'));assert.equal(updates,1);
 });
 await t.test('a new gallery can be added and connected without HTML editing',async()=>{
  await open();await page.getByTitle('Add elements',{exact:true}).click();await page.locator('[data-panel-body="add"]').getByRole('button',{name:'Add after selection',exact:true}).click();await page.locator('[data-insert="Product gallery"]').click();
  assert.equal(await panel().locator('[data-gallery-slide]').count(),0);await connect();assert.equal(await canvas().locator('[data-pb-gallery]').count(),1);assert.equal(await panel().locator('[data-gallery-slide]').count(),3);
 });
 await t.test('native gallery blocks expose the same slide controls and save their connection',async()=>{await open('blocks');await connect();await panel().locator('[data-gallery-scope]').selectOption('custom');await panel().getByRole('button',{name:'Remove slide 2',exact:true}).click();await save();assert.equal(JSON.parse(saved.blocks[0].settings.gallery).items.length,2);assert.equal(saved.blocks[0].settings.productId,'');});
 assert.deepEqual(errors,[]);
 }finally{await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
});
