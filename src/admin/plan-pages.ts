import { escapeHtml } from '../lib/http.ts'
import { format } from '../lib/money.ts'
import type { Db } from '../lib/db.ts'
import type { Store } from '../control/stores.ts'
import { environment } from '../control/stores.ts'
import { listProducts } from '../domain/catalog.ts'
import { buildProgress, DOORS, MODES, pagePlan, QUESTIONS, SHAPES, type BuildState } from '../control/build.ts'
import { avatarTree, listAvatars } from '../agent/avatars.ts'
import { latestResearch } from '../agent/research.ts'
import { latestDoc, listDocs, type AdPlan, type Loop, type MarketAnalysis, type ProductOverview } from '../agent/market.ts'
import { listQueue, PHOTO_BRIEFS, photoCoverage, type PhotoBrief, type UgcConcept } from '../creative/briefs.ts'
import type { GifRecord } from '../creative/product-gif.ts'
import { auditStore } from '../storefront/health.ts'
import { legalFor } from '../storefront/legal.ts'
import { DEFAULT_POPUP } from '../storefront/behaviour.ts'
import { behaviour, type Range } from '../analytics/events.ts'
import { funnelGroups, funnelStats } from '../domain/funnels.ts'
import { profitReport } from '../domain/ops.ts'
import { calendarMonth } from '../agent/knowledge.ts'

type Ctx = { db: Db; store: Store; userName: string; storeUrl: string; flash?: string }

const e = escapeHtml

function flash(ctx: Ctx): string {
  if (!ctx.flash) return ''
  const bad = ctx.flash.startsWith('!')
  return `<div class="notice" style="margin-bottom:1rem;${bad ? 'border-left-color:var(--bad)' : ''}">${e(bad ? ctx.flash.slice(1) : ctx.flash)}</div>`
}

function productOptions(ctx: Ctx, selected = ''): string {
  return listProducts(ctx.db, ctx.store.id, { limit: 200 }).map((product) => `<option value="${e(product.id)}" ${product.id === selected ? 'selected' : ''}>${e(product.title)}</option>`).join('')
}

/* ------------------------------------------------------------------ build */

