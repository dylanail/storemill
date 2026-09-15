(()=>{
 const config=window.__ASSISTANT,panel=document.getElementById('business-assistant'),launcher=document.getElementById('assistant-launcher'),form=document.getElementById('composer'),ask=document.getElementById('ask'),thread=document.getElementById('thread'),status=document.getElementById('assistant-request-status'),badge=launcher.querySelector('.assistant-badge');
 const draftKey='assistant-draft:'+config.storeId;let timer,busy=!!config.busy,polling=false,last=thread.innerHTML,opened=false,unread=false;
 try{ask.value=sessionStorage.getItem(draftKey)||'';}catch{}
 ask.addEventListener('input',()=>{try{sessionStorage.setItem(draftKey,ask.value);}catch{}});
 function toggle(show){opened=show;panel.hidden=!show;launcher.setAttribute('aria-expanded',String(show));launcher.setAttribute('aria-label',show?'Minimize business assistant':'Open business assistant');if(show){unread=false;badge.hidden=true;poll();ask.focus();}else{badge.hidden=!busy&&!unread;launcher.focus();if(!busy)clearTimeout(timer);}}
 launcher.onclick=()=>toggle(!opened);document.getElementById('assistant-close').onclick=()=>toggle(false);
 panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();toggle(false);}});
 window.askThis=prompt=>{toggle(true);ask.value=prompt;ask.dispatchEvent(new Event('input'));ask.focus();};
 function context(){
   const selected=window.__PAGE_EDITOR?.getSelected(),model=window.__PAGE_EDITOR?.getModel(),node=model?.find(n=>n.id===selected);
   const theme=document.getElementById('theme-form'),fields={};
   if(theme)for(const key of ['primary','secondary','paper','ink','surface','buttonText','border','displayFont','bodyFont','displayWeight','bodyWeight'])if(theme.elements.namedItem(key))fields[key]=theme.elements.namedItem(key).value;
   return {path:location.pathname,title:config.title,unsaved:!!document.getElementById('status')?.classList.contains('dirty'),...(node?{selection:{id:node.id,type:node.type,label:node.label}}:{}),...(theme?{theme:fields,unsaved:document.getElementById('theme-save-state')?.textContent==='Unsaved changes'}:{})};
 }
 async function poll(){
   if(polling)return;clearTimeout(timer);polling=true;
   try{const response=await fetch('/admin/assistant/state?storeId='+encodeURIComponent(config.storeId),{credentials:'same-origin'});if(!response.ok)throw new Error('Could not refresh the conversation.');const data=await response.json();busy=data.busy;if(data.html!==last){const nearBottom=thread.scrollHeight-thread.scrollTop-thread.clientHeight<80;thread.innerHTML=data.html;last=data.html;if(nearBottom||!opened)thread.scrollTop=thread.scrollHeight;if(!opened)unread=true;}status.textContent=data.status||'';badge.hidden=opened||!busy&&!unread;}
   catch(error){if(opened)status.textContent=error.message;}finally{polling=false;if(opened||busy)timer=setTimeout(poll,busy?1800:8000);}
 }
 form.addEventListener('submit',async event=>{
   event.preventDefault();const text=ask.value.trim();if(!text)return;const button=form.querySelector('.send');button.disabled=true;status.textContent='Sending…';
   try{const response=await fetch(form.action,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({storeId:config.storeId,text,page:config.page,context:context()})});const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not send. Your message is still here.');ask.value='';try{sessionStorage.removeItem(draftKey);}catch{}busy=true;status.textContent='Working on your request…';await poll();}
   catch(error){status.textContent=error.message;}finally{button.disabled=false;ask.focus();}
 });
 ask.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();form.requestSubmit();}});
 const voice=document.getElementById('voice'),Speech=window.SpeechRecognition||window.webkitSpeechRecognition;
 if(!Speech){voice.hidden=true;}else voice.onclick=()=>{const recognition=new Speech();recognition.lang=document.documentElement.lang||'en-US';recognition.onresult=event=>{ask.value=(ask.value+' '+event.results[0][0].transcript).trim();ask.dispatchEvent(new Event('input'));ask.focus();};recognition.start();};
 if(busy){badge.hidden=false;poll();}
})();
