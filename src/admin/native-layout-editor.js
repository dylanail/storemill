/* Runs inside the native editor closure, sharing its save and undo state. */
function nativeColumnDevice() {
  const width = document.querySelector('[data-width].on')?.dataset.width || '1200px';
  return width === '390px' ? 'mobile' : width === '820px' ? 'tablet' : 'desktop';
}
function nativeColumnSettings(block) {
  const device = nativeColumnDevice(), s = block.settings;
  const countKey = device === 'desktop' ? 'perRow' : device + 'PerRow';
  const widthKey = device === 'desktop' ? 'columnWidths' : device + 'ColumnWidths';
  const validCount = (value, fallback) => Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6 ? Number(value) : fallback;
  const desktop = validCount(s.perRow, 3);
  const count = validCount(s[countKey], device === 'tablet' ? Math.min(2, desktop) : device === 'mobile' ? 1 : desktop);
  return {device, countKey, widthKey, count, widths: window.__COLUMN_LAYOUT.normalize(s[widthKey], count)};
}
function mountNativeColumns(block) {
  if (state.mode !== 'blocks' || block.type !== 'multicolumn') return;
  const config = nativeColumnSettings(block), tools = window.__COLUMN_LAYOUT;
  const host = document.createElement('div');host.innerHTML = tools.panel(config.count, config.widths, config.device[0].toUpperCase() + config.device.slice(1));props.prepend(host);
  let captured = false;
  const begin = () => { if (!captured) { push(); captured = true; } };
  tools.bind(host, config.widths, values => { block.settings[config.widthKey] = values.join(',');setDirty(true);render(); }, count => {
    push();block.settings[config.countKey] = count;block.settings[config.widthKey] = tools.normalize([], count).join(',');render();edit();
  }, begin, () => { captured = false; });
}
function nativeColumnsPreview(block) {
  if (block.type !== 'multicolumn') return '';
  const config = nativeColumnSettings(block);
  return '<div class="block-columns-preview" style="grid-template-columns:' + window.__COLUMN_LAYOUT.tracks(config.widths) + '">' + String(block.settings.columns || '').split('\n').filter(Boolean).map(line => {const parts=line.split('|');return '<div><strong>'+esc(parts[1]||'Column')+'</strong><span>'+esc(parts[2]||'')+'</span></div>';}).join('') + '</div>';
}
if (state.mode === 'blocks') {
  let gesture = null, animation = null, suppressUntil = 0;
  const stage = $('stage');
  const layerList=$('layers');
  let layerHoverFrom=null;
  function clearLayerHover(from) {
    if(from&&layerHoverFrom!==from)return;
    layerHoverFrom=null;
    document.querySelectorAll('.layer-highlight').forEach(el=>el.classList.remove('layer-highlight'));
  }
  function hoverLayer(row,from) {
    if(!row||gesture?.active)return;
    clearLayerHover();
    const card=list.querySelector('[data-i="'+row.dataset.layer+'"]');
    if(!card)return;
    layerHoverFrom=from;row.classList.add('layer-highlight');card.classList.add('layer-highlight');
    const r=card.getBoundingClientRect(),viewport=stage.getBoundingClientRect();
    if(r.bottom<=viewport.top||r.top>=viewport.bottom)card.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  }
  layerList.addEventListener('mouseover',event=>{
    const row=event.target.closest('[data-layer]');
    if(row&&!row.contains(event.relatedTarget))hoverLayer(row,'pointer');
  });
  layerList.addEventListener('mouseout',event=>{
    const row=event.target.closest('[data-layer]');
    if(row&&!row.contains(event.relatedTarget))clearLayerHover('pointer');
  });
  layerList.addEventListener('focusin',event=>hoverLayer(event.target.closest('[data-layer]'),'focus'));
  layerList.addEventListener('focusout',event=>{
    if(!event.target.closest('[data-layer]')?.contains(event.relatedTarget))clearLayerHover('focus');
  });
  layerList.addEventListener('dragstart',()=>clearLayerHover());
  window.addEventListener('blur',()=>clearLayerHover());
  function stop() {
    if(animation !== null)cancelAnimationFrame(animation);animation=null;
    if(gesture?.target.hasPointerCapture?.(gesture.pointer))gesture.target.releasePointerCapture(gesture.pointer);
    gesture=null;list.classList.remove('block-moving');clearOver();
  }
  function destination() {
    clearOver();if(!gesture)return;
    const target=document.elementFromPoint(gesture.x,gesture.y)?.closest('#list > .canvas-block');
    if(!target){gesture.at=null;return;}
    const rect=target.getBoundingClientRect(),before=gesture.y<rect.top+rect.height/2;
    gesture.at=Number(target.dataset.i)+(before?0:1);target.classList.add(before?'over-before':'over-after');
  }
  function scroll() {
    if(!gesture?.active)return;
    const rect=stage.getBoundingClientRect();
    if(gesture.y<rect.top+42)stage.scrollTop-=14;else if(gesture.y>rect.bottom-42)stage.scrollTop+=14;
    destination();animation=requestAnimationFrame(scroll);
  }
  list.addEventListener('pointerdown',event=>{
    const card=event.target.closest('.canvas-block');
    if(!card||event.button!==0||event.target.closest('button,input,select,textarea'))return;
    gesture={id:state.blocks[Number(card.dataset.i)]?.id,pointer:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,at:null,target:card};
    card.setPointerCapture(event.pointerId);event.preventDefault();
  });
  list.addEventListener('dragstart',event=>{if(gesture)event.preventDefault();},true);
  document.addEventListener('pointermove',event=>{
    if(!gesture)return;gesture.x=event.clientX;gesture.y=event.clientY;
    if(!gesture.active&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<5)return;
    if(!gesture.active){gesture.active=true;list.classList.add('block-moving');document.getSelection()?.removeAllRanges();animation=requestAnimationFrame(scroll);}
    event.preventDefault();destination();
  });
  document.addEventListener('pointerup',event=>{
    if(!gesture)return;
    const {id,at,active}=gesture;stop();if(!active)return;
    event.preventDefault();suppressUntil=performance.now()+150;
    const from=state.blocks.findIndex(block=>block.id===id);
    if(at===null||from<0||at===from||at===from+1)return;
    push();const block=state.blocks.splice(from,1)[0],index=at>from?at-1:at;
    state.blocks.splice(index,0,block);state.selected=index;render();edit();
  });
  document.addEventListener('pointercancel',stop);
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&gesture){suppressUntil=performance.now()+150;stop();event.preventDefault();}});
  list.addEventListener('click',event=>{if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},true);
  document.querySelectorAll('[data-width]').forEach(button=>button.addEventListener('click',()=>{render();edit();}));
}
