(function(){
  const rail=document.getElementById('admin-navigation');
  if(!rail)return;
  // Restore expanded groups, while always revealing the current page on arrival.
  const key='storemill-navigation-v1';let saved={};
  try{const parsed=JSON.parse(localStorage.getItem(key)||'{}');if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))saved=parsed;}catch{}
  rail.querySelectorAll('[data-nav-group]').forEach(group=>{
    const button=group.querySelector('[aria-controls]'),children=document.getElementById(button.getAttribute('aria-controls'));
    function set(open){button.setAttribute('aria-expanded',String(open));children.hidden=!open;if(button.classList.contains('nav-expand'))button.setAttribute('aria-label',(open?'Collapse ':'Expand ')+button.dataset.groupLabel);}
    set(group.dataset.active==='true'||saved[group.dataset.navGroup]===true);
    button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';set(open);saved[group.dataset.navGroup]=open;try{localStorage.setItem(key,JSON.stringify(saved));}catch{}});
  });
  const toggle=document.getElementById('nav-toggle'),backdrop=document.querySelector('.nav-backdrop'),main=document.querySelector('main.page'),mobile=matchMedia('(max-width:900px)');
  function setNav(open,focus=false){
    open=open&&mobile.matches;document.body.classList.toggle('nav-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');backdrop.hidden=!open;main.inert=open;
    if(focus){if(open)(rail.querySelector('[aria-current=page]')||rail.querySelector('a'))?.focus();else toggle.focus();}
  }
  toggle.addEventListener('click',()=>setNav(!document.body.classList.contains('nav-open'),true));
  backdrop.addEventListener('click',()=>setNav(false,true));mobile.addEventListener('change',()=>setNav(false));
  rail.addEventListener('click',event=>{if(event.target.closest('a'))setNav(false);});
  document.addEventListener('keydown',event=>{
    if(!document.body.classList.contains('nav-open'))return;
    if(event.key==='Escape'){event.preventDefault();setNav(false,true);}
    if(event.key==='Tab'){
      const controls=[toggle,...rail.querySelectorAll('a,button')].filter(el=>el.getClientRects().length);
      const index=controls.indexOf(document.activeElement),next=(index+(event.shiftKey?-1:1)+controls.length)%controls.length;
      event.preventDefault();controls[next]?.focus();
    }
  });
  const switcher=document.getElementById('store-switcher');if(!switcher)return;
  const trigger=switcher.querySelector('summary'),search=switcher.querySelector('input');
  function filter(){let found=0;switcher.querySelectorAll('[data-store-category]').forEach(category=>{let count=0;category.querySelectorAll('[data-store-name]').forEach(option=>{option.hidden=!option.dataset.storeName.includes(search.value.trim().toLowerCase());if(!option.hidden)count++;});category.hidden=count===0;found+=count;});switcher.querySelector('.switcher-empty').hidden=found>0;}
  function closePicker(focus=false){switcher.open=false;if(focus)trigger.focus();}
  function openPicker(){switcher.open=true;setNav(false);search.value='';filter();search.focus();}
  trigger.addEventListener('click',event=>{event.preventDefault();if(switcher.open)closePicker();else openPicker();});
  search.addEventListener('input',filter);
  switcher.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closePicker(true);}
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(!switcher.open)openPicker();
      const options=[...switcher.querySelectorAll('.switcher-option')].filter(el=>!el.hidden);
      if(!options.length)return;
      const index=options.indexOf(document.activeElement),next=index<0?(event.key==='ArrowDown'?0:options.length-1):(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
      event.preventDefault();options[next].focus();
    }
  });
  document.addEventListener('click',event=>{if(!switcher.contains(event.target))closePicker();});
  switcher.addEventListener('focusout',event=>{if(event.relatedTarget&&!switcher.contains(event.relatedTarget))closePicker();});
})();
