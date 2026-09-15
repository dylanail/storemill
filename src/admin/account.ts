import { readFileSync } from 'node:fs'
import { brandHead, brandLogo, brandStyles } from '../brand/index.ts'
import { escapeHtml } from '../lib/http.ts'
import { format } from '../lib/money.ts'
import type { Db } from '../lib/db.ts'
import { environment, type Store } from '../control/stores.ts'
import { domainsFor } from '../control/domains.ts'
import { salesSummary } from '../domain/orders.ts'
import { adminCss } from './shell.ts'

/**
 * The account level: everything above a single store.
 *
 * The store shell (rail, assistant panel, publish button) belongs to one
 * store and cannot render without one, so the hub that lists *all* of them —
 * and the empty state of an account with none — needs its own frame. Signing
 * in lands here whenever there is no store to open, which is the difference
 * between "here is your account" and being marched into onboarding with no
 * way back.
 */
export function accountShell(input: { userName: string; title: string; body: string }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)} — storemill</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;500&display=swap">
${brandHead}<style>${brandStyles}${adminCss('#315be8')}
.account{max-width:1120px;margin:0 auto;padding:2rem 1.5rem 4rem}
.account .asset-grid{grid-template-columns:repeat(auto-fill,minmax(min(275px,100%),1fr))}
.account .head{flex-wrap:wrap;gap:12px}
.account-shell>.top{height:auto;min-height:56px;flex-wrap:wrap;padding:.7rem 1rem}
.account-shell>.top .chip{display:inline-flex}
@media(max-width:600px){.account{padding:1rem}.account .asset-create{grid-template-columns:minmax(0,1fr)}.account-shell>.top .muted{max-width:100%;overflow-wrap:anywhere}}
.account .grid3{grid-template-columns:repeat(auto-fill,minmax(min(330px,100%),1fr))}
.storecard{display:flex;flex-direction:column;gap:.6rem}
.storecard .top-row{flex-wrap:nowrap;align-items:flex-start;justify-content:space-between;gap:.6rem}
.storecard h2{font-size:1.05rem;line-height:1.2}
.storecard .addr{font-size:11.5px;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-decoration:none}
.storecard .addr:hover{color:var(--ink)}
.storecard .nums{display:grid;grid-template-columns:repeat(3,1fr);gap:.4rem;font-size:11px}
.storecard .nums b{display:block;font-size:1.1rem;font-weight:500;font-variant-numeric:tabular-nums;color:var(--ink)}
.storecard .actions{flex-wrap:nowrap;margin-top:auto;padding-top:.2rem}
.storecard .actions .btn{flex:1;justify-content:center;padding:.5rem .5rem}
.mark{width:38px;height:38px;border-radius:9px;object-fit:cover;background:var(--paper);border:1px solid var(--line)}
.mark.letter{display:grid;place-items:center;font:500 16px/1 'Playfair Display',Georgia,serif;color:var(--accent)}
.blank{background:#fff;border:1px solid var(--line);border-radius:14px;padding:2.4rem 2rem;text-align:center;max-width:640px;margin:2rem auto}
.blank h2{font-family:'Playfair Display',Georgia,serif;font-size:1.5rem;font-weight:400;margin-bottom:.4rem}
.blank ol{text-align:left;max-width:420px;margin:1.2rem auto 1.6rem;padding-left:1.1rem;color:var(--muted);font-size:12.5px;line-height:1.9}
</style></head><body class="account-shell">
<div class="top">
  <a class="logo" href="/admin/stores" aria-label="storemill home">${brandLogo(true)}</a>
  <a class="chip" href="/admin/stores" aria-current="page">Stores &amp; funnels</a>
  <a class="chip" href="/admin/stores?new=1#new">+ New store or funnel</a>
  <div class="spacer"></div>
  <span class="muted" style="font-size:12px">${escapeHtml(input.userName)}</span>
  <form method="post" action="/logout"><button class="chip" type="submit">Sign out</button></form>
</div>
<main class="account" id="main">${input.body}</main>
<script>${readFileSync(new URL('./usability.js', import.meta.url), 'utf8')}</script>
</body></html>`
}

/** Where each store actually answers: a verified custom domain wins over the subdomain. */
function addressOf(db: Db, store: Store, origin: string): string {
  const hosted = domainsFor(db, store.id).find((domain) => domain.status === 'verified' && domain.mode === 'host')
  if (hosted) return `https://${hosted.hostname}`
  const root = process.env.AMBORAS_STOREFRONT_HOST
  if (root) return `https://${store.slug}.${root}`
  return `${origin}/s/${store.slug}`
}

/** The merchant's own view of work that is not open yet. */
function previewOf(store: Store, origin: string): string {
  return `${origin}/preview/${store.slug}`
}

