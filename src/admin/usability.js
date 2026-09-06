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
})();
