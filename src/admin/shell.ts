import { brandHead, brandIcon, brandLogo, brandStyles } from '../brand/index.ts'
import { readFileSync } from 'node:fs'
import { escapeHtml } from '../lib/http.ts'
import type { Store } from '../control/stores.ts'
import type { Todo } from '../control/todos.ts'
import type { ChatMessage } from '../agent/chat.ts'
import { SUGGESTIONS } from '../agent/chat.ts'
import type { Artifact } from '../agent/registry.ts'
import type { AssistantRequest } from '../agent/queue.ts'

export type IconName = 'home' | 'assets' | 'sparkles' | 'orders' | 'products' | 'customers' | 'store' | 'pages' | 'image' | 'collections' | 'funnel' | 'bundle' | 'marketing' | 'discount' | 'ads' | 'analytics' | 'experiment' | 'profit' | 'build' | 'research' | 'creative' | 'settings' | 'mic' | 'send' | 'menu' | 'chevron'
export type NavItem = { key: string; href: string; label: string; icon: IconName; area?: string }

export function uiIcon(name: IconName, size = 18): string {
  const paths: Record<IconName, string> = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5M9 21v-7h6v7"/>',
    assets: '<rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><path d="M17 13v8M13 17h8"/>',
    sparkles: '<path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/>',
    orders: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
    products: '<path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z"/><path d="m4 7.5 8 4.5 8-4.5M12 12v9"/>',
    customers: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    store: '<path d="M3 9 5 3h14l2 6"/><path d="M5 13v8h14v-8M9 21v-6h6v6"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
    pages: '<path d="M6 2h9l5 5v15H6V2Z"/><path d="M14 2v6h6M9 13h8M9 17h6"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 2-2 5 5"/>',
    collections: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    funnel: '<path d="M3 4h18l-7 8v6l-4 2v-8L3 4Z"/>',
    bundle: '<rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M7.5 8C5 8 4 6.8 4 5.3S5.2 3 6.6 3C9 3 12 8 12 8m4.5 0C19 8 20 6.8 20 5.3S18.8 3 17.4 3C15 3 12 8 12 8"/>',
    marketing: '<path d="m3 11 18-5v12L3 13v-2Z"/><path d="M7 14v5a2 2 0 0 0 2 2h2v-6"/>',
    discount: '<path d="M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8V4h9.8L20 10.2a2 2 0 0 1 0 2.8Z"/><circle cx="9" cy="9" r="1"/>',
    ads: '<path d="M3 11v2h4l9 5V6L7 11H3Z"/><path d="M7 13v6h4"/><path d="M20 9v6"/>',
    analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>',
    experiment: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/><path d="M8 15h8"/>',
    profit: '<circle cx="12" cy="12" r="9"/><path d="M16 8h-6a2 2 0 0 0 0 4h4a2 2 0 0 1 0 4H8M12 6v12"/>',
    build: '<path d="m14.7 6.3 3-3a2.1 2.1 0 0 1 3 3l-3 3M13 8l3 3-8.5 8.5a2.1 2.1 0 0 1-3-3L13 8Z"/><path d="m4 4 4 4"/>',
    research: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    creative: '<path d="M12 3a9 9 0 1 0 9 9c0-1.1-.9-2-2-2h-2.2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2Z"/><circle cx="7.5" cy="10.5" r="1"/><circle cx="10" cy="7" r="1"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/>',
    mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
  }
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`
}

export const NAV: NavItem[] = [
  { key: 'dashboard', href: '/admin', label: 'Home', icon: 'home' },
  { key: 'stores', href: '/admin/stores', label: 'All assets', icon: 'assets' },
  { key: 'ai', href: '/admin/ai', label: 'Assistant', icon: 'sparkles' },
  { key: 'orders', href: '/admin/orders', label: 'Orders', icon: 'orders', area: 'orders' },
  { key: 'products', href: '/admin/products', label: 'Products', icon: 'products', area: 'products' },
  { key: 'customers', href: '/admin/customers', label: 'Customers', icon: 'customers', area: 'customers' },
]

function groupsFor(kind: Store['kind']): Array<{ label: string; icon: IconName; children: NavItem[] }> {
  const first = kind === 'funnel'
    ? { label: 'Funnel', icon: 'funnel' as const, children: [
        { key: 'funnels', href: '/admin/funnels', label: 'Funnel flow', icon: 'funnel' as const, area: 'store' },
        { key: 'pages', href: '/admin/pages', label: 'Funnel pages', icon: 'pages' as const, area: 'store' },
        { key: 'templates', href: '/admin/templates', label: 'Template library', icon: 'pages' as const, area: 'store' },
        { key: 'bundles', href: '/admin/bundles', label: 'Offers & bundles', icon: 'bundle' as const, area: 'promotions' },
        { key: 'media', href: '/admin/media', label: 'Media', icon: 'image' as const, area: 'store' },
      ] }
    : { label: 'Online store', icon: 'store' as const, children: [
        { key: 'store', href: '/admin/store', label: 'Theme & navigation', icon: 'store' as const, area: 'store' },
        { key: 'pages', href: '/admin/pages', label: 'Store pages', icon: 'pages' as const, area: 'store' },
        { key: 'templates', href: '/admin/templates', label: 'Template library', icon: 'pages' as const, area: 'store' },
        { key: 'collections', href: '/admin/collections', label: 'Collections', icon: 'collections' as const, area: 'organization' },
        { key: 'media', href: '/admin/media', label: 'Media', icon: 'image' as const, area: 'store' },
        { key: 'bundles', href: '/admin/bundles', label: 'Bundles', icon: 'bundle' as const, area: 'promotions' },
      ] }
  return [first,
  { label: 'Marketing', icon: 'marketing', children: [
    { key: 'marketing', href: '/admin/marketing', label: 'Campaigns & flows', icon: 'marketing', area: 'emails' },
    { key: 'promotions', href: '/admin/promotions', label: 'Discounts', icon: 'discount', area: 'promotions' },
    { key: 'ads', href: '/admin/ads', label: 'Ads', icon: 'ads', area: 'ads' },
  ] },
  { label: 'Insights', icon: 'analytics', children: [
    { key: 'analytics', href: '/admin/analytics', label: 'Analytics & attribution', icon: 'analytics', area: 'analytics' },
    { key: 'cro', href: '/admin/cro', label: 'Experiments', icon: 'experiment', area: 'analytics' },
    { key: 'profit', href: '/admin/profit', label: 'Profit', icon: 'profit', area: 'analytics' },
  ] },
  { label: 'Create', icon: 'build', children: [
    { key: 'build', href: '/admin/build', label: kind === 'funnel' ? 'Build funnel' : 'Build store', icon: 'build', area: 'store' },
    { key: 'research', href: '/admin/research', label: 'Research & avatars', icon: 'research', area: 'products' },
    { key: 'market', href: '/admin/market', label: 'Market strategy', icon: 'analytics', area: 'products' },
    { key: 'creative', href: '/admin/creative', label: 'Creative', icon: 'creative', area: 'products' },
  ] },
  ]
}

export type ShellInput = {
  store: Store
  stores: Store[]
  active: string
  title: string
  body: string
  todos: Todo[]
  messages: ChatMessage[]
  queue: AssistantRequest[]
  publish: { label: string; ready: boolean; reason: string }
  userName: string
  storeUrl: string
  /** Which model answers the panel, for the header line. */
  modelLabel?: string
}

/**
 * The admin shell.
 *
 * Three columns, exactly as the product is drawn: a 44px icon rail, the page,
 * and a 300px assistant panel that persists across every page. The panel is
 * part of the frame rather than a page component because the conversation has
 * to survive navigation — one thread across the whole admin, with the current
 * page passed along as context on every message.
 */
export function shell(input: ShellInput): string {
  const brand = input.store.brand
  const storefrontUrl = input.store.status === 'live' ? input.storeUrl : `/preview/${input.store.slug}`
  const storefrontAction = input.store.status === 'live' ? `View ${input.store.kind}` : `Preview ${input.store.kind}`
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(input.title)} — ${escapeHtml(input.store.name)} on storemill</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Playfair+Display:wght@400;500&display=swap">
${brandHead}<style>${brandStyles}${css(brand.primary ?? '#7a4a2b')}</style>
</head><body>
<div class="top">
  <button class="nav-toggle" id="nav-toggle" type="button" aria-label="Open navigation" aria-expanded="false" aria-controls="admin-navigation">${uiIcon('menu')}</button>
  <a class="logo storemill-home" href="/admin" aria-label="storemill home">${brandLogo(true)}<span class="storemill-mobile-mark">${brandIcon(true)}</span></a>
  <form method="get" action="/admin/switch" class="switcher">
    <select name="storeId" onchange="this.form.submit()" aria-label="Asset">
      ${input.stores.map((store) => `<option value="${escapeHtml(store.id)}" ${store.id === input.store.id ? 'selected' : ''}>${escapeHtml(store.name)} · ${store.kind}</option>`).join('')}
    </select>
  </form>
  <a class="chip" href="/admin/stores">All assets (${input.stores.length})</a>
  <a class="chip" href="/admin/stores?new=1#new">+ New asset</a>
  <div class="spacer"></div>
  <a class="chip" href="${escapeHtml(storefrontUrl)}" target="_blank" rel="noopener">${escapeHtml(storefrontAction)} ↗</a>
  <form method="post" action="/admin/publish">
    <button class="publish" type="submit" ${input.publish.ready ? '' : 'disabled'} title="${escapeHtml(input.publish.reason)}">${escapeHtml(input.publish.label)}</button>
  </form>
</div>
<div class="frame">
  <nav class="rail" id="admin-navigation" aria-label="Sections">
    <div class="nav-main">${NAV.map((item) => navLink(item, input.active)).join('')}</div>
    ${groupsFor(input.store.kind).map((group, index) => {
      const active = group.children.some((item) => item.key === input.active)
      return `<details class="nav-tree ${active ? 'active' : ''}" ${active || index < 2 ? 'open' : ''}><summary>${uiIcon(group.icon)}<b>${escapeHtml(group.label)}</b>${uiIcon('chevron', 14)}</summary><div>${group.children.map((item) => navLink(item, input.active, true)).join('')}</div></details>`
    }).join('')}
    <div class="rail-foot"><a href="/admin/settings" class="${input.active === 'settings' ? 'on' : ''}">${uiIcon('settings')}<b>Settings</b></a><a class="avatar" href="/admin/settings#profile" aria-label="Profile settings">${escapeHtml(input.userName.slice(0, 1).toUpperCase())}</a></div>
  </nav>
  <main class="page">${input.body}</main>

</div>
<script>
function askThis(prompt){ var box = document.getElementById('ask'); box.value = prompt; box.focus(); }
(function(){
  var navToggle=document.getElementById('nav-toggle');navToggle&&navToggle.addEventListener('click',function(){document.body.classList.toggle('nav-open')});
  // Activity dots: the rail lights up the area a tool is touching, live.
  try {
    var stream = new EventSource('/admin/activity');
    stream.addEventListener('activity', function(event){
      var data = JSON.parse(event.data);
      if (!data.area) return;
      var link = document.querySelector('.rail a[data-area="' + data.area + '"]');
      if (!link) return;
      link.classList.remove('running','done','failed');
      link.classList.add(data.status || 'running');
      if (data.status !== 'running') setTimeout(function(){ link.classList.remove('done','failed') }, 6000);
    });
  } catch (error) { /* activity dots are decoration; never break the admin */ }
})();
</script>
<script>${readFileSync(new URL('./usability.js', import.meta.url), 'utf8')}</script>
${assistantWidget(input)}
</body></html>`
}

