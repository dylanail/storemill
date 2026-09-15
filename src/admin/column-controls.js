/* Shared percentage controls for native blocks and imported layout containers. */
window.__COLUMN_LAYOUT = (() => {
  const normalize = (value, count) => {
    let values = Array.isArray(value) ? value.map(Number) : String(value || '').split(/[,\s]+/).filter(Boolean).map(Number);
    if (values.length !== count || values.some(n => !Number.isFinite(n) || n <= 0)) values = Array(count).fill(1);
    const total = values.reduce((sum, n) => sum + n, 0);
    const points = values.map(n => Math.floor(n / total * 10000));
    for (let left = 10000 - points.reduce((sum, n) => sum + n, 0), i = 0; left > 0; left--, i++) points[i % count]++;
    return points.map(n => n / 100);
  };
  const change = (values, index, amount) => {
    const count = values.length;
    if (count === 1) return [100];
    const chosen = Math.max(1, Math.min(100 - (count - 1), Number(amount)));
    const weights = values.map((v, i) => i === index ? 0 : Math.max(0, v - 1));
    const total = weights.reduce((sum, v) => sum + v, 0), rest = 100 - chosen - (count - 1);
    return normalize(values.map((v, i) => i === index ? chosen : 1 + rest * (total ? weights[i] / total : 1 / (count - 1))), count);
  };
  const tracks = values => values.map(n => `minmax(0,${n}fr)`).join(' ');
  const panel = (count, widths, device) => `<section class="column-controls" aria-label="Column layout"><div class="column-heading"><strong>Columns</strong><span>${device}</span></div><label class="v-field"><span>Columns per row</span><select data-column-count aria-label="Columns per row">${[1,2,3,4,5,6].map(n => `<option value="${n}" ${n === count ? 'selected' : ''}>${n}</option>`).join('')}</select></label><div class="column-diagram" aria-hidden="true" style="grid-template-columns:${tracks(widths)}">${widths.map(n => `<span>${n}%</span>`).join('')}</div><div class="column-widths">${widths.map((n,i) => `<div class="column-width"><label for="column-width-${i}">Column ${i+1}</label><div><input id="column-width-${i}" data-column-width="${i}" aria-label="Column ${i+1} width percent" type="number" min="1" max="${100-count+1}" step="0.01" value="${n}" ${count===1?'disabled':''}><span>%</span></div><input type="range" data-column-slider="${i}" aria-label="Resize column ${i+1}" min="1" max="${100-count+1}" step="0.01" value="${n}" ${count===1?'disabled':''}></div>`).join('')}</div><div class="column-actions"><button type="button" class="btn" data-column-equal>Equal widths</button><span>Total: <b data-column-total>100%</b></span></div><small>Changing one width adjusts the others to keep the row at 100%. Extra items wrap to the next row.</small></section>`;
  const bind = (root, initial, apply, countChanged, begin = () => {}, finish = () => {}) => {
    let widths = [...initial];
    const update = values => {
      if (apply(values) === false) return;
      widths = values;
      root.querySelector('.column-diagram').style.gridTemplateColumns = tracks(widths);
      root.querySelector('.column-diagram').innerHTML = widths.map(n => `<span>${n}%</span>`).join('');
      root.querySelectorAll('[data-column-width],[data-column-slider]').forEach(input => { input.value = widths[Number(input.dataset.columnWidth ?? input.dataset.columnSlider)]; });
    };
    root.querySelector('[data-column-count]').onchange = event => { finish(); countChanged(Number(event.target.value)); };
    root.querySelectorAll('[data-column-width],[data-column-slider]').forEach(input => {
      input.addEventListener('input', () => {
        if (!input.value || !Number.isFinite(Number(input.value)) || !input.checkValidity()) return;
        begin(); update(change(widths, Number(input.dataset.columnWidth ?? input.dataset.columnSlider), Number(input.value)));
      });
      input.addEventListener('change', finish);
      input.addEventListener('blur', () => { input.value = widths[Number(input.dataset.columnWidth ?? input.dataset.columnSlider)]; finish(); });
    });
    root.querySelector('[data-column-equal]').onclick = () => { begin(); update(normalize([], widths.length)); finish(); };
  };
  return { normalize, change, tracks, panel, bind };
})();
