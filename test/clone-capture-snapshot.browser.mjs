import assert from 'node:assert/strict';
import test,{after} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';
const script=readFileSync(new URL('../src/pages/clone-capture.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(()=>browser.close());

test('empty responsive placeholders do not become page URLs in image variants',async()=>{
  const page=await browser.newPage();try{
    await page.setContent('<base href="https://fixture.example/page"><img id="empty" src=""><img id="spaces" src=" "><img id="missing">');
    const state=await page.evaluate(script);
    assert.ok(state.imageElements.every(image=>image.src===''));
    assert.ok(!state.declaredImageUrls.includes('https://fixture.example/page'));
  }finally{await page.close();}
});

test('snapshot retains CSSOM updates, adopted styles, blob images and exact responsive candidates',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:1000}});await page.route('**/*',route=>route.abort());
  try{
    await page.setContent('<base href="https://fixture.example/path/"><style id="changed">body{margin:0}</style><svg><style>.svg-art{fill:url(/svg-pattern.png)}</style><style></style></svg><div style=""></div><img id="blob" width="30" height="30"><img src="/desktop.png" srcset="/cdn/f_auto,q_auto/photo.png 1x, /large.png 2x" width="30" height="30"><div class="swiper" id="loop"></div><div class="swiper" id="plain"></div>');
    await page.evaluate(()=>{
      document.querySelector('#changed').sheet.insertRule('.inserted{background-image:url(/inserted.png)}');
      const adopted=new CSSStyleSheet();adopted.replaceSync('.adopted{color:blue}');document.adoptedStyleSheets=[adopted];
      const blob=new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"><rect width="30" height="30" fill="green"/></svg>'],{type:'image/svg+xml'});const img=document.querySelector('#blob');img.src=URL.createObjectURL(blob);img.dataset.src=img.src;
      document.querySelector('#loop').swiper={params:{loop:true}};document.querySelector('#plain').swiper={params:{loop:false}};
    });
    await page.locator('#blob').evaluate(img=>img.decode());await page.evaluate(script);await page.locator('#blob').evaluate(img=>img.decode());const state=await page.evaluate(script);
    assert.match(await page.locator('#changed').textContent(),/inserted\.png/);assert.match(await page.locator('style[data-copy-adopted]').textContent(),/color:\s*blue/);
    assert.match(await page.locator('#blob').getAttribute('src'),/^data:image\/svg\+xml;base64,/);assert.match(await page.locator('#blob').getAttribute('data-src'),/^data:image/);assert.equal(state.issues.some(issue=>/blob/.test(issue)),false);
    assert.ok(state.declaredImageUrls.includes('https://fixture.example/cdn/f_auto,q_auto/photo.png'));assert.ok(state.declaredImageUrls.includes('https://fixture.example/large.png'));assert.ok(state.declaredImageUrls.includes('https://fixture.example/inserted.png'));
    assert.ok(state.declaredImageUrls.includes('https://fixture.example/svg-pattern.png'));
    assert.equal(await page.locator('#loop').getAttribute('data-copy-gallery-loop'),'true');assert.equal(await page.locator('#plain').getAttribute('data-copy-gallery-loop'),null);
  }finally{await page.close();}
});

test('snapshot distinguishes hidden shadows, provider widgets, visible custom content and canvas omissions',async()=>{
  const page=await browser.newPage({viewport:{width:390,height:1000}});
  try{
    await page.setContent('<style>.widget{display:block;width:50px;height:30px}</style><div class="widget" id="hidden" hidden></div><shopify-payment-terms class="widget"></shopify-payment-terms><div class="widget" id="reviews"></div><canvas id="chart" width="100" height="60"></canvas><canvas id="hidden-chart" hidden></canvas>');
    await page.evaluate(()=>{document.querySelector('#hidden').style.display='none';for(const host of document.querySelectorAll('.widget'))host.attachShadow({mode:'open'}).innerHTML='<svg width="40" height="20"><rect width="40" height="20"/></svg>';});
    const state=await page.evaluate(script);assert.equal(state.shadowRoots,1);assert.deepEqual(state.shadowWidgets,[{host:'shopify-payment-terms',provider:true},{host:'div#reviews',provider:false}]);assert.ok(state.issues.some(issue=>issue.includes('canvas#chart')));assert.equal(state.issues.some(issue=>issue.includes('hidden-chart')),false);
  }finally{await page.close();}
});

test('snapshot serializes hydrated public choices and drops credential/payment field values',async()=>{
  const page=await browser.newPage();try{
    await page.setContent('<select><option value="CA" selected>Canada</option><option value="US">United States</option></select><input type="checkbox" checked><input type="password" value="fixture-secret"><input name="cardNumber" value="test-card-placeholder"><input name="csrf_token" value="fixture-token"><input name="id" value="source-variant">');
    await page.evaluate(()=>{document.querySelector('select').value='US';document.querySelector('[type=checkbox]').checked=false;});await page.evaluate(script);
    assert.equal(await page.locator('option[value=US]').getAttribute('selected'),'');assert.equal(await page.locator('option[value=CA]').getAttribute('selected'),null);assert.equal(await page.locator('[type=checkbox]').getAttribute('checked'),null);
    for(const selector of ['[type=password]','[name=cardNumber]','[name=csrf_token]'])assert.equal(await page.locator(selector).getAttribute('value'),null);assert.equal(await page.locator('[name=id]').getAttribute('value'),'source-variant');
  }finally{await page.close();}
});
