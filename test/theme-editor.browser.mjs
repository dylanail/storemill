import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';
import {fresh} from './helpers.ts';
import {createBlankAsset} from '../src/control/assets.ts';
import {environment} from '../src/control/stores.ts';
import {createPage} from '../src/pages/store.ts';
import {themeEditorPage} from '../src/admin/theme-page.ts';
import {editorPage} from '../src/admin/editor.ts';
import {shell} from '../src/admin/shell.ts';
import {themeCss} from '../src/storefront/theme.ts';
import {importedThemeHtml} from '../src/pages/source-theme.ts';
import {importedCommerceHtml} from '../src/storefront/imported-commerce.ts';
import {dashboard} from '../src/admin/pages.ts';

const fixture=`<!doctype html><html><head><style>
@font-face{font-family:'Source Body';src:local('Arial');font-weight:100 900}@font-face{font-family:'Source Display';src:local('Georgia');font-weight:100 900}
:root{--primary:#007bff;--secondary:#6c757d}*{box-sizing:border-box}body{margin:0;background:#fff;color:#202223;font:400 16px 'Source Body',sans-serif}.announcement{background:#145b49;color:white;padding:15px;text-align:center}main{max-width:1000px;margin:auto;padding:50px 30px}h1{font:700 40px 'Source Display',serif}p{line-height:1.6}.card{background:#f5f1f4;border:1px solid #dedede;padding:24px}#source-cta{background:#c21882!important;color:#fff;border:0;border-radius:6px;padding:20px;font:600 18px 'Source Body',sans-serif}section{padding:20px 0}
</style></head><body><div class="announcement">Free US shipping on orders over $50</div><main><section><h1>Your next favorite thing</h1><p>Thoughtfully made for your everyday life, with thoughtful details that make a difference.</p><div class="card"><p>Designed to feel at home.</p></div><p><button class="cta" id="source-cta">ADD TO CART</button></p></section></main></body></html>`;
const {db,user}=fresh(),store=createBlankAsset(db,user.id,{name:'Source brand',kind:'store',currency:'USD'});
const pageData=createPage(db,store.id,{title:'Imported home',mode:'html',rawHtml:fixture,isHome:true,sourceUrl:'https://source.example',handle:'home'});
let brand={primary:'#007bff',secondary:'#6c757d'},saved,real=false;
const raw=()=>real?readFileSync(process.env.THEME_REAL_FIXTURE,'utf8'):fixture;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local');res.setHeader('content-type','text/html; charset=utf-8');
  if(url.pathname==='/generated'){res.end('<!doctype html><style>'+themeCss({primary:'#2244aa',paper:'#ffffff',ink:'#202223',buttonText:'#eeeeee',displayFont:'Georgia',bodyFont:'Arial',displayWeight:800,bodyWeight:500,themeCustomized:true},{...environment(db,store.id,'draft').theme,template:url.searchParams.get('template')})+'</style><h1>Heading</h1><p>Body copy</p><button class="btn">Shop now</button>');}
  else if(url.pathname==='/theme'){
    const body=themeEditorPage({store:{...store,brand},draft:{...environment(db,store.id,'draft'),brand},live:environment(db,store.id,'live'),pages:[{...pageData,rawHtml:raw()}],storeUrl:'/s/'+store.slug});
    res.end(shell({store,stores:[store],active:'store',title:'Theme settings',body,todos:[],messages:[],queue:[],publish:{label:'Publish',ready:false,reason:''},userName:'Owner',storeUrl:'/s/'+store.slug}));
  }else if(url.pathname==='/editor')res.end(editorPage({page:{...pageData,rawHtml:raw()},storeSlug:store.slug,products:[],brand}));
  else if(url.pathname.endsWith('/canvas'))res.end(raw());
  else if(url.pathname.startsWith('/preview/'))res.end(raw().replace('</body>',(real?importedCommerceHtml({db,store,env:environment(db,store.id,'draft'),base:'/preview/'+store.slug,preview:true},pageData):'')+importedThemeHtml(brand)+'</body>'));
  else if(url.pathname==='/admin/theme'){
    let text='';for await(const c of req)text+=c;saved=Object.fromEntries(new URLSearchParams(text));brand={...saved,displayWeight:Number(saved.displayWeight),bodyWeight:Number(saved.bodyWeight),themeCustomized:true,sourceTheme:JSON.parse(saved.sourceTheme)};res.writeHead(303,{location:'/theme'});res.end();
  }else if(url.pathname.startsWith('/_uploads/')&&process.env.THEME_ASSET_ORIGIN){const r=await fetch(process.env.THEME_ASSET_ORIGIN+url.pathname);res.setHeader('content-type',r.headers.get('content-type')||'application/octet-stream');res.end(Buffer.from(await r.arrayBuffer()));}
  else{res.statusCode=404;res.end('not found');}
});
await test('theme controls inherit source appearance and preserve editor geometry',async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1800,height:1150}});await context.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')||process.env.THEME_ALLOW_FONTS&&/^https:\/\/(fonts.googleapis.com|fonts.gstatic.com)\//.test(route.request().url())?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
    const preview=()=>page.frameLocator('#designer-preview');
    async function open(){await page.goto(origin+'/theme');await page.waitForFunction(()=>document.getElementById('theme-source-label').textContent==='Colors detected from your site');}
    await t.test('dashboard has no embedded storefront preview',()=>{const html=dashboard({db,store,userName:'Owner',storeUrl:'/s/'+store.slug},'7d');assert.doesNotMatch(html,/<iframe|preview-mini/);assert.match(html,/Customize store/);});
    await t.test('actual button, background and fonts replace generic framework tokens',async()=>{
      await open();assert.equal(await page.getByLabel('Solid button hex',{exact:true}).inputValue(),'#c21882');assert.equal(await page.getByLabel('Accent / announcement hex',{exact:true}).inputValue(),'#145b49');assert.equal(await page.getByLabel('Background hex',{exact:true}).inputValue(),'#ffffff');
      assert.equal(await page.locator('[name=displayFont]').inputValue(),'Source Display');assert.equal(await page.locator('[name=bodyFont]').inputValue(),'Source Body');assert.equal(await page.getByLabel('Display / headings font thickness',{exact:true}).inputValue(),'700');
    });
    await t.test('font picker shows each family in its own face, filters and changes thickness',async()=>{
      await page.locator('[data-font-open=display]').click();assert.equal(await page.getByRole('dialog').isVisible(),true);
      const samples=await page.locator('.theme-font-option').evaluateAll(els=>els.map(el=>({font:el.dataset.font,computed:getComputedStyle(el.querySelector('span')).fontFamily})));
      if(process.env.THEME_ALLOW_FONTS){assert.ok((await page.evaluate(()=>document.fonts.load('400 16px "Playfair Display"'))).length>0);await page.evaluate(()=>document.fonts.ready);}
      assert.ok(samples.length>=8);assert.ok(samples.every(sample=>sample.computed.includes(sample.font)));if(process.env.THEME_FONT_SCREENSHOT)await page.locator('#theme-font-dialog').screenshot({path:process.env.THEME_FONT_SCREENSHOT});
      await page.getByRole('searchbox',{name:'Search fonts'}).fill('Georgia');await page.getByRole('button',{name:'Use Georgia',exact:true}).click();
      await page.getByLabel('Display / headings font thickness',{exact:true}).selectOption('800');assert.equal(await preview().locator('h1').evaluate(el=>getComputedStyle(el).fontWeight),'800');assert.match(await preview().locator('h1').evaluate(el=>getComputedStyle(el).fontFamily),/Georgia/);
      await page.locator('[data-font-open=body]').click();await page.getByRole('searchbox',{name:'Search fonts'}).fill('not-a-font');assert.equal(await page.locator('.theme-font-empty').textContent(),'No fonts match your search.');await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').isVisible(),false);
    });
    await t.test('color edits preview immediately and save/reload into imported pages',async()=>{
      await page.getByLabel('Solid button hex',{exact:true}).fill('#2244aa');await page.getByLabel('Solid button hex',{exact:true}).press('Tab');
      assert.equal(await preview().locator('.cta').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 68, 170)');
      await page.getByLabel('Body font thickness',{exact:true}).selectOption('500');
      await Promise.all([page.waitForURL('**/theme'),page.getByRole('button',{name:'Save draft',exact:true}).click()]);
      assert.equal(saved.primary,'#2244aa');assert.equal(saved.displayFont,'Georgia');assert.equal(saved.displayWeight,'800');assert.equal(saved.bodyWeight,'500');assert.equal(saved.sourceTheme.includes('#c21882'),true);
      await preview().locator('h1').waitFor();assert.equal(await page.getByLabel('Solid button hex',{exact:true}).inputValue(),'#2244aa');assert.equal(await page.locator('[name=displayFont]').inputValue(),'Georgia');assert.equal(await preview().locator('.cta').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 68, 170)');
      await page.getByRole('button',{name:'Reset to source'}).click();assert.equal(await page.getByLabel('Solid button hex',{exact:true}).inputValue(),'#c21882');
    });
    await t.test('individual mobile block colors override site colors and reset cleanly',async()=>{
      const editor=await context.newPage();await editor.goto(origin+'/editor');await editor.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length>0);
      const button=()=>editor.frameLocator('#edit-frame').locator('.cta');
      assert.equal(await button().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 68, 170)');
      await editor.locator('#edit-frame').evaluate(el=>window.__PAGE_EDITOR.select(el.contentDocument.querySelector('.cta').getAttribute('data-pb-id')));
      await editor.locator('[data-tab="design"]').click();await editor.getByTitle('Mobile',{exact:true}).click();
      const color=editor.locator('[data-style="background-color"]');await color.fill('#338844');await color.press('Tab');
      assert.equal(await button().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(51, 136, 68)');
      await editor.getByTitle('Desktop',{exact:true}).click();assert.equal(await button().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 68, 170)');
      await editor.getByTitle('Mobile',{exact:true}).click();await editor.getByRole('button',{name:'Reset Background color',exact:true}).click();
      assert.equal(await button().evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(34, 68, 170)');
      assert.doesNotMatch(await editor.evaluate(()=>window.__PAGE_EDITOR.serialize()),/data-store-theme-node|@layer amboras-theme/);await editor.close();
    });
    await t.test('theme preview uses actual device widths without blank canvas wings',async()=>{
      for(const [name,width] of [['Desktop',1200],['Tablet',820],['Mobile',390]]){await page.getByRole('button',{name:name+' preview',exact:true}).click();const bounds=await page.locator('#designer-preview').evaluate(el=>({viewport:el.contentDocument.documentElement.clientWidth,frame:el.getBoundingClientRect().width,shell:el.parentElement.getBoundingClientRect().width}));assert.equal(bounds.viewport,width);assert.ok(Math.abs(bounds.frame-bounds.shell)<2);}
      for(const width of [760,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);}await page.setViewportSize({width:1800,height:1150});
      if(process.env.THEME_SCREENSHOT){await page.getByRole('button',{name:'Desktop preview',exact:true}).click();await page.screenshot({path:process.env.THEME_SCREENSHOT});}
    });
    await t.test('generated themes respect heading family, thickness and button label colors',async()=>{
      const generated=await context.newPage();for(const template of ['atelier','gallery','market']){await generated.goto(origin+'/generated?template='+template);assert.equal(await generated.locator('h1').evaluate(el=>getComputedStyle(el).fontWeight),'800');assert.match(await generated.locator('h1').evaluate(el=>getComputedStyle(el).fontFamily),/Georgia/);assert.equal(await generated.locator('p').evaluate(el=>getComputedStyle(el).fontWeight),'500');assert.equal(await generated.locator('.btn').evaluate(el=>getComputedStyle(el).color),'rgb(238, 238, 238)');}await generated.close();
    });
    if(process.env.THEME_REAL_FIXTURE)await t.test('real copied editor displays one purchase panel, uncropped gallery and centered canvas',async()=>{
      real=true;brand={};await page.goto(origin+'/editor');await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length>100);
      const canvas=()=>page.frameLocator('#edit-frame');await canvas().locator('.mainImage img').first().evaluate(img=>img.decode().catch(()=>{}));
      const panels=()=>canvas().locator('.khOneOffer,.khSubOffer').evaluateAll(els=>els.filter(el=>el.checkVisibility({checkVisibilityCSS:true})).length);
      assert.equal(await panels(),1);const before=await page.evaluate(()=>window.__PAGE_EDITOR.serialize());await page.getByLabel('Editor purchase options').selectOption('0');assert.equal(await panels(),1);assert.equal(await canvas().locator('.khOneOffer').isVisible(),true);
      await page.getByLabel('Editor image').selectOption('1');assert.equal(await canvas().locator('.mainImage .swiper-slide').evaluateAll(els=>els.filter(el=>el.checkVisibility({checkVisibilityCSS:true})).length),1);assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.serialize()),before);
      for(const size of ['Desktop','Tablet','Mobile']){await page.getByTitle(size,{exact:true}).click();const geometry=await page.locator('#edit-frame').evaluate(el=>{const image=el.contentDocument.querySelector('.mainImage .swiper-slide:nth-child(2) img'),r=image.getBoundingClientRect(),box=image.closest('.mainImage').getBoundingClientRect();return {sheet:el.parentElement.getBoundingClientRect().width,frame:el.getBoundingClientRect().width,image:r.width,gallery:box.width,overflow:el.contentDocument.documentElement.scrollWidth>el.contentDocument.documentElement.clientWidth+1};});assert.ok(Math.abs(geometry.sheet-geometry.frame)<2);assert.ok(geometry.image<=geometry.gallery+1);assert.equal(geometry.overflow,false,size+' overflow');}
      await page.getByTitle('Desktop',{exact:true}).click();await page.getByLabel('Editor image').selectOption('0');
      if(process.env.THEME_REAL_SCREENSHOT)await page.screenshot({path:process.env.THEME_REAL_SCREENSHOT});
      await page.goto(origin+'/theme');await page.waitForFunction(()=>document.getElementById('theme-source-label').textContent==='Colors detected from your site');
      assert.notEqual(await page.getByLabel('Solid button hex',{exact:true}).inputValue(),'#007bff');
      await page.getByLabel('Solid button hex',{exact:true}).fill('#2244aa');await page.getByLabel('Solid button hex',{exact:true}).press('Tab');
      assert.equal(await preview().locator('a,button,[role=button]').evaluateAll(els=>getComputedStyle(els.find(el=>/^add to cart$/i.test(el.textContent.trim()))).backgroundColor),'rgb(34, 68, 170)');
      await page.getByRole('button',{name:'Reset to source'}).click();
      if(process.env.THEME_REAL_SETTINGS_SCREENSHOT)await page.screenshot({path:process.env.THEME_REAL_SETTINGS_SCREENSHOT});
    });
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
