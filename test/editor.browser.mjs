import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { editorPage } from '../src/admin/editor.ts';

const fixtures=['shopify','funnelish','woocommerce','webflow','sales-letter'];
const basePage={id:'test',storeId:'store',title:'Everyday collection',handle:'test',kind:'custom',mode:'html',blocks:[],rawHtml:'',headHtml:'',seo:{},status:'draft',sourceUrl:'https://example.com',isHome:false,productId:'',role:'page',weight:0,format:'',direction:'',createdAt:'',updatedAt:''};
const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#8cafbe"/><circle cx="300" cy="200" r="110" fill="#edf6f8"/></svg>';
let saved,savedPreset,savedTemplate,fixture='shopify',saveDelay=0;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local');
  const raw=saved?.rawHtml||readFileSync(fixture==='real'?process.env.EDITOR_IMPORT_FIXTURE:new URL('./fixtures/editor/'+fixture+'.html',import.meta.url),'utf8');
  if(url.pathname==='/editor'){res.setHeader('content-type','text/html; charset=utf-8');res.end(editorPage({page:{...basePage,rawHtml:raw},storeSlug:'demo',products:[{id:'product-1',title:'Live product'}]}));}
  else if(url.pathname==='/admin/pages/test/canvas'||url.pathname==='/original'){res.setHeader('content-type','text/html; charset=utf-8');res.end(raw);}
  else if(url.pathname.endsWith('.svg')){res.setHeader('content-type','image/svg+xml');res.end(svg);}
  else if(url.pathname==='/admin/pages/test/save'){let body='';for await(const c of req)body+=c;await new Promise(r=>setTimeout(r,saveDelay));saved=JSON.parse(body);res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,handle:'test',status:saved.status,revisions:[]}));}
  else if(url.pathname==='/admin/pages/test/html-presets'){let body='';for await(const c of req)body+=c;const input=JSON.parse(body);savedPreset={id:'preset-1',name:input.name,type:'custom-html',settings:{html:input.html}};res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,preset:savedPreset}));}
  else if(url.pathname==='/admin/pages/test/template'){let body='';for await(const c of req)body+=c;savedTemplate={...saved,name:JSON.parse(body).name};res.setHeader('content-type','application/json');res.end(JSON.stringify({ok:true,template:{id:'template-1',name:savedTemplate.name}}));}
  else if(url.pathname==='/library-preview'){res.setHeader('content-type','text/html; charset=utf-8');res.end('<!doctype html><html><head><style>body{margin:0;font:16px Times;color:purple}.hero{background:yellow}h1{font-size:10px}</style></head><body>'+savedPreset.settings.html+'<p id="outside">Keep this destination text purple</p></body></html>');}
  else if(url.pathname==='/admin/pages/test/product-data/product-1'){res.setHeader('content-type','application/json');res.end(JSON.stringify({id:'product-1',title:'Live product',price:'$79.00',image:'/image.svg',variantId:'variant-1'}));}
  else {res.statusCode=404;res.end('not found');}
});
const runtimeErrors=[];
let browser;
const launchOptions={headless:true,...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})};

