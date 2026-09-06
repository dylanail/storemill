import assert from 'node:assert/strict';
import test, {after} from 'node:test';
import {readFileSync,existsSync} from 'node:fs';
import {chromium} from 'playwright';

const runtime=readFileSync(new URL('../src/storefront/imported-commerce.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
after(()=>browser.close());
const picture='data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="20" height="20"%3E%3Crect width="20" height="20" fill="green"/%3E%3C/svg%3E';
async function load(html,scope='page',width=390){
  const context=await browser.newContext({viewport:{width,height:1000}});await context.route('**/*',route=>route.abort());const page=await context.newPage();
  await page.setContent(html);await page.evaluate(scope=>{window.__COPY_COMMERCE={scope,base:'/s/fixture',currency:'USD',minor:2,products:[]};},scope);await page.addScriptTag({content:runtime});return {context,page};
}

test('known source scroll sections reveal images without revealing dialogs or alternate content',async()=>{
  const {context,page}=await load(`<style>.animate-section.animate--hidden .animate-item{opacity:0;filter:blur(1px)}.animate-section.animate--shown .animate-item{opacity:1;filter:none}.alternate{opacity:0}</style><section class="animate-section animate--hidden"><div class="animate-item"><img id="section-image" src='${picture}'></div></section><aside hidden><img id="dialog-image" src='${picture}'></aside><img class="alternate" src='${picture}'>`);
  try{assert.equal(await page.locator('#section-image').evaluate(img=>getComputedStyle(img.parentElement).opacity),'1');assert.equal(await page.locator('#dialog-image').isVisible(),false);assert.equal(await page.locator('.alternate').evaluate(img=>getComputedStyle(img).opacity),'0');}finally{await context.close();}
});

test('imported section repairs stay inside saved sections',async()=>{
  const {context,page}=await load('<div id="native" class="animate-section animate--hidden"><div class="animate-item">Native animation</div></div><section data-pb-imported-section><div id="copied" class="animate-section animate--hidden"><div class="animate-item">Copied animation</div></div></section>','sections');
  try{assert.equal(await page.locator('#native').getAttribute('class'),'animate-section animate--hidden');assert.equal(await page.locator('#copied').getAttribute('class'),'animate-section animate--shown');}finally{await context.close();}
});

test('source mobile Splide cards size correctly and arrows, dots and dragging preserve the desktop grid',async()=>{
  const cards=Array.from({length:5},(_,i)=>`<li class="splide__slide"><div class="card"><p>Customer ${i+1}: I honestly forgot what it felt like to finish work without my lower back aching.</p></div></li>`).join('');
  const {context,page}=await load(`<style>*{box-sizing:border-box}body{margin:0}splide-component{display:block;width:100%}.splide__track{overflow:hidden}.splide__list{display:flex;margin:0;padding:0;list-style:none}.splide__slide{flex-shrink:0}.card{padding:20px}p{margin:0;font:16px/27px sans-serif}.splide__pagination{display:flex;gap:8px;list-style:none}.splide:not(.is-overflow) .splide__pagination{display:none}.splide__pagination button{width:24px;height:24px}button{min-height:44px}@media(min-width:750px){.splide__list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:40px}.splide__dots-and-arrows{display:none}}</style><splide-component data-type="slide" data-slides-mobile="1" data-gap-mobile="15" data-side-padding-mobile="15" data-destroy-desktop="true" data-dots-color="inverse"><div class="splide splide--destroy-desktop"><div class="splide__track"><ul class="splide__list">${cards}</ul></div></div></splide-component>`);
  try{
    assert.equal(await page.locator('.card p').first().evaluate(node=>node.getBoundingClientRect().width),320);assert.equal(await page.locator('.splide__slide').first().evaluate(node=>node.getBoundingClientRect().width),360);assert.equal(await page.getByRole('tab').count(),5);assert.equal(await page.locator('.splide__pagination').isVisible(),true);assert.equal(await page.locator('.splide').evaluate(node=>node.classList.contains('is-overflow')),true);
    await page.getByRole('button',{name:'Next slide',exact:true}).click();await page.waitForFunction(()=>Math.abs(document.querySelector('.splide__list').scrollLeft-375)<2);assert.equal(await page.getByRole('tab',{name:'Go to slide 2'}).getAttribute('aria-selected'),'true');
    await page.getByRole('tab',{name:'Go to slide 3'}).click();await page.waitForFunction(()=>Math.abs(document.querySelector('.splide__list').scrollLeft-750)<2);
    const box=await page.locator('.splide__list').boundingBox();await page.mouse.move(box.x+300,box.y+45);await page.mouse.down();await page.mouse.move(box.x+70,box.y+45,{steps:8});await page.mouse.up();await page.waitForFunction(()=>Math.abs(document.querySelector('.splide__list').scrollLeft-1125)<2);assert.equal(await page.getByRole('tab',{name:'Go to slide 4'}).getAttribute('aria-selected'),'true');
    await page.setViewportSize({width:820,height:1000});await page.waitForFunction(()=>getComputedStyle(document.querySelector('.splide__list')).display==='grid');assert.equal(await page.locator('.splide__slide').first().evaluate(node=>node.style.width),'');assert.equal(await page.locator('.splide__dots-and-arrows').isVisible(),false);
    await page.setViewportSize({width:390,height:1000});await page.waitForFunction(()=>document.querySelector('.card p').getBoundingClientRect().width===320);assert.equal(await page.locator('.splide__track').isVisible(),true);
  }finally{await context.close();}
});

test('source accordion shows one summary icon and follows native open state',async()=>{
  const {context,page}=await load('<style>.open-icon,.close-icon{display:flex;height:16px}</style><details class="fk-collapsible-list-details"><summary>Source question <span class="fk-collapsible-list-label-icon"><span class="open-icon">+</span><span class="close-icon">−</span></span></summary><p>Source answer</p></details><button class="close-icon" id="other-close">Unrelated close</button>');
  try{const icons=page.locator('.fk-collapsible-list-label-icon');assert.equal(await icons.locator('.open-icon').isVisible(),true);assert.equal(await icons.locator('.close-icon').isVisible(),false);await page.locator('summary').click();await page.waitForFunction(()=>document.querySelector('summary .open-icon').style.display==='none');assert.equal(await icons.locator('.close-icon').isVisible(),true);await page.locator('summary').click();await page.waitForFunction(()=>document.querySelector('summary .close-icon').style.display==='none');assert.equal(await page.locator('#other-close').isVisible(),true);}finally{await context.close();}
});

for(const width of [390,820,1440])test('source header reveals on upward scroll and back-to-top follows the 400px threshold at '+width+'px',async()=>{
  const {context,page}=await load('<style>body{margin:0}.ticker{height:50px}.section-header{position:sticky;z-index:2}sticky-header{display:block;height:148px;background:white}.shopify-section-header-sticky{top:0}.shopify-section-header-hidden{top:calc(-1 * var(--header-height))}.scroll-to-top-btn{display:flex;position:fixed;bottom:15px;right:15px;width:40px;height:40px}main{height:3000px}@media(max-width:749px){.ticker{height:55px}sticky-header{height:95px}}</style><sticky-group-manager><div class="ticker">Announcement</div><div class="section-header"><sticky-header data-sticky-type="on-scroll-up">Source header</sticky-header></div></sticky-group-manager><main>Page content</main><button class="scroll-to-top-btn" aria-label="Back to top" style="display:none">Top</button>','page',width);
  try{
    const section=page.locator('.section-header');assert.equal(await section.evaluate(node=>node.getBoundingClientRect().y),width===390?55:50);assert.equal(await page.getByRole('button',{name:'Back to top'}).isVisible(),false);
    await page.evaluate(()=>window.scrollTo(0,700));await page.waitForFunction(()=>document.querySelector('.section-header').classList.contains('shopify-section-header-hidden'));assert.equal(await section.evaluate(node=>node.getBoundingClientRect().y),width===390?-95:-148);assert.equal(await page.getByRole('button',{name:'Back to top'}).isVisible(),true);
    await page.evaluate(()=>window.scrollTo(0,600));await page.waitForFunction(()=>document.querySelector('.section-header').classList.contains('animate'));assert.equal(await section.evaluate(node=>node.getBoundingClientRect().y),0);
    await page.getByRole('button',{name:'Back to top'}).click();await page.waitForFunction(()=>window.scrollY===0);assert.equal(await section.evaluate(node=>node.getBoundingClientRect().y),width===390?55:50);assert.equal(await page.getByRole('button',{name:'Back to top'}).isVisible(),false);
    await page.evaluate(()=>window.scrollTo(0,400));await page.waitForFunction(()=>window.scrollY===400);assert.equal(await page.getByRole('button',{name:'Back to top'}).isVisible(),false);await page.evaluate(()=>window.scrollTo(0,401));await page.waitForFunction(()=>document.querySelector('.scroll-to-top-btn').style.display==='');
  }finally{await context.close();}
});

test('scriptless embedded review snapshots fit their images and resize in both directions',async()=>{
  const snapshot=`<style>body{margin:0}.reviews{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.review img{display:block;width:100%;height:120px}.review p{margin:0;padding:12px}@media(max-width:600px){.reviews{grid-template-columns:1fr}}</style><div class="reviews">${Array.from({length:4},()=>`<article class="review"><img src='${picture}'><p>Customer review photograph</p></article>`).join('')}</div>`;
  const attr=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const {context,page}=await load(`<style>body{margin:0}iframe{display:block;width:100%;border:0}</style><iframe id="reviews" data-copy-embedded sandbox="allow-same-origin" srcdoc="${attr(snapshot)}" style="height:1800px"></iframe><iframe id="unrelated" sandbox="allow-same-origin" srcdoc="<p>Unrelated frame</p>" style="height:177px"></iframe>`,'page',900);
  try{
    const frame=page.locator('#reviews');await page.waitForFunction(()=>document.querySelector('#reviews').getBoundingClientRect().height<500);const desktop=await frame.evaluate(frame=>frame.getBoundingClientRect().height);assert.ok(desktop>250);
    assert.equal(await frame.evaluate(frame=>[...frame.contentDocument.images].every(img=>img.naturalWidth>0)),true);
    await page.setViewportSize({width:390,height:1000});await page.waitForFunction(()=>document.querySelector('#reviews').getBoundingClientRect().height>600);const mobile=await frame.evaluate(frame=>frame.getBoundingClientRect().height);assert.ok(mobile>desktop*1.8);
    await frame.evaluate(frame=>{const list=frame.contentDocument.querySelector('.reviews');list.append(list.firstElementChild.cloneNode(true));});await page.waitForFunction(()=>document.querySelector('#reviews').getBoundingClientRect().height>800);
    await page.setViewportSize({width:900,height:1000});await page.waitForFunction(()=>document.querySelector('#reviews').getBoundingClientRect().height<600);assert.equal(await page.locator('#unrelated').evaluate(frame=>frame.style.height),'177px');
    assert.equal(await frame.evaluate(frame=>frame.contentDocument.documentElement.scrollHeight<=frame.clientHeight),true);
  }finally{await context.close();}
});

for(const width of [390,1440])test('source thumbnail controls keep their own scroll target at '+width+'px',async()=>{
  const slides=Array.from({length:9},(_,i)=>`<li class="slider__slide${i===0?' is-active':''}" data-media-id="media-${i}"><img alt="Image ${i+1}" src='${picture}'></li>`).join('');
  const thumbs=Array.from({length:9},(_,i)=>`<li class="slider__slide" data-target="media-${i}"><button aria-controls="GalleryViewer" aria-label="Load image ${i+1}">${i+1}</button></li>`).join('');
  const {context,page}=await load(`<style>body{margin:0}media-gallery{display:block;width:360px}.product__media-list,.thumbnail-list{display:flex;overflow:auto;list-style:none;padding:0;margin:0;gap:16px;scroll-snap-type:x mandatory}.product__media-list>.slider__slide{flex:0 0 360px;scroll-snap-align:start}.product__media-list img{width:100%;height:100px}.thumbnail-list{width:240px;gap:8px}.thumbnail-list>.slider__slide{flex:0 0 80px}button{min-height:44px}</style><media-gallery><slider-component id="GalleryViewer"><ul class="product__media-list">${slides}</ul><button name="next" aria-label="Next main image">Next</button></slider-component><slider-component id="GalleryThumbnails"><ul class="thumbnail-list">${thumbs}</ul><button name="next" data-step="3" aria-controls="GalleryThumbnails" aria-label="Next thumbnails">Next thumbnails</button><button name="previous" data-step="3" aria-controls="GalleryThumbnails" aria-label="Previous thumbnails">Previous thumbnails</button></slider-component></media-gallery>`,'page',width);
  try{
    await page.getByRole('button',{name:'Next thumbnails',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.thumbnail-list').scrollLeft>=260);assert.equal(await page.locator('.product__media-list').evaluate(list=>list.scrollLeft),0);
    await page.getByRole('button',{name:'Previous thumbnails',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.thumbnail-list').scrollLeft===0);assert.equal(await page.locator('#GalleryThumbnails').isVisible(),true);
    await page.getByRole('button',{name:'Load image 3',exact:true}).click();await page.waitForFunction(()=>Math.abs(document.querySelector('.product__media-list').scrollLeft-752)<2);
    await page.getByRole('button',{name:'Load image 1',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.product__media-list').scrollLeft===0);assert.equal(await page.locator('#GalleryViewer').isVisible(),true);
    await page.getByRole('button',{name:'Next main image',exact:true}).click();await page.waitForFunction(()=>Math.abs(document.querySelector('.product__media-list').scrollLeft-376)<2);assert.equal(await page.locator('.product__media-list .is-active').getAttribute('data-media-id'),'media-1');
  }finally{await context.close();}
});

test('captured looping gallery wraps and source order-summary disclosure remains operable',async()=>{
  const {context,page}=await load('<style>.swiper{width:300px;overflow:hidden}.swiper-wrapper{display:flex}.swiper-slide{flex:0 0 300px}</style><div class="swiper" data-copy-gallery-loop="true"><div class="swiper-wrapper"><div class="swiper-slide">First</div><div class="swiper-slide">Second</div></div><button class="swiper-button-prev">Previous</button></div><div class="cc-cart-toggle">Show order summary</div><div id="summary" class="cc-cart-toggle-target ordSummary" style="display:none">Source summary</div>');
  try{
    await page.getByRole('button',{name:'Previous',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.swiper-wrapper').scrollLeft>250);
    const toggle=page.getByRole('button',{name:'Show order summary',exact:true});await toggle.click();assert.equal(await page.locator('#summary').isVisible(),true);assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    await toggle.press('Enter');assert.equal(await page.locator('#summary').isVisible(),false);assert.equal(await toggle.getAttribute('aria-expanded'),'false');
  }finally{await context.close();}
});

for(const width of [390,1440])test('source main gallery uses arrows inside its thumbnail shell and fully selects the final image at '+width+'px',async()=>{
  const slides=Array.from({length:5},(_,i)=>`<div class="swiper-slide"><img alt="Photo ${i+1}" src='${picture}'></div>`).join('');
  const {context,page}=await load(`<style>body{margin:0}.product-gallery{width:min(609px,calc(100vw - 20px));margin:10px}.swiper{overflow:hidden;width:100%}.swiper-wrapper{display:flex}.swiper-slide{flex-shrink:0}.swiper-slide img{width:100%}.thumbImage img{height:30px!important}.swiper-button-next,.swiper-button-prev{display:inline-block;padding:12px}</style><div class="product-gallery"><div class="swiper mainImage" data-copy-gallery-loop="true"><div class="swiper-wrapper">${slides}</div></div><div class="swiper thumbImage"><div class="swiper-wrapper">${slides}</div><div class="swiper-button-prev" role="button" aria-label="Previous slide">Previous</div><div class="swiper-button-next" role="button" aria-label="Next slide">Next</div></div></div>`,'page',width);
  try{
    const selected=async index=>page.waitForFunction(i=>{const list=document.querySelector('.mainImage .swiper-wrapper'),slide=list.children[i];return Math.abs(list.scrollLeft-(slide.offsetLeft-list.children[0].offsetLeft))<2;},index);
    for(let i=1;i<5;i++){await page.getByRole('button',{name:'Next slide',exact:true}).click();await selected(i);}
    const final=await page.locator('.mainImage .swiper-slide:not([data-copy-gallery-continuation])').last().boundingBox(),main=await page.locator('.mainImage').boundingBox();assert.ok(final.x>=main.x-2&&final.x+final.width<=main.x+main.width+2);
    if(width===390){const peek=await page.locator('[data-copy-gallery-continuation] img').boundingBox();assert.ok(peek.x>final.x+final.width&&peek.x<main.x+main.width);assert.ok(Math.abs(peek.width-final.width)<2);assert.equal(await page.locator('[data-copy-gallery-continuation]').evaluate(node=>node.inert),true);}
    assert.equal(await page.locator('.thumbImage .swiper-wrapper').evaluate(list=>list.scrollLeft),0);
    await page.getByRole('button',{name:'Next slide',exact:true}).click();await selected(0);await page.getByRole('button',{name:'Previous slide',exact:true}).press('Enter');await selected(4);
    if(width===390){const session=await context.newCDPSession(page);const swipe=async()=>{const b=await page.locator('.mainImage').boundingBox(),y=b.y+60;await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:b.x+290,y}]});for(const x of [250,210,170,120,65])await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x+x,y}]});await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});};await swipe();await selected(0);for(let i=1;i<5;i++){await swipe();await selected(i);}await session.detach();}
  }finally{await context.close();}
});

