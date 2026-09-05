(function () {
  const config = window.__COPY_COMMERCE;
  if (!config) return;
  const images = [...document.querySelectorAll('img[data-copy-desktop-src]')].filter(image => config.scope !== 'sections' || image.closest('[data-pb-imported-section]'));
  const update = () => {
    const device = innerWidth <= 600 ? 'mobile' : innerWidth <= 1024 ? 'tablet' : 'desktop';
    for (const image of images) {
      const prefix = 'data-copy-' + (image.hasAttribute('data-copy-' + device + '-src') ? device : 'desktop') + '-';
      for (const name of ['src', 'width', 'height']) {
        const value = image.getAttribute(prefix + name);
        if (name === 'src') { if (value && image.getAttribute(name) !== value) image.setAttribute(name, value); }
        else if (value) image.setAttribute(name, value);
        else image.removeAttribute(name);
      }
    }
  };
  update();
  window.addEventListener('resize', update, { passive: true });
})();
