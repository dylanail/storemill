import { escapeHtml } from '../lib/http.ts'
import type { Db } from '../lib/db.ts'
import type { Store } from '../control/stores.ts'
import { listProducts } from '../domain/catalog.ts'
import { dnsPlan, domainsFor, REGISTRARS, edgeTarget } from '../control/domains.ts'
import { AD_FORMATS, getAd, limitWarnings, listAds, listInspiration, patternInspiration, PLATFORMS, searchAdLibrary, type Ad } from '../agent/ads.ts'
import { listAvatars } from '../agent/avatars.ts'
import { directionFrom, listCompetitors } from '../agent/angles.ts'
import { imageModels, PRESETS } from '../agent/images.ts'
import { readBrief } from '../agent/copy.ts'
import { latestResearch } from '../agent/research.ts'
import { catalog } from '../agent/models.ts'

/**
 * The growth pages: ads, domains, avatars, competitor angles, image re-shoots.
 *
 * Every generated thing on these pages is a form. That is the rule: the
 * platform drafts, the merchant decides, and a draft that cannot be edited in
 * place is a draft that gets pasted into a text file and lost.
 */
type Ctx = { db: Db; store: Store; userName: string; storeUrl: string; flash?: string }

function flash(ctx: Ctx): string {
  if (!ctx.flash) return ''
  const bad = ctx.flash.startsWith('!')
  return `<div class="notice ${bad ? 'bad' : 'ok'}">${escapeHtml(bad ? ctx.flash.slice(1) : ctx.flash)}</div>`
}

function lines(values: string[]): string {
  return escapeHtml(values.join('\n'))
}

function field(label: string, name: string, value: string, opts: { rows?: number; help?: string; type?: string } = {}): string {
  const control = opts.rows
    ? `<textarea name="${name}" rows="${opts.rows}">${escapeHtml(value)}</textarea>`
    : `<input name="${name}" type="${opts.type ?? 'text'}" value="${escapeHtml(value)}">`
  return `<div class="field"><label>${escapeHtml(label)}${opts.help ? ` <span class="muted">— ${escapeHtml(opts.help)}</span>` : ''}</label>${control}</div>`
}

function productOptions(ctx: Ctx, selected = ''): string {
  return listProducts(ctx.db, ctx.store.id, { limit: 200 })
    .map((product) => `<option value="${escapeHtml(product.id)}" ${product.id === selected ? 'selected' : ''}>${escapeHtml(product.title)}</option>`)
    .join('')
}

function textModelOptions(): string {
  return `<option value="">Store default</option>${catalog().map((entry) => `<option value="${entry.provider}:${escapeHtml(entry.model)}" ${entry.available ? '' : 'disabled'}>${escapeHtml(entry.name)}${entry.available ? '' : ' (no key)'}</option>`).join('')}`
}

export function avatarOptions(ctx: Ctx, selected = ''): string {
  const avatars = listAvatars(ctx.db, ctx.store.id)
  return `<option value="">First selected avatar</option><option value="none" ${selected === 'none' ? 'selected' : ''}>No avatar</option>${avatars
    .map((avatar) => `<option value="${escapeHtml(avatar.id)}" ${avatar.id === selected ? 'selected' : ''}>${escapeHtml(avatar.name)}${avatar.selected ? '' : ' (off)'}</option>`)
    .join('')}`
}

/* ----------------------------------------------------------------------- ads */

