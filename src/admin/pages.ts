import { discountPage } from './discount-page.ts'
import { productGalleryMedia } from '../pages/product-data.ts'
import { listImports } from '../control/asset-import-jobs.ts'
import { mediaRebrandStyle, rebrandHistory } from './media-rebrand-page.ts'
import { themeEditorPage } from './theme-page.ts'
import { roleOptions } from './library-page.ts'
import { escapeHtml } from '../lib/http.ts'
import { publicStoreUrl } from '../lib/urls.ts'
import { format, minorDigits } from '../lib/money.ts'
import type { Db } from '../lib/db.ts'
import { listCollections, listProducts, lowStock } from '../domain/catalog.ts'
import { listCustomers, segment } from '../domain/customers.ts'
import { listOrders, getOrder } from '../domain/orders.ts'
import { listReviews, statsFor } from '../domain/reviews.ts'
import { listRegions, type Region } from '../domain/regions.ts'
import { environment, type Store } from '../control/stores.ts'
import { listTeam } from '../control/auth.ts'
import { listAudit, listTodos } from '../control/todos.ts'
import { allPlugins, pluginCategories } from '../control/catalog-plugins.ts'
import { listInstalled } from '../control/plugins.ts'
import { catalog, resolvedModels } from '../agent/models.ts'
import { attributionReport, BENCHMARK, funnel, kpis, liveVisitors, recentEvents, revenueSeries } from '../analytics/events.ts'
import { listSends } from '../email/send.ts'
import { TEMPLATES } from '../email/templates.ts'
import { listSeoPages } from '../seo/schema.ts'
import { PROMPT_LIBRARY } from '../agent/chat.ts'
import { listRuns } from '../agent/runtime.ts'
import { latestResearch } from '../agent/research.ts'
import { listPages, type Page, PAGE_TEMPLATES } from '../pages/store.ts'
import { getInstalled, hasCredentials } from '../control/plugins.ts'
import { listAdSpend, listQuestions, marginFor, pendingStockAlerts, profitReport } from '../domain/ops.ts'
import { listFunnels } from '../domain/funnels.ts'
import { versionStats, versionsFor } from '../pages/versions.ts'
import { listExperiments, type Experiment } from '../analytics/experiments.ts'
import { ADVERTORIAL_FORMATS, PDP_FORMATS } from '../agent/directions.ts'
import { salesSummary } from '../domain/orders.ts'
import { listTools, toolCountsByArea } from '../agent/registry.ts'
import { renderArtifact, uiIcon, type IconName } from './shell.ts'
import { avatarOptions, avatarsCard, competitorsCard, regenerateCard } from './growth-pages.ts'
import { behaviourCard, funnelTestCard, healthCard, legalCard, popupCard, ripCard, suggestCard } from './plan-pages.ts'
import { listCustomBlocks, type CustomBlock } from '../pages/custom-blocks.ts'
import type { ChatMessage } from '../agent/chat.ts'
import { seventeenTrackConfigured } from '../shipping/seventeen-track.ts'
import { domainsFor } from '../control/domains.ts'
import { listFlows, recentFlowDeliveries } from '../email/flows.ts'
import { serverEventSummary } from '../analytics/server-events.ts'
import { listAssistantQueue } from '../agent/queue.ts'
import { listStoreMedia, storeCoverImage, mediaKind } from '../control/media.ts'
import { listBlogs } from '../domain/content.ts'
import { PHOTO_BRIEFS, shotOf } from '../creative/briefs.ts'
import { qualifyCatalogProduct, readQualifyNotes } from '../domain/qualify.ts'
import { fontFamiliesFromClone, fontFamilyName } from '../control/assets.ts'

type Ctx = { db: Db; store: Store; userName: string; userId?: string; userEmail?: string; storeUrl: string; flash?: string }

const pct = (value: number) => `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`

function textModelOptions(): string {
  return `<option value="">Store default</option>${catalog().map((entry) => `<option value="${entry.provider}:${escapeHtml(entry.model)}" ${entry.available ? '' : 'disabled'}>${escapeHtml(entry.name)}${entry.available ? '' : ' (no key)'}</option>`).join('')}`
}

function kpiRow(ctx: Ctx, range: '24h' | '7d' | '30d' | '90d') {
  const stats = kpis(ctx.db, ctx.store.id, range)
  const currency = ctx.store.currency
  const tiles: Array<[string, string, number]> = [
    ['Sessions', String(stats.sessions), stats.deltas.sessions ?? 0],
    ['Total sales', format(stats.revenueCents, currency), stats.deltas.revenueCents ?? 0],
    ['Orders', String(stats.orders), stats.deltas.orders ?? 0],
    ['Conversion rate', `${(stats.conversionRate * 100).toFixed(2)}%`, stats.deltas.conversionRate ?? 0],
    ['AOV', format(stats.aovCents, currency), stats.deltas.aovCents ?? 0],
  ]
  return `<div class="kpis">${tiles
    .map(
      ([label, value, delta]) => `<div class="kpi"><div class="label">${label}</div><div class="value">${escapeHtml(value)}</div>
        <div class="delta ${delta < 0 ? 'neg' : ''}">${pct(delta)}</div></div>`,
    )
    .join('')}</div>`
}

function flash(ctx: Ctx): string {
  return ctx.flash ? `<div class="notice flash${ctx.flash.startsWith('!') ? ' bad' : ''}" style="margin-bottom:1rem">${escapeHtml(ctx.flash.replace(/^!/, ''))}</div>` : ''
}

/* ------------------------------------------------------------------ dashboard */

export function dashboard(ctx: Ctx, range: '24h' | '7d' | '30d' | '90d'): string {
  const noun = ctx.store.kind === 'funnel' ? 'Funnel' : 'Store'
  const storefrontUrl = ctx.store.status === 'live' ? ctx.storeUrl : `/preview/${ctx.store.slug}`
  const days = range === '24h' ? 2 : range === '7d' ? 7 : range === '30d' ? 30 : 90
  const series = revenueSeries(ctx.db, ctx.store.id, days)
  const stats = kpis(ctx.db, ctx.store.id, range)
  const profit = profitReport(ctx.db, ctx.store.id, days)
  const stages = funnel(ctx.db, ctx.store.id, range)
  const live = liveVisitors(ctx.db, ctx.store.id, 30) as Array<{ city: string; country: string; path: string }>
  const orders = listOrders(ctx.db, ctx.store.id, { limit: 8 })
  const allOrders = listOrders(ctx.db, ctx.store.id, { limit: 500 })
  const low = lowStock(ctx.db, ctx.store.id, 5) as Array<{ product_title: string; title: string; inventory: number }>
  const products = listProducts(ctx.db, ctx.store.id, { limit: 1000, includeHidden: true })
  const runningExperiments = listExperiments(ctx.db, ctx.store.id).filter((entry) => ['running', 'ready', 'paused'].includes(entry.status))
  const todos = listTodos(ctx.db, ctx.store.id).filter((entry) => entry.status !== 'done').slice(0, 4)
  const pendingOrders = allOrders.filter((order) => order.status !== 'cancelled' && order.fulfillmentStatus === 'unfulfilled').length
  const tiles: Array<[string, string, number, IconName]> = [
    ['Total sales', format(stats.revenueCents, ctx.store.currency), stats.deltas.revenueCents ?? 0, 'profit'],
    ['Orders', String(stats.orders), stats.deltas.orders ?? 0, 'orders'],
    ['Visitors', String(stats.sessions), stats.deltas.sessions ?? 0, 'customers'],
    ['Conversion rate', `${(stats.conversionRate * 100).toFixed(2)}%`, stats.deltas.conversionRate ?? 0, 'funnel'],
    ['Average order', format(stats.aovCents, ctx.store.currency), stats.deltas.aovCents ?? 0, 'analytics'],
  ]
  return `${flash(ctx)}
  <div class="dash-head"><div><div class="store-state"><i></i>${ctx.store.status === 'live' ? `${noun} is live` : `Draft ${noun.toLowerCase()}`}</div><h1>Hello ${escapeHtml(ctx.userName)} — here’s what’s happening.</h1>
      <p class="muted">${escapeHtml(ctx.store.name)} · ${products.filter((product) => product.status === 'published').length} published products</p></div>
    <div class="dash-actions"><a class="btn" href="${ctx.store.kind === 'funnel' ? '/admin/funnels' : '/admin/store'}">${ctx.store.kind === 'funnel' ? 'Edit funnel flow' : 'Customize store'}</a><a class="btn" href="${escapeHtml(storefrontUrl)}" target="_blank" rel="noopener">${ctx.store.status === 'live' ? 'View' : 'Preview'} ${noun.toLowerCase()} ↗</a><form method="get"><select name="range" onchange="this.form.submit()" aria-label="Reporting range">
      ${(['24h', '7d', '30d', '90d'] as const).map((option) => `<option value="${option}" ${option === range ? 'selected' : ''}>Last ${option}</option>`).join('')}
    </select></form></div></div>
  <div class="commerce-kpis">${tiles.map(([label, value, delta, icon]) => `<div class="metric-card"><div class="label"><span>${label}</span>${uiIcon(icon, 16)}</div><div class="value">${escapeHtml(value)}</div><div class="delta ${delta < 0 ? 'neg' : ''}">${pct(delta)} vs previous period</div></div>`).join('')}</div>
  <div class="dashboard-grid"><div class="card dash-card"><div class="dash-card-head"><div><h2>Total sales</h2><div class="dash-total">${format(stats.revenueCents, ctx.store.currency)}</div><div class="muted" style="font-size:11px">${stats.orders} orders · net profit ${format(profit.profitCents, ctx.store.currency)}</div></div><a class="btn" href="/admin/analytics">View report</a></div>${salesChart(series)}<div class="chart-labels"><span>${series[0]?.day ?? ''}</span><span>${series[Math.floor(series.length / 2)]?.day ?? ''}</span><span>${series.at(-1)?.day ?? ''}</span></div></div>
    <div class="card dash-card pulse-card"><div class="eyebrow" style="color:#bcd4f2">Store pulse</div><div class="row" style="justify-content:space-between;align-items:flex-end;margin-top:.75rem"><div><div class="pulse-number">${live.length}</div><div class="muted">visitors right now</div></div>${uiIcon('analytics', 23)}</div><div class="pulse-list"><a href="/admin/orders"><span>Orders to fulfill</span><strong>${pendingOrders}</strong></a><a href="/admin/cro"><span>Active experiments</span><strong>${runningExperiments.length}</strong></a><a href="/admin/products"><span>Low-stock variants</span><strong>${low.length}</strong></a></div></div></div>
  <div class="dash-row"><div class="card dash-card"><div class="dash-card-head"><div><h2>Conversion funnel</h2><p class="muted" style="font-size:11.5px;margin:.2rem 0 0">From first visit through purchase</p></div><a class="btn" href="/admin/cro">Run an experiment</a></div><div class="funnel-compact">${stages.map((stage) => `<div class="funnel-line"><span>${escapeHtml(stage.stage)}</span><div class="track"><i style="width:${Math.max(stage.count ? 2 : 0, stage.share * 100)}%"></i></div><strong>${stage.count}</strong></div>`).join('')}</div></div>
    <div class="card dash-card"><div class="dash-card-head"><h2>Next things to do</h2><a href="/admin/build" class="muted" style="font-size:11px">See plan</a></div><div class="pulse-list" style="margin-top:.55rem">${todos.length ? todos.map((todo) => `<a href="/admin${escapeHtml(todo.href)}" style="background:#fafafa;color:var(--ink);border-color:var(--line)"><span>${escapeHtml(todo.label)}</span><strong>→</strong></a>`).join('') : '<div class="dash-empty">Setup is clear. Keep an eye on orders and experiments.</div>'}</div></div></div>
  <div class="dash-row"><div class="card dash-card"><div class="dash-card-head"><h2>Recent orders</h2><a class="btn" href="/admin/orders">View all</a></div><div class="order-list">${orders.length ? orders.slice(0, 6).map((order) => `<a class="order-item" href="/admin/orders/${escapeHtml(order.id)}"><span class="order-badge">#${order.displayId}</span><span><strong>${escapeHtml(order.email)}</strong><small>${order.items.length} item${order.items.length === 1 ? '' : 's'} · ${order.createdAt.slice(0, 10)}</small></span><span style="text-align:right"><strong>${format(order.totalCents, order.currency)}</strong><small>${escapeHtml(order.fulfillmentStatus)}</small></span></a>`).join('') : '<div class="dash-empty">No orders yet. Your first one will appear here.</div>'}</div></div>
    <div class="card dash-card"><h2>Quick actions</h2><div class="quick-grid"><a href="/admin/products">${uiIcon('products', 17)}<strong>Add product</strong></a><a href="/admin/pages">${uiIcon('pages', 17)}<strong>Build page</strong></a><a href="/admin/ads">${uiIcon('ads', 17)}<strong>Draft ads</strong></a><a href="/admin/cro">${uiIcon('experiment', 17)}<strong>Test pages</strong></a></div>${runningExperiments[0] ? `<div class="notice" style="margin-top:.75rem"><strong>${escapeHtml(runningExperiments[0].name)}</strong><div class="muted" style="font-size:11px">${escapeHtml(runningExperiments[0].results.reason ?? 'Collecting evidence')}</div></div>` : ''}</div></div>
`
}

function salesChart(series: Array<{ day: string; revenue: number; orders: number }>): string {
  const width = 760
  const height = 170
  const pad = 8
  const peak = Math.max(1, ...series.map((point) => point.revenue))
  const points = series.map((point, index) => {
    const x = pad + (index / Math.max(1, series.length - 1)) * (width - pad * 2)
    const y = height - pad - (point.revenue / peak) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const firstX = points[0]?.split(',')[0] ?? String(pad)
  const lastX = points.at(-1)?.split(',')[0] ?? String(width - pad)
  return `<svg class="sales-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Sales over time"><defs><linearGradient id="sales-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5b8fd9" stop-opacity=".28"/><stop offset="1" stop-color="#5b8fd9" stop-opacity="0"/></linearGradient></defs>${[32, 72, 112, 152].map((y) => `<line class="gridline" x1="0" y1="${y}" x2="${width}" y2="${y}"/>`).join('')}<path class="area" d="M ${firstX} ${height} L ${points.join(' L ')} L ${lastX} ${height} Z"/><polyline class="line" points="${points.join(' ')}"/></svg>`
}

/* --------------------------------------------------------------- experiments */

export function experimentsPage(ctx: Ctx): string {
  const products = listProducts(ctx.db, ctx.store.id, { status: 'published', limit: 100 })
  const experiments = listExperiments(ctx.db, ctx.store.id)
  const productById = new Map(products.map((product) => [product.id, product]))
  return `${flash(ctx)}<div class="head"><div><div class="eyebrow">Autonomous CRO</div><h1 class="serif">A/B tests</h1>
    <p class="muted" style="margin:.25rem 0 0;max-width:720px">Stable visitor assignment, Bayesian decisions, and guardrails against small-sample winners. A winner can promote itself; every promotion keeps the exact previous traffic split for rollback.</p></div></div>
  <div class="grid2"><div>
    ${experiments.length ? experiments.map((experiment) => experimentCard(ctx, experiment, productById.get(experiment.surface.slice(4))?.handle)).join('') : `<div class="card cro-empty"><div class="cro-orb">◒</div><h2>No experiments running</h2><p class="muted">Generate a few product-page angles below. Traffic stays on the same version for each visitor, and storemill waits for enough purchases before choosing.</p></div>`}
  </div><div>
    <form method="post" action="/admin/cro/generate" class="card cro-launch"><div class="eyebrow">New experiment</div><h2>Generate and test page angles</h2>
      <div class="field" style="margin-top:.8rem"><label>Product</label><select name="productId" required><option value="">Choose a product</option>${products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.title)}</option>`).join('')}</select></div>
      <div class="field"><label>Hypothesis</label><textarea name="hypothesis" rows="3" placeholder="A benefit-led page will convert better than a story-led page."></textarea></div>
      <div class="field"><label>Text model for this generation</label><select name="model">${textModelOptions()}</select></div>
      <div class="row"><div class="field" style="flex:1"><label>Versions</label><select name="count"><option value="2">2 versions</option><option value="3" selected>3 versions</option><option value="4">4 versions</option></select></div>
        <div class="field" style="flex:1"><label>Minimum views / version</label><input type="number" name="minViews" value="75" min="25" step="25"></div></div>
      <label class="row cro-check"><input type="checkbox" name="autoPromote" value="true" checked><span><strong>Auto-promote a winner</strong><small>Only after ≥95% probability to win, the minimum traffic, and enough purchases.</small></span></label>
      <button class="btn primary" type="submit" ${products.length ? '' : 'disabled'}>Generate versions &amp; start test</button>
      ${products.length ? '' : '<p class="muted" style="font-size:12px">Publish a product first.</p>'}</form>
    <div class="card"><h2>How decisions work</h2><div class="cro-rule"><b>1</b><span><strong>Split</strong><small>Visitors are deterministically assigned, so they never bounce between page angles.</small></span></div><div class="cro-rule"><b>2</b><span><strong>Learn</strong><small>Each purchase updates a Beta-Bernoulli posterior instead of trusting a noisy point estimate.</small></span></div><div class="cro-rule"><b>3</b><span><strong>Promote or roll back</strong><small>The winner gets 100% traffic. One click restores the exact prior weights.</small></span></div></div>
  </div></div>`
}

