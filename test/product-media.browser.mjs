import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright';
import {productGallerySource} from '../src/pages/product-gallery-runtime.ts';

test('editor gallery extraction keeps full source files and long galleries retain their last slide',async()=>{
 const browser=await chromium.launch({headless:true,...(existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')?{executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}:{})});
 try{
  const page=await browser.newPage({viewport:{width:1200,height:900}});await page.route('**/*',route=>route.abort());
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setContent(`<style>.product-gallery{width:600px}.swiper-wrapper{display:flex}.swiper-slide{width:600px;flex:none}</style><div class="product-gallery"><div class="swiper_main"><div class="swiper-wrapper">
   <div class="swiper-slide swiper-slide-duplicate"><img src="/duplicate.jpg"></div>
   <div class="swiper-slide"><a href="/original-1.jpg"><img src="/thumb-1.jpg" alt="Front"></a></div>
   <div class="swiper-slide"><picture><source media="(max-width:600px)" srcset="/mobile-crop.jpg 3000w"><img src="/thumb-2.jpg" srcset="/medium.jpg 600w, /original-2.jpg 2000w" alt="Back"></picture></div>
   <div class="swiper-slide"><img src="/video-preview.jpg"><video poster="/poster.jpg"><source src="/original.mp4" type="video/mp4"></video></div>
   </div></div><div class="swiper_thumbs"><div class="swiper-wrapper"><div><img src="/thumb-1.jpg"></div></div></div></div>`);
  await page.addScriptTag({content:productGallerySource});
  const items=await page.evaluate(()=>productGalleries(document).read(document.querySelector('.product-gallery')));
  assert.deepEqual(items.map(item=>item.url),['/original-1.jpg','/original-2.jpg','/original.mp4']);
  assert.equal(items[2].kind,'video');assert.equal(items[2].poster,'/poster.jpg');
  const rendered=await page.evaluate(()=>{
   const engine=productGalleries(document),root=document.querySelector('.product-gallery');
   const items=Array.from({length:120},(_,i)=>({url:'/original-'+i+'.jpg',alt:'Slide '+i}));
   const view=engine.render(root,{mode:'custom',items,settings:{loop:false}});view.select(119);
   return {count:root.querySelectorAll('[data-pg-slide]').length,last:root.querySelector('[data-pg-slide="119"] img')?.getAttribute('src'),selected:root.querySelector('[aria-current=true]')?.getAttribute('data-pg-thumb'),saved:engine.config(root).items.length};
  });
  assert.deepEqual(rendered,{count:120,last:'/original-119.jpg',selected:'119',saved:120});
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
