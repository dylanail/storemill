import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { editorPage } from '../src/admin/editor.ts';
import { newBlock, PAGE_CSS } from '../src/pages/store.ts';
import { renderBlocks } from '../src/pages/blocks.ts';

const base = {id:'layout',storeId:'test',title:'Layout test',handle:'layout',kind:'custom',mode:'html',blocks:[],rawHtml:'',headHtml:'',seo:{},status:'draft',isHome:false,productId:'',role:'page',weight:0,format:'',direction:'',createdAt:'',updatedAt:''};
const imported = readFileSync(new URL('./fixtures/editor/shopify.html',import.meta.url),'utf8');
const initialBlocks = [newBlock('headline',{text:'First block'}),newBlock('multicolumn',{headline:'Benefits',perRow:2,columns:'✦|First|First benefit\n✦|Second|Second benefit\n✦|Third|Third benefit'}),newBlock('headline',{text:'Last block'})];
const blockContext = {storeName:'Test',base:'',currency:'USD',products:[],reviews:[],bundles:[],brand:{}};
let mode='html', saved;
const server=createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://local').pathname;
  res.setHeader('content-type','text/html; charset=utf-8');
  if(pathname==='/editor')res.end(editorPage({page:{...base,mode,blocks:structuredClone(saved?.blocks||initialBlocks),rawHtml:saved?.rawHtml||imported},storeSlug:'test',products:[]}));
  else if(pathname==='/admin/pages/layout/canvas')res.end(saved?.rawHtml||imported);
  else if(pathname==='/admin/pages/layout/save'){
    let body='';for await(const chunk of req)body+=chunk;saved=JSON.parse(body);
    res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,handle:'layout',status:'draft',revisions:[]}));
  }else if(pathname==='/rendered')res.end('<!doctype html><style>body{margin:0;font:16px Arial}*{box-sizing:border-box}'+PAGE_CSS+'</style>'+renderBlocks(saved?.blocks||initialBlocks,blockContext));
  else if(pathname.endsWith('.svg')){res.setHeader('content-type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#acc9ce"/></svg>');}
  else{res.statusCode=404;res.end('not found');}
});