function experimentCard(ctx: Ctx, experiment: Experiment, productHandle?: string): string {
  const rows = experiment.results.variants ?? []
  const winner = rows.find((entry) => entry.pageId === experiment.results.winnerId)
  const statusClass = experiment.status === 'promoted' ? 'ok' : experiment.status === 'ready' ? 'warn' : experiment.status === 'rolled_back' ? '' : 'live'
  return `<div class="card cro-card"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><span class="tag ${statusClass}">${experiment.status.replace('_', ' ')}</span><h2 style="margin-top:.5rem">${escapeHtml(experiment.name)}</h2><p class="muted" style="font-size:12px;margin:.2rem 0 0">${escapeHtml(experiment.hypothesis)}</p></div><div class="cro-actions">
    ${['running', 'ready', 'paused'].includes(experiment.status) ? `<form method="post" action="/admin/cro/${escapeHtml(experiment.id)}/evaluate"><button class="btn" type="submit">Recalculate</button></form><form method="post" action="/admin/cro/${escapeHtml(experiment.id)}/pause"><button class="btn" type="submit">${experiment.status === 'paused' ? 'Resume' : 'Pause'}</button></form>` : ''}
    ${experiment.status === 'ready' && winner ? `<form method="post" action="/admin/cro/${escapeHtml(experiment.id)}/promote"><button class="btn primary" type="submit">Promote winner</button></form>` : ''}
    ${experiment.status === 'promoted' ? `<form method="post" action="/admin/cro/${escapeHtml(experiment.id)}/rollback"><button class="btn" type="submit">Roll back</button></form>` : ''}</div></div>
    ${rows.length ? `<div class="cro-variants">${rows.map((row) => `<div class="cro-variant ${row.pageId === experiment.results.winnerId ? 'leader' : ''}"><div class="row" style="justify-content:space-between"><strong>${escapeHtml(row.title.replace(/^[^—]+—\s*/, ''))}</strong><span>${(row.probabilityBest * 100).toFixed(1)}% to win</span></div><div class="prob"><i style="width:${Math.max(1, row.probabilityBest * 100)}%"></i></div><div class="cro-metrics"><span><b>${row.views}</b> visits</span><span><b>${row.purchases}</b> orders</span><span><b>${(row.conversion * 100).toFixed(1)}%</b> CVR</span><span class="${row.upliftVsControl >= 0 ? 'up' : 'down'}"><b>${pct(row.upliftVsControl)}</b> vs control</span></div>${productHandle ? `<a href="${escapeHtml(ctx.storeUrl)}/products/${escapeHtml(productHandle)}?version=${escapeHtml(row.pageId)}" target="_blank" rel="noopener">Preview ↗</a>` : ''}</div>`).join('')}</div>` : `<p class="muted" style="font-size:12px;margin-top:.8rem">No observations yet. Recalculate after traffic arrives.</p>`}
    <div class="cro-foot"><span>${escapeHtml(experiment.results.reason ?? `Waiting for ${experiment.results.minViews} views per version.`)}</span>${winner ? `<strong>Leader: ${escapeHtml(winner.title.replace(/^[^—]+—\s*/, ''))}</strong>` : ''}</div></div>`
}

/* ------------------------------------------------------------------- products */

