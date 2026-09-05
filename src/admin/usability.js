// Shared enhancements for server-rendered admin forms and data tables.
(function () {
  var page = document.querySelector('main.page');
  if (!page) return;
  var sequence = 0;
  page.querySelectorAll('.field').forEach(function (field) {
    var label = field.querySelector(':scope > label');
    var control = field.querySelector(':scope > input:not([type=hidden]), :scope > select, :scope > textarea');
    if (!label || !control || label.htmlFor || control.labels.length || control.hasAttribute('aria-labelledby')) return;
    if (!control.id) {
      var candidate;
      do { candidate = 'admin-field-' + (++sequence); } while (document.getElementById(candidate));
      control.id = candidate;
    }
    label.htmlFor = control.id;
  });
  page.querySelectorAll('table.data').forEach(function (table) {
    if (table.parentElement.classList.contains('data-scroll')) return;
    var region = document.createElement('div');
    region.className = 'data-scroll';
    region.tabIndex = 0;
    region.setAttribute('role', 'region');
    var heading = table.closest('.card')?.querySelector('h2,h3') || page.querySelector('h1');
    region.setAttribute('aria-label', (heading?.textContent.trim() || 'Data') + ' table; scroll for more columns');
    table.before(region);
    region.appendChild(table);
    var hint = document.createElement('p');
    hint.className = 'data-scroll-hint';
    hint.textContent = 'Scroll sideways to see all columns →';
    hint.hidden = true;
    region.after(hint);
    function updateHint() { hint.hidden = table.scrollWidth <= region.clientWidth + 1; }
    if (typeof ResizeObserver !== 'undefined') {
      var observer = new ResizeObserver(updateHint);
      observer.observe(region);
      observer.observe(table);
    }
    updateHint();
  });
  var toggle = document.getElementById('nav-toggle');
  var rail = document.querySelector('.rail');
  if (toggle && rail) {
    function close() {
      document.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Open navigation');
    }
    toggle.addEventListener('click', function () {
      var open = document.body.classList.contains('nav-open');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && document.body.classList.contains('nav-open')) { close(); toggle.focus(); }
    });
    document.addEventListener('click', function (event) {
      if (!rail.contains(event.target) && !toggle.contains(event.target)) close();
    });
  }
})();
