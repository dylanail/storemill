/** Both entry points describe the same crawl boundaries. A page in the page
 * editor stays in the current site; asset imports always create a new draft. */
export function copyOptions(inCurrentSite = false): string {
  return `<fieldset data-copy-options style="border:0;padding:0;margin:0 0 16px"><legend>What to copy</legend>
    <label class="field"><span>Copy scope</span><select name="scope" aria-label="Copy scope" data-copy-scope>
      <option value="page">One page only</option><option value="selected">Only the pages I list</option><option value="site">Whole site — follow linked pages</option>
    </select></label>
    <p class="muted" data-copy-description></p>
    <div data-copy-extras hidden><label class="field"><span data-copy-extra-label>Other page URLs (one per line)</span><textarea name="additionalUrls" rows="3" placeholder="https://example.com/checkout&#10;https://example.com/upsell" disabled></textarea></label></div>
    <p role="status" aria-live="polite" data-copy-count></p>
  </fieldset><script>(function(){
    const form=document.currentScript.closest('form'),scope=form.querySelector('[data-copy-scope]'),extras=form.querySelector('[data-copy-extras]'),urls=extras.querySelector('textarea'),description=form.querySelector('[data-copy-description]'),count=form.querySelector('[data-copy-count]');
    function update(){const page=scope.value==='page',site=scope.value==='site';extras.hidden=page;urls.disabled=page;
      form.querySelector('[data-copy-extra-label]').textContent=site?'Additional starting URLs for unlinked pages (optional)':'Other pages to copy (one URL per line)';
      description.textContent=page?${JSON.stringify(inCurrentSite ? 'Copies this URL into the current site. Other pages are not followed.' : 'Creates a new draft containing this page and its related products. Other pages are not followed.')} : site?'Creates a new draft by following readable links across the site, including product, policy and funnel pages. Extra URLs add starting points; their links are followed too.':'Creates a new draft containing only the starting URL and the URLs below, plus their related products. Links to other pages are not followed.';
      const start=form.querySelector('input[name=url]')?.value.trim(),listed=new Set([start,...(page?[]:urls.value.split(/\\r?\\n/).map(url=>url.trim()))].filter(Boolean));count.textContent=site?'Whole-site copy: the final page count depends on discovered links.':listed.size+' requested page'+(listed.size===1?'':'s')+'. No extra checkout page will be generated.';
      form.querySelectorAll('[data-copy-page-settings]').forEach(group=>{group.hidden=!page;group.querySelectorAll('input,select').forEach(input=>input.disabled=!page)});
    }
    scope.addEventListener('change',update);form.addEventListener('input',update);update();
  })();</script>`
}