export function productsPage(ctx: Ctx, status: string, search: string): string {
  const products = listProducts(ctx.db, ctx.store.id, { status, ...(search ? { search } : {}), limit: 200 })
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Products</h1>
    <p class="muted" style="margin:.25rem 0 0">${products.length} shown</p></div>
    <form method="get" class="row"><input aria-label="Search" name="search" value="${escapeHtml(search)}" placeholder="Search" style="width:200px">
      <input type="hidden" name="status" value="${escapeHtml(status)}"><button class="btn" type="submit">Search</button></form></div>
  <form method="post" action="/admin/products/import" class="card row" style="align-items:flex-end">
    <div class="field" style="flex:2;margin:0"><label>Import a product from a URL — any Shopify store's product page, or a supplier page with Open Graph tags</label><input name="url" type="url" required placeholder="https://some-store.com/products/the-thing"></div>
    <div class="field" style="width:120px;margin:0"><label>Markup ×</label><input name="markup" value="2.5"></div>
    <label class="row" style="font-size:12px;margin:0 .5rem .6rem"><input type="checkbox" name="asSupplier" value="true" checked> Their price is my cost</label>
    <button class="btn primary" type="submit">Import</button></form>
  <div class="tabs">${['all', 'published', 'draft', 'archived']
    .map((option) => `<a class="${option === status ? 'on' : ''}" href="/admin/products?status=${option}">${option[0]?.toUpperCase()}${option.slice(1)}</a>`)
    .join('')}</div>
  <div class="card" style="padding:0">
  <table class="data"><thead><tr><th></th><th>Product</th><th>Status</th><th>Inventory</th><th>Price</th><th></th></tr></thead><tbody>
  ${products.length ? products
      .map((product) => {
        const stock = product.variants.reduce((sum, variant) => sum + variant.inventory, 0)
        const from = Math.min(...product.variants.map((variant) => variant.priceCents))
        return `<tr><td style="width:52px">${product.heroImage ? `<img src="${escapeHtml(product.heroImage)}" alt="">` : ''}</td>
          <td><a href="/admin/products/${escapeHtml(product.id)}" style="text-decoration:none">${escapeHtml(product.title)}</a>
            <div class="muted" style="font-size:11.5px">${product.variants.length} variants</div></td>
          <td><span class="tag ${product.status === 'published' ? 'ok' : ''}">${product.status}</span></td>
          <td>${stock}</td><td>${format(from, ctx.store.currency)}</td>
          <td style="text-align:right"><a class="btn" href="/admin/products/${escapeHtml(product.id)}">Open</a></td></tr>`
      })
      .join('') : '<tr><td colspan="6" class="muted" style="padding:1.4rem">Nothing here. Ask the assistant to add a product.</td></tr>'}
  </tbody></table></div>`
}

export function productDetail(ctx: Ctx, productId: string): string {
  const product = listProducts(ctx.db, ctx.store.id, { limit: 300 }).find((entry) => entry.id === productId)
  if (!product) return '<p class="muted">No such product.</p>'
  const stats = statsFor(ctx.db, ctx.store.id, product.id)
  const media = productGalleryMedia(product)
  return `${flash(ctx)}<div class="head"><div><div class="eyebrow"><a href="/admin/products" style="text-decoration:none">Products</a> / ${escapeHtml(product.status)}</div>
    <h1 class="serif">${escapeHtml(product.title)}</h1></div>
    <a class="btn" href="${escapeHtml(ctx.storeUrl)}/products/${escapeHtml(product.handle)}" target="_blank" rel="noopener">View on the storefront ↗</a></div>
  <div class="grid2"><div>
    <div class="card"><h2>Details</h2>
      <form method="post" action="/admin/products/${escapeHtml(product.id)}">
        <div class="field"><label>Title</label><input name="title" value="${escapeHtml(product.title)}"></div>
        <div class="field"><label>Subtitle</label><input name="subtitle" value="${escapeHtml(product.subtitle)}"></div>
        <div class="field"><label>Description</label><textarea name="description" rows="8">${escapeHtml(product.description)}</textarea></div>
        <div class="field"><label>Status</label><select name="status">${['draft', 'published', 'archived']
          .map((option) => `<option ${option === product.status ? 'selected' : ''}>${option}</option>`)
          .join('')}</select></div>
        <button class="btn primary" type="submit">Save</button></form></div>
    <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Variants</h2></div>
      <table class="data"><thead><tr><th>Variant</th><th>SKU</th><th>Price</th><th>Stock</th><th></th></tr></thead><tbody>
      ${product.variants
        .map(
          (variant) => `<tr><td>${escapeHtml(variant.title)}</td><td class="muted">${escapeHtml(variant.sku)}</td>
        <td><form method="post" action="/admin/variants/${escapeHtml(variant.id)}" class="row">
          <input name="priceCents" value="${variant.priceCents}" style="width:96px">
          <input name="inventory" value="${variant.inventory}" style="width:72px">
          <button class="btn" type="submit">Set</button></form></td>
        <td>${variant.inventory}</td><td class="muted" style="font-size:11.5px">${escapeHtml(Object.values(variant.optionValues).join(' / '))}</td></tr>`,
        )
        .join('')}</tbody></table></div>
  </div>
  <div>
    <div class="card" data-product-media><h2>Product media <span class="muted">(${media.length})</span></h2>
      <p class="muted" style="font-size:12px;margin:.4rem 0">All gallery files, in order. Open a file to view it at full size.</p>
      <div class="grid3" style="grid-template-columns:repeat(auto-fit,minmax(min(180px,100%),1fr));margin-top:.8rem;align-items:start">
      ${media.map((entry,index) => `<figure data-product-media-item style="margin:0;min-width:0">${(entry.kind||mediaKind(entry.url))==='video'?`<video src="${escapeHtml(entry.url)}" controls playsinline preload="metadata" aria-label="${escapeHtml(entry.alt)}" style="width:100%;border-radius:8px"></video>`:`<a href="${escapeHtml(/^(https?:\/\/|\/(?!\/))/.test(entry.url)?entry.url:'#')}" target="_blank" rel="noopener" aria-label="Open gallery image ${index+1} at full size"><img src="${escapeHtml(entry.url)}" alt="${escapeHtml(entry.alt)}" loading="lazy" style="display:block;width:100%;aspect-ratio:1;object-fit:contain;border-radius:8px;border:1px solid var(--line);background:#f7f7f7"></a>`}<figcaption style="display:flex;justify-content:space-between;gap:.5rem;font-size:12px;margin:.5rem 0"><span>${index+1} of ${media.length}${entry.url===product.heroImage?' · Featured':''}</span><a href="${escapeHtml(/^(https?:\/\/|\/(?!\/))/.test(entry.url)?entry.url:'#')}" target="_blank" rel="noopener">Open file ↗</a></figcaption>${(entry.kind||mediaKind(entry.url))!=='video'?shotPicker(product.id,entry.url,shotOf(entry.alt)):''}</figure>`).join('') || '<p class="muted">No product media yet.</p>'}</div>
      <form method="post" action="/admin/products/${escapeHtml(product.id)}/photo" enctype="multipart/form-data" style="margin-top:.8rem">
        <div class="field"><label>Upload a product photo</label><input type="file" name="photo" accept="image/*" required></div>
        <div class="field"><label>Photo processing</label><select name="preset"><option value="original" selected>Keep original — no changes</option>${['white-seamless', 'lifestyle', 'dark-luxury', 'flat-lay', 'golden-hour', 'studio-3-point']
          .map((preset) => `<option value="${preset}">${preset.replace(/-/g, ' ')}</option>`).join('')}</select></div>
        <div class="field"><label>Which creative brief does it satisfy?</label><select name="shot"><option value="">Not one of the standard shots</option>${PHOTO_BRIEFS.map((brief) => `<option value="${escapeHtml(brief.id)}">${escapeHtml(brief.name)}</option>`).join('')}</select></div>
        <button class="btn primary" type="submit">Add photo</button></form>
      <p class="muted" style="font-size:11.5px;margin:.6rem 0 0">Original files are added without changes. Choose a scene above only if you want an additional staged version.</p></div>
    ${regenerateCard(ctx, product)}
    <div class="card"><h2>The page</h2>
      <p class="muted" style="font-size:12px;margin:.3rem 0">${product.content.benefits?.length ?? 0} benefits · ${product.content.comparison?.rows.length ?? 0}-row comparison · ${product.content.specs?.length ?? 0} specs · ${product.content.faq?.length ?? 0} questions${product.content.guarantee ? ' · guarantee' : ''}</p>
      ${product.content.benefits?.slice(0, 3).map((benefit) => `<p style="font-size:12.5px;margin:.25rem 0">— ${escapeHtml(benefit.title)}</p>`).join('') ?? ''}
      <form method="post" action="/admin/products/${escapeHtml(product.id)}/rewrite" style="margin-top:.6rem"><button class="btn" type="submit">Rewrite the page from research</button></form></div>
    <div class="card"><h2>Reviews</h2><p style="margin:.3rem 0 0">${stats.count ? `${stats.average} / 5 from ${stats.count}` : 'None yet'}</p>
      ${stats.summary.map((line) => `<p class="muted" style="font-size:12px;margin:.5rem 0 0">${escapeHtml(line)}</p>`).join('')}</div>
    <div class="card"><h2>SEO</h2>
      <p class="muted" style="font-size:12px">${escapeHtml(product.seo.title ?? product.title)}</p>
      <p class="muted" style="font-size:12px">${escapeHtml(product.seo.description ?? '')}</p></div>
  </div></div>
  <div class="grid2" style="margin-top:1rem">${supplierCard(ctx, product)}${qualificationCard(ctx, product)}</div>
  <div class="grid2" style="margin-top:1rem">${versionsCard(ctx, product)}</div>`
}

function shotPicker(productId: string, url: string, current: string): string {
  return `<form method="post" action="/admin/products/${escapeHtml(productId)}/media/label" class="row" style="gap:.25rem;margin-top:.3rem"><input type="hidden" name="mediaUrl" value="${escapeHtml(url)}"><select name="shot" aria-label="which shot" style="flex:1;font-size:11px"><option value="">which shot?</option>${PHOTO_BRIEFS.map((brief) => `<option value="${escapeHtml(brief.id)}" ${brief.id === current ? 'selected' : ''}>${escapeHtml(brief.name)}</option>`).join('')}</select><button class="btn" type="submit">Label</button></form>`
}

function supplierCard(ctx: Ctx, product: ReturnType<typeof listProducts>[number]): string {
  const supplier = product.supplier
  const price = Math.min(...product.variants.map((variant) => variant.priceCents))
  const margin = marginFor(price, supplier)
  const currency = ctx.store.currency
  return `<div class="card"><h2>Supplier &amp; margin</h2>
    <form method="post" action="/admin/products/${escapeHtml(product.id)}/supplier">
      <div class="row"><div class="field" style="flex:1"><label>Supplier</label><input name="name" value="${escapeHtml(supplier.name ?? '')}" placeholder="AliExpress / CJ / Zendrop"></div>
        <div class="field" style="flex:2"><label>Supplier URL</label><input name="url" value="${escapeHtml(supplier.url ?? '')}" placeholder="https://"></div></div>
      <div class="row"><div class="field" style="flex:1"><label>Cost (minor units)</label><input name="costCents" value="${supplier.costCents ?? ''}"></div>
        <div class="field" style="flex:1"><label>Supplier shipping</label><input name="shippingCents" value="${supplier.shippingCents ?? ''}"></div>
        <div class="field" style="flex:1"><label>Supplier SKU</label><input name="sku" value="${escapeHtml(supplier.sku ?? '')}"></div></div>
      <div class="row"><div class="field" style="flex:1"><label>Processing days</label><input name="processingDays" value="${supplier.processingDays ?? ''}"></div>
        <div class="field" style="flex:1"><label>Ship days min</label><input name="shippingDaysMin" value="${supplier.shippingDaysMin ?? ''}"></div>
        <div class="field" style="flex:1"><label>Ship days max</label><input name="shippingDaysMax" value="${supplier.shippingDaysMax ?? ''}"></div></div>
      <div class="field"><label>Size chart (first line header, cells with |) — shown on the page</label><textarea name="sizeChart" rows="2">${escapeHtml(product.metadata.sizeChart ?? '')}</textarea></div>
      <button class="btn primary" type="submit">Save</button></form>
    <table class="data" style="margin-top:.8rem"><tr><td>Price</td><td style="text-align:right">${format(margin.priceCents, currency)}</td></tr>
      <tr><td>Cost</td><td style="text-align:right">−${format(margin.costCents, currency)}</td></tr><tr><td>Supplier shipping</td><td style="text-align:right">−${format(margin.shippingCents, currency)}</td></tr>
      <tr><td>Card fees</td><td style="text-align:right">−${format(margin.feesCents, currency)}</td></tr>
      <tr><td><strong>Profit per unit</strong></td><td style="text-align:right"><strong style="color:${margin.profitCents > 0 ? 'var(--ok)' : 'var(--bad)'}">${format(margin.profitCents, currency)} · ${margin.marginPercent}%</strong></td></tr></table>
    <p class="muted" style="font-size:11.5px;margin:.5rem 0 0">Before ad spend. The Profit page subtracts what you log there.</p></div>`
}

function qualificationCard(ctx: Ctx, product: ReturnType<typeof listProducts>[number]): string {
  const notes = readQualifyNotes(product.metadata)
  const result = qualifyCatalogProduct(product, notes)
  const tone = { pass: 'ok', warn: 'warn', fail: 'bad' } as const
  const decision = { run: 'ok', work: 'warn', skip: 'bad' } as const
  const flag = (name: string, label: string, on: boolean) => `<label class="row" style="font-size:12px;gap:.3rem"><input type="checkbox" name="${name}" value="true" ${on ? 'checked' : ''}> ${label}</label>`
  return `<div class="card"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Product qualification</h2><span class="tag ${decision[result.decision]}">${result.decision}</span></div><p class="muted" style="font-size:12px">${escapeHtml(result.summary)}</p><table class="data"><tbody>${result.checks.map((check) => `<tr><td><span class="tag ${tone[check.verdict]}">${check.verdict}</span> ${escapeHtml(check.label)}</td><td>${escapeHtml(check.detail)}<div class="muted" style="font-size:11px">${escapeHtml(check.rule)}</div></td></tr>`).join('')}</tbody></table><form method="post" action="/admin/products/${escapeHtml(product.id)}/qualify" style="margin-top:.7rem"><div class="row"><div class="field" style="flex:1"><label>Trend</label><select name="trend">${['unknown', 'up', 'flat', 'declining', 'spike'].map((trend) => `<option value="${trend}" ${notes.trend === trend ? 'selected' : ''}>${trend}</option>`).join('')}</select></div><div class="field"><label>Weight grams</label><input name="weightGrams" value="${notes.weightGrams ?? ''}"></div><div class="field"><label>Expected AOV</label><input name="aovCents" value="${notes.aovCents ?? ''}"></div></div><div class="row" style="flex-wrap:wrap">${flag('seasonal', 'Seasonal', Boolean(notes.seasonal))}${flag('tech', 'Tech/battery', Boolean(notes.tech))}${flag('patented', 'Patented', Boolean(notes.patented))}${flag('bigBrand', 'Big brand', Boolean(notes.bigBrand))}${flag('printOnDemand', 'Print on demand', Boolean(notes.printOnDemand))}</div><div class="field"><label>How it stands out</label><input name="standOut" value="${escapeHtml(notes.standOut ?? '')}" placeholder="Underserved avatar or unique mechanism"></div><button class="btn primary" type="submit">Save qualification</button></form></div>`
}

function versionsCard(ctx: Ctx, product: ReturnType<typeof listProducts>[number]): string {
  const stats = versionStats(ctx.db, ctx.store.id, product.id)
  const advertorials = versionsFor(ctx.db, ctx.store.id, product.id).filter((page) => page.role === 'advertorial')
  const currency = ctx.store.currency
  return `<div class="card"><h2>Versions &amp; split test</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .8rem">Product-page versions with a weight are in the test; a durable visitor assignment stays sticky across sessions and network changes. Weight 0 keeps it out.</p>
    ${stats.length ? `<table class="data"><thead><tr><th>Version</th><th>Weight</th><th>Views</th><th>Carts</th><th>Sales</th><th>CVR</th><th></th></tr></thead><tbody>
      ${stats.map((row) => `<tr><td><a href="/admin/pages/${escapeHtml(row.pageId)}/edit">${escapeHtml(row.title.replace(`${product.title} — `, ''))}</a><div class="muted" style="font-size:11px">${escapeHtml(row.format)} · ${row.status}</div></td>
        <td><form method="post" action="/admin/versions/${escapeHtml(row.pageId)}/weight" class="row" style="gap:.3rem"><input name="weight" value="${row.weight}" style="width:52px"><button class="btn" type="submit">Set</button></form></td>
        <td>${row.views}</td><td>${row.carts}</td><td>${row.purchases}${row.revenueCents ? `<div class="muted" style="font-size:11px">${format(row.revenueCents, currency)}</div>` : ''}</td><td>${(row.conversion * 100).toFixed(1)}%</td>
        <td><a class="btn" href="${escapeHtml(ctx.storeUrl)}/products/${escapeHtml(product.handle)}?version=${escapeHtml(row.pageId)}" target="_blank" rel="noopener">View</a></td></tr>`).join('')}</tbody></table>` : '<p class="muted" style="font-size:12px">No versions yet — the built-in product page is what visitors see.</p>'}
    ${advertorials.length ? `<p class="muted" style="font-size:12px;margin-top:.6rem">Advertorials: ${advertorials.map((page) => `<a href="/admin/pages/${escapeHtml(page.id)}/edit">${escapeHtml(page.format)}</a>`).join(' · ')}</p>` : ''}
    <form method="post" action="/admin/products/${escapeHtml(product.id)}/versions" style="margin-top:1rem;border-top:1px solid var(--line);padding-top:.8rem">
      <div class="eyebrow" style="margin-bottom:.5rem">Generate versions</div>
      <div class="row"><div class="field" style="flex:1"><label>What</label><select name="kind"><option value="pdp">Product page versions</option><option value="advertorial">Advertorials</option></select></div>
        <div class="field" style="flex:1"><label>How many (if no formats picked)</label><input name="count" value="3"></div></div>
      <div class="field"><label>Formats (leave empty to let the direction choose)</label><div class="row" style="gap:.4rem .8rem;font-size:12px">${[...PDP_FORMATS.map((format) => ({ ...format, group: 'pdp' })), ...ADVERTORIAL_FORMATS.map((format) => ({ ...format, group: 'advertorial' }))].map((format) => `<label class="row" style="gap:.3rem" title="${escapeHtml(format.description)}"><input type="checkbox" name="formats" value="${format.group}:${format.id}"> ${escapeHtml(format.name)} <span class="muted">(${format.group})</span></label>`).join('')}</div></div>
      <div class="field"><label>Avatar — fills audience, angle and tone the direction leaves blank</label><select name="avatarId">${avatarOptions(ctx)}</select></div>
      <div class="field"><label>Text model for this generation</label><select name="model">${textModelOptions()}</select></div>
      <div class="field"><label>Direction — free-form. Tone words are read (urgent, premium, warm, clinical, playful, blunt); "quoted phrases" must appear; "for gift buyers" sets the audience; "focus on durability" sets the angle.</label><textarea name="direction" rows="2" placeholder="Premium and understated, for people who train seriously, focus on the repair guarantee"></textarea></div>
      <label class="row" style="font-size:12px;margin-bottom:.6rem"><input type="checkbox" name="publish" value="true"> Publish immediately</label>
      <button class="btn primary" type="submit">Generate</button></form></div>`
}

/* --------------------------------------------------------------------- orders */

export function ordersPage(ctx: Ctx, status: string): string {
  const orders = listOrders(ctx.db, ctx.store.id, { status, limit: 100 })
  return `${flash(ctx)}<div class="head"><h1 class="serif">Orders</h1></div>
  <div class="tabs">${['all', 'completed', 'cancelled'].map((option) => `<a class="${option === status ? 'on' : ''}" href="/admin/orders?status=${option}">${option}</a>`).join('')}</div>
  <div class="card" style="padding:0"><table class="data"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Fulfilment</th><th>Placed</th></tr></thead><tbody>
  ${orders.length ? orders
      .map((order) => `<tr><td><a href="/admin/orders/${escapeHtml(order.id)}">#${order.displayId}</a></td>
        <td class="muted">${escapeHtml(order.email)}</td><td>${format(order.totalCents, order.currency)}</td>
        <td><span class="tag ${order.paymentStatus === 'captured' ? 'ok' : order.paymentStatus.includes('refund') ? 'warn' : ''}">${order.paymentStatus}</span></td>
        <td><span class="tag ${order.fulfillmentStatus === 'unfulfilled' ? 'warn' : 'ok'}">${order.fulfillmentStatus}</span></td>
        <td class="muted">${order.createdAt.slice(0, 16).replace('T', ' ')}</td></tr>`)
      .join('') : '<tr><td colspan="6" class="muted" style="padding:1.4rem">No orders yet.</td></tr>'}
  </tbody></table></div>`
}

export function orderDetail(ctx: Ctx, orderId: string): string {
  const order = getOrder(ctx.db, ctx.store.id, orderId)
  if (!order) return '<p class="muted">No such order.</p>'
  return `${flash(ctx)}<div class="head"><div><div class="eyebrow"><a href="/admin/orders" style="text-decoration:none">Orders</a></div>
    <h1 class="serif">Order #${order.displayId}</h1></div>
    <div class="row">
      <form method="post" action="/admin/orders/${escapeHtml(order.id)}/refund"><button class="btn" type="submit">Refund</button></form>
      ${order.fulfillmentStatus !== 'delivered' ? `<form method="post" action="/admin/orders/${escapeHtml(order.id)}/delivered"><button class="btn" type="submit">Mark delivered</button></form>` : ''}
    </div></div>
  <div class="card"><h2>Fulfil via supplier</h2>
    <form method="post" action="/admin/orders/${escapeHtml(order.id)}/supplier" class="row" style="align-items:flex-end">
      <div class="field" style="flex:1;margin:0"><label>Supplier</label><input name="supplier" value="${escapeHtml(order.supplierOrder.supplier ?? '')}" placeholder="AliExpress / CJ"></div>
      <div class="field" style="flex:1;margin:0"><label>Supplier order id</label><input name="orderId" value="${escapeHtml(order.supplierOrder.orderId ?? '')}"></div>
      <div class="field" style="width:110px;margin:0"><label>Cost paid</label><input name="costCents" value="${order.supplierOrder.costCents ?? ''}" placeholder="cents"></div>
      <div class="field" style="width:110px;margin:0"><label>Shipping paid</label><input name="shippingCents" value="${order.supplierOrder.shippingCents ?? ''}"></div>
      <div class="field" style="flex:1;margin:0"><label>Tracking number</label><input name="tracking" placeholder="LP…, 1Z…, 94…"></div>
      <div class="field" style="width:120px;margin:0"><label>Carrier (auto)</label><input name="carrier" placeholder="auto"></div>
      <button class="btn primary" type="submit">Save</button></form>
    <p class="muted" style="font-size:11.5px;margin:.6rem 0 0">Saving a tracking number marks the order shipped and emails the customer with a link; the carrier is detected from the number. The customer can follow it at ${escapeHtml(ctx.storeUrl)}/track.</p></div>
  <div class="grid2"><div class="card" style="padding:0"><table class="data"><thead><tr><th></th><th>Item</th><th>Qty</th><th>Total</th></tr></thead><tbody>
    ${order.items.map((item) => `<tr><td style="width:52px"><img src="${escapeHtml(item.image)}" alt=""></td>
      <td>${escapeHtml(item.title)}<div class="muted" style="font-size:11.5px">${escapeHtml(item.variantTitle)}</div></td>
      <td>${item.quantity}</td><td>${format(item.unitCents * item.quantity, order.currency)}</td></tr>`).join('')}
    </tbody></table></div>
  <div>
    <div class="card"><h2>Totals</h2>
      <table class="data" style="margin-top:.4rem"><tr><td>Subtotal</td><td style="text-align:right">${format(order.subtotalCents, order.currency)}</td></tr>
      ${order.discountCents ? `<tr><td>Discount ${escapeHtml(order.discountCode)}</td><td style="text-align:right">-${format(order.discountCents, order.currency)}</td></tr>` : ''}
      <tr><td>Shipping</td><td style="text-align:right">${order.shippingCents ? format(order.shippingCents, order.currency) : 'Free'}</td></tr>
      ${order.taxCents ? `<tr><td>Tax</td><td style="text-align:right">${format(order.taxCents, order.currency)}</td></tr>` : ''}
      <tr><td><strong>Total</strong></td><td style="text-align:right"><strong>${format(order.totalCents, order.currency)}</strong></td></tr></table>
      ${order.notes ? `<div class="notice" style="margin-top:.7rem;border-left-color:var(--warn);font-size:12px">${escapeHtml(order.notes)}</div>` : ''}</div>
    <div class="card"><h2>Customer</h2><p style="margin:.3rem 0 0">${escapeHtml(order.email)}</p>
      <p class="muted" style="font-size:12px;margin:.3rem 0 0">${escapeHtml([order.address.name, order.address.line1, order.address.line2, order.address.city, order.address.state, order.address.postal, order.address.country].filter(Boolean).join(', '))}</p></div>
    ${order.refunds.length ? `<div class="card"><h2>Refunds</h2>${order.refunds.map((refund) => `<p class="muted" style="font-size:12px;margin:.3rem 0 0">${format(refund.amountCents, order.currency)} — ${escapeHtml(refund.reason || 'no reason given')}</p>`).join('')}</div>` : ''}
    ${order.fulfillments.length ? `<div class="card"><h2>Fulfilments</h2>${order.fulfillments.map((fulfillment) => `<p class="muted" style="font-size:12px;margin:.3rem 0 0">${escapeHtml(fulfillment.provider)} ${escapeHtml(fulfillment.tracking)}</p>`).join('')}</div>` : ''}
  </div></div>`
}

/* ------------------------------------------------------- customers, promos, etc */

export function customersPage(ctx: Ctx, search: string): string {
  const customers = listCustomers(ctx.db, ctx.store.id, { ...(search ? { search } : {}), limit: 200 })
  const stats = segment(ctx.db, ctx.store.id)
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Customers</h1>
    <p class="muted" style="margin:.25rem 0 0">${stats.total} total · ${Math.round(stats.repeatRate * 100)}% repeat · ${format(stats.lifetimeValueCents, ctx.store.currency)} average lifetime value</p></div>
    <form method="get" class="row"><input aria-label="Search" name="search" value="${escapeHtml(search)}" placeholder="Search" style="width:200px"><button class="btn">Search</button></form></div>
  <div class="card" style="padding:0"><table class="data"><thead><tr><th>Customer</th><th>Email</th><th>Orders</th><th>Spend</th><th>Marketing</th></tr></thead><tbody>
  ${customers.length ? customers.map((customer) => `<tr><td>${escapeHtml(customer.name || '—')}</td><td class="muted">${escapeHtml(customer.email)}</td>
    <td>${customer.ordersCount}</td><td>${format(customer.spendCents, ctx.store.currency)}</td>
    <td>${customer.marketing ? '<span class="tag ok">opted in</span>' : '<span class="tag">no</span>'}</td></tr>`).join('')
    : '<tr><td colspan="5" class="muted" style="padding:1.4rem">No customers yet.</td></tr>'}
  </tbody></table></div>`
}

export function collectionsPage(ctx: Ctx): string {
  const collections = listCollections(ctx.db, ctx.store.id)
  return `${flash(ctx)}<div class="head"><h1 class="serif">Collections</h1>
    <form method="post" action="/admin/collections" class="row"><input name="title" aria-label="New collection name" placeholder="New collection" style="width:200px" required><button class="btn primary">Create</button></form></div>
  <div class="grid3">${collections.map((collection) => `<div class="card"><h2>${escapeHtml(collection.title)}</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0">${escapeHtml(collection.description || '—')}</p>
    <p class="muted" style="font-size:12px">${collection.productIds.length} products · /collections/${escapeHtml(collection.handle)}</p></div>`).join('')
    || '<p class="muted">No collections. Ask the assistant to organise the catalog.</p>'}</div>`
}

export function promotionsPage(ctx: Ctx): string { return flash(ctx)+discountPage(ctx.db,ctx.store) }

/* ------------------------------------------------------------------ analytics */

