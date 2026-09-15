(async () => {
  const absolute = value => { if (!value?.trim()) return ''; try { return new URL(value, document.baseURI).href; } catch { return ''; } };
  const rendered = node => {
    const rect = node.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || rect.right <= 0 || rect.left >= innerWidth) return false;
    for (let current = node; current; current = current.parentElement || current.getRootNode()?.host) {
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      const box = current.getBoundingClientRect();
      if ((box.width <= 1 || box.height <= 1) && /hidden|clip/.test(style.overflow)) return false;
    }
    return true;
  };
  const issues = [];
  // Preserve local browser image bytes before their blob URLs lose their context.
  await Promise.all([...document.images].map(async img => {
    const selected = img.currentSrc || (img.getAttribute('src')?.trim() ? img.src : '');
    if (/^blob:/i.test(selected)) {
      try {
        const blob = await fetch(selected).then(response => response.blob());
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        img.src = data; img.removeAttribute('srcset');
        for (const name of ['data-src', 'data-original', 'data-lazy-src', 'data-srcset']) if (img.hasAttribute(name)) img.setAttribute(name, img.getAttribute(name).split(selected).join(data));
        for (const source of img.closest('picture')?.querySelectorAll('source[srcset]') || []) source.srcset = source.srcset.split(selected).join(data);
      } catch { issues.push('A browser-generated image could not be preserved.'); }
    } else if ((!img.getAttribute('src') || /^(?:data:|about:)/i.test(img.getAttribute('src'))) && /^https?:/.test(selected)) img.setAttribute('src', selected);
    const lazy = img.dataset.src || img.dataset.original || img.dataset.lazySrc;
    if (lazy && (!img.getAttribute('src') || /(?:^data:image|transparent|placeholder|^about:blank)/i.test(img.getAttribute('src')))) img.src = absolute(lazy);
    if (img.dataset.srcset && !img.getAttribute('srcset')) img.srcset = img.dataset.srcset;
    img.setAttribute('loading', 'eager');
  }));
  for (const gallery of document.querySelectorAll('.swiper')) if (gallery.swiper?.params?.loop === true) gallery.setAttribute('data-copy-gallery-loop', 'true');
  // Public initial choice state lives in DOM properties after hydration. Keep
  // those choices, while omitting credentials or source payment/session values.
  for (const select of document.querySelectorAll('select')) for (const option of select.options) option.toggleAttribute('selected', option.selected);
  for (const input of document.querySelectorAll('input')) {
    const privateField = input.type === 'password' || /^(?:cc-|current-password|new-password|one-time-code)/i.test(input.autocomplete || '') || /(?:password|card.?number|card.?date|card.?security|credit.?card|cvv|cvc|(?:^|[_\[-])(?:token|csrf|session|secret)(?:$|[_\]-]))/i.test(input.name || input.id || '');
    if (privateField) { input.value = ''; input.removeAttribute('value'); }
    if (input.type === 'checkbox' || input.type === 'radio') input.toggleAttribute('checked', input.checked);
  }
  // Nonempty styles can receive insertRule/deleteRule updates too.
  for (const style of document.querySelectorAll('style:not([data-copy-adopted])')) {
    if (!style.sheet) continue;
    try { const rules = [...style.sheet.cssRules].map(rule => rule.cssText).join('\n'); if (rules !== style.textContent) style.textContent = rules; } catch { issues.push('An injected stylesheet could not be serialized.'); }
  }
  if (document.adoptedStyleSheets?.length) {
    let style = document.querySelector('style[data-copy-adopted]');
    if (!style) { style = document.createElement('style'); style.dataset.copyAdopted = ''; document.head.append(style); }
    try { style.textContent = document.adoptedStyleSheets.flatMap(sheet => [...sheet.cssRules].map(rule => rule.cssText)).join('\n'); } catch { issues.push('An adopted stylesheet could not be serialized.'); }
  }
  const images = [...document.images];
  const imageKey = image => {
    if (image.id && document.querySelectorAll('#' + CSS.escape(image.id)).length === 1) return 'id:' + image.id;
    const path = [];
    for (let node = image; node?.parentElement; node = node.parentElement) {
      const siblings = [...node.parentElement.children].filter(other => other.localName === node.localName);
      path.unshift(node.localName + ':' + siblings.indexOf(node));
      if (node.parentElement.id) { path.unshift('id:' + node.parentElement.id); break; }
    }
    return path.join('/');
  };
  const imageElements = images.map((img, index) => {
    img.setAttribute('data-copy-capture-image', String(index));
    return { index, key: imageKey(img), alt: img.getAttribute('alt') || '', src: img.getAttribute('src') ? absolute(img.getAttribute('src')) : '', srcset: img.getAttribute('srcset') || '', picture: !!img.closest('picture'), width: img.getAttribute('width'), height: img.getAttribute('height') };
  });
  const remainingBlobs = [...document.querySelectorAll('img,source')].filter(node => ['src', 'srcset', 'data-src', 'data-srcset'].some(name => /blob:/i.test(node.getAttribute(name) || '')));
  if (remainingBlobs.length) issues.push(`${remainingBlobs.length} image source(s) still use browser-scoped blob URLs.`);
  for (const canvas of document.querySelectorAll('canvas')) if (rendered(canvas)) issues.push(`Visible canvas needs its original media or interactive implementation; it was not replaced with a screenshot: canvas${canvas.id ? '#' + canvas.id : ''}.`);
  const imageUrls = new Set(images.filter(rendered).map(img => img.currentSrc || img.src).filter(url => /^(?:https?:|data:image)/.test(url)));
  const declaredImageUrls = new Set(images.map(img => absolute(img.getAttribute('src') || '')).filter(Boolean));
  for (const node of document.querySelectorAll('style,[style]')) {
    const css = (node.localName === 'style' ? node.textContent : node.getAttribute('style')) || '';
    for (const match of css.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^\s)]+))\s*\)/g)) {
      const url = absolute(match[1] || match[2] || match[3]);
      if (/^(?:https?:|data:image)/.test(url)) { imageUrls.add(url); declaredImageUrls.add(url); }
    }
  }
  for (const node of document.querySelectorAll('img[srcset],source[srcset]')) {
    // Descriptors delimit candidates without splitting commas inside CDN paths.
    const srcset = node.getAttribute('srcset') || '';
    for (const match of srcset.matchAll(/(?:^|,\s*)(\S+?)\s+\d+(?:\.\d+)?[wx](?=\s*(?:,|$))/g)) declaredImageUrls.add(absolute(match[1]));
    if (!/\s\d+(?:\.\d+)?[wx](?:\s*,|\s*$)/.test(srcset)) for (const candidate of srcset.split(/,\s+/)) declaredImageUrls.add(absolute(candidate.trim()));
  }
  const shadowWidgets = [];
  for (const host of document.querySelectorAll('*')) {
    if (!host.shadowRoot) continue;
    const content = [...host.shadowRoot.querySelectorAll('img,svg,canvas,picture,p,span,button,a')].some(node => rendered(node) && (node.matches('img,svg,canvas,picture') || node.textContent.trim()));
    if (!content) continue;
    const provider = host.matches('shopify-payment-terms,shop-cart-sync,shopify-accelerated-checkout,shopify-accelerated-checkout-cart,apple-pay-button');
    shadowWidgets.push({ host: host.tagName.toLowerCase() + (host.id ? '#' + host.id : ''), provider });
  }
  return {
    images: images.length,
    broken: [...new Set(images.filter(img => rendered(img) && (img.currentSrc || img.getAttribute('src')) && (!img.complete || !img.naturalWidth)).map(img => img.currentSrc || img.src))],
    imageUrls: [...imageUrls], declaredImageUrls: [...declaredImageUrls], imageElements, issues,
    iframes: [...document.querySelectorAll('iframe')].filter(rendered).map(frame => frame.src || 'inline iframe'),
    shadowRoots: shadowWidgets.filter(widget => !widget.provider).length,
    shadowWidgets
  };
})()
