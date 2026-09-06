/* Visual editing is a projection of the source document. No site classes or
 * inline styles are rewritten. Editor chrome never enters the canvas DOM. */
(function () {
  'use strict';
  if (window.__PAGE.mode !== 'html') return;
  const $ = id => document.getElementById(id);
  const frame = $('edit-frame'), source = $('html'), layers = $('layers'), props = $('props');
  const ID = 'data-pb-id', META = 'data-pb-document', OVERRIDES = 'data-pb-overrides', TEMP = 'data-pb-temporary';
  const breaks = { desktop: 1200, tablet: 820, mobile: 390 };
  const names = { desktop: 'Desktop', tablet: 'Tablet', mobile: 'Mobile' };
  const contentTypes = ['Heading', 'Text', 'Rich text', 'Image', 'Icon', 'Button', 'Link', 'Video', 'List', 'Divider', 'Input', 'Select', 'Checkbox', 'Price', 'Compare at price', 'Product title', 'Add to cart', 'Buy now', 'Quantity', 'Reviews', 'Shipping copy'];
  const structureTypes = ['Page', 'Section', 'Container', 'Row', 'Column', 'Columns', 'Grid', 'Group', 'Form', 'FAQ', 'Product gallery', 'Announcement bar'];
  const textTypes = ['Heading', 'Text', 'Rich text', 'Button', 'Link', 'Price', 'Compare at price', 'Product title', 'Add to cart', 'Buy now', 'Shipping copy'];
  const interactiveTypes = ['Button', 'Link', 'Add to cart', 'Buy now', 'Select'];
  const ignored = 'script,style,link,meta,title,base,noscript,template,source,track,br,wbr';
  const styleKeys = ['display','grid-column','grid-row','box-sizing','flex-direction','justify-content','align-items','grid-template-columns','gap','width','min-width','max-width','min-height','height','padding-top','padding-right','padding-bottom','padding-left','margin-top','margin-right','margin-bottom','margin-left','font-family','font-size','font-weight','line-height','letter-spacing','text-align','color','background-color','background-image','border-radius','border-width','border-style','border-color','box-shadow','opacity','object-fit'];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const copy = value => JSON.parse(JSON.stringify(value));
  const uid = () => 'e-' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const queryId = (root, id) => id ? root.querySelector('[' + ID + '="' + CSS.escape(id) + '"]') : null;
  let doc, model = new Map(), selected = null, hovered = null, hoverFrom = null, breakpoint = 'desktop';
  let metadata = { version: 1, nodes: {}, overrides: {} }, original = source.value, changed = false;
  let undo = [], redo = [], transaction = null, inline = null, clipboard = null;
  let expanded = new Set(), allNodes = false, filter = '', drag = null, drop = null, dwell = null;
  let observer, resizeObserver, pendingLoad = null, loading = true, sourceTimer, sourceBefore, focusedTab = 'content';
  let styleScope='one', showHidden = new Set(), scale = 1, pointerDrag=null;
  let hoveredSection=null, suppressCanvasClick=false, sectionDrag=null;
  const paddingLinks=new Map(), paddingSides=['top','right','bottom','left'];

  // Keep hierarchy and the inspector visible together. Existing page/history
  // tools and native block workflows remain owned by the outer editor.
  const inspector = document.createElement('aside');
  inspector.className = 'visual-inspector'; inspector.setAttribute('aria-label', 'Selection settings');
  const settings = props.closest('section'); settings.removeAttribute('data-panel-body'); settings.hidden = false;
  inspector.appendChild(settings); document.querySelector('.workspace').appendChild(inspector);
  $('settings-back').hidden = true;
  document.querySelector('[data-panel="settings"]').hidden = true;
  document.querySelector('[data-panel="source"] span').textContent = 'Code';
  $('save').disabled = true; $('publish').disabled = true;
  const help = document.createElement('div'); help.className = 'editor-intro';
  help.innerHTML = '<strong>Make this page your own</strong><span>Click to select. Drag to move. Double-click text to write. Your original design stays intact.</span>';
  layers.before(help);
  const layerTools = document.createElement('div'); layerTools.className = 'layer-tools';
  layerTools.innerHTML = '<input aria-label="Find a layer" placeholder="Find text or a section…"><label><input type="checkbox"> Show all nodes</label>';
  layers.before(layerTools);
  const cartEditor=document.createElement('button');cartEditor.type='button';cartEditor.className='btn wide';cartEditor.textContent='Edit cart drawer';cartEditor.hidden=true;cartEditor.style.marginBottom='12px';layerTools.before(cartEditor);
  cartEditor.addEventListener('click',()=>{
    const cart=doc?.querySelector('cart-drawer,#CartDrawer,#cart-drawer,.cart-drawer,[data-cart-drawer]');if(!cart)return;
    const open=!cart.hasAttribute('data-pb-cart-editing');cart.toggleAttribute('data-pb-cart-editing',open);cartEditor.textContent=open?'Close cart drawer':'Edit cart drawer';
    if(open){const n=[...model.values()].find(n=>n.el===cart);if(n)select(n.id);announce('Edit this drawer’s content and styling. Preview to test its cart items.');}draw();
  });
  layerTools.querySelector('input').addEventListener('input', e => { filter = e.target.value.toLowerCase(); renderLayers(); });
  layerTools.querySelector('[type=checkbox]').addEventListener('change', e => { allNodes = e.target.checked; renderLayers(); });
  const breadcrumbs = document.createElement('nav'); breadcrumbs.className = 'canvas-breadcrumb'; breadcrumbs.setAttribute('aria-label', 'Selected element path');
  document.querySelector('.work').appendChild(breadcrumbs);
  const host = $('html-canvas');
  const chrome = document.createElement('div'); chrome.className = 'canvas-chrome'; chrome.setAttribute('aria-label', 'Canvas tools');
  chrome.innerHTML = '<div class="canvas-outline hover-outline" hidden><span></span></div><div class="canvas-outline selected-outline" hidden><span></span></div><div class="canvas-outline target-outline" hidden><span></span></div><div class="insertion-line" hidden></div><div class="floating-tools" hidden></div><button class="canvas-insert" type="button" hidden title="Add after selection" aria-label="Add after selection"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>';
  host.appendChild(chrome);
  const hoverBox = chrome.querySelector('.hover-outline'), selectionBox = chrome.querySelector('.selected-outline'), targetBox = chrome.querySelector('.target-outline');
  const floating = chrome.querySelector('.floating-tools'), plus = chrome.querySelector('.canvas-insert'), line = chrome.querySelector('.insertion-line');
  const sectionTools=document.createElement('div');sectionTools.className='section-tools';sectionTools.hidden=true;
  sectionTools.innerHTML='<button type="button" data-section-drag aria-label="Drag section" title="Drag to reorder this whole section">⠿ Drag section</button><button type="button" data-section-padding aria-label="Edit section padding">Padding</button>';
  chrome.appendChild(sectionTools);
  sectionTools.querySelector('[data-section-drag]').onpointerdown=e=>beginPointerDrag(e,get(sectionTools.dataset.section),true);
  sectionTools.querySelector('[data-section-drag]').onclick=()=>select(sectionTools.dataset.section);
  sectionTools.querySelector('[data-section-padding]').onclick=()=>{select(sectionTools.dataset.section);focusPadding();};
  const live = document.createElement('div'); live.className = 'editor-toast'; live.setAttribute('role', 'status'); document.body.appendChild(live);
  let toastTimer;
  function announce(message) { live.textContent = message; live.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => live.classList.remove('visible'), 3500); }
  const nodeMeta = id => metadata.nodes[id] || (metadata.nodes[id] = {});
  const get = id => model.get(id);
  const current = () => get(selected);
  const computed = el => doc.defaultView.getComputedStyle(el);
  const nodeName = n => n ? (metadata.nodes[n.id]?.name || n.label || n.type) : 'Page';
  const isLocked = n => !!n && (!!metadata.nodes[n.id]?.locked || (n.parent && isLocked(get(n.parent))));
  const hidden = el => { const s = computed(el); return s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0 || !el.getClientRects().length; };
  function ownText(el) { return [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(' ').trim(); }
  function isText(el) { return !!el.textContent.trim() && !el.querySelector('div,section,article,form,ul,ol,table,img,svg,video,iframe,input,select,button,h1,h2,h3,h4,h5,h6,p,blockquote,details') && el.textContent.length < 12000; }

  function infer(el) {
    const tag = el.localName, s = computed(el), text = el.textContent.trim().replace(/\s+/g, ' '), own = ownText(el);
    const tokens = (el.id + ' ' + (typeof el.className === 'string' ? el.className : '')).toLowerCase();
    const semantic = { body:'Page',h1:'Heading',h2:'Heading',h3:'Heading',h4:'Heading',h5:'Heading',h6:'Heading',p:'Text',blockquote:'Rich text',img:'Image',svg:'Icon',button:'Button',a:'Link',video:'Video',iframe:'Video',ul:'List',ol:'List',hr:'Divider',form:'Form',input:'Input',textarea:'Input',select:'Select',section:'Section',header:'Section',footer:'Section',nav:'Section',article:'Section',main:'Container',figure:'Group',picture:'Group',li:'Group',details:'FAQ' };
    if (el === doc.body) return {type:'Page', why:'Document body'};
    if ((tag === 'button' || tag === 'a' || el.getAttribute('role') === 'button') && /^(add to (cart|bag)|add .+ to (cart|bag))/i.test(text)) return {type:'Add to cart',why:'Cart action label'};
    if ((tag === 'button' || tag === 'a') && /^(buy now|buy it now|checkout)/i.test(text)) return {type:'Buy now',why:'Purchase action label'};
    if (tag === 'input' && el.type === 'number') return {type:'Quantity',why:'Number input'};
    if (tag === 'input' && ['checkbox','radio'].includes(el.type)) return {type:'Checkbox',why:'Choice input'};
    if (isText(el) && text.length < 70 && /^([$€£¥]\s?[\d,.]+|[\d,.]+\s?(USD|EUR|GBP))(\s*[-–]\s*[$€£¥]?[\d,.]+)?$/.test(text)) return {type: /line-through/.test(s.textDecorationLine) || ['s','del'].includes(tag) ? 'Compare at price' : 'Price', why:'Currency amount'};
    if (el.getAttribute('itemprop') === 'name' && /^h[1-6]$/.test(tag)) return {type:'Product title',why:'Product name markup'};
    if (text.length < 180 && isText(el) && /free shipping|ships? (in|within)/i.test(text)) return {type:'Shipping copy',why:'Shipping text'};
    if (el.getAttribute('role') === 'button') return {type:'Button',why:'Button role'};
    if (semantic[tag]) return {type:semantic[tag],why:'Semantic '+tag+' element'};
    if (el.getAttribute('data-pb-native')) return {type:el.getAttribute('data-pb-native'),why:'Added in editor'};
    if (el.matches('[data-section-id],[data-section-type],[data-element_type="section"]') || /(?:^|\s)(?:shopify-section|elsection|el-section|elementor-top-section|section|hero)(?:\s|$)/.test(tokens)) return {type:'Section',why:'Imported page section'};
    if (['flex','inline-flex'].includes(s.display)) return {type:s.flexDirection.startsWith('column')?'Column':'Row',why:'Visible flex layout'};
    if (['grid','inline-grid'].includes(s.display)) return {type:'Grid',why:'Grid layout'};
    if (/\b(?:column|col|cell)(?:[-_\s]|$)/.test(tokens)) return {type:'Column',why:'Imported column container'};
    if (!el.children.length && !text && ['div','aside'].includes(tag)) return {type:'Container',why:'Empty editable container'};
    if (el.children.length === 1 && !own && (!s.backgroundImage || s.backgroundImage === 'none') && ['rgba(0, 0, 0, 0)','transparent',''].includes(s.backgroundColor) && (!s.borderTopWidth || s.borderTopWidth === '0px') && (!s.boxShadow || s.boxShadow === 'none')) return {type:'Wrapper',why:'Single child without a visible surface'};
    if (isText(el)) return {type:parseFloat(s.fontSize)>=24 && text.length<160?'Heading':'Text',why:'Text content and typography'};
    if (/\b(hero|section|banner)\b/.test(tokens) || el.parentElement === doc.body) return {type:'Section',why:'Page region'};
    return {type:el.children.length?'Container':'Custom',why:'Content container'};
  }

  function analyze() {
    model = new Map();
    const seen = new Set();
    [doc.body, ...doc.body.querySelectorAll('*')].forEach(el => {
      if (el.matches(ignored) || el.closest('script,style,template,noscript,svg') && el.localName !== 'svg') return;
      let id = el.getAttribute(ID);
      if (!id || !/^[\w-]+$/.test(id) || seen.has(id)) { id = uid(); el.setAttribute(ID,id); }
      seen.add(id);
      const info = infer(el), type = metadata.nodes[id]?.type || info.type;
      const text = (el.getAttribute('aria-label') || el.getAttribute('alt') || (el.querySelector('h1,h2,h3')?.textContent) || el.textContent).trim().replace(/\s+/g,' ').slice(0,65);
      model.set(id,{id,el,type,why:info.why,label:text || type,parent:null,children:[]});
    });
    model.forEach(n => {
      let parent = n.el.parentElement;
      while (parent && !model.has(parent.getAttribute(ID))) parent = parent.parentElement;
      n.parent = parent?.getAttribute(ID) || null;
      if (n.parent) get(n.parent).children.push(n.id);
    });
    // Text formatting stays inside its meaningful text node; icons remain
    // reachable via keyboard/Layers without intercepting a button click.
    model.forEach(n => {
      let parent = get(n.parent);
      while (parent) {
        if (textTypes.includes(parent.type) && n.type !== 'Icon' && n.type !== 'Image') { n.collapsed = true; break; }
        parent = get(parent.parent);
      }
    });
    if (!get(selected)) selected = null;
    syncEmptyTargets();renderLayers(); draw();
  }
  function syncEmptyTargets(){
    doc.querySelectorAll('[data-pb-empty-target]').forEach(el=>el.removeAttribute('data-pb-empty-target'));
    model.forEach(n=>{if(['Row','Column','Columns','Grid','Container','Section'].includes(n.type)&&!n.el.textContent.trim()&&!n.el.querySelector('img,svg,video,iframe,input,button,select,textarea,hr')&&!isLocked(n))n.el.setAttribute('data-pb-empty-target','');});
  }
  function meaningful(n) { return n && (allNodes || (!n.collapsed && n.type !== 'Wrapper')); }
  function parentOf(n) { let p=get(n?.parent); while(p && !meaningful(p)) p=get(p.parent); return p; }
  function childrenOf(n) { return (n?.children || []).flatMap(id => meaningful(get(id)) ? [get(id)] : childrenOf(get(id))); }
  function sectionOf(n) {
    let fallback=null;
    while(n&&n.type!=='Page') {
      if(n.type==='Section')return n;
      const parent=parentOf(n);
      if(!fallback&&structureTypes.includes(n.type)&&(parent?.type==='Page'||parent?.el.localName==='main'))fallback=n;
      n=get(n.parent);
    }
    return fallback;
  }
  function hit(event) {
    let el = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (!el || !doc.body.contains(el)) return null;
    let n = get(el.closest('['+ID+']')?.getAttribute(ID));
    let p = n;
    while (p) { if (interactiveTypes.includes(p.type)) return p; p = get(p.parent); }
    while (n && (!meaningful(n) || n.type === 'Wrapper')) n = get(n.parent);
    if (n && textTypes.includes(n.type) && !['Button','Link'].includes(n.type)) {
      const walker=doc.createTreeWalker(n.el,4); let text, onGlyph=false;
      while ((text=walker.nextNode())) { const r=doc.createRange(); r.selectNodeContents(text); if ([...r.getClientRects()].some(b => event.clientX>=b.left-4 && event.clientX<=b.right+4 && event.clientY>=b.top-4 && event.clientY<=b.bottom+4)) { onGlyph=true; break; } }
      if (!onGlyph) n=parentOf(n) || n;
    }
    return n;
  }
  function select(id, scroll=false) {
    if (inline) finishInline(true);
    commit();
    doc.querySelectorAll('[data-pb-drag-original]').forEach(el=>{const old=el.getAttribute('data-pb-drag-original');if(old==='absent')el.removeAttribute('draggable');else el.setAttribute('draggable',old);el.removeAttribute('data-pb-drag-original');});
    if(selected!==id)styleScope='one';selected = model.has(id) ? id : null;
    hoveredSection=sectionOf(current())?.id||null;
    if(current()&&!isLocked(current())){const el=current().el;el.setAttribute('data-pb-drag-original',el.getAttribute('draggable')??'absent');el.draggable=false;}

    let n=current(); while (n) { expanded.add(n.id); n=parentOf(n); }
    renderLayers(); renderInspector(); draw();
    if (scroll && current()) current().el.scrollIntoView({block:'center',inline:'nearest'});
    const row=layers.querySelector('[data-node="'+CSS.escape(selected||'')+'"]'); if(row) row.scrollIntoView({block:'nearest'});
  }

  function metadataNode(root) { return root.querySelector('script['+META+']'); }
  function clean(root) {
    root.querySelectorAll('['+TEMP+']').forEach(el => el.remove());
    const editing = root.querySelector('[data-pb-editing]');
    if(editing) { const old=editing.getAttribute('data-pb-editing'); if(old==='absent')editing.removeAttribute('contenteditable');else editing.setAttribute('contenteditable',old); editing.removeAttribute('data-pb-editing'); }
    const drags=[...(root.matches?.('[data-pb-drag-original]')?[root]:[]),...root.querySelectorAll('[data-pb-drag-original]')];
    drags.forEach(el=>{const old=el.getAttribute('data-pb-drag-original');if(old==='absent')el.removeAttribute('draggable');else el.setAttribute('draggable',old);el.removeAttribute('data-pb-drag-original');});
    root.querySelectorAll('[data-store-theme-node]').forEach(el=>el.removeAttribute('data-store-theme-node'));
    root.querySelectorAll('[data-pb-empty-target]').forEach(el=>el.removeAttribute('data-pb-empty-target'));
    root.removeAttribute?.('data-pb-empty-target');
    root.querySelectorAll('[data-pb-peek]').forEach(el=>el.removeAttribute('data-pb-peek'));
    root.querySelectorAll('[data-pb-cart-editing]').forEach(el=>el.removeAttribute('data-pb-cart-editing'));
    root.removeAttribute?.('data-pb-cart-editing');
    return root;
  }
  function serialize(force=false) {
    if (!doc || loading) return source.value;
    if (!changed && !force) return original;
    const root=clean(doc.documentElement.cloneNode(true));
    metadataNode(root)?.remove();
    const data=doc.createElement('script'); data.type='application/json'; data.setAttribute(META,'1');
    data.textContent=JSON.stringify(metadata).replace(/</g,'\\u003c'); root.querySelector('head').appendChild(data);
    const dt=doc.doctype; const declaration=dt ? '<!DOCTYPE '+dt.name+(dt.publicId?' PUBLIC "'+dt.publicId+'"':'')+(!dt.publicId&&dt.systemId?' SYSTEM':'')+(dt.systemId?' "'+dt.systemId+'"':'')+'>' : '';
    return declaration+root.outerHTML;
  }
  function snapshot() { return {raw:serialize(true),selected,changed,original}; }
  function begin(label) { if(!transaction) transaction={label,before:snapshot()}; }
  function touch() { changed=true; source.value=serialize(true); source.dispatchEvent(new Event('input',{bubbles:true})); draw(); }
  function commit() {
    if(!transaction) return;
    const after=snapshot(), before=transaction.before;
    if(after.raw!==before.raw) { undo.push({...transaction,after}); if(undo.length>80)undo.shift(); redo=[]; }
    transaction=null; historyButtons();
  }
  function operation(label, fn) { if(inline)finishInline(true);commit();begin(label);fn();syncOverrides();analyze();touch();commit();renderInspector();draw(); }
  function historyButtons() { $('undo').disabled=loading||undo.length===0; $('redo').disabled=loading||redo.length===0; $('undo').title=undo.length?'Undo '+undo.at(-1).label:'Nothing to undo'; $('redo').title=redo.length?'Redo '+redo.at(-1).label:'Nothing to redo'; }
  function historyStep(from,to) { if(loading)return;if(inline)finishInline(true);commit();const op=from.pop();if(!op)return;to.push(op);load(from===undo?op.before:op.after);source.dispatchEvent(new Event('input',{bubbles:true}));announce((from===undo?'Undid ':'Redid ')+op.label); }
  function load(snap) { loading=true;$('save').disabled=true;$('publish').disabled=true; pendingLoad=snap; source.value=snap.raw; frame.srcdoc=snap.raw; historyButtons(); }
  window.__HTML_UNDO=()=>historyStep(undo,redo); window.__HTML_REDO=()=>historyStep(redo,undo);
  window.__HTML_SERIALIZE=()=>{ if(sourceTimer){clearTimeout(sourceTimer);sourceTimer=null;const raw=source.value;const after={raw,selected:null,changed:false,original:raw};undo.push({label:'edit source',before:sourceBefore||snapshot(),after});redo=[];load(after);return raw;}if(inline)finishInline(true);commit();return serialize(); };
  window.__HTML_PREVIEW=()=>{ if(loading)return;const raw=window.__HTML_SERIALIZE();$('preview-title').textContent='Preview · current changes';const preview=$('preview');preview.removeAttribute('src');preview.srcdoc=raw;$('preview-overlay').hidden=false; };

  function rules(id,bp=breakpoint) { return metadata.overrides[id]?.[bp] || {}; }
  function syncOverrides() {
    let sheet=doc.querySelector('style['+OVERRIDES+']');
    const css=[];
    ['desktop','tablet','mobile'].forEach(bp=>{
      const blocks=[];
      Object.entries(metadata.overrides).forEach(([id,byBreak])=>{
        if(!/^[\w-]+$/.test(id))return;
        const entries=Object.entries(byBreak[bp] || {}).filter(([k,v])=>styleKeys.includes(k)&&typeof v==='string'&&!/[{}<>;]/.test(v)&&v.trim());
        if(entries.length)blocks.push('['+ID+'="'+id+'"]{'+entries.map(([k,v])=>k+':'+v+' !important').join(';')+'}');
      });
      if(blocks.length)css.push(bp==='desktop'?blocks.join('\n'):'@media(max-width:'+(bp==='tablet'?991:767)+'px){'+blocks.join('\n')+'}');
    });
    if(!css.length){sheet?.remove();if(window.__BRAND?.themeCustomized)applySourceTheme(doc,window.__BRAND,{temporary:true,fontDocument:document});return;}
    if(!sheet){sheet=doc.createElement('style');sheet.setAttribute(OVERRIDES,'1');doc.head.appendChild(sheet);}
    sheet.textContent=css.join('\n');
    if(window.__BRAND?.themeCustomized)applySourceTheme(doc,window.__BRAND,{temporary:true,fontDocument:document});
  }
  function setStyle(id,key,value) {
    if(!styleKeys.includes(key))return;
    if(value && (!CSS.supports(key,value)||/[{}<>;]/.test(value))) return false;
    const n=get(id);
    if(n?.el.style.getPropertyPriority(key)==='important' && value){announce('This property is locked by an original inline !important rule. Edit it in Code if needed.');return false;}
    metadata.overrides[id] ||= {}; metadata.overrides[id][breakpoint] ||= {};
    if(value)metadata.overrides[id][breakpoint][key]=value; else delete metadata.overrides[id][breakpoint][key];
    syncOverrides(); return true;
  }
  function origin(n,key) {
    if(rules(n.id)[key])return {label:names[breakpoint]+' override',reset:true};
    if(breakpoint==='mobile' && rules(n.id,'tablet')[key])return {label:'From Tablet'};
    if(breakpoint!=='desktop' && rules(n.id,'desktop')[key])return {label:'From Desktop'};
    let p=parentOf(n); const inherits=/^(color|font-|line-height|letter-spacing|text-align)/.test(key);
    if(inherits)while(p){if(['desktop',...(breakpoint!=='desktop'?['tablet']:[]),...(breakpoint==='mobile'?['mobile']:[])].some(bp=>rules(p.id,bp)[key]))return{label:'From '+nodeName(p).slice(0,18)};p=parentOf(p);}
    return {label:'Original site'};
  }
  function setHover(id, from, reveal=false) {
    if(loading||drag||inline)return;
    const n=get(id);
    hovered=n?.id||null;hoverFrom=hovered?from:null;
    layers.querySelectorAll('.hovered').forEach(row=>row.classList.remove('hovered'));
    if(n)layers.querySelector('[data-node="'+CSS.escape(n.id)+'"]')?.classList.add('hovered');
    if(reveal&&n&&!hidden(n.el)){
      const r=n.el.getBoundingClientRect(),win=doc.defaultView;
      if(r.bottom<=0||r.top>=win.innerHeight||r.right<=0||r.left>=win.innerWidth)n.el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
    }
    draw();
  }
  function clearHover(from) {
    if(hoverFrom!==from)return;
    hovered=null;hoverFrom=null;
    layers.querySelectorAll('.hovered').forEach(row=>row.classList.remove('hovered'));
    draw();
  }
  function rect(n) { if(!n)return null;const r=n.el.getBoundingClientRect(), f=frame.getBoundingClientRect(), h=host.getBoundingClientRect();return{left:f.left-h.left+r.left*scale,top:f.top-h.top+r.top*scale,width:r.width*scale,height:r.height*scale}; }
  function outline(box,n,label) { const r=rect(n);box.hidden=!r||r.width<1||r.height<1||r.top+r.height<0||r.top>host.clientHeight;if(box.hidden)return;Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});box.querySelector('span').textContent=label||n.type+' · '+nodeName(n); }
  function draw() {
    if(!doc)return;
    outline(hoverBox,hovered!==selected?get(hovered):null);
    outline(selectionBox,current());
    const n=current(), r=rect(n); floating.hidden=!n||!r||r.height<1||r.top>host.clientHeight||r.top+r.height<0||!!inline; plus.hidden=floating.hidden||n.type==='Page'||isLocked(n);
    const section=get(sectionDrag)||sectionOf(get(drag))||get(hoveredSection)||sectionOf(n),sr=rect(section);
    sectionTools.hidden=!section||!sr||sr.width<1||sr.height<1||sr.top>host.clientHeight||sr.top+sr.height<0||!!inline;
    if(!sectionTools.hidden){
      sectionTools.dataset.section=section.id;
      sectionTools.style.left=Math.max(4,Math.min(sr.left+sr.width-sectionTools.offsetWidth-8,host.clientWidth-sectionTools.offsetWidth-4))+'px';
      sectionTools.style.top=Math.max(4,Math.min(sr.top+6,host.clientHeight-40))+'px';
      sectionTools.querySelectorAll('button').forEach(button=>button.disabled=isLocked(section));
    }
    if(!floating.hidden){floating.style.left=Math.max(4,Math.min(r.left,host.clientWidth-285))+'px';floating.style.top=Math.max(4,Math.min(r.top-40,host.clientHeight-40))+'px';}
    if(!floating.hidden&&!sectionTools.hidden&&Math.abs(parseFloat(floating.style.top)-parseFloat(sectionTools.style.top))<38&&parseFloat(floating.style.left)+floating.offsetWidth>parseFloat(sectionTools.style.left))floating.style.top=(parseFloat(sectionTools.style.top)+40)+'px';
    if(!plus.hidden){plus.style.left=Math.max(5,Math.min(r.left+r.width/2-14,host.clientWidth-32))+'px';plus.style.top=Math.max(5,Math.min(r.top+r.height-14,host.clientHeight-32))+'px';}
    if(drop){outline(targetBox,get(drop.parent),drop.valid?'Move into '+nodeName(get(drop.parent)):'Cannot move here');targetBox.classList.toggle('invalid',!drop.valid);const rr=rect(get(drop.target));line.hidden=!drop.valid||drop.mode==='inside'||!rr;if(!line.hidden){line.classList.toggle('vertical',!!drop.horizontal);Object.assign(line.style,drop.horizontal?{left:(rr.left+(drop.mode==='after'?rr.width:0))+'px',top:rr.top+'px',width:'3px',height:rr.height+'px'}:{left:rr.left+'px',width:rr.width+'px',height:'3px',top:(rr.top+(drop.mode==='after'?rr.height:0))+'px'});}}
    else{targetBox.hidden=true;line.hidden=true;}
  }
  function fit() {
    if(!doc)return;
    const stage=$('stage'),padding=getComputedStyle(stage),available=stage.clientWidth-parseFloat(padding.paddingLeft)-parseFloat(padding.paddingRight),width=breaks[breakpoint];
    $('page-sheet').style.width=Math.min(width,available)+'px';
    scale=Math.min(1,available/width);
    Object.assign(frame.style,{width:width+'px',height:Math.max(200,host.clientHeight/scale)+'px',transform:'scale('+scale+')',transformOrigin:'top left'});
    $('canvas-scale').textContent=names[breakpoint]+' · '+width+'px · '+Math.round(scale*100)+'%'; draw();
  }
  document.querySelectorAll('[data-width]').forEach(btn=>btn.addEventListener('click',()=>{
    if(inline)finishInline(true);commit();breakpoint=btn.title.toLowerCase();fit();renderInspector();
  }));
  new ResizeObserver(fit).observe($('stage'));

  function renderLayers() {
    if(!doc)return;
    const root=[...model.values()].find(n=>n.type==='Page');
    let html='';
    const matches=n=>(n.type+' '+nodeName(n)).toLowerCase().includes(filter)||childrenOf(n).some(matches);
    function row(n,depth) {
      if(filter&&!matches(n))return;
      const kids=childrenOf(n), open=expanded.has(n.id)||!!filter, meta=metadata.nodes[n.id]||{};
      html+='<div class="tree-row'+(selected===n.id?' selected':'')+(hovered===n.id?' hovered':'')+'" role="treeitem" aria-selected="'+(selected===n.id)+'" '+(kids.length?'aria-expanded="'+open+'"':'')+' draggable="'+(!isLocked(n))+'" data-node="'+n.id+'" style="--depth:'+Math.min(depth,12)+'"><button class="tree-toggle" '+(!kids.length?'disabled':'')+' aria-label="'+(open?'Collapse':'Expand')+' '+esc(nodeName(n))+'">'+(kids.length?(open?'⌄':'›'):'')+'</button><button class="tree-select"><span class="tree-symbol">'+(n.type==='Image'?'▧':n.type==='Heading'?'H':interactiveTypes.includes(n.type)?'↗':structureTypes.includes(n.type)?'▱':'T')+'</span><span><strong>'+esc(meta.name||n.type)+'</strong><small>'+esc(n.label)+'</small></span></button><span class="layer-signals" title="'+(meta.binding?'Bound to product. ':'')+(hidden(n.el)?'Hidden. ':'')+(isLocked(n)?'Locked':'')+'">'+(meta.binding?'↗ ':'')+(hidden(n.el)?'◌ ':'')+(isLocked(n)?'◇':'')+'</span></div>';
      if(open)kids.forEach(child=>row(child,depth+1));
    }
    childrenOf(root).forEach(n=>row(n,0));
    layers.innerHTML=html||'<p class="muted">'+(filter?'No matching layers.':'This page is empty. Add a section to begin.')+'</p>';layers.setAttribute('role','tree');layers.setAttribute('aria-label','Page layers');
    $('count').textContent=[...model.values()].filter(n=>n.type==='Section').length+' sections · '+[...model.values()].filter(meaningful).length+' layers';
    layers.querySelectorAll('[data-node]').forEach(el=>{
      const id=el.dataset.node;
      el.querySelector('.tree-toggle').onclick=()=>{expanded.has(id)?expanded.delete(id):expanded.add(id);renderLayers();};
      el.querySelector('.tree-select').onclick=()=>select(id,true);
      el.onmouseenter=()=>setHover(id,'layer-pointer',true);
      el.onmouseleave=()=>clearHover('layer-pointer');
      el.addEventListener('focusin',()=>setHover(id,'layer-focus',true));
      el.addEventListener('focusout',e=>{if(!el.contains(e.relatedTarget))clearHover('layer-focus');});
      el.ondragstart=e=>startDrag(e,get(id));el.ondragend=endDrag;
      el.ondragover=e=>{if(!drag)return;e.preventDefault();const r=el.getBoundingClientRect();const target=get(id),fraction=(e.clientY-r.top)/r.height;setDrop(target,fraction>.25&&fraction<.75&&legal(target,get(drag))?'inside':fraction<.5?'before':'after');el.classList.toggle('drop-inside',drop?.valid&&drop.mode==='inside');el.classList.toggle('drop-before',drop?.valid&&drop.mode==='before');el.classList.toggle('drop-after',drop?.valid&&drop.mode==='after');};
      el.ondragleave=()=>el.classList.remove('drop-before','drop-after','drop-inside');el.ondrop=e=>{e.preventDefault();performDrop();};
    });
    const path=[];let n=current();while(n){if(meaningful(n))path.unshift(n);n=get(n.parent);}
    breadcrumbs.innerHTML=path.length?path.map(n=>'<button type="button" data-crumb="'+n.id+'">'+esc(metadata.nodes[n.id]?.name||n.type)+'</button>').join('<span>›</span>'):'<span>Click any element on the page to begin</span>';
    breadcrumbs.querySelectorAll('[data-crumb]').forEach(b=>b.onclick=()=>select(b.dataset.crumb));
  }

  function field(label,attr,value,kind='text',help='') { return '<label class="v-field"><span>'+label+'</span>'+(kind==='textarea'?'<textarea '+attr+'>'+esc(value)+'</textarea>':'<input type="'+kind+'" '+attr+' value="'+esc(value)+'">')+(help?'<small>'+help+'</small>':'')+'</label>'; }
  function similar(n) { const classes=[...n.el.classList].sort().join(' ');return classes?[...model.values()].filter(other=>other.type===n.type&&[...other.el.classList].sort().join(' ')===classes&&!isLocked(other)):[n]; }
  function mediaRules(n) {const found=new Set();function walk(rules,condition=''){for(const rule of rules){if(rule.cssRules)walk(rule.cssRules,rule.conditionText||condition);else if(condition&&rule.selectorText){try{if(n.el.matches(rule.selectorText))found.add(condition);}catch{}}}}for(const sheet of doc.styleSheets){if(sheet.ownerNode?.hasAttribute(TEMP)||sheet.ownerNode?.hasAttribute(OVERRIDES))continue;try{walk(sheet.cssRules);}catch{}}return [...found];}
  function styleField(n,key,label,unit='',options) {
    const o=origin(n,key), value=rules(n.id)[key] || computed(n.el).getPropertyValue(key);
    const badge='<span class="origin '+(o.reset?'override':'')+'">'+esc(o.label)+'</span>'+(o.reset?'<button type="button" class="reset-style" data-reset="'+key+'" aria-label="Reset '+label+'">Reset</button>':'');
    let input;
    if(options) input='<select data-style="'+key+'"><option value="">Keep original</option>'+options.map(([v,l])=>'<option value="'+esc(v)+'" '+(v===value?'selected':'')+'>'+l+'</option>').join('')+'</select>';
    else input='<input data-style="'+key+'" data-unit="'+unit+'" value="'+esc(value)+'" placeholder="Original" '+(unit?'inputmode="decimal"':'')+'>';
    return '<div class="v-field"><div class="field-label"><label>'+label+'</label>'+badge+'</div>'+input+'</div>';
  }
  function accordion(title,html,open=false) { return '<details class="inspector-group" '+(open?'open':'')+'><summary>'+title+'</summary><div>'+html+'</div></details>'; }
  function textContent(el) { return [...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join(''); }
  function updateText(el,value) {
    const walker=doc.createTreeWalker(el,4); const texts=[];let t;while((t=walker.nextNode()))if(!t.parentElement.closest('svg,script,style'))texts.push(t);
    const meaningfulTexts=texts.filter(t=>t.textContent.trim());
    if(meaningfulTexts.length===1)meaningfulTexts[0].textContent=value;
    else if(!el.children.length)el.textContent=value;
    else { // Do not destroy icons or nested markup when editing a button label.
      const text=meaningfulTexts[0];if(text){text.textContent=value;meaningfulTexts.slice(1).forEach(t=>t.textContent='');}else el.appendChild(doc.createTextNode(value));
    }
  }
  function imageElement(n) { return n.el.localName==='img'?n.el:(n.type==='Product gallery'||n.el.localName==='picture')?n.el.querySelector('img'):null; }
  /* MEDIA_EDITOR_HELPERS */
  function renderInspector() {
    const n=current();
    if(!n){$('props-title').textContent='Page editor';props.innerHTML='<div class="selection-empty"><div class="empty-symbol">↖</div><h3>Start with what you see</h3><p>Select a headline, image, button or section on your page.</p><button class="btn primary" type="button" id="empty-insert">Add a section</button><div class="shortcut-list"><span>Write in place</span><kbd>Double-click</kbd><span>Select parent</span><kbd>Shift ↵</kbd><span>Undo</span><kbd>⌘ / Ctrl Z</kbd></div></div>';$('empty-insert').onclick=()=>openInsert('section');floating.innerHTML='';return;}
    $('props-title').textContent=metadata.nodes[n.id]?.name||n.type;
    const locked=isLocked(n), binding=metadata.nodes[n.id]?.binding;
    const img=imageElement(n), canText=textTypes.includes(n.type) || isText(n.el);
    const canInline=canText&&!n.el.querySelector('img,svg,button,input,select');
    const structural=structureTypes.includes(n.type), styles=rules(n.id), peers=similar(n);
    const scope=peers.length>1?'<label class="v-field"><span>Apply design changes to</span><select id="style-scope"><option value="one">Only this layer</option><option value="similar" '+(styleScope==='similar'?'selected':'')+'>All '+peers.length+' layers with the same classes</option></select></label>':'';
    let content='';
    if(locked)content+='<div class="notice">This layer is locked. Unlock it to make changes.</div>';
    if(img)content+='<div class="image-preview"><img src="'+esc(img.getAttribute('src')||'')+'" alt="Selected image"></div>'+field('Image URL','data-attribute="src"',img.getAttribute('src')||'','url','Replacing an image also clears its old responsive sources.')+field('Image description','data-attribute="alt"',img.getAttribute('alt')||'')+'<button class="btn wide" type="button" data-action="upload">Upload replacement</button>';
    content+=mediaControls(n);
    if(canText)content+=field(binding?'Fallback text':interactiveTypes.includes(n.type)?'Button label':'Text','data-content="text"',binding?.fallbackText??n.el.textContent,'textarea')+(canInline?'<button class="btn wide" type="button" data-action="write">Write on page</button>':'');
    if(n.el.localName==='a')content+=field('Destination','data-attribute="href"',n.el.getAttribute('href')||'','text','Use a page path, #section or full URL.');
    if(n.el.localName==='input'||n.el.localName==='textarea')content+=field('Placeholder','data-attribute="placeholder"',n.el.getAttribute('placeholder')||'');
    if(n.type==='Quantity')content+='<div class="v-grid">'+field('Minimum','data-attribute="min"',n.el.getAttribute('min')||'1','number')+field('Maximum','data-attribute="max"',n.el.getAttribute('max')||'','number')+'</div>';
    if(structural&&!canText&&!img){const kids=childrenOf(n);content+='<p class="muted">'+kids.length+' items in this '+esc(n.type.toLowerCase())+'. Select an item to edit its content.</p><div class="child-chips">'+kids.slice(0,10).map(c=>'<button data-child="'+c.id+'">'+esc(c.type)+'</button>').join('')+'</div>';}
    if(canText||img||['Add to cart','Buy now'].includes(n.type))content+=bindingControls(n,binding);
    const layout='<div class="layout-presets"><button type="button" data-layout="row">Horizontal</button><button type="button" data-layout="column">Vertical</button><button type="button" data-layout="grid">Grid</button></div>'+styleField(n,'display','Arrangement','',[['block','Flow'],['flex','Flexible row / stack'],['grid','Grid']])+styleField(n,'flex-direction','Direction','',[['row','Horizontal'],['column','Vertical']])+'<div class="v-grid">'+styleField(n,'gap','Gap','px')+styleField(n,'grid-template-columns','Columns')+'</div>'+styleField(n,'justify-content','Horizontal alignment','',[['flex-start','Start'],['center','Center'],['flex-end','End'],['space-between','Space between']])+styleField(n,'align-items','Vertical alignment','',[['stretch','Stretch'],['flex-start','Start'],['center','Center'],['flex-end','End']]);
    const spacing='<section class="padding-controls" aria-label="Padding"><div class="padding-heading"><strong>Padding</strong><label><input type="checkbox" data-link-padding '+(paddingLinks.get(n.id)?'checked':'')+'> Link sides</label></div><p>Space inside this '+esc(n.type.toLowerCase())+' · '+names[breakpoint]+'</p><div class="spacing-box">'+paddingSides.map(side=>styleField(n,'padding-'+side,side[0].toUpperCase()+side.slice(1),'px')).join('')+'</div><small>Type a number for pixels, or use %, rem or em.</small></section>';
    const typography=styleField(n,'font-family','Font','',[...new Set(window.__FONTS||[])].map(f=>[f,f]))+'<div class="v-grid">'+styleField(n,'font-size','Size','px')+styleField(n,'font-weight','Weight','',[['400','Regular'],['500','Medium'],['600','Semibold'],['700','Bold']])+styleField(n,'line-height','Line height')+styleField(n,'letter-spacing','Letter spacing','px')+'</div>'+styleField(n,'color','Text color')+styleField(n,'text-align','Alignment','',[['left','Left'],['center','Center'],['right','Right']]);
    const background=styleField(n,'background-color','Background color')+styleField(n,'background-image','Image or gradient')+'<div class="v-grid">'+styleField(n,'border-radius','Corner radius','px')+styleField(n,'opacity','Opacity')+'</div>'+styleField(n,'box-shadow','Shadow','',[['none','None'],['0 2px 8px #0002','Subtle'],['0 8px 28px #0003','Raised']]);
    const size='<div class="v-grid">'+styleField(n,'width','Width','px')+styleField(n,'max-width','Maximum width','px')+styleField(n,'min-height','Minimum height','px')+styleField(n,'height','Height','px')+'</div>'+(img?styleField(n,'object-fit','Image fit','',[['contain','Fit inside'],['cover','Fill area'],['fill','Stretch']]):'');
    const originalMedia=mediaRules(n);
    const visibility=(originalMedia.length?'<p class="site-media">Original responsive rules (read-only):<br>'+originalMedia.map(esc).join('<br>')+'</p>':'')+'<div class="notice">'+(breakpoint==='desktop'?'Desktop changes apply at every size unless a smaller size overrides them.':'Changes here override '+names[breakpoint]+' and smaller screens.')+'</div><button class="btn wide" type="button" data-action="visibility">'+(hidden(n.el)?'Show at '+names[breakpoint]:'Hide at '+names[breakpoint])+'</button>'+(hidden(n.el)||showHidden.has(n.id)?'<button class="btn wide" type="button" data-action="peek">'+(showHidden.has(n.id)?'Stop showing hidden layer':'Show hidden layer while editing')+'</button>':'');
    props.innerHTML='<div class="inspector-selection"><span class="selection-type">'+esc(n.type)+'</span><select aria-label="Element type" id="retag">'+[...structureTypes,...contentTypes,'Custom','Wrapper'].map(t=>'<option '+(n.type===t?'selected':'')+'>'+t+'</option>').join('')+'</select></div><div class="inspector-tabs" role="tablist"><button role="tab" data-tab="content" aria-selected="'+(focusedTab==='content')+'">Content</button><button role="tab" data-tab="design" aria-selected="'+(focusedTab==='design')+'">Design</button></div><fieldset '+(locked?'disabled':'')+'>'+scope+columnPanel(n)+spacing+'<div '+(focusedTab==='content'?'':'hidden')+'>'+accordion('Content',content,true)+(structural?accordion('Layout',layout,true):'')+'</div><div '+(focusedTab==='design'?'':'hidden')+'><div class="breakpoint-notice">Editing '+names[breakpoint]+(breakpoint==='desktop'?' · applies to all sizes':' · responsive override')+'</div>'+(structural?'':accordion('Layout',layout))+accordion('Size',size,img!==null)+((canText||structural)?accordion('Typography',typography,canText):'')+accordion('Background & shape',background,true)+accordion('Visibility',visibility,true)+'</div></fieldset>'+accordion('Organize & advanced',field('Layer name','id="layer-name"',metadata.nodes[n.id]?.name||'')+'<button class="btn wide" type="button" data-action="lock">'+(metadata.nodes[n.id]?.locked?'Unlock layer':'Lock layer')+'</button><p class="muted">'+esc(n.why)+'. Renaming and changing type do not rewrite your markup.</p><code>'+esc('<'+n.el.localName+(n.el.id?' id="'+n.el.id+'"':'')+'>')+'</code>'+field('Element HTML','id="element-code"',n.el.innerHTML,'textarea')+'<button class="btn wide" data-action="apply-code">Apply HTML</button>')+'<div class="prop-actions"><button class="btn" data-action="move-to">Move to…</button><button class="btn" data-action="fit-content">Fit to content</button><button class="btn" data-action="duplicate" '+(locked?'disabled':'')+'>Duplicate</button><button class="btn" data-action="library">Save section</button><button class="btn danger" data-action="delete" '+(locked?'disabled':'')+'>Delete</button></div>';
    const scopeInput=props.querySelector('#style-scope');if(scopeInput)scopeInput.onchange=()=>{styleScope=scopeInput.value;announce(styleScope==='one'?'Design changes apply only to this layer':'Design changes apply to '+peers.length+' similar layers');};
    props.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{commit();focusedTab=b.dataset.tab;renderInspector();});
    props.querySelectorAll('[data-child]').forEach(b=>b.onclick=()=>select(b.dataset.child,true));
    props.querySelector('#retag').onchange=e=>operation('change element type',()=>nodeMeta(n.id).type=e.target.value);
    props.querySelector('#layer-name').onchange=e=>operation('rename layer',()=>nodeMeta(n.id).name=e.target.value.trim());
    props.querySelectorAll('[data-content],[data-attribute]').forEach(input=>{
      input.addEventListener('focus',()=>begin('edit '+(input.dataset.attribute||'text')));
      input.addEventListener('input',()=>{
        begin('edit '+(input.dataset.attribute||'text'));const attr=input.dataset.attribute;
        if(attr){if(['href','src'].includes(attr)&&!safeUrl(input.value,attr==='src')){input.setCustomValidity('Enter a safe image or page URL');return;}input.setCustomValidity('');const el=attr==='src'||attr==='alt'?img:n.el;if(attr==='src')replaceImage(el,input.value);else el.setAttribute(attr,input.value);}
        else if(binding){binding.fallbackText=input.value;}else updateText(n.el,input.value);
        touch();
      });input.addEventListener('blur',()=>{commit();renderLayers();});
    });
    props.querySelectorAll('[data-style]:not([data-style^="padding-"])').forEach(input=>{
      input.setAttribute('aria-label',input.closest('.v-field').querySelector('label').textContent);
      input.addEventListener('focus',()=>begin('change '+input.dataset.style));
      input.addEventListener('change',()=>{
        begin('change '+input.dataset.style);let value=input.value.trim();if(input.dataset.unit&&/^-?\d+(\.\d+)?$/.test(value))value+=input.dataset.unit;
        if((styleScope==='similar'?peers:[n]).map(peer=>setStyle(peer.id,input.dataset.style,value)).some(result=>result===false)){input.setCustomValidity('Enter a valid value');input.reportValidity();commit();return;}input.setCustomValidity('');
        touch();commit();renderInspector();
      });input.addEventListener('blur',commit);
    });
    setupPadding(n,peers);
    props.querySelectorAll('[data-layout]').forEach(b=>b.onclick=()=>operation('change layout',()=>{setStyle(n.id,'display',b.dataset.layout==='grid'?'grid':'flex');setStyle(n.id,'flex-direction',b.dataset.layout==='grid'?'':b.dataset.layout);if(b.dataset.layout==='grid')setStyle(n.id,'grid-template-columns','repeat(2,minmax(0,1fr))');}));
    props.querySelectorAll('[data-reset]').forEach(b=>b.onclick=()=>operation('reset '+b.dataset.reset,()=>setStyle(n.id,b.dataset.reset,'')));
    props.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
    mountVisualColumns(n);mountVisualMedia(n);
    setupBindings(n);
    floating.innerHTML='<button type="button" data-move-handle title="Drag to move" aria-label="Drag selected element">↕</button><button type="button" data-float="'+(img?'replace':canInline?'write':'design')+'">'+(img?'Replace image':canInline?'Edit text':'Design')+'</button><button type="button" data-float="padding" title="Edit padding">Padding</button><button type="button" data-float="up" title="Move up" aria-label="Move up">↑</button><button type="button" data-float="down" title="Move down" aria-label="Move down">↓</button><button type="button" data-float="duplicate" title="Duplicate" aria-label="Duplicate">⧉</button><button type="button" data-float="delete" title="Delete" aria-label="Delete">×</button>';
    floating.querySelector('[data-move-handle]').onpointerdown=e=>beginPointerDrag(e,n,true);
    floating.querySelectorAll('button').forEach(b=>{b.disabled=locked;if(b.dataset.float)b.onclick=()=>action(b.dataset.float);});
  }

  function focusPadding() {
    const control=props.querySelector('.padding-controls');
    control?.scrollIntoView({block:'nearest'});
    const input=control?.querySelector('input[data-style]');input?.focus();input?.select();
  }
  function setupPadding(n,peers) {
    const panel=props.querySelector('.padding-controls'),inputs=[...panel.querySelectorAll('[data-style]')];
    panel.querySelector('[data-link-padding]').onchange=e=>{commit();paddingLinks.set(n.id,e.target.checked);};
    inputs.forEach(input=>{
      const side=input.dataset.style.slice(8);
      input.setAttribute('aria-label','Padding '+side);
      input.addEventListener('input',()=>{
        const raw=input.value.trim(),value=/^\d+(\.\d+)?$/.test(raw)?raw+'px':raw;
        if(value&&(!CSS.supports(input.dataset.style,value)||/[{}<>;]/.test(value))){input.setCustomValidity('Use a nonnegative number or CSS length, such as 24px or 2rem.');return;}
        const targets=styleScope==='similar'?peers:[n],keys=paddingLinks.get(n.id)?paddingSides.map(side=>'padding-'+side):[input.dataset.style];
        if(targets.some(peer=>keys.some(key=>peer.el.style.getPropertyPriority(key)==='important'))&&value){input.setCustomValidity('An original inline rule locks this padding.');announce('This padding is locked by an original inline !important rule.');return;}
        input.setCustomValidity('');begin('change padding');
        targets.forEach(peer=>keys.forEach(key=>setStyle(peer.id,key,value)));
        if(paddingLinks.get(n.id))inputs.forEach(other=>{if(other!==input)other.value=input.value;});
        touch();
      });
      input.addEventListener('change',()=>{input.reportValidity();commit();});
      input.addEventListener('blur',()=>{
        commit();
        // Refresh values and reset buttons without replacing the control the
        // user is about to click (for example Link sides or another edge).
        for(const field of inputs){
          if(field!==document.activeElement){field.value=rules(n.id)[field.dataset.style]||computed(n.el).getPropertyValue(field.dataset.style);field.setCustomValidity('');}
          const o=origin(n,field.dataset.style),label=field.closest('.v-field').querySelector('.field-label');
          label.querySelector('.origin').textContent=o.label;label.querySelector('.origin').classList.toggle('override',!!o.reset);
          if(o.reset&&!label.querySelector('[data-reset]')){
            const reset=document.createElement('button');reset.type='button';reset.className='reset-style';reset.dataset.reset=field.dataset.style;reset.textContent='Reset';reset.setAttribute('aria-label','Reset padding '+field.dataset.style.slice(8));
            reset.onclick=()=>operation('reset padding',()=>setStyle(n.id,field.dataset.style,''));label.appendChild(reset);
          }else if(!o.reset)label.querySelector('[data-reset]')?.remove();
        }
      });
      const reset=input.closest('.v-field').querySelector('[data-reset]');if(reset)reset.setAttribute('aria-label','Reset padding '+side);
    });
  }

  function safeUrl(value,image=false){try {const url=new URL(value,doc.baseURI);return ['http:','https:'].includes(url.protocol)||(image&&/^data:image\/(png|jpeg|webp|gif|avif);base64,/i.test(value));}catch{return false;}}
  function replaceImage(el,value) { if(!el)return;const id=el.getAttribute(ID);const r=el.getBoundingClientRect();if(r.width&&r.height){setStyle(id,'width',r.width+'px');setStyle(id,'height',r.height+'px');setStyle(id,'max-width','100%');}el.setAttribute('src',value);el.removeAttribute('srcset');el.removeAttribute('sizes');el.removeAttribute('data-src');el.removeAttribute('data-srcset');el.closest('picture')?.querySelectorAll('source').forEach(s=>{s.removeAttribute('srcset');s.removeAttribute('sizes');}); }
  const fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='image/png,image/jpeg,image/webp,image/gif,image/avif';fileInput.hidden=true;document.body.appendChild(fileInput);
  fileInput.onchange=()=>{const file=fileInput.files[0],id=selected;if(!file)return;if(file.size>4*1024*1024){announce('Choose an image smaller than 4 MB.');return;}const reader=new FileReader();reader.onload=()=>{const n=get(id);if(n)operation('replace image',()=>replaceImage(imageElement(n),reader.result));};reader.readAsDataURL(file);fileInput.value='';};

  // Bindings use the existing storefront product endpoint. The saved runtime
  // hydrates live values without changing the imported element's styling.
  function bindingControls(n,binding) {
    const suggested={'Price':'price','Compare at price':'compareAtPrice','Product title':'title','Image':'image','Add to cart':'cart.add','Buy now':'cart.buyNow'}[n.type]||'title';
    const fields=imageElement(n)?[['image','Product image']]:['Add to cart','Buy now'].includes(n.type)?[['cart.add','Add to cart'],['cart.buyNow','Buy now']]:[['title','Product title'],['price','Price'],['compareAtPrice','Original price'],['description','Description']];
    return '<div class="binding-card"><strong>'+(binding?'Connected to product':'Connect product content')+'</strong><small>'+(binding?'Live product content takes priority over fallback text.':'Keep this design and use your catalog’s content.')+'</small><label class="v-field"><span>Product</span><select id="binding-product"><option value="">Choose a product</option>'+(window.__PRODUCTS||[]).map(p=>'<option value="'+esc(p.id)+'" '+(binding?.productId===p.id?'selected':'')+'>'+esc(p.title)+'</option>').join('')+'</select></label><label class="v-field"><span>Content</span><select id="binding-field">'+fields.map(([id,label])=>'<option value="'+id+'" '+((binding?.field||suggested)===id?'selected':'')+'>'+label+'</option>').join('')+'</select></label><button class="btn wide" id="bind-product" type="button">'+(binding?'Update connection':'Connect product')+'</button>'+(binding?'<button class="btn wide" type="button" data-action="unbind">Disconnect & restore original</button>':'')+'</div>';
  }
  function setupBindings(n) {
    const button=props.querySelector('#bind-product');if(!button)return;
    button.onclick=async()=>{
      const productId=props.querySelector('#binding-product').value,field=props.querySelector('#binding-field').value;if(!productId){announce('Choose a product first.');return;}
      button.disabled=true;
      try {const response=await fetch('/admin/pages/'+window.__PAGE.id+'/product-data/'+encodeURIComponent(productId)+'?storeId='+encodeURIComponent(window.__PAGE.storeId));const product=await response.json();if(!response.ok||product.error)throw Error(product.error||'Could not load product');
        operation('connect product',()=>{const old=nodeMeta(n.id).binding;nodeMeta(n.id).binding={productId,field,fallbackHtml:old?.fallbackHtml??n.el.innerHTML,fallbackAttributes:old?.fallbackAttributes??Object.fromEntries([...n.el.attributes].map(a=>[a.name,a.value])),fallbackText:old?.fallbackText??n.el.textContent,fallbackSources:old?.fallbackSources??[...(imageElement(n)?.closest('picture')?.querySelectorAll('source')||[])].map(el=>Object.fromEntries([...el.attributes].map(a=>[a.name,a.value]))),fallbackOverrides:old?.fallbackOverrides??copy(metadata.overrides[n.id]||{})};applyProduct(n,product,field);syncBindingRuntime();});
      }catch(e){announce(e.message);}finally{button.disabled=false;}
    };
  }
  function applyProduct(n,p,field) {
    if(field==='image'){const img=imageElement(n);if(img&&p.image){replaceImage(img,p.image);img.alt=p.title;}}
    else if(field==='cart.add'||field==='cart.buyNow'){n.el.setAttribute('data-pb-product',p.id);}
    else if(p[field]!==undefined)updateText(n.el,p[field]);
  }
  function syncBindingRuntime() {
    doc.querySelector('script[data-pb-bindings]')?.remove();
    const bindings=Object.entries(metadata.nodes).filter(([,m])=>m.binding).map(([id,m])=>({id,productId:m.binding.productId,field:m.binding.field}));if(!bindings.length)return;
    const runtime=doc.createElement('script');runtime.setAttribute('data-pb-bindings','1');
    runtime.textContent='('+hydrateProducts.toString()+')('+JSON.stringify(bindings).replace(/</g,'\\u003c')+');';doc.body.appendChild(runtime);
  }
  function hydrateProducts(bindings) {
    const cache={};
    for(const b of bindings){
      const el=document.querySelector('[data-pb-id="'+b.id+'"]');if(!el)continue;
      const prefix=/^\/(preview|s)\//.test(location.pathname)?location.pathname.split('/').slice(0,3).join('/'):'';
      cache[b.productId] ||= fetch(prefix+'/api/page-products/'+encodeURIComponent(b.productId)).then(r=>r.ok?r.json():null).catch(()=>null);
      cache[b.productId].then(p=>{
        if(!p)return;
        if(b.field==='cart.add'||b.field==='cart.buyNow'){
          el.addEventListener('click',async e=>{e.preventDefault();e.stopImmediatePropagation();if(!p.variantId)return;
            try{const r=await fetch(prefix+'/cart/add',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({variantId:p.variantId,quantity:1})});if(r.ok)location.href=prefix+(b.field==='cart.buyNow'?'/checkout':'/cart');}catch{}},true);
        }else if(b.field==='image'&&p.image){const img=el.localName==='img'?el:el.querySelector('img');if(img){img.src=p.image;img.removeAttribute('srcset');img.closest('picture')?.querySelectorAll('source').forEach(s=>s.removeAttribute('srcset'));img.alt=p.title;}}
        else if(p[b.field]!==undefined){const walker=document.createTreeWalker(el,4);let t,first;while((t=walker.nextNode())){if(t.parentElement.closest('svg,script,style'))continue;if(t.textContent.trim()){if(!first){first=t;t.textContent=p[b.field];}else t.textContent='';}}if(!first)el.appendChild(document.createTextNode(p[b.field]));}
      });
    }
  }

  function beginInline() {
    const n=current();if(!n||isLocked(n))return;
    if(nodeMeta(n.id).binding){props.querySelector('[data-content]')?.focus();announce('Edit the fallback in Content. The live product value takes priority.');return;}
    if(!textTypes.includes(n.type)&&!isText(n.el))return;
    if(n.el.querySelector('img,svg,input,select,button')){props.querySelector('[data-content]')?.focus();return;}
    commit();begin('edit text');inline={id:n.id,before:n.el.innerHTML,editable:n.el.getAttribute('contenteditable')};
    n.el.setAttribute('data-pb-editing',inline.editable===null?'absent':inline.editable);n.el.setAttribute('contenteditable','true');n.el.draggable=false;n.el.focus();
    const range=doc.createRange();range.selectNodeContents(n.el);const selection=doc.getSelection();selection.removeAllRanges();selection.addRange(range);
    announce('Type to edit · Enter to finish · Esc to cancel');draw();
  }
  function finishInline(save) {
    if(!inline)return;
    const state=inline,n=get(state.id);inline=null;
    if(n){if(!save)n.el.innerHTML=state.before;if(state.editable===null)n.el.removeAttribute('contenteditable');else n.el.setAttribute('contenteditable',state.editable);n.el.removeAttribute('data-pb-editing');}
    if(save){touch();commit();}else transaction=null;
    renderLayers();renderInspector();draw();
  }
  function format(command) {
    if(!inline)return;
    const selection=doc.getSelection();if(!selection?.rangeCount||selection.isCollapsed)return;
    const range=selection.getRangeAt(0);if(!get(inline.id).el.contains(range.commonAncestorContainer))return;
    const wrapper=doc.createElement(command==='bold'?'strong':'em');wrapper.appendChild(range.extractContents());range.insertNode(wrapper);range.selectNodeContents(wrapper);selection.removeAllRanges();selection.addRange(range);touch();
  }
  function legal(parent,node) {
    if(!parent||!node||isLocked(parent)||isLocked(node)||node.type==='Page'||parent.id===node.id||node.el.contains(parent.el))return false;
    if(parent.type==='Page')return node.type==='Section';
    if(!structureTypes.includes(parent.type)&&parent.type!=='List')return false;
    if(parent.type==='Form')return ['Input','Select','Checkbox','Quantity','Button','Add to cart','Buy now','Text','Heading','Group'].includes(node.type);
    if(node.type==='Section')return ['Page','Section','Container'].includes(parent.type);
    return true;
  }
  function sourceParent(n){return get(n?.el?.parentElement?.getAttribute(ID));}
  function clearSelection(){select(null);}
  function cloneNode(n, fragment) {
    const root=fragment?doc.createElement('template'):null;
    if(root)root.innerHTML=fragment.html;
    const el=root?root.content.firstElementChild:n.el.cloneNode(true), oldIds=new Map();
    [el,...el.querySelectorAll('['+ID+']')].forEach(child=>{
      const old=child.getAttribute(ID),id=uid();child.setAttribute(ID,id);if(old){oldIds.set(old,id);const m=(fragment?.nodes||metadata.nodes)[old],o=(fragment?.overrides||metadata.overrides)[old];if(m)metadata.nodes[id]=copy(m);if(o)metadata.overrides[id]=copy(o);}
    });
    // Real document ids remain unique. Mirror id-based site rules for the copy
    // so labels, anchors and styling continue to refer to the copied subtree.
    const documentIds=new Map();[el,...el.querySelectorAll('[id]')].forEach(child=>{if(child.id){const old=child.id;child.id=old+'-copy-'+uid().slice(2,8);documentIds.set(old,child.id);}});
    [el,...el.querySelectorAll('*')].forEach(child=>{['for','aria-labelledby','aria-describedby','aria-controls'].forEach(attr=>{if(child.hasAttribute(attr))child.setAttribute(attr,child.getAttribute(attr).split(/\s+/).map(id=>documentIds.get(id)||id).join(' '));});if(child.getAttribute('href')?.startsWith('#')){const target=documentIds.get(child.getAttribute('href').slice(1));if(target)child.setAttribute('href','#'+target);}});
    if(documentIds.size){let css='';function read(rules){for(const r of rules){if(r.selectorText&&[...documentIds.keys()].some(id=>r.selectorText.includes('#'+CSS.escape(id)))){let selector=r.selectorText;documentIds.forEach((to,from)=>selector=selector.replaceAll('#'+CSS.escape(from),'#'+CSS.escape(to)));css+=selector+'{'+r.style.cssText+'}';}else if(r.cssRules){const previous=css;css='';read(r.cssRules);const nested=css;css=previous+(nested?r.cssText.slice(0,r.cssText.indexOf('{')+1)+nested+'}':'');}}}for(const sheet of doc.styleSheets){if(sheet.ownerNode?.hasAttribute(TEMP)||sheet.ownerNode?.hasAttribute(OVERRIDES))continue;try{read(sheet.cssRules);}catch{}}
      if(css){const style=doc.createElement('style');style.setAttribute('data-pb-copy-styles','1');style.textContent=css;el.appendChild(style);}}
    el.querySelectorAll('style').forEach(style=>{let css=style.textContent;oldIds.forEach((to,from)=>{css=css.replaceAll('['+ID+'="'+from+'"]','['+ID+'="'+to+'"]');});style.textContent=css;});
    clean(el);return el;
  }
  function copySelection(cut=false) {
    const n=current();if(!n||n.type==='Page')return;
    const ids=[n.el,...n.el.querySelectorAll('['+ID+']')].map(el=>el.getAttribute(ID));
    clipboard={html:n.el.outerHTML,nodes:Object.fromEntries(ids.filter(id=>metadata.nodes[id]).map(id=>[id,copy(metadata.nodes[id])])),overrides:Object.fromEntries(ids.filter(id=>metadata.overrides[id]).map(id=>[id,copy(metadata.overrides[id])]))};
    try{sessionStorage.setItem('amboras-page-clipboard',JSON.stringify(clipboard));}catch{}
    if(cut)action('delete');else announce('Copied '+n.type.toLowerCase());
  }
  function pasteSelection() {
    if(!clipboard){try{clipboard=JSON.parse(sessionStorage.getItem('amboras-page-clipboard'));}catch{}}
    if(!clipboard)return;
    const n=current(),parent=n?.type==='Page'?n:sourceParent(n||{});if(!parent)return;
    operation('paste element',()=>{const el=cloneNode(n,clipboard);const inferred=infer(el);if(!legal(parent,{id:el.getAttribute(ID),el,type:inferred.type})){announce('Choose a section or a sibling that can contain this element.');return;}parent.el.insertBefore(el,n.type==='Page'?null:n.el.nextSibling);selected=el.getAttribute(ID);syncBindingRuntime();});
  }
  function action(name) {
    const n=current();if(!n)return;
    if(name==='padding'){focusPadding();return;}
    if(name==='design'){focusedTab='design';renderInspector();return;}
    if(name==='replace'){props.querySelector('[data-attribute="src"]')?.focus();return;}
    if(name==='upload'){fileInput.click();return;}
    if(name==='write'){beginInline();return;}
    if(name==='library'){saveSection(n);return;}
    if(name==='peek'){showHidden.has(n.id)?showHidden.delete(n.id):showHidden.add(n.id);doc.querySelectorAll('[data-pb-peek]').forEach(el=>el.removeAttribute('data-pb-peek'));showHidden.forEach(id=>{let node=get(id);while(node){const s=computed(node.el);if(node.id===id||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)node.el.setAttribute('data-pb-peek','');node=get(node.parent);}});renderInspector();draw();return;}
    if(name==='lock'){operation('toggle layer lock',()=>nodeMeta(n.id).locked=!nodeMeta(n.id).locked);return;}
    if(isLocked(n)||n.type==='Page'){announce('Select an unlocked content layer or section.');return;}
    if(name==='move-to'){openMove(n);return;}
    if(name==='fit-content'){operation('fit content',()=>{['height','min-height','padding-top','padding-bottom','margin-top','margin-bottom'].forEach(key=>{n.el.style.removeProperty(key);setStyle(n.id,key,key==='height'?'auto':'0px')});});return;}
    if(name==='copy'){copySelection();return;}
    if(name==='delete'&&n.el.matches('button[type="submit"],input[type="submit"]')&&n.el.closest('form')?.querySelectorAll('[type="submit"]').length===1){if(!confirm('This is the form’s only submit button. Delete it?'))return;}
    operation(name==='duplicate'?'duplicate '+n.type.toLowerCase():name,()=>{
      if(name==='duplicate'){const el=cloneNode(n);n.el.after(el);selected=el.getAttribute(ID);syncBindingRuntime();}
      if(name==='delete'){selected=parentOf(n)?.id||null;n.el.remove();syncBindingRuntime();}
      if(name==='up'&&n.el.previousElementSibling)n.el.previousElementSibling.before(n.el);
      if(name==='down'&&n.el.nextElementSibling)n.el.nextElementSibling.after(n.el);
      if(name==='visibility')setStyle(n.id,'display',hidden(n.el)?(rules(n.id).display==='none'?'':'block'):'none');
      if(name==='apply-code')n.el.innerHTML=props.querySelector('#element-code').value;
      if(name==='unbind'){const binding=nodeMeta(n.id).binding;if(binding){n.el.innerHTML=binding.fallbackHtml;[...n.el.attributes].forEach(a=>{if(a.name!==ID&&a.name!=='id')n.el.removeAttribute(a.name);});Object.entries(binding.fallbackAttributes).forEach(([k,v])=>{if(k!==ID&&k!=='id')n.el.setAttribute(k,v);});n.el.setAttribute(ID,n.id);[...(imageElement(n)?.closest('picture')?.querySelectorAll('source')||[])].forEach((el,i)=>{const attrs=binding.fallbackSources?.[i];if(attrs){[...el.attributes].forEach(a=>el.removeAttribute(a.name));Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));}});if(binding.field==='image'&&binding.fallbackOverrides)metadata.overrides[n.id]=binding.fallbackOverrides;delete nodeMeta(n.id).binding;syncBindingRuntime();}}
    });
  }
  const moveDialog=document.createElement('dialog');moveDialog.className='move-dialog';moveDialog.innerHTML='<form method="dialog"><h2>Move element</h2><label>Destination container<select aria-label="Destination container"></select></label><div><button class="btn" value="cancel">Cancel</button><button type="button" class="btn primary" data-move-apply>Move inside</button></div></form>';document.body.appendChild(moveDialog);
  function openMove(n){
    const select=moveDialog.querySelector('select');select.replaceChildren();
    model.forEach(destination=>{if(legal(destination,n)){const option=document.createElement('option');option.value=destination.id;let depth=0,parent=get(destination.parent);while(parent){depth++;parent=get(parent.parent);}option.textContent='— '.repeat(depth)+destination.type+' · '+nodeName(destination);select.appendChild(option);}});
    if(!select.options.length){announce('No available container can hold this element.');return;}
    moveDialog.querySelector('[data-move-apply]').onclick=()=>{const destination=get(select.value);if(!legal(destination,n))return;operation('move element',()=>{destination.el.appendChild(n.el);selected=n.id;});moveDialog.close();announce('Element moved into '+nodeName(destination));};moveDialog.showModal();
  }
  function startDrag(event,n) {
    if(!n||isLocked(n)||inline){event.preventDefault();return;}
    commit();drag=n.id;selected=n.id;
    event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/x-page-element',n.id);
    const ghost=document.createElement('div');ghost.className='drag-ghost';ghost.textContent=n.type+' · '+nodeName(n);document.body.appendChild(ghost);event.dataTransfer.setDragImage(event.target.ownerDocument===doc?n.el:ghost,10,10);setTimeout(()=>ghost.remove(),0);
  }
  function horizontalFlow(parent){if(!parent)return false;const style=computed(parent.el);return style.display.includes('flex')&&style.flexDirection.startsWith('row')||style.display.includes('grid')&&style.gridTemplateColumns.split(/\s+/).length>1;}
  function setDrop(target,mode) {
    if(!drag||!target)return;
    const parent=mode==='inside'?target:sourceParent(target);
    const moving=get(drag);
    drop={target:target.id,parent:parent?.id,mode,horizontal:!sectionDrag&&mode!=='inside'&&horizontalFlow(parent),valid:legal(parent,sectionDrag?{...moving,type:'Section'}:moving)};draw();
  }
  function canvasDestination(e) {
    let target=hit(e);const moving=get(drag);if(!target||!moving){drop=null;draw();return;}
    // Transparent imported wrappers still define real horizontal grid cells.
    if(horizontalFlow(sourceParent(moving))){
      let sibling=get(e.target?.closest('['+ID+']')?.getAttribute(ID));
      while(sibling&&sibling.el.parentElement!==moving.el.parentElement)sibling=get(sibling.parent);
      if(sibling&&sibling.id!==moving.id)target=sibling;
    }
    // Section drags reorder whole sibling regions. A heading, image or button
    // under the pointer must not become the new parent of the section.
    if(sectionDrag||sectionOf(moving)?.id===moving.id){
      dwell=null;
      while(target&&target.el.parentElement!==moving.el.parentElement)target=get(target.parent);
      if(!target||target.id===moving.id){drop=null;draw();return;}
      const bounds=target.el.getBoundingClientRect();
      setDrop(target,e.clientY<bounds.top+bounds.height/2?'before':'after');return;
    }
    const empty=e.target?.closest('[data-pb-empty-target]');
    if(empty){const destination=get(empty.getAttribute(ID));if(destination&&legal(destination,moving)){dwell=null;setDrop(destination,'inside');return;}}
    const r=target.el.getBoundingClientRect(),same=target.el.parentElement===moving.el.parentElement;
    const inner=structureTypes.includes(target.type)&&e.clientX>r.left+12&&e.clientX<r.right-12&&e.clientY>r.top+12&&e.clientY<r.bottom-12;
    if(inner){
      if(dwell?.id!==target.id){const candidate={id:target.id,since:performance.now()};dwell=candidate;setTimeout(()=>{if(drag&&dwell===candidate)setDrop(target,'inside');},150);}
      if(performance.now()-dwell.since>=150){setDrop(target,'inside');return;}
    }else dwell=null;
    if(same){const horizontal=horizontalFlow(sourceParent(target));setDrop(target,(horizontal?e.clientX<r.left+r.width/2:e.clientY<r.top+r.height/2)?'before':'after');return;}
    if(drop?.mode==='inside'){const box=get(drop.target).el.getBoundingClientRect();if(e.clientX>=box.left-8&&e.clientX<=box.right+8&&e.clientY>=box.top-8&&e.clientY<=box.bottom+8)return;}
    const horizontal=horizontalFlow(sourceParent(target));setDrop(target,(horizontal?e.clientX<r.left+r.width/2:e.clientY<r.top+r.height/2)?'before':'after');
  }
  function beginPointerDrag(e,n,handle=false) {
    if(!n||n.type==='Page'||isLocked(n)||inline||e.button!==0)return;

    const section=sectionOf(n)?.id===n.id?n:null;
    let root=n;
    if(n.el.localName==='img'&&n.el.parentElement?.localName==='picture')root=sourceParent(n)||n;
    if(section)while(get(root.parent)?.type==='Wrapper'&&get(root.parent).children.length===1)root=get(root.parent);
    pointerDrag={id:root.id,section:section?.id,x:e.clientX,y:e.clientY,owner:e.target.ownerDocument,target:e.currentTarget?.nodeType===1?e.currentTarget:e.target,pointer:e.pointerId,active:false};
    pointerDrag.target.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  }
  function pointerMove(e) {
    if(!pointerDrag)return;
    const state=pointerDrag,fromCanvas=e.target.ownerDocument===doc;
    if(!state.active&&Math.hypot(e.clientX-state.x,e.clientY-state.y)<5)return;
    if(!state.active){commit();drag=state.id;sectionDrag=state.section;selected=state.section||state.id;state.active=true;chrome.classList.add('moving');doc.getSelection()?.removeAllRanges();}
    e.preventDefault();
    const f=frame.getBoundingClientRect(),x=fromCanvas?e.clientX:(e.clientX-f.left)/scale,y=fromCanvas?e.clientY:(e.clientY-f.top)/scale;
    const target=doc.elementFromPoint(x,y);
    if(target)canvasDestination({target,clientX:x,clientY:y});else{drop=null;draw();}
    if(y<28)doc.defaultView.scrollBy(0,-12);else if(y>doc.documentElement.clientHeight-28)doc.defaultView.scrollBy(0,12);
  }
  function pointerUp(e) {
    if(!pointerDrag)return;const active=pointerDrag.active;pointerDrag.target.releasePointerCapture?.(pointerDrag.pointer);pointerDrag=null;
    if(active){suppressCanvasClick=true;e.preventDefault();performDrop();}
  }
  document.addEventListener('pointermove',pointerMove);document.addEventListener('pointerup',pointerUp);
  document.addEventListener('pointercancel',()=>{if(pointerDrag){pointerDrag=null;endDrag();}});
  function endDrag(){drag=null;drop=null;dwell=null;sectionDrag=null;chrome.classList.remove('moving');layers.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(n=>n.classList.remove('drop-before','drop-after','drop-inside'));renderLayers();renderInspector();draw();}
  function performDrop() {
    if(!drop?.valid){announce('That element cannot be moved here.');endDrag();return;}
    const n=get(drag),target=get(drop.target),mode=drop.mode;
    if(n.id===target.id||(mode==='before'&&n.el.nextElementSibling===target.el)||(mode==='after'&&n.el.previousElementSibling===target.el)){endDrag();return;}
    const kind=sectionDrag?'Section':n.type,selection=sectionDrag||n.id;
    operation('move '+kind.toLowerCase(),()=>{if(mode==='inside')target.el.appendChild(n.el);else if(mode==='before')target.el.before(n.el);else target.el.after(n.el);selected=selection;});endDrag();
    announce(kind+' moved. Use Undo to restore its position.');
  }

  /* CANVAS_STATE_HELPERS */
  /* COLUMN_LAYOUT_HELPERS */

  const templates={
    Section:['section','Section','<div data-pb-native="Container"><h2>Your next chapter</h2><p>Add a story, an offer or a reason to believe.</p></div>'],
    Heading:['h2','Heading','A headline that says it simply'],Text:['p','Text','Tell your story. Make every word count.'],Button:['a','Button','Shop now'],Image:['img','Image',''],Container:['div','Container',''],Row:['div','Row',''],Columns:['div','Columns','<div data-pb-native="Column" data-pb-column></div><div data-pb-native="Column" data-pb-column></div>'],Divider:['hr','Divider',''],FAQ:['details','FAQ','<summary>Your question</summary><p>A helpful answer.</p>'],Price:['span','Price','$49.00']
  };
  const insert=document.createElement('dialog');insert.className='insert-dialog';document.body.appendChild(insert);
  let insertion='after';
  function openInsert(mode='after') {
    insertion=mode;
    let n=current(),parent=mode==='inside'?n:sourceParent(n||{});
    if(mode==='section'||!n)parent=[...model.values()].find(n=>n.type==='Page');
    const allowed=Object.entries(templates).filter(([type])=>legal(parent,{id:'new',type,el:doc.createElement('div')}));
    if(parent?.type==='Page')allowed.sort((a,b)=>a[0]==='Section'?-1:1);
    if(n?.type==='Button')allowed.sort((a,b)=>a[0]==='Button'?-1:1);
    insert.innerHTML='<div class="insert-heading"><div><h2>Add to your page</h2><p>'+esc(parent?'Inside '+nodeName(parent):'Select a container first')+'</p></div><button class="btn" data-close>Close</button></div><div class="insert-grid">'+allowed.map(([type])=>'<button data-insert="'+type+'"><strong>'+type+'</strong><span>'+({Section:'A new page section',Heading:'Make a clear statement',Text:'A paragraph of copy',Button:'A link or call to action',Image:'Your image',Container:'Group content together',Row:'Place items side by side',Columns:'Adjustable columns for your content',Divider:'Separate content',FAQ:'Question and answer',Price:'A product price'}[type])+'</span></button>').join('')+'</div><label class="check"><input id="match-style" type="checkbox" checked> Match the nearest similar element’s style</label>';
    insert.querySelector('[data-close]').onclick=()=>insert.close();
    insert.querySelectorAll('[data-insert]').forEach(b=>b.onclick=()=>insertElement(b.dataset.insert,parent,n,insert.querySelector('#match-style').checked));
    insert.showModal();
  }
  function insertElement(type,parent,neighbor,match) {
    if(!parent)return;
    operation('insert '+type.toLowerCase(),()=>{
      const [tag,kind,html]=templates[type],el=doc.createElement(tag);el.innerHTML=html;el.setAttribute(ID,uid());el.setAttribute('data-pb-native',kind);
      if(tag==='a'){el.href='#';el.setAttribute('role','button');}
      if(tag==='img'){el.alt='Describe this image';el.src='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="100%" height="100%" fill="#e7ecf3"/><text x="50%" y="50%" text-anchor="middle" fill="#59687a" font-family="sans-serif" font-size="24">Replace image</text></svg>');}
      if(insertion==='inside'||insertion==='section'||!neighbor||neighbor.el.parentElement!==parent.el)parent.el.appendChild(el);else neighbor.el.after(el);
      const id=el.getAttribute(ID),atBreakpoint=breakpoint;breakpoint='desktop';
      const initial={Section:{'padding-top':'64px','padding-bottom':'64px','padding-left':'32px','padding-right':'32px'},Heading:{'font-size':'36px','line-height':'1.15'},Text:{'font-size':'18px','line-height':'1.6'},Button:{'display':'inline-block','padding-top':'12px','padding-bottom':'12px','padding-left':'24px','padding-right':'24px','background-color':'#2563eb','color':'#ffffff','border-radius':'6px'},Row:{display:'flex',gap:'24px'},Columns:{display:'grid',gap:'24px'},Container:{'min-height':'80px'},Image:{width:'100%','max-width':'800px'}}[type]||{};
      Object.entries(initial).forEach(([k,v])=>setStyle(id,k,v));
      if(match){const sibling=[...model.values()].filter(c=>c.type===type&&c.el!==el).sort((a,b)=>Math.abs(a.el.getBoundingClientRect().top-el.getBoundingClientRect().top)-Math.abs(b.el.getBoundingClientRect().top-el.getBoundingClientRect().top))[0];if(sibling){const s=computed(sibling.el);['font-family','font-size','font-weight','line-height','color','background-color','border-radius','padding-top','padding-right','padding-bottom','padding-left'].forEach(k=>setStyle(id,k,s.getPropertyValue(k)));}}
      if(type==='Columns'){analyze();applyVisualColumns(get(id),2,[50,50],'desktop');}
      breakpoint=atBreakpoint;selected=id;
    });insert.close();if(type==='Image')props.querySelector('[data-attribute="src"]')?.focus();
  }
  plus.onclick=()=>openInsert();
  const addPanel=document.querySelector('[data-panel-body="add"]');
  addPanel.innerHTML='<div class="panel-head"><strong>Add content</strong><span>Build on the design you already have</span></div><button class="btn primary wide" id="add-section">Add section</button><button class="btn wide" id="add-element">Add after selection</button><button class="btn wide" id="add-inside">Add inside selection</button><div class="editor-intro"><strong>Make it feel at home</strong><span>New content can inherit the typography, colors and spacing of similar elements.</span></div><div id="section-library"></div>';
  $('add-section').onclick=()=>openInsert('section');$('add-element').onclick=()=>openInsert();$('add-inside').onclick=()=>openInsert('inside');
  function renderLibrary() { $('section-library').innerHTML='<h3>Saved sections</h3>'+(window.__PRESETS||[]).filter(p=>p.type==='custom-html').map(p=>'<button class="library-section" data-preset="'+esc(p.id)+'">'+esc(p.name)+'</button>').join('');$('section-library').querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{const preset=window.__PRESETS.find(p=>p.id===b.dataset.preset);operation('insert saved section',()=>{const el=cloneNode(current(),{html:preset.settings.html,nodes:{},overrides:{}});const root=[...model.values()].find(n=>n.type==='Page');root.el.appendChild(el);selected=el.getAttribute(ID);});}); }
  function sectionStyles(n) {
    const elements=[n.el,...n.el.querySelectorAll('['+ID+']')],inherited=['font-family','font-size','font-weight','font-style','line-height','color','letter-spacing','text-align','text-transform'];
    const rootSelector=':where(['+ID+'="'+n.id+'"])',style=computed(n.el),ancestors=[];
    for(let parent=n.el.parentElement;parent;parent=parent.parentElement)ancestors.push(parent);
    const defaults=[...inherited,...Array.from(style).filter(key=>key.startsWith('--'))].map(key=>key+':'+style.getPropertyValue(key)).join(';');
    // Project the source cascade onto stable element ids. :where contributes
    // no specificity, so class/id/type precedence and media rules survive
    // reuse without leaking source selectors into the destination page.
    function selectors(value){let start=0,depth=0,quote='',out=[];for(let i=0;i<value.length;i++){const c=value[i];if(c==='\\'){i++;continue;}if(quote){if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='('||c==='[')depth++;if(c===')'||c===']')depth--;if(c===','&&!depth){out.push(value.slice(start,i));start=i+1;}}out.push(value.slice(start));return out.map(value=>value.trim());}
    function project(rules){let css='';for(const rule of rules){
      if(rule.selectorText){for(const selector of selectors(rule.selectorText)){
        const pseudo=/::?(before|after|marker|placeholder)\b/.exec(selector)?.[0]||'',base=pseudo?selector.replace(pseudo,''):selector;
        const states=(base.match(/:(?:hover|focus-visible|focus-within|focus|active|checked|disabled|target)\b/g)||[]).join(''),match=base.replace(/:(?:hover|focus-visible|focus-within|focus|active|checked|disabled|target)\b/g,'');
        try{
          if(!pseudo&&!states&&ancestors.some(el=>el.matches(match))){const declarations=[...rule.style].filter(key=>inherited.includes(key)||key.startsWith('--')).map(key=>key+':'+rule.style.getPropertyValue(key)).join(';');if(declarations)css+=rootSelector+'{'+declarations+'}';}
          for(const el of elements)if(el.matches(match)){
            const target=':where(['+ID+'="'+el.getAttribute(ID)+'"])';
            css+=':is('+base+','+target+states+')'+target+pseudo+'{'+rule.style.cssText+'}';
          }
        }catch{}
      }}else if(rule.type===7){css+=rule.cssText;}else if(rule.cssRules){const nested=project(rule.cssRules);if(nested)css+=rule.cssText.slice(0,rule.cssText.indexOf('{')+1)+nested+'}';}
      else if(rule.type===5)css+=rule.cssText;
    }return css;}
    let css=rootSelector+'{'+defaults+'}';
    for(const sheet of doc.styleSheets){if(sheet.disabled||sheet.ownerNode?.hasAttribute(TEMP))continue;try{const projected=project(sheet.cssRules),media=sheet.media?.mediaText;if(projected)css+=media&&media!=='all'?'@media '+media+'{'+projected+'}':projected;}catch{}}
    return css;
  }
  async function saveSection(n) {
    const name=prompt('Name this reusable section',nodeName(n).slice(0,60));if(!name?.trim())return;
    if(inline)finishInline(true);commit();
    let root=clean(n.el.cloneNode(true));root.querySelectorAll('script,style').forEach(s=>s.remove());
    const style=doc.createElement('style');style.textContent=sectionStyles(n);
    if(root.matches('area,base,br,col,embed,hr,img,input,link,meta,param,source,track,wbr')){const wrapper=doc.createElement('div');wrapper.style.display='contents';wrapper.appendChild(root);root=wrapper;}
    root.setAttribute('data-pb-imported-section','');root.appendChild(style);
    try{const response=await fetch('/admin/pages/'+window.__PAGE.id+'/html-presets?storeId='+encodeURIComponent(window.__PAGE.storeId),{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:name.trim(),html:root.outerHTML})});const out=await response.json();if(!response.ok||out.error)throw Error(out.error||'Could not save section');window.__PRESETS.unshift(out.preset);renderLibrary();announce('Section saved to your template library');}catch(e){announce(e.message);}
  }

  function keydown(e) {
    if(e.target.closest?.('.editor-media'))return;
    if(e.key==='Escape'&&pointerDrag){pointerDrag.target.releasePointerCapture?.(pointerDrag.pointer);pointerDrag=null;endDrag();e.preventDefault();return;}
    if(!insert.open&&document.querySelector('.drawer:not([hidden]),.preview-overlay:not([hidden])'))return;
    const key=e.key.toLowerCase(),mod=e.metaKey||e.ctrlKey;
    if(inline){if(mod&&['b','i'].includes(key)){e.preventDefault();format(key==='b'?'bold':'italic');return;}if(key==='escape'){e.preventDefault();finishInline(false);return;}if(key==='enter'&&!e.shiftKey){e.preventDefault();finishInline(true);return;}return;}
    if(e.target.closest?.('input,textarea,select,[contenteditable="true"]'))return;
    if(mod&&key==='z'){e.preventDefault();e.stopPropagation();e.shiftKey?window.__HTML_REDO():window.__HTML_UNDO();return;}
    if(mod&&key==='y'){e.preventDefault();window.__HTML_REDO();return;}
    if(mod&&key==='d'){e.preventDefault();action('duplicate');return;}
    if(mod&&key==='c'){e.preventDefault();copySelection();return;}
    if(mod&&key==='x'){e.preventDefault();copySelection(true);return;}
    if(mod&&key==='v'){e.preventDefault();pasteSelection();return;}
    if(mod&&key==='s'){e.preventDefault();$('save').click();return;}
    if(key==='escape'){clearSelection();return;}
    const n=current();if(!n)return;
    if(key==='delete'||key==='backspace'){e.preventDefault();action('delete');}
    if(key==='enter'){e.preventDefault();select(e.shiftKey?parentOf(n)?.id:childrenOf(n)[0]?.id||n.id);}
    if(key==='arrowup'||key==='arrowdown'){e.preventDefault();action(key==='arrowup'?'up':'down');}
    if(key==='tab'&&e.target.ownerDocument===doc){const siblings=childrenOf(parentOf(n)),index=siblings.indexOf(n)+(e.shiftKey?-1:1);if(siblings[index]){e.preventDefault();select(siblings[index].id,true);}}
  }
  document.addEventListener('keydown',keydown,true);

  function attach() {
    try{doc=frame.contentDocument;}catch{return;}
    if(!doc?.body)return;
    observer?.disconnect();resizeObserver?.disconnect();
    let saved;try{saved=JSON.parse(metadataNode(doc)?.textContent||'{}');}catch{saved={};}
    metadata={version:1,nodes:saved.nodes&&typeof saved.nodes==='object'?saved.nodes:{},overrides:saved.overrides&&typeof saved.overrides==='object'?saved.overrides:{}};
    if(pendingLoad){selected=pendingLoad.selected;changed=pendingLoad.changed;original=pendingLoad.original;pendingLoad=null;}else{selected=null;changed=false;original=source.value;}
    loading=false;hovered=null;hoverFrom=null;
    doc.querySelectorAll('['+TEMP+']').forEach(n=>n.remove());
    const freeze=doc.createElement('style');freeze.setAttribute(TEMP,'1');freeze.textContent='*,*::before,*::after{animation-play-state:paused!important;transition:none!important;scroll-behavior:auto!important} [data-pb-peek]{display:block!important;visibility:visible!important;opacity:1!important} [data-pb-editing]{cursor:text!important;outline:none!important}';doc.head.appendChild(freeze);
    freeze.textContent+=' [data-pb-empty-target]{min-height:64px!important;min-width:48px!important;outline:1px dashed #93c5fd!important;outline-offset:-1px} [data-pb-empty-target]:before{content:"Drop content here";display:block;padding:16px;color:#64748b;font:12px sans-serif} [data-pb-column]:empty{min-height:96px;outline:1px dashed #93c5fd;outline-offset:-1px}[data-pb-column]:empty:before{content:"Drop content here";display:block;padding:24px 12px;color:#64748b;font:13px sans-serif} [data-pb-cart-editing]{display:flex!important;visibility:visible!important;opacity:1!important;transform:none!important;position:fixed!important;inset:0!important;z-index:9999!important;max-width:100vw!important} [data-pb-cart-editing] .drawer__inner{transform:none!important;visibility:visible!important;max-width:100vw!important}';
    applySourceTheme(doc,window.__BRAND||{},{temporary:true,fontDocument:document});
    setupCanvasState(freeze);
    cartEditor.hidden=!doc.querySelector('cart-drawer,#CartDrawer,#cart-drawer,.cart-drawer,[data-cart-drawer]');cartEditor.textContent='Edit cart drawer';
    doc.querySelectorAll('video,audio').forEach(el=>{el.pause();});
    analyze();syncOverrides();select(selected);renderLibrary();fit();historyButtons();$('save').disabled=false;$('publish').disabled=false;
    doc.addEventListener('click',e=>{if(suppressCanvasClick){suppressCanvasClick=false;e.preventDefault();e.stopImmediatePropagation();return;}if(inline&&get(inline.id)?.el.contains(e.target))return;e.preventDefault();e.stopImmediatePropagation();const n=hit(e);if(n)select(n.id);},true);
    doc.addEventListener('dblclick',e=>{e.preventDefault();e.stopImmediatePropagation();const n=hit(e);if(!n)return;select(n.id);if(imageElement(n))action('replace');else if(textTypes.includes(n.type))beginInline();else select(childrenOf(n)[0]?.id||n.id);},true);
    doc.addEventListener('submit',e=>{e.preventDefault();e.stopImmediatePropagation();},true);
    doc.addEventListener('pointerdown',e=>{suppressCanvasClick=false;if(inline&&get(inline.id)?.el.contains(e.target))return;const n=hit(e);if(n)beginPointerDrag(e,n);if(e.target.closest('input,select,textarea,button,a'))e.preventDefault();},true);
    doc.addEventListener('mouseover',e=>{if(drag||inline)return;const n=hit(e);hoveredSection=sectionOf(n)?.id||null;setHover(n?.id,'canvas');},true);
    doc.addEventListener('mouseleave',()=>clearHover('canvas'));
    doc.addEventListener('keydown',keydown,true);
    doc.addEventListener('input',e=>{if(inline&&get(inline.id)?.el.contains(e.target))touch();});
    doc.addEventListener('paste',e=>{if(!inline)return;e.preventDefault();const text=e.clipboardData.getData('text/plain'),selection=doc.getSelection();if(!selection.rangeCount)return;const range=selection.getRangeAt(0);range.deleteContents();const node=doc.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);touch();});
    doc.addEventListener('focusout',()=>{if(inline)setTimeout(()=>{if(inline&&!get(inline.id)?.el.contains(doc.activeElement))finishInline(true);},0);});
    // Every editable block can be grabbed on the first gesture. A movement
    // threshold preserves selection and double-click text editing.
    doc.addEventListener('dragstart',e=>e.preventDefault(),true);
    doc.addEventListener('pointermove',pointerMove);doc.addEventListener('pointerup',pointerUp);doc.addEventListener('pointercancel',()=>{if(pointerDrag){pointerDrag=null;endDrag();}});
    doc.addEventListener('dragend',endDrag,true);
    doc.addEventListener('dragover',e=>{if(!drag)return;e.preventDefault();canvasDestination(e);},true);
    doc.addEventListener('drop',e=>{e.preventDefault();performDrop();},true);
    doc.addEventListener('scroll',draw,true);doc.defaultView.addEventListener('resize',draw);
    resizeObserver=new ResizeObserver(draw);resizeObserver.observe(doc.body);
    observer=new MutationObserver(draw);observer.observe(doc.body,{childList:true,subtree:true,attributes:true,characterData:true});
    doc.querySelectorAll('img').forEach(img=>img.addEventListener('load',draw));
    $('canvas-help').textContent='Click to select · double-click to write';

  }
  source.addEventListener('focus',()=>{sourceBefore=snapshot();});
  source.addEventListener('input',()=>{
    if(document.activeElement!==source)return;
    clearTimeout(sourceTimer);sourceTimer=setTimeout(()=>{
      sourceTimer=null;const after={raw:source.value,selected:null,changed:false,original:source.value};undo.push({label:'edit source',before:sourceBefore||snapshot(),after});redo=[];sourceBefore=after;load(after);
    },650);
  });
  frame.addEventListener('load',attach);
  if(frame.contentDocument?.readyState==='complete'&&frame.contentDocument.URL!=='about:blank')attach();
  // Deliberately expose the same operations used by the UI for integration
  // tests and accessibility automation, not a second editing implementation.
  window.__PAGE_EDITOR={select,action,serialize:()=>serialize(),getModel:()=>[...model.values()].map(n=>({id:n.id,type:n.type,label:n.label,parent:n.parent})),getSelected:()=>selected,undo:window.__HTML_UNDO,redo:window.__HTML_REDO,getHistory:()=>undo.map(o=>o.label),getBreakpoint:()=>breakpoint};
})();
