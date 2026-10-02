(function(){
  const config=window.__FUNNEL_CHECKOUT;
  if(!config)return;
  const form=document.getElementById('checkout-form'),pay=document.getElementById('pay');
  if(!form||!pay)return;
  let selected=config.hasSelection,busy=false;
  const money=cents=>new Intl.NumberFormat(undefined,{style:'currency',currency:config.currency}).format(cents/10**config.minor);
  const status=message=>document.querySelectorAll('[data-funnel-error]').forEach(node=>node.textContent=message);
  function sync(){pay.disabled=!!config.preview||busy||!selected;form.dataset.funnelSelectionReady=String(selected&&!busy);}
  window.__funnelSelectionBusy=()=>busy;
  window.__selectFunnelPackage=async function(variantId,quantity,additionalVariantIds){
    if(busy||window.__checkoutBusy?.()||form.dataset.paymentInProgress==='true'){status('Finish the current checkout update before changing options.');return false;}
    busy=true;sync();status('Updating your package…');
    try{
      const response=await fetch(config.base+'/checkout/selection',{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json',accept:'application/json'},body:JSON.stringify({variantId,quantity,...(additionalVariantIds===undefined?{}:{additionalVariantIds})})});
      const data=await response.json();if(!response.ok||data.error)throw new Error(data.error||'Could not update your package.');
      selected=true;
      document.querySelectorAll('.summary-body').forEach(node=>node.outerHTML=data.summaryHtml);
      if(data.bumpHtml!==undefined)document.querySelectorAll('[data-owned-bump-slot]').forEach(node=>node.outerHTML=data.bumpHtml);
      document.querySelectorAll('[data-pay-total],.co-summary-mobile summary b').forEach(node=>node.textContent=money(data.totalCents));
      document.querySelectorAll('[data-funnel-variant]').forEach(node=>node.checked=node.dataset.funnelVariant===data.variantId&&Number(node.dataset.funnelQuantity)===data.quantity);
      document.querySelectorAll('[data-funnel-addon]').forEach(node=>{node.checked=(data.additionalVariantIds||[]).includes(node.dataset.funnelAddon);node.dataset.confirmed=String(node.checked);});
      document.querySelectorAll('[data-copy-choice]').forEach(node=>{if(node.dataset.copyChoice==='primary')node.checked=node.dataset.copyVariantId===data.variantId;if(node.dataset.copyChoice==='addon')node.checked=(data.additionalVariantIds||[]).includes(node.dataset.copyVariantId);if(node.dataset.copyChoice==='shipping')node.checked=node.dataset.copyShippingId===data.shippingOptionId;node.dataset.confirmed=String(node.checked);});
      // Reset any removed order bump rather than leaving a checked control for an uncharged item.
      document.querySelectorAll('.bump input').forEach(node=>node.checked=false);
      window.dispatchEvent(new CustomEvent('owned:checkout-selection',{detail:data}));
      status('');return true;
    }catch(error){status(error.message);return false;}
    finally{busy=false;sync();}
  };
  document.addEventListener('change',async event=>{
    const addon=event.target.closest('[data-funnel-addon]');if(addon){const radio=document.querySelector('[data-funnel-variant]:checked');if(!radio){addon.checked=addon.dataset.confirmed==='true';status('Choose a package before changing add-ons.');return;}const okay=await window.__selectFunnelPackage(radio.dataset.funnelVariant,Number(radio.dataset.funnelQuantity),[...document.querySelectorAll('[data-funnel-addon]:checked')].map(node=>node.dataset.funnelAddon));if(!okay)document.querySelectorAll('[data-funnel-addon]').forEach(node=>node.checked=node.dataset.confirmed==='true');return;}
    const radio=event.target.closest('[data-funnel-variant]');if(!radio)return;
    const previous=[...document.querySelectorAll('[data-funnel-variant]')].find(node=>node.dataset.confirmed==='true');
    const okay=await window.__selectFunnelPackage(radio.dataset.funnelVariant,Number(radio.dataset.funnelQuantity));
    if(!okay){radio.checked=false;if(previous)previous.checked=true;}
    else document.querySelectorAll('[data-funnel-variant]').forEach(node=>node.dataset.confirmed=String(node.checked));
  });
  document.querySelectorAll('[data-funnel-variant]').forEach(node=>node.dataset.confirmed=String(node.checked));
  document.querySelectorAll('[data-funnel-addon]').forEach(node=>node.dataset.confirmed=String(node.checked));
  form.addEventListener('submit',event=>{if(busy||!selected){event.preventDefault();event.stopImmediatePropagation();status('Choose a package before continuing to payment.');}},true);
  sync();
})();