function navLink(item: NavItem, active: string, child = false): string {
  return `<a href="${item.href}" class="${item.key === active ? 'on' : ''}${child ? ' child' : ''}" title="${escapeHtml(item.label)}" data-area="${item.area ?? ''}">${uiIcon(item.icon)}<b>${escapeHtml(item.label)}</b><i class="dot"></i></a>`
}

export function bubble(message: ChatMessage): string {
  return `<div class="msg ${message.role}">
    <div class="who">${message.role === 'user' ? 'You' : 'Assistant'}${message.page ? ` · ${escapeHtml(message.page.split('|')[0] || 'Current page')}` : ''}</div>
    <div class="text">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>
    ${message.artifacts.map(renderArtifact).join('')}
  </div>`
}

export function renderArtifact(artifact: Artifact): string {
  switch (artifact.type) {
    case 'product':
      return `<a class="art product" href="/admin/products/${escapeHtml(artifact.id)}">
        ${artifact.image ? `<img src="${escapeHtml(artifact.image)}" alt="">` : ''}<span>${escapeHtml(artifact.title)}</span></a>`
    case 'image':
      return `<div class="art sheet">${artifact.urls.map((url) => `<img src="${escapeHtml(url)}" alt="${escapeHtml(artifact.caption)}">`).join('')}</div>`
    case 'link':
      return `<a class="art link" href="${escapeHtml(artifact.href)}">${escapeHtml(artifact.label)} →</a>`
    case 'table':
      return `<div class="art tablewrap"><table><thead><tr>${artifact.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join('')}</tr></thead>
        <tbody>${artifact.rows.slice(0, 12).map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>
        ${artifact.caption ? `<div class="cap">${escapeHtml(artifact.caption)}</div>` : ''}</div>`
    case 'note':
      return `<pre class="art note">${escapeHtml(artifact.text)}</pre>`
    default:
      return ''
  }
}

