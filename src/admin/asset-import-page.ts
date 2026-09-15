import { escapeHtml as e } from '../lib/http.ts'
import { json } from '../lib/db.ts'
import type { ImportJob, ImportResult } from '../control/asset-import-jobs.ts'
import type { ImportProgress } from '../control/assets.ts'

export function recentImports(jobs: ImportJob[]): string {
  if (!jobs.length) return ''
  // Active work stays visible even when more recent jobs have already finished.
  const shown = [...jobs.filter(job => ['queued','working'].includes(job.status)), ...jobs.filter(job => !['queued','working'].includes(job.status)).slice(0, 6)]
  return `<section class="card" aria-label="Recent site clones"><h2>Recent site clones</h2><p class="muted">Estimated completion updates while your clones run.</p>${shown.map(job => {
    const progress = json<Partial<ImportProgress>>(job.progress, {}), input = json<{name?:string;url?:string}>(job.input, {})
    const percent = job.status === 'done' ? 100 : Math.max(0, Math.min(99, Number(progress.percent) || 0))
    let title = input.name || input.url || 'Site clone'
    if (!input.name && input.url) { try { title = new URL(input.url).hostname } catch {} }
    return `<article data-import-job="${e(job.id)}" data-status="${job.status}" style="padding:12px 0;border-top:1px solid var(--line)"><div class="row" style="justify-content:space-between"><a data-import-link href="/admin/imports/${e(job.id)}">${e(title)}</a><strong data-import-percent>${percent}%</strong></div><progress data-import-progress aria-label="Estimated clone progress" value="${percent}" max="100" style="width:100%;accent-color:#315be8"></progress><p><span data-import-status>${e(job.status)}</span> · <span data-import-count>${progress.copied || 0} pages</span> · <span data-import-task>${e(job.error || progress.task || '')}</span></p><p data-import-connection class="muted" role="status"></p></article>`
  }).join('')}<script>(()=>{
    let stopped=false;addEventListener('pagehide',()=>stopped=true);
    const active=row=>['queued','working'].includes(row.dataset.status);
    async function poll(row){if(stopped||!active(row))return;let delay=1500;try{
      const response=await fetch('/admin/imports/'+encodeURIComponent(row.dataset.importJob)+'/status',{credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});
      if(!response.ok||response.redirected)throw Error();const job=await response.json(),p=job.progress||{};
      const percent=job.status==='done'?100:Math.max(0,Math.min(99,Number(p.percent)||0));row.dataset.status=job.status;
      row.querySelector('[data-import-percent]').textContent=percent+'%';row.querySelector('progress').value=percent;
      row.querySelector('[data-import-status]').textContent=job.status;row.querySelector('[data-import-count]').textContent=(p.copied||0)+' pages';
      row.querySelector('[data-import-task]').textContent=job.error||p.task||'';row.querySelector('[data-import-connection]').textContent='';
      if(job.status==='done')row.querySelector('[data-import-link]').href='/admin/imports/'+encodeURIComponent(job.id)+'/open';
    }catch{delay=4000;row.querySelector('[data-import-connection]').textContent='Reconnecting… Your clone continues on the server.'}
    if(!stopped&&active(row))setTimeout(()=>poll(row),delay)}
    document.querySelectorAll('[data-import-job]').forEach(row=>{if(active(row))poll(row)});
  })()</script></section>`
}

export function importJobPage(job: ImportJob): string {
  const progress=json<Partial<ImportProgress>>(job.progress,{}),result=json<Partial<ImportResult>>(job.result,{})
  const running=['queued','working'].includes(job.status)
  const input=json<{scope?:string;additionalUrls?:string[]}>(job.input,{}),whole=!input.scope||input.scope==='site'||input.scope==='funnel'
  const scopeLabel=whole?'Whole site — linked pages included':input.scope==='page'?'One page only':'Only the listed pages'
  return `<div class="head"><div><h1>Copying your ${whole ? 'site' : 'selected pages'}</h1><p><strong>${scopeLabel}</strong></p><p class="muted">You can leave this page and reopen the clone from Stores & funnels.</p></div><a class="btn" href="/admin/stores">Stores & funnels</a></div>
  <section class="card" style="max-width:900px"><div class="row" style="justify-content:space-between"><h2 id="copy-task" role="status" aria-live="polite">${e(progress.task||job.status)}</h2><strong id="copy-percent">${progress.percent||0}%</strong></div>
  <progress id="copy-progress" aria-label="Estimated clone progress" value="${progress.percent||0}" max="100" style="width:100%;height:24px;margin:20px 0;accent-color:#315be8"></progress>
  <p id="copy-counts">${progress.copied||0} pages copied · ${progress.discovered||1} discovered · ${progress.products||0} products · ${progress.images||0} images</p>
  <p id="copy-url" class="muted" style="overflow-wrap:anywhere">${e(progress.currentUrl||'')}</p><p class="muted">${whole ? 'Percentage is estimated as new links are discovered.' : 'Only your requested URLs are copied; links to other pages are not followed.'} Products, prices and offers are connected after pages finish copying.</p>
  <p id="copy-error" role="alert">${e(job.error)}</p><p id="copy-connection" class="muted"></p>
  <form id="copy-cancel" method="post" action="/admin/imports/${e(job.id)}/cancel" ${running?'':'hidden'}><button class="btn" type="submit">Cancel clone</button></form>
  <div id="copy-result" ${job.status==='done'?'':'hidden'}><p id="copy-summary">${result.pages||0} pages and ${result.products||0} products saved as a new draft. ${result.complete?'':'Review the report for any gaps.'}</p><a class="btn primary" href="/admin/imports/${e(job.id)}/open">Open copied site</a> <a class="btn" href="/admin/imports/${e(job.id)}/open?report=1">View pages and copy report</a></div>
  <a id="copy-retry" class="btn" href="/admin/stores#new" ${['failed','cancelled'].includes(job.status)?'':'hidden'}>Start another clone</a></section>
  <script>(function(){const running=${running};if(!running)return;const set=(id,value)=>document.getElementById(id).textContent=value;async function poll(){try{const response=await fetch('/admin/imports/${e(job.id)}/status',{credentials:'same-origin',cache:'no-store'});if(!response.ok)throw Error();const job=await response.json(),p=job.progress||{},r=job.result||{};set('copy-task',job.status==='cancelled'?'Clone cancelled':job.status==='failed'?'Clone needs attention':p.task||job.status);set('copy-percent',(p.percent||0)+'%');document.getElementById('copy-progress').value=p.percent||0;set('copy-counts',(p.copied||0)+' pages copied · '+(p.discovered||1)+' discovered · '+(p.products||0)+' products · '+(p.images||0)+' images');set('copy-url',p.currentUrl||'');set('copy-error',job.error||'');set('copy-connection','');const active=['queued','working'].includes(job.status);document.getElementById('copy-cancel').hidden=!active;document.getElementById('copy-result').hidden=job.status!=='done';document.getElementById('copy-retry').hidden=!['failed','cancelled'].includes(job.status);if(job.status==='done')set('copy-summary',r.pages+' pages and '+r.products+' products saved as a new draft. '+(r.complete?'All requested copy work completed.':'Review the report for any gaps.'));if(active)setTimeout(poll,1500)}catch{set('copy-connection','Connection interrupted. Reconnecting; your clone continues on the server.');setTimeout(poll,4000)}}setTimeout(poll,250)})()</script>`
}