/**
 * Every store on the account, with the numbers that say whether it is a
 * business yet, and one button to start another.
 */
export function storesHub(input: { db: Db; stores: Store[]; userName: string; origin: string; flash?: string }): string {
  const { db, stores } = input
  const flash = input.flash
    ? `<div class="notice flash${input.flash.startsWith('!') ? ' bad' : ''}" style="margin-bottom:1.2rem">${escapeHtml(input.flash.replace(/^!/, ''))}</div>`
    : ''
  if (!stores.length) {
    return `${flash}<div class="blank">
      <h2>No stores yet, ${escapeHtml(input.userName)}.</h2>
      <p class="muted">This is where every store you run will live — its address, its orders, its numbers — and where you start the next one.</p>
      <ol>
        <li>Say what you sell, in one sentence.</li>
        <li>Research runs first: who buys it, what stops them, what they pay.</li>
        <li>Brand, three products with full pages, a code, a bundle — at an address you can open.</li>
      </ol>
      <a class="btn primary" href="/onboarding">Build your first store</a>
    </div>`
  }
  const live = stores.filter((store) => store.status === 'live').length
  return `${flash}<div class="head">
    <div><h1 class="serif">Your stores</h1>
      <p class="muted" style="margin:.25rem 0 0">${stores.length} store${stores.length === 1 ? '' : 's'}, ${live} live. Each one is its own catalog, customers, orders, brand and address.</p></div>
    <a class="btn primary" href="/admin/stores?new=1#new">+ New store or funnel</a></div>
  <div class="grid3">${stores
    .map((store) => {
      const products = db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND status = 'published'", store.id)?.c ?? 0
      const sales = salesSummary(db, store.id, 30)
      const published = environment(db, store.id, 'live').publishedAt
      const open = store.status === 'live'
      const address = addressOf(db, store, input.origin)
      const preview = previewOf(store, input.origin)
      // Only a published store answers at its public address; anything else
      // shows the visitor a closed sign, so the link that belongs on the card
      // is the draft.
      const visit = open ? address : preview
      const state = open ? 'ok' : store.status === 'paused' ? 'bad' : 'warn'
      return `<div class="card storecard">
      <div class="row top-row">
        <div class="row" style="flex-wrap:nowrap;min-width:0">
          ${store.brand.logoSvg ? `<img class="mark" src="${escapeHtml(store.brand.logoSvg)}" alt="">` : `<span class="mark letter">${escapeHtml((store.name[0] ?? '?').toUpperCase())}</span>`}
          <div><h2>${escapeHtml(store.name)}</h2>
            <div class="muted" style="font-size:11.5px">${escapeHtml(store.brand.slogan ?? store.prompt.slice(0, 60))}</div></div>
        </div>
        <span class="tag ${state}">${escapeHtml(store.status)}</span>
      </div>
      <a class="addr muted" href="${escapeHtml(visit)}" target="_blank" rel="noopener">${escapeHtml(visit.replace(/^https?:\/\//, ''))} ↗</a>
      <div class="nums">
        <div><b>${products}</b><span class="muted">products</span></div>
        <div><b>${sales.orders}</b><span class="muted">orders&nbsp;/&nbsp;30d</span></div>
        <div><b>${escapeHtml(format(sales.revenueCents, store.currency))}</b><span class="muted">sales&nbsp;/&nbsp;30d</span></div>
      </div>
      <div class="muted" style="font-size:11.5px">${
        store.status === 'paused'
          ? `Paused — visitors see a closed sign at ${escapeHtml(address.replace(/^https?:\/\//, ''))}`
          : open
            ? `Open since ${escapeHtml((published ?? store.createdAt).slice(0, 10))} at ${escapeHtml(address.replace(/^https?:\/\//, ''))}`
            : 'Not published, so the public address is closed — this link is the draft'
      }</div>
      <div class="row actions">
        <a class="btn primary" href="/admin/switch?storeId=${escapeHtml(store.id)}">Open</a>
        <a class="btn" href="/admin/switch?storeId=${escapeHtml(store.id)}&amp;to=${encodeURIComponent('/admin/build')}">Build</a>
        <a class="btn" href="${escapeHtml(visit)}" target="_blank" rel="noopener">${open ? 'Storefront ↗' : 'Draft ↗'}</a>
      </div>
      ${store.status === 'draft'
        ? ''
        : `<form method="post" action="/admin/stores/${escapeHtml(store.id)}/status" style="margin:0">
            <input type="hidden" name="status" value="${open ? 'paused' : 'live'}">
            <button class="btn" type="submit" style="width:100%">${open ? 'Pause the shop' : 'Reopen the shop'}</button>
          </form>`}
    </div>`
    })
    .join('')}</div>`
}