function css(accent: string): string {
  return `
:root{--paper:#f6f6f4;--card:#fff;--ink:#1f2520;--muted:#6d746e;--line:#e0e3df;--accent:${accent};--ok:#2c6ecb;--warn:#a76b12;--bad:#b3261e;--rail:188px;--panel:320px}
*{box-sizing:border-box}
#clone-asset-form [hidden]{display:none!important}
body{margin:0;background:var(--paper);color:var(--ink);font:14px/1.55 'Inter',ui-sans-serif,system-ui,sans-serif}
a{color:inherit}
h1,h2,h3{margin:0;font-weight:500}
.serif{font-family:'Playfair Display',Georgia,serif;font-weight:400}
.muted{color:var(--muted)}
.eyebrow{font:500 10px/1 'Inter';letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.top{position:sticky;top:0;z-index:50;height:52px;display:flex;align-items:center;gap:.65rem;padding:0 .85rem;
  background:#303030;color:#fff;border-bottom:1px solid #464646;box-shadow:0 2px 12px #0000001f}
.top .logo{font-size:14px;letter-spacing:.02em}
.top .spacer{flex:1}
.switcher select{border:1px solid #555;border-radius:8px;padding:.35rem .55rem;background:#3d3d3d;color:#fff;font:inherit;font-size:12px;max-width:180px}
.chip{border:1px solid #555;background:#3d3d3d;color:#fff;border-radius:8px;padding:.4rem .75rem;font:500 12px/1 'Inter';
  cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:.35rem}
.chip:hover{border-color:#6a6a6a;background:#494949}
.publish{background:#fff;color:#303030;border:0;border-radius:8px;padding:.55rem 1rem;font:600 12px/1 'Inter',ui-sans-serif,system-ui,sans-serif;cursor:pointer}
.publish:disabled{background:var(--line);color:var(--muted);cursor:not-allowed}
.frame{display:grid;grid-template-columns:var(--rail) minmax(0,1fr) var(--panel);min-height:calc(100vh - 52px)}
.rail{background:#eef0ed;border-right:1px solid var(--line);display:flex;flex-direction:column;padding:.65rem .55rem;gap:.12rem;position:sticky;top:52px;height:calc(100vh - 52px);overflow-y:auto}
.rail a{position:relative;width:100%;min-height:32px;display:flex;align-items:center;gap:.65rem;border-radius:8px;padding:.3rem .55rem;text-decoration:none;color:#555e56;font-size:14px}
.rail a span{width:20px;text-align:center;font-size:15px;flex:0 0 auto}.rail a b{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rail a:hover{background:#e2e6e1;color:var(--ink)}
.rail a.on{background:#e5eefb;color:#163b6d;box-shadow:inset 3px 0 #2c6ecb}
.rail .dot{position:absolute;top:3px;right:3px;width:6px;height:6px;border-radius:999px;background:transparent}
.rail a.running .dot{background:var(--warn);animation:pulse 1s infinite}
.rail a.done .dot{background:var(--ok)}
.rail a.failed .dot{background:var(--bad)}
@keyframes pulse{50%{opacity:.35}}
.rail-foot{margin-top:auto;padding:.4rem .45rem}
.avatar{display:grid;place-items:center;width:26px;height:26px;border-radius:999px;background:var(--accent);color:#fff;font-size:11px;font-weight:600}
.page{padding:1.65rem 1.8rem 4rem;min-width:0;max-width:1480px;width:100%;margin:0 auto}
.panel{border-left:1px solid var(--line);background:#fff;display:flex;flex-direction:column;position:sticky;top:52px;height:calc(100vh - 52px)}
.panel header{padding:1rem 1rem .6rem;border-bottom:1px solid var(--line)}
.panel-title{font-size:13px;font-weight:600;display:flex;align-items:center;gap:.4rem}
.beta{font:500 9px/1 'Inter';letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--line);border-radius:999px;padding:.2rem .4rem;color:var(--muted)}
.panel header p{margin:.35rem 0 0;font-size:11.5px}
.thread{flex:1;overflow-y:auto;padding:.9rem;display:flex;flex-direction:column;gap:.9rem}
.msg .who{font:500 10px/1 'Inter';letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem}
.msg .text{font-size:13px;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:.6rem .7rem;white-space:normal}
.msg.user .text{background:var(--ink);color:#fff;border-color:var(--ink)}
.empty{margin:auto;text-align:center;padding:1rem;font-size:12.5px}
.suggestions{display:grid;gap:.3rem;padding:0 .9rem .6rem}
.suggestions button{text-align:left;border:1px solid var(--line);background:#fff;border-radius:8px;padding:.5rem .6rem;font:inherit;font-size:12.5px;cursor:pointer;display:flex;gap:.5rem}
.suggestions button:hover{border-color:var(--ink)}
.composer{border-top:1px solid var(--line);padding:.7rem}
.composer textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:.6rem;font:inherit;font-size:13px;resize:vertical}
.composer-row{display:flex;align-items:center;gap:.5rem;margin-top:.45rem}
.confirm{font-size:11px;color:var(--muted);display:flex;gap:.3rem;align-items:center;flex:1}
.send{margin-left:auto;border:0;background:var(--ink);color:#fff;border-radius:8px;width:34px;height:30px;cursor:pointer}
.next{border-top:1px solid var(--line);padding:.7rem .9rem 1rem;max-height:32vh;overflow:auto}
.todo{display:flex;gap:.5rem;align-items:flex-start;text-decoration:none;font-size:12px;padding:.3rem 0;color:var(--muted)}
.todo i{width:7px;height:7px;border-radius:999px;background:var(--line);margin-top:.42rem;flex:0 0 auto}
.todo.done{color:var(--muted);text-decoration:line-through}
.todo.done i{background:var(--ok)}
.todo.in_progress i{background:var(--warn)}
.todo:hover{color:var(--ink)}
.art{display:block;margin-top:.5rem;font-size:12px}
.art.product{display:flex;gap:.5rem;align-items:center;border:1px solid var(--line);border-radius:10px;padding:.4rem;text-decoration:none}
.art.product img{width:38px;height:38px;object-fit:cover;border-radius:6px}
.art.sheet{display:grid;grid-template-columns:repeat(4,1fr);gap:.25rem}
.art.sheet img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:6px;border:1px solid var(--line)}
.art.link{color:var(--accent);text-decoration:none}
.art.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:10px}
.art table{border-collapse:collapse;width:100%;font-size:11.5px}
.art th{text-align:left;font-weight:500;color:var(--muted);padding:.4rem .5rem;border-bottom:1px solid var(--line)}
.art td{padding:.35rem .5rem;border-bottom:1px solid var(--line)}
.art .cap{padding:.35rem .5rem;color:var(--muted);font-size:11px}
.art.note{white-space:pre-wrap;background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:.6rem;font:12px/1.5 ui-monospace,monospace;overflow-x:auto}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:1rem;flex-wrap:wrap;margin-bottom:1.2rem}
.head h1{font-family:'Playfair Display',Georgia,serif;font-size:1.7rem}
.kpis{display:grid;grid-template-columns:repeat(5,1fr);border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden;margin-bottom:1.2rem}
.kpi{padding:.9rem 1rem;border-right:1px solid var(--line)}
.kpi:last-child{border-right:0}
.kpi .label{font-size:11px;color:var(--muted)}
.kpi .value{font-size:1.35rem;font-variant-numeric:tabular-nums;margin-top:.15rem}
.kpi .delta{font-size:11px;color:var(--ok)}
.kpi .delta.neg{color:var(--bad)}
.card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin-bottom:1rem;box-shadow:0 1px 2px #14201808}
.card > h2{font-size:1rem;margin-bottom:.15rem}
.grid2{display:grid;gap:1rem;grid-template-columns:1.6fr 1fr;align-items:start}
.grid3{display:grid;gap:1rem;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
.card,.grid2>*{min-width:0}
.data-scroll{max-width:100%;overflow-x:auto;border-radius:inherit;overscroll-behavior-x:contain}
.data-scroll-hint{font-size:11px;color:var(--muted);margin:0;padding:.5rem .6rem;border-top:1px solid var(--line)}
.data-scroll:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.field,input,select,textarea{min-width:0;max-width:100%}
table.data{width:100%;border-collapse:collapse;font-size:13px}
table.data th{text-align:left;font-weight:500;color:var(--muted);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
table.data td{padding:.6rem;border-bottom:1px solid var(--line);vertical-align:middle}
table.data tr:last-child td{border-bottom:0}
table.data img{width:36px;height:36px;object-fit:cover;border-radius:6px}
.tag{display:inline-flex;align-items:center;gap:.3rem;font-size:11px;border:1px solid var(--line);border-radius:999px;padding:.15rem .5rem;color:var(--muted)}
.tag.ok{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--line))}
.tag.warn{color:var(--warn)}
.tag.bad{color:var(--bad)}
.tabs{display:flex;gap:.4rem;margin-bottom:.9rem;flex-wrap:wrap}
.tabs a{font-size:12px;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:.3rem .75rem;background:#fff}
.tabs a.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.btn{display:inline-flex;align-items:center;gap:.4rem;border:1px solid var(--line);background:#fff;border-radius:8px;
  padding:.5rem .85rem;font:500 12.5px/1 'Inter',ui-sans-serif,system-ui,sans-serif;cursor:pointer;text-decoration:none}
.btn:hover{border-color:var(--ink)}
.btn.primary{background:var(--ink);color:#fff;border-color:var(--ink)}
.field{display:flex;flex-direction:column;gap:.25rem;margin-bottom:.7rem}
.field label{font-size:11px;color:var(--muted)}
input,select,textarea{font:inherit;font-size:13px;padding:.5rem .6rem;border:1px solid var(--line);border-radius:8px;background:#fff;color:inherit;width:100%}
input[type=checkbox],input[type=radio]{width:auto;padding:0}
.row{display:flex;gap:.6rem;align-items:center;flex-wrap:wrap}
.preview{border:1px solid var(--line);border-radius:12px;overflow:hidden;background:#fff}
.preview .chrome{display:flex;gap:.35rem;align-items:center;padding:.5rem .7rem;border-bottom:1px solid var(--line);background:var(--paper)}
.preview .chrome i{width:9px;height:9px;border-radius:999px;background:var(--line);display:inline-block}
.preview .url{font-size:11px;color:var(--muted);margin-left:.5rem}
.preview iframe{width:100%;height:620px;border:0;display:block;background:#fff}
.bars{display:grid;gap:.4rem}
.barrow{display:grid;grid-template-columns:9rem 1fr 5rem;gap:.6rem;align-items:center;font-size:12px}
.barrow .track{height:8px;background:var(--line);border-radius:999px;overflow:hidden}
.barrow .fill{height:100%;background:var(--accent)}
.spark{display:flex;align-items:flex-end;gap:2px;height:44px}
.spark i{flex:1;background:var(--accent);opacity:.75;border-radius:1px;min-height:2px}
.notice{border:1px solid var(--line);border-left:3px solid var(--accent);border-radius:8px;padding:.7rem .9rem;background:#fff;font-size:12.5px}
.flash{border-left-color:var(--ok)}
.flash.bad{border-left-color:var(--bad)}
.dash-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:1.15rem}.dash-head h1{font:600 1.35rem/1.25 'Inter';letter-spacing:-.02em}.dash-head p{margin:.25rem 0 0}.dash-actions{display:flex;align-items:center;gap:.5rem}.store-state{display:inline-flex;align-items:center;gap:.4rem;font-size:11px;color:var(--muted)}.store-state i{width:7px;height:7px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 4px color-mix(in srgb,var(--ok) 12%,transparent)}
.commerce-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:.75rem;margin-bottom:.85rem}.metric-card{background:#fff;border:1px solid var(--line);border-radius:12px;padding:.85rem 1rem;box-shadow:0 1px 2px #14201808}.metric-card .label{font-size:11.5px;color:var(--muted);display:flex;justify-content:space-between;gap:.4rem}.metric-card .value{font-size:1.42rem;font-weight:600;letter-spacing:-.035em;margin-top:.2rem;font-variant-numeric:tabular-nums}.metric-card .delta{font-size:11px;color:var(--ok);margin-top:.15rem}.metric-card .delta.neg{color:var(--bad)}
.dashboard-grid{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(250px,.75fr);gap:.85rem;align-items:start}.dash-card{margin:0}.dash-card-head{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.dash-card-head h2{font-size:.95rem;font-weight:600}.dash-total{font-size:1.7rem;font-weight:600;letter-spacing:-.04em;margin-top:.45rem}.sales-chart{width:100%;height:190px;display:block;margin-top:.6rem;overflow:visible}.sales-chart .gridline{stroke:#e5e7eb;stroke-width:1}.sales-chart .area{fill:url(#sales-fill)}.sales-chart .line{fill:none;stroke:var(--ok);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}.chart-labels{display:flex;justify-content:space-between;color:var(--muted);font-size:10.5px;margin-top:-.15rem}
.pulse-card{background:linear-gradient(145deg,#163a6b,#255fa8);color:#fff;border:0;box-shadow:0 10px 28px #163a6b26}.pulse-card .muted{color:#d5e4f7}.pulse-number{font-size:2.35rem;font-weight:600;letter-spacing:-.06em;line-height:1}.pulse-list{display:grid;gap:.55rem;margin-top:1rem}.pulse-list a{display:flex;justify-content:space-between;gap:.5rem;text-decoration:none;background:#ffffff12;border:1px solid #ffffff1f;border-radius:9px;padding:.65rem .7rem;font-size:12px}.pulse-list a:hover{background:#ffffff1e}.dash-row{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(260px,.75fr);gap:.85rem;margin-top:.85rem}.funnel-compact{display:grid;gap:.65rem;margin-top:.9rem}.funnel-line{display:grid;grid-template-columns:90px 1fr 55px;align-items:center;gap:.7rem;font-size:11.5px}.funnel-line .track{height:8px;border-radius:999px;background:#eceef1;overflow:hidden}.funnel-line .track i{display:block;height:100%;background:linear-gradient(90deg,#2c6ecb,#73a6e6);border-radius:inherit}.order-list{margin-top:.55rem}.order-item{display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:.65rem;align-items:center;padding:.6rem 0;border-top:1px solid var(--line);text-decoration:none}.order-badge{width:38px;height:38px;border-radius:9px;background:#eaf2ff;color:#1f5eaa;display:grid;place-items:center;font-size:11px;font-weight:600}.order-item strong{font-size:12.5px}.order-item small{display:block;color:var(--muted);font-size:10.5px}.dash-empty{color:var(--muted);font-size:12px;padding:.7rem 0}.preview-mini iframe{height:330px}.quick-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:.55rem;margin-top:.75rem}.quick-grid a{display:flex;gap:.55rem;align-items:center;text-decoration:none;border:1px solid var(--line);border-radius:9px;padding:.7rem;font-size:12px}.quick-grid a:hover{border-color:#aeb4bb;background:#fafafa}
.cro-empty{text-align:center;padding:2.5rem 1.5rem}.cro-orb{display:grid;place-items:center;width:54px;height:54px;border-radius:18px;margin:0 auto .8rem;background:#eaf2ff;color:var(--ok);font-size:1.7rem}.cro-launch{border-top:3px solid var(--ok)}.cro-check{align-items:flex-start!important;border:1px solid var(--line);padding:.7rem;border-radius:9px;margin-bottom:.8rem}.cro-check small,.cro-rule small{display:block;color:var(--muted);font-size:10.5px;margin-top:.1rem}.cro-rule{display:flex;gap:.7rem;border-top:1px solid var(--line);padding:.7rem 0}.cro-rule b:first-child{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;background:#eaf2ff;color:var(--ok);font-size:11px;flex:0 0 auto}.cro-card{padding:1.1rem}.cro-actions{display:flex;gap:.35rem;flex-wrap:wrap;justify-content:flex-end}.cro-variants{display:grid;gap:.55rem;margin-top:1rem}.cro-variant{border:1px solid var(--line);border-radius:10px;padding:.7rem;font-size:11.5px}.cro-variant.leader{border-color:#8fb6e8;background:#f7faff}.cro-variant a{display:inline-block;margin-top:.45rem;color:var(--ok);text-decoration:none}.prob{height:5px;background:#eceef1;border-radius:99px;overflow:hidden;margin:.45rem 0}.prob i{display:block;height:100%;background:var(--ok);border-radius:inherit}.cro-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:.5rem;color:var(--muted)}.cro-metrics b{color:var(--ink)}.cro-metrics .up b{color:var(--ok)}.cro-metrics .down b{color:var(--bad)}.cro-foot{display:flex;justify-content:space-between;gap:.7rem;border-top:1px solid var(--line);padding-top:.7rem;margin-top:.8rem;font-size:11px;color:var(--muted)}.tag.live{color:var(--ok);border-color:#a7c5ea;background:#f1f6fd}
@media (max-width:1380px){:root{--rail:164px;--panel:300px}.page{padding:1.4rem}.commerce-kpis{grid-template-columns:repeat(3,1fr)}}
@media (max-width:1120px){.frame{grid-template-columns:var(--rail) minmax(0,1fr)}.panel{display:none}.kpis{grid-template-columns:repeat(2,1fr)}.grid2{grid-template-columns:1fr}}
@media (max-width:820px){:root{--rail:48px}.rail{padding:.55rem .35rem}.rail a{justify-content:center;padding:.3rem}.rail a b{display:none}.rail a.on{box-shadow:none}.page{padding:1rem}.top .chip:not(:last-of-type){display:none}.commerce-kpis{grid-template-columns:repeat(2,1fr)}.dashboard-grid,.dash-row{grid-template-columns:1fr}.cro-metrics{grid-template-columns:repeat(2,1fr)}}
@media (max-width:600px){.top{gap:.4rem;padding:0 .55rem}.top .logo strong{display:none}.dash-head{align-items:flex-start;flex-direction:column}.dash-actions{display:grid;grid-template-columns:1fr 1fr auto;width:100%}.dash-actions .btn{justify-content:center}.commerce-kpis{gap:.65rem}.metric-card{padding:.75rem .8rem}.metric-card .value{font-size:1.3rem}}
/* Shopify-like operator frame: conventional icons, grouped trees and a quiet
   neutral canvas. These rules intentionally sit last so the shell remains
   compatible with older page components while the frame is fully replaced. */
:root{--paper:#f1f1f1;--card:#fff;--ink:#202223;--muted:#6d7175;--line:#dfe3e8;--accent:#2c6ecb;--ok:#2c6ecb;--rail:240px;--panel:330px}
body{font-size:13px}.icon{display:block;flex:0 0 auto}.serif,.head h1{font-family:'Inter',ui-sans-serif,system-ui,sans-serif;font-weight:600;letter-spacing:-.025em}.head h1{font-size:1.55rem}
.top{height:56px;background:#303030;border-bottom-color:#464646;padding:0 1rem;gap:.55rem;box-shadow:0 1px 4px #0003}.top .logo{display:flex;align-items:center;gap:.5rem;min-width:128px}.logo-mark{width:28px;height:28px;border-radius:7px;background:#5b8fd9;color:#fff;display:grid;place-items:center}.switcher select,.chip{background:#3d3d3d;border-color:#555;border-radius:7px}.switcher select:hover,.chip:hover{background:#494949}.publish{border-radius:7px}.nav-toggle{display:none;border:0;background:transparent;color:#fff;padding:.4rem}
.frame{grid-template-columns:var(--rail) minmax(0,1fr);min-height:calc(100vh - 56px)}
.rail{top:56px;height:calc(100vh - 56px);background:#f6f6f7;border-right:1px solid #d9d9dc;padding:.7rem .65rem;gap:.25rem;box-shadow:none}
.nav-main{display:grid;gap:.12rem;border-bottom:1px solid #e2e2e4;padding-bottom:.5rem;margin-bottom:.15rem}.rail a{min-height:34px;border-radius:7px;padding:.4rem .55rem;gap:.7rem;color:#44474a}.rail a .icon{width:17px;height:17px;color:#5c5f62}.rail a b{font-size:12.5px;font-weight:500}.rail a:hover{background:#e9e9eb}.rail a.on{background:#e5eefb;color:#163b6d;box-shadow:inset 3px 0 #2c6ecb;font-weight:600}.rail a.on .icon{color:#2c6ecb}
.nav-tree{margin:.05rem 0}.nav-tree summary{list-style:none;display:flex;align-items:center;gap:.7rem;min-height:34px;padding:.4rem .55rem;border-radius:7px;cursor:pointer;color:#44474a}.nav-tree summary::-webkit-details-marker{display:none}.nav-tree summary:hover{background:#e9e9eb}.nav-tree summary b{font-size:12.5px;font-weight:550;flex:1}.nav-tree summary .icon{width:17px;height:17px}.nav-tree summary .icon:last-child{width:13px;height:13px;transition:transform .15s;color:#8c9196}.nav-tree[open] summary .icon:last-child{transform:rotate(90deg)}.nav-tree.active>summary{color:#202223;font-weight:600}.nav-tree>div{border-left:1px solid #cfd2d4;margin:.1rem 0 .25rem 1.05rem;padding-left:.5rem}.rail a.child{min-height:31px;padding-left:.55rem}.rail a.child .icon{width:15px;height:15px}
.rail-foot{display:flex;align-items:center;gap:.35rem;border-top:1px solid #e2e2e4;padding:.55rem 0 0;margin-top:auto}.rail-foot a{flex:1}.rail-foot a.avatar{flex:0 0 26px;margin-right:.4rem}.page{max-width:1260px;padding:1.65rem 2rem 4rem}.panel{display:none;top:56px;height:calc(100vh - 56px)}
.card,.metric-card{border-color:#e1e3e5;border-radius:12px;box-shadow:0 1px 3px #0000000a}.btn{border-color:#c9cccf;border-radius:7px;box-shadow:0 1px 0 #0000000d}.btn.primary{background:#2c6ecb;border-color:#2c6ecb}.btn.primary:hover{background:#1f5199}.pulse-card{background:linear-gradient(145deg,#173c70,#285f9f)}
.voice,.send{display:grid;place-items:center;border:0;border-radius:8px;width:34px;height:32px;cursor:pointer}.voice{background:#eef0f1;color:#4f5559}.voice.listening{color:#fff;background:#b3261e;animation:pulse 1s infinite}.voice:disabled{opacity:.35;cursor:not-allowed}.send{margin-left:0;background:#202223;color:#fff}.send:disabled{opacity:.5}
.assistant-queue{border-top:1px solid var(--line);padding:.65rem .8rem;max-height:150px;overflow:auto}.queue-item{display:flex;align-items:center;gap:.45rem;justify-content:space-between;padding:.4rem 0;border-top:1px solid #eef0f1}.queue-item:first-of-type{margin-top:.35rem}.queue-item span{min-width:0}.queue-item b{font-size:10px;text-transform:uppercase;color:var(--ok)}.queue-item small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--muted);max-width:230px}.queue-item button{border:0;background:none;color:var(--muted);cursor:pointer}.queue-spin{width:12px;height:12px;border:2px solid #d9ddda;border-top-color:var(--ok);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
.asset-tabs{display:flex;gap:.35rem;margin-bottom:.9rem}.asset-tabs button{border:1px solid var(--line);background:#fff;border-radius:8px;padding:.42rem .75rem;font:500 12px/1 'Inter';cursor:pointer}.asset-tabs button.on{background:var(--accent);color:#fff;border-color:var(--accent)}.asset-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(275px,1fr));gap:1rem}.asset-card{display:flex;flex-direction:column;min-width:0;background:#fff;border:1px solid var(--line);border-radius:13px;overflow:hidden;box-shadow:0 1px 3px #0000000a}.asset-card[hidden]{display:none}.asset-cover{height:180px;position:relative;display:grid;place-items:center;overflow:hidden;background:linear-gradient(145deg,#e7edf6,#f5f7fa);color:#3f6490}.asset-cover img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#f7f8fa;transition:transform .2s}.asset-cover img[hidden]{display:none}.asset-cover:focus-visible{outline:3px solid var(--accent);outline-offset:-3px}.asset-cover>span{width:58px;height:58px;display:grid;place-items:center;border-radius:16px;background:#fff9;box-shadow:0 8px 24px #2c6ecb15}.asset-cover em{position:absolute;left:.65rem;bottom:.6rem;background:#202223dd;color:#fff;border-radius:999px;padding:.23rem .55rem;font:600 9px/1 'Inter';text-transform:uppercase;letter-spacing:.12em}.asset-body{display:flex;flex-direction:column;gap:.7rem;padding:.9rem}.asset-body h2{font-size:14px;font-weight:600}.asset-body p{color:var(--muted);font-size:11px;line-height:1.35;margin:.15rem 0 0;min-height:2.7em}.asset-facts{display:flex;gap:.8rem;color:var(--muted);font-size:11px}.asset-metrics{display:grid;grid-template-columns:1fr 1fr;border:1px solid #e6e8e6;border-radius:9px;overflow:hidden}.asset-metrics>div{padding:.55rem .65rem}.asset-metrics>div+div{border-left:1px solid #e6e8e6}.asset-metrics small,.asset-metrics em{display:block;color:var(--muted);font:10px/1.3 'Inter';font-style:normal}.asset-metrics strong{display:block;font-size:14px;margin:.12rem 0;font-variant-numeric:tabular-nums}.asset-create{grid-template-columns:1.3fr 1fr}.media-upload{display:grid;grid-template-columns:1fr minmax(220px,320px) auto;align-items:center;gap:1rem}.media-upload p{font-size:11.5px;margin:.15rem 0 0}.media-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:.8rem}.media-card{margin:0;background:#fff;border:1px solid var(--line);border-radius:11px;overflow:hidden;min-width:0}.media-card>a{display:block;height:180px;background:linear-gradient(45deg,#f1f2f1 25%,#fafafa 25%,#fafafa 50%,#f1f2f1 50%,#f1f2f1 75%,#fafafa 75%);background-size:20px 20px}.media-card img{width:100%;height:100%;object-fit:contain;display:block}.media-card figcaption{display:flex;align-items:center;justify-content:space-between;gap:.5rem;padding:.65rem}.media-card figcaption>div{min-width:0}.media-card strong,.media-card span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.media-card strong{font-size:11.5px}.media-card span{font-size:10px;color:var(--muted);margin-top:.1rem}.media-card .btn{padding:.4rem .5rem;flex:0 0 auto}.funnel-path{display:grid;grid-template-columns:1fr auto 1fr auto 1fr auto 1fr auto 1fr;align-items:center;gap:.45rem;background:#fff;border:1px solid var(--line);border-radius:12px;padding:.8rem;margin-bottom:1rem}.funnel-path>div{border:1px solid #e4e7e4;border-radius:9px;padding:.65rem;min-width:0}.funnel-path span{display:grid;place-items:center;width:20px;height:20px;border-radius:6px;background:#eaf2ff;color:#1f5eaa;font-size:10px;font-weight:700;margin-bottom:.4rem}.funnel-path b,.funnel-path small{display:block}.funnel-path b{font-size:11.5px}.funnel-path small{font-size:9.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.funnel-path>i{font-style:normal;color:#8c9196}
.create-panel>summary{cursor:pointer;display:flex;justify-content:space-between;align-items:center;list-style:none}.create-panel>summary::-webkit-details-marker{display:none}.flow-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem;margin-bottom:1rem}.flow-card{margin:0}.flow-card>summary{display:grid;grid-template-columns:34px 1fr auto;align-items:center;gap:.7rem;cursor:pointer;list-style:none}.flow-card>summary::-webkit-details-marker{display:none}.flow-card summary small{display:block;color:var(--muted);font-size:11px}.flow-icon{width:32px;height:32px;border-radius:9px;background:#eaf2ff;color:#1f5eaa;display:grid;place-items:center;font-size:10px;font-weight:700}.section-title{display:flex;justify-content:space-between;align-items:flex-end;margin:.2rem 0 .7rem}.section-title h2{font-size:1rem}.section-title p{font-size:11.5px;margin:.15rem 0 0}.check{display:flex;align-items:center;gap:.35rem;font-size:12px;color:var(--muted)}
@media (min-width:1560px){.frame{grid-template-columns:var(--rail) minmax(0,1fr)}.panel{display:none}.page{padding-left:2.2rem;padding-right:2.2rem}}
@media (min-width:901px) and (max-width:1559px){:root{--rail:240px}.frame{grid-template-columns:var(--rail) minmax(0,1fr)}}
@media (max-width:900px){:root{--rail:240px}.nav-toggle{display:grid;place-items:center}.frame{display:block}.rail{position:fixed;z-index:60;left:-260px;top:56px;width:240px;transition:left .2s;box-shadow:10px 0 28px #0002}.nav-open .rail{left:0}.rail a{justify-content:flex-start}.rail a b{display:block}.page{padding:1rem}.flow-grid{grid-template-columns:1fr}.top .logo{min-width:0}.top .chip{display:none}.asset-create{grid-template-columns:1fr}.media-upload{grid-template-columns:1fr}.funnel-path{display:flex;overflow-x:auto;align-items:stretch}.funnel-path>div{min-width:145px}}
`
}

