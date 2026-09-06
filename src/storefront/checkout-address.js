/* Progressive enhancement: native, named address fields remain the cart's source of truth. */
function mountCheckoutAddresses(elements, form) {
  const records = [...form.querySelectorAll('[data-checkout-address]')].map(root => ({
    root, mode: root.dataset.checkoutAddress, mount: root.querySelector('[data-address-element]'),
    fallback: root.querySelector('[data-address-fallback]'), button: root.querySelector('[data-address-manual]'),
    help: root.querySelector('[data-address-help]'), element: null, manual: false, timer: null,
  }));
  const fieldName = (record, key) => record.mode === 'billing' ? 'billing' + key[0].toUpperCase() + key.slice(1) : key;
  const field = (record, key) => form.elements[fieldName(record, key)];
  function defaults(record) {
    return {firstName:field(record,'firstName').value,lastName:field(record,'lastName').value,
      address:{line1:field(record,'line1').value,line2:field(record,'line2').value,city:field(record,'city').value,state:field(record,'state').value,postal_code:field(record,'postal').value,country:field(record,'country').value}};
  }
  function sync(record, value, notifyCountry = false) {
    if (!value) return;
    const before = field(record, 'country').value, address = value.address || {};
    const names = (value.name || '').split(' ');
    const values = {firstName:value.firstName ?? names.shift() ?? '',lastName:value.lastName ?? names.join(' '),
      line1:address.line1 || '',line2:address.line2 || '',city:address.city || '',state:address.state || '',postal:address.postal_code || '',country:address.country || before};
    Object.entries(values).forEach(([key, value]) => {field(record,key).value = value;});
    if (notifyCountry && record.mode === 'shipping' && before !== values.country) field(record,'country').dispatchEvent(new Event('change',{bubbles:true}));
  }
  function stop(record, message = '') {
    clearTimeout(record.timer);
    const element = record.element; record.element = null;
    try { element?.destroy(); } catch {}
    record.mount.hidden = true; record.fallback.hidden = false;
    record.fallback.querySelectorAll('[data-address-required]').forEach(input => {input.required = true;});
    if (record.button) {record.button.hidden = false;record.button.textContent = 'Use address suggestions';}
    if (record.help) {record.help.textContent = message;record.help.hidden = !message;}
  }
  function start(record) {
    if (record.element || record.manual || record.mode === 'billing' && form.elements.billingSame.checked) return;
    try {
      const countries = [...field(record,'country').options].map(option => option.value);
      const element = elements.create('address', {mode:record.mode,display:{name:'split'},allowedCountries:countries,
        autocomplete:{mode:'automatic'},fields:{phone:'never'},defaultValues:defaults(record)});
      record.element = element; record.mount.hidden = false;
      if (record.button) record.button.hidden = false;
      element.on('change', event => {if(record.element === element) sync(record,event.value,true);});
      element.on('ready', () => {
        if(record.element !== element) return;
        clearTimeout(record.timer);record.fallback.hidden = true;
        record.fallback.querySelectorAll('[required]').forEach(input => {input.dataset.addressRequired='';input.required=false;});
        if(record.button)record.button.textContent='Enter address manually';
        if(record.help)record.help.hidden=true;
      });
      element.on('loaderror', () => {if(record.element === element)stop(record,'Address suggestions could not load. You can enter your address below.');});
      record.timer=setTimeout(() => {if(record.element === element && !record.fallback.hidden)stop(record,'You can enter your address below.');},12000);
      element.mount(record.mount);
    } catch { stop(record); }
  }
  records.forEach(record => {
    record.button?.addEventListener('click', () => {
      if(record.element){record.manual=true;stop(record);field(record,'line1').focus();}
      else{record.manual=false;start(record);}
    });
    start(record);
  });
  form.elements.billingSame?.addEventListener('change', () => {
    const billing=records.find(record=>record.mode==='billing');if(!billing)return;
    if(form.elements.billingSame.checked)stop(billing);else start(billing);
  });
  return {
    async validate() {
      for(const record of records){
        if(!record.element)continue;
        if(!record.fallback.hidden){stop(record);continue;}
        const result=await record.element.getValue();sync(record,result.value,true);
        if(!result.complete){record.element.focus();return false;}
      }
      return form.reportValidity() && !window.__checkoutBusy?.();
    },
    // Express wallets already supplied a complete address. Do not validate a second, empty form.
    useWallet(details) {
      records.forEach(record=>{stop(record);for(const key of ['firstName','lastName','line1','line2','city','state','postal','country']){
        const name=fieldName(record,key);if(details[name]!==undefined)field(record,key).value=details[name];
      }});
      return ()=>records.forEach(start);
    },
  };
}
