  function setupCanvasState(freeze) {
    document.querySelector('.canvas-state')?.remove();
    const options=[];
    if(doc.querySelector('.khOneOffer')&&doc.querySelector('.khSubOffer'))options.push({kind:'offers',label:'Purchase options',items:['One time purchase','Subscription'],value:doc.querySelector('.subOfferButton.activeOfferType')?1:0,active:(()=>{const s=computed(doc.querySelector('.oneOfferButton.activeOfferType,.subOfferButton.activeOfferType')||doc.querySelector('.oneOfferButton'));return {backgroundColor:s.backgroundColor,color:s.color};})(),inactive:(()=>{const s=computed(doc.querySelector('.oneOfferButton:not(.activeOfferType),.subOfferButton:not(.activeOfferType)')||doc.querySelector('.subOfferButton'));return {backgroundColor:s.backgroundColor,color:s.color};})()});
    const galleries=[...doc.querySelectorAll('.product-gallery .mainImage')].filter(el=>!el.closest('[data-pb-gallery]'));
    const sheets=[];
    // Source sliders depend on JavaScript widths. Their editor projection uses
    // one full image, with each slide available from a canvas-only selector.
    galleries.forEach((gallery,index)=>{
      const slides=[...gallery.querySelectorAll(':scope > .swiper-wrapper > .swiper-slide')];
      if(slides.length<2||!gallery.id)return;
      options.push({kind:'gallery',label:galleries.length>1?'Gallery '+(index+1):'Image',gallery,slides,items:slides.map((slide,i)=>'Image '+(i+1)),value:Math.max(0,slides.findIndex(slide=>slide.classList.contains('swiper-slide-active')))});
    });
    if(!options.length)return;
    const bar=document.createElement('div');bar.className='canvas-state';
    const update=()=>{
      const rules=[];
      options.forEach(option=>{
        if(option.kind==='offers'){
          const selected=option.value===1?'.subOfferButton':'.oneOfferButton',other=option.value===1?'.oneOfferButton':'.subOfferButton';
          rules.push((option.value===1?'.khOneOffer':'.khSubOffer')+':not([data-pb-peek]){display:none!important}');
          rules.push(selected+'{background-color:'+option.active.backgroundColor+'!important;color:'+option.active.color+'!important}'+other+'{background-color:'+option.inactive.backgroundColor+'!important;color:'+option.inactive.color+'!important}');
          rules.push(option.value===0?'.subDetailsBox:not([data-pb-peek]){display:none!important}':'.subDetailsBox .subDetails:not(:first-child):not([data-pb-peek]){display:none!important}');
        }
        else{
          const scope='#'+CSS.escape(option.gallery.id);
          rules.push(scope+'{max-width:100%!important;overflow:hidden!important}'+scope+' > .swiper-wrapper{display:block!important;width:100%!important;height:auto!important;transform:none!important}'+scope+' > .swiper-wrapper > .swiper-slide{width:100%!important;height:auto!important;margin:0!important}'+scope+' > .swiper-wrapper > .swiper-slide:not(:nth-child('+(option.value+1)+')):not([data-pb-peek]){display:none!important}'+scope+' > .swiper-wrapper > .swiper-slide img{width:100%!important;height:auto!important;object-fit:contain!important}');
        }
      });
      let sheet=doc.querySelector('style[data-pb-canvas-state]');if(!sheet){sheet=doc.createElement('style');sheet.setAttribute(TEMP,'1');sheet.setAttribute('data-pb-canvas-state','');doc.head.appendChild(sheet);}sheet.textContent=rules.join('\n');draw();
    };
    options.forEach(option=>{
      const label=document.createElement('label'),select=document.createElement('select');select.setAttribute('aria-label','Editor '+option.label.toLowerCase());
      option.items.forEach((text,index)=>{const choice=document.createElement('option');choice.value=String(index);choice.textContent=text;select.appendChild(choice);});select.value=String(option.value);select.onchange=()=>{option.value=Number(select.value);update();};label.appendChild(select);bar.appendChild(label);
    });
    document.querySelector('.canvas-head').insertBefore(bar,$('canvas-scale'));update();
  }