export function assistantWidget(input: {store:Pick<Store,'id'|'name'>;active:string;title:string;messages:ChatMessage[];queue:AssistantRequest[]}): string {
  const config=JSON.stringify({storeId:input.store.id,storeName:input.store.name,page:input.active,title:input.title,busy:input.queue.some(request=>request.status==='running'||request.status==='queued')}).replace(/</g,'\\u003c')
  return `<style>${brandStyles}${readFileSync(new URL('./assistant-widget.css',import.meta.url),'utf8')}</style>
  <button class="assistant-launcher" id="assistant-launcher" type="button" aria-label="Open business assistant" aria-controls="business-assistant" aria-expanded="false">${brandIcon(true)}<span class="assistant-badge" hidden></span></button>
  <section class="assistant-widget" id="business-assistant" role="dialog" aria-label="Business assistant" hidden>
    <header class="assistant-heading"><div><strong>${brandIcon()} Business assistant</strong><span>Here to help with your business</span></div><button type="button" id="assistant-close" aria-label="Minimize business assistant">${uiIcon('chevron')}</button></header>
    <div class="assistant-context">${uiIcon(input.active==='editor'?'pages':'store',15)}<span>${escapeHtml(input.store.name)} · ${escapeHtml(input.title)}</span></div>
    <div class="thread" id="thread" aria-live="polite">${assistantMessages(input.messages)}</div>
    <div id="assistant-request-status" role="status"></div>
    <form class="composer" method="post" action="/admin/ask" id="composer"><input type="hidden" name="storeId" value="${escapeHtml(input.store.id)}"><input type="hidden" name="page" value="${escapeHtml(input.active)}"><textarea name="text" id="ask" rows="3" placeholder="Ask a question, or tell me what to change…" aria-label="Message business assistant" required></textarea><div class="composer-row"><span>Uses this asset and page as context</span><button class="voice" id="voice" type="button" aria-label="Dictate request">${uiIcon('mic',17)}</button><button class="send" type="submit" aria-label="Send">${uiIcon('send',17)}</button></div></form>
    <a class="assistant-history" href="/admin/ai">Conversation history ↗</a>
  </section><script>window.__ASSISTANT=${config};${readFileSync(new URL('./assistant-widget.js',import.meta.url),'utf8')}</script>`
}
export function assistantMessages(messages:ChatMessage[]): string {
  return messages.length?messages.map(bubble).join(''):'<div class="assistant-welcome"><h2>What would you like to change?</h2><p>I can help with pages, products, design, orders, and the rest of your business.</p></div>'
}