for(const width of [1440,820,390])test('Loox list snapshots retain measured card margins, spacing and bottom padding at '+width+'px',async()=>{
  const desktop=[150,263,263,263,150],tablet=[150,226.703125,227.34375,227.34375,150],mobile=[198,222,214.53125,246,198];
  const sizes=(heights)=>heights.map((height,i)=>`.grid-item-wrap:nth-of-type(${i+1}){--card-height:${height-14}px}`).join('');
  const snapshot=`<style>*{box-sizing:border-box}body{margin:0}.grid-wrap.list #grid{position:relative;padding-bottom:20px;height:1109px}.grid-item-wrap{float:left;width:100%;position:absolute;left:0}.grid-item{height:var(--card-height);margin:7px;border:1px solid;display:flex}.grid-item img{width:20px;height:20px}${sizes(desktop)}@media(max-width:1024px){${sizes(tablet)}}@media(max-width:600px){${sizes(mobile)}}</style><style data-copy-review-flow>.grid-wrap.list #grid{height:auto!important;display:flow-root}.grid-wrap.list #grid>.grid-item-wrap{position:relative!important;top:auto!important;left:auto!important;float:none!important}</style><div class="grid-wrap list"><div id="grid">${desktop.map((_h,i)=>`<div class="grid-item-wrap ${i===0?'no-img':'has-img'}" style="top:${[0,150,413,676,939][i]}px;transform:translate3d(0,${[0,-48,-7,41.46875,58.46875][i]}px,0);transition:top .4s,transform .4s"><div class="grid-item">Review ${i+1}${i?`<img src='${picture}' alt="Customer ${i}">`:''}</div></div>`).join('')}</div></div>`;
  const attr=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
  const {context,page}=await load(`<style>body{margin:0}iframe{width:100%;border:0;display:block}</style><iframe id="looxReviewsFrame" data-copy-embedded sandbox="allow-same-origin" srcdoc="${attr(snapshot)}"></iframe>`,'page',width);
  try{
    const expected=width===1440?desktop:width===820?tablet:mobile,frame=page.locator('#looxReviewsFrame');
    await page.waitForFunction(()=>{const f=document.querySelector('#looxReviewsFrame'),d=f.contentDocument;return d?.URL==='about:srcdoc'&&!d.querySelector('[data-copy-review-flow]')&&f.clientHeight>900;});
    const geometry=()=>frame.evaluate(frame=>{const d=frame.contentDocument,g=d.querySelector('#grid'),r=g.getBoundingClientRect();return {height:r.height,images:[...d.images].filter(i=>i.naturalWidth>0).length,cards:[...g.children].map(w=>{const box=w.getBoundingClientRect(),card=w.firstElementChild.getBoundingClientRect();return {top:box.y-r.y,height:box.height,cardTop:card.y-r.y,cardBottom:card.bottom-r.y}})};});
    const found=await geometry();let top=0;for(let i=0;i<expected.length;i++){assert.ok(Math.abs(found.cards[i].top-top)<.04);assert.ok(Math.abs(found.cards[i].height-expected[i])<.04);if(i)assert.ok(found.cards[i].cardTop>=found.cards[i-1].cardBottom+13.9);top+=expected[i];}assert.ok(Math.abs(found.height-top-20)<.04);assert.equal(found.images,4);
    const other=width===390?1440:390,otherSizes=other===390?mobile:desktop;await page.setViewportSize({width:other,height:1000});await page.waitForFunction(sum=>Math.abs(document.querySelector('#looxReviewsFrame').contentDocument.querySelector('#grid').getBoundingClientRect().height-sum)<.04,otherSizes.reduce((sum,n)=>sum+n,20));
    const resized=await geometry();assert.ok(resized.cards.every((card,i)=>i===0||card.cardTop>=resized.cards[i-1].cardBottom+13.9));
  }finally{await context.close();}
});
