(function(){
  const config=window.__FUNNEL_CHECKOUT;
  if(!config)return;
  const form=document.getElementById('checkout-form'),pay=document.getElementById('pay');
  if(!form||!pay)return;
  let selected=config.hasSelection,busy=false;
  const money=cents=>new Intl.NumberFormat(undefined,{style:'currency',currency:config.currency}).format(cents/10**config.minor);
  const status=message=>document.querySelectorAll('[data-funnel-error]').forEach(node=>node.textContent=message);
  function sync(){pay.disabled=busy||!selected;form.dataset.funnelSelectionReady=String(selected&&!busy);}
  window.__selectFunnelPackage=async function(variantId,quantity){
    if(busy||form.dataset.paymentInProgress==='true')return false;
    busy=true;sync();status('Updating your package…');
    try{
      const response=await fetch(config.base+'/checkout/selection',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({variantId,quantity})});
      const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||'Could not update your package.');
      selected=true;
      document.querySelectorAll('.summary-body').forEach(node=>node.outerHTML=data.summaryHtml);
      document.querySelectorAll('[data-pay-total],.co-summary-mobile summary b').forEach(node=>node.textContent=money(data.totalCents));
      document.querySelectorAll('[data-funnel-variant]').forEach(node=>node.checked=node.dataset.funnelVariant===data.variantId&&Number(node.dataset.funnelQuantity)===data.quantity);
      // Reset any removed order bump rather than leaving a checked control for an uncharged item.
      document.querySelectorAll('.bump input').forEach(node=>node.checked=false);
      window.dispatchEvent(new CustomEvent('owned:checkout-selection',{detail:data}));
      status('');return true;
    }catch(error){status(error.message);return false;}
    finally{busy=false;sync();}
  };
  document.addEventListener('change',async event=>{
    const radio=event.target.closest('[data-funnel-variant]');if(!radio)return;
    const previous=[...document.querySelectorAll('[data-funnel-variant]')].find(node=>node.dataset.confirmed==='true');
    const okay=await window.__selectFunnelPackage(radio.dataset.funnelVariant,Number(radio.dataset.funnelQuantity));
    if(!okay){radio.checked=false;if(previous)previous.checked=true;}
    else document.querySelectorAll('[data-funnel-variant]').forEach(node=>node.dataset.confirmed=String(node.checked));
  });
  document.querySelectorAll('[data-funnel-variant]').forEach(node=>node.dataset.confirmed=String(node.checked));
  form.addEventListener('submit',event=>{if(busy||!selected){event.preventDefault();event.stopImmediatePropagation();status('Choose a package before continuing to payment.');}},true);
  sync();
})();
