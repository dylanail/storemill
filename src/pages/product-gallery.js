/* Shared by the script-free editor projection and the published storefront.
 * The imported shells remain in place; only slide media and controls change. */
export function productGalleries(doc) {
  const configAttr='data-pb-gallery',instances=new WeakMap();
  const all=(selector,root=doc)=>[...root.querySelectorAll(selector)];
  const safe=url=>typeof url==='string'&&/^(https?:\/\/|\/(?!\/)|data:image\/)/i.test(url)&&!/[<>\u0000-\u001f]/.test(url);
  const kind=item=>item.kind||(/\.(mp4|webm|mov)([?#]|$)/i.test(item.url)?'video':'image');
  function parts(root){
    const main=root.querySelector('[data-pg-track],.swiper_main > .swiper-wrapper,.mainImage > .swiper-wrapper,.product__media-list,.splide__list')||root.querySelector('.swiper-wrapper');
    const thumbs=root.querySelector('[data-pg-thumbs],.swiper_thumbs > .swiper-wrapper,.thumbImage > .swiper-wrapper,.thumbnail-list,.gal-thumbs');
    return {main,thumbs,hero:root.querySelector('.gal-main')};
  }
  function roots(){
    const candidates=all('['+configAttr+'],.product-gallery,media-gallery,[data-gallery],.swiper_main,.mainImage');
    return [...new Set(candidates.map(el=>{
      if(el.matches('.swiper_main,.mainImage')){
        const known=el.closest('['+configAttr+'],.product-gallery,media-gallery');if(known)return known;
        let parent=el.parentElement;
        for(let i=0;parent&&parent!==doc.body&&i<3;i++,parent=parent.parentElement)if(parent.querySelector('.swiper_thumbs,.thumbImage'))return parent;
      }return el;
    }))].filter(el=>!el.parentElement?.closest('['+configAttr+'],.product-gallery,media-gallery,[data-gallery]')&&(parts(el).main||parts(el).hero));
  }
  function read(root){
    const {main,thumbs,hero}=parts(root),nodes=main?[...main.children].filter(el=>!el.matches('[data-copy-gallery-continuation],.swiper-slide-duplicate')):thumbs?[...thumbs.children]:hero?[hero]:[];
    return nodes.map(node=>{
      const media=node.matches('img,video')?node:node.querySelector('video')||node.querySelector('img');
      const attributes=el=>Object.fromEntries([...(el?.attributes||[])].map(a=>[a.name,a.value]));
      const link=media?.closest('a[href]')?.getAttribute('href')||'';
      const sources=[...(media?.localName==='video'?media:media?.closest('picture'))?.querySelectorAll('source')||[]].map(attributes);
      const url=originalMediaSource({...attributes(media),...(/\.(avif|gif|jpe?g|png|webp)([?#]|$)/i.test(link)?{'data-full':link}:{})},sources,media?.localName==='video'?'video':'image')||node.getAttribute('data-src')||'';
      return {url,alt:media?.getAttribute('alt')||media?.getAttribute('aria-label')||'',kind:media?.localName==='video'?'video':'image',...(media?.getAttribute('poster')?{poster:media.getAttribute('poster')}:{})};
    }).filter(item=>safe(item.url));
  }
  function config(root){try{return JSON.parse(root.getAttribute(configAttr)||'null');}catch{return null;}}
  function cleanClone(node){
    const clone=node.cloneNode(true);
    for(const el of [clone,...all('*',clone)]){
      for(const attr of [...el.attributes])if(attr.name==='id'||attr.name==='data-pb-id'||attr.name.startsWith('on')||attr.name.startsWith('data-copy-'))el.removeAttribute(attr.name);
      el.removeAttribute('aria-controls');el.removeAttribute('aria-describedby');
    }
    clone.classList.remove('swiper-slide-duplicate','swiper-slide-active','swiper-slide-next','swiper-slide-prev');return clone;
  }
  function template(root,name,node){
    let holder=root.querySelector('template[data-pg-template="'+name+'"]');
    if(!holder){holder=doc.createElement('template');holder.dataset.pgTemplate=name;holder.content.append(cleanClone(node));root.append(holder);}
    return holder.content.firstElementChild;
  }
  function makeSlide(base,item,index,thumb){
    let slide=cleanClone(base),old=slide.matches('img,video')?slide:slide.querySelector('img,video');
    const media=doc.createElement(!thumb&&kind(item)==='video'?'video':'img');
    if(old)for(const a of old.attributes)if(['class','style','width','height'].includes(a.name))media.setAttribute(a.name,a.value);
    if(media.localName==='video'){media.controls=true;media.playsInline=true;media.preload='metadata';if(item.poster&&safe(item.poster))media.poster=item.poster;media.setAttribute('aria-label',item.alt||'Product video '+(index+1));}
    else {media.alt=thumb?'':item.alt||'';media.loading=index===0&&!thumb?'eager':'lazy';media.decoding='async';}
    media.src=thumb&&kind(item)==='video'?(item.poster||'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="80"%3E%3Crect width="80" height="80" fill="%23ddd"/%3E%3Cpath d="M30 20L60 40L30 60Z"/%3E%3C/svg%3E'):item.url;
    if(old===slide)slide=media;else if(old){const picture=old.closest('picture');if(picture)picture.replaceWith(media);else old.replaceWith(media);}else slide.append(media);
    all('source',slide).forEach(el=>el.remove());all('a',slide).forEach(el=>{el.removeAttribute('href');el.removeAttribute('target');});
    for(const el of [slide,...all('*',slide)]){el.removeAttribute('data-src');el.removeAttribute('data-srcset');el.removeAttribute('srcset');}
    if(thumb){slide.dataset.pgThumb=String(index);slide.setAttribute('role','button');slide.tabIndex=0;slide.setAttribute('aria-label','Show '+(item.alt||'slide '+(index+1)));if(slide.matches('button'))slide.type='button';}
    else {slide.dataset.pgSlide=String(index);slide.setAttribute('role','group');slide.setAttribute('aria-label',(index+1)+' of ');}
    return slide;
  }
  function ensureStyle(){
    if(doc.querySelector('style[data-pg-style]'))return;
    const sheet=doc.createElement('style');sheet.dataset.pgStyle='';sheet.textContent=`
[data-pb-gallery]{min-width:0;--pg-fit:contain;--pg-ratio:auto;--pg-gap:8px;--pg-thumb:72px}
[data-pg-track]{display:flex!important;transform:none!important;transition:none!important;overflow-x:auto!important;scroll-snap-type:x mandatory;scrollbar-width:none;width:100%!important;max-width:100%!important;height:auto!important;gap:0!important;touch-action:pan-x pan-y}
[data-pg-track]::-webkit-scrollbar{display:none}
[data-pg-track]>[data-pg-slide]{display:block!important;flex:0 0 100%!important;width:100%!important;max-width:100%!important;height:auto!important;margin:0!important;scroll-snap-align:start;box-sizing:border-box}
[data-pg-slide] img,[data-pg-slide] video{display:block;width:100%!important;max-width:100%!important;height:auto!important;object-fit:var(--pg-fit)!important;aspect-ratio:var(--pg-ratio)!important}
[data-pg-thumbs]{display:flex!important;transform:none!important;overflow-x:auto!important;gap:var(--pg-gap)!important;width:100%!important;height:auto!important;max-width:100%!important;margin-top:var(--pg-gap);padding:3px;box-sizing:border-box}
[data-pg-thumb]{flex:0 0 var(--pg-thumb)!important;width:var(--pg-thumb)!important;max-width:var(--pg-thumb)!important;margin:0!important;cursor:pointer;box-sizing:border-box}
[data-pg-thumb] img{display:block;max-width:100%!important;width:100%!important;height:auto!important;aspect-ratio:1;object-fit:contain}
[data-pg-thumb][aria-current=true]{outline:2px solid currentColor;outline-offset:1px}
[data-pg-prev],[data-pg-next]{cursor:pointer}[data-pg-prev][aria-disabled=true],[data-pg-next][aria-disabled=true]{opacity:.35;pointer-events:none}
[data-pb-gallery] [data-pg-hidden]{display:none!important}
[data-pg-controls]{display:flex;justify-content:space-between;gap:8px;margin-top:8px}[data-pg-controls] button{border:1px solid #ddd;border-radius:50%;width:36px;height:36px;display:grid;place-items:center;background:white;color:black;font:20px sans-serif;padding:0}
`;doc.head.append(sheet);
  }
  function render(root,input,items=input.items||[]){
    instances.get(root)?.abort();const controller=new doc.defaultView.AbortController();instances.set(root,controller);const signal=controller.signal;
    const config={...input,items:items.filter(item=>safe(item.url))},settings=config.settings||{};
    root.setAttribute(configAttr,JSON.stringify(config));ensureStyle();
    let {main,thumbs,hero}=parts(root);
    if(!main){main=doc.createElement('div');if(hero){const slide=doc.createElement('div');hero.replaceWith(main);slide.append(hero);main.append(slide);}else root.prepend(main);}
    let base=main.children[0]||doc.createElement('div');base=template(root,'slide',base);
    main.dataset.pgTrack='';main.parentElement.style.setProperty('min-width','0');
    main.replaceChildren(...config.items.map((item,i)=>makeSlide(base,item,i,false)));
    if(!thumbs){thumbs=doc.createElement('div');if(main.parentElement===root)main.after(thumbs);else main.parentElement.after(thumbs);}
    const thumbBase=template(root,'thumb',thumbs.children[0]||doc.createElement('button'));thumbs.dataset.pgThumbs='';
    thumbs.replaceChildren(...config.items.map((item,i)=>makeSlide(thumbBase,item,i,true)));
    thumbs.toggleAttribute('data-pg-hidden',settings.thumbnails===false||config.items.length<2);
    root.style.setProperty('--pg-fit',settings.fit==='cover'?'cover':'contain');
    root.style.setProperty('--pg-ratio',{'square':'1','portrait':'4/5','landscape':'16/9'}[settings.ratio]||'auto');
    root.style.setProperty('--pg-gap',Math.max(0,Math.min(32,Number(settings.gap??8)))+'px');root.style.setProperty('--pg-thumb',Math.max(40,Math.min(160,Number(settings.thumbnailSize??72)))+'px');
    let prev=all('[data-pg-prev],.swiper-button-prev,button[name=previous],.slider-button--prev,.splide__arrow--prev',root),next=all('[data-pg-next],.swiper-button-next,button[name=next],.slider-button--next,.splide__arrow--next',root);
    if(!prev.length||!next.length){const controls=doc.createElement('div');controls.dataset.pgControls='';for(const [direction,label,symbol] of [['prev','Previous slide','‹'],['next','Next slide','›']]){const button=doc.createElement('button');button.type='button';button.setAttribute('data-pg-'+direction,'');button.setAttribute('aria-label',label);button.textContent=symbol;controls.append(button);}root.append(controls);prev=all('[data-pg-prev]',root);next=all('[data-pg-next]',root);}
    const slides=[...main.children],buttons=[...thumbs.children];let index=0;
    const update=()=>{
      slides.forEach((slide,i)=>{slide.classList.toggle('swiper-slide-active',i===index);slide.setAttribute('aria-label',(i+1)+' of '+slides.length);if(i!==index)all('video',slide).forEach(video=>video.pause());});
      buttons.forEach((button,i)=>{button.setAttribute('aria-current',String(i===index));button.classList.toggle('swiper-slide-thumb-active',i===index);button.classList.toggle('on',i===index);});
      for(const [nodes,disabled] of [[prev,index===0],[next,index>=slides.length-1]])nodes.forEach(node=>{const off=slides.length<2||(!settings.loop&&disabled);node.setAttribute('aria-disabled',String(off));node.classList.toggle('swiper-button-disabled',off);if(node.matches('button'))node.disabled=off;});
      all('.slider-counter--current',root).forEach(el=>el.textContent=String(slides.length?index+1:0));all('.slider-counter--total',root).forEach(el=>el.textContent=String(slides.length));
    };
    const offset=i=>slides[i]?slides[i].offsetLeft-slides[0].offsetLeft:0;
    const select=i=>{if(!slides.length)return;index=settings.loop?(i+slides.length)%slides.length:Math.max(0,Math.min(slides.length-1,i));main.scrollTo({left:offset(index),behavior:'instant'});update();};
    for(const [nodes,step,name] of [[prev,-1,'prev'],[next,1,'next']])nodes.forEach(node=>{node.setAttribute('data-pg-'+name,'');node.toggleAttribute('data-pg-hidden',settings.arrows===false||slides.length<2);node.setAttribute('role','button');node.tabIndex=0;if(node.matches('button'))node.type='button';node.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();select(index+step);},{signal});node.addEventListener('keydown',e=>{if(!node.matches('button')&&['Enter',' '].includes(e.key)){e.preventDefault();select(index+step);}},{signal});});
    buttons.forEach((button,i)=>{button.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();select(i);},{signal});button.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();select(e.key==='Home'?0:e.key==='End'?slides.length-1:index+(e.key==='ArrowRight'?1:-1));buttons[index]?.focus({preventScroll:true});}else if(!button.matches('button')&&['Enter',' '].includes(e.key)){e.preventDefault();select(i);}},{signal});});
    let touch=null;main.style.touchAction='pan-y';
    main.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch'||event.target.closest('video'))return;touch={pointer:event.pointerId,x:event.clientX,y:event.clientY,index,left:main.scrollLeft};main.setPointerCapture(event.pointerId);main.style.scrollSnapType='none';},{signal});
    main.addEventListener('pointermove',event=>{if(touch&&Math.abs(event.clientX-touch.x)>Math.abs(event.clientY-touch.y)){event.preventDefault();main.scrollLeft=touch.left+touch.x-event.clientX;}},{signal});
    main.addEventListener('pointerup',event=>{if(!touch)return;const start=touch;touch=null;main.style.scrollSnapType='x mandatory';const dx=start.x-event.clientX,dy=start.y-event.clientY;select(start.index+(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy)?Math.sign(dx):0));},{signal});
    main.addEventListener('pointercancel',()=>{touch=null;main.style.scrollSnapType='x mandatory';},{signal});
    main.addEventListener('scroll',()=>{if(!slides.length)return;index=slides.reduce((best,_slide,i)=>Math.abs(offset(i)-main.scrollLeft)<Math.abs(offset(best)-main.scrollLeft)?i:best,0);update();},{signal,passive:true});
    all('.swiper-pagination,.slider-counter__link--dots,.splide__pagination',root).forEach(el=>el.setAttribute('data-pg-hidden',''));
    root.querySelector('[data-pg-empty]')?.remove();if(!slides.length){const empty=doc.createElement('p');empty.dataset.pgEmpty='';empty.textContent='No product media';root.append(empty);}
    select(0);return {select,items:config.items};
  }
  async function start(fetchProduct){
    const cache=new Map();
    await Promise.all(all('['+configAttr+']').map(async root=>{
      const c=config(root);if(!c)return;
      render(root,c);
      if(c.mode==='product'&&c.productId){try{if(!cache.has(c.productId))cache.set(c.productId,fetchProduct(c.productId));const p=await cache.get(c.productId);if(p&&root.isConnected&&JSON.stringify(config(root))===JSON.stringify(c))render(root,c,p.media||[]);}catch{/* Retain the saved gallery if catalog access fails. */}}
    }));
  }
  return {roots,parts,read,config,render,start};
}
