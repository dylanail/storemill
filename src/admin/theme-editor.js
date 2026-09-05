(() => {
  const config=window.__THEME_EDITOR,form=document.getElementById('theme-form'),frame=document.getElementById('designer-preview'),dialog=document.getElementById('theme-font-dialog');
  const colorKeys=['paper','ink','surface','primary','buttonText','secondary','border'];
  let source=config.source||{},fontRole='display',width=1200,timer,initialized=false,version='draft';
  const input=name=>form.elements.namedItem(name);
  const values=()=>Object.fromEntries([...form.elements].filter(el=>el.name).map(el=>[el.name,el.value]));
  const dirty=()=>{document.getElementById('theme-save-state').textContent='Unsaved changes';};
  function samples(){
    for(const key of colorKeys){const value=input(key).value;if(/^#[\da-f]{6}$/i.test(value)){document.querySelector('.theme-scheme-card').style.setProperty('--sample-'+key,value);form.querySelector('[data-color="'+key+'"]').value=value;}}
    for(const role of ['display','body']){
      const font=input(role+'Font').value,weight=input(role+'Weight').value,node=form.querySelector('[data-font-sample="'+role+'"]');
      node.style.fontFamily=JSON.stringify(font)+', sans-serif';node.style.fontWeight=weight;form.querySelector('[data-font-name="'+role+'"]').textContent=font;
    }
  }
  function preview(){
    samples();if(version==='live')return;try{const doc=frame.contentDocument;if(!doc?.body)return;applySourceTheme(doc,{...values(),sourceTheme:source,themeCustomized:true},{force:true,fontDocument:document});}catch{}
  }
  function fit(){
    const stage=frame.closest('.theme-preview-stage'),shell=document.getElementById('theme-frame-shell'),s=getComputedStyle(stage),available=stage.clientWidth-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight),scale=Math.min(1,available/width);
    shell.style.width=Math.min(width,available)+'px';Object.assign(frame.style,{width:width+'px',height:(shell.clientHeight/scale)+'px',transform:'scale('+scale+')'});
  }
  frame.addEventListener('load',()=>{
    fit();try{
      const doc=frame.contentDocument;
      if(!initialized){
        if(config.imported){
          source=Object.keys(source).length?source:readSourceTheme(doc);input('sourceTheme').value=JSON.stringify(source);
          if(!config.brand.themeCustomized){for(const [key,value] of Object.entries(source)){if(input(key))input(key).value=String(value);}document.getElementById('theme-source-label').textContent='Colors detected from your site';}
          for(const role of ['display','body']){const font=source[role+'Font'];if(font&&!config.fonts.includes(font)){config.fonts.unshift(font);config.importedFonts.push(font);}}
        }else source=readSourceTheme(doc);
        initialized=true;
      }
      // Use the source's actual font files in the picker, including private fonts.
      const faces=[...doc.querySelectorAll('style')].flatMap(node=>[...node.textContent.matchAll(/@font-face\s*\{[^{}]*\}/gi)].map(m=>m[0])).join('\n');
      let fonts=document.getElementById('theme-picker-faces');if(!fonts){fonts=document.createElement('style');fonts.id='theme-picker-faces';document.head.appendChild(fonts);}fonts.textContent=faces;
      preview();
    }catch{document.getElementById('theme-preview-status').textContent='Open preview';}
  });
  form.addEventListener('input',event=>{
    const key=event.target.dataset.color;if(key)input(key).value=event.target.value;
    dirty();samples();clearTimeout(timer);timer=setTimeout(preview,90);
  });
  form.addEventListener('change',()=>{dirty();preview();});
  form.addEventListener('submit',()=>{input('sourceTheme').value=JSON.stringify(source);});
  document.getElementById('theme-source-colors')?.addEventListener('click',()=>{for(const key of colorKeys)if(source[key])input(key).value=source[key];dirty();preview();});
  document.querySelectorAll('[data-designer-width]').forEach(button=>button.addEventListener('click',()=>{width=Number(button.dataset.designerWidth);document.querySelectorAll('[data-designer-width]').forEach(node=>(node.classList.toggle('on',node===button),node.setAttribute('aria-pressed',String(node===button))));document.getElementById('theme-preview-status').textContent=button.getAttribute('aria-label').replace(' preview','');fit();}));
  function showPage(){const url=new URL(document.getElementById('designer-page').value,location.origin);if(version==='live')url.searchParams.set('theme','live');frame.src=url.href;}
  document.querySelectorAll('[data-theme-version]').forEach(button=>button.addEventListener('click',()=>{version=button.dataset.themeVersion;document.querySelectorAll('[data-theme-version]').forEach(node=>{node.classList.toggle('on',node===button);node.setAttribute('aria-pressed',String(node===button));});showPage();}));
  document.getElementById('designer-page').addEventListener('change',showPage);
  new ResizeObserver(fit).observe(frame.closest('.theme-preview-stage'));
  function fontList(){
    const host=document.getElementById('theme-font-list'),term=document.getElementById('theme-font-search').value.toLowerCase();host.replaceChildren();
    for(const font of config.fonts.filter(font=>font.toLowerCase().includes(term))){
      const button=document.createElement('button');button.type='button';button.className='theme-font-option';button.dataset.font=font;button.setAttribute('aria-label','Use '+font);button.setAttribute('aria-pressed',String(input(fontRole+'Font').value===font));
      const label=document.createElement('small');label.textContent=font+(config.importedFonts.includes(font)?' · Imported':'');const sample=document.createElement('span');sample.textContent='Aa · '+font;sample.style.fontFamily=JSON.stringify(font)+', sans-serif';sample.style.fontWeight=input(fontRole+'Weight').value;button.append(label,sample);
      button.onclick=()=>{input(fontRole+'Font').value=font;dirty();preview();dialog.close();};host.appendChild(button);
    }
    if(!host.children.length){const empty=document.createElement('p');empty.className='theme-font-empty';empty.textContent='No fonts match your search.';host.appendChild(empty);}
  }
  document.querySelectorAll('[data-font-open]').forEach(button=>button.addEventListener('click',()=>{fontRole=button.dataset.fontOpen;document.getElementById('theme-font-dialog-role').textContent=fontRole==='display'?'Display / headings':'Body';document.getElementById('theme-font-search').value='';fontList();dialog.showModal();document.getElementById('theme-font-search').focus();}));
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();dialog.close();}});
  document.getElementById('theme-font-search').addEventListener('input',fontList);document.getElementById('theme-font-close').onclick=()=>dialog.close();
  samples();fit();if(frame.contentDocument?.readyState==='complete'&&frame.contentDocument.body?.children.length)frame.dispatchEvent(new Event('load'));
})();