export async function adsPage(ctx: Ctx, query: { q?: string; country?: string }): Promise<string> {
  const ads = listAds(ctx.db, ctx.store.id)
  const products = listProducts(ctx.db, ctx.store.id, { limit: 200 })
  const first = products[0]
  const inspiration = listInspiration(ctx.db, ctx.store.id)
  const patterns = patternInspiration(first?.title ?? ctx.store.name, readBrief(ctx.store.prompt).category)
  const library = query.q ? await searchAdLibrary(query.q, { country: query.country }) : null
  const byProduct = new Map(products.map((product) => [product.id, product.title]))
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Ads</h1>
    <p class="muted" style="margin:.25rem 0 0">Drafted from the same research, avatar and direction as the pages, so the promise in the ad is the promise on the page. Every field is editable.</p></div></div>
  <div class="grid2"><div>
    <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Drafts</h2></div>
      ${ads.length ? `<table class="data"><thead><tr><th>Ad</th><th>Platform</th><th>Status</th><th>Hook</th></tr></thead><tbody>
      ${ads.map((ad) => `<tr><td><a href="/admin/ads/${escapeHtml(ad.id)}">${escapeHtml(ad.name)}</a><div class="muted" style="font-size:11px">${escapeHtml(byProduct.get(ad.productId) ?? '')} · ${escapeHtml(ad.format)}</div></td>
        <td>${escapeHtml(ad.platform)}</td><td><span class="tag ${ad.status === 'ready' ? 'ok' : ''}">${ad.status}</span></td><td class="muted" style="font-size:12px">${escapeHtml((ad.body.hooks[0] ?? ad.body.headline).slice(0, 90))}</td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="padding:0 1.1rem 1rem;font-size:12px">Nothing drafted yet. Use the form on the right.</p>'}</div>
    <div class="card" id="inspiration"><h2>Swipe file</h2>
      <p class="muted" style="font-size:12px;margin:.3rem 0 .8rem">Ads worth learning from. Drafts read the hooks and angles here. Search the Meta Ad Library (token needed), read a competitor link, or paste an ad.</p>
      <form method="get" action="/admin/ads" class="row" style="margin-bottom:.6rem"><input aria-label="Search the Ad Library" name="q" value="${escapeHtml(query.q ?? '')}" placeholder="Search the Ad Library: e.g. leather boxing gloves" style="flex:2"><input name="country" value="${escapeHtml(query.country ?? 'GB')}" style="width:56px" title="Reach country; EU/UK return commercial ads"><button class="btn">Search</button></form>
      ${library ? `<p class="muted" style="font-size:12px">${escapeHtml(library.note)}</p>${library.results.map((entry) => `<form method="post" action="/admin/ads/inspiration/keep" style="border-top:1px solid var(--line);padding:.5rem 0">
        <input type="hidden" name="source" value="ad-library"><input type="hidden" name="brand" value="${escapeHtml(entry.brand)}"><input type="hidden" name="url" value="${escapeHtml(entry.url)}"><input type="hidden" name="primaryText" value="${escapeHtml(entry.primaryText)}"><input type="hidden" name="hook" value="${escapeHtml(entry.hook)}">
        <div class="row" style="justify-content:space-between"><strong style="font-size:12.5px">${escapeHtml(entry.brand)}</strong><span class="tag">${escapeHtml(entry.angle)}${entry.startedAt ? ` · since ${escapeHtml(entry.startedAt.slice(0, 10))}` : ''}</span></div>
        <p style="font-size:12.5px;margin:.2rem 0;white-space:pre-wrap">${escapeHtml(entry.primaryText.slice(0, 400))}</p>
        <div class="row">${entry.url ? `<a class="btn" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}<button class="btn primary" type="submit">Keep</button></div></form>`).join('')}` : ''}
      <form method="post" action="/admin/ads/inspiration/read" style="border-top:1px solid var(--line);padding-top:.7rem;margin-top:.4rem">
        <div class="row"><div class="field" style="flex:2"><label>Competitor link or ad URL</label><input name="url" placeholder="https://"></div><div class="field" style="flex:1"><label>Brand</label><input name="brand"></div></div>
        <div class="field"><label>Or paste the ad text — first line is the hook</label><textarea name="text" rows="3"></textarea></div>
        <button class="btn primary" type="submit">Read and keep</button></form>
      ${inspiration.length ? `<div style="margin-top:.8rem"><div class="eyebrow">Kept</div>${inspiration.map((entry) => `<div style="border-top:1px solid var(--line);padding:.5rem 0">
        <div class="row" style="justify-content:space-between"><strong style="font-size:12.5px">${escapeHtml(entry.brand || entry.source)}</strong><span class="row" style="gap:.4rem"><span class="tag">${escapeHtml(entry.angle)}</span><form method="post" action="/admin/ads/inspiration/${escapeHtml(entry.id)}/delete"><button class="btn" type="submit" title="Remove">×</button></form></span></div>
        <p style="font-size:12.5px;margin:.2rem 0"><strong>${escapeHtml(entry.hook)}</strong></p>${entry.primaryText && entry.primaryText !== entry.hook ? `<p class="muted" style="font-size:12px;margin:.1rem 0;white-space:pre-wrap">${escapeHtml(entry.primaryText.slice(0, 300))}</p>` : ''}${entry.url ? `<a class="muted" style="font-size:11px" href="${escapeHtml(entry.url)}" target="_blank" rel="noopener">${escapeHtml(entry.url.slice(0, 60))}</a>` : ''}</div>`).join('')}</div>` : ''}
      <div style="margin-top:.8rem"><div class="eyebrow">Hook patterns, filled with ${escapeHtml(first?.title ?? 'your product')}</div>
        ${patterns.map((entry) => `<form method="post" action="/admin/ads/inspiration/keep" class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:.35rem 0;font-size:12.5px">
          <input type="hidden" name="source" value="pattern"><input type="hidden" name="brand" value="${escapeHtml(entry.brand)}"><input type="hidden" name="hook" value="${escapeHtml(entry.hook)}">
          <span><span class="muted">${escapeHtml(entry.brand)}</span> ${escapeHtml(entry.hook)}</span><button class="btn" type="submit">Keep</button></form>`).join('')}</div></div>
  </div>
  <div>
    <form method="post" action="/admin/ads/draft" class="card"><h2>Draft ads</h2>
      <div class="row"><div class="field" style="flex:2"><label>Product</label><select name="productId">${productOptions(ctx)}</select></div>
        <div class="field" style="flex:1"><label>Platform</label><select name="platform">${PLATFORMS.map((platform) => `<option value="${platform.id}">${escapeHtml(platform.name)}</option>`).join('')}</select></div></div>
      <div class="field"><label>Text model for this generation</label><select name="model">${textModelOptions()}</select></div>
      <div class="field"><label>Formats (leave empty to let the direction choose)</label><div class="row" style="gap:.4rem .8rem;font-size:12px">${AD_FORMATS.map((format) => `<label class="row" style="gap:.3rem" title="${escapeHtml(format.description)}"><input type="checkbox" name="formats" value="${format.id}"> ${escapeHtml(format.name)}</label>`).join('')}</div></div>
      <div class="row"><div class="field" style="flex:2"><label>Avatar — who this is written to</label><select name="avatarId">${avatarOptions(ctx)}</select></div><div class="field" style="flex:1"><label>How many</label><input name="count" value="3"></div></div>
      <div class="field"><label>Direction — free-form. "urgent", "premium", "for coaches", "focus on the repair guarantee", "say \"built to order\"".</label><textarea name="direction" rows="2" placeholder="Blunt, for people who have bought the cheap ones twice, focus on the wrist, say &quot;repaired for life&quot;"></textarea></div>
      <button class="btn primary" type="submit">Draft</button>
      <p class="muted" style="font-size:11.5px;margin:.6rem 0 0">${listAvatars(ctx.db, ctx.store.id).length ? '' : 'No avatars yet — suggest them on the Research page and the drafts will be written to one. '}Testimonial ads only use approved reviews on file; nothing is invented.</p></form>
    <div class="card"><h2>Platform notes</h2>${PLATFORMS.map((platform) => `<p style="font-size:12.5px;margin:.4rem 0"><strong>${escapeHtml(platform.name)}</strong> <span class="muted">${escapeHtml(platform.note)}</span></p>`).join('')}</div>
  </div></div>`
}

export function adDetail(ctx: Ctx, adId: string): string {
  const ad = getAd(ctx.db, ctx.store.id, adId)
  if (!ad) return '<p class="muted">No such ad.</p>'
  const product = listProducts(ctx.db, ctx.store.id, { limit: 300 }).find((entry) => entry.id === ad.productId)
  const warnings = limitWarnings(ad)
  const platform = PLATFORMS.find((entry) => entry.id === ad.platform)
  return `${flash(ctx)}<div class="head"><div><div class="eyebrow"><a href="/admin/ads" style="text-decoration:none">Ads</a> / ${escapeHtml(ad.platform)} · ${escapeHtml(ad.format)}</div><h1 class="serif">${escapeHtml(ad.name)}</h1>
    <p class="muted" style="margin:.25rem 0 0">${product ? escapeHtml(product.title) : ''}${ad.body.avatar ? ` · written to ${escapeHtml(ad.body.avatar)}` : ''}${ad.direction ? ` · direction: "${escapeHtml(ad.direction)}"` : ''}</p></div></div>
  ${warnings.length ? `<div class="notice" style="margin-bottom:1rem">${warnings.map((line) => escapeHtml(line)).join('<br>')}</div>` : ''}
  <div class="grid2"><div>
    <form method="post" action="/admin/ads/${escapeHtml(ad.id)}/save" class="card"><h2>Copy</h2>
      <div class="row"><div class="field" style="flex:2"><label>Name</label><input name="name" value="${escapeHtml(ad.name)}"></div>
        <div class="field" style="flex:1"><label>Status</label><select name="status">${['draft', 'ready', 'archived'].map((status) => `<option ${status === ad.status ? 'selected' : ''}>${status}</option>`).join('')}</select></div></div>
      ${field('Hooks — one per line; the first is used', 'hooks', ad.body.hooks.join('\n'), { rows: Math.min(10, Math.max(3, ad.body.hooks.length)) })}
      ${ad.format === 'search' ? `${field('Headlines — one per line, 30 characters each', 'headlines', ad.body.headlines.join('\n'), { rows: 8 })}${field('Descriptions — one per line, 90 characters each', 'descriptions', ad.body.descriptions.join('\n'), { rows: 4 })}` : field('Primary text', 'primaryText', ad.body.primaryText, { rows: 8, help: platform?.limits.primary ? `first line shows ${platform.limits.primary} characters before "See more"` : '' })}
      <div class="row">${field('Headline', 'headline', ad.body.headline, { help: platform?.limits.headline ? `${platform.limits.headline} chars` : '' })}${field('Description', 'description', ad.body.description)}${field('Call to action', 'cta', ad.body.cta)}</div>
      ${ad.body.script.length ? `<div class="eyebrow" style="margin:.6rem 0 .3rem">Script</div><table class="data"><thead><tr><th style="width:80px">Beat</th><th style="width:60px">Time</th><th>Line</th><th>On screen</th></tr></thead><tbody>
        ${ad.body.script.map((beat, index) => `<tr><td><input name="script_beat_${index}" value="${escapeHtml(beat.beat)}" style="width:80px"></td><td><input name="script_seconds_${index}" value="${escapeHtml(beat.seconds)}" style="width:56px"></td><td><textarea name="script_line_${index}" rows="2">${escapeHtml(beat.line)}</textarea></td><td><input name="script_visual_${index}" value="${escapeHtml(beat.visual)}"></td></tr>`).join('')}</tbody></table><input type="hidden" name="script_count" value="${ad.body.script.length}">` : ''}
      <div class="row" style="margin-top:.8rem"><button class="btn primary" type="submit">Save</button></div></form>
    <form method="post" action="/admin/ads/${escapeHtml(ad.id)}/revise" class="card"><h2>Revise with direction</h2>
      <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Re-drafts every field under a new direction; platform, format and avatar stay. Your edits above are replaced, so save what you want to keep as a new ad first.</p>
      <div class="field"><textarea name="direction" rows="2" placeholder="Shorter, more urgent, lead with the guarantee">${escapeHtml(ad.direction)}</textarea></div>
      <div class="row"><button class="btn primary" type="submit">Revise</button>
        <button class="btn" type="submit" formaction="/admin/ads/${escapeHtml(ad.id)}/duplicate" formmethod="post">Duplicate first</button>
        <button class="btn" type="submit" formaction="/admin/ads/${escapeHtml(ad.id)}/delete" formmethod="post" onclick="return confirm('Delete this ad?')">Delete</button></div></form>
  </div>
  <div>
    <div class="card"><h2>Preview</h2><div class="preview" style="margin-top:.6rem"><div class="chrome"><i></i><i></i><i></i><span class="muted" style="font-size:11px;margin-left:.4rem">${escapeHtml(ctx.store.name)} · Sponsored</span></div>
      <div style="padding:.8rem;font-size:13px;white-space:pre-wrap">${escapeHtml(ad.format === 'search' ? ad.body.headlines.slice(0, 3).join(' | ') : ad.body.primaryText || ad.body.hooks.join('\n'))}</div>
      ${product?.heroImage && ad.format !== 'search' ? `<img src="${escapeHtml(product.heroImage)}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover">` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;padding:.7rem .8rem;background:var(--paper);border-top:1px solid var(--line)"><div><div style="font-weight:600;font-size:13px">${escapeHtml(ad.format === 'search' ? ad.body.descriptions[0] ?? '' : ad.body.headline)}</div><div class="muted" style="font-size:11.5px">${escapeHtml(ad.body.description)}</div></div><span class="btn">${escapeHtml(ad.body.cta || 'Shop now')}</span></div></div></div>
    ${ad.body.notes.filter(Boolean).length ? `<div class="card"><h2>Notes</h2>${ad.body.notes.filter(Boolean).map((note) => `<p style="font-size:12.5px;margin:.4rem 0">${escapeHtml(note)}</p>`).join('')}</div>` : ''}
    <div class="card"><h2>Copy for the ad manager</h2><textarea readonly rows="10" style="font-size:12px" onclick="this.select()">${escapeHtml(exportAd(ad))}</textarea></div>
  </div></div>`
}

function exportAd(ad: Ad): string {
  const parts = [`# ${ad.name}`, `Platform: ${ad.platform} · Format: ${ad.format}${ad.body.avatar ? ` · Avatar: ${ad.body.avatar}` : ''}`, '']
  if (ad.body.hooks.length) parts.push('HOOKS', ...ad.body.hooks.map((hook, index) => `${index + 1}. ${hook}`), '')
  if (ad.body.primaryText) parts.push('PRIMARY TEXT', ad.body.primaryText, '')
  if (ad.body.headlines.length) parts.push('HEADLINES', ...ad.body.headlines, '')
  if (ad.body.descriptions.length) parts.push('DESCRIPTIONS', ...ad.body.descriptions, '')
  if (ad.body.headline) parts.push(`HEADLINE: ${ad.body.headline}`)
  if (ad.body.description) parts.push(`DESCRIPTION: ${ad.body.description}`)
  if (ad.body.cta) parts.push(`CTA: ${ad.body.cta}`)
  if (ad.body.script.length) parts.push('', 'SCRIPT', ...ad.body.script.map((beat) => `[${beat.seconds}s ${beat.beat}] ${beat.line}   (${beat.visual})`))
  return parts.join('\n')
}

/* ------------------------------------------------------------------- domains */

export function domainsPage(ctx: Ctx): string {
  const domains = domainsFor(ctx.db, ctx.store.id)
  const edge = edgeTarget()
  const publicUrl = ctx.storeUrl.startsWith('http') ? ctx.storeUrl : `${process.env.AMBORAS_PUBLIC_ORIGIN ?? ''}${ctx.storeUrl}`
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Domains</h1>
    <p class="muted" style="margin:.25rem 0 0">Each store has its own. This one answers at <a href="${escapeHtml(ctx.storeUrl)}" target="_blank" rel="noopener">${escapeHtml(ctx.storeUrl)}</a> whatever happens here.</p></div></div>
  <div class="grid2"><div>
    ${domains.length ? domains.map((domain) => {
      const plan = dnsPlan(domain.hostname, domain.mode, domain.registrar, domain.verificationToken, publicUrl)
      const check = domain.lastCheck
      return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${escapeHtml(domain.hostname)}</h2>
        <span class="row"><span class="tag">${domain.mode === 'host' ? 'hosted here' : 'forwarded'}</span><span class="tag ${domain.status === 'verified' ? 'ok' : 'warn'}">${domain.status}${domain.status === 'verified' && domain.mode === 'host' ? ` · ssl ${domain.ssl}` : ''}</span></span></div>
        <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">At ${escapeHtml(REGISTRARS.find((registrar) => registrar.id === domain.registrar)?.name ?? 'your registrar')}: ${plan.steps.map((step) => escapeHtml(step)).join(' → ')}</p>
        <table class="data"><thead><tr><th>Type</th><th>Host</th><th>Value</th><th></th></tr></thead><tbody>${plan.records.map((record) => `<tr><td>${record.type}</td><td><code>${escapeHtml(record.name)}</code></td><td><code style="user-select:all">${escapeHtml(record.value)}</code></td><td class="muted" style="font-size:11.5px">${escapeHtml(record.why)}</td></tr>`).join('')}</tbody></table>
        ${plan.caveat ? `<p class="muted" style="font-size:12px;margin:.6rem 0 0">${escapeHtml(plan.caveat)}</p>` : ''}
        ${check ? `<div class="notice ${check.verified ? 'ok' : ''}" style="margin-top:.7rem;font-size:12.5px"><strong>Last check ${escapeHtml(check.at.slice(0, 16).replace('T', ' '))}.</strong> ${escapeHtml(check.reason)}
          ${check.mode === 'host' ? `<div class="muted" style="font-size:11.5px;margin-top:.3rem">TXT: ${check.txt.ok ? 'found' : check.txt.found.length ? `found ${escapeHtml(check.txt.found.join(', '))}` : 'not found'} · points at: ${escapeHtml(check.target.found.join(', ') || 'nothing')}</div>` : `<div class="muted" style="font-size:11.5px;margin-top:.3rem">HTTP ${check.forward.status || '—'}${check.forward.location ? ` → ${escapeHtml(check.forward.location)}` : ''}</div>`}</div>` : ''}
        <div class="row" style="margin-top:.7rem">
          <form method="post" action="/admin/domains/check"><input type="hidden" name="hostname" value="${escapeHtml(domain.hostname)}"><button class="btn primary" type="submit">Check now</button></form>
          ${domain.status === 'verified' ? '' : `<form method="post" action="/admin/domains/verify"><input type="hidden" name="hostname" value="${escapeHtml(domain.hostname)}"><button class="btn" type="submit" title="Skip the lookup. Use when your DNS is behind a proxy the check cannot see.">Mark verified anyway</button></form>`}
          <form method="post" action="/admin/domains/remove" onsubmit="return confirm('Detach ${escapeHtml(domain.hostname)}?')"><input type="hidden" name="hostname" value="${escapeHtml(domain.hostname)}"><button class="btn" type="submit">Detach</button></form></div></div>`
    }).join('') : '<div class="card"><p class="muted">No domain attached to this store yet.</p></div>'}
  </div>
  <div>
    <form method="post" action="/admin/domains" class="card"><h2>Connect a domain</h2>
      <div class="field"><label>Domain</label><input name="hostname" placeholder="yourbrand.com or shop.yourbrand.com" required></div>
      <div class="field"><label>Registrar or DNS host</label><select name="registrar">${REGISTRARS.map((registrar) => `<option value="${registrar.id}">${escapeHtml(registrar.name)}</option>`).join('')}</select></div>
      <div class="field"><label>How</label>
        <label class="row" style="gap:.4rem;font-size:12.5px;margin:.2rem 0"><input type="radio" name="mode" value="host" checked> <span><strong>Host it here</strong> — DNS points the name at <code>${escapeHtml(edge.host)}</code>${edge.ip ? ` (or A ${escapeHtml(edge.ip)})` : ''}; your domain stays in the address bar.</span></label>
        <label class="row" style="gap:.4rem;font-size:12.5px;margin:.2rem 0"><input type="radio" name="mode" value="forward"> <span><strong>Forward it</strong> — the registrar redirects the name to ${escapeHtml(publicUrl)}. Quickest; visitors land on the platform address.</span></label></div>
      <button class="btn primary" type="submit">Attach and show the records</button></form>
    <div class="card"><h2>Which one</h2>
      <p style="font-size:12.5px;margin:.4rem 0"><strong>Hosting</strong> is what a real store wants: the domain in the address bar, a certificate for it, pixels and checkout on your name. It needs the platform reachable at <code>${escapeHtml(edge.host)}</code>${edge.ip ? '' : ' — set <code>STOREMILL_EDGE_HOST</code> or <code>STOREMILL_EDGE_IP</code> to what your deployment actually answers on'}.</p>
      <p style="font-size:12.5px;margin:.4rem 0"><strong>Forwarding</strong> is for a domain you own and want pointed somewhere today: Namecheap's "Redirect Domain", GoDaddy's "Forwarding". Nothing is served here; the registrar sends people on.</p>
      <p class="muted" style="font-size:12px;margin:.4rem 0">${REGISTRARS.slice(0, 5).map((registrar) => `<strong>${escapeHtml(registrar.name)}:</strong> ${escapeHtml(registrar.note)}`).join('<br><br>')}</p></div>
  </div></div>`
}

/* ------------------------------------------------------------------- avatars */

const TONES = ['plain', 'urgent', 'premium', 'warm', 'clinical', 'playful', 'blunt']

export function avatarsCard(ctx: Ctx): string {
  const avatars = listAvatars(ctx.db, ctx.store.id)
  const research = latestResearch(ctx.db, ctx.store.id)
  const form = (avatar: (typeof avatars)[number] | null) => `<form method="post" action="/admin/avatars/save" style="border-top:1px solid var(--line);padding:.7rem 0">
    ${avatar ? `<input type="hidden" name="id" value="${escapeHtml(avatar.id)}">` : ''}
    <div class="row"><div class="field" style="flex:2"><label>Name</label><input name="name" value="${escapeHtml(avatar?.name ?? '')}" placeholder="The serious amateur" required></div>
      <div class="field" style="flex:1"><label>Tone</label><select name="tone">${TONES.map((tone) => `<option ${tone === (avatar?.tone ?? 'plain') ? 'selected' : ''}>${tone}</option>`).join('')}</select></div>
      <div class="field" style="flex:0 0 70px"><label>Share %</label><input name="share" value="${avatar ? Math.round(avatar.share * 100) : ''}"></div></div>
    ${field('Who', 'who', avatar?.who ?? '', { rows: 2 })}
    <div class="row">${field('Wants', 'wants', avatar?.wants ?? '')}${field('Fears', 'fears', avatar?.fears ?? '')}</div>
    <div class="row">${field('Buys when', 'buysWhen', avatar?.buysWhen ?? '')}${field('Angle that reaches them', 'angle', avatar?.angle ?? '')}</div>
    ${field('Hooks — one per line', 'hooks', avatar?.hooks.join('\n') ?? '', { rows: 3 })}
    <div class="row">${field('First objection', 'objection', avatar?.objection ?? '')}${field('The answer', 'answer', avatar?.answer ?? '')}</div>
    <details style="margin:.2rem 0 .6rem"><summary class="muted" style="cursor:pointer;font-size:12px">The five categories — desire first; the rest make a sub-avatar</summary>
      <div class="row">${field('Desire ("I want …")', 'desire', avatar?.desire ?? '')}${field('Label they use for themselves', 'label', avatar?.label ?? '')}</div>
      <div class="row">${field('Experience (circumstance, or what they tried and its outcome)', 'experience', avatar?.experience ?? '')}${field('Emotion', 'emotion', avatar?.emotion ?? '')}</div>
      <div class="row">${field('Behaviour (what they do, how often)', 'behaviour', avatar?.behaviour ?? '')}${field('Demographic (only if the product works better for them)', 'demographic', avatar?.demographic ?? '')}</div>
      <div class="row"><div class="field" style="flex:1"><label>Reach</label><select name="tier"><option value="">—</option>${['niche', 'mid', 'mass'].map((tier) => `<option ${tier === avatar?.tier ? 'selected' : ''}>${tier}</option>`).join('')}</select></div>
        <div class="field" style="flex:2"><label>Sub-avatar of</label><select name="parentId"><option value="">— this is a core avatar —</option>${avatars.filter((other) => !other.parentId && other.id !== avatar?.id).map((other) => `<option value="${escapeHtml(other.id)}" ${other.id === avatar?.parentId ? 'selected' : ''}>${escapeHtml(other.name)}</option>`).join('')}</select></div></div></details>
    <div class="row" style="justify-content:space-between"><label class="row" style="font-size:12px;gap:.3rem"><input type="checkbox" name="selected" value="true" ${!avatar || avatar.selected ? 'checked' : ''}> Use for generation</label>
      <span class="row"><button class="btn primary" type="submit">${avatar ? 'Save' : 'Add avatar'}</button>${avatar ? `<button class="btn" type="submit" formaction="/admin/avatars/${escapeHtml(avatar.id)}/delete" onclick="return confirm('Delete this avatar?')">Delete</button>` : ''}</span></div></form>`
  return `<div class="card" id="avatars"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Avatars — who the pages and ads are written to</h2>
    <form method="post" action="/admin/avatars/suggest"><button class="btn" type="submit" ${research ? '' : 'disabled title="Run research first"'}>Suggest from research</button></form></div>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .4rem">Pick one when generating versions, advertorials or ads: it fills the audience, angle and tone that the direction box leaves blank. Typed words still win.</p>
    ${avatars.map((avatar) => `<details ${avatars.length <= 2 ? 'open' : ''}><summary style="cursor:pointer;padding:.4rem 0;font-size:13px"><strong>${escapeHtml(avatar.name)}</strong> <span class="muted">· ${escapeHtml(avatar.angle || 'no angle')} · ${escapeHtml(avatar.tone)}${avatar.selected ? '' : ' · off'} · ${escapeHtml(avatar.source)}</span></summary>${form(avatar)}</details>`).join('')}
    <details><summary style="cursor:pointer;padding:.4rem 0;font-size:13px" class="muted">+ Add an avatar by hand</summary>${form(null)}</details></div>`
}

/* --------------------------------------------------------------- competitors */

const ANGLES = ['problem-solution', 'offer', 'risk-reversal', 'clinical', 'social-proof', 'comparison', 'urgency', 'premium', 'story', 'benefit']

export function competitorsCard(ctx: Ctx): string {
  const records = listCompetitors(ctx.db, ctx.store.id)
  const products = listProducts(ctx.db, ctx.store.id, { limit: 200 })
  return `<div class="card" id="competitors"><h2>Competitor pages — the angle they run</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Paste a page selling the same product. What it leads with, charges, promises and who it says it is for are pulled into fields you can change, then folded into the research or used as a direction.</p>
    <form method="post" action="/admin/competitors/read">
      <div class="row"><div class="field" style="flex:2"><label>URL</label><input name="url" placeholder="https://competitor.com/products/the-same-thing"></div>
        <div class="field" style="flex:1"><label>Competes with</label><select name="productId"><option value="">—</option>${productOptions(ctx)}</select></div></div>
      <div class="field"><label>Or paste the page (view-source → select all → copy) when the site blocks fetching</label><textarea name="html" rows="2"></textarea></div>
      <button class="btn primary" type="submit">Read the angle</button></form>
    ${records.map((record) => `<details style="border-top:1px solid var(--line);margin-top:.6rem"><summary style="cursor:pointer;padding:.5rem 0;font-size:13px"><strong>${escapeHtml(record.brand || record.url || 'Pasted page')}</strong> <span class="tag">${escapeHtml(record.angle)}</span> <span class="muted">${escapeHtml(record.headline.slice(0, 70))}${record.offer.price ? ` · ${escapeHtml(record.offer.price)}` : ''}</span></summary>
      <form method="post" action="/admin/competitors/${escapeHtml(record.id)}/save" style="padding:.4rem 0">
        <div class="row"><div class="field" style="flex:1"><label>Brand</label><input name="brand" value="${escapeHtml(record.brand)}"></div><div class="field" style="flex:2"><label>URL</label><input name="url" value="${escapeHtml(record.url)}"></div>
          <div class="field" style="flex:1"><label>Angle</label><select name="angle">${ANGLES.map((angle) => `<option ${angle === record.angle ? 'selected' : ''}>${angle}</option>`).join('')}</select></div>
          <div class="field" style="flex:1"><label>Competes with</label><select name="productId"><option value="">—</option>${products.map((product) => `<option value="${escapeHtml(product.id)}" ${product.id === record.productId ? 'selected' : ''}>${escapeHtml(product.title)}</option>`).join('')}</select></div></div>
        ${field('Headline', 'headline', record.headline)}${field('Subheadline', 'subheadline', record.subheadline)}
        <div class="row">${field('Hooks — one per line', 'hooks', record.hooks.join('\n'), { rows: 3 })}${field('Benefits they claim — one per line', 'benefits', record.benefits.join('\n'), { rows: 3 })}</div>
        <div class="row">${field('Price', 'price', record.offer.price)}${field('Compare-at', 'comparePrice', record.offer.comparePrice)}${field('Discount', 'discount', record.offer.discount)}</div>
        <div class="row">${field('Shipping promise', 'shipping', record.offer.shipping)}${field('Guarantee', 'guarantee', record.offer.guarantee)}${field('Bundle', 'bundle', record.offer.bundle)}</div>
        <div class="row">${field('Review count', 'reviewCount', record.proof.reviewCount)}${field('Rating', 'rating', record.proof.rating)}${field('Badges — comma separated', 'badges', record.proof.badges.join(', '))}</div>
        <div class="row">${field('Who they say it is for', 'audience', record.audience)}${field('Their buttons say', 'ctas', record.ctas.join(' | '))}</div>
        ${field('Your take — what to keep, what they get wrong (becomes their weakness in the research)', 'take', record.take, { rows: 2 })}
        ${record.images.length ? `<div class="row" style="margin:.3rem 0">${record.images.slice(0, 4).map((src) => `<img src="${escapeHtml(src)}" alt="" style="width:64px;height:64px;object-fit:cover;border-radius:6px;border:1px solid var(--line)" loading="lazy">`).join('')}</div>` : ''}
        ${record.notes.length ? `<p class="muted" style="font-size:11.5px">${escapeHtml(record.notes.join(' '))}</p>` : ''}
        <div class="field"><label>As a direction — edit before using</label><input name="direction" value="${escapeHtml(directionFrom(record))}"></div>
        <div class="row"><button class="btn primary" type="submit">Save</button>
          <button class="btn" type="submit" formaction="/admin/competitors/${escapeHtml(record.id)}/apply" title="Adds them as a named competitor and an avatar, and files what they promise as notes about them. Their guarantee does not become yours.">Fold into research</button>
          ${record.productId ? `<button class="btn" type="submit" formaction="/admin/competitors/${escapeHtml(record.id)}/versions">Generate PDP versions with this angle</button><button class="btn" type="submit" formaction="/admin/competitors/${escapeHtml(record.id)}/ads">Draft ads with this angle</button>` : '<span class="muted" style="font-size:11.5px">Pick which product it competes with to generate from it.</span>'}
          <button class="btn" type="submit" formaction="/admin/competitors/${escapeHtml(record.id)}/delete" onclick="return confirm('Delete this record?')">Delete</button></div></form></details>`).join('')}</div>`
}

/* -------------------------------------------------------------------- images */

export function regenerateCard(ctx: Ctx, product: { id: string; title: string; metadata: Record<string, string>; heroImage: string }): string {
  const models = imageModels()
  type Sheet = { direction: string; preset: string; provider: string; model: string; lanes: string[]; at: string }
  let sheet: Sheet | null = null
  try {
    sheet = product.metadata.imageSheet ? (JSON.parse(product.metadata.imageSheet) as Sheet) : null
  } catch {
    sheet = null
  }
  return `<div class="card"><h2>Re-shoot the images</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Say what you want in plain words. Your photo is the reference: the product stays the product, the scene changes.</p>
    <form method="post" action="/admin/products/${escapeHtml(product.id)}/regenerate">
      <div class="field"><label>Direction</label><textarea name="direction" rows="2" placeholder="On a marble counter, morning light from the left, a hand holding it, no other props"></textarea></div>
      <div class="row"><div class="field" style="flex:1"><label>Scene preset</label><select name="preset">${PRESETS.map((preset) => `<option value="${preset.id}">${escapeHtml(preset.name)}</option>`).join('')}</select></div>
        <div class="field" style="flex:1"><label>Model</label><select name="provider"><option value="auto">Auto (first configured)</option>${models.map((model) => `<option value="${model.id}" ${model.available ? '' : 'disabled'}>${escapeHtml(model.name)}${model.available ? '' : ` — set ${model.envKey}`}</option>`).join('')}</select></div>
        <div class="field" style="flex:0 0 64px"><label>Lanes</label><input name="lanes" value="3"></div></div>
      <button class="btn primary" type="submit">Render</button></form>
    ${sheet ? `<div style="margin-top:.8rem"><div class="eyebrow">${escapeHtml(sheet.direction || sheet.preset)} · ${escapeHtml(sheet.model)} · ${escapeHtml(sheet.at.slice(0, 16).replace('T', ' '))}</div>
      <div class="grid3" style="grid-template-columns:repeat(3,1fr);margin-top:.4rem">${sheet.lanes.map((url) => `<div><img src="${escapeHtml(url)}" alt="" style="width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px;border:${url === product.heroImage ? '2px solid var(--accent)' : '1px solid var(--line)'}">
        <form method="post" action="/admin/products/${escapeHtml(product.id)}/use-image" class="row" style="gap:.3rem;margin-top:.3rem"><input type="hidden" name="url" value="${escapeHtml(url)}"><button class="btn" name="as" value="hero" type="submit" style="font-size:11px">Hero</button><button class="btn" name="as" value="gallery" type="submit" style="font-size:11px">Gallery</button></form></div>`).join('')}</div></div>` : ''}
    <p class="muted" style="font-size:11.5px;margin:.6rem 0 0">${models.filter((model) => model.available && model.id !== 'svg').map((model) => `${escapeHtml(model.name)} (${escapeHtml(model.model)})`).join(' and ') || 'No image model configured: set OPENAI_API_KEY for GPT Image 2 or GEMINI_API_KEY for Gemini 3 Pro Image. The vector stage still works.'}</p></div>`
}