export function buildPage(ctx: Ctx): string {
  const progress = buildProgress(ctx.db, ctx.store.id)
  const state = progress.state
  const picker = `<div class="grid3">${MODES.map((mode) => `<form method="post" action="/admin/build/mode" class="card" style="margin:0"><input type="hidden" name="mode" value="${mode.id}">
    <h2>${e(mode.name)}</h2><p class="muted" style="font-size:12.5px;margin:.4rem 0 .8rem">${e(mode.description)}</p>
    <ol class="muted" style="font-size:12px;padding-left:1.1rem;margin:0 0 .8rem">${mode.steps.map((step) => `<li>${e(step.label)}</li>`).join('')}</ol>
    <button class="btn ${progress.mode?.id === mode.id ? '' : 'primary'}" type="submit">${progress.mode?.id === mode.id ? 'This is the current mode' : 'Build this way'}</button></form>`).join('')}</div>`
  const steps = progress.mode
    ? `<div class="card" style="padding:0"><div style="padding:1rem 1.1rem" class="row"><h2 style="margin:0">${e(progress.mode.name)} — the order of work</h2><span class="muted" style="font-size:12px">${progress.steps.filter((step) => step.status === 'done').length} of ${progress.steps.length} done · statuses are read from what exists, not from what was ticked</span></div>
      <table class="data"><tbody>${progress.steps.map((step, index) => `<tr>
        <td style="width:2.2rem;text-align:center"><span class="tag ${step.status === 'done' ? 'ok' : step.status === 'next' ? 'warn' : ''}">${index + 1}</span></td>
        <td><a href="/admin${e(step.href)}" style="font-weight:500">${e(step.label)}</a><div class="muted" style="font-size:12px">${e(step.detail)}</div></td>
        <td style="width:14rem"><span class="tag ${step.status === 'done' ? 'ok' : step.status === 'next' ? 'warn' : ''}">${step.status}</span> <span class="muted" style="font-size:11.5px">${e(step.why)}</span></td>
        <td style="width:6rem;text-align:right"><form method="post" action="/admin/build/skip"><input type="hidden" name="key" value="${e(step.key)}"><input type="hidden" name="skipped" value="${step.status === 'skipped' ? 'false' : 'true'}"><button class="btn" type="submit" style="font-size:11px">${step.status === 'skipped' ? 'Unskip' : 'Skip'}</button></form></td></tr>`).join('')}</tbody></table></div>`
    : ''
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Build</h1><p class="muted" style="margin:.25rem 0 0">Three ways to build, each with its own order of work; two shapes the result can take. Pick both; every step links to where it happens and reads its status from the store itself.</p></div></div>
  ${picker}
  <div style="margin-top:1rem">${steps}</div>
  <div class="grid2" style="margin-top:1rem"><div>${shapeCard(ctx, state)}</div><div>${pagePlanCard(ctx)}</div></div>
  ${answersCard(state)}`
}

/** Store or funnel, what stands in front of it, and whether there is a popup. */
export function shapeCard(ctx: Ctx, state: BuildState): string {
  return `<div class="card" id="shape"><h2>The shape</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .8rem">The reference stores come in two shapes. A Shopify-style store sells from product pages with navigation around them; a funnel sells one product from one long page into a checkout with a bump and an upsell. Either can have an advertorial or a quiz in front of it, where the ad lands.</p>
    <form method="post" action="/admin/build/shape">
      ${SHAPES.map((shape) => `<label class="row" style="align-items:flex-start;gap:.6rem;padding:.5rem 0;border-top:1px solid var(--line)"><input type="radio" name="shape" value="${shape.id}" ${state.shape === shape.id ? 'checked' : ''} style="margin-top:.25rem"><span><strong>${e(shape.name)}</strong><br><span class="muted" style="font-size:12px">${e(shape.description)}</span><br><span class="muted" style="font-size:11.5px">${e(shape.pages)}</span></span></label>`).join('')}
      <div class="eyebrow" style="margin:.8rem 0 .3rem">In front of it</div>
      ${DOORS.map((door) => `<label class="row" style="align-items:flex-start;gap:.6rem;padding:.3rem 0"><input type="checkbox" name="doors" value="${door.id}" ${state.doors.includes(door.id) ? 'checked' : ''} style="margin-top:.25rem"><span><strong>${e(door.name)}</strong> <span class="muted" style="font-size:12px">${e(door.description)}</span></span></label>`).join('')}
      <div class="eyebrow" style="margin:.8rem 0 .3rem">Popup</div>
      <div class="row" style="gap:1rem;font-size:12.5px"><label class="row" style="gap:.3rem"><input type="radio" name="popup" value="yes" ${state.popup === 'yes' ? 'checked' : ''}> Yes, one popup</label><label class="row" style="gap:.3rem"><input type="radio" name="popup" value="no" ${state.popup === 'no' ? 'checked' : ''}> No popup</label><label class="row" style="gap:.3rem"><input type="radio" name="popup" value="" ${state.popup === '' ? 'checked' : ''}> Decide later</label></div>
      <button class="btn primary" type="submit" style="margin-top:.8rem">Save the shape</button></form></div>`
}

/** Every page the shape needs, with its status read from the store and a way to make each missing one. */
export function pagePlanCard(ctx: Ctx): string {
  const plan = pagePlan(ctx.db, ctx.store.id)
  if (!plan.shape) return `<div class="card" id="pages"><h2>Page plan</h2><p class="muted" style="font-size:12.5px">Choose the shape and the pages it needs are listed here, each with a status and a template.</p></div>`
  const product = listProducts(ctx.db, ctx.store.id, { status: 'published', limit: 1 })[0]
  const make = (entry: (typeof plan.pages)[number]) => {
    // A draft is written; what it needs is publishing, not another copy.
    if (entry.status === 'draft') return `<a class="btn primary" href="/admin${e(entry.href)}" style="font-size:11px">Publish it</a>`
    if (entry.status === 'done') return `<a class="btn" href="/admin${e(entry.href)}" style="font-size:11px">${entry.builtIn && !entry.template ? 'Open' : 'Edit'}</a>`
    if (entry.template && !entry.builtIn) return `<form method="post" action="/admin/pages/new"><input type="hidden" name="template" value="${entry.template}"><input type="hidden" name="productId" value="${e(product?.id ?? '')}"><button class="btn primary" type="submit" style="font-size:11px">Create from template</button></form>`
    return `<a class="btn" href="/admin${e(entry.href)}" style="font-size:11px">${entry.status === 'missing' ? 'Set it up' : 'Open'}</a>`
  }
  return `<div class="card" id="pages" style="padding:0"><div style="padding:1rem 1.1rem"><h2 style="margin:0">Page plan</h2><p class="muted" style="font-size:12px;margin:.3rem 0 0">${plan.shape === 'store' ? 'A Shopify-style store' : 'A funnel'}${plan.doors.length ? ` with ${plan.doors.map((door) => DOORS.find((entry) => entry.id === door)?.name.toLowerCase() ?? door).join(' and ')} in front` : ''}. Statuses come from what exists.</p></div>
    <table class="data"><tbody>${plan.pages.map((entry) => `<tr>
      <td><strong>${e(entry.label)}</strong>${entry.optional ? ' <span class="muted" style="font-size:11px">optional</span>' : ''}<div class="muted" style="font-size:11.5px">${e(entry.detail)}</div></td>
      <td style="width:12rem"><span class="tag ${entry.status === 'done' ? 'ok' : entry.status === 'draft' ? 'warn' : entry.status === 'missing' ? (entry.optional ? '' : 'warn') : ''}">${entry.status}</span> <span class="muted" style="font-size:11.5px">${e(entry.why)}</span></td>
      <td style="width:9rem;text-align:right">${make(entry)}</td></tr>`).join('')}</tbody></table></div>`
}

export function answersCard(state: BuildState): string {
  const answered = Object.values(state.answers).filter((answer) => !answer.unknown).length
  const unknown = Object.values(state.answers).filter((answer) => answer.unknown).length
  return `<div class="card" id="answers"><h2>What you know about the buyer</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .8rem">Eight questions. Answer what you know; tick "I don't know" for the rest and the research and the market analysis fill it in, labelled as assumed until you confirm it.${answered || unknown ? ` So far: ${answered} answered, ${unknown} left to research.` : ''}</p>
    <form method="post" action="/admin/build/answers">
    ${QUESTIONS.map((question) => {
      const answer = state.answers[question.key]
      return `<div class="field"><label for="buyer-${question.key}">${e(question.label)}</label>
        <div class="row"><input id="buyer-${question.key}" name="${question.key}" value="${e(answer?.value ?? '')}" placeholder="${e(question.help)}" style="flex:1" ${answer?.unknown ? '' : ''}>
        <label class="row" style="font-size:12px;gap:.3rem;white-space:nowrap"><input type="checkbox" name="${question.key}_unknown" value="true" ${answer?.unknown ? 'checked' : ''}> I don't know</label></div>
        ${answer?.unknown && answer.assumed ? `<span class="muted" style="font-size:11.5px">Assumed by research: ${e(answer.assumed)} — type it in to confirm.</span>` : ''}</div>`
    }).join('')}
    <button class="btn primary" type="submit">Save answers</button></form></div>`
}

/* ----------------------------------------------------------------- market */

export function marketPage(ctx: Ctx): string {
  const research = latestResearch(ctx.db, ctx.store.id)
  const analysis = latestDoc<MarketAnalysis>(ctx.db, ctx.store.id, 'analysis')
  const overviews = listDocs<ProductOverview>(ctx.db, ctx.store.id, 'product-overview')
  const plan = latestDoc<AdPlan>(ctx.db, ctx.store.id, 'ad-plan')
  const loops = listDocs<Loop>(ctx.db, ctx.store.id, 'loop')
  const month = calendarMonth()
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Market</h1><p class="muted" style="margin:.25rem 0 0">Planning, saved under this store: where the market sits, the product as the buyer sees it, the core avatar and its sub-avatars, and the ad plan that comes out of them.</p></div>
    <span class="tag">${e(month.month)}: ${e(month.theme)} — ${e(month.leadDesires.join(', '))}</span></div>
  ${analysisCard(ctx, research !== null, analysis)}
  <div class="grid2"><div>${avatarTreeCard(ctx)}${adPlanCard(ctx, plan)}</div><div>${overviewCard(ctx, overviews)}${loopCard(loops)}</div></div>`
}