export function analyticsPage(ctx: Ctx, range: '24h' | '7d' | '30d' | '90d'): string {
  const stages = funnel(ctx.db, ctx.store.id, range)
  const visitors = liveVisitors(ctx.db, ctx.store.id) as Array<{ city: string; country: string; path: string; last_seen: string }>
  const events = recentEvents(ctx.db, ctx.store.id, 14) as Array<{ type: string; path: string; amount_cents: number; city: string; created_at: string }>
  const purchase = stages.at(-1)?.share ?? 0
  const attribution = attributionReport(ctx.db, ctx.store.id, range, 'last')
  const serverEvents = serverEventSummary(ctx.db, ctx.store.id)
  return `${flash(ctx)}<div class="head"><div><h1>Analytics</h1>
    <p class="muted" style="margin:.25rem 0 0">First-party sessions, last-touch revenue attribution and server-event delivery health.</p></div>
    <form method="get"><select aria-label="Reporting range" name="range" onchange="this.form.submit()">${(['24h', '7d', '30d', '90d'] as const)
      .map((option) => `<option ${option === range ? 'selected' : ''}>${option}</option>`)
      .join('')}</select></form></div>
  ${kpiRow(ctx, range)}
  <div class="grid2"><div class="card"><h2>Funnel</h2><div class="bars" style="margin-top:.8rem">
    ${stages.map((stage) => `<div class="barrow"><span>${stage.stage}</span>
      <span class="track"><span class="fill" style="width:${(stage.share * 100).toFixed(1)}%"></span></span>
      <span>${stage.count} <span class="muted">${stage.dropOff ? `−${(stage.dropOff * 100).toFixed(0)}%` : ''}</span></span></div>`).join('')}
    </div>
    <div class="notice" style="margin-top:1rem">Purchase rate ${(purchase * 100).toFixed(2)}% against a ${(BENCHMARK.purchase * 100).toFixed(1)}% DTC median and ${(BENCHMARK.topDecilePurchase * 100).toFixed(1)}% top decile.</div>
  </div>
  <div class="card"><h2>Right now</h2>
    <table class="data" style="margin-top:.4rem">${visitors.length ? visitors.map((visitor) => `<tr><td>${escapeHtml([visitor.city, visitor.country].filter(Boolean).join(', '))}</td>
      <td class="muted">${escapeHtml(visitor.path || '/')}</td><td class="muted">${visitor.last_seen.slice(11, 19)}</td></tr>`).join('')
      : '<tr><td class="muted">Nobody on the store right now.</td></tr>'}</table></div></div>
  <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Event ticker</h2></div>
    <table class="data"><thead><tr><th>Event</th><th>Where</th><th>Amount</th><th>From</th><th>When</th></tr></thead><tbody>
    ${events.map((event) => `<tr><td><span class="tag">${escapeHtml(event.type)}</span></td><td class="muted">${escapeHtml(event.path || '—')}</td>
      <td>${event.amount_cents ? format(event.amount_cents, ctx.store.currency) : '—'}</td><td class="muted">${escapeHtml(event.city || '—')}</td>
      <td class="muted">${event.created_at.slice(11, 19)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="padding:1.2rem">No traffic recorded yet.</td></tr>'}
    </tbody></table></div>
  <div class="grid2" id="attribution"><div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Revenue by last touch</h2><p class="muted" style="font-size:11px;margin:.2rem 0 0">UTMs, click IDs and referrers captured on the storefront.</p></div><table class="data"><thead><tr><th>Channel</th><th>Campaign</th><th>Orders</th><th>Revenue</th><th>ROAS</th></tr></thead><tbody>${attribution.map((row) => `<tr><td><strong>${escapeHtml(row.channel)}</strong></td><td class="muted">${escapeHtml(row.campaign)}</td><td>${row.orders}</td><td>${format(row.revenueCents, ctx.store.currency)}</td><td>${row.roas === null ? '—' : `${row.roas}×`}</td></tr>`).join('') || '<tr><td colspan="5" class="muted" style="padding:1rem">Attribution appears with the next order.</td></tr>'}</tbody></table></div>
    <div class="card"><h2>Server-side event delivery</h2><p class="muted" style="font-size:11.5px">Meta CAPI and TikTok Events API are retried from a durable outbox.</p>${serverEvents.map((row) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:.55rem 0"><span><strong>${escapeHtml(row.provider)}</strong> · ${escapeHtml(row.status)}</span><span class="tag ${row.status === 'sent' ? 'ok' : row.status === 'failed' ? 'bad' : 'warn'}">${row.count}</span></div>`).join('') || '<div class="notice" style="margin-top:.8rem">Connect a pixel and server token in Settings to start delivery.</div>'}</div></div>
  ${behaviourCard(ctx, range)}`
}

/* -------------------------------------------------------------------- reviews */

export function reviewsPage(ctx: Ctx, status: string): string {
  const reviews = listReviews(ctx.db, ctx.store.id, { status, limit: 100 })
  const products = new Map(listProducts(ctx.db, ctx.store.id, { limit: 300 }).map((product) => [product.id, product.title]))
  const questions = listQuestions(ctx.db, ctx.store.id, { status: 'pending' })
  const alerts = pendingStockAlerts(ctx.db, ctx.store.id)
  return `${flash(ctx)}<div class="head"><h1 class="serif">Reviews, questions &amp; alerts</h1></div>
  <div class="grid2" style="margin-bottom:1rem">
    <form method="post" action="/admin/reviews/import" enctype="multipart/form-data" class="card"><h2>Import reviews (CSV)</h2>
      <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Loox, Judge.me and AliExpress exports: rating, body/review, author, photo URLs, product handle. Imported reviews are never marked verified.</p>
      <div class="row"><div class="field" style="flex:1"><label>CSV file</label><input type="file" name="csv" accept=".csv,text/csv" required></div>
        <div class="field" style="flex:1"><label>Attach all to</label><select name="productId"><option value="">— match by product column —</option>${[...products.entries()].map(([id, title]) => `<option value="${escapeHtml(id)}">${escapeHtml(title)}</option>`).join('')}</select></div></div>
      <button class="btn primary" type="submit">Import</button></form>
    <div><div class="card"><h2>Questions waiting (${questions.length})</h2>${questions.slice(0, 8).map((entry) => `<form method="post" action="/admin/questions/${escapeHtml(entry.id)}" style="border-top:1px solid var(--line);padding:.6rem 0">
      <div style="font-size:13px"><strong>${escapeHtml(entry.question)}</strong> <span class="muted">— ${escapeHtml(products.get(entry.productId) ?? '')}${entry.asker ? `, ${escapeHtml(entry.asker)}` : ''}</span></div>
      <div class="row" style="margin-top:.4rem"><input name="answer" placeholder="Answer" style="flex:1" required><button class="btn primary" type="submit">Answer</button><button class="btn" type="submit" name="hide" value="true">Hide</button></div></form>`).join('') || '<p class="muted" style="font-size:12px">None.</p>'}</div>
    <div class="card"><h2>Back-in-stock requests (${alerts.length})</h2>${alerts.slice(0, 8).map((alert) => `<div class="muted" style="font-size:12px;border-top:1px solid var(--line);padding:.35rem 0">${escapeHtml(alert.email)} · ${escapeHtml(alert.variant_id)} · ${alert.created_at.slice(0, 10)}</div>`).join('') || '<p class="muted" style="font-size:12px">None.</p>'}${alerts.length ? `<form method="post" action="/admin/stock-alerts/notify" style="margin-top:.6rem"><button class="btn" type="submit">Email everyone whose variant is back in stock</button></form>` : ''}</div></div></div>
  <div class="tabs">${['pending', 'approved', 'rejected', 'all'].map((option) => `<a class="${option === status ? 'on' : ''}" href="/admin/reviews?status=${option}">${option}</a>`).join('')}</div>
  <div class="grid3">${reviews.length ? reviews.map((review) => `<div class="card">
    <div class="row" style="justify-content:space-between"><strong>${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</strong>
      <span class="tag ${review.status === 'approved' ? 'ok' : review.status === 'rejected' ? 'bad' : 'warn'}">${review.status}</span></div>
    <p class="muted" style="font-size:11.5px;margin:.3rem 0">${escapeHtml(products.get(review.productId) ?? review.productId)}</p>
    <p style="font-size:13px;margin:.3rem 0">${escapeHtml(review.body)}</p>
    <p class="muted" style="font-size:11.5px">${escapeHtml(review.author)} · ${review.createdAt.slice(0, 10)}</p>
    ${review.flags.length ? `<p class="tag warn" style="margin-top:.3rem">flagged: ${escapeHtml(review.flags.join(', '))}</p>` : ''}
    <div class="row" style="margin-top:.6rem">
      <form method="post" action="/admin/reviews/${escapeHtml(review.id)}/approved"><button class="btn">Approve</button></form>
      <form method="post" action="/admin/reviews/${escapeHtml(review.id)}/rejected"><button class="btn">Reject</button></form></div>
    </div>`).join('') : '<p class="muted">Nothing in this queue.</p>'}</div>`
}

/* ------------------------------------------------------------- store designer */

export function storePage(ctx: Ctx, _messages: ChatMessage[], health = false): string {
  return flash(ctx)+themeEditorPage({store:ctx.store,draft:environment(ctx.db,ctx.store.id,'draft'),live:environment(ctx.db,ctx.store.id,'live'),pages:listPages(ctx.db,ctx.store.id),storeUrl:ctx.storeUrl})+
    `<details class="card"><summary>Store tools</summary><div class="grid2">${healthCard(ctx,health)}<div>${popupCard(ctx)}${legalCard(ctx)}</div></div></details>`
}

/* ------------------------------------------------------------------ marketing */

export function marketingPage(ctx: Ctx): string {
  const sends = listSends(ctx.db, ctx.store.id, 12) as Array<{ id: string; template: string; recipient: string; subject: string; status: string }>
  const pages = listSeoPages(ctx.db, ctx.store.id) as Array<{ path: string; title: string; description: string; keyword: string }>
  const flows = listFlows(ctx.db, ctx.store.id)
  const deliveries = recentFlowDeliveries(ctx.db, ctx.store.id, 12)
  return `${flash(ctx)}<div class="head"><div><h1>Marketing</h1><p class="muted" style="margin:.25rem 0 0">Lifecycle flows, customer messaging and search visibility.</p></div></div>
  <div class="section-title"><div><h2>Automations</h2><p class="muted">Consent-aware and idempotent: each trigger sends once.</p></div></div>
  <div class="flow-grid">${flows.map((flow) => `<details class="card flow-card"><summary><span class="flow-icon">${flow.trigger === 'welcome' ? '01' : flow.trigger === 'abandoned_cart' ? '02' : flow.trigger === 'post_purchase' ? '03' : '04'}</span><span><strong>${escapeHtml(flow.name)}</strong><small>${escapeHtml(flow.trigger.replaceAll('_', ' '))} · ${flow.delayHours ? `${flow.delayHours}h delay` : 'immediately'}</small></span><span class="tag ${flow.status === 'active' ? 'ok' : ''}">${flow.status}</span></summary>
    <form method="post" action="/admin/marketing/flows/${escapeHtml(flow.id)}" style="margin-top:1rem"><input type="hidden" name="name" value="${escapeHtml(flow.name)}"><div class="row"><div class="field" style="width:110px"><label>Delay hours</label><input type="number" min="0" name="delayHours" value="${flow.delayHours}"></div><div class="field" style="flex:1"><label>Status</label><select name="status"><option value="active" ${flow.status === 'active' ? 'selected' : ''}>Active</option><option value="paused" ${flow.status === 'paused' ? 'selected' : ''}>Paused</option></select></div></div><div class="field"><label>Subject</label><input name="subject" value="${escapeHtml(flow.subject)}" required></div><div class="field"><label>Email body</label><textarea name="body" rows="6" required>${escapeHtml(flow.body)}</textarea></div><div class="row"><button class="btn primary" type="submit">Save flow</button><span class="muted" style="font-size:11px">${flow.sentCount} sent</span></div></form>
    <form method="post" action="/admin/marketing/flows/${escapeHtml(flow.id)}/run" style="margin-top:.5rem"><button class="btn" type="submit">Run eligible customers now</button></form></details>`).join('')}</div>
  <div class="grid2"><div>
    <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Send log</h2></div>
      <table class="data"><thead><tr><th>Template</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>
      ${sends.length ? sends.map((send) => `<tr><td>${escapeHtml(send.template)}</td><td class="muted">${escapeHtml(send.recipient)}</td>
        <td><a href="/admin/emails/${escapeHtml(send.id)}">${escapeHtml(send.subject)}</a></td>
        <td><span class="tag ${send.status === 'sent' ? 'ok' : 'bad'}">${send.status}</span></td></tr>`).join('')
        : '<tr><td colspan="4" class="muted" style="padding:1.2rem">Nothing sent yet.</td></tr>'}</tbody></table></div>
    <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Pages and what they target</h2></div>
      <table class="data"><thead><tr><th>Path</th><th>Title</th><th>Keyword</th><th>Meta</th></tr></thead><tbody>
      ${pages.map((page) => `<tr><td class="muted">${escapeHtml(page.path)}</td><td>${escapeHtml(page.title || '—')}</td>
        <td class="muted">${escapeHtml(page.keyword || '—')}</td>
        <td><span class="tag ${page.description.length > 60 ? 'ok' : 'warn'}">${page.description.length > 60 ? 'written' : 'thin'}</span></td></tr>`).join('')
        || '<tr><td colspan="4" class="muted" style="padding:1.2rem">No pages tracked yet.</td></tr>'}</tbody></table></div>
  </div>
  <div>
    <div class="card"><h2>Flow activity</h2>${deliveries.map((delivery) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:.45rem 0"><span><strong style="font-size:12px">${escapeHtml(delivery.flow_name)}</strong><small class="muted" style="display:block">${escapeHtml(delivery.recipient)}</small></span><span class="tag ${delivery.status === 'sent' ? 'ok' : delivery.status === 'failed' ? 'bad' : ''}">${delivery.status}</span></div>`).join('') || '<p class="muted" style="font-size:12px">No flow messages yet.</p>'}</div>
    <div class="card"><h2>Transactional templates</h2>
      ${TEMPLATES.map((template) => `<div class="row" style="justify-content:space-between;padding:.3rem 0;border-bottom:1px solid var(--line)">
        <span style="font-size:12.5px">${escapeHtml(template.name)}</span>
        <span class="muted" style="font-size:11px">${escapeHtml(template.trigger)}${template.delayHours ? ` +${template.delayHours}h` : ''}</span></div>`).join('')}</div>
    <div class="card"><h2>Generative engines</h2>
      <p class="muted" style="font-size:12px">The knowledge card a model can actually read lives at
        <a href="${escapeHtml(ctx.storeUrl)}/llms.txt" target="_blank" rel="noopener">/llms.txt</a>, alongside
        <a href="${escapeHtml(ctx.storeUrl)}/sitemap.xml" target="_blank" rel="noopener">/sitemap.xml</a> and
        <a href="${escapeHtml(ctx.storeUrl)}/robots.txt" target="_blank" rel="noopener">/robots.txt</a>.</p>
      <p class="muted" style="font-size:11.5px">Tracking where a brand gets cited needs live calls to each engine, so this build ships the part a store controls rather than a fabricated placement chart.</p></div>
  </div></div>`
}

/* -------------------------------------------------------------------- plugins */

export function pluginsPage(ctx: Ctx, category: string, search: string): string {
  const installed = new Map(listInstalled(ctx.db, ctx.store.id).map((entry) => [entry.pluginId, entry]))
  const all = allPlugins().filter(
    (plugin) =>
      (category === 'all' || plugin.category === category) &&
      (!search || `${plugin.name} ${plugin.description}`.toLowerCase().includes(search.toLowerCase())),
  )
  const sorted = [...all].sort((a, b) => Number(b.source === 'first-party') - Number(a.source === 'first-party'))
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Integrations</h1>
    <p class="muted" style="margin:.25rem 0 0">${allPlugins().length} in the directory · ${allPlugins().filter((plugin) => plugin.source === 'first-party').length} installable · ${installed.size} installed</p></div>
    <form method="get" class="row"><input aria-label="Search" name="search" value="${escapeHtml(search)}" placeholder="Search" style="width:200px"><button class="btn">Search</button></form></div>
  <div class="tabs"><a class="${category === 'all' ? 'on' : ''}" href="/admin/plugins">All</a>
    ${pluginCategories().slice(0, 9).map((entry) => `<a class="${category === entry.name ? 'on' : ''}" href="/admin/plugins?category=${encodeURIComponent(entry.name)}">${escapeHtml(entry.name)} ${entry.count}</a>`).join('')}</div>
  <div class="grid3">${sorted.slice(0, 60).map((plugin) => {
    const entry = installed.get(plugin.id)
    const schema = plugin.manifest.admin?.settingsSchema ?? {}
    return `<div class="card"><div class="row" style="justify-content:space-between">
      <h2>${escapeHtml(plugin.name)}</h2>
      <span class="tag ${plugin.source === 'first-party' ? 'ok' : ''}">${plugin.source === 'first-party' ? 'first-party' : 'directory'}</span></div>
    <p class="muted" style="font-size:12px;margin:.4rem 0">${escapeHtml(plugin.description)}</p>
    <p class="muted" style="font-size:11px">${escapeHtml(plugin.category)}${plugin.regions.length ? ` · ${plugin.regions.join(', ')}` : ''}</p>
    ${plugin.source !== 'first-party'
      ? `<p class="muted" style="font-size:11.5px;margin-top:.5rem">Listed so you can find it. There is no integration behind it yet, so it does not pretend to install.</p>`
      : entry
        ? `<form method="post" action="/admin/plugins/${escapeHtml(plugin.id)}/settings" style="margin-top:.6rem">
            ${Object.entries(schema).map(([key, field]) => settingsField(key, field, entry.settings[key])).join('')}
            <div class="row"><button class="btn primary" type="submit">Save</button></div></form>
           <form method="post" action="/admin/plugins/${escapeHtml(plugin.id)}/uninstall" style="margin-top:.4rem"><button class="btn">Uninstall</button></form>`
        : `<form method="post" action="/admin/plugins/${escapeHtml(plugin.id)}/settings" style="margin-top:.6rem">
            ${Object.entries(schema).map(([key, field]) => settingsField(key, field, undefined)).join('')}
            <button class="btn primary" type="submit">Install</button></form>`}
    </div>`
  }).join('')}</div>`
}

function settingsField(key: string, field: { type: string; label?: string; enum?: string[]; default?: unknown; help?: string; multiline?: boolean; required?: boolean }, value: unknown): string {
  const label = escapeHtml(field.label ?? key)
  const current = value ?? field.default ?? ''
  if (field.type === 'boolean') {
    return `<label class="row" style="font-size:12px;margin-bottom:.5rem"><input type="checkbox" name="${escapeHtml(key)}" value="true" ${current ? 'checked' : ''} style="width:auto"> ${label}</label>`
  }
  if (field.enum?.length) {
    return `<div class="field"><label>${label}</label><select name="${escapeHtml(key)}">${field.enum
      .map((option) => `<option ${option === current ? 'selected' : ''}>${escapeHtml(option)}</option>`)
      .join('')}</select></div>`
  }
  const control = field.multiline
    ? `<textarea name="${escapeHtml(key)}" rows="2">${escapeHtml(current)}</textarea>`
    : `<input name="${escapeHtml(key)}" value="${escapeHtml(current)}" ${field.required ? 'required' : ''}>`
  return `<div class="field"><label>${label}${field.help ? ` — <span class="muted">${escapeHtml(field.help)}</span>` : ''}</label>${control}</div>`
}

/* ------------------------------------------------------------------- settings */

function regionsCard(ctx: Ctx, regions: Region[]): string {
  const region = (entry: Region) => `<details style="border-top:1px solid var(--line);padding:.5rem 0">
    <summary style="cursor:pointer"><strong>${escapeHtml(entry.name)}</strong> <span class="muted">${escapeHtml(entry.locale)} · ${escapeHtml(entry.currency)} · ${escapeHtml(entry.countries.join(', ') || 'no countries')}${entry.taxRate ? ` · tax ${(entry.taxRate * 100).toFixed(2)}%` : ''}</span>${entry.isDefault ? ' <span class="tag ok">default</span>' : ` <span class="tag">× ${entry.exchangeRate}</span>`}</summary>
    <form method="post" action="/admin/regions/${escapeHtml(entry.id)}" style="margin:.5rem 0">
      <div class="row"><div class="field" style="flex:2"><label>Name</label><input name="name" value="${escapeHtml(entry.name)}" required></div>
        <div class="field" style="width:6rem"><label>Locale</label><input name="locale" value="${escapeHtml(entry.locale)}" required></div>
        <div class="field" style="width:5.5rem"><label>Currency</label><input name="currency" value="${escapeHtml(entry.currency)}" required></div>
        <div class="field" style="width:6rem"><label>Rate</label><input name="exchangeRate" type="number" step="0.000001" min="0.000001" value="${entry.exchangeRate}" required></div>
        <div class="field" style="width:6rem"><label>Tax %</label><input name="taxPercent" value="${(entry.taxRate * 100).toFixed(2)}"></div></div>
      <div class="field"><label>Countries (two-letter codes, comma separated)</label><input name="countries" value="${escapeHtml(entry.countries.join(', '))}" placeholder="US, CA"></div>
      <label class="row" style="font-size:12px;margin-bottom:.5rem"><input type="checkbox" name="isDefault" value="true" ${entry.isDefault ? 'checked disabled' : ''} style="width:auto"> The region a country no one claims falls back to</label>
      <div class="row"><button class="btn primary" type="submit">Save region</button>
        ${regions.length > 1 ? `<button class="btn" type="submit" formaction="/admin/regions/${escapeHtml(entry.id)}/delete" formnovalidate onclick="return confirm('Delete ${escapeHtml(entry.name)} and its rates?')">Delete region</button>` : ''}</div></form>
    <table class="data" style="margin:.2rem 0"><tbody>${entry.shipping.map((option) => `<tr><td>
      <form method="post" action="/admin/regions/${escapeHtml(entry.id)}/shipping" class="row" style="gap:.4rem;align-items:flex-end">
        <input type="hidden" name="optionId" value="${escapeHtml(option.id)}">
        <div class="field" style="flex:2;margin:0"><label>Rate</label><input name="name" value="${escapeHtml(option.name)}" required></div>
        <div class="field" style="width:7rem;margin:0"><label>Price</label><input name="amount" value="${(option.amountCents / 100).toFixed(2)}" required></div>
        <div class="field" style="width:8rem;margin:0"><label>Free over</label><input name="freeAbove" value="${option.freeAboveCents === null ? '' : (option.freeAboveCents / 100).toFixed(2)}" placeholder="—"></div>
        <button class="btn primary" type="submit">Save</button>
        ${entry.shipping.length > 1 ? `<button class="btn" type="submit" formaction="/admin/shipping/${escapeHtml(option.id)}/delete" formnovalidate>Remove</button>` : ''}
      </form>${option.position === 0 ? '<div class="muted" style="font-size:11px">The standard rate: this is the one a free-shipping promotion covers.</div>' : ''}</td></tr>`).join('')}</tbody></table>
    <form method="post" action="/admin/regions/${escapeHtml(entry.id)}/shipping" class="row" style="gap:.4rem;align-items:flex-end;margin-bottom:.4rem">
      <div class="field" style="flex:2;margin:0"><label>Add a rate</label><input name="name" placeholder="Express (2 day)" required></div>
      <div class="field" style="width:7rem;margin:0"><label>Price</label><input name="amount" placeholder="24.00" required></div>
      <div class="field" style="width:8rem;margin:0"><label>Free over</label><input name="freeAbove" placeholder="—"></div>
      <button class="btn" type="submit">Add</button></form>
  </details>`
  return `<div class="card" id="regions"><h2>Regions and shipping</h2>
    <p class="muted" style="font-size:12px;margin:.2rem 0 .4rem">What each region is charged in, what it is quoted for shipping, and the tax on it. The cart and checkout use these settings while 17TRACK handles customer-facing tracking.</p>
    ${regions.map(region).join('') || '<p class="muted" style="font-size:12px">No regions yet — add one below, or the checkout has no currency and no rate.</p>'}
    <details style="border-top:1px solid var(--line);padding:.5rem 0"><summary class="muted" style="cursor:pointer;font-size:12.5px">Add a region</summary>
      <form method="post" action="/admin/regions" style="margin-top:.5rem">
        <div class="row"><div class="field" style="flex:2"><label>Name</label><input name="name" required placeholder="United Kingdom"></div>
          <div class="field" style="width:6rem"><label>Locale</label><input name="locale" value="en-GB" required></div>
          <div class="field" style="width:5.5rem"><label>Currency</label><input name="currency" required placeholder="GBP"></div>
          <div class="field" style="width:6rem"><label>Rate</label><input name="exchangeRate" type="number" step="0.000001" min="0.000001" value="1" required></div>
          <div class="field" style="width:6rem"><label>Tax %</label><input name="taxPercent" placeholder="20"></div></div>
        <div class="field"><label>Countries (two-letter codes, comma separated)</label><input name="countries" required placeholder="GB, IE"></div>
        <div class="row"><div class="field" style="flex:2"><label>Standard rate</label><input name="shippingName" value="Standard shipping"></div>
          <div class="field" style="width:7rem"><label>Price</label><input name="shippingAmount" placeholder="9.00"></div>
          <div class="field" style="width:8rem"><label>Free over</label><input name="shippingFreeAbove" placeholder="200.00"></div></div>
        <button class="btn primary" type="submit">Add region</button></form></details></div>`
}

export function settingsPage(ctx: Ctx): string {
  const regions = listRegions(ctx.db, ctx.store.id)
  const domains = domainsFor(ctx.db, ctx.store.id)
  const team = listTeam(ctx.db, ctx.store.id) as Array<{ email: string; role: string; status: string }>
  const audit = listAudit(ctx.db, ctx.store.id, 12) as Array<{ actor_type: string; action: string; created_at: string; target: string }>
  return `${flash(ctx)}<div class="head"><h1 class="serif">Settings</h1><a class="btn primary" href="/admin/settings/payments">Payments &amp; Stripe</a></div>
  <div class="grid2"><div>
    <div class="card" id="profile"><div class="row" style="justify-content:space-between"><div><h2>Your profile</h2><p class="muted" style="font-size:12px;margin:.25rem 0 0">The name shown in your dashboard and the email used to sign in.</p></div><span class="avatar" aria-hidden="true">${escapeHtml(ctx.userName.slice(0, 1).toUpperCase())}</span></div>
      <form method="post" action="/admin/profile" style="margin-top:.7rem"><div class="row"><div class="field" style="flex:1"><label>Name</label><input name="name" value="${escapeHtml(ctx.userName)}" maxlength="80" autocomplete="name" required></div><div class="field" style="flex:1"><label>Email</label><input name="email" type="email" value="${escapeHtml(ctx.userEmail ?? '')}" autocomplete="email" required></div></div><button class="btn primary" type="submit">Save profile</button></form></div>
    ${modelsCard(ctx)}
    ${pixelsCard(ctx)}
    <div class="card"><h2>Team access</h2><p class="muted" style="font-size:12px;margin:.25rem 0 .6rem">Owners can invite a teammate as an admin or member. Admins can manage the asset; members can work without publishing, deleting, or changing protected settings.</p>
      <form method="post" action="/admin/team" class="row" style="margin:.6rem 0">
        <input name="email" type="email" required aria-label="Teammate email" placeholder="teammate@example.com" style="flex:1">
        <select aria-label="Teammate role" name="role" style="width:110px"><option value="member">member</option><option value="admin">admin</option></select>
        <button class="btn primary" type="submit">Invite</button></form>
      ${team.map((member) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:.4rem 0"><span>${escapeHtml(member.email)}</span><span class="tag">${escapeHtml(member.role)} · ${escapeHtml(member.status)}</span></div>`).join('') || '<p class="muted" style="font-size:12px">Just you.</p>'}</div>
    <div class="card"><div class="row" style="justify-content:space-between"><div><h2>Tracking &amp; backup</h2><p class="muted" style="font-size:12px;margin:.25rem 0 0">Customer tracking pages use cached 17TRACK carrier events. Export a complete store backup whenever you want.</p></div><span class="tag ${seventeenTrackConfigured() ? 'ok' : 'warn'}">17TRACK ${seventeenTrackConfigured() ? 'connected' : 'needs key'}</span></div>
      <div class="row" style="margin-top:.8rem"><a class="btn primary" href="/admin/settings/export">Download JSON backup</a><span class="muted" style="font-size:11.5px">Products, orders, pages, analytics, experiments and settings; login sessions excluded.</span></div>
      ${seventeenTrackConfigured() ? '' : '<p class="muted" style="font-size:11.5px;margin:.6rem 0 0">Set STOREMILL_17TRACK_API_KEY on the server. Carrier links and estimated delivery still work without it.</p>'}</div>
    ${regionsCard(ctx, regions)}
  </div>
  <div>
    ${domains.length ? `<div class="card"><div class="row" style="justify-content:space-between"><h2>Existing domains</h2><a class="btn" href="/admin/domains">Manage</a></div>${domains.map((domain) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:.5rem 0;margin-top:.5rem"><span>${escapeHtml(domain.hostname)}</span><span class="tag ${domain.status === 'verified' ? 'ok' : 'warn'}">${domain.status}</span></div>`).join('')}</div>` : ''}
    <div class="card"><h2>Audit</h2>
      <p class="muted" style="font-size:11.5px">Every action, including the assistant's.</p>
      ${audit.map((entry) => `<div style="border-top:1px solid var(--line);padding:.35rem 0;font-size:12px">
        <span class="tag ${entry.actor_type === 'agent' ? 'warn' : ''}">${escapeHtml(entry.actor_type)}</span>
        ${escapeHtml(entry.action)} <span class="muted">${entry.created_at.slice(11, 19)}</span></div>`).join('')}</div>
  </div></div>`
}

function pixelsCard(ctx: Ctx): string {
  const pixels = [
    { id: 'ga4', name: 'Google Analytics 4', key: 'measurementId', label: 'Measurement ID', placeholder: 'G-ABC123', current: getInstalled(ctx.db, ctx.store.id, 'ga4')?.settings.measurementId, server: false },
    { id: 'meta-pixel', name: 'Meta Pixel + CAPI', key: 'pixelId', label: 'Pixel ID', placeholder: '123456789012345', current: getInstalled(ctx.db, ctx.store.id, 'meta-pixel')?.settings.pixelId, server: true },
    { id: 'tiktok-pixel', name: 'TikTok Pixel + Events API', key: 'pixelId', label: 'Pixel ID', placeholder: 'CABC123456789', current: getInstalled(ctx.db, ctx.store.id, 'tiktok-pixel')?.settings.pixelId, server: true },
  ]
  return `<div class="card"><div class="row" style="justify-content:space-between"><div><h2>Customer event pixels &amp; server APIs</h2><p class="muted" style="font-size:12px;margin:.25rem 0 0">Browser pixels plus retried server events. Meta and TikTok share purchase event IDs with the browser for deduplication.</p></div><span class="tag">${pixels.filter((pixel) => pixel.current).length}/3 connected</span></div>${pixels.map((pixel) => {
    const serverConnected = pixel.server && hasCredentials(ctx.db, ctx.store.id, pixel.id)
    return `<form method="post" action="/admin/settings/pixels/${pixel.id}" style="border-top:1px solid var(--line);padding:.7rem 0"><div class="row" style="align-items:flex-end"><div style="width:170px"><strong style="font-size:12.5px">${pixel.name}</strong><div class="tag ${pixel.current && (!pixel.server || serverConnected) ? 'ok' : pixel.current ? 'warn' : ''}" style="margin-top:.25rem">${pixel.current ? pixel.server ? serverConnected ? 'browser + server' : 'browser only' : 'connected' : 'not connected'}</div></div><div class="field" style="flex:1;margin:0"><label>${pixel.label}</label><input name="${pixel.key}" value="${escapeHtml(pixel.current ?? '')}" placeholder="${pixel.placeholder}" required></div>${pixel.server ? `<div class="field" style="flex:1;margin:0"><label>Server API token</label><input type="password" name="accessToken" value="" placeholder="${serverConnected ? 'Saved — leave blank to keep' : 'Paste access token'}"></div>` : ''}<button class="btn primary" type="submit">${pixel.current ? 'Update' : 'Connect'}</button></div>${pixel.id==='meta-pixel'?`<details style="margin-top:12px"><summary>Verify in Meta Events Manager</summary><p class="muted">Open Test events in Events Manager, enter its test code below, save, and visit the live storefront. Check PageView, ViewContent, AddToCart, InitiateCheckout, and a completed test purchase. Browser and server copies share an event ID. Remove the test code when finished. Draft previews never send events.</p><label class="field">Test event code<input name="testEventCode" value="${escapeHtml(getInstalled(ctx.db,ctx.store.id,'meta-pixel')?.settings.testEventCode||'')}" placeholder="TEST12345"></label><a href="https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events" target="_blank" rel="noopener">Meta setup documentation ↗</a></details>`:''}</form>`
  }).join('')}</div>`
}

/** Which model writes what for this store. */
function modelsCard(ctx: Ctx): string {
  const entries = catalog()
  const resolved = resolvedModels(ctx.db, ctx.store.id)
  const anyKey = entries.some((entry) => entry.available)
  return `<div class="card" id="models"><h2>Models</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Research, the brand kit, product pages, versions, ads and the assistant are each written by a model. Pick one per job for this store, or leave the default from the environment.${anyKey ? '' : ' <strong>No model key is configured</strong>: set ANTHROPIC_API_KEY or OPENAI_API_KEY and everything below switches from the rules writers to a model.'}</p>
    <form method="post" action="/admin/settings/models">
      ${resolved.map((row) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:.5rem 0">
        <div style="flex:1"><div style="font-size:13px">${escapeHtml(row.name)}</div><div class="muted" style="font-size:11.5px">${escapeHtml(row.note)} Now: ${escapeHtml(row.label)}.</div></div>
        <select aria-label="${escapeHtml(row.name)} model" name="${row.task}" style="width:220px"><option value="">Default</option>${entries.map((entry) => `<option value="${entry.provider}:${escapeHtml(entry.model)}" ${row.stored === `${entry.provider}:${entry.model}` ? 'selected' : ''} ${entry.available ? '' : 'disabled'}>${escapeHtml(entry.name)}${entry.available ? '' : ' (no key)'}</option>`).join('')}</select></div>`).join('')}
      <div class="row" style="margin-top:.6rem"><button class="btn primary" type="submit">Save</button></div></form>
    <p class="muted" style="font-size:11.5px;margin:.6rem 0 0">${entries.filter((entry) => entry.available).map((entry) => `${escapeHtml(entry.name)}: ${escapeHtml(entry.note)}`).join(' · ') || 'Model ids live in configuration: STOREMILL_MODEL for Claude, STOREMILL_OPENAI_MODEL for GPT.'}</p></div>`
}

/* --------------------------------------------------------------- profit */

export function profitPage(ctx: Ctx, days: number): string {
  const report = profitReport(ctx.db, ctx.store.id, days)
  const spend = listAdSpend(ctx.db, ctx.store.id, days)
  const currency = ctx.store.currency
  const peak = Math.max(1, ...report.perDay.map((day) => Math.abs(day.profit)))
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Profit reports</h1><p class="muted" style="margin:.25rem 0 0">Revenue less refunds, supplier cost, supplier shipping, card fees and the ad spend you log. Nothing estimated.</p></div>
    <form method="get"><select aria-label="Reporting period" name="days" onchange="this.form.submit()">${[7, 14, 30, 90].map((option) => `<option value="${option}" ${option === days ? 'selected' : ''}>Last ${option} days</option>`).join('')}</select></form></div>
  <div class="kpis"><div class="kpi"><div class="label">Revenue</div><div class="value">${format(report.revenueCents, currency)}</div><div class="delta">${report.orders} orders</div></div>
    <div class="kpi"><div class="label">COGS + supplier shipping</div><div class="value">−${format(report.cogsCents + report.supplierShippingCents, currency)}</div></div>
    <div class="kpi"><div class="label">Ad spend</div><div class="value">−${format(report.adSpendCents, currency)}</div><div class="delta">${report.roas !== null ? `ROAS ${report.roas}×` : 'log spend below'}</div></div>
    <div class="kpi"><div class="label">Fees + refunds</div><div class="value">−${format(report.feesCents + report.refundsCents, currency)}</div></div>
    <div class="kpi"><div class="label">Net profit</div><div class="value" style="color:${report.profitCents >= 0 ? 'var(--ok)' : 'var(--bad)'}">${format(report.profitCents, currency)}</div><div class="delta ${report.profitCents < 0 ? 'neg' : ''}">${report.revenueCents ? Math.round((report.profitCents / report.revenueCents) * 100) : 0}% margin</div></div></div>
  <div class="grid2"><div class="card"><h2>Profit by day</h2><div class="spark" style="margin-top:.7rem;height:64px">${report.perDay.map((day) => `<i style="height:${Math.max(2, (Math.abs(day.profit) / peak) * 64)}px;background:${day.profit >= 0 ? 'var(--ok)' : 'var(--bad)'}" title="${day.day}: ${format(day.profit, currency)} (rev ${format(day.revenue, currency)}, spend ${format(day.spend, currency)})"></i>`).join('') || '<span class="muted">No orders in the window.</span>'}</div></div>
  <div><form method="post" action="/admin/profit/spend" class="card"><h2>Log ad spend</h2>
    <div class="row" style="margin-top:.6rem"><div class="field" style="flex:1"><label>Day</label><input name="day" type="date" value="${new Date().toISOString().slice(0, 10)}"></div><div class="field" style="flex:1"><label>Platform</label><select name="platform"><option>Meta</option><option>TikTok</option><option>Google</option><option>Other</option></select></div><div class="field" style="flex:1"><label>Amount (minor units)</label><input name="amountCents" required placeholder="15000"></div></div>
    <div class="field"><label>Note</label><input name="note" placeholder="Campaign, creative…"></div><button class="btn primary" type="submit">Log</button></form>
    <div class="card" style="padding:0"><table class="data"><thead><tr><th>Day</th><th>Platform</th><th>Spend</th><th>Note</th></tr></thead><tbody>${spend.slice(0, 20).map((row) => `<tr><td>${row.day}</td><td>${escapeHtml(row.platform)}</td><td>${format(row.amount_cents, currency)}</td><td class="muted">${escapeHtml(row.note)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted" style="padding:1rem">Nothing logged yet.</td></tr>'}</tbody></table></div></div></div>`
}

/* --------------------------------------------------------------- funnels */

export function funnelsPage(ctx: Ctx): string {
  const funnels = listFunnels(ctx.db, ctx.store.id)
  const standalone = ctx.store.kind === 'funnel'
  const products = listProducts(ctx.db, ctx.store.id, { includeHidden:true, limit: 1000 })
  const pages = listPages(ctx.db, ctx.store.id)
  const variantOptions = (selected?: string) => `<option value="">— pick automatically —</option>` + products.flatMap((product) => product.variants.map((variant) => `<option value="${escapeHtml(variant.id)}" ${variant.id === selected ? 'selected' : ''}>${escapeHtml(product.title)}${product.status==='draft'?' (draft)':''} — ${escapeHtml(variant.title)} (${format(variant.priceCents, ctx.store.currency)})</option>`)).join('')
  const pageOptions = (role: string, selected?: string) => `<option value="">— none —</option>` + pages.filter((page) => page.role === role || page.kind === role || role === 'any').map((page) => `<option value="${escapeHtml(page.id)}" ${page.id === selected ? 'selected' : ''}>${escapeHtml(page.title)}</option>`).join('')
  const form = (funnel?: ReturnType<typeof listFunnels>[number]) => `<form method="post" action="/admin/funnels" class="card">
    ${funnel ? `<input type="hidden" name="id" value="${escapeHtml(funnel.id)}">` : ''}
    <h2>${funnel ? escapeHtml(funnel.name) : 'New funnel'}</h2>
    <div class="row" style="margin-top:.6rem"><div class="field" style="flex:1"><label>Name</label><input name="name" value="${escapeHtml(funnel?.name ?? '')}" required></div>
      <div class="field" style="flex:1"><label>Product (the checkout finds the funnel through it)</label><select name="productId"><option value="">any</option>${products.map((product) => `<option value="${escapeHtml(product.id)}" ${product.id === funnel?.productId ? 'selected' : ''}>${escapeHtml(product.title)}</option>`).join('')}</select></div></div>
    <div class="row"><div class="field" style="flex:1"><label>1 · Advertorial page</label><select name="advertorialPageId">${pageOptions('advertorial', funnel?.advertorialPageId)}</select></div>
      <div class="field" style="flex:1"><label>2 · Offer page</label><select name="offerPageId">${pageOptions('any', funnel?.offerPageId)}</select></div></div>
    <div class="eyebrow" style="margin:.4rem 0">3 · Checkout order bump</div><label class="field">Offer an order bump<select name="bumpEnabled"><option value="true" ${funnel?.bump.enabled!==false?'selected':''}>Enabled</option><option value="false" ${funnel?.bump.enabled===false?'selected':''}>Disabled</option></select></label>
    <div class="row"><div class="field" style="flex:2"><label>Bump product (default: shipping protection)</label><select name="bumpVariantId">${variantOptions(funnel?.bump.variantId)}</select></div>
      <div class="field" style="flex:1"><label>Label</label><input name="bumpLabel" value="${escapeHtml(funnel?.bump.label ?? '')}" placeholder="Protect my order"></div><div class="field" style="width:110px"><label>Price</label><input name="bumpPriceCents" value="${funnel?.bump.priceCents ?? ''}" placeholder="299"></div></div>
    <fieldset style="border:0;padding:0;min-width:0" ${funnel?.steps.some(step=>step.offer)?'hidden disabled':''}><div class="eyebrow" style="margin:.4rem 0">4 · One-click upsell</div>
    <div class="row"><div class="field" style="flex:2"><label>Product</label><select name="upsellVariantId">${variantOptions(funnel?.upsell.variantId)}</select></div><div class="field" style="width:110px"><label>% off</label><input name="upsellDiscount" value="${funnel?.upsell.discountPercent ?? 20}"></div></div>
    <div class="field"><label>Headline</label><input name="upsellHeadline" value="${escapeHtml(funnel?.upsell.headline ?? '')}" placeholder="Add a second pair for 20% off?"></div>
    <div class="eyebrow" style="margin:.4rem 0">5 · Downsell (only if the upsell is declined)</div>
    <div class="row"><div class="field" style="flex:2"><label>Product</label><select name="downsellVariantId">${variantOptions(funnel?.downsell.variantId)}</select></div><div class="field" style="width:110px"><label>% off</label><input name="downsellDiscount" value="${funnel?.downsell.discountPercent ?? ''}" placeholder="35"></div></div>
    <div class="field"><label>Headline</label><input name="downsellHeadline" value="${escapeHtml(funnel?.downsell.headline ?? '')}" placeholder="How about the wraps instead, 35% off?"></div>
    </fieldset><div class="eyebrow" style="margin:.4rem 0">6 · Split test</div>
    <div class="row"><div class="field" style="flex:2"><label>Test group (funnels sharing a name split the traffic at /go/&lt;group&gt;)</label><input name="testGroup" value="${escapeHtml(funnel?.testGroup ?? '')}" placeholder="spring-offer"></div><div class="field" style="width:110px"><label>Weight</label><input name="weight" value="${funnel?.weight ?? 0}"></div></div>
    <label class="field">Funnel status<select name="status"><option value="active" ${funnel?.status!=='paused'?'selected':''}>Active</option><option value="paused" ${funnel?.status==='paused'?'selected':''}>Paused</option></select></label>
    <div class="row"><button class="btn primary" type="submit">${funnel ? 'Save' : 'Create funnel'}</button>${funnel ? `<a class="btn" href="${escapeHtml(ctx.storeUrl)}/pages/${escapeHtml(pages.find((page) => page.id === funnel.advertorialPageId)?.handle ?? '')}" target="_blank" rel="noopener">Open step 1 ↗</a>` : ''}</div></form>
    ${funnel ? `<div class="card"><h3>Funnel pages</h3>${funnel.steps.map(step => `<article style="padding:16px 0;border-bottom:1px solid #ddd"><p><a href="/admin/pages/${escapeHtml(step.pageId)}/edit">${escapeHtml(step.label)}</a> · ${escapeHtml(step.role||pages.find(page=>page.id===step.pageId)?.role||'page')}</p>${step.offer?`<form method="post" action="/admin/funnels/${escapeHtml(funnel.id)}/steps/${escapeHtml(step.pageId)}"><label class="field">Offer product and default option<select name="variantId">${variantOptions(step.offer.variantId)}</select></label><div class="row"><label class="field">Discount %<input type="number" name="discount" min="0" max="100" value="${step.offer.discountPercent||0}"></label><label class="field">Offer status<select name="enabled"><option value="true" ${step.offer.enabled!==false?'selected':''}>Enabled</option><option value="false" ${step.offer.enabled===false?'selected':''}>Disabled</option></select></label></div><label class="field">After accepting<select name="nextPageId">${pageOptions('any',step.nextPageId)}</select></label><label class="field">After declining<select name="declinePageId">${pageOptions('any',step.declinePageId)}</select></label><p class="muted">None ends the offer sequence at the order confirmation. Prices and package options can be edited in Products.</p><button class="btn" type="submit">Save this offer</button></form>`:''}</article>`).join('')}<form method="post" action="/admin/funnels/${escapeHtml(funnel.id)}/clone"><button class="btn" type="submit">Clone whole funnel</button></form></div><form method="post" action="/admin/funnels/${escapeHtml(funnel.id)}/delete" style="margin:-.6rem 0 1rem"><button class="btn" type="submit">Delete funnel</button></form>` : ''}`
  return `${flash(ctx)}<div class="head"><div><div class="eyebrow">${standalone ? 'Funnel asset' : 'Store campaign'}</div><h1 class="serif">${standalone ? 'Funnel flow' : 'Sales funnels'}</h1><p class="muted" style="margin:.25rem 0 0">${standalone ? 'A focused Funnelish-style conversion path, separate from a catalog store.' : 'Optional conversion paths attached to this full store. For a standalone Funnelish build, create a Funnel from All Assets.'} Each content step opens in the same AI page builder.</p></div><a class="btn primary" href="/admin/pages">Build a funnel page</a></div>
  <div class="funnel-path" aria-label="Funnel path"><div><span>1</span><b>Ad traffic</b><small>Campaign link</small></div><i>→</i><div><span>2</span><b>Front door</b><small>Advertorial or quiz</small></div><i>→</i><div><span>3</span><b>PDP / sales page</b><small>The offer and proof</small></div><i>→</i><div><span>4</span><b>Checkout</b><small>Order bump</small></div><i>→</i><div><span>5</span><b>Post-purchase</b><small>Upsell · downsell · thanks</small></div></div>
  <p><a class="btn" href="/admin/pages">Clone a reference funnel</a></p><div class="grid2"><div>${funnels.map((funnel) => form(funnel)).join('') || '<div class="card"><p class="muted">No funnels yet. Create one on the right; the seed store has one already if you re-seed.</p></div>'}</div><div>${form()}${funnelTestCard(ctx)}</div></div>`
}

/* ------------------------------------------------------------ pages hub */

export function pagesPage(ctx: Ctx): string {
  const pages = listPages(ctx.db, ctx.store.id)
  const products = listProducts(ctx.db, ctx.store.id, { limit: 200 })
  const productOptions = products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.title)}${product.status === 'published' ? '' : ' (draft)'}</option>`).join('')
  const funnel = ctx.store.kind === 'funnel'
  return `${flash(ctx)}<div class="head"><div><div class="eyebrow">${funnel ? 'Funnel asset' : 'Store asset'}</div><h1 class="serif">${funnel ? 'Funnel pages' : 'Store pages'}</h1>
    <p class="muted" style="margin:.25rem 0 0">${funnel ? 'Build the advertorial or quiz, sales page, PDP and checkout path as separate editable steps.' : 'Build the home, editorial, campaign and information pages around the full catalog storefront.'} Every page can use blocks, HTML or a cloned reference.</p></div><a class="btn" href="/admin/templates">Template library</a></div>
  <div class="grid3" style="margin-bottom:1.2rem">
    <form method="post" action="/admin/pages/new" class="card"><h2>Start from a template</h2>
      <div class="field" style="margin-top:.6rem"><label>Template</label><select name="template">${PAGE_TEMPLATES.map((template) => `<option value="${escapeHtml(template.key)}" title="${escapeHtml(template.description)}">${escapeHtml(template.name)}</option>`).join('')}</select></div>
      <div class="field"><label>Product</label><select name="productId"><option value="">— none —</option>${productOptions}</select></div>
      <div class="field"><label>Title</label><input name="title" placeholder="5 reasons people are switching"></div>
      <button class="btn primary" type="submit">Create and open the editor</button></form>
    <form method="post" action="/admin/pages/clone" class="card"><h2>Clone a reference page or funnel</h2><div class="field"><label for="clone-scope">What to clone</label><select id="clone-scope" name="scope"><option value="page">This page only</option><option value="funnel">Whole site / funnel — all linked pages</option></select></div><details><summary>Optional extra pages</summary><label class="field">Direct URLs for unlinked steps<textarea name="additionalUrls" rows="3" placeholder="https://example.com/upsell"></textarea></label><p class="muted">Copies reachable home, menu, policy, product and funnel pages into a separate asset. Include direct links here only for pages that the source does not expose publicly.</p></details>
      <p class="muted" style="font-size:12px;margin:.3rem 0 .6rem">Paste any URL. Its stylesheets are inlined, every link and image made absolute, images copied into your uploads. You get the page, as HTML, to edit or use as a template.</p>
      <div class="field"><label>URL</label><input name="url" type="url" required placeholder="https://"></div>
      <div class="field"><label>Page type</label><select name="role">${roleOptions()}</select></div>
      <div class="field"><label>Connected product</label><select name="productId"><option value="">Choose a product</option>${productOptions}</select></div>
      <label class="row" style="font-size:12px;margin-bottom:.6rem"><input type="checkbox" name="keepScripts" value="true"> Keep scripts (pixels, chat widgets, the source's app)</label>
      <button class="btn primary" type="submit">Clone it</button></form>
    <form method="post" action="/admin/pages/html" class="card"><h2>Paste raw HTML</h2>
      <div class="field" style="margin-top:.6rem"><label>Title</label><input name="title" placeholder="My page" required></div>
      <div class="field"><label>Page type</label><select name="role">${roleOptions()}</select></div><div class="field"><label>HTML</label><textarea name="html" rows="5" placeholder="<!doctype html>…"></textarea></div>
      <button class="btn primary" type="submit">Create</button></form>
  </div>
  <div class="grid2" style="margin-bottom:1.2rem">${ripCard(ctx)}${suggestCard(ctx)}</div>
  ${blogCard(ctx)}
  ${customBlocksCard(ctx)}
  <div class="card" style="padding:0"><table class="data"><thead><tr><th>Page</th><th>Kind</th><th>Mode</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody>
  ${pages.length ? pages.map((page) => `<tr><td><a href="/admin/pages/${escapeHtml(page.id)}/edit">${escapeHtml(page.title)}</a>${page.isHome ? ' <span class="tag ok">home</span>' : ''}${page.role === 'checkout' ? ` <span class="tag ${page.status === 'published' ? 'ok' : 'warn'}" title="The most recently updated published checkout page is the store's /checkout">checkout</span>` : ''}<div class="muted" style="font-size:11.5px">/pages/${escapeHtml(page.handle)}${page.sourceUrl ? ` · cloned from ${escapeHtml(page.sourceUrl.replace(/^https?:\/\//, '').slice(0, 40))}` : ''}</div></td>
    <td>${escapeHtml(page.kind)}</td><td>${page.mode === 'html' ? 'HTML' : `${page.blocks.length} blocks`}</td>
    <td><span class="tag ${page.status === 'published' ? 'ok' : 'warn'}">${page.status}</span></td><td class="muted">${page.updatedAt.slice(0, 16).replace('T', ' ')}</td>
    <td style="text-align:right"><div class="row" style="justify-content:flex-end"><a class="btn" href="/admin/pages/${escapeHtml(page.id)}/edit">Edit</a>
      <a class="btn" href="${escapeHtml(page.status === 'published' && ctx.store.status === 'live' ? ctx.storeUrl : '/preview/' + ctx.store.slug)}/pages/${escapeHtml(page.handle)}" target="_blank" rel="noopener">${page.status === 'published' && ctx.store.status === 'live' ? 'View' : 'Preview'} ↗</a>
      <form method="post" action="/admin/pages/${escapeHtml(page.id)}/duplicate"><button class="btn">Duplicate</button></form>
      <form method="post" action="/admin/pages/${escapeHtml(page.id)}/delete" onsubmit="return confirm('Delete this page?')"><button class="btn">Delete</button></form></div></td></tr>`).join('')
    : '<tr><td colspan="6" class="muted" style="padding:1.4rem">No pages yet. Start from the advertorial template, clone a page, or paste HTML.</td></tr>'}
  </tbody></table></div>`
}

function blogCard(ctx: Ctx): string {
  const blogs = listBlogs(ctx.db, ctx.store.id)
  const articleForm = (blogId: string, entry: (typeof blogs)[number]['articles'][number] | null) => `<form method="post" action="${entry ? `/admin/articles/${escapeHtml(entry.id)}` : `/admin/blogs/${escapeHtml(blogId)}/articles`}" style="padding:.5rem 0">
    <div class="row"><div class="field" style="flex:2"><label>Title</label><input name="title" value="${escapeHtml(entry?.title ?? '')}" required></div><div class="field" style="width:9rem"><label>Status</label><select name="status">${(['draft', 'scheduled', 'published'] as const).map((status) => `<option value="${status}" ${entry?.status === status ? 'selected' : ''}>${status}</option>`).join('')}</select></div><div class="field" style="width:13rem"><label>Publish at</label><input name="publishAt" type="datetime-local" value="${entry?.publishedAt ? escapeHtml(entry.publishedAt.slice(0, 16)) : ''}"></div></div>
    <div class="field"><label>Excerpt</label><input name="excerpt" value="${escapeHtml(entry?.excerpt ?? '')}"></div><div class="field"><label>Body</label><textarea name="body" rows="5">${escapeHtml(entry?.body ?? '')}</textarea></div>
    <div class="row"><button class="btn primary" type="submit">${entry ? 'Save article' : 'Create article'}</button>${entry ? `<a class="btn" href="${escapeHtml(ctx.storeUrl)}/blogs/${escapeHtml(blogs.find((blog) => blog.id === blogId)?.handle ?? '')}/${escapeHtml(entry.handle)}" target="_blank" rel="noopener">View ↗</a><button class="btn" type="submit" formaction="/admin/articles/${escapeHtml(entry.id)}/delete" formnovalidate>Delete</button>` : ''}</div></form>`
  return `<div class="card" id="blog" style="margin-bottom:1.2rem"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Blog</h2><span class="muted" style="font-size:12px">${blogs.reduce((sum, blog) => sum + blog.articles.length, 0)} articles</span></div>
    ${blogs.map((blog) => `<details style="border-top:1px solid var(--line);padding:.5rem 0"><summary><strong>${escapeHtml(blog.title)}</strong> <span class="muted">/blogs/${escapeHtml(blog.handle)}</span></summary>${blog.articles.map((entry) => `<details style="border-top:1px solid var(--line);padding:.3rem 0"><summary><span class="tag ${entry.status === 'published' ? 'ok' : 'warn'}">${entry.status}</span> ${escapeHtml(entry.title)}</summary>${articleForm(blog.id, entry)}</details>`).join('')}<details><summary class="muted">Write an article</summary>${articleForm(blog.id, null)}</details><form method="post" action="/admin/blogs/${escapeHtml(blog.id)}/delete"><button class="btn" type="submit">Delete blog</button></form></details>`).join('')}
    <form method="post" action="/admin/blogs" class="row" style="margin-top:.6rem"><input name="title" required aria-label="New blog title" placeholder="New blog title" style="flex:1"><button class="btn" type="submit">Create blog</button></form></div>`
}

/** The blocks this store defined for itself, and the form to define one. The model can do the same through create_block. */
function customBlocksCard(ctx: Ctx): string {
  const blocks = listCustomBlocks(ctx.db, ctx.store.id)
  return `<div class="card" id="blocks" style="margin-bottom:1.2rem"><div class="row" style="justify-content:space-between"><h2 style="margin:0">Your own blocks</h2><span class="muted" style="font-size:12px">${blocks.length ? `${blocks.length} defined` : 'None yet'} · when no block in the catalog does the job, define one; the assistant can too</span></div>
    ${blocks.length ? `<table class="data" style="margin:.6rem 0"><tbody>${blocks.map((block) => `<tr><td><strong>${escapeHtml(block.name)}</strong> <code style="font-size:11px">${escapeHtml(block.type)}</code><div class="muted" style="font-size:11.5px">${escapeHtml(block.description ?? '')} · fields: ${escapeHtml(block.fields.map((field) => field.key).join(', ') || 'none')} · ${block.source === 'model' ? 'written by the assistant' : 'written by you'}</div><details style="margin-top:.5rem"><summary class="muted" style="cursor:pointer;font-size:12px">Edit it</summary>${blockForm(block)}</details></td>
      <td style="width:6rem;text-align:right;vertical-align:top"><form method="post" action="/admin/blocks/${escapeHtml(block.type)}/delete" onsubmit="return confirm('Remove this block? Pages that use it keep the section until you take it off them.')"><button class="btn" type="submit" style="font-size:11px">Remove</button></form></td></tr>`).join('')}</tbody></table>` : ''}
    <details style="margin-top:.4rem"><summary class="muted" style="cursor:pointer;font-size:12.5px">Define a block</summary>${blockForm()}</details></div>`
}

function blockForm(block?: CustomBlock): string {
  const fields = (block?.fields ?? []).map((field) => [field.key, field.label ?? field.key, field.multiline ? 'text' : field.type, field.default === undefined ? '' : String(field.default)].join('|').replace(/\|+$/, '')).join('\n')
  return `<form method="post" action="/admin/blocks" style="margin-top:.6rem">
    <div class="row"><div class="field" style="flex:1"><label>Name</label><input name="name" required value="${escapeHtml(block?.name ?? '')}" placeholder="Ingredient strip"></div><div class="field" style="flex:1"><label>Type${block ? '' : ' (optional, custom-…)'}</label><input name="type" value="${escapeHtml(block?.type ?? '')}" ${block ? 'readonly' : ''} placeholder="custom-ingredient-strip"></div><div class="field" style="width:5rem"><label>Icon</label><input name="icon" value="${escapeHtml(block?.icon ?? '✚')}"></div></div>
    <div class="field"><label>What it is for (the assistant reads this)</label><input name="description" value="${escapeHtml(block?.description ?? '')}" placeholder="A row of ingredient chips with a percentage each"></div>
    <div class="field"><label>Fields, one per line: key|label|type|default (type: string, text, number, boolean)</label><textarea name="fields" rows="3">${escapeHtml(fields)}</textarea></div>
    <div class="field"><label>Template — {{key}} escaped, {{{key}}} raw, {{#if key}}…{{/if}}, {{#each items}} {{0}} {{1}} {{/each}}, {{product.title}} {{product.price}}</label><textarea name="template" rows="6" required>${escapeHtml(block?.template ?? '')}</textarea></div>
    <div class="field"><label>CSS (optional)</label><textarea name="css" rows="2">${escapeHtml(block?.css ?? '')}</textarea></div>
    <div class="field"><label>JavaScript (optional; runs once per page that uses the block)</label><textarea name="js" rows="2">${escapeHtml(block?.js ?? '')}</textarea></div>
    <button class="btn primary" type="submit">${block ? 'Save changes' : 'Save the block'}</button></form>`
}

/* --------------------------------------------------------------- bundles */

export function bundlesPage(ctx: Ctx): string { return flash(ctx)+discountPage(ctx.db,ctx.store,true) }

/* -------------------------------------------------------------- payments */

export function paymentsPage(ctx: Ctx): string {
  const stripe = getInstalled(ctx.db, ctx.store.id, 'stripe')
  const connected = Boolean(stripe && hasCredentials(ctx.db, ctx.store.id, 'stripe'))
  const webhookUrl = `${publicStoreUrl(ctx.db, ctx.store)}/webhooks/stripe`
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Payments</h1>
    <p class="muted" style="margin:.25rem 0 0">One-page checkout with express buttons, Apple Pay, Google Pay, Link and cards through Stripe. Money goes directly to your Stripe account; storemill adds no platform fee.</p></div>
    <span class="tag ${connected ? 'ok' : 'warn'}">${connected ? 'Stripe connected' : 'Demo mode — orders place without a charge'}</span></div>
  <div class="grid2"><form method="post" action="/admin/plugins/stripe/settings" class="card"><h2>Stripe keys</h2>
    <div class="field" style="margin-top:.6rem"><label>Publishable key</label><input name="publishableKey" value="${escapeHtml(String(stripe?.settings.publishableKey ?? ''))}" placeholder="pk_live_…" required></div>
    <div class="field"><label>Secret key ${connected ? '<span class="muted">— sealed; paste again to replace</span>' : ''}</label><input name="secretKey" placeholder="sk_live_…" ${connected ? '' : 'required'}></div>
    <div class="field"><label>Webhook signing secret</label><input name="webhookSecret" placeholder="whsec_…"></div>
    <div class="field"><label>Capture</label><select name="captureMode"><option value="automatic" ${stripe?.settings.captureMode !== 'manual' ? 'selected' : ''}>Automatic · charge when payment succeeds</option>${stripe?.settings.captureMode === 'manual' ? '<option value="manual" selected>Manual · checkout unavailable</option>' : ''}</select>${stripe?.settings.captureMode === 'manual' ? '<p class="help">This checkout supports automatic capture. Select Automatic to enable payments; your existing setting has been preserved.</p>' : ''}</div>
    <label class="row" style="font-size:12px;margin-bottom:.7rem"><input type="checkbox" name="saveCards" value="true" ${stripe?.settings.saveCards !== false ? 'checked' : ''}> Save cards for one-click post-purchase offers</label>
    <button class="btn primary" type="submit">${connected ? 'Update' : 'Connect Stripe'}</button></form>
  <div>
    <div class="card"><h2>What the checkout does</h2><ul style="margin:.4rem 0 0;padding-left:1.1rem;font-size:12.5px;color:var(--muted)">
      <li>Express row at the top: Apple Pay, Google Pay and Link appear on devices that have them</li>
      <li>Contact → delivery → shipping method → payment, one page, one button</li>
      <li>Order summary on the right; collapsed to one line on a phone</li>
      <li>Buy-now from any product page or buy box skips the cart</li>
      <li>After payment, one post-purchase offer, charged to the saved card in one click</li>
      <li>Refunds from the order page go back through Stripe when the order was paid there</li></ul></div>
    <div class="card"><h2>Webhook</h2><p class="muted" style="font-size:12px">Add an endpoint in Stripe pointing at:</p><code style="font-size:12px;word-break:break-all">${escapeHtml(webhookUrl)}</code>
      <p class="muted" style="font-size:12px;margin-top:.6rem">Events: <code>payment_intent.succeeded</code>, <code>charge.refunded</code>. Paste its signing secret above. Unsigned deliveries are rejected.</p></div>
  </div></div>`
}

/* --------------------------------------------------------------- assets hub */

export function storesPage(ctx: Ctx, stores: Store[]): string {
  const storeCount = stores.filter((store) => store.kind === 'store').length
  const funnelCount = stores.length - storeCount
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Stores & funnels</h1>
    <p class="muted" style="margin:.25rem 0 0">${storeCount} store${storeCount === 1 ? '' : 's'} · ${funnelCount} funnel${funnelCount === 1 ? '' : 's'}. Stores are full catalogs; funnels are focused conversion paths.</p></div>
    <a class="btn primary" href="/admin/stores?new=1#new" data-new-asset>+ New store or funnel</a></div>
  <div class="asset-tabs"><button class="on" type="button" data-filter="all">All ${stores.length}</button><button type="button" data-filter="store">Stores ${storeCount}</button><button type="button" data-filter="funnel">Funnels ${funnelCount}</button></div>
  <div class="asset-grid" id="asset-grid">${stores.map((store) => {
    const products = ctx.db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND status = 'published'", store.id)?.c ?? 0
    const pages = ctx.db.one<{ c: number }>('SELECT COUNT(*) c FROM pages WHERE store_id = ?', store.id)?.c ?? 0
    const todayRevenue = ctx.db.one<{ revenue: number | null }>("SELECT SUM(COALESCE(base_total_cents, total_cents)) revenue FROM orders WHERE store_id = ? AND created_at >= ? AND status != 'cancelled'", store.id, todayStart.toISOString())?.revenue ?? 0
    const month = salesSummary(ctx.db, store.id, 30)
    const cover = storeCoverImage(ctx.db, store.id)
    const storefrontUrl = store.status === 'live' ? `/s/${store.slug}` : `/preview/${store.slug}`
    return `<article class="asset-card" data-kind="${store.kind}">
      <a class="asset-cover" aria-label="Open ${escapeHtml(store.name)}" href="/admin/switch?storeId=${escapeHtml(store.id)}"><span aria-hidden="true">${uiIcon(store.kind === 'funnel' ? 'funnel' : 'store', 30)}</span>${cover ? `<img src="${escapeHtml(cover)}" alt="${escapeHtml(store.name)} homepage hero" loading="lazy" decoding="async" onerror="this.hidden=true">` : ''}<em>${store.kind}</em></a>
      <div class="asset-body"><div class="row" style="justify-content:space-between;align-items:flex-start"><div><h2>${escapeHtml(store.name)}</h2><p>${escapeHtml(store.brand.slogan || store.prompt.slice(0, 90) || `Blank ${store.kind}`)}</p></div><span class="tag ${store.status === 'live' ? 'ok' : 'warn'}">${store.status[0]?.toUpperCase()}${store.status.slice(1)}</span></div>
        <div class="asset-facts"><span>${products} product${products === 1 ? '' : 's'}</span><span>${pages} page${pages === 1 ? '' : 's'}</span></div>
        <div class="asset-metrics"><div><small>Today revenue</small><strong>${format(todayRevenue, store.currency)}</strong></div><div><small>30 days / 30d revenue</small><strong>${format(month.revenueCents, store.currency)}</strong><em>${month.orders} order${month.orders === 1 ? '' : 's'} / 30d</em></div></div>
        <div class="row"><a class="btn primary" href="/admin/switch?storeId=${escapeHtml(store.id)}">${store.id === ctx.store.id ? 'Open current' : 'Open'}</a><a class="btn" href="${escapeHtml(storefrontUrl)}" target="_blank" rel="noopener">${store.status === 'live' ? 'View' : 'Preview'} ↗</a><form method="post" action="/admin/stores/${escapeHtml(store.id)}/duplicate"><button class="btn" type="submit">Duplicate ${store.kind === 'funnel' ? 'funnel' : 'store'}</button></form><form method="post" action="/admin/stores/${escapeHtml(store.id)}/status"><input type="hidden" name="status" value="${store.status === 'paused' ? 'live' : 'paused'}"><button class="btn" type="submit">${store.status === 'paused' ? 'Reopen' : 'Pause'}</button></form><details class="asset-more"><summary class="btn" aria-label="More actions for ${escapeHtml(store.name)}">•••</summary><a href="/admin/stores/${escapeHtml(store.id)}/delete" style="display:block;color:#b42318;padding:10px">Delete ${store.kind}…</a></details></div></div>
    </article>`
  }).join('')}</div>
  ${listImports(ctx.db,ctx.userId||ctx.store.ownerId).length ? `<section class="card"><h2>Recent site clones</h2>${listImports(ctx.db,ctx.userId||ctx.store.ownerId).slice(0,6).map(job=>{const progress=JSON.parse(job.progress);return `<p><a href="/admin/imports/${escapeHtml(job.id)}">${escapeHtml(JSON.parse(job.input).name||new URL(JSON.parse(job.input).url).hostname)}</a> · ${escapeHtml(job.status)} · ${Number(progress.percent)||0}% · ${Number(progress.copied)||0} pages <span class="muted">${escapeHtml(progress.task||'')}</span></p>`}).join('')}</section>` : ''}
  <section id="new" class="section-title" style="margin-top:1.5rem"><div><h2>Create an asset</h2><p class="muted">Start clean, run the full AI build, or clone the front end from one link.</p></div></section>
  <div class="grid2 asset-create"><form method="post" action="/admin/assets/import" class="card" id="clone-asset-form"><div class="row" style="justify-content:space-between"><h2>Clone from a link</h2><span class="tag">fastest</span></div><p class="muted" style="font-size:12px;margin:.3rem 0 .8rem">Copies all reachable pages: home, navigation, products, policies, checkout and funnel steps, including linked shop subdomains. Imports the catalog and supported sale rules into a separate draft. Track progress and review any gaps.</p>
    <div class="field"><label>Store or funnel URL</label><input name="url" type="url" required placeholder="https://example.com"></div><details style="margin-bottom:14px"><summary>Optional extra pages</summary><label class="field">Other page URLs (one per line)<textarea name="additionalUrls" rows="3" placeholder="https://example.com/checkout&#10;https://example.com/upsell"></textarea></label><p class="muted" style="font-size:12px">Linked pages are discovered automatically. Add unlinked checkout, upsell or thank-you pages here.</p></details><div class="row"><div class="field" style="flex:1"><label>Name (optional)</label><input name="name" placeholder="Use the page title"></div><div class="field" style="width:150px"><label>Asset type</label><select name="kind"><option value="store">Full store</option><option value="funnel">Funnel</option></select></div><div class="field" style="width:90px"><label>Currency</label><input name="currency" value="USD" maxlength="3"></div></div><div class="row"><button class="btn primary" id="clone-asset-submit" type="submit">Clone and open</button><div class="row" id="clone-asset-progress" hidden><span class="muted" style="font-size:12px">Cloning pages and images…</span><button class="btn" id="clone-asset-cancel" type="button">Cancel clone</button></div></div></form>
  <div><form method="post" action="/admin/assets/create" class="card"><h2>Start blank</h2><div class="row" style="margin-top:.7rem"><div class="field" style="flex:1"><label>Name</label><input name="name" required placeholder="New brand"></div><div class="field" style="width:150px"><label>Asset type</label><select name="kind"><option value="store">Full store</option><option value="funnel">Funnel</option></select></div><div class="field" style="width:90px"><label>Currency</label><input name="currency" value="USD" maxlength="3"></div></div><button class="btn" type="submit">Create blank asset</button></form><div class="card"><h2>AI build from a brief</h2><p class="muted" style="font-size:12px;margin:.3rem 0 .7rem">Research, brand, products, imagery and the appropriate store or funnel page plan.</p><a class="btn" href="/onboarding">Start a new store or funnel with AI</a></div></div></div>
  <script>(function(){
    var buttons=document.querySelectorAll('.asset-tabs button'),cards=document.querySelectorAll('.asset-card'),create=document.getElementById('new');
    buttons.forEach(function(button){button.addEventListener('click',function(){buttons.forEach(function(item){item.classList.remove('on')});button.classList.add('on');cards.forEach(function(card){card.hidden=button.dataset.filter!=='all'&&card.dataset.kind!==button.dataset.filter})})});
    function openCreate(event){if(event)event.preventDefault();create&&create.scrollIntoView({behavior:'smooth',block:'start'});var input=document.querySelector('#clone-asset-form input[name=url]');setTimeout(function(){input&&input.focus()},350)}
    document.querySelectorAll('[data-new-asset]').forEach(function(link){link.addEventListener('click',openCreate)});if(location.hash==='#new'||new URLSearchParams(location.search).has('new'))setTimeout(openCreate,0);
    var form=document.getElementById('clone-asset-form'),submit=document.getElementById('clone-asset-submit'),progress=document.getElementById('clone-asset-progress'),cancel=document.getElementById('clone-asset-cancel'),controller;
    function setCloning(active){submit.hidden=active;submit.disabled=active;progress.hidden=!active;form.setAttribute('aria-busy',String(active))}
    form&&form.addEventListener('submit',async function(event){event.preventDefault();if(controller)return;var request=new AbortController();controller=request;setCloning(true);try{var response=await fetch(form.action,{method:'POST',body:new FormData(form),credentials:'same-origin',signal:request.signal});if(!response.ok||!response.redirected)throw new Error('The clone request did not finish successfully');if(controller===request&&!request.signal.aborted)location.assign(response.url)}catch(error){if(controller===request&&!request.signal.aborted)location.assign('/admin/stores?flash='+encodeURIComponent('!Could not clone that asset. Try again.'))}finally{if(controller===request){controller=null;setCloning(false)}}});
    cancel&&cancel.addEventListener('click',function(){if(!controller)return;var request=controller;controller=null;request.abort();setCloning(false)});
  })()</script>`
}

/* --------------------------------------------------------------- media */

export function mediaPage(ctx: Ctx): string {
  const assets=listStoreMedia(ctx.db,ctx.store.id),logos=assets.filter(asset=>asset.category==='logo'),media=assets.filter(asset=>asset.category!=='logo')
  const storeQuery='storeId='+encodeURIComponent(ctx.store.id),e=escapeHtml
  const card=(asset:typeof assets[number])=>`<figure class="media-card" data-category="${asset.category}">${asset.kind==='video'?`<video src="${e(asset.url)}" controls playsinline preload="metadata" aria-label="${e(asset.label)}"></video>`:asset.kind==='embed'?`<a href="${e(asset.url)}" target="_blank" rel="noopener">Embedded video · open player</a>`:`<a href="${e(asset.url)}" target="_blank" rel="noopener"><img src="${e(asset.url)}" alt="${e(asset.label)}" loading="lazy"></a>`}<figcaption><div><strong>${e(asset.label)}</strong><span>${e(asset.source)} · ${asset.kind}${asset.bytes?' · '+(asset.bytes/1024/1024).toFixed(1)+' MB':''}</span></div><div class="media-actions">${asset.kind!=='embed'?`<a class="btn primary" href="/admin/media/rebrand?${storeQuery}&source=${encodeURIComponent(asset.url)}">Rebrand</a>`:'<span class="muted">Upload the original video to rebrand</span>'}<button class="btn" type="button" data-copy="${e(asset.url)}">Copy URL</button>${asset.kind==='image'?`<form method="post" action="/admin/media/classify?${storeQuery}"><input type="hidden" name="url" value="${e(asset.url)}"><input type="hidden" name="label" value="${e(asset.label)}"><input type="hidden" name="category" value="${asset.category==='logo'?'media':'logo'}"><button class="btn" type="submit">${asset.category==='logo'?'Move to other media':'Move to logos'}</button></form>`:''}</div></figcaption></figure>`
  return `${mediaRebrandStyle}${flash(ctx)}<div class="head"><div><div class="eyebrow">${ctx.store.kind} asset</div><h1 class="serif">Media &amp; logos</h1><p class="muted">Keep brand logos separate from product images and videos. Use logos as references when regenerating media in the page editor.</p></div><span class="tag">${logos.length} logos · ${media.length} other media</span></div>
  <form method="post" action="/admin/media/upload?${storeQuery}" enctype="multipart/form-data" class="card media-upload"><div><h2>Add an image, video or logo</h2><p class="muted">Images up to 12MB; MP4, WebM or MOV videos up to 100MB.</p></div><label>Save in<select name="category"><option value="media">Images & videos</option><option value="logo">Logos</option></select></label><input type="file" name="image" aria-label="Upload image or video" accept="image/*,video/mp4,video/webm,video/quicktime" required><button class="btn primary" type="submit">Upload</button></form>
  <section aria-label="Logo assets"><h2>Logos <span class="tag">${logos.length}</span></h2>${logos.length?`<div class="media-grid">${logos.map(card).join('')}</div>`:'<div class="card"><p class="muted">Upload a logo and choose Logos above, or move an existing image here. PNG and SVG retain transparent backgrounds.</p></div>'}</section>
  <section aria-label="Images and videos" style="margin-top:28px"><h2>Images & videos <span class="tag">${media.length}</span></h2>${media.length?`<div class="media-grid">${media.map(card).join('')}</div>`:'<div class="card"><p class="muted">No other media yet. Upload a photo or video, clone a reference, or generate imagery from the Assistant.</p></div>'}</section>
  ${rebrandHistory(ctx.db,ctx.store)}<script>document.querySelectorAll('[data-copy]').forEach(function(button){button.addEventListener('click',async function(){try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent='Copied';setTimeout(function(){button.textContent='Copy URL'},1200)}catch{button.textContent='Open the media to copy its URL'}})})</script>`
}

/* ------------------------------------------------------------- research page */

export function researchPage(ctx: Ctx): string {
  const research = latestResearch(ctx.db, ctx.store.id)
  const runForm = `<form method="post" action="/admin/research/run" class="card">
    <h2>Run customer research</h2>
    <p class="muted" style="font-size:12px;margin:.3rem 0 .8rem">Who buys this, what stops them, what they compare it against, what they will pay. Product pages are written from it.</p>
    <div class="field"><label>Brief</label><input name="brief" value="${escapeHtml(ctx.store.prompt)}"></div>
    <div class="field"><label>Existing site to read (optional)</label><input name="siteUrl" type="url" value="${escapeHtml(ctx.store.referenceUrl)}" placeholder="https://"></div>
    <label class="row" style="font-size:12px;margin-bottom:.7rem"><input type="checkbox" name="rewritePages" value="true" checked> Rewrite every product page from the result</label>
    <button class="btn primary" type="submit">${research ? 'Run again' : 'Run research'}</button></form>`
  if (!research) {
    return `${flash(ctx)}<div class="head"><h1 class="serif">Customer research</h1></div><div class="grid2">${runForm}<div class="card"><p class="muted">Nothing on file yet. Stores built through onboarding get this automatically; this one was not, or it was reset.</p></div></div>
    <div style="margin-top:1rem">${competitorsCard(ctx)}${avatarsCard(ctx)}</div>`
  }
  return `${flash(ctx)}<div class="head"><div><h1 class="serif">Customer research</h1>
    <p class="muted" style="margin:.25rem 0 0">${research.createdAt.slice(0, 16).replace('T', ' ')} · ${research.source === 'rules' ? 'from category rules — set ANTHROPIC_API_KEY or OPENAI_API_KEY and run again for real research' : `written by ${escapeHtml(research.model || 'a model')}${research.source === 'model+site' ? ', with your site read in' : ''}`}</p></div></div>
  <div class="notice" style="margin-bottom:1rem"><strong>Positioning.</strong> ${escapeHtml(research.positioning)}</div>
  <div class="grid2"><div>
    <div class="card"><h2>Who buys</h2>
      ${research.audience.map((persona) => `<div style="border-top:1px solid var(--line);padding:.7rem 0">
        <div class="row" style="justify-content:space-between"><strong>${escapeHtml(persona.name)}</strong><span class="tag">${Math.round(persona.share * 100)}%</span></div>
        <p class="muted" style="font-size:12.5px;margin:.3rem 0">${escapeHtml(persona.who)}</p>
        <p style="font-size:12.5px;margin:.2rem 0"><span class="muted">Wants</span> ${escapeHtml(persona.wants)}</p>
        <p style="font-size:12.5px;margin:.2rem 0"><span class="muted">Fears</span> ${escapeHtml(persona.fears)}</p>
        <p style="font-size:12.5px;margin:.2rem 0"><span class="muted">Buys when</span> ${escapeHtml(persona.buysWhen)}</p></div>`).join('')}</div>
    <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Objections, answered</h2></div>
      <table class="data"><tbody>${research.objections.map((entry) => `<tr><td style="width:40%"><strong>${escapeHtml(entry.objection)}</strong></td><td class="muted">${escapeHtml(entry.answer)}</td></tr>`).join('')}</tbody></table></div>
    <div class="card" style="padding:0"><div style="padding:1rem 1.1rem"><h2>Competitors</h2></div>
      <table class="data"><thead><tr><th>Who</th><th>Angle</th><th>Price</th><th>Weakness</th></tr></thead><tbody>
      ${research.competitors.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td class="muted">${escapeHtml(entry.angle)}</td><td>${escapeHtml(entry.priceBand)}</td><td class="muted">${escapeHtml(entry.weakness)}</td></tr>`).join('')}</tbody></table></div>
  </div>
  <div>
    ${runForm}
    <div class="card"><h2>Price anchor</h2>
      <div class="row" style="gap:1.4rem;margin:.5rem 0"><div><div class="eyebrow">Mass</div><div style="font-size:1.2rem">${format(research.priceAnchor.lowCents, ctx.store.currency)}</div></div>
        <div><div class="eyebrow">Us</div><div style="font-size:1.2rem;color:var(--accent)">${format(research.priceAnchor.midCents, ctx.store.currency)}</div></div>
        <div><div class="eyebrow">Bespoke</div><div style="font-size:1.2rem">${format(research.priceAnchor.highCents, ctx.store.currency)}</div></div></div>
      <p class="muted" style="font-size:12px">${escapeHtml(research.priceAnchor.note)}</p></div>
    <div class="card"><h2>Purchase triggers</h2><ul style="margin:.4rem 0 0;padding-left:1.1rem;font-size:12.5px">${research.triggers.map((trigger) => `<li>${escapeHtml(trigger)}</li>`).join('')}</ul></div>
    <div class="card"><h2>Keywords</h2><p style="margin:.4rem 0 0">${research.keywords.map((keyword) => `<span class="tag" style="margin:.15rem .15rem 0 0">${escapeHtml(keyword)}</span>`).join('')}</p></div>
    <div class="card"><h2>Proof points</h2><ul style="margin:.4rem 0 0;padding-left:1.1rem;font-size:12.5px">${research.proofPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul></div>
    ${research.sourceNotes.length ? `<div class="card"><h2>From the source</h2><ul style="margin:.4rem 0 0;padding-left:1.1rem;font-size:12.5px">${research.sourceNotes.map((note) => `<li>${escapeHtml(note)}</li>`).join('')}</ul></div>` : ''}
  </div></div>
  <div class="grid2" style="margin-top:1rem"><div>${avatarsCard(ctx)}</div><div>${competitorsCard(ctx)}</div></div>`
}

/* ------------------------------------------------------------------- ai page */

export function aiPage(ctx: Ctx, messages: ChatMessage[]): string {
  const runs = listRuns(ctx.db, ctx.store.id, 8)
  const counts = toolCountsByArea()
  const queue = listAssistantQueue(ctx.db, ctx.store.id, 20)
  return `${flash(ctx)}<div class="head"><div><h1>Assistant</h1>
    <p class="muted" style="margin:.25rem 0 0">${listTools().length} tools across ${Object.keys(counts).length} areas. Every call is validated against its schema and audited; it edits the draft, and publishing is yours.</p></div></div>
  <div class="grid2"><div>
    <form class="card" method="post" action="/admin/ask" id="ai-composer"><div class="eyebrow">Ask storemill</div><input type="hidden" name="page" value="ai"><textarea id="ai-ask" aria-label="Message assistant" name="text" rows="3" required autofocus placeholder="What should I build, change, or check?"></textarea><div class="row" style="justify-content:space-between;margin-top:.55rem"><span class="muted" style="font-size:11.5px">Requests run in order, so you can queue the next job while one is working.</span><div class="row"><button class="btn" id="ai-voice" type="button">${uiIcon('mic', 15)} Dictate</button><button class="btn primary" type="submit">${uiIcon('send', 14)} Queue request</button></div></div></form>
    <script>(function(){var button=document.getElementById('ai-voice');var Speech=window.SpeechRecognition||window.webkitSpeechRecognition;if(!Speech){button.disabled=true;button.title='Voice input is not supported in this browser';return}button.addEventListener('click',function(){var r=new Speech();r.lang='en-US';button.textContent='Listening…';r.onresult=function(e){var box=document.getElementById('ai-ask');box.value=(box.value+' '+e.results[0][0].transcript).trim()};r.onend=function(){button.textContent='Dictate'};r.onerror=r.onend;r.start()})})();</script>
    ${queue.length ? `<div class="card"><h2>Request queue</h2>${queue.map((request) => `<div class="row" style="justify-content:space-between;border-top:1px solid var(--line);padding:.55rem 0"><span style="min-width:0"><strong style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px">${escapeHtml(request.text)}</strong><small class="muted">${request.createdAt.slice(11, 19)} · ${escapeHtml(request.page || 'global')}</small></span><span class="row"><span class="tag ${request.status === 'completed' ? 'ok' : request.status === 'failed' ? 'bad' : request.status === 'running' ? 'warn' : ''}">${request.status}</span>${request.status === 'queued' ? `<form method="post" action="/admin/assistant/queue/${escapeHtml(request.id)}/cancel"><button class="btn" type="submit">Cancel</button></form>` : ''}</span></div>`).join('')}</div>` : ''}
    <div class="card" style="max-height:56vh;overflow:auto">
      ${messages.length ? messages.map((message) => `<div style="margin-bottom:1rem">
        <div class="eyebrow">${message.role === 'user' ? 'You' : 'Assistant'}${message.page ? ` · ${escapeHtml(message.page)}` : ''}</div>
        <div style="margin-top:.3rem;white-space:pre-wrap">${escapeHtml(message.content)}</div>
        ${message.artifacts.map(renderArtifact).join('')}</div>`).join('')
        : '<p class="muted">Nothing yet. Start with a plain-English request above.</p>'}${messages.length >= 60 ? `<a class="btn" href="/admin/ai?before=${encodeURIComponent(messages[0]?.createdAt ?? '')}">Load older messages</a>` : ''}</div>
    <div class="card"><h2>Prompt library</h2>
      <div class="row" style="margin-top:.5rem">${PROMPT_LIBRARY.map((prompt) => `<button class="btn" type="button" onclick="askThis(${escapeHtml(JSON.stringify(prompt))})">${escapeHtml(prompt)}</button>`).join('')}</div></div>
  </div>
  <div>
    <div class="card"><h2>Tools by area</h2>
      <div class="bars" style="margin-top:.6rem">${Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([area, count]) => `<div class="barrow"><span>${escapeHtml(area)}</span>
          <span class="track"><span class="fill" style="width:${(count / Math.max(...Object.values(counts))) * 100}%"></span></span><span>${count}</span></div>`)
        .join('')}</div></div>
    <div class="card"><h2>Recent runs</h2>
      ${runs.map((run) => `<div style="border-top:1px solid var(--line);padding:.5rem 0">
        <div class="row" style="justify-content:space-between"><span style="font-size:12.5px">${escapeHtml(run.prompt.slice(0, 60))}</span>
          <span class="tag ${run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'bad' : 'warn'}">${run.status}</span></div>
        <div class="muted" style="font-size:11.5px">${run.steps.map((step) => `${escapeHtml(step.tool)}${step.status === 'failed' ? ' ✗' : ''}`).join(' · ')}</div></div>`).join('')
        || '<p class="muted" style="font-size:12px">No runs yet.</p>'}</div>
  </div></div>`
}
