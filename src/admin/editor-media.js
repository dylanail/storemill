/* Shared image/video workflow. Results only enter the page through its existing undo path. */
(() => {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const suffix='?storeId='+encodeURIComponent(window.__PAGE.storeId),base='/admin/pages/'+encodeURIComponent(window.__PAGE.id)+'/media/';
  let dialog,timer,target,options,pick,job,result,refs=[],logo='',working=false,requestKey='',lastRequest='',opening=0;
  const q=selector=>dialog.querySelector(selector),value=name=>q('[name="'+name+'"]').value;
  const preview=(url,kind,label)=>'<figure class="em-preview">'+(kind==='video'?'<video src="'+esc(url)+'" controls playsinline preload="metadata" aria-label="'+esc(label)+'"></video>':'<img src="'+esc(url)+'" alt="'+esc(label)+'">')+'<figcaption>'+esc(label)+'</figcaption></figure>';
  async function request(url,init={}){
    const response=await fetch(url,{...init,headers:{Accept:'application/json',...init.headers},signal:AbortSignal.timeout(120000)});
    if(response.redirected)throw Error('Your session changed. Sign in again, then reopen this dialog.');
    const data=await response.json();if(!response.ok||data.error)throw Error(data.error||'The request could not be completed.');return data;
  }
  function say(message,error=false){const box=q('.em-status');box.hidden=!message;box.textContent=message;box.classList.toggle('error',error);}
  function close(){clearTimeout(timer);opening++;dialog?.close();}
  function showLogo(){const image=q('.em-logo');image.hidden=!logo;if(logo)image.src=logo.trim().startsWith('<')?'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(logo):logo;}
  function showRefs(){q('.em-references').innerHTML=refs.map((url,i)=>'<span class="em-reference"><img src="'+esc(url)+'" alt="Reference '+(i+1)+'"><button class="btn" type="button" data-remove-reference="'+i+'" aria-label="Remove reference '+(i+1)+'">×</button></span>').join('');q('.em-references').querySelectorAll('button').forEach(button=>button.onclick=()=>{refs.splice(Number(button.dataset.removeReference),1);showRefs();});}
  function sync(){
    const ai=value('method')==='ai',video=target.kind==='video';
    q('[data-ai]').hidden=!ai;q('[data-overlay]').hidden=ai;q('[name=direction]').disabled=!ai;
    q('[data-video]').hidden=!video;q('[data-shape]').hidden=video;
    q('[data-start]').disabled=working||!options.available.rendering||!target.source||target.embed;
    q('[data-cancel-job]').hidden=!working;q('[data-cancel-job]').disabled=!job;q('[data-start]').textContent=working?'Creating preview…':result?'Create another variation':'Create preview';
    q('.em-tabs').querySelectorAll('button').forEach(button=>button.disabled=working);
  }
  function renderPicker(){
    const search=value('assetSearch').toLowerCase(),category=value('assetCategory');
    const assets=options.assets.filter(item=>item.kind===pick.kind&&(!category||item.category===category)&&(item.label+' '+item.url).toLowerCase().includes(search));
    q('.em-picker-grid').innerHTML=assets.map((item,i)=>'<button type="button" data-asset="'+i+'">'+(item.kind==='image'?'<img src="'+esc(item.url)+'" loading="lazy" alt="">':'<span style="height:100px;display:grid;place-items:center;font-size:32px">▷</span>')+'<span>'+esc(item.label)+'</span><span>'+esc(item.category==='logo'?'Logo':item.kind)+'</span></button>').join('')||'<p>No matching assets. Upload a file below.</p>';
    q('.em-picker-grid').querySelectorAll('button').forEach(button=>button.onclick=()=>choose(assets[Number(button.dataset.asset)]));
  }
  function picker(config){pick=config;q('[data-edit-panel]').hidden=true;q('[data-picker-panel]').hidden=false;q('[data-picker-title]').textContent=config.title;q('[name=assetCategory]').value=config.category||'';q('[name=assetSearch]').value='';q('[name=assetUpload]').accept=config.kind==='video'?'video/mp4,video/webm,video/quicktime':'image/*';renderPicker();q('[name=assetSearch]').focus();}
  function pickerBack(){q('[data-picker-panel]').hidden=true;q('[data-edit-panel]').hidden=false;pick=null;}
  function choose(asset){const action=pick.onChoose;pickerBack();action(asset);}
  async function upload(file,category){
    if(!file)return null;const limit=file.type.startsWith('video/')?100:12;
    if(file.size>limit*1024*1024)throw Error('Choose a file up to '+limit+'MB.');
    const body=new FormData();body.set('file',file);body.set('category',category||'media');
    const epoch=opening;const asset=await request(base+'upload'+suffix,{method:'POST',body});if(epoch!==opening||!dialog.open)throw Error('Upload saved in Media; reopen the target to use it.');options.assets.unshift(asset);return asset;
  }
  function apply(url){try{target.apply(url,value('scope'));close();}catch(error){say(error.message,true);}}
  function complete(data){
    working=false;job=data;result=data.result;
    if(result&&['review','applied','undone'].includes(data.status)){
      q('[data-result]').innerHTML=preview(result,target.kind,'New version');q('[data-use-result]').hidden=false;say('Preview ready. Review it, then use it on your page. Save the page when you are ready.');
    }else say(data.error||data.phase||'The edit stopped; your original is unchanged.',true);
    sync();
  }
  async function poll(epoch){
    if(!dialog.open||epoch!==opening)return;
    try{const data=await request('/admin/media/rebrand/'+job.id+'/status'+suffix);if(epoch!==opening)return;
      if(['queued','working'].includes(data.status)){say(data.phase);timer=setTimeout(()=>poll(epoch),1500);}else complete(data);
    }catch(error){if(epoch!==opening)return;working=false;say(error.message+' Reopen the dialog to check the existing edit.',true);sync();}
  }
  async function generate(){
    if(working)return;say('');
    const spec={source:target.source,kind:target.kind,brandName:value('brandName'),logo,oldBrand:value('oldBrand'),direction:value('direction'),intent:value('intent'),method:value('method'),provider:value('provider'),position:value('position'),width:Number(value('width')),frame:Number(value('frame')),references:refs,preserve:value('preserve'),shape:target.kind==='video'?'original':value('shape'),audio:value('audio')};
    if(spec.method==='overlay'&&!logo){say('Choose or upload a logo for an exact overlay.',true);return;}
    if(spec.method==='ai'&&spec.intent==='custom'&&!spec.direction.trim()){say('Describe what you want to change.',true);q('[name=direction]').focus();return;}
    const fingerprint=JSON.stringify(spec);if(!requestKey||fingerprint!==lastRequest||result){requestKey='edit_'+crypto.randomUUID().replace(/-/g,'');lastRequest=fingerprint;}
    working=true;job=null;sync();say('Starting your media edit…');const epoch=opening;
    try{const started=await request(base+'rebrand'+suffix,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...spec,requestKey})});if(epoch!==opening)return;job=started;result=null;q('[data-use-result]').hidden=true;poll(epoch);}
    catch(error){if(epoch!==opening)return;working=false;say(error.message,true);sync();}
  }
  async function open(input){
    clearTimeout(timer);opening++;const epoch=opening;target=input;working=false;result=null;job=null;requestKey='';lastRequest='';refs=[];
    dialog?.remove();dialog=document.createElement('dialog');dialog.className='editor-media';dialog.setAttribute('aria-label','Edit media');
    dialog.innerHTML='<div class="em-heading"><h2>Regenerate '+esc(input.kind)+' with branding</h2><button class="btn" type="button" data-close aria-label="Close media editor">Close</button></div><div class="em-body"><p class="em-status" role="status" aria-live="polite">Loading your media library…</p><div data-content></div></div>';
    document.body.appendChild(dialog);dialog.showModal();q('[data-close]').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    try{const loaded=await request(base+'options'+suffix);if(epoch!==opening)return;options=loaded;}catch(error){if(epoch===opening)say(error.message,true);return;}
    const defaults=options.defaults;logo=defaults.logo||'';
    q('[data-content]').innerHTML=`<div data-edit-panel><div class="em-tabs" role="tablist"><button class="btn" type="button" data-tab="edit" role="tab" aria-selected="true">Regenerate</button><button class="btn" type="button" data-tab="replace" role="tab" aria-selected="false">Replace / upload</button></div><div class="em-grid"><div>${input.source&&!input.embed?preview(input.source,input.kind,'Current '+input.kind):'<p>Choose or upload the original '+esc(input.kind)+' file to begin.</p>'}<div data-result></div><p class="em-note">${input.kind==='video'?'AI video edits support complete 2–30 second clips up to 1080p. Exact logo overlays support clips up to 5 minutes and 100MB.':'Images up to 12MB. AI creates a new version; review lettering and product details before using it. Animated images become a still image.'}</p>${input.note?'<p class="em-note">'+esc(input.note)+'</p>':''}<label class="em-scope">Apply replacement to<select name="scope"><option value="selected">Selected placement only</option><option value="page">All matching placements on this page</option></select></label><button class="btn primary" type="button" data-use-result hidden>Use this version</button></div><div><div data-regenerate>
      <label>Desired brand name<input name="brandName" maxlength="100" value="${esc(defaults.brandName)}"></label>
      <label>Editing method<select name="method"><option value="ai">AI edit</option><option value="overlay">Exact logo overlay</option></select></label>
      <label>Desired logo<img class="em-logo" alt="Desired logo" hidden></label><div class="em-actions"><button class="btn" type="button" data-logo>Choose logo asset</button><button class="btn" type="button" data-logo-upload>Upload logo</button><button class="btn" type="button" data-logo-clear>No logo</button></div><input type="file" name="logoUpload" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden>
      <div data-ai><label>Edit goal<select name="intent"><option value="rebrand">Replace branding</option><option value="custom">Custom instructions</option><option value="cleanup">Remove objects or unwanted text</option><option value="background">Change background</option><option value="enhance">Improve lighting and clarity</option><option value="restyle">Restyle the scene</option></select></label><label>Image editor<select name="provider">${options.available.images.map(provider=>'<option value="'+provider.id+'" '+(!provider.available?'disabled':'')+'>'+esc(provider.name)+(!provider.available?' — not connected':'')+'</option>').join('')}</select></label></div>
      <label>Edit suggestions<textarea name="direction" rows="5" maxlength="6000" placeholder="Tell AI exactly what to change: logo placement, colors, copy, background, objects, or style. Describe how each reference should be used."></textarea></label>
      <div data-ai-extra><label>Keep unchanged<textarea name="preserve" rows="2" maxlength="1500" placeholder="For example: product shape, ingredients, faces, camera angle, and factual label text."></textarea></label><div class="em-references"></div><div class="em-actions"><button class="btn" type="button" data-reference>Choose reference image</button><button class="btn" type="button" data-reference-upload>Upload reference images</button></div><input type="file" name="referenceUpload" accept="image/*" multiple hidden><p class="em-note">Up to three reference images, in addition to your logo. Uploads are also saved in Media.</p><details><summary>More options</summary><label>Brand to replace<input name="oldBrand" maxlength="100"></label><label data-shape>Output shape<select name="shape"><option value="original">Keep original dimensions</option><option value="square">Square · 1024 × 1024</option><option value="landscape">Landscape · 1536 × 1024</option><option value="portrait">Portrait · 1024 × 1536</option></select></label></details></div>
      <div data-overlay hidden><p class="em-note">Exact overlay uses your logo, position and size. Choose AI edit to apply suggestions and reference images.</p><label>Logo position<select name="position">${['top-left','top-right','bottom-left','bottom-right','center'].map(position=>'<option value="'+position+'" '+(position==='bottom-right'?'selected':'')+'>'+position.replace('-',' ')+'</option>').join('')}</select></label><label>Logo width (%)<input type="number" name="width" min="5" max="40" value="18"></label></div>
      <div data-video hidden><label>Reference frame (seconds)<input name="frame" type="number" min="0" max="29.9" step="0.1" value="0"></label><label>Video audio<select name="audio"><option value="keep">Keep original audio</option><option value="mute">Mute video</option></select></label></div>
      <p class="em-note" data-availability></p><p class="em-note">AI uses your connected providers and incurs their charges. Closing this dialog keeps the job running; reopen this media to find its recent versions.</p><div class="em-actions"><button class="btn primary" type="button" data-start>Create preview</button><button class="btn" type="button" data-cancel-job hidden>Cancel generation</button></div></div>
      <div data-replace hidden><p>Replace this ${input.kind} with an existing asset or upload from your computer.</p><div class="em-actions"><button class="btn primary" type="button" data-replacement>Choose asset</button><button class="btn" type="button" data-replacement-upload>Upload from computer</button></div><input type="file" name="replacementUpload" accept="${input.kind==='video'?'video/mp4,video/webm,video/quicktime':'image/*'}" hidden></div><div data-recent></div></div></div></div>
      <div data-picker-panel hidden><h3 data-picker-title>Choose asset</h3><label>Search assets<input name="assetSearch" type="search" placeholder="Find by name"></label><label>Asset category<select name="assetCategory"><option value="">All assets</option><option value="logo">Logos</option><option value="media">Images & videos</option></select></label><div class="em-picker-grid"></div><label>Upload from computer<input type="file" name="assetUpload"></label><button class="btn" type="button" data-picker-back>Back</button></div>`;
    if(input.singlePlacement)q('.em-scope').hidden=true;
    const provider=options.available.images.find(item=>item.id===defaults.provider&&item.available)||options.available.images.find(item=>item.available);
    if(provider)q('[name=provider]').value=provider.id;
    const canAI=!!provider&&(input.kind!=='video'||options.available.video);
    q('[name=method] option[value=ai]').disabled=!canAI;if(!canAI)q('[name=method]').value='overlay';
    q('[data-availability]').textContent=!options.available.rendering?'Media editing requires FFmpeg on the server.':!canAI?'Connect an image provider'+(input.kind==='video'?' and Runway':'')+' in Settings for AI edits. Exact overlays work without AI providers.':'';
    const syncAll=()=>{sync();q('[data-ai-extra]').hidden=value('method')!=='ai';};q('[name=method]').onchange=syncAll;
    q('[data-logo]').onclick=()=>picker({title:'Choose a reference logo',kind:'image',category:'logo',onChoose:asset=>{logo=asset.url;showLogo();}});
    q('[data-logo-upload]').onclick=()=>q('[name=logoUpload]').click();q('[data-logo-clear]').onclick=()=>{logo='';showLogo();};
    q('[name=logoUpload]').onchange=async event=>{try{say('Uploading logo…');const asset=await upload(event.target.files[0],'logo');if(asset){logo=asset.url;showLogo();say('Logo saved in Logos.');}}catch(error){say(error.message,true);}finally{event.target.value='';}};
    q('[data-reference]').onclick=()=>{if(refs.length>=3)return say('You can use up to three reference images.',true);picker({title:'Choose a reference image',kind:'image',onChoose:asset=>{if(!refs.includes(asset.url))refs.push(asset.url);showRefs();}});};
    q('[data-reference-upload]').onclick=()=>q('[name=referenceUpload]').click();q('[name=referenceUpload]').onchange=async event=>{try{const files=[...event.target.files];if(refs.length+files.length>3)throw Error('Choose up to three reference images.');say('Uploading references…');for(const file of files){refs.push((await upload(file,'media')).url);}showRefs();say('Reference images saved.');}catch(error){say(error.message,true);}finally{event.target.value='';}};
    q('[data-replacement]').onclick=()=>picker({title:'Choose replacement '+input.kind,kind:input.kind,onChoose:asset=>apply(asset.url)});
    q('[data-replacement-upload]').onclick=()=>q('[name=replacementUpload]').click();q('[name=replacementUpload]').onchange=async event=>{try{say('Uploading replacement…');const asset=await upload(event.target.files[0],'media');if(asset)apply(asset.url);}catch(error){say(error.message,true);}finally{event.target.value='';}};
    q('[name=assetUpload]').onchange=async event=>{try{const config=pick,file=event.target.files[0];if(!file)return;if(!file.type.startsWith(config.kind+'/'))throw Error('Choose an '+config.kind+' file');const asset=await upload(file,config.category||'media');choose(asset);}catch(error){say(error.message,true);}finally{event.target.value='';}};
    q('[name=assetSearch]').oninput=renderPicker;q('[name=assetCategory]').onchange=renderPicker;q('[data-picker-back]').onclick=pickerBack;
    q('.em-tabs').querySelectorAll('button').forEach(button=>button.onclick=()=>{const replace=button.dataset.tab==='replace';q('[data-regenerate]').hidden=replace;q('[data-replace]').hidden=!replace;q('.em-tabs').querySelectorAll('button').forEach(tab=>tab.setAttribute('aria-selected',String(tab===button)));});
    q('[data-start]').onclick=generate;q('[data-use-result]').onclick=()=>apply(result);
    q('[data-cancel-job]').onclick=async()=>{try{await request('/admin/media/rebrand/'+job.id+'/cancel'+suffix,{method:'POST'});clearTimeout(timer);working=false;sync();say('Generation cancelled. Your original is unchanged.');}catch(error){say(error.message,true);}};
    const recent=options.jobs.filter(item=>item.source===input.source).slice(0,6);
    q('[data-recent]').innerHTML=recent.length?'<details><summary>Recent versions for this media</summary>'+recent.map((item,i)=>'<p><button class="btn" type="button" data-recent="'+i+'">'+esc(item.phase)+'</button></p>').join('')+'</details>':'';
    q('[data-recent]').querySelectorAll('button').forEach(button=>button.onclick=()=>{job=recent[Number(button.dataset.recent)];if(['queued','working'].includes(job.status)){working=true;sync();poll(opening);}else complete(job);});
    say('');showLogo();showRefs();syncAll();if(input.mode==='replace')q('[data-tab=replace]').click();else q('[name=direction]').focus({preventScroll:true});
  }
  window.__EDITOR_MEDIA={open};
})();