await test('direct block dragging and responsive column editing',async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
  try{
    const context=await browser.newContext({viewport:{width:1900,height:1000}});
    await context.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
    const page=await context.newPage(),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
    const canvas=()=>page.frameLocator('#edit-frame');
    async function open(next='html'){mode=next;saved=null;await page.goto(origin+'/editor');if(mode==='html')await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length>0);else await page.locator('.canvas-block').first().waitFor();}
    async function select(selector){await page.locator('#edit-frame').evaluate((el,s)=>window.__PAGE_EDITOR.select(el.contentDocument.querySelector(s).getAttribute('data-pb-id')),selector);}
    async function undo(){await page.locator('#undo').click();if(mode==='html')await page.waitForFunction(()=>!document.getElementById('save').disabled);}
    async function save(){await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Saved');}
    async function reload(){await page.reload();if(mode==='html')await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length>0);else await page.locator('.canvas-block').first().waitFor();}
    async function drag(source,target,sourcePoint={x:20,y:12},targetPoint){
      const a=await source.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);
      const end=targetPoint||{x:20,y:b.height-8};
      await page.mouse.move(a.x+sourcePoint.x,a.y+sourcePoint.y);await page.mouse.down();
      await page.mouse.move(a.x+sourcePoint.x+7,a.y+sourcePoint.y+7,{steps:3});
      await page.mouse.move(b.x+end.x,b.y+end.y,{steps:12});await page.mouse.up();
    }
    const values=()=>page.locator('[data-column-width]').evaluateAll(els=>els.map(el=>Number(el.value)));
    const geometry=selector=>canvas().locator(selector).evaluate(el=>[...el.children].map(c=>{const b=c.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width};}));
    async function setWidth(index,value){const input=page.getByRole('spinbutton',{name:`Column ${index} width percent`,exact:true});await input.fill(String(value));await input.press('Tab');}

    await t.test('first gesture moves unselected text, supports undo and survives save/reload',async()=>{
      await open();assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.getSelected()),null);
      await drag(canvas().locator('.hero h1'),canvas().locator('.hero .price'));
      assert.equal(await canvas().locator('.price + h1').count(),1);
      assert.equal((await page.evaluate(()=>window.__PAGE_EDITOR.getHistory())).length,1);
      await save();await undo();assert.equal(await canvas().locator('.column > h1:first-child').count(),1);
      await reload();assert.equal(await canvas().locator('.price + h1').count(),1);
    });
    await t.test('unselected image moves across columns without a preliminary click',async()=>{
      await open();await drag(canvas().locator('.hero img'),canvas().locator('.hero .price'),{x:100,y:100});
      assert.equal(await canvas().locator('.hero .column:first-child picture img').count(),1);assert.equal(await canvas().locator('.hero .column:first-child picture source').count(),1);
      await undo();assert.equal(await canvas().locator('.hero .column:nth-child(2) img').count(),1);
    });
    await t.test('an imported column accepts its last image back after moving it out, with undo and reload',async()=>{
      await open();await drag(canvas().locator('.hero img'),canvas().locator('.hero .price'),{x:100,y:100});
      const empty=canvas().locator('.hero .column').nth(1);
      assert.equal(await empty.getAttribute('data-pb-empty-target'),'');
      const type=await empty.evaluate(el=>window.parent.__PAGE_EDITOR.getModel().find(n=>n.id===el.getAttribute('data-pb-id')).type);
      assert.equal(type,'Column');
      const box=await empty.boundingBox();
      await drag(canvas().locator('.hero .column:first-child img'),empty,{x:80,y:80},{x:box.width/2,y:box.height/2});
      assert.equal(await canvas().locator('.hero .column:nth-child(2) picture img').count(),1);
      assert.equal(await empty.getAttribute('data-pb-empty-target'),null);
      await save();assert.doesNotMatch(saved.rawHtml,/data-pb-empty-target|Drop content here/);
      await undo();assert.equal(await canvas().locator('.hero .column:first-child picture img').count(),1);
      await reload();assert.equal(await canvas().locator('.hero .column:nth-child(2) picture img').count(),1);
    });
    await t.test('keyboard destination picker moves into empty containers and fit-content is undoable',async()=>{
      await open();await select('.hero picture');
      await page.getByRole('button',{name:'Move to…',exact:true}).click();
      const destination=await canvas().locator('#details .row').getAttribute('data-pb-id');
      await page.getByLabel('Destination container',{exact:true}).selectOption(destination);
      await page.getByRole('button',{name:'Move inside',exact:true}).click();
      assert.equal(await canvas().locator('#details .row picture').count(),1);
      await undo();assert.equal(await canvas().locator('.hero picture').count(),1);
      await select('.hero');await page.getByRole('button',{name:'Fit to content',exact:true}).click();
      assert.equal(await canvas().locator('.hero').evaluate(el=>getComputedStyle(el).paddingTop),'0px');
      await undo();assert.equal(await canvas().locator('.hero').evaluate(el=>getComputedStyle(el).paddingTop),'40px');
    });
    await t.test('direct drag of a horizontal column uses left/right ordering',async()=>{
      await open();const a=canvas().locator('.hero .column').first(),b=canvas().locator('.hero .column').nth(1);const rect=await b.boundingBox(),first=await a.boundingBox();
      await drag(a,b,{x:first.width-5,y:first.height-5},{x:rect.width-4,y:rect.height-5});
      assert.equal(await canvas().locator('.hero .column:last-child h1').count(),1);
      await undo();assert.equal(await canvas().locator('.hero .column:first-child h1').count(),1);
    });
    await t.test('imported columns expose balanced percentages, device overrides and persistent geometry',async()=>{
      await open();await select('.hero .row');assert.equal(await page.getByLabel('Columns per row',{exact:true}).inputValue(),'2');
      await setWidth(1,25);assert.deepEqual(await values(),[25,75]);
      const box=await geometry('.hero .row');assert.ok(Math.abs(box[0].width/box[1].width-1/3)<0.01);
      assert.equal((await page.evaluate(()=>window.__PAGE_EDITOR.getHistory())).length,1);
      await page.getByTitle('Tablet',{exact:true}).click();await page.getByLabel('Columns per row',{exact:true}).selectOption('2');await setWidth(1,40);
      await page.getByTitle('Mobile',{exact:true}).click();assert.equal(await page.getByLabel('Columns per row',{exact:true}).inputValue(),'1');
      const mobile=await geometry('.hero .row');assert.ok(mobile[1].y>mobile[0].y);assert.equal(mobile[0].width,mobile[1].width);
      await page.getByTitle('Desktop',{exact:true}).click();assert.deepEqual(await values(),[25,75]);
      await save();await reload();await select('.hero .row');assert.deepEqual(await values(),[25,75]);
      await page.getByTitle('Tablet',{exact:true}).click();assert.deepEqual(await values(),[40,60]);
      await page.getByTitle('Desktop',{exact:true}).click();
      if(process.env.EDITOR_COLUMNS_SCREENSHOT)await page.screenshot({path:process.env.EDITOR_COLUMNS_SCREENSHOT});
      await page.locator('[data-column-slider="0"]').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('Tab');assert.notEqual((await values())[0],25);
      await page.getByRole('button',{name:'Equal widths',exact:true}).click();assert.deepEqual(await values(),[50,50]);
    });
    await t.test('new Columns block creates editable containers and reducing count preserves content',async()=>{
      await open();await select('#details h2');await page.locator('.canvas-insert').click();await page.locator('[data-insert="Columns"]').click();
      const group='[data-pb-native="Columns"]';assert.equal(await canvas().locator(group+' > [data-pb-column]').count(),2);
      await page.getByLabel('Columns per row',{exact:true}).selectOption('3');assert.equal(await canvas().locator(group+' > [data-pb-column]').count(),3);
      await select(group+' > [data-pb-column]:last-child');await page.locator('[data-panel="add"]').click();await page.locator('#add-inside').click();await page.locator('[data-insert="Text"]').click();
      assert.equal(await canvas().locator(group+' > [data-pb-column]:last-child p').count(),1);
      await select(group);await page.getByLabel('Columns per row',{exact:true}).selectOption('2');assert.equal(await canvas().locator(group+' > [data-pb-column]').count(),2);assert.equal(await canvas().locator(group+' p').count(),1);
      await undo();assert.equal(await canvas().locator(group+' > [data-pb-column]').count(),3);assert.equal(await canvas().locator(group+' > [data-pb-column]:last-child p').count(),1);
      await save();await reload();assert.equal(await canvas().locator(group+' > [data-pb-column]').count(),3);
    });
    await t.test('native blocks drag on first gesture, cancel with Escape and save reordered content',async()=>{
      await open('blocks');
      await drag(page.locator('.canvas-block').first(),page.locator('.canvas-block').last());
      const order=()=>page.locator('.canvas-block h2').allTextContents();assert.deepEqual(await order(),['Benefits','Last block','First block']);
      await save();await undo();assert.deepEqual(await order(),['First block','Benefits','Last block']);
      const a=await page.locator('.canvas-block').first().boundingBox(),b=await page.locator('.canvas-block').last().boundingBox();
      await page.mouse.move(a.x+30,a.y+50);await page.mouse.down();await page.mouse.move(b.x+30,b.y+b.height-8,{steps:15});await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await order(),['First block','Benefits','Last block']);
      await reload();assert.deepEqual(await order(),['Benefits','Last block','First block']);
    });
    await t.test('dragging into an empty column and locking its contents preserve the layout',async()=>{
      await open();await select('.hero h1');await page.locator('.canvas-insert').click();await page.locator('[data-insert="Columns"]').click();
      const group='[data-pb-native="Columns"]',target=canvas().locator(group+' > [data-pb-column]').last();
      const a=await canvas().locator('.hero .price').boundingBox(),b=await target.boundingBox();
      await page.mouse.move(a.x+20,a.y+12);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.waitForTimeout(180);await page.mouse.up();
      assert.equal(await target.locator('.price').count(),1);
      await select(group+' > [data-pb-column]:last-child');
      await page.getByText('Organize & advanced',{exact:true}).click();await page.locator('[data-action="lock"]').click();
      await select(group);const before=await page.evaluate(()=>window.__PAGE_EDITOR.serialize());await page.getByLabel('Columns per row',{exact:true}).selectOption('1');
      assert.equal(await canvas().locator(group+' > [data-pb-column]').count(),2);assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.serialize()),before);
      assert.equal(await page.getByLabel('Columns per row',{exact:true}).inputValue(),'2');
    });
    await t.test('native count and percentages persist and render correctly from 320px to desktop',async()=>{
      await open('blocks');await page.locator('.canvas-block').nth(1).click();await setWidth(1,30);assert.deepEqual(await values(),[30,70]);
      await page.getByTitle('Tablet',{exact:true}).click();await setWidth(1,40);
      await page.getByTitle('Mobile',{exact:true}).click();assert.equal(await page.getByLabel('Columns per row',{exact:true}).inputValue(),'1');
      await page.getByTitle('Desktop',{exact:true}).click();await save();assert.equal(saved.blocks[1].settings.columnWidths,'30,70');
      await reload();await page.locator('.canvas-block').nth(1).click();assert.deepEqual(await values(),[30,70]);
      const rendered=await context.newPage();
      for(const width of [1200,820,390,320]){
        await rendered.setViewportSize({width,height:1000});await rendered.goto(origin+'/rendered');
        const info=await rendered.locator('.cols').evaluate(el=>({children:[...el.children].map(c=>{const r=c.getBoundingClientRect();return {y:r.y,width:r.width};}),overflow:document.documentElement.scrollWidth>innerWidth}));
        assert.equal(info.overflow,false,'No horizontal overflow at '+width);assert.equal(info.children.length,3);
        if(width>820)assert.ok(Math.abs(info.children[0].width/info.children[1].width-3/7)<0.01);
        else if(width>520)assert.ok(Math.abs(info.children[0].width/info.children[1].width-2/3)<0.01);
        else assert.ok(info.children[1].y>info.children[0].y);
      }
      await rendered.close();await page.getByLabel('Columns per row',{exact:true}).selectOption('6');assert.equal((await values()).length,6);assert.ok(Math.abs((await values()).reduce((a,b)=>a+b,0)-100)<0.001);
      await page.getByLabel('Columns per row',{exact:true}).selectOption('1');assert.deepEqual(await values(),[100]);assert.equal(await page.locator('.block-columns-preview > div').count(),3);
      await undo();assert.equal((await values()).length,6);
      saved.blocks[1].settings.perRow=1.5;saved.blocks[1].settings.columnWidths='invalid';await reload();await page.locator('.canvas-block').nth(1).click();assert.equal(await page.getByLabel('Columns per row',{exact:true}).inputValue(),'3');
    });
    assert.deepEqual(errors,[],'No editor runtime errors');
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
