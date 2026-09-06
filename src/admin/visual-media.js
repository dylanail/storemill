/* Uses the visual editor's document model and undo transaction. */
function mediaUrl(value) {
  if(!value)return '';
  try{const url=new URL(value,doc.baseURI);return url.origin===location.origin&&/^\/_(uploads|media)\//.test(url.pathname)?url.pathname+url.search:url.href;}catch{return value;}
}
function mediaDescriptors(n) {
  if(!n)return [];
  const entries=[],img=imageElement(n),video=n.el.localName==='video'?n.el:null,embed=n.el.localName==='iframe'?n.el:null;
  const descriptor=(element,slot,kind,label,read,write,embedded=false)=>({key:element.getAttribute(ID)+':'+slot,kind,label,read:()=>mediaUrl(read()),write,embed:embedded});
  if(img)entries.push(descriptor(img,'src','image','Image',()=>img.getAttribute('src')||'',url=>{
    model.forEach(node=>{if(imageElement(node)===img&&metadata.nodes[node.id]?.binding?.field==='image')delete metadata.nodes[node.id].binding;});
    if(computed(img).objectFit==='fill')setStyle(img.getAttribute(ID),'object-fit','contain');
    replaceImage(img,url);syncBindingRuntime();
  }));
  if(video) {
    entries.push(descriptor(video,'src','video','Video',()=>video.getAttribute('src')||video.querySelector('source')?.getAttribute('src')||'',url=>{video.src=url;video.querySelectorAll('source').forEach(source=>source.remove());video.removeAttribute('data-src');video.load();}));
    entries.push(descriptor(video,'poster','image','Video poster',()=>video.getAttribute('poster')||'',url=>video.setAttribute('poster',url)));
  }
  if(embed)entries.push(descriptor(embed,'src','video','Video',()=>embed.getAttribute('src')||'',url=>{
    const replacement=doc.createElement('video');
    for(const attr of ['id','class','style','width','height',ID])if(embed.hasAttribute(attr))replacement.setAttribute(attr,embed.getAttribute(attr));
    replacement.controls=true;replacement.src=url;replacement.preload='metadata';embed.replaceWith(replacement);
  },true));
  const background=computed(n.el).backgroundImage;
  if(background&&background!=='none'){
    const match=/url\(["']?([^"')]+)["']?\)/.exec(background);
    if(match)entries.push(descriptor(n.el,'background','image','Background image',()=>/url\(["']?([^"')]+)["']?\)/.exec(computed(n.el).backgroundImage)?.[1]||'',url=>{
      if(setStyle(n.id,'background-image',computed(n.el).backgroundImage.replace(/url\(["']?([^"')]+)["']?\)/,'url("'+url+'")'))===false)throw Error('This background is locked by its original style. Remove the inline !important rule in Code first.');
    }));
  }
  return entries;
}
function mediaControls(n){return mediaDescriptors(n).map((entry,index)=>'<div class="em-native-actions"><strong style="width:100%">'+esc(entry.label)+'</strong><button class="btn" type="button" data-edit-media="'+index+'">Regenerate with branding</button><button class="btn" type="button" data-replace-media="'+index+'">Upload / choose asset</button></div>').join('');}
function mountVisualMedia(n){
  props.querySelectorAll('[data-edit-media],[data-replace-media]').forEach(button=>button.onclick=()=>{
    const entry=mediaDescriptors(n)[Number(button.dataset.editMedia??button.dataset.replaceMedia)];if(!entry)return;
    const source=entry.read(),owner=n.id;
    window.__EDITOR_MEDIA.open({source,kind:entry.kind,embed:entry.embed,mode:button.hasAttribute('data-replace-media')?'replace':'edit',note:metadata.nodes[n.id]?.binding?.field==='image'?'Using a new version makes this a page-specific image and disconnects its product-image binding. Undo restores the binding.':'',apply:(url,scope)=>{
      const currentEntry=mediaDescriptors(get(owner)).find(item=>item.key===entry.key);
      if(!currentEntry||currentEntry.read()!==source||isLocked(get(owner)))throw Error('This placement changed or was removed while the edit was running. Reopen it to apply the preview.');
      const matching=scope==='page'&&source?[...new Map([...model.values()].filter(node=>!isLocked(node)).flatMap(mediaDescriptors).filter(item=>item.kind===entry.kind&&item.read()===source).map(item=>[item.key,item])).values()]:[currentEntry];
      // Refuse a locked background before starting a multi-placement edit.
      if(matching.some(item=>item.key.endsWith(':background')&&get(item.key.split(':')[0])?.el.style.getPropertyPriority('background-image')==='important'))throw Error('A matching background is locked by an inline !important rule. Edit that rule in Code first.');
      if(matching.some(item=>item.key.endsWith(':background'))&&(!CSS.supports('background-image','url("'+url+'")')||/[{}<>;]/.test(url)))throw Error('This URL cannot be used as a background. Upload the image to Media first.');
      operation('replace '+entry.kind,()=>matching.forEach(item=>item.write(url)));announce('Media updated. Undo is available; save the page when ready.');
    }});
  });
}