await test('visual editor real-browser workflows',async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  browser=await chromium.launch(launchOptions);
  const context=await browser.newContext({viewport:{width:1900,height:1000}});
  await context.route('**/*',route=>route.request().url().startsWith(origin)||route.request().url().startsWith('data:')?route.continue():route.abort());
  const page=await context.newPage();page.setDefaultTimeout(8000);page.on('pageerror',e=>runtimeErrors.push(e.message));
  const canvas=()=>page.frameLocator('#edit-frame');
  async function open(name='shopify'){fixture=name;saved=null;saveDelay=0;await page.goto(origin+'/editor');await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length>0);await page.locator('#edit-frame').evaluate(el=>el.contentDocument.fonts.ready);}
  async function select(selector){await page.locator('#edit-frame').evaluate((el,selector)=>window.__PAGE_EDITOR.select(el.contentDocument.querySelector(selector).getAttribute('data-pb-id')),selector);}
  async function raw(){return page.evaluate(()=>window.__PAGE_EDITOR.serialize());}
  async function undo(){await page.locator('#undo').click();await page.waitForFunction(()=>!document.getElementById('save').disabled);}

  for(const name of fixtures)await t.test(name+': preserves untouched source, visual layout, selection and navigation safety',async()=>{
    await open(name);
    assert.equal(await raw(),readFileSync(new URL('./fixtures/editor/'+name+'.html',import.meta.url),'utf8'));
    const dimensions=await page.locator('#edit-frame').evaluate(el=>({width:el.contentDocument.documentElement.clientWidth,height:el.contentDocument.documentElement.clientHeight}));
    const reference=await context.newPage();await reference.setViewportSize(dimensions);await reference.goto(origin+'/original');await reference.locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.decode().catch(()=>{}))));
    await canvas().locator('img').evaluateAll(images=>Promise.all(images.map(img=>img.decode().catch(()=>{}))));
    const actual=await page.locator('#edit-frame').screenshot(),expected=await reference.screenshot();
    if(!actual.equals(expected)){mkdirSync('../fidelity',{recursive:true});writeFileSync('../fidelity/'+name+'-actual.png',actual);writeFileSync('../fidelity/'+name+'-expected.png',expected);}
    const difference=await page.evaluate(async([a,b])=>{
      const decode=async value=>createImageBitmap(new Blob([Uint8Array.from(atob(value),c=>c.charCodeAt(0))],{type:'image/png'}));
      const images=await Promise.all([decode(a),decode(b)]);if(images[0].width!==images[1].width||images[0].height!==images[1].height)return 1;
      const pixels=images.map(image=>{const canvas=new OffscreenCanvas(image.width,image.height);const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,image.width,image.height).data;});let mismatch=0;
      for(let i=0;i<pixels[0].length;i+=4)if([0,1,2].some(c=>Math.abs(pixels[0][i+c]-pixels[1][i+c])>2))mismatch++;
      return mismatch/(images[0].width*images[0].height);
    },[actual.toString('base64'),expected.toString('base64')]);
    assert.ok(difference<0.0001,'Canvas visual difference exceeds 0.01%: '+difference);await reference.close();
    const heading=canvas().locator('h1');await heading.click({position:{x:25,y:25}});
    const type=await page.evaluate(()=>window.__PAGE_EDITOR.getModel().find(n=>n.id===window.__PAGE_EDITOR.getSelected()).type);
    assert.ok(['Heading','Product title'].includes(type));
    assert.equal(await canvas().locator('amboras-text').count(),0);
    const interactive=canvas().locator('button,a').first();const before=page.url();await interactive.click();assert.equal(page.url(),before);
    assert.ok(['Button','Link','Add to cart','Buy now'].includes(await page.evaluate(()=>window.__PAGE_EDITOR.getModel().find(n=>n.id===window.__PAGE_EDITOR.getSelected()).type)));
    assert.equal(await raw(),readFileSync(new URL('./fixtures/editor/'+name+'.html',import.meta.url),'utf8'));
  });
  await t.test('inline text commits once, supports semantic formatting and undo restores selection',async()=>{
    await open();await canvas().locator('h1').dblclick({position:{x:30,y:25}});await page.keyboard.insertText('A new everyday essential');await page.keyboard.press('Enter');assert.equal(await canvas().locator('h1').textContent(),'A new everyday essential');assert.equal((await page.evaluate(()=>window.__PAGE_EDITOR.getHistory())).length,1);await undo();assert.equal(await canvas().locator('h1').textContent(),'Meet your everyday essential');assert.ok(await page.evaluate(()=>window.__PAGE_EDITOR.getSelected()));
    await canvas().locator('h1').dblclick({position:{x:30,y:25}});await page.keyboard.press('Control+b');await page.keyboard.press('Enter');assert.equal(await canvas().locator('h1 strong').count(),1);
  });
  await t.test('nested button selection, duplication, copy/paste, reorder, delete and undo',async()=>{
    await open();await canvas().locator('#buy span').click();assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.getModel().find(n=>n.id===window.__PAGE_EDITOR.getSelected()).type),'Add to cart');await page.keyboard.press('Control+d');assert.equal(await canvas().locator('button').count(),2);const ids=await canvas().locator('button').evaluateAll(els=>els.map(el=>el.id));assert.equal(new Set(ids).size,2);await undo();assert.equal(await canvas().locator('button').count(),1);
    await select('#details h2');await page.keyboard.press('Control+c');await page.keyboard.press('Control+v');assert.equal(await canvas().locator('#details h2').count(),2);await page.keyboard.press('Delete');assert.equal(await canvas().locator('#details h2').count(),1);await undo();assert.equal(await canvas().locator('#details h2').count(),2);
    await select('#details .row');const order=await canvas().locator('#details').evaluate(el=>[...el.children].indexOf(el.querySelector('.row')));await page.keyboard.press('ArrowUp');assert.equal(await canvas().locator('#details').evaluate(el=>[...el.children].indexOf(el.querySelector('.row'))),order-1);await undo();assert.equal(await canvas().locator('#details').evaluate(el=>[...el.children].indexOf(el.querySelector('.row'))),order);
  });
  await t.test('responsive overrides preserve imported CSS and reset to inherited values',async()=>{
    await open();const originalStyle=await canvas().locator('style').first().textContent();await select('h1');await page.locator('[data-tab="design"]').click();await page.getByTitle('Mobile',{exact:true}).click();await page.locator('[data-style="font-size"]').fill('22');await page.locator('[data-style="font-size"]').press('Tab');assert.equal(await canvas().locator('h1').evaluate(el=>getComputedStyle(el).fontSize),'22px');assert.match(await raw(),/@media\(max-width:767px\)/);assert.equal(await canvas().locator('style').first().textContent(),originalStyle);assert.equal(await canvas().locator('h1').getAttribute('style'),null);
    await page.getByTitle('Desktop',{exact:true}).click();assert.equal(await canvas().locator('h1').evaluate(el=>getComputedStyle(el).fontSize),'48px');await page.getByTitle('Mobile',{exact:true}).click();await page.getByRole('button',{name:'Reset Size',exact:true}).click();assert.equal(await canvas().locator('h1').evaluate(el=>getComputedStyle(el).fontSize),'30px');
  });
  await t.test('replacing and undoing images restores srcset, alt and picture sources',async()=>{
    await open();await select('img');const originalImg=await canvas().locator('picture').evaluate(el=>el.outerHTML);await page.locator('[data-attribute="src"]').fill('/replacement.svg');await page.locator('[data-attribute="src"]').press('Tab');assert.equal(await canvas().locator('img').getAttribute('srcset'),null);assert.equal(await canvas().locator('source').getAttribute('srcset'),null);await undo();assert.equal(await canvas().locator('picture').evaluate(el=>el.outerHTML),originalImg);
  });
  await t.test('padding is visible, updates live, links sides and preserves responsive values',async()=>{
    await open();await select('.hero');
    const top=page.getByRole('textbox',{name:'Padding top',exact:true});
    assert.equal(await top.isVisible(),true);
    const padding=()=>canvas().locator('.hero').evaluate(el=>['Top','Right','Bottom','Left'].map(side=>getComputedStyle(el)['padding'+side]));
    await top.fill('64');assert.deepEqual(await padding(),['64px','40px','40px','40px']);
    await top.fill('72');await top.press('Tab');
    assert.equal((await page.evaluate(()=>window.__PAGE_EDITOR.getHistory())).length,1);
    await undo();assert.deepEqual(await padding(),['40px','40px','40px','40px']);
    await page.getByRole('checkbox',{name:'Link sides'}).check();
    await top.fill('28');assert.deepEqual(await padding(),['28px','28px','28px','28px']);await top.press('Tab');
    await page.getByTitle('Mobile',{exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'Link sides'}).isChecked(),true);
    await page.getByRole('checkbox',{name:'Link sides'}).uncheck();
    await page.getByRole('textbox',{name:'Padding left',exact:true}).fill('12');await page.getByRole('textbox',{name:'Padding left',exact:true}).press('Tab');
    assert.deepEqual(await padding(),['28px','28px','28px','12px']);
    await page.getByTitle('Desktop',{exact:true}).click();assert.deepEqual(await padding(),['28px','28px','28px','28px']);
    await page.getByTitle('Mobile',{exact:true}).click();await page.getByRole('button',{name:'Reset padding left',exact:true}).click();assert.deepEqual(await padding(),['28px','28px','28px','28px']);
    await page.getByRole('textbox',{name:'Padding top',exact:true}).fill('-8');await page.getByRole('textbox',{name:'Padding top',exact:true}).press('Tab');assert.deepEqual(await padding(),['28px','28px','28px','28px']);
  });
  await t.test('section handle moves imported wrappers when dropped over child content, with undo and save',async()=>{
    await open('sections');await canvas().locator('#first h2').click();
    await page.getByRole('button',{name:'Edit section padding',exact:true}).click();
    assert.equal(await page.getByRole('textbox',{name:'Padding top',exact:true}).evaluate(el=>document.activeElement===el),true);
    const handle=await page.getByRole('button',{name:'Drag section',exact:true}).boundingBox();
    const target=await canvas().locator('#third p').boundingBox();
    const order=()=>canvas().locator('main').evaluate(el=>[...el.children].map(child=>child.id));
    await page.mouse.move(handle.x+20,handle.y+15);await page.mouse.down();await page.mouse.move(target.x+20,target.y+target.height-5,{steps:15});
    assert.equal(await page.locator('.insertion-line').isVisible(),true);await page.mouse.up();
    assert.deepEqual(await order(),['second-wrapper','third','first-wrapper']);
    assert.equal(await canvas().locator('#first-wrapper > #first').count(),1);
    assert.equal(await page.evaluate(()=>window.__PAGE_EDITOR.getModel().find(n=>n.id===window.__PAGE_EDITOR.getSelected()).type),'Section');
    assert.equal((await page.evaluate(()=>window.__PAGE_EDITOR.getHistory())).length,1);
    await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Saved');
    await undo();assert.deepEqual(await order(),['first-wrapper','second-wrapper','third']);
    await page.reload();await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length>0);assert.deepEqual(await order(),['second-wrapper','third','first-wrapper']);
  });
  await t.test('section background drags on the first gesture and Escape cancels a move',async()=>{
    await open('sections');
    const source=await canvas().locator('#first').boundingBox(),target=await canvas().locator('#second').boundingBox();
    await page.mouse.move(source.x+10,source.y+source.height-10);await page.mouse.down();await page.mouse.move(target.x+15,target.y+target.height-10,{steps:15});await page.mouse.up();
    assert.equal(await canvas().locator('main').evaluate(el=>el.children[1].id),'first-wrapper');await undo();
    await select('#first');const handle=await page.getByRole('button',{name:'Drag section',exact:true}).boundingBox();
    await page.mouse.move(handle.x+20,handle.y+15);await page.mouse.down();await page.mouse.move(target.x+15,target.y+target.height-10,{steps:15});await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await canvas().locator('main').evaluate(el=>el.firstElementChild.id),'first-wrapper');
    assert.equal((await page.evaluate(()=>window.__PAGE_EDITOR.getHistory())).length,0);
  });
  await t.test('insertion, product connection, unbinding and save/reload',async()=>{
    await open();await select('.price');await page.locator('#binding-product').selectOption('product-1');await page.locator('#bind-product').click();await page.waitForFunction(()=>document.getElementById('edit-frame').contentDocument.querySelector('.price').textContent==='$79.00');await page.locator('[data-action="unbind"]').click();assert.equal(await canvas().locator('.price').textContent(),'$49.00');
    await select('#buy');await page.locator('.canvas-insert').click();await page.locator('[data-insert="Button"]').click();assert.equal(await canvas().locator('[data-pb-native="Button"]').count(),1);await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Saved');await page.reload();await page.waitForFunction(()=>window.__PAGE_EDITOR?.getModel().length>0);assert.equal(await canvas().locator('[data-pb-native="Button"]').count(),1);assert.equal(runtimeErrors.length,0,runtimeErrors.join('\n'));
  });
  await t.test('a save cannot mark newer changes saved and preview does not publish',async()=>{
    await open();await select('h1');await page.locator('[data-content="text"]').fill('First change');await page.locator('[data-content="text"]').press('Tab');saveDelay=500;await page.locator('#save').click();await page.locator('#title').fill('Newer title');await page.waitForTimeout(700);assert.equal(await page.locator('#status').textContent(),'Unsaved changes');assert.notEqual(saved.title,'Newer title');await page.locator('#preview-draft').click();assert.equal(await page.locator('#preview-overlay').isVisible(),true);assert.equal(saved.status,'draft');
  });
  await page.locator('#close-preview').click();
  await t.test('Layers drag uses the same undoable move and hidden layers can be revealed',async()=>{
    await open();await select('#details h2');const headingId=await page.evaluate(()=>window.__PAGE_EDITOR.getSelected());const rowId=await canvas().locator('#details .row').getAttribute('data-pb-id');
    await page.locator('[data-node="'+headingId+'"]').dragTo(page.locator('[data-node="'+rowId+'"]'),{targetPosition:{x:60,y:35}});
    assert.equal(await canvas().locator('#details').evaluate(el=>el.firstElementChild.className),'row');await undo();assert.equal(await canvas().locator('#details').evaluate(el=>el.firstElementChild.tagName),'H2');
    await select('.hidden');await page.locator('[data-tab="design"]').click();await page.locator('[data-action="peek"]').click();assert.equal(await canvas().locator('.hidden').isVisible(),true);assert.doesNotMatch(await raw(),/data-pb-peek/);await page.locator('[data-action="peek"]').click();assert.equal(await canvas().locator('.hidden').isVisible(),false);
  });
  await t.test('canvas drag reorders siblings and undo restores the source',async()=>{
    await open();await select('#details h2');const handle=await page.locator('[data-move-handle]').boundingBox();const target=await canvas().locator('#details .row').boundingBox();
    await page.mouse.move(handle.x+10,handle.y+10);await page.mouse.down();await page.mouse.move(target.x+400,target.y+target.height-6,{steps:12});await page.mouse.up();
    assert.equal(await canvas().locator('#details').evaluate(el=>el.firstElementChild.className),'row');await undo();assert.equal(await canvas().locator('#details').evaluate(el=>el.firstElementChild.tagName),'H2');
  });
  await t.test('illegal canvas drops do not change the source',async()=>{
    await open();await select('.hero');const before=await raw();const handle=await page.locator('[data-move-handle]').boundingBox(),button=await canvas().locator('#buy').boundingBox();
    await page.mouse.move(handle.x+8,handle.y+8);await page.mouse.down();await page.mouse.move(button.x+button.width/2,button.y+button.height/2,{steps:10});await page.mouse.up();assert.equal(await raw(),before);
  });
  await t.test('shared style choice edits one or all matching layers in one undo',async()=>{
    await open();await select('.card');await page.locator('[data-tab="design"]').click();await page.locator('[data-style="color"]').fill('#aa1122');await page.locator('[data-style="color"]').press('Tab');assert.deepEqual(await canvas().locator('.card').evaluateAll(els=>els.map(el=>getComputedStyle(el).color)),['rgb(170, 17, 34)','rgb(51, 68, 85)']);
    await page.locator('#style-scope').selectOption('similar');await page.locator('[data-style="color"]').fill('#1133aa');await page.locator('[data-style="color"]').press('Tab');assert.deepEqual(await canvas().locator('.card').evaluateAll(els=>els.map(el=>getComputedStyle(el).color)),['rgb(17, 51, 170)','rgb(17, 51, 170)']);await undo();assert.deepEqual(await canvas().locator('.card').evaluateAll(els=>els.map(el=>getComputedStyle(el).color)),['rgb(170, 17, 34)','rgb(51, 68, 85)']);
  });
  await t.test('raw source saves immediately without waiting for the canvas refresh',async()=>{
    await open();await page.locator('[data-panel="source"]').click();await page.locator('#html').fill('<!doctype html><html><head><title>Changed</title></head><body><h1>Immediate source change</h1></body></html>');await page.locator('#save').click();await page.waitForFunction(()=>document.getElementById('status').textContent==='Saved');assert.match(saved.rawHtml,/Immediate source change/);assert.equal(await canvas().locator('h1').textContent(),'Immediate source change');
  });
  await t.test('saved sections carry scoped source styles and responsive layouts to another site',async()=>{
    await open();await select('.hero');
    await canvas().locator('body').evaluate(el=>{const style=el.ownerDocument.createElement('style');style.media='(max-width:600px)';style.textContent='.hero{padding:8px}';el.ownerDocument.head.appendChild(style);});
    const expected=await canvas().locator('h1').evaluate(el=>({size:getComputedStyle(el).fontSize,color:getComputedStyle(el).color}));
    page.once('dialog',dialog=>dialog.accept('Reusable imported hero'));await page.locator('[data-action="library"]').click();
    await page.waitForFunction(()=>document.querySelector('.library-section')?.textContent==='Reusable imported hero');
    const preview=await context.newPage();await preview.setViewportSize({width:1200,height:900});await preview.goto(origin+'/library-preview');
    assert.equal(await preview.locator('h1').evaluate(el=>getComputedStyle(el).fontSize),expected.size);
    assert.equal(await preview.locator('h1').evaluate(el=>getComputedStyle(el).color),expected.color);
    assert.equal(await preview.locator('#outside').evaluate(el=>getComputedStyle(el).color),'rgb(128, 0, 128)');
    assert.equal(await preview.locator('.hero').evaluate(el=>getComputedStyle(el).paddingTop),'40px','mobile-only stylesheet must stay inactive on desktop');
    await preview.setViewportSize({width:390,height:844});await page.getByTitle('Mobile',{exact:true}).click();
    assert.equal(await preview.locator('h1').evaluate(el=>getComputedStyle(el).fontSize),await canvas().locator('h1').evaluate(el=>getComputedStyle(el).fontSize));
    assert.equal(await preview.locator('.row').evaluate(el=>getComputedStyle(el).display),await canvas().locator('.hero .row').evaluate(el=>getComputedStyle(el).display));
    assert.equal(await preview.locator('.hero').evaluate(el=>getComputedStyle(el).paddingTop),'8px','stylesheet media attribute survives section reuse');
    await preview.close();
  });
  await t.test('a saved image retains styles outside its void element',async()=>{
    await open();await select('img');page.once('dialog',dialog=>dialog.accept('Reusable image'));await page.locator('[data-action="library"]').click();
    await page.waitForFunction(()=>document.querySelector('.library-section')?.textContent==='Reusable image');
    assert.match(savedPreset.settings.html,/<style>/);assert.match(savedPreset.settings.html,/data-pb-imported-section/);
    const preview=await context.newPage();await preview.goto(origin+'/library-preview');
    assert.equal(await preview.locator('img').evaluate(el=>getComputedStyle(el).height),'250px');await preview.close();
  });
  await t.test('saving a full page template includes current edits, page link and type',async()=>{
    await open();await select('h1');await page.locator('[data-content="text"]').fill('Save my latest page');
    await page.locator('[data-panel="page"]').click();await page.locator('#page-handle').fill('my-offer');await page.locator('#page-role').selectOption('offer');
    page.once('dialog',dialog=>dialog.accept('My offer template'));await page.locator('#save-page-template').click();
    await page.waitForFunction(()=>document.getElementById('status').textContent==='Page saved to template library');
    assert.match(savedTemplate.rawHtml,/Save my latest page/);assert.equal(savedTemplate.role,'offer');assert.equal(savedTemplate.handle,'my-offer');assert.equal(savedTemplate.name,'My offer template');
  });
  if(process.env.EDITOR_IMPORT_FIXTURE)await t.test('real imported page smoke test',async()=>{
    // HTML textarea values normalize CRLF/CR to LF before editing.
    const original=readFileSync(process.env.EDITOR_IMPORT_FIXTURE,'utf8').replace(/\r\n?/g,'\n');
    await open('real');assert.ok((await page.evaluate(()=>window.__PAGE_EDITOR.getModel().length))>100);assert.equal(await raw(),original);
    const id=await page.locator('#edit-frame').evaluate(el=>{const nodes=window.__PAGE_EDITOR.getModel().filter(n=>['Heading','Product title'].includes(n.type));const visible=nodes.filter(n=>{const node=el.contentDocument.querySelector('[data-pb-id="'+n.id+'"]');return node.closest('main')&&node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&node.getBoundingClientRect().width>0;});return visible.find(n=>el.contentDocument.querySelector('[data-pb-id="'+n.id+'"]').matches('h1'))?.id||visible[0]?.id;});assert.ok(id,'A visible main-content heading is recognized on the imported page');await canvas().locator('[data-pb-id="'+id+'"]').scrollIntoViewIfNeeded();await page.evaluate(id=>window.__PAGE_EDITOR.select(id),id);assert.ok(await page.locator('.inspector-tabs').isVisible());
    await page.getByRole('button',{name:'Edit section padding',exact:true}).click();
    const selectedId=await page.evaluate(()=>window.__PAGE_EDITOR.getSelected());
    await page.getByRole('textbox',{name:'Padding top',exact:true}).fill('56');
    assert.equal(await canvas().locator('[data-pb-id="'+selectedId+'"]').evaluate(el=>getComputedStyle(el).paddingTop),'56px');
    await page.getByRole('textbox',{name:'Padding top',exact:true}).press('Tab');await undo();
    assert.equal(await raw(),original);
    assert.equal(runtimeErrors.length,0,runtimeErrors.join('\n'));
    if(process.env.EDITOR_REAL_SCREENSHOT)await page.screenshot({path:process.env.EDITOR_REAL_SCREENSHOT});
  });

  if(process.env.EDITOR_SCREENSHOT){await open();await select('.hero');await page.screenshot({path:process.env.EDITOR_SCREENSHOT});}
  await context.close();
}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
