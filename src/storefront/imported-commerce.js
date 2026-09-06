/* First-party behavior for imported markup. Source JavaScript is never needed for a purchase. */
(function () {
  'use strict';
  const config = window.__COPY_COMMERCE;
  if (!config) return;
  const all = (selector, root = document) => [...root.querySelectorAll(selector)].filter(node=>config.scope!=='sections'||root!==document||node.closest('[data-pb-imported-section]'));
  const one = (selector, root = document) => all(selector,root)[0] || null;
  const text = node => (node?.textContent || '').replace(/\s+/g, ' ').trim();
  const norm = value => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let cart = null, drawer = null, returnFocus = null, busy = false;
  const money = cents => new Intl.NumberFormat(undefined, {style:'currency',currency:config.currency}).format(cents / 10 ** config.minor);
  function announce(message) {
    let node = one('[data-copy-notice]');
    if (!node) { node = document.createElement('div'); node.dataset.copyNotice = ''; node.setAttribute('role','status'); document.body.append(node); }
    node.textContent = message; node.hidden = false;
    clearTimeout(announce.timer); announce.timer = setTimeout(() => { node.hidden = true; }, 6500);
  }
  async function request(path, data) {
    const response = await fetch(config.base + path, {method:data ? 'POST':'GET',credentials:'same-origin',headers:{accept:'application/json',...(data ? {'content-type':'application/json'}:{})},...(data ? {body:JSON.stringify(data)}:{})});
    const body = await response.json();
    if (!response.ok || body.error) throw new Error(body.error || 'Please try again.');
    (body.metaEvents||[]).forEach(event=>window.amborasMeta?.(event));
    return body;
  }
  function productFor(node) {
    const root = node.closest('[data-product-id],[data-pb-product],[data-pb-product-id],[data-product-handle],product-info,product-form,.product,.product-card,.product-single') || node.closest('form') || document;
    const chosenOffer=all('.khOfferBox.of_selected_box,.pl-item[data-copy-variant-id][aria-checked="true"]').find(box=>box.getClientRects().length);
    const copiedBundle=one('[data-copy-product-id][data-copy-bundle]',root);
    const id = copiedBundle?.dataset.copyProductId || chosenOffer?.dataset.copyProductId || root.dataset?.copyProductId || root.dataset?.pbProduct || root.dataset?.pbProductId || root.dataset?.productId;
    const link = one('a[href*="/products/"]', root)?.getAttribute('href') || root.dataset?.productHandle || '';
    const formVariant=one('[name=id],[name=variantId]',root)?.value;
    return config.products.find(p => p.id === id || p.handle === id || (link && (link.includes('/products/' + p.handle) || link === p.handle)))
      || config.products.find(p => p.variants.some(v=>v.id===formVariant || (v.sourceId&&v.sourceId===formVariant)))
      || config.products.find(p => p.id === config.productId)
      || (config.products.length === 1 ? config.products[0] : null);
  }
  function choice(node, product) {
    if (!product) return null;
    const form = node.closest('product-info,.product,.product-single') || node.closest('form') || document;
    const select = one('[name=variantId],[name=id],select[name="variation_id"],input[name="variation_id"]', form);
    const offer=all('.khOfferBox.of_selected_box,.pl-item[data-copy-variant-id][aria-checked="true"]').find(box=>box.getClientRects().length);
    const copiedBundle=bundleSelection(node,product);
    const sourceId = copiedBundle?.root.dataset.copyVariantId || offer?.dataset.copyVariantId || select?.value || node.dataset.variantId || node.getAttribute('variantvalue');
    let variant = product.variants.find(v => v.id === sourceId || (v.sourceId && v.sourceId === sourceId));
    const options = all('select[name^="options"],input[name^="options"]:checked,select[name^="attribute"],variant-selects select,variant-selects input:checked,variant-radios input:checked,.product-form__input input[type=radio]:checked', form).map(field => field.value);
    if (options.length && !copiedBundle && !offer?.dataset.copyVariantId) variant = product.variants.find(v => options.every(value => Object.values(v.options).some(option => norm(option) === norm(value)) || v.title.split(/\s*\/\s*/).some(option => norm(option) === norm(value))));
    const label = select?.selectedOptions ? text(select.selectedOptions[0]).split(/\s+[—–-]\s+[$€£]/)[0] : '';
    if (!variant && label && !options.length) variant = product.variants.find(v => norm(v.title) === norm(label));
    // Multiple variants without an exact mapping require a choice; never silently sell another variant.
    if (!variant && !options.length && product.variants.length === 1) variant = product.variants[0];
    const quantity = copiedBundle ? Number(copiedBundle.bar?.dataset.copyBundleQuantity) : offer?.dataset.copyVariantId ? 1 : Number(one('[name=quantity]', form)?.value || node.getAttribute('quantity') || 1);
    return variant ? {variant,quantity:Number.isInteger(quantity) && quantity > 0 ? Math.min(quantity,999):1} : null;
  }
  function bundleSelection(node,product) {
    const scope=node.closest('product-info,.product,.product-single') || node.closest('form') || document;
    const root=all('kaching-bundle,[data-copy-bundle]',scope).find(root=>root.getClientRects().length);
    if(!root)return null;
    const bar=one('[data-copy-bundle-quantity].kaching-bundles__bar--selected',root);
    const variantId=root.dataset.copyVariantId;
    const quote=product?.bundle?.id===root.dataset.copyBundle&&root.dataset.copyProductId===product.id ? product.bundle.tiers.find(tier=>tier.quantity===Number(bar?.dataset.copyBundleQuantity)&&tier.variantId===variantId):null;
    return {root,bar,quote};
  }
  function mountCopiedBundles() {
    all('[data-copy-bundle]').forEach(root=>{
      const product=config.products.find(product=>product.id===root.dataset.copyProductId);
      const bars=all('[data-copy-bundle-quantity]',root);
      if(root.hasAttribute('data-copy-bundle-template')&&product?.variants.length===1&&product.bundle?.currency===root.dataset.copyBundleCurrency&&bars.length&&bars.every(bar=>product.bundle.tiers.some(tier=>tier.variantId===product.variants[0].id&&tier.quantity===Number(bar.dataset.copyBundleQuantity)&&tier.baseTotalCents===Number(bar.dataset.copyBundleTotal)))){
        root.dataset.copyBundle=product.bundle.id;root.dataset.copyVariantId=product.variants[0].id;
      }
      root.setAttribute('role','radiogroup');root.setAttribute('aria-label','Choose your bundle');
      const select=bar=>{
        bars.forEach(other=>{const chosen=other===bar;other.classList.toggle('kaching-bundles__bar--selected',chosen);other.setAttribute('aria-checked',String(chosen));other.tabIndex=chosen?0:-1;const input=one('input[type=radio]',other);if(input)input.checked=chosen;});
      };
      bars.forEach((bar,index)=>{
        const quote=product?.bundle?.id===root.dataset.copyBundle ? product.bundle.tiers.find(tier=>tier.quantity===Number(bar.dataset.copyBundleQuantity)&&tier.variantId===root.dataset.copyVariantId):null;
        bar.setAttribute('role','radio');bar.setAttribute('aria-disabled',String(!quote));
        if(quote)one('.kaching-bundles__bar-price',bar)?.replaceChildren(document.createTextNode(money(quote.totalCents)));
        all('[role=button]',bar).forEach(button=>{button.removeAttribute('role');button.removeAttribute('tabindex');});
        const choose=async target=>{
          const targetQuote=product?.bundle?.id===root.dataset.copyBundle ? product.bundle.tiers.find(tier=>tier.quantity===Number(target?.dataset.copyBundleQuantity)&&tier.variantId===root.dataset.copyVariantId):null;
          if(!targetQuote){announce('This bundle needs verified product pricing before it can be purchased.');return;}
          if(config.assetKind==='funnel'&&config.role==='checkout'&&window.__selectFunnelPackage){if(!await window.__selectFunnelPackage(targetQuote.variantId,targetQuote.quantity))return;}
          select(target);
        };
        bar.addEventListener('click',()=>choose(bar));
        bar.addEventListener('keydown',event=>{
          if(!['Enter',' ','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
          event.preventDefault();let target=bar;
          if(event.key==='Home')target=bars[0];else if(event.key==='End')target=bars.at(-1);else if(event.key.startsWith('Arrow'))target=bars[(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:bars.length-1))%bars.length];
          if(target?.getAttribute('aria-disabled')==='false'){void choose(target);target.focus();}
        });
      });
      select(bars.find(bar=>bar.classList.contains('kaching-bundles__bar--selected'))||bars[0]);
    });
  }
  function mountSourcePackages() {
    all('.product-list').forEach(root=>{
      const cards=all('.pl-item[data-copy-variant-id]',root).filter(card=>config.products.some(product=>product.id===card.dataset.copyProductId));
      if(!cards.length)return;
      root.setAttribute('role','radiogroup');root.setAttribute('aria-label','Choose your package');
      const selected=card=>cards.forEach(other=>{const on=other===card;other.setAttribute('aria-checked',String(on));other.classList.toggle('pl-selected',on);other.classList.toggle('selected',on);other.tabIndex=on?0:-1;all('input[type=radio],input[type=checkbox]',other).forEach(input=>{input.checked=on;input.tabIndex=-1;});});
      const choose=async card=>{const product=config.products.find(product=>product.id===card.dataset.copyProductId),variant=product?.variants.find(variant=>variant.id===card.dataset.copyVariantId);if(!variant?.available){announce('This package is not available.');return;}if(config.role==='checkout'&&window.__selectFunnelPackage&&!await window.__selectFunnelPackage(variant.id,1))return;selected(card);};
      cards.forEach((card,index)=>{card.setAttribute('role','radio');card.addEventListener('click',event=>{event.preventDefault();void choose(card);});card.addEventListener('keydown',event=>{if(!['Enter',' ','ArrowDown','ArrowUp','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();const next=event.key.startsWith('Arrow')?cards[(index+(['ArrowDown','ArrowRight'].includes(event.key)?1:cards.length-1))%cards.length]:card;void choose(next);next.focus();});});
      const current=cards.find(card=>document.querySelector('[data-funnel-variant="'+card.dataset.copyVariantId+'"]:checked'));
      // Source "default" is a visual default; a package is charged only after selection.
      selected(current||cards.find(card=>card.classList.contains('pl-selected'))||cards.find(card=>{const product=config.products.find(p=>p.id===card.dataset.copyProductId);return product?.variants.some(v=>v.id===card.dataset.copyVariantId&&v.sourceId===product.defaultSourceId)})||cards[0]);
      if(config.role==='checkout')root.addEventListener('click',()=>{const fieldset=one('[data-funnel-selection]');if(fieldset&&cards.every(card=>config.products.some(p=>p.variants.some(v=>v.id===card.dataset.copyVariantId))))fieldset.hidden=true;},{once:true});
    });
  }
  function lineHtml(item) {
    return `<div data-owned-cart-line data-variant-id="${escape(item.variantId)}"><img src="${escape(item.image)}" alt=""><div><strong>${escape(item.title)}</strong><p>${escape(item.variantTitle)}</p><label>Quantity <input type="number" min="0" max="999" value="${item.quantity}" data-copy-quantity aria-label="Quantity for ${escape(item.title)}"></label><button type="button" data-copy-remove>Remove</button></div><strong>${money(item.lineCents)}</strong></div>`;
  }
  function cartHosts() {
    const hosts = all('[data-cart-items],#CartDrawer-CartItems,#main-cart-items .js-contents,.cart__items,.cart-items,.cart-drawer__items,[data-owned-cart-lines]');
    return hosts.filter(host => !hosts.some(other => other !== host && other.contains(host)));
  }
  function updateCart(data) {
    cart = data;
    all('[data-cart-count],.cart-count-bubble span[aria-hidden],.cart-count,.cart-item-count,[data-cart-item-count],.cart-drawer__title-count').forEach(node => {node.textContent = data.count;});
    const hosts = cartHosts();
    hosts.forEach(host => { host.dataset.ownedCartLines = ''; host.innerHTML = data.items.length ? data.items.map(lineHtml).join('') : '<p>Your cart is empty.</p>'; });
    all('[data-cart-subtotal],.totals__subtotal-value,.cart-subtotal__price,.cart-drawer__totals__row__money,[data-cart-total]').forEach(node => { if (node !== document.body) node.textContent = money(data.totals.subtotalCents); });
    all('.drawer__heading',drawer||document).forEach(node=>{if(/\b\d+\s+items?\b/i.test(text(node)))node.textContent=text(node).replace(/\b\d+\s+items?\b/i,data.count+' '+(data.count===1?'item':'items'));});
    all('.cart__empty-text,.drawer__inner-empty,.cart-drawer__empty-content').forEach(node => { node.hidden = !!data.count;node.toggleAttribute('data-copy-hidden',!!data.count); });
    all('cart-drawer,cart-drawer-items,.cart-drawer__content').forEach(node=>node.classList.toggle('is-empty',!data.count));
    all('[data-copy-upsell-variant]').forEach(node=>{const selected=data.items.some(item=>item.variantId===node.dataset.copyUpsellVariant);node.dataset.selected=String(selected);one('button',node)?.setAttribute('aria-pressed',String(selected));});
    all('.cart-progress').forEach(node=>{const gap=data.totals.freeShippingGapCents;node.textContent=gap===null?'':gap>0?money(gap)+' away from free shipping':'You qualify for free shipping';node.hidden=gap===null;});
    all('[data-copy-checkout],a[href$="/checkout"],button[name=checkout]').forEach(node => {const disabled=!data.count&&config.assetKind!=='funnel';node.setAttribute('aria-disabled', String(disabled));if('disabled' in node)node.disabled=disabled;if(node.id==='CartDrawer-Checkout'){const value=money(data.totals.subtotalCents);if(/[$€£]\s?[\d,.]+/.test(text(node)))node.textContent=text(node).replace(/[$€£]\s?[\d,.]+/,value);}});
  }
  function findDrawer() { return one('cart-drawer,#CartDrawer,#cart-drawer,.cart-drawer,[data-cart-drawer]'); }
  async function openCart(trigger) {
    if(config.assetKind==='funnel'){location.href=config.base+'/checkout';return;}
    drawer = findDrawer();
    if (!drawer) { location.href = config.base + '/cart'; return; }
    returnFocus = trigger || document.activeElement;
    updateCart(await request('/cart/state'));
    if (!cartHosts().some(host => drawer.contains(host))) {
      const host = document.createElement('div'); host.dataset.ownedCartLines = '';
      const shell = one('.drawer__inner,.cart-drawer__content,[role=dialog]',drawer) || drawer;
      shell.append(host); updateCart(cart);
    }
    if (!one('[data-copy-checkout],a[href$="/checkout"],button[name=checkout]', drawer)) {
      const checkout = document.createElement('a'); checkout.href = config.base + '/checkout'; checkout.dataset.copyCheckout = ''; checkout.textContent = 'Checkout'; checkout.style.cssText = 'display:block;padding:16px;text-align:center;background:#171717;color:#fff;margin:16px 0'; drawer.append(checkout);
    }
    if (!one('[data-copy-close],.drawer__close,.cart-drawer__close,[aria-label="Close"]',drawer)) {
      const close = document.createElement('button'); close.type='button';close.dataset.copyClose='';close.textContent='Close cart';drawer.prepend(close);
    }
    const display=getComputedStyle(drawer).display;drawer.style.setProperty('--copy-drawer-display',display==='none'?(drawer.matches('.drawer')?'flex':'block'):display);if(drawer.matches('.drawer'))drawer.style.height='100dvh';
    drawer.hidden = false; drawer.dataset.copyDrawerOpen = ''; drawer.classList.add('active','is-open');
    drawer.setAttribute('aria-hidden','false'); drawer.setAttribute('role','dialog');drawer.setAttribute('aria-modal','true');
    drawer.style.maxWidth = '100vw'; returnFocus?.setAttribute('aria-expanded','true');
    one('button,a,input',drawer)?.focus();
  }
  function closeCart() {
    if (!drawer) return;
    delete drawer.dataset.copyDrawerOpen; drawer.classList.remove('active','is-open');drawer.hidden=true;drawer.setAttribute('aria-hidden','true');
    returnFocus?.setAttribute('aria-expanded','false'); returnFocus?.focus();
  }
  async function add(node, buyNow) {
    if (busy) return;
    // Funnel offers are confirmed on checkout; stores keep their copied drawer.
    buyNow=buyNow||config.assetKind==='funnel';
    if(config.assetKind==='funnel'&&config.role!=='checkout'){
      const declared=node.getAttribute('href')||node.dataset.copyHref||'';
      location.href=declared.startsWith(config.base+'/pages/')?declared:config.base+'/checkout';return;
    }
    if(one('.subOfferButton.activeOfferType')){announce('Subscriptions are not available in this checkout yet. Choose One time purchase to place an order.');return;}
    const product = productFor(node), picked = choice(node, product);
    const copiedBundle=bundleSelection(node,product);
    if(copiedBundle&&!copiedBundle.quote){announce('This bundle needs verified product pricing before it can be purchased.');return;}
    const offer=all('.khOfferBox.of_selected_box,.pl-item[data-copy-variant-id][aria-checked="true"]').find(box=>box.getClientRects().length);
    if(offer&&!offer.dataset.copyVariantId){announce('This package needs to be linked to a product option in the page editor.');return;}
    if (!product || !picked) { announce(product ? 'Choose an available product option before adding to cart.' : (config.preview ? 'Link a product in the page editor and publish that product before testing checkout. Draft products are not sold.' : 'This product is not available yet.')); return; }
    if (!picked.variant.available) { announce('This option is sold out. Choose another option.'); return; }
    busy = true; node.setAttribute('aria-busy','true');
    try {
      const data = await request(buyNow ? '/checkout/buy':'/cart/add', {variantId:picked.variant.id,quantity:picked.quantity});
      if (buyNow) location.href=config.base+'/checkout';
      else { updateCart(data); announce('Added to cart'); await openCart(node); }
    } catch (error) { announce(error.message); }
    finally { busy=false;node.removeAttribute('aria-busy'); }
  }
  function destination(node) { return node.getAttribute('data-copy-href') || node.getAttribute('href') || node.getAttribute('action') || ''; }
  function kind(node) {
    if (node.closest('[data-owned-checkout],[data-owned-offer]')) return '';
    if(node.dataset.copyAction)return node.dataset.copyAction;
    const route = destination(node), label = text(node) || node.getAttribute('aria-label') || node.getAttribute('title') || '';
    if (/checkout\/buy|buy.?now/i.test(route) || /^(buy (it )?now|order now)/i.test(label) || node.matches('[data-pb-action="buy-now"],.shopify-payment-button__button')) return 'buy';
    if (/cart\/add|add-to-cart/i.test(route) || /^(add to (cart|bag)|add to order)/i.test(label) || node.matches('[data-pb-action="add-to-cart"],[name=add],.single_add_to_cart_button')) return 'add';
    if (/\/(?:checkout|checkouts)(?:[/?#]|$)/i.test(route) || node.matches('[name=checkout],[data-copy-checkout]')) return 'checkout';
    if (/\/cart(?:[?#]|$)/i.test(route) || node.matches('[aria-controls="CartDrawer"],[data-cart-toggle],.header__icon--cart')) return 'cart';
    return '';
  }
  document.addEventListener('click', async event => {
    const node = event.target.closest('a,button,[role=button],[data-copy-href]'); if (!node || (config.scope==='sections'&&!node.closest('[data-pb-imported-section]'))) return;
    if (node.matches('[data-copy-close],.drawer__close,.cart-drawer__close') || (drawer?.contains(node) && /close/i.test(node.getAttribute('aria-label') || ''))) {event.preventDefault();closeCart();return;}
    if (node.matches('[data-copy-remove]')) {event.preventDefault();try{updateCart(await request('/cart/update',{variantId:node.closest('[data-variant-id]').dataset.variantId,quantity:0}));}catch(error){announce(error.message);}return;}
    if(node.matches('.quantity__button,[data-quantity-plus],[data-quantity-minus]')){
      const input=one('input[name=quantity]',node.closest('.quantity,.quantity-selector')||node.parentElement);
      if(input){event.preventDefault();const minus=node.name==='minus'||node.hasAttribute('data-quantity-minus')||/minus|decrease/i.test(node.getAttribute('aria-label')||'');const min=Number(input.min||1),max=Number(input.max||999);input.value=String(Math.min(max,Math.max(min,Number(input.value||1)+(minus?-1:1))));input.dispatchEvent(new Event('change',{bubbles:true}));return;}
    }
    const upsell=node.closest('[data-copy-upsell-variant]');if(upsell){event.preventDefault();try{updateCart(await request(upsell.dataset.selected==='true'?'/cart/update':'/cart/add',{variantId:upsell.dataset.copyUpsellVariant,quantity:upsell.dataset.selected==='true'?0:1}));}catch(error){announce(error.message);}return;}
    const action = kind(node);
    if (action) {
      event.preventDefault();event.stopImmediatePropagation();
      if(action === 'add' || action === 'buy') await add(node,action==='buy');
      else if(action === 'cart') {try{await openCart(node);}catch(error){announce(error.message);}}
      else location.href=config.base+'/checkout';
      return;
    }
    const targetId = node.getAttribute('aria-controls'), panel = targetId && document.getElementById(targetId);
    if (panel && !node.matches('.cc-cart-toggle') && !node.closest('details,media-gallery,slider-component,splide-component,.swiper') && !/swiper|slide/i.test(targetId)) {
      event.preventDefault();const open=node.getAttribute('aria-expanded') !== 'true';node.setAttribute('aria-expanded',String(open));panel.hidden=!open;panel.classList.toggle('active',open);panel.classList.toggle('is-open',open);if(open){panel.style.visibility='visible';panel.style.opacity='1';}return;
    }
    if (!node.getAttribute('href')) {
      const href=destination(node);
      if (href && !/^(javascript|data):/i.test(href)) {event.preventDefault();location.href=href;}
    }
  }, true);
  document.addEventListener('submit', event => {
    const form=event.target;if(config.scope==='sections'&&!form.closest('[data-pb-imported-section]'))return;
    if(one('[data-copy-checkout-field]',form)){event.preventDefault();document.getElementById('checkout-form')?.requestSubmit();return;}
    if(form.hasAttribute('data-owned-offer-form'))return;
    if (form.id==='checkout-form' || form.closest('[data-owned-checkout-summary]')) return;
    const submitter=event.submitter || one('button[type=submit],input[type=submit]',form) || form;
    const action=kind(submitter) || (/cart\/add|add-to-cart/i.test(form.dataset.copyOriginalAction || form.action) ? 'add':'');
    if(action==='add'||action==='buy'){event.preventDefault();event.stopImmediatePropagation();add(submitter,action==='buy');return;}
    // Imported forms cannot submit to the source, including nameless embedded lead forms.
    if (form.dataset.copyOriginalAction !== undefined) {
      if (one('input[type=password],input[autocomplete^="cc-"]',form)) {event.preventDefault();announce('Use this store’s secure checkout to pay.');return;}
      const route=form.dataset.copyForm || 'contact';
      form.action=config.base+'/'+route;form.method=['search','track'].includes(route)?'get':'post';
    }
  },true);
  document.addEventListener('change',async event=>{
    const field=event.target;if(config.scope==='sections'&&!field.closest('[data-pb-imported-section]'))return;
    if(field.matches('[data-copy-quantity]')){try{updateCart(await request('/cart/update',{variantId:field.closest('[data-variant-id]').dataset.variantId,quantity:Number(field.value)}));}catch(error){announce(error.message);}return;}
    if(field.matches('select,input[type=radio]')){
      const product=productFor(field),picked=choice(field,product);
      if(picked){const root=field.closest('form,product-info,.product') || document;all('[data-product-price],.price__regular .price-item--regular',root).forEach(node=>node.textContent=money(picked.variant.price));}
    }
  });
  document.addEventListener('keydown',event=>{
    if(event.key==='Escape'){closeCart();all('[aria-expanded=true][aria-controls]').forEach(node=>{const panel=document.getElementById(node.getAttribute('aria-controls'));if(panel&&!node.closest('details')){node.setAttribute('aria-expanded','false');panel.hidden=true;}});}
    if(event.key==='Tab'&&drawer?.hasAttribute('data-copy-drawer-open')){const focus=all('a[href],button:not([disabled]),input:not([disabled]),[tabindex="0"]',drawer).filter(node=>node.getClientRects().length);const first=focus[0],last=focus.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
  function mountCheckout() {
    if(!config.checkout)return;
    all('.order-bump').forEach(node=>{node.hidden=true;node.dataset.copyHidden='';});
    const original=one('form.fk-card-payment-container') || one('form[action*="checkout"],form[action*="payment"],form[data-copy-original-action*="checkout"],form[data-copy-original-action*="payment"],form#checkout,form.checkout');
    const holder=document.createElement('div');holder.dataset.ownedCheckout='';holder.innerHTML=(config.checkout.error ? '<p role="alert">'+escape(config.checkout.error)+'</p>':'')+config.checkout.express+config.checkout.form;
    const funnelColumn=one('.basic-information-section');
    if(funnelColumn){
      // Script-driven funnel checkouts scatter payment/contact controls across hidden forms.
      // Keep their branded two-column shell, and replace those regions as a unit.
      const layout=funnelColumn.parentElement;layout.dataset.ownedCheckoutLayout='';
      const packages=all('.product-list',funnelColumn).filter(root=>one('[data-copy-variant-id]',root));
      let summary=one('.sidebar',layout);if(!summary){summary=document.createElement('aside');layout.append(summary);}
      funnelColumn.dataset.ownedCheckoutColumn='form';funnelColumn.replaceChildren(...packages,holder);
      summary.dataset.ownedCheckoutColumn='summary';summary.dataset.ownedCheckoutSummary='';
      const summaryTemplate=document.createElement('template');summaryTemplate.innerHTML=config.checkout.summary;const total=text(summaryTemplate.content.querySelector('.grand span:last-child'));
      summary.innerHTML='<details data-owned-summary-details'+(innerWidth>740?' open':'')+'><summary>Order summary <b data-pay-total>'+escape(total)+'</b></summary>'+config.checkout.summary+'</details>';
      return;
    }
    const aliases={emailAddress:'email',shipCountry:'country',shipFirstName:'firstName',shipLastName:'lastName',shipAddress1:'line1',shipAddress2:'line2',shipCity:'city',shipState:'state',shipPostalCode:'postal',phoneNumber:'phone'};
    const canonicalFields=new Map(all('input,select,textarea',holder).map(field=>[field.name,field]));
    const externalFields=new Map();all('input,select,textarea').forEach(field=>{const name=aliases[field.name];if(name&&(!original||!original.contains(field)))externalFields.set(name,field);});
    const useGroup=names=>names.every(name=>externalFields.has(name));
    const bind=names=>names.forEach(name=>{const field=externalFields.get(name);if(!field)return;field.name=name;const canonical=canonicalFields.get(name);if(canonical)field.value=canonical.value;field.setAttribute('form','checkout-form');field.dataset.copyCheckoutField='';field.required=!['line2','state','phone'].includes(name);field.removeAttribute('aria-invalid');if(name==='email'){field.type='email';field.inputMode='email';field.removeAttribute('pattern');}});
    if(useGroup(['email'])){one('input[name=email]',holder)?.closest('.co-block')?.remove();bind(['email']);}
    if(useGroup(['country','firstName','lastName','line1','city','postal'])){
      const delivery=one('input[name=line1]',holder)?.closest('.co-block');
      const missingOptional=['line2','state','phone'].filter(name=>!externalFields.has(name)).map(name=>one('input[name="'+name+'"]',holder)?.closest('.field')).filter(Boolean);
      if(missingOptional.length)delivery?.replaceChildren(...missingOptional);else delivery?.remove();
      bind(['country','firstName','lastName','line1','line2','city','state','postal','phone']);
    }
    if(original)original.replaceWith(holder);
    else {const shell=one('[data-checkout-form],.checkout-form,#checkout-form,.checkout-main,main')||document.body;shell.prepend(holder);}
    // Remove source payment fields and frames outside the replaced form too.
    all('iframe[src*="stripe"],iframe[src*="paypal"],input[autocomplete^="cc-"],input[name=cardNumber],input[name=cardDate],input[name=cardSecurityCode],input[name=credit_card],input[name=card_number],input[name=cvv]').filter(node=>!holder.contains(node)).forEach(node=>node.remove());
    const summaries=all('[data-order-summary],.order-summary__sections,.order-summary,.checkout-summary,[data-checkout-summary]').filter((node,i,nodes)=>!nodes.some(other=>other!==node&&other.contains(node)));
    if(!summaries.length){const summary=document.createElement('aside');holder.after(summary);summaries.push(summary);}
    summaries.forEach(node=>{node.dataset.ownedCheckoutSummary='';node.innerHTML=config.checkout.summary;});
  }
  // Shopify and common lazy-load libraries leave their content hidden when source scripts are removed.
  if(config.scope!=='sections'){document.documentElement.classList.remove('no-js');document.documentElement.classList.add('js');document.body.classList.remove('dom-pending');}
  // These source sections rely on a removed scroll-reveal script. Use its visible
  // state without changing hidden tabs, dialogs, alternate images or other content.
  all('.animate-section.animate--hidden').forEach(section=>{section.classList.remove('animate--hidden');section.classList.add('animate--shown');});
  all('img[data-src],img[data-original],img[data-lazy-src]').forEach(img=>{
    if(!img.getAttribute('src') || /(?:placeholder|transparent|^data:image)/i.test(img.getAttribute('src'))) img.src=img.dataset.src||img.dataset.original||img.dataset.lazySrc;
    if(img.dataset.srcset)img.srcset=img.dataset.srcset;
  });
  all('img,source').forEach(node=>{
    for(const attribute of ['src','srcset']){const value=node.getAttribute(attribute);if(value)node.setAttribute(attribute,value.replace(/(\/_uploads\/[^\s,/?&]+\/[^\s,/?&]+\.(?:avif|webp|png|jpe?g|gif))(?:&(?:amp;)?[^\s,]*)/gi,'$1'));}
    if(node.localName==='img')node.addEventListener('error',()=>{if(node.hasAttribute('srcset')&&node.getAttribute('src'))node.removeAttribute('srcset');},{once:true});
  });
  all('source[data-srcset]').forEach(node=>{if(!node.srcset)node.srcset=node.dataset.srcset;});
  all('[data-bg],[data-background-image]').forEach(node=>{const url=node.dataset.bg||node.dataset.backgroundImage;if(url&&!node.style.backgroundImage&&!/["\\\n\r]/.test(url))node.style.backgroundImage='url("'+url+'")';});
  all('iframe[data-copy-embedded][srcdoc]').forEach(frame=>{
    // Only scriptless captured documents share their layout with the parent.
    if(!frame.sandbox.contains('allow-same-origin')||frame.sandbox.contains('allow-scripts')||frame.sandbox.contains('allow-forms'))return;
    let observer=null,scheduled=null;
    const schedule=()=>{if(scheduled!==null)return;scheduled=requestAnimationFrame(()=>{
      scheduled=null;const doc=frame.contentDocument;if(!doc?.body||doc.URL!=='about:srcdoc'||!frame.getBoundingClientRect().width)return;
      if(frame.id==='looxReviewsFrame'){
        const grid=doc.querySelector('.grid-wrap.list #grid'),cards=grid&&[...grid.children].filter(node=>node.matches('.grid-item-wrap'));
        // Keep the source's absolute-positioned wrappers: they contain each
        // review's margins. Recompute only the single-column vertical offsets.
        if(cards?.length&&cards.every(card=>card.getBoundingClientRect().width>=grid.clientWidth-1)){
          let top=0;for(const card of cards){card.style.setProperty('transition','none','important');card.style.setProperty('transform','none','important');card.style.position='absolute';card.style.left='0px';card.style.top=top+'px';const style=doc.defaultView.getComputedStyle(card);top+=card.getBoundingClientRect().height+(parseFloat(style.marginTop)||0)+(parseFloat(style.marginBottom)||0);}const style=doc.defaultView.getComputedStyle(grid);if(style.boxSizing==='border-box')for(const name of ['paddingTop','paddingBottom','borderTopWidth','borderBottomWidth'])top+=parseFloat(style[name])||0;grid.style.height=top+'px';
        }
      }
      // Shrink before measuring: a prior tall mobile frame otherwise becomes the
      // document's minimum scrollHeight and cannot shrink again on desktop.
      frame.style.setProperty('min-height','0','important');frame.style.setProperty('max-height','none','important');frame.style.setProperty('height','1px','important');
      const height=Math.ceil(Math.max(doc.documentElement.scrollHeight,doc.documentElement.offsetHeight,doc.body.scrollHeight,doc.body.offsetHeight));
      frame.style.setProperty('height',height+'px','important');
    });};
    const connect=()=>{observer?.disconnect();const doc=frame.contentDocument;if(!doc?.body||doc.URL!=='about:srcdoc')return;
      if(frame.id==='looxReviewsFrame')doc.querySelector('[data-copy-review-flow]')?.remove();
      if('ResizeObserver' in window){observer=new ResizeObserver(schedule);observer.observe(frame);observer.observe(doc.documentElement);observer.observe(doc.body);if(frame.id==='looxReviewsFrame')doc.querySelectorAll('.grid-wrap.list #grid > .grid-item-wrap').forEach(card=>observer.observe(card));}
      all('img',doc).forEach(img=>{img.addEventListener('load',schedule);img.addEventListener('error',schedule);});doc.fonts?.ready.then(schedule);schedule();
    };
    frame.addEventListener('load',connect);window.addEventListener('resize',schedule);connect();
  });
  all('slider-component,media-gallery,.swiper').forEach(gallery=>{
    if(gallery.closest('[data-pb-gallery]'))return;
    const list=all('.product__media-list,.thumbnail-list,.swiper-wrapper',gallery).find(node=>node.closest('slider-component,media-gallery,.swiper')===gallery);if(!list||list.dataset.copySlider)return;list.dataset.copySlider='';
    const slides=[...list.children].filter(node=>node.matches('.slider__slide,.swiper-slide'));if(!slides.length)return;
    let continuation=null;
    if(gallery.matches('.mainImage')&&gallery.dataset.copyGalleryLoop==='true'){
      continuation=slides[0].cloneNode(true);continuation.classList.remove('swiper-slide-active','is-active');continuation.dataset.copyGalleryContinuation='';continuation.setAttribute('aria-hidden','true');continuation.inert=true;
      for(const node of [continuation,...continuation.querySelectorAll('*')]){node.removeAttribute('id');node.removeAttribute('data-pb-id');}list.append(continuation);
    }
    const productGallery=gallery.closest('.product-gallery'),mainGallery=productGallery&&one('.mainImage',productGallery);
    const controls=selector=>{
      const own=all(selector,gallery).filter(node=>node.closest('slider-component,media-gallery,.swiper')===gallery);
      // This source places the main gallery's arrows inside its thumbnail shell.
      if(gallery===mainGallery)return [...new Set([...own,...all(selector,productGallery).filter(node=>node.matches('.swiper-button-next,.swiper-button-prev')&&!node.closest('.revSwiper'))])];
      return mainGallery&&gallery.matches('.thumbImage')?own.filter(node=>!node.matches('.swiper-button-next,.swiper-button-prev')):own;
    };
    const offset=index=>slides[index].offsetLeft-slides[0].offsetLeft;
    const currentIndex=()=>slides.reduce((best,_slide,index)=>Math.abs(offset(index)-list.scrollLeft)<Math.abs(offset(best)-list.scrollLeft)?index:best,0);
    const select=index=>list.scrollTo({left:offset(gallery.dataset.copyGalleryLoop==='true'?(index%slides.length+slides.length)%slides.length:Math.max(0,Math.min(slides.length-1,index))),behavior:'smooth'});
    const move=step=>select(currentIndex()+step);
    list.addEventListener('scroll',()=>{const index=currentIndex();slides.forEach((slide,i)=>{slide.classList.toggle('swiper-slide-active',i===index);slide.classList.toggle('is-active',i===index);});controls('.slider-counter--current').forEach(node=>node.textContent=String(index+1));controls('.slider-counter__link--dots').forEach((button,i)=>{button.classList.toggle('slider-counter__link--active',i===index);button.setAttribute('aria-current',String(i===index));});},{passive:true});
    const bindArrow=(node,step)=>{const activate=event=>{event.preventDefault();move(step*(Number(node.dataset.step)||1));};node.addEventListener('click',activate);if(!node.matches('button')){node.setAttribute('role','button');node.tabIndex=0;node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')activate(event);});}};
    controls('button[name=next],.slider-button--next,.swiper-button-next').forEach(node=>bindArrow(node,1));
    controls('button[name=previous],.slider-button--prev,.swiper-button-prev').forEach(node=>bindArrow(node,-1));
    if(gallery.matches('.swiper')){
      list.style.overflowX='auto';list.style.scrollSnapType='x mandatory';list.style.transform='none';list.style.maxWidth='100%';
      const resize=()=>{const available=gallery.getBoundingClientRect().width;const gap=gallery.matches('.thumbImage')?10:gallery.matches('.mainImage')?12:gallery.matches('.revSwiper')?(innerWidth<768?12:16):0;const perView=gallery.matches('.thumbImage')?5:gallery.matches('.mainImage')?(innerWidth<1024?1.15:1):gallery.matches('.revSwiper')?(innerWidth<768?1.2:innerWidth<1024?2.2:3.5):1;const size=(available-gap*(perView-1))/perView;slides.forEach((slide,index)=>{slide.style.scrollSnapAlign='start';if(available>0){slide.style.width=size+'px';slide.style.flex='0 0 '+size+'px';slide.style.marginRight=(!continuation&&gallery.matches('.mainImage')&&index===slides.length-1?Math.max(gap,available-size):gap)+'px';}all('img',slide).forEach(img=>{img.style.maxWidth='100%';img.style.height='auto';});});if(continuation){continuation.style.cssText=slides[0].style.cssText;continuation.style.scrollSnapAlign='none';all('img',continuation).forEach(img=>{img.style.maxWidth='100%';img.style.height='auto';});}};resize();if('ResizeObserver' in window)new ResizeObserver(resize).observe(gallery);
      if(gallery.matches('.mainImage')&&gallery.dataset.copyGalleryLoop==='true'){
        let drag=null;list.style.touchAction='pan-y';
        list.addEventListener('pointerdown',event=>{if(event.pointerType!=='touch')return;drag={id:event.pointerId,x:event.clientX,y:event.clientY,index:currentIndex(),left:list.scrollLeft};list.setPointerCapture(event.pointerId);list.style.scrollSnapType='none';});
        list.addEventListener('pointermove',event=>{if(drag&&Math.abs(event.clientX-drag.x)>Math.abs(event.clientY-drag.y)){event.preventDefault();list.scrollLeft=drag.left+drag.x-event.clientX;}});
        const release=event=>{if(!drag)return;const start=drag;drag=null;list.style.scrollSnapType='x mandatory';const dx=start.x-event.clientX,dy=start.y-event.clientY;select(start.index+(Math.abs(dx)>35&&Math.abs(dx)>Math.abs(dy)?Math.sign(dx):0));};
        list.addEventListener('pointerup',release);list.addEventListener('pointercancel',()=>{drag=null;list.style.scrollSnapType='x mandatory';});
      }
    }
    if(gallery.matches('.thumbImage'))slides.forEach((slide,index)=>{slide.tabIndex=0;slide.setAttribute('role','button');const choose=()=>{const main=one('.mainImage .swiper-wrapper',gallery.closest('.product-gallery')||document);const target=main?.children[index];if(target){main.scrollTo({left:target.offsetLeft-main.offsetLeft,behavior:'smooth'});slides.forEach(other=>other.classList.toggle('swiper-slide-thumb-active',other===slide));}};slide.addEventListener('click',choose);slide.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});});
    controls('.slider-counter__link--dots').forEach((button,index)=>button.addEventListener('click',()=>select(index)));
    if(list.matches('.product__media-list'))all('[data-target]',gallery.closest('media-gallery')||gallery).forEach(button=>button.addEventListener('click',()=>{const index=slides.findIndex(node=>node.dataset.mediaId===button.dataset.target);if(index>=0)select(index);}));
  });
  if(!config.checkout)all('.cc-cart-toggle').forEach(toggle=>{
    const panel=one('.cc-cart-toggle-target.ordSummary');if(!panel)return;
    toggle.setAttribute('role','button');toggle.tabIndex=0;
    const open=()=>getComputedStyle(panel).display!=='none';
    const update=()=>{toggle.setAttribute('aria-expanded',String(open()));if(panel.id)toggle.setAttribute('aria-controls',panel.id);};
    const activate=event=>{event.preventDefault();event.stopPropagation();panel.style.display=open()?'none':'block';update();};
    toggle.addEventListener('click',activate);toggle.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')activate(event);});update();
  });
  all('splide-component[data-slides-mobile][data-destroy-desktop="true"]').forEach((component,number)=>{
    if(component.closest('[data-pb-gallery]'))return;
    if(component.dataset.type&&component.dataset.type!=='slide')return;
    const root=one('.splide',component),track=one('.splide__track',component),list=one('.splide__list',component);if(!root||!track||!list)return;
    const slides=[...list.children].filter(slide=>slide.matches('.splide__slide'));if(!slides.length)return;
    let index=0,active=false,signature='',drag=null;
    let controls=one('.splide__dots-and-arrows',component);
    if(!controls){controls=document.createElement('div');controls.className='splide__dots-and-arrows';root.append(controls);}
    let pagination=one('.splide__pagination',component);
    if(!pagination){pagination=document.createElement('ul');pagination.className='splide__pagination splide__pagination--ltr';pagination.setAttribute('role','tablist');pagination.setAttribute('aria-label','Select a slide to show');controls.append(pagination);}
    if(!track.id)track.id='copy-splide-'+number+'-track';
    let arrows=one('.splide__arrows',component);
    if(!arrows){arrows=document.createElement('div');arrows.className='splide__arrows splide__arrows--ltr';controls.append(arrows);}
    for(const direction of ['prev','next'])if(!one('.splide__arrow--'+direction,component)){const button=document.createElement('button');button.type='button';button.className='splide__arrow color-'+(component.dataset.arrowsColor||'inverse')+' splide__arrow--'+direction;button.setAttribute('aria-label',direction==='prev'?'Previous slide':'Next slide');button.setAttribute('aria-controls',track.id);button.innerHTML='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40" width="40" height="40" focusable="false"><path d="m15.5 0.932-4.3 4.38 14.5 14.6-14.5 14.5 4.3 4.4 14.6-14.6 4.4-4.3-4.4-4.4-14.6-14.6z"></path></svg>';arrows.append(button);}
    const previous=one('.splide__arrow--prev',component),next=one('.splide__arrow--next',component);
    slides.forEach((slide,i)=>{if(!slide.id||document.getElementById(slide.id)!==slide)slide.id='copy-splide-'+number+'-slide-'+i;});
    if(pagination&&!one('button',pagination))slides.forEach((slide,i)=>{const item=document.createElement('li'),button=document.createElement('button');button.type='button';button.className='splide__pagination__page color-'+(component.dataset.dotsColor||'inverse')+' dots-custom-color';button.setAttribute('role','tab');button.setAttribute('aria-controls',slide.id);button.setAttribute('aria-label','Go to slide '+(i+1));item.append(button);pagination.append(item);});
    const dots=pagination?all('button',pagination):[];
    const offset=i=>slides[i].offsetLeft-slides[0].offsetLeft;
    const update=()=>{slides.forEach((slide,i)=>{slide.classList.toggle('is-active',active&&i===index);slide.classList.toggle('is-visible',!active||i===index);if(active)slide.setAttribute('aria-hidden',String(i!==index));else slide.removeAttribute('aria-hidden');});dots.forEach((dot,i)=>{dot.classList.toggle('is-active',i===index);dot.setAttribute('aria-selected',String(i===index));dot.tabIndex=i===index?0:-1;});if(previous)previous.disabled=!active||index===0;if(next)next.disabled=!active||index>=slides.length-1;component.style.setProperty('--active-slide-height',slides[index].offsetHeight+'px');};
    const choose=i=>{if(!active)return;index=Math.max(0,Math.min(slides.length-1,i));list.scrollTo({left:offset(index),behavior:'smooth'});update();};
    previous?.addEventListener('click',()=>choose(index-1));next?.addEventListener('click',()=>choose(index+1));dots.forEach((dot,i)=>{dot.addEventListener('click',()=>choose(i));dot.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();choose(index+(event.key==='ArrowRight'?1:-1));dots[index]?.focus();}});});
    list.addEventListener('scroll',()=>{if(!active)return;index=slides.reduce((best,_slide,i)=>Math.abs(offset(i)-list.scrollLeft)<Math.abs(offset(best)-list.scrollLeft)?i:best,0);update();},{passive:true});
    const resize=()=>{
      const enabled=innerWidth<750,width=track.getBoundingClientRect().width,key=enabled+':'+width;if(key===signature)return;signature=key;active=enabled;root.classList.add('is-initialized');root.classList.toggle('is-active',active);root.classList.toggle('is-overflow',active&&slides.length>Math.max(1,Number(component.dataset.slidesMobile)||1));
      controls.style.setProperty('display',active?'':'none','important');
      if(!active){index=0;for(const property of ['width','max-width','display','overflow-x','overflow-y','scroll-snap-type','scrollbar-width','transform','column-gap','user-select'])list.style.removeProperty(property);track.style.removeProperty('padding-left');track.style.removeProperty('padding-right');slides.forEach(slide=>{for(const property of ['width','flex-basis','margin-right','scroll-snap-align'])slide.style.removeProperty(property);});list.scrollLeft=0;update();return;}
      root.classList.add('splide--slide','splide--ltr');const padding=Math.max(0,Number(component.dataset.sidePaddingMobile)||0),gap=Math.max(0,Number(component.dataset.gapMobile)||0),perView=Math.max(1,Number(component.dataset.slidesMobile)||1);
      track.style.paddingLeft=padding+'px';track.style.paddingRight=padding+'px';const available=track.clientWidth-padding*2,size=Math.max(1,(available-gap*(perView-1))/perView);
      Object.assign(list.style,{width:'100%',maxWidth:'100%',display:'flex',overflowX:'auto',overflowY:'hidden',scrollSnapType:'x mandatory',scrollbarWidth:'none',transform:'none',columnGap:'0px',userSelect:'none'});
      slides.forEach(slide=>{slide.style.width=size+'px';slide.style.flexBasis=size+'px';slide.style.marginRight=gap+'px';slide.style.scrollSnapAlign='start';});list.scrollLeft=offset(index);update();
    };
    list.addEventListener('pointerdown',event=>{if(!active||event.pointerType==='touch'||event.button!==0||event.target.closest('a,button,input,select,textarea'))return;drag={x:event.clientX,left:list.scrollLeft,id:event.pointerId};list.setPointerCapture(event.pointerId);list.style.scrollSnapType='none';event.preventDefault();});
    list.addEventListener('pointermove',event=>{if(drag)list.scrollLeft=drag.left+drag.x-event.clientX;});
    const release=()=>{if(!drag)return;drag=null;index=slides.reduce((best,_slide,i)=>Math.abs(offset(i)-list.scrollLeft)<Math.abs(offset(best)-list.scrollLeft)?i:best,0);list.style.scrollSnapType='x mandatory';choose(index);};list.addEventListener('pointerup',release);list.addEventListener('pointercancel',release);list.addEventListener('dragstart',event=>event.preventDefault());
    window.addEventListener('resize',resize);if('ResizeObserver' in window)new ResizeObserver(resize).observe(track);resize();
  });
  all('cart-drawer-upsell').forEach(node=>{
    const product=config.products.find(product=>product.handle===node.dataset.handle);
    const variant=product?.variants.find(variant=>variant.sourceId===node.dataset.id||variant.id===node.dataset.id)||(product?.variants.length===1?product.variants[0]:null);
    if(!variant){node.hidden=true;node.style.setProperty('display','none','important');return;}
    node.dataset.copyUpsellVariant=variant.id;
    const button=one('button',node);if(button){button.type='button';button.setAttribute('aria-label','Toggle '+product.title);}
  });
  const oneOffer=one('.oneOfferButton'),subOffer=one('.subOfferButton');
  if(oneOffer&&subOffer){
    const activate=subscription=>{
      oneOffer.classList.toggle('activeOfferType',!subscription);subOffer.classList.toggle('activeOfferType',subscription);
      oneOffer.setAttribute('aria-selected',String(!subscription));subOffer.setAttribute('aria-selected',String(subscription));
      all('.khOneOffer').forEach(panel=>{if(!subscription&&!one('.of_selected_box',panel))one('.khOfferBox[data-copy-variant-id]',panel)?.classList.add('of_selected_box');panel.hidden=subscription;panel.style.setProperty('display',subscription?'none':'','important');});
      all('.khSubOffer').forEach(panel=>{panel.hidden=!subscription;panel.style.setProperty('display',subscription?'':'none','important');});
    };
    oneOffer.parentElement.setAttribute('role','tablist');
    [oneOffer,subOffer].forEach((button,index)=>{button.setAttribute('role','tab');button.tabIndex=0;button.addEventListener('click',()=>activate(index===1));button.addEventListener('keydown',event=>{if(['Enter',' ','ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const target=event.key.startsWith('Arrow')?(index===0?subOffer:oneOffer):button;activate(target===subOffer);target.focus();}});});
    activate(subOffer.classList.contains('activeOfferType'));
    all('.khOfferBox').forEach(box=>{box.setAttribute('role','radio');box.tabIndex=0;const choose=async()=>{const panel=box.closest('.khOneOffer,.khSubOffer');if(!panel)return;if(config.assetKind==='funnel'&&config.role==='checkout'&&window.__selectFunnelPackage){if(panel.matches('.khSubOffer')){announce('Subscriptions are not available in this checkout yet. Choose One time purchase to place an order.');return;}if(!box.dataset.copyVariantId||!await window.__selectFunnelPackage(box.dataset.copyVariantId,1))return;}panel.setAttribute('role','radiogroup');all('.khOfferBox',panel).forEach(other=>{other.classList.toggle('of_selected_box',other===box);other.setAttribute('aria-checked',String(other===box));});};box.setAttribute('aria-checked',String(box.classList.contains('of_selected_box')));box.addEventListener('click',choose);box.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();choose();}});});
  }
  all('details.fk-collapsible-list-details').forEach(details=>{
    const summary=one('summary',details);if(!summary)return;
    const update=()=>{all('.fk-collapsible-list-label-icon .open-icon',summary).forEach(icon=>icon.style.setProperty('display',details.open?'none':'flex','important'));all('.fk-collapsible-list-label-icon .close-icon',summary).forEach(icon=>icon.style.setProperty('display',details.open?'flex':'none','important'));};
    details.addEventListener('toggle',update);update();
  });
  all('.scroll-to-top-btn').forEach(button=>{
    const update=()=>{button.style.display=window.scrollY>400?'':'none';};
    button.addEventListener('click',event=>{event.preventDefault();window.scrollTo({top:0,behavior:'smooth'});});window.addEventListener('scroll',update,{passive:true});update();
  });
  all('sticky-header[data-sticky-type="on-scroll-up"]').forEach(header=>{
    const section=header.closest('.section-header');if(!section)return;
    const group=header.closest('sticky-group-manager');if(group)group.style.display='contents';
    const states=['scrolled-past-header','shopify-section-header-hidden','shopify-section-header-sticky','animate'];
    let previous=window.scrollY,bottom=0;
    const measure=()=>{const hidden=section.classList.contains('shopify-section-header-hidden');section.classList.remove(...states);const rect=section.getBoundingClientRect();bottom=rect.bottom+window.scrollY;section.style.setProperty('--header-height',Math.ceil(rect.height)+'px');if(!section.style.getPropertyValue('--sticky-offset'))section.style.setProperty('--sticky-offset','0px');if(!header.style.getPropertyValue('--sticky-offset'))header.style.setProperty('--sticky-offset','0px');if(window.scrollY>bottom){section.classList.add('scrolled-past-header','shopify-section-header-sticky');section.classList.toggle('shopify-section-header-hidden',hidden);section.classList.toggle('animate',!hidden);}};
    const update=()=>{const y=window.scrollY;if(y<=bottom)section.classList.remove(...states);else{section.classList.add('scrolled-past-header','shopify-section-header-sticky');if(y!==previous){const hide=y>previous&&!header.querySelector('details[open]');section.classList.toggle('shopify-section-header-hidden',hide);section.classList.toggle('animate',!hide);}}previous=y;};
    window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',measure);if('ResizeObserver' in window)new ResizeObserver(measure).observe(header);measure();update();
  });
  all('header-drawer details.menu-drawer-container').forEach(details=>{
    details.addEventListener('toggle',()=>{details.classList.toggle('menu-opening',details.open);one('summary',details)?.setAttribute('aria-expanded',String(details.open));});
    all('.menu-drawer__close-menu-btn',details).forEach(button=>button.addEventListener('click',()=>{details.open=false;one('summary',details)?.focus();}));
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&details.open){details.open=false;one('summary',details)?.focus();}});
  });
  all('details-modal.header__search details').forEach(details=>{
    const summary=one('summary',details);
    const close=()=>{details.open=false;summary?.setAttribute('aria-expanded','false');summary?.focus();};
    details.addEventListener('toggle',()=>summary?.setAttribute('aria-expanded',String(details.open)));
    all('.search-modal__close-button',details).forEach(button=>button.addEventListener('click',event=>{event.preventDefault();close();}));
    details.addEventListener('keydown',event=>{if(event.key==='Escape'&&details.open){event.preventDefault();close();}});
  });
  try{
    const metadata=JSON.parse(one('script[data-pb-document]')?.textContent||'{}');
    Object.entries(metadata.nodes||{}).forEach(([id,node])=>{if(!['cart.add','cart.buyNow'].includes(node.binding?.field))return;const el=all('[data-pb-id]').find(el=>el.getAttribute('data-pb-id')===id);if(el){el.dataset.copyAction=node.binding.field==='cart.add'?'add':'buy';el.dataset.pbProduct=node.binding.productId;}});
  }catch{/* An old editor metadata snapshot does not stop the source page. */}
  mountCopiedBundles();
  mountCheckout();
  mountSourcePackages();
  if(config.role==='cart'){
    if(!cartHosts().length){const host=document.createElement('div');host.dataset.ownedCartLines='';(one('main,.cart-page,#MainContent')||document.body).append(host);}
  }
  if(findDrawer()||config.role==='cart'||one('[data-cart-count],.cart-count-bubble'))request('/cart/state').then(updateCart).catch(()=>{});
  window.__COPY_COMMERCE_READY=true;
})();