function analysisCard(ctx: Ctx, hasResearch: boolean, doc: ReturnType<typeof latestDoc<MarketAnalysis>>): string {
  const form = `<form method="post" action="/admin/market/analysis" class="row" style="margin-top:.6rem"><input aria-label="Market analysis notes" name="notes" placeholder="Anything to add: a competitor, a mechanism you know about, a rule" style="flex:1"><button class="btn primary" type="submit" ${hasResearch ? '' : 'disabled title="Run research first"'}>${doc ? 'Write it again' : 'Write the analysis'}</button></form>`
  if (!doc) return `<div class="card"><h2>Market analysis</h2><p class="muted" style="font-size:12.5px">Awareness, sophistication, the desires ranked, the searches to run, the mechanism, the new information, the underserved avatar, and whether there is a way to stand out at all.${hasResearch ? '' : ' Run customer research first; the analysis reads it.'}</p>${form}</div>`
  const a = doc.body
  const stand = a.standOut.found ? `<div class="notice" style="border-left-color:var(--ok)"><strong>A way to stand out: ${e(a.standOut.via)}.</strong> ${e(a.standOut.recommendation)}</div>` : `<div class="notice" style="border-left-color:var(--bad)"><strong>No way to stand out yet.</strong> ${e(a.standOut.recommendation)}</div>`
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Market analysis</h2><span class="muted" style="font-size:12px">${doc.updatedAt.slice(0, 16).replace('T', ' ')} · ${doc.source === 'rules' ? 'from the research by rules — set a model key for the real read' : `written by ${e(doc.model)}`}</span></div>
    <p style="margin:.6rem 0">${e(a.summary)}</p>${stand}
    <div class="grid3" style="margin-top:1rem">
      <div><div class="eyebrow">Awareness</div><p style="margin:.2rem 0"><strong>${e(a.awareness)}</strong> <span class="muted" style="font-size:12px">${e(a.awarenessWhy)}</span></p>
        <div class="eyebrow" style="margin-top:.6rem">Sophistication</div><p style="margin:.2rem 0"><strong>Stage ${a.sophistication}</strong> <span class="muted" style="font-size:12px">${e(a.sophisticationWhy)}</span></p>
        <div class="eyebrow" style="margin-top:.6rem">This month</div><p class="muted" style="margin:.2rem 0;font-size:12px">${e(a.calendar.month)}: ${e(a.calendar.theme)}. ${e(a.calendar.angle)}</p></div>
      <div><div class="eyebrow">Desires, strongest first</div><table class="data" style="margin-top:.3rem"><tbody>${a.desires.map((desire) => `<tr><td><strong>${e(desire.desire)}</strong><div class="muted" style="font-size:11.5px">${e(desire.note)}</div></td><td class="muted" style="font-size:11px;white-space:nowrap">${e(desire.instinct)} · ${e(desire.scope)} · ${e(desire.urgency)} · ${e(desire.stayingPower)}</td></tr>`).join('')}</tbody></table>
        ${a.leadDesire ? `<p style="font-size:12.5px;margin:.4rem 0 0"><span class="muted">Lead with</span> <strong>${e(a.leadDesire)}</strong></p>` : ''}</div>
      <div><div class="eyebrow">Mechanisms</div>${a.mechanisms.length ? `<ul style="margin:.3rem 0;padding-left:1.1rem;font-size:12.5px">${a.mechanisms.map((mechanism) => `<li><strong>${e(mechanism.name)}</strong>${mechanism.isNew ? ' <span class="tag ok">new</span>' : ''} — ${e(mechanism.how)} <span class="muted">Show it: ${e(mechanism.proof)}</span></li>`).join('')}</ul>` : '<p class="muted" style="font-size:12px">None named.</p>'}
        <div class="eyebrow" style="margin-top:.6rem">New information</div>${a.newInformation.length ? `<ul style="margin:.3rem 0;padding-left:1.1rem;font-size:12.5px">${a.newInformation.map((info) => `<li>${e(info.claim)} <span class="muted">— ${e(info.whyItMatters)} Check: ${e(info.checkWith)}</span></li>`).join('')}</ul>` : '<p class="muted" style="font-size:12px">None yet.</p>'}
        <div class="eyebrow" style="margin-top:.6rem">Underserved avatars</div>${a.underserved.length ? `<ul style="margin:.3rem 0;padding-left:1.1rem;font-size:12.5px">${a.underserved.map((entry) => `<li><strong>${e(entry.avatar)}</strong> <span class="tag">${e(entry.tier)}</span> — ${e(entry.why)} <span class="muted">Angle: ${e(entry.angle)}</span></li>`).join('')}</ul>` : '<p class="muted" style="font-size:12px">None yet.</p>'}</div>
    </div>
    <details style="margin-top:.8rem"><summary style="cursor:pointer;font-size:13px">Competitors (${a.competitors.length}), the language, the searches to run, the risks</summary>
      <table class="data" style="margin-top:.6rem"><thead><tr><th>Who</th><th>Angle</th><th>Awareness · stage</th><th>Offer</th><th>Weakness</th></tr></thead><tbody>${a.competitors.map((entry) => `<tr><td>${entry.url ? `<a href="${e(entry.url)}" target="_blank" rel="noopener">${e(entry.name)}</a>` : e(entry.name)}</td><td class="muted">${e(entry.angle)}</td><td class="muted">${e(entry.awareness)} · ${entry.sophistication}</td><td>${e(entry.offer)}</td><td class="muted">${e(entry.weakness)}</td></tr>`).join('')}</tbody></table>
      <div class="grid2" style="margin-top:.8rem"><div><div class="eyebrow">Customer language to look for</div><ul style="margin:.3rem 0;padding-left:1.1rem;font-size:12.5px">${a.languageSnippets.map((line) => `<li>${e(line)}</li>`).join('')}</ul></div>
      <div><div class="eyebrow">Searches to run</div><table class="data" style="margin-top:.3rem"><tbody>${a.researchQueries.map((query) => `<tr><td style="white-space:nowrap">${e(query.where)}</td><td><code style="font-size:12px">${e(query.query)}</code><div class="muted" style="font-size:11.5px">${e(query.lookFor)}</div></td></tr>`).join('')}</tbody></table></div></div>
      ${a.risks.length ? `<div class="eyebrow" style="margin-top:.8rem">Risks</div><ul style="margin:.3rem 0;padding-left:1.1rem;font-size:12.5px">${a.risks.map((risk) => `<li>${e(risk)}</li>`).join('')}</ul>` : ''}</details>
    ${form}</div>`
}

function avatarTreeCard(ctx: Ctx): string {
  const tree = avatarTree(ctx.db, ctx.store.id)
  return `<div class="card" id="avatars"><h2>Core avatars and sub-avatars</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">One desire-based core avatar; sub-avatars layer an experience, an emotion or a behaviour and each gives an angle. Edit any of them on the <a href="/admin/research#avatars">research page</a>; turn on the ones the pages and ads are written to.</p>
    ${tree.length ? tree.map(({ core, subs }) => `<div style="border-top:1px solid var(--line);padding:.7rem 0">
      <div class="row" style="justify-content:space-between"><div><strong>${e(core.name)}</strong> ${core.selected ? '<span class="tag ok">on</span>' : '<span class="tag">off</span>'}${core.tier ? ` <span class="tag">${e(core.tier)}</span>` : ''}<div class="muted" style="font-size:12px">${e(core.desire || core.wants)}${core.angle ? ` · angle: ${e(core.angle)}` : ''}</div></div>
        <form method="post" action="/admin/avatars/${e(core.id)}/subs"><button class="btn" type="submit">Suggest sub-avatars</button></form></div>
      ${subs.length ? `<table class="data" style="margin-top:.5rem"><thead><tr><th>Sub-avatar</th><th>Adds</th><th>Angle</th><th>First hook</th><th></th></tr></thead><tbody>${subs.map((sub) => `<tr><td><strong>${e(sub.name)}</strong>${sub.label ? `<div class="muted" style="font-size:11.5px">"${e(sub.label)}"</div>` : ''}</td>
        <td class="muted" style="font-size:12px">${[sub.experience && `experience: ${sub.experience}`, sub.emotion && `emotion: ${sub.emotion}`, sub.behaviour && `behaviour: ${sub.behaviour}`, sub.demographic && `demographic: ${sub.demographic}`].filter(Boolean).map((line) => e(line as string)).join('<br>') || '—'}</td>
        <td style="font-size:12.5px">${e(sub.angle)}</td><td class="muted" style="font-size:12px">${e(sub.hooks[0] ?? '')}</td>
        <td style="text-align:right;white-space:nowrap"><form method="post" action="/admin/avatars/save" style="display:inline"><input type="hidden" name="id" value="${e(sub.id)}"><input type="hidden" name="name" value="${e(sub.name)}"><input type="hidden" name="selected" value="${sub.selected ? 'false' : 'true'}"><input type="hidden" name="toggle" value="true"><button class="btn" type="submit" style="font-size:11px">${sub.selected ? 'Turn off' : 'Turn on'}</button></form></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="font-size:12px;margin:.4rem 0 0">No sub-avatars yet.</p>'}</div>`).join('')
      : '<p class="muted" style="font-size:12.5px">No avatars yet. Run research, then suggest avatars on the research page; the first one suggested is the core avatar.</p>'}</div>`
}

function overviewCard(ctx: Ctx, docs: Array<ReturnType<typeof latestDoc<ProductOverview>> & object>): string {
  return `<div class="card"><h2>Product overview</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">What it is, what it does, why that matters, what the buyer wants, the mechanisms, and the hidden ones. Everything a model writes here is assumed until you confirm it.</p>
    <form method="post" action="/admin/market/overview" class="row"><select aria-label="Product for overview" name="productId" style="flex:1">${productOptions(ctx)}</select><button class="btn primary" type="submit">Write it</button></form>
    ${docs.map((doc) => { if (!doc) return ''; const o = doc.body; return `<details style="border-top:1px solid var(--line);margin-top:.6rem"><summary style="cursor:pointer;padding:.5rem 0;font-size:13px"><strong>${e(o.name)}</strong> <span class="muted">· ${e(o.price)}${o.compareAt ? ` (was ${e(o.compareAt)})` : ''} · ${doc.source === 'rules' ? 'rules' : e(doc.model)}${o.assumed ? ' · assumed' : ''}</span></summary>
      <div style="font-size:12.5px"><div class="eyebrow">In plain words</div><p>${e(o.sixthGrade || o.howItWorks)}</p>
      <div class="eyebrow">Features → benefits → desires</div><table class="data"><tbody>${o.benefits.map((entry, index) => `<tr><td>${e(entry.feature)}</td><td class="muted">${e(entry.benefit)}</td><td>${e(o.desires[index]?.desire ?? '')}</td></tr>`).join('')}</tbody></table>
      ${o.mechanisms.length ? `<div class="eyebrow" style="margin-top:.6rem">Mechanisms</div><ul style="padding-left:1.1rem">${o.mechanisms.map((mechanism) => `<li><strong>${e(mechanism.name)}</strong>${mechanism.isNew ? ' <span class="tag ok">new</span>' : ''} — ${e(mechanism.how)}</li>`).join('')}</ul>` : ''}
      <div class="eyebrow" style="margin-top:.6rem">Hidden</div><ul style="padding-left:1.1rem"><li><span class="muted">Not advertised:</span> ${e(o.hidden.notAdvertised || '—')}</li><li><span class="muted">Competitors lack:</span> ${e(o.hidden.competitorsLack || '—')}</li><li><span class="muted">If it worked too well:</span> ${e(o.hidden.ifTooWell || '—')}</li><li><span class="muted">A friend would say:</span> ${e(o.hidden.friendWouldSay || '—')}</li></ul>
      <form method="post" action="/admin/market/docs/${e(doc.id)}/delete" style="margin-top:.4rem"><button class="btn" type="submit" style="font-size:11px">Delete</button></form></div></details>` }).join('')}</div>`
}

function adPlanCard(ctx: Ctx, doc: ReturnType<typeof latestDoc<AdPlan>>): string {
  const statuses = ['idea', 'working', 'learning', 'done'] as const
  return `<div class="card" id="plan"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Ad plan</h2><form method="post" action="/admin/market/plan"><button class="btn primary" type="submit">${doc ? 'Add the next tests' : 'Write the plan'}</button></form></div>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Concept → angle → variations → format → method. Statics first as marksman tests across sub-avatars; a sniper video on what wins. A row is done only when its learnings are written down.${doc ? ` ${doc.source === 'rules' ? 'Rules plan.' : `Written by ${e(doc.model)}.`}` : ''}</p>
    ${doc?.body.note ? `<p style="font-size:12.5px">${e(doc.body.note)}</p>` : ''}
    ${doc?.body.rows.length ? doc.body.rows.map((row, index) => `<details style="border-top:1px solid var(--line)"><summary style="cursor:pointer;padding:.5rem 0;font-size:13px"><span class="tag ${row.status === 'done' ? 'ok' : row.status === 'idea' ? '' : 'warn'}">${row.status}</span> <strong>${e(row.concept)}</strong> <span class="muted">· ${e(row.subAvatar)} · ${e(row.method)} · ${e(row.format)}</span></summary>
      <form method="post" action="/admin/market/plan/${index}" style="padding:.4rem 0;font-size:12.5px">
        <p style="margin:.2rem 0"><span class="muted">Desire</span> ${e(row.desire)} · <span class="muted">Awareness</span> ${e(row.awareness)}</p>
        <div class="field"><label>Angle</label><input name="angle" value="${e(row.angle)}"></div>
        <div class="field"><label>Variations — one per line (the hooks)</label><textarea name="variations" rows="3">${e(row.variations.join('\n'))}</textarea></div>
        <p class="muted" style="margin:.2rem 0">Why: ${e(row.why)}</p>
        <div class="row"><div class="field" style="flex:0 0 9rem"><label>Status</label><select name="status">${statuses.map((status) => `<option ${status === row.status ? 'selected' : ''}>${status}</option>`).join('')}</select></div>
          <div class="field" style="flex:1"><label>Result (spend share, KPI, winner or loser)</label><input name="result" value="${e(row.result)}"></div></div>
        <div class="field"><label>Learnings — the row is not done without them</label><textarea name="learnings" rows="2">${e(row.learnings)}</textarea></div>
        <button class="btn" type="submit">Save row</button></form>
      <form method="post" action="/admin/market/plan/${index}/ads" class="row" style="gap:.4rem;align-items:flex-end;padding-bottom:.6rem">
        <div class="field" style="flex:1;margin:0"><label>Draft this row as ads</label><select name="productId">${productOptions(ctx)}</select></div>
        <div class="field" style="width:8rem;margin:0"><label>Platform</label><select name="platform"><option value="meta">Meta</option><option value="tiktok">TikTok</option><option value="google">Google</option><option value="youtube">YouTube</option></select></div>
        <button class="btn primary" type="submit">Write them</button></form>
      <p class="muted" style="font-size:11px;margin:0 0 .6rem">Its angle, its variations and its format go to the ad writer as they are — the row stops being a note you retype.</p></details>`).join('') : '<p class="muted" style="font-size:12.5px">No plan yet. Turn on at least one avatar first.</p>'}</div>`
}

function loopCard(loops: Array<ReturnType<typeof latestDoc<Loop>> & object>): string {
  return `<div class="card" id="loops"><h2>Feedback loops</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">What keeps failing, what keeps working, the hypotheses ranked by confidence, the actions. The ad planner and the ad writer are handed the three most recent, so what this account has learned reaches what it writes next.</p>
    <form method="post" action="/admin/market/loop">
      <div class="field"><label>What keeps failing</label><input name="failing" placeholder="Statics get spend but no purchases"></div>
      <div class="field"><label>What keeps working</label><input name="working" placeholder="The comparison angle carries the account"></div>
      <div class="field"><label>Hypotheses — one per line, most confident first</label><textarea name="hypotheses" rows="2"></textarea></div>
      <div class="field"><label>Actions — one per line</label><textarea name="actions" rows="2"></textarea></div>
      <button class="btn primary" type="submit">Save loop</button></form>
    ${loops.map((doc) => { if (!doc) return ''; const l = doc.body; return `<details style="border-top:1px solid var(--line);margin-top:.6rem"><summary style="cursor:pointer;padding:.5rem 0;font-size:13px"><strong>${e(doc.title)}</strong> <span class="muted">· ${e(l.failing.slice(0, 60))}</span></summary>
      <div style="font-size:12.5px"><p><span class="muted">Failing:</span> ${e(l.failing)}<br><span class="muted">Working:</span> ${e(l.working)}</p>
      <ol style="padding-left:1.1rem">${l.hypotheses.map((line) => `<li>${e(line)}</li>`).join('')}</ol><ul style="padding-left:1.1rem">${l.actions.map((line) => `<li>${e(line)}</li>`).join('')}</ul>
      <form method="post" action="/admin/market/loop" class="row"><input type="hidden" name="id" value="${e(doc.id)}"><input type="hidden" name="failing" value="${e(l.failing)}"><input type="hidden" name="working" value="${e(l.working)}"><input type="hidden" name="hypotheses" value="${e(l.hypotheses.join('\n'))}"><input type="hidden" name="actions" value="${e(l.actions.join('\n'))}"><input name="outcome" value="${e(l.outcome)}" placeholder="What happened when you ran the actions" style="flex:1"><button class="btn" type="submit">Save outcome</button></form></div></details>` }).join('')}</div>`
}

/* --------------------------------------------------------------- creative */

export function creativePage(ctx: Ctx): string {
  const products = listProducts(ctx.db, ctx.store.id, { limit: 200 })
  const avatars = listAvatars(ctx.db, ctx.store.id)
  const queue = listQueue(ctx.db, ctx.store.id)
  const pending = queue.filter((item) => item.status === 'pending')
  const coverage = products.slice(0, 12).map((product) => ({ product, ...photoCoverage(product) }))
  const avatarOpts = `<option value="">— the selected avatar —</option>${avatars.map((avatar) => `<option value="${e(avatar.id)}">${e(avatar.name)}</option>`).join('')}`
  const item = (entry: (typeof queue)[number]) => {
    const body = entry.body as Record<string, unknown>
    let detail = ''
    if (entry.kind === 'photo-brief') { const brief = body as unknown as PhotoBrief; detail = `<p style="margin:.2rem 0"><strong>${e(brief.what)}</strong></p><p class="muted" style="margin:.2rem 0">Why: ${e(brief.why)}</p><p class="muted" style="margin:.2rem 0">How: ${e(brief.how)}</p><p class="muted" style="margin:.2rem 0;font-size:11.5px">Upload it on the product and pick "${e(brief.name)}" under the image — that is what the checklist below counts.</p>` }
    else if (entry.kind === 'ugc-concept') { const concept = body as unknown as UgcConcept; detail = `<p style="margin:.2rem 0"><span class="muted">Who:</span> ${e(concept.who)} · <span class="muted">Format:</span> ${e(concept.format)} · <span class="muted">Angle:</span> ${e(concept.angle)}</p><p style="margin:.2rem 0"><span class="muted">Scene:</span> ${e(concept.scene)}</p><p style="margin:.2rem 0"><span class="muted">Says:</span> "${e(concept.says)}"</p><ol style="padding-left:1.1rem;margin:.2rem 0">${concept.shots.map((shot) => `<li>${e(shot)}</li>`).join('')}</ol><p class="muted" style="margin:.2rem 0;font-size:11.5px">Disclosure: ${e(concept.disclosure)}. This is a brief for a real person to film; it never appears as a review.</p>` }
    else if (entry.kind === 'gif') { const gif = body as unknown as GifRecord; detail = `<div class="row"><img src="${e(gif.url)}" alt="" style="width:120px;height:120px;object-fit:cover;border-radius:8px;border:1px solid var(--line)"><span class="muted" style="font-size:12px">${gif.width}×${gif.height}, ${gif.frames} frames from ${gif.sources.length} images. Approving adds it to the product's media.</span></div>` }
    return `<details style="border-top:1px solid var(--line)"><summary style="cursor:pointer;padding:.5rem 0;font-size:13px"><span class="tag ${entry.status === 'approved' ? 'ok' : entry.status === 'rejected' ? 'bad' : 'warn'}">${entry.status}</span> <span class="tag">${e(entry.kind)}</span> <strong>${e(entry.title)}</strong>${entry.note ? ` <span class="muted">· ${e(entry.note)}</span>` : ''}</summary>
      <div style="font-size:12.5px;padding:.3rem 0 .6rem">${detail}
      <form method="post" action="/admin/creative/${e(entry.id)}/status" class="row" style="margin-top:.4rem"><input aria-label="Creative review note" name="note" placeholder="Note" style="flex:1"><button class="btn" name="status" value="approved" type="submit">Approve</button><button class="btn" name="status" value="rejected" type="submit">Reject</button><button class="btn" name="status" value="delete" type="submit" onclick="return confirm('Delete this item?')">Delete</button></form></div></details>`
  }
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Creative</h1><p class="muted" style="margin:.25rem 0 0">Photo briefs to shoot, creator-content concepts to vet, GIFs to approve. Nothing here reaches a page, a review or an ad until you approve it.</p></div>
    <span class="tag ${pending.length ? 'warn' : 'ok'}">${pending.length} waiting</span></div>
  <div class="grid2"><div>
    <div class="card" id="queue"><h2>The queue</h2>${queue.length ? queue.map(item).join('') : '<p class="muted" style="font-size:12.5px">Nothing queued. Use the forms on the right.</p>'}</div>
    <div class="card" id="photos"><h2>Product photos against the briefs</h2>
      <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">${PHOTO_BRIEFS.map((brief) => e(brief.name)).join(' · ')}. Label an image with the shot it is, under Media on the product.</p>
      <table class="data"><thead><tr><th>Product</th><th>Have</th><th>Missing</th><th></th></tr></thead><tbody>${coverage.map(({ product, have, missing }) => `<tr><td>${e(product.title)}</td><td>${have.map((brief) => `<span class="tag ok">${e(brief.id)}</span>`).join(' ') || '—'}</td><td>${missing.map((brief) => `<span class="tag">${e(brief.id)}</span>`).join(' ') || '<span class="tag ok">complete</span>'}</td>
        <td style="text-align:right"><form method="post" action="/admin/creative/briefs"><input type="hidden" name="productId" value="${e(product.id)}"><button class="btn" type="submit" style="font-size:11px" ${missing.length ? '' : 'disabled'}>Queue the briefs</button></form></td></tr>`).join('') || '<tr><td colspan="4" class="muted">No products yet.</td></tr>'}</tbody></table></div>
  </div><div>
    <div class="card"><h2>Creator-content concepts</h2><p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Three concepts for a real creator or customer to film, written to an avatar. They are vetted here and only ever become ad briefs.</p>
      <form method="post" action="/admin/creative/ugc"><div class="field"><label>Product</label><select name="productId">${productOptions(ctx)}</select></div><div class="field"><label>Avatar</label><select name="avatarId">${avatarOpts}</select></div><button class="btn primary" type="submit">Write three concepts</button></form></div>
    <div class="card"><h2>Make a GIF</h2><p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">The product's renders and PNG images, in order, as one looping GIF. It waits here for approval, then joins the product's media.</p>
      <form method="post" action="/admin/creative/gif"><div class="field"><label>Product</label><select name="productId">${productOptions(ctx)}</select></div><div class="row"><div class="field" style="flex:1"><label>Frame delay (hundredths of a second)</label><input name="delay" value="70"></div><div class="field" style="flex:1"><label>Longest side (px)</label><input name="maxSide" value="480"></div></div><button class="btn primary" type="submit">Make it</button></form></div>
  </div></div>`
}

/* ------------------------------------------------------- store designer cards */

export function popupCard(ctx: Ctx): string {
  const draft = environment(ctx.db, ctx.store.id, 'draft')
  const popup = { ...DEFAULT_POPUP, ...(draft.theme.popup ?? {}) }
  return `<div class="card" id="popup"><h2>Popup</h2><p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">One popup, on exit intent, after a delay or at a scroll depth. It offers one thing: an email for a code, the deal itself, or the quiz. Says how long the code is good for. Dismissed for the days you set; never over the buy box on a phone; never on the checkout.</p>
    <form method="post" action="/admin/popup">
      <label class="row" style="font-size:12px;margin-bottom:.6rem"><input type="checkbox" name="enabled" value="true" ${popup.enabled ? 'checked' : ''}> Show the popup</label>
      <div class="row"><div class="field" style="flex:1"><label>Trigger</label><select name="trigger">${(['exit', 'delay', 'scroll'] as const).map((trigger) => `<option ${trigger === popup.trigger ? 'selected' : ''}>${trigger}</option>`).join('')}</select></div>
        <div class="field" style="flex:1"><label>After (seconds for delay, percent for scroll)</label><input name="after" value="${popup.after}"></div>
        <div class="field" style="flex:1"><label>Dismiss for (days)</label><input name="dismissDays" value="${popup.dismissDays}"></div></div>
      <div class="field"><label>What it offers</label><select name="kind">${([['email', 'An email for a code (the welcome popup)'], ['offer', 'The deal itself: the code and a button to the buy box'], ['quiz', 'The quiz: a button to the quiz page']] as const).map(([kind, label]) => `<option value="${kind}" ${(popup.kind ?? 'email') === kind ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label>Headline</label><input name="headline" value="${e(popup.headline)}"></div>
      <div class="field"><label>Text</label><input name="text" value="${e(popup.text)}"></div>
      <div class="row"><div class="field" style="flex:1"><label>Code to hand over (optional)</label><input name="code" value="${e(popup.code)}" placeholder="WELCOME10"></div><div class="field" style="flex:1"><label>Button</label><input name="buttonLabel" value="${e(popup.buttonLabel)}"></div></div>
      <div class="row"><div class="field" style="flex:1"><label>Button goes to (offer and quiz kinds)</label><input name="href" value="${e(popup.href ?? '#offer')}" placeholder="#offer or /pages/quiz"></div><div class="field" style="flex:1"><label>Valid for (days; 0 says nothing)</label><input name="validDays" value="${popup.validDays ?? 0}"></div></div>
      <div class="field"><label>Image at the top (optional URL)</label><input name="image" value="${e(popup.image ?? '')}"></div>
      <button class="btn primary" type="submit">Save to draft</button></form></div>`
}

export function legalCard(ctx: Ctx): string {
  const legal = legalFor(ctx.db, ctx.store)
  return `<div class="card" id="legal"><h2>Privacy policy and terms</h2><p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Generated from how the store is set up: the processors in use, the analytics, the returns window, the guarantee, subscriptions, the shipping threshold. Fill in who you are; the rest tracks the store. <a href="${e(ctx.storeUrl)}/pages/privacy" target="_blank" rel="noopener">Privacy ↗</a> · <a href="${e(ctx.storeUrl)}/pages/terms" target="_blank" rel="noopener">Terms ↗</a></p>
    <form method="post" action="/admin/legal">
      <div class="row"><div class="field" style="flex:1"><label>Legal name</label><input name="company" value="${e(legal.company)}"></div><div class="field" style="flex:1"><label>Contact email</label><input name="email" value="${e(legal.email)}" type="email"></div></div>
      <div class="row"><div class="field" style="flex:2"><label>Address</label><input name="address" value="${e(legal.address)}"></div><div class="field" style="flex:1"><label>Country</label><input name="country" value="${e(legal.country)}"></div></div>
      <div class="row"><div class="field" style="flex:1"><label>Returns window (days)</label><input name="returnsDays" value="${legal.returnsDays}"></div><div class="field" style="flex:1"><label>Guarantee (days)</label><input name="guaranteeDays" value="${legal.guaranteeDays}"></div></div>
      <div class="field"><label>Extra privacy paragraphs</label><textarea name="privacyExtra" rows="2">${e(legal.privacyExtra)}</textarea></div>
      <div class="field"><label>Extra terms paragraphs</label><textarea name="termsExtra" rows="2">${e(legal.termsExtra)}</textarea></div>
      <button class="btn primary" type="submit">Save</button></form></div>`
}

export function healthCard(ctx: Ctx, run: boolean): string {
  if (!run) return `<div class="card" id="health"><h2>Accessibility and speed</h2><p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Renders the home page, the product pages and every published page as a visitor gets them and checks landmarks, alt text, labels, headings, focus, contrast, weight, scripts, fonts and lazy loading.</p><a class="btn primary" href="/admin/store?health=1#health">Run the report</a></div>`
  const report = auditStore(ctx.db, ctx.store)
  return `<div class="card" id="health"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Accessibility and speed</h2><span class="row" style="gap:.4rem"><span class="tag">${report.environment === 'live' ? 'live site' : 'draft'}</span><span class="tag ${report.score >= 90 ? 'ok' : report.score >= 70 ? 'warn' : 'bad'}">score ${report.score}</span></span></div>
    <p class="muted" style="font-size:11.5px;margin:.3rem 0 0">${report.environment === 'live' ? 'Rendered from the live environment — what customers are looking at now, not the draft you are editing.' : 'This store has never been published, so the draft is what is audited.'}</p>
    ${report.pages.map((page) => `<details style="border-top:1px solid var(--line);margin-top:.5rem" ${page.issues.length ? 'open' : ''}><summary style="cursor:pointer;padding:.4rem 0;font-size:13px"><span class="tag ${page.score >= 90 ? 'ok' : page.score >= 70 ? 'warn' : 'bad'}">${page.score}</span> <strong>${e(page.title)}</strong> <span class="muted">${e(page.path)} · ${Math.round(page.gzipBytes / 1024)}KB on the wire (${Math.round(page.bytes / 1024)}KB raw) · ${page.metrics.images} images, ${page.metrics.lazyImages} lazy · ${page.metrics.externalScripts} external scripts · ${page.metrics.h1s} h1</span></summary>
      ${page.issues.length ? `<ul style="margin:.3rem 0 .6rem;padding-left:1.1rem;font-size:12.5px">${page.issues.map((issue) => `<li><span class="tag ${issue.severity === 'error' ? 'bad' : 'warn'}">${issue.check}</span> ${e(issue.detail)}</li>`).join('')}</ul>` : '<p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Nothing to fix.</p>'}</details>`).join('')}
    <a class="btn" href="/admin/store?health=1#health" style="margin-top:.6rem">Run again</a></div>`
}

/* --------------------------------------------------------- analytics card */

const DAYS_IN: Record<Range, number> = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 }

/**
 * A page's revenue per session only means something against what its traffic
 * cost, so the cost per click over the same window rides along and each page
 * is called against it rather than left as a bare number.
 */
function cpcFor(ctx: Ctx, range: Range): number | null {
  return profitReport(ctx.db, ctx.store.id, DAYS_IN[range]).cpcCents
}

export function behaviourCard(ctx: Ctx, range: Range): string {
  const report = behaviour(ctx.db, ctx.store.id, range)
  const cpc = cpcFor(ctx, range)
  const against = (perSession: number) =>
    cpc === null ? '' : `<span class="tag ${perSession > cpc ? 'ok' : 'bad'}" style="margin-left:.3rem">${perSession > cpc ? 'above' : 'below'} CPC</span>`
  const bar = (label: string, value: number, of: number) => `<div class="barrow"><span>${e(label)}</span><span class="track"><span class="fill" style="width:${of ? Math.min(100, (value / of) * 100).toFixed(1) : 0}%"></span></span><span>${value}</span></div>`
  return `<div class="grid2"><div class="card"><h2>What visitors did</h2>
    <div class="eyebrow" style="margin-top:.6rem">Scroll depth (sessions reaching)</div><div class="bars" style="margin-top:.4rem">${([25, 50, 75, 100] as const).map((depth) => bar(`${depth}%`, report.scroll[depth], report.sessions)).join('')}</div>
    <div class="eyebrow" style="margin-top:.8rem">Buttons pressed</div><table class="data" style="margin-top:.3rem"><tbody>${report.ctas.slice(0, 8).map((cta) => `<tr><td>${e(cta.label || '(no label)')}</td><td class="muted">${e(cta.path)}</td><td style="text-align:right">${cta.clicks}</td></tr>`).join('') || '<tr><td class="muted">No clicks recorded yet.</td></tr>'}</tbody></table>
    <p class="muted" style="font-size:12px;margin:.6rem 0 0">Popup: shown to ${report.popup.shows}, ${report.popup.submits} signed up.${report.quiz.length ? ` Quiz: ${report.quiz.map((step) => `step ${step.step}: ${step.count}`).join(', ')}; ${report.quiz[0]?.completes ?? 0} finished.` : ''}</p></div>
  <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Per page</h2><p class="muted" style="font-size:12px;margin:.2rem 0 0">Revenue per session is AOV × conversion: the number a split test is decided on, and it is decided against the cost of the click. ${cpc === null ? 'Log clicks with your ad spend on the Profit page and each row gets called here.' : `Cost per click over this window: <strong>${format(cpc, ctx.store.currency)}</strong>.`}</p></div>
    <table class="data"><thead><tr><th>Page</th><th>Sessions</th><th>Read half</th><th>CTA</th><th>Carts</th><th>Bought</th><th>Rev / session</th></tr></thead><tbody>${report.pages.slice(0, 12).map((page) => `<tr><td class="muted">${e(page.path)}</td><td>${page.sessions}</td><td>${page.sessions ? Math.round((page.readHalf / page.sessions) * 100) : 0}%</td><td>${page.ctaClicks}</td><td>${page.carts}</td><td>${page.purchases}</td><td>${format(page.revenuePerSessionCents, ctx.store.currency)}${page.sessions ? against(page.revenuePerSessionCents) : ''}</td></tr>`).join('') || '<tr><td colspan="7" class="muted" style="padding:1.2rem">No page views yet.</td></tr>'}</tbody></table></div></div>
  ${report.sections.length ? `<div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Sections seen</h2></div><table class="data"><thead><tr><th>Page</th><th>Section</th><th>Sessions</th></tr></thead><tbody>${report.sections.slice(0, 16).map((section) => `<tr><td class="muted">${e(section.path)}</td><td>${e(section.blockType)} <span class="muted" style="font-size:11px">${e(section.blockId)}</span></td><td>${section.views}</td></tr>`).join('')}</tbody></table></div>` : ''}`
}

/* ------------------------------------------------------------ funnel tests */

export function funnelTestCard(ctx: Ctx): string {
  const groups = funnelGroups(ctx.db, ctx.store.id)
  const cpc = profitReport(ctx.db, ctx.store.id, 30).cpcCents
  if (!groups.length) return `<div class="card"><h2>Funnel split tests</h2><p class="muted" style="font-size:12.5px">Give two or more funnels the same test group name and a weight, then send traffic to <code>${e(ctx.storeUrl)}/go/&lt;group&gt;</code>. Each visitor is assigned one funnel and followed to the order.</p></div>`
  return groups.map((group) => {
    const stats = funnelStats(ctx.db, ctx.store.id, group)
    // /go/<group> picks among active funnels with a weight above zero, and a
    // new funnel's weight defaults to 0 — so the obvious path, naming two
    // funnels into a group and copying the entry URL this card prints into an
    // ad, produced a URL that answers "No funnel is running under that name"
    // with nothing here saying why.
    const running = stats.filter((row) => row.weight > 0).length
    return `<div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Test group “${e(group)}”</h2><p class="muted" style="font-size:12px;margin:.2rem 0 0">${
      running ? `Entry: <code>${e(ctx.storeUrl)}/go/${e(group)}</code>` : `<strong>Not running.</strong> Every funnel in this group is at weight 0, so <code>${e(ctx.storeUrl)}/go/${e(group)}</code> answers with nothing. Give at least one of them a weight.`
    }${cpc === null ? ' · log clicks with your ad spend to compare these against cost per click' : ` · winning means revenue per session above the ${format(cpc, ctx.store.currency)} it costs to buy one`}</p></div>
      <table class="data"><thead><tr><th>Funnel</th><th>Weight</th><th>Sessions</th><th>Carts</th><th>Orders</th><th>Revenue</th><th>Rev / session</th></tr></thead><tbody>${stats.map((row) => `<tr><td>${e(row.name)}</td><td>${row.weight}</td><td>${row.sessions}</td><td>${row.carts}</td><td>${row.purchases}</td><td>${format(row.revenueCents, ctx.store.currency)}</td><td><strong>${format(row.revenuePerSessionCents, ctx.store.currency)}</strong>${cpc !== null && row.sessions ? ` <span class="tag ${row.revenuePerSessionCents > cpc ? 'ok' : 'bad'}">${row.revenuePerSessionCents > cpc ? 'above' : 'below'} CPC</span>` : ''}</td></tr>`).join('')}</tbody></table></div>`
  }).join('')
}

/* ------------------------------------------------------------- pages hub */

export function ripCard(ctx: Ctx): string {
  const avatars = listAvatars(ctx.db, ctx.store.id)
  return `<form method="post" action="/admin/pages/rip" class="card" id="rip"><h2>Copy a funnel's structure</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Paste a page that sells. Its section order comes back as blocks for your product; none of its words and none of its images do. Keep its angle and the copy sells the same reason to buy in your words; drop it and the copy follows your direction.</p>
    <div class="field"><label>URL</label><input name="url" type="url" placeholder="https://competitor.com/pages/offer"></div>
    <div class="field"><label>Or paste the page's HTML when the site blocks fetching</label><textarea name="html" rows="2"></textarea></div>
    <div class="row"><div class="field" style="flex:1"><label>Your product</label><select name="productId">${productOptions(ctx)}</select></div>
      <div class="field" style="flex:1"><label>Avatar</label><select name="avatarId"><option value="">— the selected avatar —</option>${avatars.map((avatar) => `<option value="${e(avatar.id)}">${e(avatar.name)}</option>`).join('')}</select></div></div>
    <div class="field"><label>Direction (used when the angle is not kept)</label><input name="direction" placeholder="premium, no hype, for gift buyers"></div>
    <div class="row" style="margin-bottom:.6rem"><label class="row" style="font-size:12px;gap:.3rem"><input type="radio" name="keepAngle" value="true" checked> Keep the angle, change the words and the pictures</label><label class="row" style="font-size:12px;gap:.3rem"><input type="radio" name="keepAngle" value="false"> Keep the structure only, new angle</label></div>
    <button class="btn primary" type="submit">Read it and build the page</button></form>`
}

export function suggestCard(ctx: Ctx): string {
  const avatars = listAvatars(ctx.db, ctx.store.id)
  return `<form method="post" action="/admin/pages/suggest" class="card" id="suggest"><h2>Suggest a layout</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">The block order for a kind of page, chosen for this product and avatar from the catalog, with the job each block does. It lands as a draft to edit.</p>
    <div class="row"><div class="field" style="flex:1"><label>Kind of page</label><select name="goal"><option value="offer">Offer page</option><option value="advertorial">Advertorial</option><option value="quiz">Quiz funnel</option><option value="pdp">Product page</option><option value="science">Science page</option><option value="home">Home</option><option value="checkout">Checkout page</option></select></div>
      <div class="field" style="flex:1"><label>Product</label><select name="productId"><option value="">— none —</option>${productOptions(ctx)}</select></div></div>
    <div class="row"><div class="field" style="flex:1"><label>Avatar</label><select name="avatarId"><option value="">— the selected avatar —</option>${avatars.map((avatar) => `<option value="${e(avatar.id)}">${e(avatar.name)}</option>`).join('')}</select></div>
      <div class="field" style="flex:1"><label>Direction</label><input name="direction" placeholder="urgent, comparison-led"></div></div>
    <button class="btn primary" type="submit">Suggest and create the draft</button></form>`
}
