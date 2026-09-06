(function(){
  const config=window.__CHECKOUT,form=document.getElementById('checkout-form');
  if(!config||!form)return;
  const error=document.getElementById('checkout-error'),pay=document.getElementById('pay');
  let pending=0;
  const draft=()=>Object.fromEntries(new FormData(form));
  const money=(c,currency=config.currency)=>new Intl.NumberFormat(config.locale,{style:'currency',currency}).format(c/10**new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits);
  function refresh(data){
    if(data.shippingHtml){document.getElementById('methods').innerHTML=data.shippingHtml;document.querySelectorAll('#methods input').forEach(r=>r.dataset.confirmed=String(r.checked));}
    if(data.summaryHtml)document.querySelectorAll('.summary-body').forEach(el=>el.outerHTML=data.summaryHtml);
    else if(data.totalsHtml)document.querySelectorAll('.totals').forEach(el=>el.outerHTML=data.totalsHtml);
    document.querySelectorAll('[data-pay-total],.co-summary-mobile summary b').forEach(el=>el.textContent=money(data.totalCents,data.currency));
    if(window.__elements&&data.totalCents>0)window.__elements.update({amount:data.totalCents});
  }
  async function request(path,body){
    pending++;pay.disabled=true;error.textContent='';
    try{
      const response=await fetch(config.base+path,{method:'POST',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify(body)});
      const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||'Could not update checkout. Try again.');return data;
    }finally{pending--;pay.disabled=!!config.preview||pending>0||form.dataset.funnelSelectionReady==='false'||form.dataset.paymentInProgress==='true';}
  }
  document.addEventListener('submit',async event=>{
    const codeForm=event.target.closest('form.code');if(!codeForm)return;
    event.preventDefault();const code=new FormData(codeForm).get('code');
    if(!String(code||'').trim()){codeForm.querySelector('input').focus();return;}
    const button=codeForm.querySelector('button');button.disabled=true;
    try{refresh(await request('/checkout/code',{code,email:form.elements.email.value}));}
    catch(e){codeForm.parentElement.querySelector('[data-code-error]').textContent=e.message;}
    finally{button.disabled=false;}
  });
  document.addEventListener('click',async event=>{
    const remove=event.target.closest('[data-remove-code]');if(!remove)return;
    remove.disabled=true;
    try{refresh(await request('/checkout/code',{code:''}));}catch(e){error.textContent=e.message;remove.disabled=false;}
  });
  document.addEventListener('change',async event=>{
    const el=event.target;
    if(el.name==='billingSame'){
      const billing=form.querySelector('.co-billing');billing.hidden=el.checked;billing.disabled=el.checked;
    }
    if(el.name==='country'){
      el.disabled=true;
      try{await request('/checkout/country',{...draft(),country:el.value});location.reload();}
      catch(e){error.textContent=e.message;el.value=el.dataset.confirmed||el.options[0].value;el.disabled=false;}
    }
    if(el.matches('#methods input')){
      try{refresh(await request('/checkout/shipping',{shippingOptionId:el.value}));document.querySelectorAll('#methods input').forEach(r=>r.dataset.confirmed=String(r.checked));}
      catch(e){error.textContent=e.message;document.querySelectorAll('#methods input').forEach(r=>r.checked=r.dataset.confirmed==='true');}
    }
    if(el.matches('.bump input')){
      const value=el.checked;
      document.querySelectorAll('.bump input').forEach(r=>{r.disabled=true;r.checked=value;});
      try{refresh(await request('/checkout/bump',{variantId:el.value,on:value}));}
      catch(e){error.textContent=e.message;document.querySelectorAll('.bump input').forEach(r=>r.checked=!value);}
      finally{document.querySelectorAll('.bump input').forEach(r=>r.disabled=false);}
    }
  });
  document.querySelectorAll('#methods input').forEach(r=>r.dataset.confirmed=String(r.checked));
  if(form.elements.country)form.elements.country.dataset.confirmed=form.elements.country.value;
  function clearInvalid(input){input.removeAttribute('aria-invalid');input.removeAttribute('aria-describedby');input.closest('.field')?.querySelector('.field-error')?.remove();}
  function markInvalid(input){
    clearInvalid(input);input.setAttribute('aria-invalid','true');
    const message=document.createElement('span');message.className='field-error';message.id=input.id+'-error';message.textContent=input.validity.valueMissing?'This field is required.':'Enter a valid '+(input.type==='email'?'email address.':'value.');input.setAttribute('aria-describedby',message.id);input.closest('.field')?.append(message);
  }
  form.addEventListener('input',event=>{if(event.target.matches('[aria-invalid=true]')&&event.target.validity.valid)clearInvalid(event.target);});
  form.addEventListener('submit',event=>{
    if(pending||config.preview){event.preventDefault();event.stopImmediatePropagation();return;}
    const invalid=[...form.elements].filter(el=>el.willValidate&&!el.validity.valid);
    if(invalid.length){event.preventDefault();event.stopImmediatePropagation();invalid.forEach(markInvalid);invalid[0].focus();}
  },true);
})();
