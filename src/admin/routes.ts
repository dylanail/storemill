import { pageRevisionToken } from '../pages/revision-token.ts'
import { startHealthFix, healthFix, undoHealthFix } from '../storefront/health-fixes.ts'
import { duplicateWholeFunnel } from '../pages/funnel-clone.ts'
import { rebrandForm, rebrandReview } from './media-rebrand-page.ts'
import { startRebrand, getRebrand, applyRebrand, undoRebrand, cancelRebrand } from '../control/media-rebrand.ts'
import type { RebrandSpec } from '../control/media-render.ts'
import { saveMediaUpload } from '../lib/uploads.ts'
import { deleteAsset, assetImpact, deletionToken } from '../control/delete-asset.ts'
import { deleteAssetPage } from './delete-asset-page.ts'
import { assistantMessages } from './shell.ts'
import { captureAssistantContext } from '../agent/context.ts'
import { listPages } from '../pages/store.ts'
import { cleanSourceTheme, fontFacesFromHtml } from '../pages/source-theme.ts'
import { duplicateAsset } from '../control/duplicate-asset.ts'
import { blockPage as renderBlockPreview } from '../storefront/render.ts'
import { storeViewFor } from '../storefront/routes.ts'
import { pageProductData } from '../pages/product-data.ts'
import { getDb } from '../lib/db.ts'
import { badRequest, escapeHtml, forbidden, html, notFound, Raw, redirect, Router, setCookie, sse, unauthorized, type Ctx } from '../lib/http.ts'
import { acceptInvite, endSession, login, register, requireRole, requireUser, resetPassword, SESSION_COOKIE, startPasswordReset, startSession, updateProfile, userFor, userForReset, inviteTeammate } from '../control/auth.ts'
import { environment, getStore, listStores, publish, publishState, rollback, setTheme, updateStore, verifyDomain, type Store } from '../control/stores.ts'
import { attachDomain, checkDomain, removeDomain, type DomainMode } from '../control/domains.ts'
import { deleteAd, draftAds, getAd, reviseAd, saveAd, saveInspiration, deleteInspiration, readInspiration, type AdPlatform } from '../agent/ads.ts'
import { deleteAvatar, saveAvatar, suggestAvatars } from '../agent/avatars.ts'
import { applyCompetitor, deleteCompetitor, getCompetitor, readCompetitor, saveCompetitor, type AngleKind } from '../agent/angles.ts'
import * as growth from './growth-pages.ts'
import { install, invalidateStorefrontConfig, uninstall } from '../control/plugins.ts'
import { catalog, modelFor, parseChoice, TASKS, type Task } from '../agent/models.ts'
import { listTodos, recordAudit, refreshTodos, seedTodos } from '../control/todos.ts'
import { createCollection, listProducts, updateProduct, updateVariant } from '../domain/catalog.ts'
import { fulfillOrder, refundOrder } from '../domain/orders.ts'
import { createPromotion, setPromotionStatus } from '../domain/promotions.ts'
import { moderate } from '../domain/reviews.ts'
import { getSend } from '../email/send.ts'
import { history } from '../agent/chat.ts'
import { cancelAssistantRequest, drainAssistantQueue, enqueueAssistantRequest, listAssistantQueue } from '../agent/queue.ts'
import { execute } from '../agent/registry.ts'
import { saveUpload, UploadError } from '../lib/uploads.ts'
import { createPage, deletePage, duplicatePage, ensurePageRevision, getPage, listPageRevisions, pageRole, pageTemplate, restorePageRevision, savePageRevision, updatePage, type Page } from '../pages/store.ts'
import { clonePage } from '../pages/clone.ts'
import { readCopyReport, saveCopyReport } from '../pages/clone-report.ts'
import { copyReportPage } from './copy-report-page.ts'
import { installImportedBundle, planImportedBundle, repairImportedBundleHtml } from '../pages/imported-bundles.ts'
import { blockDefinition } from '../pages/blocks.ts'
import { removeBundle, upsertBundle, type BundleTier } from '../domain/bundles.ts'
import { latestResearch } from '../agent/research.ts'
import { getProduct } from '../domain/catalog.ts'
import { editorPage } from './editor.ts'
import { refundThroughProvider, stripeFor } from '../payments/stripe.ts'
import { getOrder, markDelivered, recordSupplierOrder } from '../domain/orders.ts'
import { answerQuestion, hideQuestion, importReviews, markStockAlertsNotified, pendingStockAlerts, recordAdSpend } from '../domain/ops.ts'
import { deleteFunnel, upsertFunnel } from '../domain/funnels.ts'
import { generateVersions, setVersionWeight } from '../pages/versions.ts'
import { analyzeExperiment, pauseExperiment, promoteExperiment, rollbackExperiment, startPdpExperiment } from '../analytics/experiments.ts'
import { sendAccountEmail, sendEmail, orderContext } from '../email/send.ts'
import { getVariant } from '../domain/catalog.ts'
import { onActivity, recentActivity } from '../agent/events.ts'
import { buildTicket, startOnboarding } from '../agent/onboarding.ts'
import * as pages from './pages.ts'
import { shell } from './shell.ts'
import { authPage, buildingPage, forgotPage, onboardingPage, resetPage } from './auth-pages.ts'
import * as plan from './plan-pages.ts'
import { modeById, QUESTIONS, saveAnswers, setBuildMode, setSiteShape, skipStep, type BuildMode } from '../control/build.ts'
import { deleteDoc, runAdPlan, runAnalysis, runOverview, saveLoop, suggestSubAvatars, updatePlanRow, type AdPlanRow } from '../agent/market.ts'
import { deleteQueueItem, getQueueItem, labelShot, PAGE_GOALS, PHOTO_BRIEFS, queuePhotoBriefs, queueUgcConcepts, setQueueStatus, suggestBlocks, type PageGoal } from '../creative/briefs.ts'
import { approveGif, makeProductGif } from '../creative/product-gif.ts'
import { ripToPage } from '../pages/rip.ts'
import { newBlock } from '../pages/store.ts'
import { customCatalog, customDefinitions, deleteCustomBlock, upsertCustomBlock } from '../pages/custom-blocks.ts'
import { deleteBlockPreset, listBlockPresets, saveBlockPreset } from '../pages/presets.ts'
import type { CustomField } from '../pages/blocks.ts'
import { listAvatars, getAvatar } from '../agent/avatars.ts'
import { saveLegal } from '../storefront/legal.ts'
import { registerOrderTracking } from '../shipping/seventeen-track.ts'
import { exportStore } from '../control/export.ts'
import { createRegion, deleteRegion, deleteShippingOption, getRegion, setShippingOption, updateRegion, updateShippingOption } from '../domain/regions.ts'
import { listFlows, runFlow, updateFlow } from '../email/flows.ts'
import { createBlankAsset, fontFamilyName, importAssetFromUrl } from '../control/assets.ts'
import { createArticle, createBlog, deleteArticle, deleteBlog, listBlogs, updateArticle } from '../domain/content.ts'
import { qualifyCatalogProduct, TRENDS, writeQualifyNotes } from '../domain/qualify.ts'
import { deletePageTemplate, getPageTemplate, listPageTemplates, savePageTemplate, templateBlocks, templateHtml, usePageTemplate } from '../pages/library.ts'
import { templateLibraryPage } from './library-page.ts'

const STORE_COOKIE = 'amboras_store'
const INVITE_COOKIE = 'amboras_invite'
const pendingBuild = new Map<string, { mode: string; shape: 'store' | 'funnel' }>()

type Session = { user: { id: string; name: string; email: string }; store: Store; stores: Store[] }

function session(ctx: Ctx): Session {
  const db = getDb()
  const user = requireUser(db, ctx)
  const stores = listStores(db, user.id)
  if (!stores.length) throw new NoStores()
  const wanted = ctx.query.get('storeId') ?? ctx.cookies[STORE_COOKIE]
  const store = stores.find((entry) => entry.id === wanted) ?? (stores[0] as Store)
  requireRole(db, user.id, store.id)
  return { user, store, stores }
}

function adminSession(ctx: Ctx): Session {
  const current = session(ctx)
  requireRole(getDb(), current.user.id, current.store.id, 'admin')
  return current
}

function redeemPendingInvite(ctx: Ctx, userId: string) {
  const invite = ctx.cookies[INVITE_COOKIE]
  if (!invite) return
  acceptInvite(getDb(), userId, invite)
  setCookie(ctx.res, INVITE_COOKIE, '', { maxAge: 0 })
}

class NoStores extends Error {}

function page(ctx: Ctx, current: Session, active: string, title: string, body: string) {
  const db = getDb()
  seedTodos(db, current.store.id)
  refreshTodos(db, current.store.id)
  return html(
    shell({
      store: current.store,
      stores: current.stores,
      active,
      title,
      body,
      todos: listTodos(db, current.store.id),
      messages: history(db, current.store.id, 20),
      queue: listAssistantQueue(db, current.store.id, 8),
      publish: publishState(db, current.store.id),
      userName: current.user.name || current.user.email.split('@')[0] || 'there',
      storeUrl: storeUrl(ctx, current.store),
      modelLabel: (() => {
        const choice = modelFor(db, current.store.id, 'planner')
        return choice ? `Answering with ${choice.model}` : 'No model key set: a short list of patterns answers instead'
      })(),
    }),
  )
}

function storeUrl(ctx: Ctx, store: Store): string {
  const root = process.env.AMBORAS_STOREFRONT_HOST
  if (root) return `${ctx.url.protocol}//${store.slug}.${root}`
  return `/s/${store.slug}`
}

function publicUrl(ctx: Ctx, store: Store): string {
  const url = storeUrl(ctx, store)
  return url.startsWith('http') ? url : `${process.env.AMBORAS_PUBLIC_ORIGIN ?? ctx.url.origin}${url}`
}

function back(ctx: Ctx, message?: string): ReturnType<typeof redirect> {
  const target = String(ctx.req.headers.referer ?? '/admin')
  const url = new URL(target, ctx.url.origin)
  if (message) url.searchParams.set('flash', message)
  return redirect(`${url.pathname}${url.search}`)
}

function ctxFor(current: Session, ctx: Ctx) {
  return {
    db: getDb(),
    store: current.store,
    userName: current.user.name || 'there',
    userEmail: current.user.email,
    storeUrl: storeUrl(ctx, current.store),
    ...(ctx.query.get('flash') ? { flash: ctx.query.get('flash') as string } : {}),
  }
}

const range = (ctx: Ctx) => {
  const value = ctx.query.get('range') ?? '7d'
  return (['24h', '7d', '30d', '90d'] as const).includes(value as never) ? (value as '7d') : '7d'
}

export function adminRouter(): Router {
  const router = new Router()
  const db = () => getDb()

  /* ------------------------------------------------------------------- auth */

  router.get('/login', (ctx) => (userFor(db(), ctx) ? redirect('/admin') : html(authPage('login', ctx.query.get('error')))))
  router.get('/register', (ctx) => (userFor(db(), ctx) ? redirect('/admin') : html(authPage('register', ctx.query.get('error')))))

  router.post('/login', async (ctx) => {
    const body = await ctx.body()
    try {
      const user = login(db(), String(body.email ?? ''), String(body.password ?? ''))
      redeemPendingInvite(ctx, user.id)
      setCookie(ctx.res, SESSION_COOKIE, startSession(db(), user.id), { maxAge: 60 * 60 * 24 * 30 })
      return redirect('/admin')
    } catch (error) {
      return redirect(`/login?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not sign in')}`)
    }
  })

  router.get('/forgot', (ctx) =>
    userFor(db(), ctx) ? redirect('/admin') : html(forgotPage({ error: ctx.query.get('error'), sent: ctx.query.get('sent') === '1', logged: ctx.query.get('logged') === '1' })),
  )

  router.post('/forgot', async (ctx) => {
    const body = await ctx.body()
    const email = String(body.email ?? '').trim().toLowerCase()
    const started = email ? startPasswordReset(db(), email) : null
    let delivery: 'sent' | 'logged' | 'failed' = 'sent'
    if (started) {
      const origin = process.env.AMBORAS_PUBLIC_ORIGIN || ctx.url.origin
      const link = `${origin}/reset?token=${encodeURIComponent(started.token)}`
      delivery = await sendAccountEmail({
        to: started.user.email,
        subject: 'Reset your storemill password',
        html: `<p><img src="${escapeHtml(origin)}/_brand/storemill-logo.png" alt="storemill" width="180" height="48" style="display:block;object-fit:contain"></p><p>Someone asked to reset the password for this account.</p><p><a href="${escapeHtml(link)}">Choose a new password</a></p><p>The link works once and expires in an hour.</p>`,
      })
    }
    return redirect(`/forgot?sent=1${delivery === 'logged' ? '&logged=1' : ''}`)
  })

  router.get('/reset', (ctx) => {
    const value = ctx.query.get('token') ?? ''
    const user = value ? userForReset(db(), value) : null
    if (!user) return redirect(`/forgot?error=${encodeURIComponent('That reset link has expired or has already been used. Ask for another.')}`)
    return html(resetPage({ token: value, email: user.email, error: ctx.query.get('error') }))
  })

  router.post('/reset', async (ctx) => {
    const body = await ctx.body()
    const value = String(body.token ?? '')
    try {
      const user = resetPassword(db(), value, String(body.password ?? ''))
      setCookie(ctx.res, SESSION_COOKIE, startSession(db(), user.id), { maxAge: 60 * 60 * 24 * 30 })
      return redirect(`/admin?flash=${encodeURIComponent('Password changed. Every other signed-in device has been signed out.')}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not change the password'
      return redirect(userForReset(db(), value) ? `/reset?token=${encodeURIComponent(value)}&error=${encodeURIComponent(message)}` : `/forgot?error=${encodeURIComponent(message)}`)
    }
  })

  router.post('/register', async (ctx) => {
    const body = await ctx.body()
    try {
      const user = register(db(), { email: String(body.email ?? ''), password: String(body.password ?? ''), name: String(body.name ?? '') })
      redeemPendingInvite(ctx, user.id)
      setCookie(ctx.res, SESSION_COOKIE, startSession(db(), user.id), { maxAge: 60 * 60 * 24 * 30 })
      return redirect('/onboarding')
    } catch (error) {
      return redirect(`/register?error=${encodeURIComponent(error instanceof Error ? error.message : 'Could not register')}`)
    }
  })

  router.get('/join/:token', (ctx) => {
    const invite = ctx.params.token as string
    const user = userFor(db(), ctx)
    if (!user) {
      setCookie(ctx.res, INVITE_COOKIE, invite, { maxAge: 60 * 60 * 24 * 7 })
      return redirect(`/register?error=${encodeURIComponent('Create an account with the address you were invited at, and you will join the asset.')}`)
    }
    const joined = acceptInvite(db(), user.id, invite)
    setCookie(ctx.res, INVITE_COOKIE, '', { maxAge: 0 })
    return redirect(`/admin/stores?flash=${encodeURIComponent(joined ? 'You are on the team.' : '!That invite is no longer valid.')}`)
  })

  router.post('/logout', (ctx) => {
    const secret = ctx.cookies[SESSION_COOKIE]
    if (secret) endSession(db(), secret)
    setCookie(ctx.res, SESSION_COOKIE, '', { maxAge: 0 })
    return redirect('/login')
  })

  /* ------------------------------------------------------------- onboarding */

  router.get('/onboarding', (ctx) => {
    const user = requireUser(db(), ctx)
    return html(onboardingPage(user.name || user.email, ctx.query.get('error'), listStores(db(), user.id).length > 0))
  })

  router.post('/onboarding', async (ctx) => {
    const user = requireUser(db(), ctx)
    const body = await ctx.body()
    const files = await ctx.files()
    const prompt = String(body.prompt ?? '').trim()
    if (prompt.length < 12) return redirect(`/onboarding?error=${encodeURIComponent('Say a little more — one sentence about what you sell.')}`)
    const siteUrl = String(body.siteUrl ?? '').trim()
    if (siteUrl && !/^https?:\/\/[^\s]+$/i.test(siteUrl)) return redirect(`/onboarding?error=${encodeURIComponent('That site address does not look right — include https://')}`)
    // The upload is saved under a store id that does not exist yet; the store
    // row is created a moment later. Order does not matter for a disk path.
    const pendingStoreId = `pending_${user.id.slice(4, 12)}`
    let referenceImage: string | undefined
    try {
      if (files.photo) referenceImage = saveUpload(files.photo, pendingStoreId).url
    } catch (error) {
      if (error instanceof UploadError) return redirect(`/onboarding?error=${encodeURIComponent(error.message)}`)
      throw error
    }
    const ticket = startOnboarding(db(), {
      ownerId: user.id,
      prompt,
      ...(referenceImage ? { referenceImage } : {}),
      ...(siteUrl ? { referenceUrl: siteUrl } : {}),
    })
    pendingBuild.set(ticket.id, { mode: String(body.mode ?? 'own-product'), shape: body.shape === 'funnel' ? 'funnel' : 'store' })
    return redirect(`/onboarding/building?t=${encodeURIComponent(ticket.id)}`)
  })

  router.get('/onboarding/building', (ctx) => {
    const user = requireUser(db(), ctx)
    const ticket = buildTicket(ctx.query.get('t') ?? '', user.id)
    if (!ticket) return redirect('/onboarding')
    return html(buildingPage(ticket))
  })

  router.get('/onboarding/status', (ctx) => {
    const user = requireUser(db(), ctx)
    const ticket = buildTicket(ctx.query.get('t') ?? '', user.id)
    if (!ticket) return { state: 'failed', error: 'That build is not in flight any more.' }
    if (ticket.state === 'done' && ticket.storeId) {
      const selected = pendingBuild.get(ticket.id) ?? { mode: 'own-product', shape: 'store' as const }
      const mode = modeById(selected.mode) ?? modeById('own-product')
      if (mode) setBuildMode(db(), ticket.storeId, mode.id)
      setSiteShape(db(), ticket.storeId, { shape: selected.shape })
      pendingBuild.delete(ticket.id)
      setCookie(ctx.res, STORE_COOKIE, ticket.storeId, { maxAge: 60 * 60 * 24 * 365 })
      const note = ticket.failures.length
        ? `${ticket.storeName} is built as a ${selected.shape}, but ${ticket.failures.length} step${ticket.failures.length === 1 ? '' : 's'} failed: ${ticket.failures.slice(0, 2).join('; ')}.`
        : `${ticket.storeName} is built as a ${selected.shape} — ${ticket.summaries.length} steps ran.`
      return { state: 'done', stage: ticket.stage, next: `/admin?flash=${encodeURIComponent(note)}` }
    }
    return { state: ticket.state, stage: ticket.stage, error: ticket.error }
  })

  /* ------------------------------------------------------------------ pages */

  router.get('/admin', (ctx) => {
    const current = session(ctx)
    setCookie(ctx.res, STORE_COOKIE, current.store.id, { maxAge: 60 * 60 * 24 * 365 })
    return page(ctx, current, 'dashboard', 'Dashboard', pages.dashboard(ctxFor(current, ctx), range(ctx)))
  })

  router.get('/admin/cro', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'cro', 'Experiments', pages.experimentsPage(ctxFor(current, ctx)))
  })

  router.post('/admin/cro/generate', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const count = Math.min(4, Math.max(2, Number(body.count ?? 3) || 3))
      const generated = await generateVersions(db(), current.store, {
        productId: String(body.productId ?? ''),
        kind: 'pdp',
        count,
        publish: true,
        ...(body.model ? { model: String(body.model) } : {}),
      })
      const experiment = startPdpExperiment(db(), current.store.id, {
        productId: String(body.productId ?? ''),
        pageIds: generated.map((entry) => entry.id),
        hypothesis: String(body.hypothesis ?? ''),
        autoPromote: body.autoPromote === 'true',
        minViews: Number(body.minViews ?? 75),
      })
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'start_experiment', target: experiment.id, diff: { productId: body.productId, pages: generated.map((entry) => entry.id), autoPromote: experiment.results.autoPromote } })
      return redirect(`/admin/cro?flash=${encodeURIComponent(`Test started across ${generated.length} page angles. storemill will wait for real evidence before choosing.`)}`)
    } catch (error) {
      return redirect(`/admin/cro?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not start the experiment'}`)}`)
    }
  })

  router.post('/admin/cro/:id/evaluate', (ctx) => {
    const current = session(ctx)
    try {
      const experiment = analyzeExperiment(db(), current.store.id, ctx.params.id as string)
      return redirect(`/admin/cro?flash=${encodeURIComponent(experiment.status === 'promoted' ? 'The evidence threshold was met, so the winner was promoted.' : experiment.results.reason ?? 'Evidence recalculated.')}`)
    } catch (error) {
      return redirect(`/admin/cro?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not evaluate the experiment'}`)}`)
    }
  })

  router.post('/admin/cro/:id/pause', (ctx) => {
    const current = session(ctx)
    try {
      const experiment = pauseExperiment(db(), current.store.id, ctx.params.id as string)
      return redirect(`/admin/cro?flash=${encodeURIComponent(experiment.status === 'paused' ? 'Automatic decisions paused; the traffic split stays in place.' : 'Automatic decisions resumed.')}`)
    } catch (error) {
      return redirect(`/admin/cro?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not change the experiment'}`)}`)
    }
  })

  router.post('/admin/cro/:id/promote', (ctx) => {
    const current = session(ctx)
    try {
      const experiment = promoteExperiment(db(), current.store.id, ctx.params.id as string)
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'promote_experiment', target: experiment.id, diff: { winnerId: experiment.results.winnerId } })
      return redirect('/admin/cro?flash=' + encodeURIComponent('Winner promoted to 100% of traffic. The prior split is saved for rollback.'))
    } catch (error) {
      return redirect(`/admin/cro?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not promote the winner'}`)}`)
    }
  })

  router.post('/admin/cro/:id/rollback', (ctx) => {
    const current = session(ctx)
    try {
      const experiment = rollbackExperiment(db(), current.store.id, ctx.params.id as string)
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'rollback_experiment', target: experiment.id, diff: { restored: experiment.results.previousWeights } })
      return redirect('/admin/cro?flash=' + encodeURIComponent('Previous traffic weights restored exactly.'))
    } catch (error) {
      return redirect(`/admin/cro?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not roll back'}`)}`)
    }
  })

  router.get('/admin/stores', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'stores', 'All assets', pages.storesPage(ctxFor(current, ctx), current.stores))
  })

  router.get('/admin/stores/:id/delete',ctx=>{
    const current=session(ctx),storeId=ctx.params.id as string;requireRole(db(),current.user.id,storeId,'owner');
    const store=getStore(db(),storeId)!;return page(ctx,current,'stores','Delete asset',deleteAssetPage(store,assetImpact(db(),storeId),deletionToken(store,current.user.id,ctx.cookies[SESSION_COOKIE]||'')));
  });
  router.post('/admin/stores/:id/delete',async ctx=>{
    const user=requireUser(db(),ctx),storeId=ctx.params.id as string;requireRole(db(),user.id,storeId,'owner');const body=await ctx.body();
    login(db(),user.email,String(body.password||''));
    const store=deleteAsset(db(),user.id,storeId,{name:String(body.name||''),acknowledged:body.acknowledged==='yes',token:String(body.token||''),session:ctx.cookies[SESSION_COOKIE]||''});
    const next=listStores(db(),user.id)[0];if(ctx.cookies[STORE_COOKIE]===storeId)setCookie(ctx.res,STORE_COOKIE,next?.id||'',{maxAge:next?60*60*24*365:0});
    return redirect((next?'/admin/stores':'/onboarding')+'?flash='+encodeURIComponent(store.name+' was deleted.'));
  });

  router.post('/admin/stores/:id/duplicate', async (ctx) => {
    const user = requireUser(db(), ctx), storeId = ctx.params.id as string
    requireRole(db(), user.id, storeId, 'admin')
    const body = await ctx.body()
    try {
      const result = duplicateAsset(db(), user.id, storeId, { name: String(body.name ?? '').trim() || undefined, origin: ctx.url.origin })
      setCookie(ctx.res, STORE_COOKIE, result.store.id, { maxAge: 60 * 60 * 24 * 365 })
      recordAudit(db(), { storeId: result.store.id, actorType: 'user', actorId: user.id, action: 'duplicate_asset', target: storeId, diff: { pages: result.pages.length, products: result.products.length, funnels: result.funnels.length } })
      return redirect('/admin/pages?flash=' + encodeURIComponent(`Duplicated all ${result.pages.length} pages and ${result.products.length} products into ${result.store.name}. ${result.notes.join(' ')}`))
    } catch (error) { return redirect('/admin/stores?flash=' + encodeURIComponent(error instanceof Error ? error.message : String(error))) }
  })

  router.post('/admin/stores/:id/status', async (ctx) => {
    const user = requireUser(db(), ctx)
    const storeId = ctx.params.id as string
    requireRole(db(), user.id, storeId, 'admin')
    const body = await ctx.body()
    const wanted = String(body.status ?? '')
    if (wanted !== 'live' && wanted !== 'paused') throw badRequest('An asset is either live or paused.')
    const store = getStore(db(), storeId)
    if (!store) throw notFound('No such asset')
    if (wanted === 'live' && !environment(db(), storeId, 'live').publishedAt) {
      return redirect(`/admin/stores?flash=${encodeURIComponent('!That asset has never been published. Open it and publish it first.')}`)
    }
    updateStore(db(), storeId, { status: wanted })
    recordAudit(db(), { storeId, actorType: 'user', actorId: user.id, action: wanted === 'paused' ? 'pause_asset' : 'reopen_asset' })
    return redirect(`/admin/stores?flash=${encodeURIComponent(wanted === 'paused' ? `${store.name} is paused.` : `${store.name} is live again.`)}`)
  })

  router.post('/admin/assets/create', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const kind = body.kind === 'funnel' ? 'funnel' : 'store'
      const asset = createBlankAsset(db(), current.user.id, { name: String(body.name ?? ''), kind, currency: String(body.currency ?? 'USD') })
      setCookie(ctx.res, STORE_COOKIE, asset.id, { maxAge: 60 * 60 * 24 * 365 })
      recordAudit(db(), { storeId: asset.id, actorType: 'user', actorId: current.user.id, action: 'create_asset', target: asset.id, diff: { kind } })
      return redirect(`/admin?flash=${encodeURIComponent(`${asset.name} is ready as a blank ${kind}.`)}`)
    } catch (error) {
      return redirect(`/admin/stores?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not create the asset'}`)}`)
    }
  })

  router.post('/admin/assets/import', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const controller = new AbortController()
    const abort = () => controller.abort()
    ctx.req.once('aborted', abort)
    ctx.res.once('close', abort)
    try {
      const kind = body.kind === 'funnel' ? 'funnel' : 'store'
      const imported = await importAssetFromUrl(db(), current.user.id, { url: String(body.url ?? ''), name: String(body.name ?? ''), kind, currency: String(body.currency ?? 'USD'), additionalUrls: String(body.additionalUrls ?? '').split(/\r?\n/).map(url => url.trim()).filter(Boolean), signal: controller.signal })
      setCookie(ctx.res, STORE_COOKIE, imported.store.id, { maxAge: 60 * 60 * 24 * 365 })
      recordAudit(db(), { storeId: imported.store.id, actorType: 'user', actorId: current.user.id, action: 'clone_asset', target: imported.clone.sourceUrl, diff: { kind, pageId: imported.page.id, products: imported.products.length, stylesheets: imported.clone.stylesheets, images: imported.clone.imagesLocalized, report: imported.report } })
      return redirect(`/admin/pages/${imported.page.id}/edit?flash=${encodeURIComponent(`Cloned ${imported.pages.length} page${imported.pages.length === 1 ? '' : 's'} and ${imported.products.length} product${imported.products.length === 1 ? '' : 's'} into a new ${kind}. ${imported.clone.stylesheets} stylesheets and ${imported.clone.imagesLocalized} images were copied. ${imported.report.complete ? 'All discovered pages and images copied.' : 'Copy needs review: some pages, images or embedded content could not be verified.'} Open View copy report in Page settings for details.`)}`)
    } catch (error) {
      return redirect(`/admin/stores?flash=${encodeURIComponent(`!Could not clone that asset: ${error instanceof Error ? error.message : 'unknown error'}`)}`)
    } finally {
      ctx.req.removeListener('aborted', abort)
      ctx.res.removeListener('close', abort)
    }
  })

  router.get('/admin/media', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'media', 'Media', pages.mediaPage(ctxFor(current, ctx)))
  })

  const mediaMutation = (ctx: Ctx) => {
    if (ctx.req.headers.origin && new URL(ctx.req.headers.origin).host !== ctx.url.host) throw forbidden('Open Media in Storemill to make this change')
  }
  router.get('/admin/media/rebrand', (ctx) => {
    const current = session(ctx), again = ctx.query.get('again')
    const previous = again ? getRebrand(db(), current.store.id, again) : undefined
    return page(ctx, current, 'media', 'Rebrand media', rebrandForm(db(), current.store, ctx.query.get('source') || '', previous))
  })
  router.post('/admin/media/rebrand', async (ctx) => {
    const current = session(ctx)
    try {
      mediaMutation(ctx)
      const body = await ctx.body(), files = await ctx.files()
      const logo = files.logoFile?.data.length ? saveUpload(files.logoFile, current.store.id).url : String(body.logo || '')
      const job = startRebrand(db(), current.store.id, current.user.id, String(body.source || ''), {
        brandName: String(body.brandName || ''), logo, oldBrand: String(body.oldBrand || ''), direction: String(body.direction || ''),
        method: String(body.method || 'ai') as RebrandSpec['method'], provider: String(body.provider || (process.env.OPENAI_API_KEY ? 'openai' : 'google')) as RebrandSpec['provider'],
        position: String(body.position || 'bottom-right') as RebrandSpec['position'], width: Number(body.width ?? 18), frame: Number(body.frame ?? 0),
      }, String(body.requestKey || ''))
      const url = `/admin/media/rebrand/${job.id}?storeId=${current.store.id}`
      return ctx.req.headers.accept?.includes('application/json') ? { url } : redirect(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not start this edit'
      return new Raw(JSON.stringify({ error: message }), 'application/json', {}, 400)
    }
  })
  router.get('/admin/media/rebrand/:id', (ctx) => {
    const current = session(ctx), job = getRebrand(db(), current.store.id, ctx.params.id || '')
    return page(ctx, current, 'media', 'Media preview', rebrandReview(db(), current.store, job, ctx.query.get('flash') || ''))
  })
  router.get('/admin/media/rebrand/:id/status', (ctx) => {
    const current = session(ctx), job = getRebrand(db(), current.store.id, ctx.params.id || '')
    return new Raw(JSON.stringify({ status: job.status, phase: job.phase }), 'application/json', { 'Cache-Control': 'no-store' })
  })
  for (const action of ['apply', 'undo', 'cancel'] as const) router.post(`/admin/media/rebrand/:id/${action}`, async (ctx) => {
    const current = session(ctx), jobId = ctx.params.id || ''
    let message = ''
    try {
      mediaMutation(ctx)
      if (action === 'apply') { const body = await ctx.body(); const count = applyRebrand(db(), current.store.id, current.user.id, jobId, String(body.token || '')); message = `Updated ${count} records in this asset. You can undo this replacement below.` }
      else if (action === 'undo') { undoRebrand(db(), current.store.id, current.user.id, jobId); message = 'Original media restored.' }
      else { await cancelRebrand(db(), current.store.id, current.user.id, jobId); message = 'Edit cancelled. Your original has been kept.' }
    } catch (error) { message = '!' + (error instanceof Error ? error.message : 'Could not complete this action') }
    return redirect(`/admin/media/rebrand/${jobId}?storeId=${current.store.id}&flash=${encodeURIComponent(message)}`)
  })

  router.post('/admin/media/upload', async (ctx) => {
    const current = session(ctx)
    const files = await ctx.files()
    if (!files.image) return redirect('/admin/media?flash=' + encodeURIComponent('!Choose an image or video first.'))
    try {
      mediaMutation(ctx)
      const saved = saveMediaUpload(files.image, current.store.id)
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'upload_media', target: saved.url, diff: { type: saved.type, bytes: files.image.data.length } })
      return redirect('/admin/media?flash=' + encodeURIComponent('Media added to this asset.'))
    } catch (error) {
      return redirect(`/admin/media?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Upload failed'}`)}`)
    }
  })

  router.get('/admin/research', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'research', 'Customer research', pages.researchPage(ctxFor(current, ctx)))
  })

  router.post('/admin/research/run', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const result = await execute(
        'run_customer_research',
        { brief: String(body.brief ?? ''), siteUrl: String(body.siteUrl ?? ''), rewritePages: body.rewritePages === 'true' },
        { db: db(), storeId: current.store.id, actor: { type: 'user', id: current.user.id }, page: 'research' },
      )
      return back(ctx, result.summary)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Research failed'}`)
    }
  })

  router.post('/admin/products/:id/photo', async (ctx) => {
    const current = session(ctx)
    const files = await ctx.files()
    const body = await ctx.body()
    if (!files.photo) return back(ctx, '!Choose an image first.')
    try {
      const saved = saveUpload(files.photo, current.store.id)
      const shot = String(body.shot ?? '').trim().toLowerCase()
      const result = await execute(
        'attach_product_photo',
        { productId: ctx.params.id as string, upload: saved.url, preset: String(body.preset ?? 'white-seamless'), ...(shot ? { shot } : {}) },
        { db: db(), storeId: current.store.id, actor: { type: 'user', id: current.user.id }, page: 'products' },
      )
      return back(ctx, result.summary)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Upload failed'}`)
    }
  })

  router.post('/admin/products/:id/media/label', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const product = getProduct(db(), current.store.id, ctx.params.id as string)
    if (!product) return back(ctx, '!No such product')
    const url = String(body.mediaUrl ?? '')
    const shot = String(body.shot ?? '').trim().toLowerCase()
    if (shot && !PHOTO_BRIEFS.some((brief) => brief.id === shot)) return back(ctx, '!That is not one of the briefs.')
    if (!product.media.some((entry) => entry.url === url)) return back(ctx, '!That image is not on this product.')
    updateProduct(db(), current.store.id, product.id, { media: product.media.map((entry) => entry.url === url ? { ...entry, alt: labelShot(entry.alt, shot) } : entry) })
    const brief = PHOTO_BRIEFS.find((entry) => entry.id === shot)
    return back(ctx, brief ? `Labelled as "${brief.name}".` : 'Label removed.')
  })

  router.post('/admin/products/:id/qualify', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const product = getProduct(db(), current.store.id, ctx.params.id as string)
    if (!product) return back(ctx, '!No such product')
    const trend = String(body.trend ?? 'unknown')
    const number = (key: string) => Math.max(0, Math.round(Number(body[key] ?? 0)) || 0)
    const notes = {
      ...(TRENDS.includes(trend as (typeof TRENDS)[number]) ? { trend: trend as (typeof TRENDS)[number] } : {}),
      ...(number('weightGrams') ? { weightGrams: number('weightGrams') } : {}),
      ...(number('aovCents') ? { aovCents: number('aovCents') } : {}),
      ...(body.seasonal === 'true' ? { seasonal: true } : {}), ...(body.tech === 'true' ? { tech: true } : {}),
      ...(body.patented === 'true' ? { patented: true } : {}), ...(body.bigBrand === 'true' ? { bigBrand: true } : {}),
      ...(body.printOnDemand === 'true' ? { printOnDemand: true } : {}),
      ...(String(body.standOut ?? '').trim() ? { standOut: String(body.standOut).trim() } : {}),
    }
    updateProduct(db(), current.store.id, product.id, { metadata: { qualify: writeQualifyNotes(notes) } })
    const result = qualifyCatalogProduct(getProduct(db(), current.store.id, product.id) as typeof product, notes)
    return back(ctx, result.decision === 'skip' ? `!${result.summary}` : result.summary)
  })

  router.post('/admin/products/:id/rewrite', async (ctx) => {
    const current = session(ctx)
    const result = await execute(
      'write_product_page',
      { productId: ctx.params.id as string },
      { db: db(), storeId: current.store.id, actor: { type: 'user', id: current.user.id }, page: 'products' },
    )
    return back(ctx, result.summary)
  })

  /* ------------------------------------------------------------- pages */

  router.get('/admin/templates', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'templates', 'Template library', templateLibraryPage({ templates: listPageTemplates(db(), current.user.id), blocks: listBlockPresets(db(), current.user.id), products: listProducts(db(), current.store.id, { limit: 200 }), query: ctx.query.get('q') ?? '', flash: ctx.query.get('flash') ?? '' }))
  })

  router.post('/admin/templates/import', async (ctx) => {
    const current = session(ctx), body = await ctx.body()
    try {
      const role = pageRole(body.role ?? 'page'), url = String(body.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) throw new Error('Paste a full URL, starting with https://')
      const result = await clonePage(url, { storeId: current.store.id })
      savePageTemplate(db(), current.user.id, current.store.id, String(body.name ?? '').trim() || result.title, { title: result.title, kind: role === 'checkout' ? 'checkout' : 'custom', role, mode: 'html', blocks: [], rawHtml: result.html, headHtml: '', seo: { title: result.title, description: result.description }, sourceUrl: result.sourceUrl, productId: '' })
      return redirect('/admin/templates?flash=' + encodeURIComponent('Page saved to your template library.' + (result.imageReport?.complete === false || result.captureReport?.complete === false ? ' Some images or embedded content need review.' : '')))
    } catch (error) { return redirect('/admin/templates?flash=' + encodeURIComponent('Could not save this template: ' + (error instanceof Error ? error.message : String(error)))) }
  })

  router.post('/admin/pages/:id/template', async (ctx) => {
    const current = session(ctx), body = await ctx.body(), found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    try {
      const template = savePageTemplate(db(), current.user.id, current.store.id, String(body.name ?? found.title), found)
      return { ok: true, template: { id: template.id, name: template.name } }
    } catch (error) { return { error: error instanceof Error ? error.message : String(error) } }
  })

  router.get('/admin/templates/:id/preview', (ctx) => {
    const current = session(ctx), template = getPageTemplate(db(), current.user.id, ctx.params.id as string)
    if (!template) throw notFound('No such template')
    const snapshot = template.snapshot
    const templateHtmlWithHead = /<head\b[^>]*>/i.test(snapshot.rawHtml) ? snapshot.rawHtml.replace(/<head\b[^>]*>/i, match => match + snapshot.headHtml) : snapshot.headHtml + snapshot.rawHtml
    const raw = snapshot.mode === 'html' ? templateHtmlWithHead : renderBlockPreview(storeViewFor(ctx, current.store, { preview: true }), { ...snapshot, id: template.id, storeId: current.store.id, handle: 'template', status: 'draft', isHome: false, weight: 0, format: '', direction: '', createdAt: '', updatedAt: '' })
    return new Raw(raw, 'text/html; charset=utf-8', { 'Content-Security-Policy': "sandbox allow-same-origin; script-src 'none'; object-src 'none'; form-action 'none'", 'Cache-Control': 'no-store' })
  })

  router.post('/admin/templates/:id/use', async (ctx) => {
    const current = session(ctx), body = await ctx.body()
    try {
      const created = usePageTemplate(db(), current.user.id, current.store.id, ctx.params.id as string, { title: String(body.title ?? ''), role: pageRole(body.role ?? 'page'), productId: String(body.productId ?? '') })
      return redirect(`/admin/pages/${created.id}/edit`)
    } catch (error) { return redirect('/admin/templates?flash=' + encodeURIComponent(error instanceof Error ? error.message : String(error))) }
  })

  router.post('/admin/templates/:id/delete', (ctx) => {
    const current = session(ctx)
    if (!deletePageTemplate(db(), current.user.id, ctx.params.id as string)) throw notFound('No such template')
    return redirect('/admin/templates?flash=Template+removed')
  })

  router.post('/admin/templates/blocks/:id/use', async (ctx) => {
    const current = session(ctx), body = await ctx.body()
    const preset = listBlockPresets(db(), current.user.id).find(entry => entry.id === ctx.params.id)
    if (!preset) throw notFound('No such block template')
    const productId = String(body.productId ?? '')
    if (productId && !getProduct(db(), current.store.id, productId)) throw badRequest('Choose a product from this site')
    const sourceSlug = getStore(db(), preset.sourceStoreId)?.slug || String(preset.settings.sourceStoreSlug ?? '')
    const created = createPage(db(), current.store.id, { title: preset.name, kind: 'custom', productId,
      ...(preset.type === 'custom-html' ? { mode: 'html' as const, sourceUrl: String(preset.settings.sourceUrl ?? ''), rawHtml: templateHtml(String(preset.settings.html ?? ''), productId, sourceSlug) } : { blocks: templateBlocks([newBlock(preset.type, preset.settings)], productId, sourceSlug) }),
    })
    return redirect(`/admin/pages/${created.id}/edit`)
  })

  router.get('/admin/pages', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'pages', current.store.kind === 'funnel' ? 'Funnel pages' : 'Store pages', pages.pagesPage(ctxFor(current, ctx)))
  })

  router.post('/admin/pages/new', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const product = body.productId ? getProduct(db(), current.store.id, String(body.productId)) : null
    const research = latestResearch(db(), current.store.id)
    const input = {
      storeName: current.store.name,
      ...(product ? { product: { id: product.id, title: product.title, image: product.heroImage, subtitle: product.subtitle } } : {}),
      research: research ? { triggers: research.triggers, objections: research.objections, comparison: research.comparison, competitors: research.competitors } : null,
    }
    const template = pageTemplate(String(body.template ?? 'blank'))
    const created = createPage(db(), current.store.id, {
      title: String(body.title ?? '').trim() || template.title(input),
      kind: template.kind,
      role: template.role,
      blocks: template.build(input),
      ...(product && template.role !== 'checkout' ? { productId: product.id } : {}),
    })
    return redirect(`/admin/pages/${created.id}/edit`)
  })

  router.post('/admin/pages/html', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const created = createPage(db(), current.store.id, { title: String(body.title ?? 'New page'), kind: 'custom', role: pageRole(body.role ?? 'page'), mode: 'html', rawHtml: String(body.html ?? '') })
    return redirect(`/admin/pages/${created.id}/edit`)
  })

  router.post('/admin/pages/clone', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const url = String(body.url ?? '').trim()
    if (!/^https?:\/\//i.test(url)) return back(ctx, '!Paste a full URL, starting with https://')
    try {
      if (body.scope === 'funnel') {
        const imported = await importAssetFromUrl(db(), current.user.id, { url, kind: 'funnel', currency: current.store.currency, additionalUrls: String(body.additionalUrls ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean) })
        setCookie(ctx.res, STORE_COOKIE, imported.store.id)
        recordAudit(db(), { storeId: imported.store.id, actorType: 'user', actorId: current.user.id, action: 'clone_funnel', target: url, diff: { pages: imported.pages.length, complete: imported.report.complete } })
        return redirect(`/admin/pages/${imported.page.id}/copy-report`)
      }
      const result = await clonePage(url, { storeId: current.store.id, keepScripts: body.keepScripts === 'true' })
      const role = pageRole(body.role ?? 'page'), productId = String(body.productId ?? '')
      if (productId && !getProduct(db(), current.store.id, productId)) throw new Error('Choose a product from this site')
      if (productId) {
        try {
          const plan = planImportedBundle(result.html, result.sourceUrl)
          if (plan) {
            const installed = installImportedBundle(db(), current.store.id, productId, plan)
            result.html = repairImportedBundleHtml(result.html, plan, installed).html
            result.notes.push(...installed.notes)
          }
        } catch (error) { result.notes.push(error instanceof Error ? error.message : 'Copied bundle pricing needs review.') }
      }
      const created = createPage(db(), current.store.id, {
        title: result.title,
        kind: 'custom',
        role,
        productId,
        mode: 'html',
        rawHtml: result.html,
        seo: { title: result.title, description: result.description },
        sourceUrl: result.sourceUrl,
      })
      saveCopyReport(db(), current.store.id, created.id, { images: result.imageReport, capture: result.captureReport, notes: result.notes })
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'clone_page', target: result.sourceUrl, diff: { stylesheets: result.stylesheets, images: result.imagesLocalized, imageReport: result.imageReport, captureReport: result.captureReport, notes: result.notes } })
      return redirect(`/admin/pages/${created.id}/edit?flash=${encodeURIComponent(`Cloned. ${result.stylesheets} stylesheets inlined, ${result.imagesLocalized} images copied in.${result.imageReport?.complete === false || result.captureReport?.complete === false ? ' Copy needs review.' : ''} Open View copy report in Page settings for details.`)}`)
    } catch (error) {
      return back(ctx, `!Could not clone that page: ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  })

  router.get('/admin/pages/:id/copy-report', (ctx) => {
    const current = session(ctx)
    const found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    return page(ctx, current, 'pages', 'Copy report', copyReportPage(found, readCopyReport(db(), current.store.id, found.id)))
  })

  router.get('/admin/pages/:id/edit', (ctx) => {
    const current = session(ctx)
    const found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    ensurePageRevision(db(), found)
    const catalog = listProducts(db(), current.store.id, { limit: 200 })
    const connected = found.productId ? getProduct(db(), current.store.id, found.productId) : null
    if (connected && !catalog.some(product => product.id === connected.id)) catalog.unshift(connected)
    const products = catalog.map((product) => ({ id: product.id, title: product.title + (product.status === 'published' ? '' : ' (draft)') }))
    const draft = environment(db(), current.store.id, 'draft')
    return html(editorPage({
      page: found,
      notice: ctx.query.get('flash') ?? '',
      storeSlug: current.store.slug,
      products,
      custom: customDefinitions(db(), current.store.id),
      presets: listBlockPresets(db(), current.user.id).map(preset => preset.sourceStoreId === current.store.id ? preset : { ...preset, settings: templateBlocks([newBlock(preset.type, preset.settings)], found.productId, getStore(db(), preset.sourceStoreId)?.slug || String(preset.settings.sourceStoreSlug ?? ''))[0]?.settings ?? {} }),
      brand: Object.keys(draft.brand).length ? draft.brand : current.store.brand,
      theme: draft.theme,
      revisions: listPageRevisions(db(), current.store.id, found.id),
    }))
  })

  router.post('/admin/pages/:id/draft-preview', async (ctx) => {
    const current = session(ctx)
    const found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    const body = await ctx.body()
    const blocks = Array.isArray(body.blocks) ? body.blocks as typeof found.blocks : found.blocks
    if (blocks.some(block => !block || typeof block.type !== 'string' || !block.settings || typeof block.settings !== 'object')) throw badRequest('Invalid page blocks')
    const preview = { ...found, title: String(body.title ?? found.title), blocks, headHtml: String(body.headHtml ?? found.headHtml) }
    return html(renderBlockPreview(storeViewFor(ctx, current.store, { preview: true }), preview))
  })

  router.get('/admin/pages/:id/product-data/:productId', (ctx) => {
    const current = session(ctx)
    if (!getPage(db(), current.store.id, ctx.params.id as string)) throw notFound('No such page')
    const product = getProduct(db(), current.store.id, ctx.params.productId as string)
    if (!product) throw notFound('No such product')
    return pageProductData(product, current.store.currency)
  })

  /* Same-origin, script-free document used by the visual clone editor. */
  router.get('/admin/pages/:id/canvas', (ctx) => {
    const current = session(ctx)
    const found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    return new Raw(found.rawHtml, 'text/html; charset=utf-8', {
      'Content-Security-Policy': "sandbox allow-same-origin; script-src 'none'; object-src 'none'; form-action 'none'",
      'Cache-Control': 'no-store',
    })
  })

  router.post('/admin/pages/:id/presets', async (ctx) => {
    const current = session(ctx)
    const found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    const body = await ctx.body()
    const block = found.blocks.find((entry) => entry.id === String(body.blockId ?? ''))
    if (!block) return { error: 'Save the page first, then save this block to your library.' }
    const available = blockDefinition(block.type) || customDefinitions(db(), current.store.id).some((definition) => definition.type === block.type)
    if (!available) return { error: `The ${block.type} definition is not available.` }
    try {
      const preset = saveBlockPreset(db(), current.user.id, current.store.id, String(body.name ?? ''), block)
      return { ok: true, preset }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  router.post('/admin/pages/:id/html-presets', async (ctx) => {
    const current = session(ctx)
    const found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    const body = await ctx.body()
    const snippet = String(body.html ?? '').trim()
    if (!snippet) return { error: 'Select a section with content before saving it.' }
    if (snippet.length > 2_000_000) return { error: 'That section is too large to save as one reusable block.' }
    if (/<script\b/i.test(snippet)) return { error: 'Remove scripts before saving this section to the shared library.' }
    try {
      const preset = saveBlockPreset(db(), current.user.id, current.store.id, String(body.name ?? ''), { type: 'custom-html', settings: { html: snippet, sourceUrl: found.sourceUrl, sourceStoreSlug: current.store.slug } })
      return { ok: true, preset }
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) }
    }
  })

  router.post('/admin/block-presets/:id/delete', (ctx) => {
    const current = session(ctx)
    return { ok: deleteBlockPreset(db(), current.user.id, ctx.params.id as string) }
  })

  /* A block the store defines for itself: fields as "key|label|type" lines, a template, its css. */
  router.post('/admin/blocks', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const fields: CustomField[] = String(body.fields ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [key = '', label = '', type = 'string', fallback = ''] = line.split('|').map((part) => part.trim())
      const kind = type === 'number' ? 'number' : type === 'boolean' ? 'boolean' : 'string'
      return { key, label: label || key, type: kind, ...(type === 'text' ? { multiline: true } : {}), ...(fallback ? { default: kind === 'number' ? Number(fallback) : kind === 'boolean' ? fallback === 'true' : fallback } : {}) }
    })
    try {
      const block = upsertCustomBlock(db(), current.store.id, { type: String(body.type ?? '').trim() || undefined, name: String(body.name ?? '').trim(), description: String(body.description ?? ''), icon: String(body.icon ?? '✚'), fields, template: String(body.template ?? ''), css: String(body.css ?? ''), js: String(body.js ?? ''), source: 'owner' })
      return back(ctx, `Block "${block.name}" saved as ${block.type}. It is in the builder palette under Custom.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : String(error)}`)
    }
  })

  router.post('/admin/blocks/:type/delete', (ctx) => {
    const current = adminSession(ctx)
    deleteCustomBlock(db(), current.store.id, ctx.params.type as string)
    return back(ctx, 'Block removed. Pages that used it show a note where it was until you replace it.')
  })

  router.post('/admin/pages/:id/save', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const blocks = Array.isArray(body.blocks) ? (body.blocks as Array<{ id?: string; type: string; settings?: Record<string, unknown> }>) : []
    const custom = new Set(customDefinitions(db(), current.store.id).map((definition) => definition.type))
    const carried = new Set((getPage(db(), current.store.id, ctx.params.id as string)?.blocks ?? []).map((block) => block.type))
    if(blocks.some(block=>!block||typeof block.type!=='string'||!block.settings||typeof block.settings!=='object'||Array.isArray(block.settings)))return {error:'Invalid page blocks'}
    const unknown = blocks.find((block) => !blockDefinition(block.type) && !custom.has(block.type) && !carried.has(block.type))
    if (unknown) return { error: `Unknown block type ${unknown.type}` }
    const seo = (body.seo ?? {}) as Record<string, unknown>
    const found = getPage(db(), current.store.id, ctx.params.id as string)
    if (!found) throw notFound('No such page')
    if(body.revision && body.revision!==pageRevisionToken(found))return {error:'This page changed in another tab or an AI job. Your edits remain here; reload the saved page before overwriting it.'}
    let role: Page['role']
    try { role = pageRole(body.role ?? found.role) } catch { return { error: 'Choose a valid page type' } }
    const productId = String(body.productId ?? found.productId)
    if (productId && !getProduct(db(), current.store.id, productId)) return { error: 'Choose a product from this site' }
    const updated = updatePage(db(), current.store.id, ctx.params.id as string, {
      title: String(body.title ?? 'Untitled').trim() || 'Untitled',
      handle: String(body.handle ?? found.handle),
      role,
      productId,
      mode: body.mode === 'html' ? 'html' : 'blocks',
      blocks: blocks.map((block) => ({ id: block.id || `blk_${Math.random().toString(36).slice(2, 10)}`, type: block.type, settings: block.settings ?? {} })),
      rawHtml: String(body.rawHtml ?? ''),
      headHtml: String(body.headHtml ?? ''),
      status: body.status === 'published' ? 'published' : 'draft',
      isHome: body.isHome === true,
      seo: { title: String(seo.title ?? ''), description: String(seo.description ?? ''), image: String(seo.image ?? '') },
    })
    savePageRevision(db(), updated, body.publish === true ? 'Published from builder' : 'Saved from builder')
    const revisions = listPageRevisions(db(), current.store.id, updated.id).map((revision) => ({
      id: revision.id,
      version: revision.version,
      note: revision.note,
      createdAt: revision.createdAt,
      status: revision.snapshot.status,
    }))
    return { ok: true, revision: pageRevisionToken(updated), handle: updated.handle, updatedAt: updated.updatedAt, status: updated.status, revisions }
  })

  router.post('/admin/pages/:id/revisions/:revision/restore', async (ctx) => {
    const current = session(ctx)
    const body=await ctx.body()
    const found=getPage(db(),current.store.id,ctx.params.id as string)
    if(!found)throw notFound('No such page')
    if(body.revision && body.revision!==pageRevisionToken(found))return {error:'This page changed in another tab or an AI job. Reload before restoring a version.'}
    try {
      restorePageRevision(db(), current.store.id, ctx.params.id as string, ctx.params.revision as string)
      return { ok: true }
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Could not restore that version' }
    }
  })

  router.post('/admin/pages/:id/duplicate', (ctx) => {
    const current = session(ctx)
    const copy = duplicatePage(db(), current.store.id, ctx.params.id as string)
    return redirect(`/admin/pages/${copy.id}/edit`)
  })

  router.post('/admin/pages/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    deletePage(db(), current.store.id, ctx.params.id as string)
    return redirect('/admin/pages?flash=Deleted.')
  })

  router.post('/admin/blogs', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const title = String(body.title ?? '').trim()
    if (!title) return back(ctx, '!Give the blog a title.')
    const blog = createBlog(db(), current.store.id, title)
    return back(ctx, `"${blog.title}" is at /blogs/${blog.handle}. It shows once it has a published article.`)
  })

  router.post('/admin/blogs/:id/articles', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const blog = listBlogs(db(), current.store.id).find((entry) => entry.id === ctx.params.id)
    if (!blog) throw notFound('No such blog')
    const article = createArticle(db(), current.store.id, blog.id, {
      title: String(body.title ?? '').trim(), body: String(body.body ?? ''), excerpt: String(body.excerpt ?? ''),
      status: ['draft', 'scheduled', 'published'].includes(String(body.status)) ? String(body.status) as 'draft' : 'draft',
      ...(body.publishAt ? { publishAt: String(body.publishAt) } : {}),
    })
    return back(ctx, `"${article.title}" saved as a ${article.status}.`)
  })

  router.post('/admin/articles/:id', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const article = updateArticle(db(), current.store.id, ctx.params.id as string, {
        title: String(body.title ?? '').trim(), body: String(body.body ?? ''), excerpt: String(body.excerpt ?? ''),
        status: ['draft', 'scheduled', 'published'].includes(String(body.status)) ? String(body.status) as 'draft' : 'draft',
        publishAt: body.publishAt ? String(body.publishAt) : null,
      })
      return back(ctx, `"${article.title}" saved as a ${article.status}.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not save article'}`)
    }
  })

  router.post('/admin/articles/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    return back(ctx, deleteArticle(db(), current.store.id, ctx.params.id as string) ? 'Article deleted.' : '!No such article')
  })

  router.post('/admin/blogs/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    return back(ctx, deleteBlog(db(), current.store.id, ctx.params.id as string) ? 'Blog deleted.' : '!No such blog')
  })

  /* ----------------------------------------------------------- bundles */

  router.get('/admin/bundles', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'bundles', 'Bundles', pages.bundlesPage(ctxFor(current, ctx)))
  })

  router.post('/admin/bundles', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const tiers: BundleTier[] = String(body.tiers ?? '')
      .split('\n')
      .map((line) => line.split('|').map((part) => part.trim()))
      .filter((parts) => parts[0])
      .map((parts) => ({
        quantity: Number(parts[0]),
        discountPercent: Number(parts[1] ?? 0),
        label: parts[2] || `Buy ${parts[0]}`,
        ...(parts[3] ? { badge: parts[3] } : {}),
        ...(parts[4] === 'ship' ? { freeShipping: true } : {}),
        ...(parts[5] ? { giftVariantId: parts[5], giftLabel: parts[6] ?? '' } : {}),
      }))
    if (body.giftVariantId && tiers.length) {
      const top = tiers[tiers.length - 1] as BundleTier
      top.giftVariantId = String(body.giftVariantId)
      top.giftLabel = String(body.giftLabel ?? 'free gift')
    }
    try {
      upsertBundle(db(), current.store.id, {
        productId: String(body.productId ?? ''),
        title: String(body.title ?? 'Bundle & save'),
        tiers,
        style: { layout: body.layout === 'row' ? 'row' : 'stacked', ...(body.accent ? { accent: String(body.accent) } : {}) },
      })
      return back(ctx, 'Bundle saved. It is live on the product page and enforced in the cart.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not save'}`)
    }
  })

  router.post('/admin/bundles/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    removeBundle(db(), current.store.id, ctx.params.id as string)
    return back(ctx, 'Bundle removed and its promotions disabled.')
  })

  router.get('/admin/settings/payments', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'settings', 'Payments', pages.paymentsPage(ctxFor(current, ctx)))
  })

  /* ------------------------------------------------- dropshipping ops */

  router.post('/admin/products/import', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const result = await execute('import_product_from_url', { url: String(body.url ?? ''), markup: Number(body.markup ?? 2.5), asSupplier: body.asSupplier === 'true' }, { db: db(), storeId: current.store.id, actor: { type: 'user', id: current.user.id }, page: 'products' })
      const productId = (result.data as { id?: string })?.id
      return redirect(productId ? `/admin/products/${productId}?flash=${encodeURIComponent(result.summary)}` : `/admin/products?flash=${encodeURIComponent(result.summary)}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Import failed'}`)
    }
  })

  router.post('/admin/products/:id/supplier', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const number = (key: string) => (body[key] === undefined || body[key] === '' ? undefined : Number(body[key]))
    updateProduct(db(), current.store.id, ctx.params.id as string, {
      supplier: { name: String(body.name ?? ''), url: String(body.url ?? ''), sku: String(body.sku ?? ''), costCents: number('costCents'), shippingCents: number('shippingCents'), processingDays: number('processingDays'), shippingDaysMin: number('shippingDaysMin'), shippingDaysMax: number('shippingDaysMax') },
      metadata: { sizeChart: String(body.sizeChart ?? '') },
    })
    return back(ctx, 'Supplier saved. Margins and delivery estimates use it now.')
  })

  router.post('/admin/products/:id/versions', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const picked = (Array.isArray(body.formats) ? body.formats : body.formats ? [body.formats] : []) as string[]
    const kind = body.kind === 'advertorial' ? 'advertorial' : 'pdp'
    const formats = picked.filter((entry) => entry.startsWith(`${kind}:`)).map((entry) => entry.split(':')[1] as string)
    try {
      const pages = await generateVersions(db(), current.store, { productId: ctx.params.id as string, kind, formats, direction: String(body.direction ?? ''), avatarId: String(body.avatarId ?? ''), count: Number(body.count ?? 3) || 3, publish: body.publish === 'true', ...(body.model ? { model: String(body.model) } : {}) })
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'generate_versions', target: ctx.params.id as string, diff: { kind, formats, direction: body.direction, pages: pages.map((page) => page.id) } })
      return back(ctx, `Generated ${pages.length} ${kind === 'pdp' ? 'product page version' : 'advertorial'}${pages.length === 1 ? '' : 's'}: ${pages.map((page) => page.format).join(', ')}.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not generate'}`)
    }
  })

  router.post('/admin/versions/:id/weight', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const page = setVersionWeight(db(), current.store.id, ctx.params.id as string, Number(body.weight ?? 0))
    return back(ctx, page.weight > 0 ? `${page.title} is in the test at weight ${page.weight}.` : `${page.title} is out of the test.`)
  })

  router.post('/admin/orders/:id/supplier', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const number = (key: string) => (body[key] === undefined || body[key] === '' ? undefined : Number(body[key]))
    const order = recordSupplierOrder(db(), current.store.id, ctx.params.id as string, { supplier: String(body.supplier ?? ''), orderId: String(body.orderId ?? ''), costCents: number('costCents'), shippingCents: number('shippingCents'), ...(body.tracking ? { tracking: String(body.tracking) } : {}), ...(body.carrier ? { carrier: String(body.carrier) } : {}) })
    if (body.tracking) {
      const shipment = order.fulfillments.at(-1)
      void registerOrderTracking(db(), current.store.id, order).catch(() => undefined)
      void sendEmail(db(), current.store.id, { template: 'order_shipped', to: order.email, context: { ...orderContext(order, ctx.url.origin + storeUrl(ctx, current.store)), tracking: shipment?.tracking ?? '' } }).catch(() => undefined)
    }
    return back(ctx, body.tracking ? 'Saved and marked shipped; the customer has the tracking link.' : 'Supplier order saved.')
  })

  router.post('/admin/orders/:id/delivered', (ctx) => {
    const current = session(ctx)
    const order = markDelivered(db(), current.store.id, ctx.params.id as string)
    void sendEmail(db(), current.store.id, { template: 'order_delivered', to: order.email, context: orderContext(order, ctx.url.origin + storeUrl(ctx, current.store)) }).catch(() => undefined)
    return back(ctx, 'Marked delivered. The review request goes out a week from now.')
  })

  router.get('/admin/profit', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'profit', 'Profit', pages.profitPage(ctxFor(current, ctx), Number(ctx.query.get('days') ?? 30) || 30))
  })

  router.post('/admin/profit/spend', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    recordAdSpend(db(), current.store.id, { day: String(body.day ?? new Date().toISOString()), platform: String(body.platform ?? 'Other'), amountCents: Math.round(Number(body.amountCents ?? 0)), note: String(body.note ?? '') })
    return back(ctx, 'Logged.')
  })

  router.get('/admin/funnels', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'funnels', 'Funnels', pages.funnelsPage(ctxFor(current, ctx)))
  })

  router.post('/admin/funnels', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const number = (key: string) => (body[key] === undefined || body[key] === '' ? undefined : Number(body[key]))
    upsertFunnel(db(), current.store.id, {
      ...(body.id ? { id: String(body.id) } : {}),
      name: String(body.name ?? 'Funnel'),
      ...(body.status ? { status: body.status==='paused' ? 'paused' as const : 'active' as const } : {}),
      productId: String(body.productId ?? ''),
      advertorialPageId: String(body.advertorialPageId ?? ''),
      offerPageId: String(body.offerPageId ?? ''),
      bump: { variantId: String(body.bumpVariantId ?? ''), label: String(body.bumpLabel ?? ''), priceCents: number('bumpPriceCents'), enabled: true },
      upsell: { variantId: String(body.upsellVariantId ?? ''), discountPercent: number('upsellDiscount') ?? 20, headline: String(body.upsellHeadline ?? '') },
      downsell: { variantId: String(body.downsellVariantId ?? ''), discountPercent: number('downsellDiscount'), headline: String(body.downsellHeadline ?? '') },
      testGroup: String(body.testGroup ?? '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
      weight: Number(body.weight ?? 0) || 0,
    })
    return back(ctx, 'Funnel saved.')
  })

  router.post('/admin/funnels/:id/clone', (ctx) => {
    const current = session(ctx)
    const result = duplicateWholeFunnel(db(), current.store.id, ctx.params.id as string)
    recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'clone_funnel', target: result.funnel.id, diff: { pages: result.pages.map(page => page.id) } })
    return redirect(`/admin/funnels?flash=${encodeURIComponent(`Cloned ${result.pages.length} pages and all offer settings. The copy is paused and outside split tests.`)}`)
  })

  router.post('/admin/funnels/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    deleteFunnel(db(), current.store.id, ctx.params.id as string)
    return back(ctx, 'Funnel deleted.')
  })

  router.post('/admin/questions/:id', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    if (body.hide === 'true') hideQuestion(db(), current.store.id, ctx.params.id as string)
    else answerQuestion(db(), current.store.id, ctx.params.id as string, String(body.answer ?? ''))
    return back(ctx, body.hide === 'true' ? 'Hidden.' : 'Answered; it is on the product page.')
  })

  router.post('/admin/reviews/import', async (ctx) => {
    const current = session(ctx)
    const files = await ctx.files()
    const body = await ctx.body()
    if (!files.csv) return back(ctx, '!Choose a CSV first.')
    const result = importReviews(db(), current.store.id, files.csv.data.toString('utf8'), { ...(body.productId ? { productId: String(body.productId) } : {}) })
    return back(ctx, `Imported ${result.imported} reviews across ${result.products} products; ${result.skipped} rows skipped.`)
  })

  router.post('/admin/stock-alerts/notify', async (ctx) => {
    const current = session(ctx)
    const alerts = pendingStockAlerts(db(), current.store.id)
    const sent: string[] = []
    for (const alert of alerts) {
      const variant = getVariant(db(), current.store.id, alert.variant_id)
      if (!variant || (variant.inventory <= 0 && !variant.allowBackorder)) continue
      await sendEmail(db(), current.store.id, { template: 'welcome', to: alert.email, context: { storeUrl: ctx.url.origin + storeUrl(ctx, current.store), heading: 'It is back in stock' } })
      sent.push(alert.id)
    }
    markStockAlertsNotified(db(), sent)
    return back(ctx, `Emailed ${sent.length} of ${alerts.length}; the rest are still out of stock.`)
  })

  router.get('/admin/switch', (ctx) => {
    const current = session(ctx)
    setCookie(ctx.res, STORE_COOKIE, current.store.id, { maxAge: 60 * 60 * 24 * 365 })
    const to = ctx.query.get('to') ?? ''
    return redirect(/^\/admin(\/|$)/.test(to) && !to.startsWith('//') ? to : '/admin')
  })

  router.get('/admin/ai', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'ai', 'Assistant', pages.aiPage(ctxFor(current, ctx), history(db(), current.store.id, 60, ctx.query.get('before') ?? undefined)))
  })

  router.get('/admin/products', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'products', 'Products', pages.productsPage(ctxFor(current, ctx), ctx.query.get('status') ?? 'all', ctx.query.get('search') ?? ''))
  })

  router.get('/admin/products/:id', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'products', 'Product', pages.productDetail(ctxFor(current, ctx), ctx.params.id as string))
  })

  router.post('/admin/products/:id', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    updateProduct(db(), current.store.id, ctx.params.id as string, {
      title: String(body.title ?? ''),
      subtitle: String(body.subtitle ?? ''),
      description: String(body.description ?? ''),
      status: String(body.status ?? 'draft') as 'draft',
    })
    recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'update_product', target: String(ctx.params.id) })
    return back(ctx, 'Saved.')
  })

  router.post('/admin/variants/:id', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    updateVariant(db(), current.store.id, ctx.params.id as string, {
      priceCents: Number(body.priceCents ?? 0),
      inventory: Number(body.inventory ?? 0),
    })
    return back(ctx, 'Variant updated.')
  })

  router.get('/admin/orders', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'orders', 'Orders', pages.ordersPage(ctxFor(current, ctx), ctx.query.get('status') ?? 'all'))
  })

  router.get('/admin/orders/:id', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'orders', 'Order', pages.orderDetail(ctxFor(current, ctx), ctx.params.id as string))
  })

  router.post('/admin/orders/:id/fulfill', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const order = fulfillOrder(db(), current.store.id, ctx.params.id as string, { provider: 'manual', tracking: String(body.tracking ?? '') })
    if (body.tracking) void registerOrderTracking(db(), current.store.id, order).catch(() => undefined)
    return back(ctx, 'Marked fulfilled.')
  })

  router.post('/admin/orders/:id/refund', async (ctx) => {
    const current = adminSession(ctx)
    const existing = getOrder(db(), current.store.id, ctx.params.id as string)
    if (!existing) throw notFound('No such order')
    const moved = await refundThroughProvider(db(), current.store.id, existing)
    if (!moved.ok) return back(ctx, `!${moved.message}`)
    const order = refundOrder(db(), current.store.id, existing.id, { reason: 'Refunded from the admin' })
    return back(ctx, `Refunded${existing.paymentProvider === 'stripe' ? ' through Stripe' : ''}. Payment is now ${order.paymentStatus}.`)
  })

  router.get('/admin/customers', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'customers', 'Customers', pages.customersPage(ctxFor(current, ctx), ctx.query.get('search') ?? ''))
  })

  router.get('/admin/collections', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'collections', 'Collections', pages.collectionsPage(ctxFor(current, ctx)))
  })

  router.post('/admin/collections', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    createCollection(db(), current.store.id, { title: String(body.title ?? 'Untitled') })
    return back(ctx, 'Collection created.')
  })

  router.get('/admin/promotions', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'promotions', 'Promotions', pages.promotionsPage(ctxFor(current, ctx)))
  })

  router.post('/admin/promotions/:id/:state', (ctx) => {
    const current = session(ctx)
    const wanted = ctx.params.state === 'enable' ? 'active' : 'disabled'
    setPromotionStatus(db(), current.store.id, ctx.params.id as string, wanted)
    return back(ctx, wanted === 'active' ? 'Promotion is live again.' : 'Promotion disabled.')
  })

  router.post('/admin/promotions', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const requestedKind = String(body.kind ?? 'percentage')
    const allowedKinds: Array<Parameters<typeof createPromotion>[2]['kind']> = ['percentage', 'fixed', 'free_shipping', 'bundle', 'tiered', 'bogo', 'mix_match', 'fixed_bundle']
    if (!allowedKinds.includes(requestedKind as Parameters<typeof createPromotion>[2]['kind'])) return badRequest('Unsupported promotion type.')
    const kind = requestedKind as Parameters<typeof createPromotion>[2]['kind']
    const productIds = String(body.productIds ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
    const buyProductIds = String(body.buyProductIds ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
    const getProductIds = String(body.getProductIds ?? '').split(',').map((entry) => entry.trim()).filter(Boolean)
    const tiers = String(body.tiers ?? '').split(',').map((entry) => {
      const [quantity = '', percent = ''] = entry.trim().split('|')
      return { quantity: Math.max(1, Math.round(Number(quantity) || 0)), percent: Math.max(0, Math.min(100, Number(percent) || 0)) }
    }).filter((tier) => tier.quantity > 0 && tier.percent > 0)
    if (kind === 'tiered' && !tiers.length) return back(ctx, '!A tiered promotion needs tiers such as 2|10, 3|20.')
    createPromotion(db(), current.store.id, {
      title: String(body.title ?? 'New promotion'), kind,
      value: Math.max(0, Number(body.value ?? 0)), code: String(body.code ?? ''), automatic: body.automatic === 'true',
      rules: {
        ...(productIds.length ? { productIds } : {}), ...(buyProductIds.length ? { buyProductIds } : {}), ...(getProductIds.length ? { getProductIds } : {}),
        ...(body.minSubtotalCents ? { minSubtotalCents: Number(body.minSubtotalCents) } : {}),
        ...(body.minQuantity ? { minQuantity: Number(body.minQuantity) } : {}),
        ...(body.buyQuantity ? { buyQuantity: Number(body.buyQuantity) } : {}),
        ...(body.getQuantity ? { getQuantity: Number(body.getQuantity) } : {}),
        ...(body.requiredDistinctProducts ? { requiredDistinctProducts: Number(body.requiredDistinctProducts) } : {}),
        ...(body.bundlePriceCents ? { bundlePriceCents: Number(body.bundlePriceCents) } : {}),
        ...(body.maxUses ? { maxUses: Number(body.maxUses) } : {}),
        ...(body.regionId ? { regionIds: [String(body.regionId)] } : {}),
        ...(tiers.length ? { tiers } : {}),
        priority: Number(body.priority ?? 0), combinable: body.combinable === 'true', firstOrderOnly: body.firstOrderOnly === 'true',
      },
    })
    return back(ctx, 'Promotion created.')
  })

  router.get('/admin/analytics', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'analytics', 'Analytics', pages.analyticsPage(ctxFor(current, ctx), range(ctx)))
  })

  router.get('/admin/reviews', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'reviews', 'Reviews', pages.reviewsPage(ctxFor(current, ctx), ctx.query.get('status') ?? 'pending'))
  })

  router.post('/admin/reviews/:id/:status', (ctx) => {
    const current = session(ctx)
    const status = ctx.params.status as 'approved' | 'rejected'
    if (status !== 'approved' && status !== 'rejected') throw badRequest('Unknown moderation action')
    moderate(db(), current.store.id, ctx.params.id as string, status)
    return back(ctx, `Review ${status}.`)
  })

  router.get('/admin/speed', (ctx) => {
    const current=session(ctx)
    return page(ctx,current,'speed','Store Speed',plan.healthCard(ctxFor(current,ctx),true))
  })
  router.post('/admin/speed/fix', async(ctx)=>{
    const current=session(ctx),body=await ctx.body()
    try{return {id:startHealthFix(db(),current.store.id,String(body.path??''),String(body.check??''),current.user.id)}}catch(error){return {error:error instanceof Error?error.message:String(error)}}
  })
  router.get('/admin/speed/fixes/:id',(ctx)=>{
    const current=session(ctx),job=healthFix(db(),current.store.id,String(ctx.params.id))
    if(!job)throw notFound('No such fix')
    return job
  })
  router.post('/admin/speed/fixes/:id/undo',(ctx)=>{
    const current=session(ctx)
    try{undoHealthFix(db(),current.store.id,String(ctx.params.id));return {ok:true}}catch(error){return {error:error instanceof Error?error.message:String(error)}}
  })

  router.get('/admin/store', (ctx) => {
    if(ctx.query.get('health')==='1')return redirect('/admin/speed')
    const current = session(ctx)
    return page(ctx, current, 'store', 'Theme & navigation', pages.storePage(ctxFor(current, ctx), history(db(), current.store.id, 10), ctx.query.get('health') === '1'))
  })

  router.post('/admin/theme', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    const draft = environment(db(), current.store.id, 'draft')
    const cleanColor = (value: unknown, fallback: string) => /^#[0-9a-f]{6}$/i.test(String(value ?? '')) ? String(value) : fallback
    const cleanFont = (value: unknown, fallback: string) => /^[a-z0-9][a-z0-9 -]{0,79}$/i.test(String(value ?? '')) ? String(value) : fontFamilyName(String(value ?? '')) ?? fallback
    const cleanWeight=(value:unknown,fallback:number)=>Number.isInteger(Number(value))&&Number(value)>=100&&Number(value)<=900?Number(value):fallback
    let sourceTheme=draft.brand.sourceTheme||{}
    try{sourceTheme=cleanSourceTheme(JSON.parse(String(body.sourceTheme||'{}')))}catch{}
    const fonts = [...new Set(String(body.fonts ?? '').split(/\r?\n/).map((entry) => fontFamilyName(entry)).filter((entry): entry is string => Boolean(entry)))].slice(0, 32)
    const sections = String(body.sections ?? '').split(/\r?\n|,/).map((entry) => entry.trim()).filter((entry) => ['hero', 'featured', 'story', 'collection-grid', 'reviews', 'newsletter'].includes(entry))
    const nav = String(body.nav ?? '').split(/\r?\n/).map((entry) => {
      const [label = '', rawHref = ''] = entry.split('|').map((part) => part.trim())
      const href = rawHref.startsWith('/') ? rawHref : `/${rawHref.replace(/^\/+/, '')}`
      return label && rawHref ? { label: label.slice(0, 60), href: href.slice(0, 240) } : null
    }).filter((entry): entry is { label: string; href: string } => entry !== null)
    setTheme(db(), current.store.id, {
      template: String(body.template ?? 'atelier'),
      radius: String(body.radius ?? '2px'),
      density: body.density === 'compact' ? 'compact' : 'roomy',
      heroHeadline: String(body.heroHeadline ?? ''),
      heroSub: String(body.heroSub ?? ''),
      heroImage: String(body.heroImage ?? ''),
      sections: sections.length ? sections : draft.theme.sections,
      nav,
    }, { build: 'Edited from the store designer' })
    updateStore(db(), current.store.id, { brand: {
      slogan: String(body.slogan ?? '').slice(0, 180),
      description: String(body.description ?? '').slice(0, 1200),
      announcement: String(body.announcement ?? '').slice(0, 240),
      logoSvg: String(body.logoSvg ?? '').trim().slice(0, 2000),
      themeCustomized:true,
      sourceTheme,
      displayWeight:cleanWeight(body.displayWeight,draft.brand.displayWeight??400),
      bodyWeight:cleanWeight(body.bodyWeight,draft.brand.bodyWeight??400),
      surface:cleanColor(body.surface,draft.brand.surface??'#f6f6f6'),
      buttonText:cleanColor(body.buttonText,draft.brand.buttonText??'#ffffff'),
      border:cleanColor(body.border,draft.brand.border??'#d9d9d9'),
      fontFaces:fontFacesFromHtml(listPages(db(),current.store.id).filter(page=>page.mode==='html').map(page=>page.rawHtml).join('\n')),
      primary: cleanColor(body.primary, draft.brand.primary ?? '#7a4a2b'),
      secondary: cleanColor(body.secondary, draft.brand.secondary ?? '#5d1f28'),
      paper: cleanColor(body.paper, draft.brand.paper ?? '#f4ece1'),
      ink: cleanColor(body.ink, draft.brand.ink ?? '#241a14'),
      displayFont: cleanFont(body.displayFont, draft.brand.displayFont ?? "'Playfair Display', Georgia, serif"),
      bodyFont: cleanFont(body.bodyFont, draft.brand.bodyFont ?? "'Inter', ui-sans-serif, system-ui, sans-serif"),
      fonts,
    } })
    return back(ctx, 'Draft saved. Publish to make it live.')
  })

  router.post('/admin/theme/code', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    setTheme(db(), current.store.id, { customCss: String(body.customCss ?? ''), customJs: String(body.customJs ?? '') }, { build: 'Store-wide css and js edited' })
    return back(ctx, 'Custom code saved to the draft. Publish to make it live.')
  })

  router.post('/admin/publish', (ctx) => {
    const current = adminSession(ctx)
    const state = publishState(db(), current.store.id)
    if (!state.ready) return back(ctx, `!${state.reason}`)
    const live = publish(db(), current.store.id)
    refreshTodos(db(), current.store.id)
    recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'publish_store', target: `v${live.version}` })
    return back(ctx, `Published v${live.version}.`)
  })

  router.post('/admin/rollback', (ctx) => {
    const current = adminSession(ctx)
    rollback(db(), current.store.id)
    return back(ctx, 'Draft reset to what is live.')
  })

  router.get('/admin/marketing', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'marketing', 'Email & search', pages.marketingPage(ctxFor(current, ctx)))
  })

  router.get('/admin/emails/:id', (ctx) => {
    const current = session(ctx)
    const send = getSend(db(), current.store.id, ctx.params.id as string) as { html: string } | null
    if (!send) throw notFound('No such email')
    return html(send.html)
  })

  router.get('/admin/plugins', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'plugins', 'Integrations', pages.pluginsPage(ctxFor(current, ctx), ctx.query.get('category') ?? 'all', ctx.query.get('search') ?? ''))
  })

  router.post('/admin/plugins/:id/settings', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    try {
      install(db(), current.store.id, ctx.params.id as string, body)
      invalidateStorefrontConfig(current.store.id)
      refreshTodos(db(), current.store.id)
      return back(ctx, 'Saved.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not save'}`)
    }
  })

  router.post('/admin/plugins/:id/uninstall', (ctx) => {
    const current = adminSession(ctx)
    requireRole(db(), current.user.id, current.store.id, 'admin')
    uninstall(db(), current.store.id, ctx.params.id as string)
    invalidateStorefrontConfig(current.store.id)
    return back(ctx, 'Removed, along with its credentials.')
  })

  router.get('/admin/settings', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'settings', 'Settings', pages.settingsPage(ctxFor(current, ctx)))
  })

  router.post('/admin/profile', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const profile = updateProfile(db(), current.user.id, { name: String(body.name ?? ''), email: String(body.email ?? '') })
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'update_profile', target: current.user.id, diff: { name: profile.name, email: profile.email } })
      return redirect(`/admin/settings?flash=${encodeURIComponent('Profile saved.')}#profile`)
    } catch (error) {
      return redirect(`/admin/settings?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not save the profile'}`)}#profile`)
    }
  })

  router.post('/admin/settings/regions', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    createRegion(db(), current.store.id, {
      name: String(body.name ?? 'Region'), currency: String(body.currency ?? current.store.currency),
      locale: String(body.locale ?? 'en-US'), exchangeRate: Number(body.exchangeRate ?? 1),
      countries: String(body.countries ?? '').split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean),
      taxRate: Number(body.taxRate ?? 0) / 100,
    })
    return back(ctx, 'Market added.')
  })

  router.post('/admin/settings/regions/:id', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    updateRegion(db(), current.store.id, ctx.params.id as string, {
      name: String(body.name ?? ''), currency: String(body.currency ?? current.store.currency), locale: String(body.locale ?? 'en-US'),
      exchangeRate: Number(body.exchangeRate ?? 1), countries: String(body.countries ?? '').split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean),
      taxRate: Number(body.taxRate ?? 0) / 100, isDefault: body.isDefault === 'true',
    })
    return back(ctx, 'Market saved.')
  })

  router.post('/admin/settings/regions/:id/shipping', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    const region = getRegion(db(), current.store.id, ctx.params.id as string)
    if (!region) throw notFound('No such market')
    const input = {
      name: String(body.name ?? 'Standard shipping'), amountCents: Math.max(0, Number(body.amountCents ?? 0)),
      freeAboveCents: body.freeAboveCents ? Math.max(0, Number(body.freeAboveCents)) : null,
    }
    if (body.optionId) updateShippingOption(db(), String(body.optionId), input)
    else setShippingOption(db(), region.id, input)
    return back(ctx, body.optionId ? 'Shipping option saved.' : 'Shipping option added.')
  })

  router.post('/admin/settings/regions/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    try {
      deleteRegion(db(), current.store.id, ctx.params.id as string)
      return back(ctx, 'Market deleted.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not delete market'}`)
    }
  })

  router.post('/admin/settings/shipping/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    try {
      deleteShippingOption(db(), current.store.id, ctx.params.id as string)
      return back(ctx, 'Shipping option removed.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not remove shipping option'}`)
    }
  })

  // Human-friendly region editor. The older /admin/settings/regions endpoints
  // stay in place for backwards compatibility, while these forms accept major
  // currency units so a $4.50 rate is never mistaken for 4.5 cents.
  const regionMoney = (raw: unknown): number | null => {
    const text = String(raw ?? '').trim().replace(/[^0-9.,-]/g, '').replace(/,/g, '')
    if (!text) return null
    const value = Number(text)
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null
  }
  const regionCountries = (raw: unknown) =>
    String(raw ?? '')
      .split(/[,\s]+/)
      .map((code) => code.trim().toUpperCase())
      .filter((code) => /^[A-Z]{2}$/.test(code))

  router.post('/admin/regions', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    const currency = String(body.currency ?? '').trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) return back(ctx, '!A currency is three letters, like USD or GBP.')
    const countries = regionCountries(body.countries)
    if (!countries.length) return back(ctx, '!Give the region at least one country, as a two-letter code.')
    const region = createRegion(db(), current.store.id, {
      name: String(body.name ?? '').trim() || currency,
      currency,
      locale: String(body.locale ?? '').trim() || 'en-US',
      exchangeRate: Math.max(0.000001, Number(body.exchangeRate ?? 1) || 1),
      countries,
      taxRate: Math.min(1, Math.max(0, Number(String(body.taxPercent ?? '0').replace(/[^0-9.]/g, '')) / 100 || 0)),
    })
    const amount = regionMoney(body.shippingAmount)
    if (amount !== null) {
      setShippingOption(db(), region.id, {
        name: String(body.shippingName ?? '').trim() || 'Standard shipping',
        amountCents: amount,
        freeAboveCents: regionMoney(body.shippingFreeAbove),
      })
    }
    return back(ctx, `${region.name} added: ${region.currency} for ${countries.join(', ')}.`)
  })

  router.post('/admin/regions/:id', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    const currency = String(body.currency ?? '').trim().toUpperCase()
    if (currency && !/^[A-Z]{3}$/.test(currency)) return back(ctx, '!A currency is three letters, like USD or GBP.')
    try {
      const region = updateRegion(db(), current.store.id, ctx.params.id as string, {
        name: String(body.name ?? '').trim() || undefined,
        ...(currency ? { currency } : {}),
        ...(body.locale === undefined ? {} : { locale: String(body.locale).trim() || 'en-US' }),
        ...(body.exchangeRate === undefined ? {} : { exchangeRate: Math.max(0.000001, Number(body.exchangeRate) || 1) }),
        ...(body.countries === undefined ? {} : { countries: regionCountries(body.countries) }),
        ...(body.taxPercent === undefined ? {} : { taxRate: Math.min(1, Math.max(0, Number(String(body.taxPercent).replace(/[^0-9.]/g, '')) / 100 || 0)) }),
        ...(body.isDefault === 'true' ? { isDefault: true } : {}),
      })
      return back(ctx, `${region.name} saved.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not save the region'}`)
    }
  })

  router.post('/admin/regions/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    try {
      deleteRegion(db(), current.store.id, ctx.params.id as string)
      return back(ctx, 'Region removed, with its rates.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not remove the region'}`)
    }
  })

  router.post('/admin/regions/:id/shipping', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    const region = getRegion(db(), current.store.id, ctx.params.id as string)
    if (!region) return back(ctx, '!No such region')
    const amount = regionMoney(body.amount)
    if (amount === null) return back(ctx, '!Give the rate a price — 0 for free shipping.')
    const name = String(body.name ?? '').trim() || 'Standard shipping'
    const freeAbove = regionMoney(body.freeAbove)
    const optionId = String(body.optionId ?? '')
    if (optionId && region.shipping.some((option) => option.id === optionId)) {
      updateShippingOption(db(), optionId, { name, amountCents: amount, freeAboveCents: freeAbove })
      return back(ctx, `${name} saved on ${region.name}.`)
    }
    setShippingOption(db(), region.id, { name, amountCents: amount, freeAboveCents: freeAbove })
    return back(ctx, `${name} added to ${region.name}.`)
  })

  router.post('/admin/shipping/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    try {
      deleteShippingOption(db(), current.store.id, ctx.params.id as string)
      return back(ctx, 'Rate removed.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not remove the rate'}`)
    }
  })

  router.post('/admin/marketing/flows/:id', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    updateFlow(db(), current.store.id, ctx.params.id as string, {
      name: String(body.name ?? ''), delayHours: Number(body.delayHours ?? 0), subject: String(body.subject ?? ''),
      body: String(body.body ?? ''), status: body.status === 'paused' ? 'paused' : 'active',
    })
    return back(ctx, 'Flow saved.')
  })

  router.post('/admin/marketing/flows/:id/run', async (ctx) => {
    const current = session(ctx)
    const flow = listFlows(db(), current.store.id).find((entry) => entry.id === ctx.params.id)
    if (!flow) throw notFound('No such flow')
    const sent = await runFlow(db(), flow, process.env.AMBORAS_PUBLIC_ORIGIN ?? ctx.url.origin)
    return back(ctx, sent ? `Sent ${sent} message${sent === 1 ? '' : 's'}.` : 'No eligible unsent customers right now.')
  })

  router.get('/admin/settings/export', (ctx) => {
    const current = session(ctx)
    const backup = exportStore(db(), current.store.id)
    const filename = `${current.store.slug}-storemill-backup-${backup.exportedAt.slice(0, 10)}.json`
    recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'export_store', target: current.store.id, diff: { filename } })
    return new Raw(JSON.stringify(backup, null, 2), 'application/json; charset=utf-8', {
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    })
  })

  router.post('/admin/settings/pixels/:id', async (ctx) => {
    const current = session(ctx)
    const pixel = ctx.params.id as string
    if (!['ga4', 'meta-pixel', 'tiktok-pixel'].includes(pixel)) throw notFound('No such pixel')
    const body = await ctx.body()
    try {
      install(db(), current.store.id, pixel, body)
      invalidateStorefrontConfig(current.store.id)
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'connect_pixel', target: pixel, diff: { connected: true } })
      return redirect('/admin/settings?flash=' + encodeURIComponent(`${pixel === 'ga4' ? 'GA4' : pixel === 'meta-pixel' ? 'Meta Pixel' : 'TikTok Pixel'} connected. It will fire only on the live storefront.`))
    } catch (error) {
      return redirect(`/admin/settings?flash=${encodeURIComponent(`!${error instanceof Error ? error.message : 'Could not connect the pixel'}`)}`)
    }
  })

  router.get('/admin/domains', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'domains', 'Domains', growth.domainsPage(ctxFor(current, ctx)))
  })

  router.post('/admin/domains', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    try {
      const record = attachDomain(db(), current.store.id, { hostname: String(body.hostname ?? ''), mode: (body.mode === 'forward' ? 'forward' : 'host') as DomainMode, registrar: String(body.registrar ?? 'other') })
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'attach_domain', target: record.hostname, diff: { mode: record.mode, registrar: record.registrar } })
      return redirect(`/admin/domains?flash=${encodeURIComponent(`${record.hostname} attached. Add the records below at your registrar, then check.`)}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not attach that domain'}`)
    }
  })

  router.post('/admin/domains/check', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const check = await checkDomain(db(), current.store.id, String(body.hostname ?? ''), publicUrl(ctx, current.store))
      if (check.verified) refreshTodos(db(), current.store.id)
      return back(ctx, `${check.verified ? '' : '!'}${check.reason}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not check'}`)
    }
  })

  router.post('/admin/domains/verify', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    try {
      verifyDomain(db(), current.store.id, String(body.hostname ?? ''))
      refreshTodos(db(), current.store.id)
      return back(ctx, 'Marked verified without a lookup. If the name does not resolve here, visitors will not arrive.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not verify'}`)
    }
  })

  router.post('/admin/domains/remove', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    removeDomain(db(), current.store.id, String(body.hostname ?? ''))
    return back(ctx, 'Detached.')
  })

  /* ---------------------------------------------------------------- ads */

  router.get('/admin/ads', async (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'ads', 'Ads', await growth.adsPage(ctxFor(current, ctx), { ...(ctx.query.get('q') ? { q: ctx.query.get('q') as string } : {}), ...(ctx.query.get('country') ? { country: ctx.query.get('country') as string } : {}) }))
  })

  router.post('/admin/ads/draft', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const formats = (Array.isArray(body.formats) ? body.formats : body.formats ? [body.formats] : []) as string[]
    try {
      const ads = await draftAds(db(), current.store, { productId: String(body.productId ?? ''), platform: String(body.platform ?? 'meta') as AdPlatform, formats, direction: String(body.direction ?? ''), ...(body.avatarId ? { avatarId: String(body.avatarId) } : {}), count: Number(body.count ?? 3) || 3, ...(body.model ? { model: String(body.model) } : {}) })
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'draft_ads', target: String(body.productId ?? ''), diff: { formats: ads.map((ad) => ad.format), direction: body.direction } })
      return redirect(`/admin/ads?flash=${encodeURIComponent(`Drafted ${ads.length} ad${ads.length === 1 ? '' : 's'}: ${ads.map((ad) => ad.format).join(', ')}.`)}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not draft'}`)
    }
  })

  router.get('/admin/ads/:id', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'ads', 'Ad', growth.adDetail(ctxFor(current, ctx), ctx.params.id as string))
  })

  router.post('/admin/ads/:id/save', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const ad = getAd(db(), current.store.id, ctx.params.id as string)
    if (!ad) return notFound('No such ad')
    const linesOf = (value: unknown) => String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    const scriptCount = Number(body.script_count ?? 0) || 0
    const script = Array.from({ length: scriptCount }, (_, index) => ({ beat: String(body[`script_beat_${index}`] ?? ''), seconds: String(body[`script_seconds_${index}`] ?? ''), line: String(body[`script_line_${index}`] ?? ''), visual: String(body[`script_visual_${index}`] ?? '') }))
    saveAd(db(), current.store.id, {
      id: ad.id,
      name: String(body.name ?? ad.name),
      status: (['draft', 'ready', 'archived'].includes(String(body.status)) ? String(body.status) : ad.status) as 'draft',
      body: {
        hooks: linesOf(body.hooks),
        primaryText: body.primaryText !== undefined ? String(body.primaryText) : ad.body.primaryText,
        headline: String(body.headline ?? ad.body.headline),
        description: String(body.description ?? ad.body.description),
        cta: String(body.cta ?? ad.body.cta),
        ...(body.headlines !== undefined ? { headlines: linesOf(body.headlines) } : {}),
        ...(body.descriptions !== undefined ? { descriptions: linesOf(body.descriptions) } : {}),
        ...(scriptCount ? { script } : {}),
      },
    })
    return back(ctx, 'Saved.')
  })

  router.post('/admin/ads/:id/revise', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const ad = await reviseAd(db(), current.store, ctx.params.id as string, String(body.direction ?? ''))
      return back(ctx, `Revised: "${ad.body.hooks[0] ?? ad.body.headline}".`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not revise'}`)
    }
  })

  router.post('/admin/ads/:id/duplicate', (ctx) => {
    const current = session(ctx)
    const ad = getAd(db(), current.store.id, ctx.params.id as string)
    if (!ad) return notFound('No such ad')
    const copy = saveAd(db(), current.store.id, { productId: ad.productId, platform: ad.platform, format: ad.format, name: `${ad.name} (copy)`, direction: ad.direction, avatarId: ad.avatarId, body: ad.body, status: 'draft' })
    return redirect(`/admin/ads/${copy.id}?flash=${encodeURIComponent('Duplicated. This is the copy.')}`)
  })

  router.post('/admin/ads/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    deleteAd(db(), current.store.id, ctx.params.id as string)
    return redirect(`/admin/ads?flash=${encodeURIComponent('Deleted.')}`)
  })

  router.post('/admin/ads/inspiration/keep', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const saved = saveInspiration(db(), current.store.id, { hook: String(body.hook ?? ''), brand: String(body.brand ?? ''), url: String(body.url ?? ''), primaryText: String(body.primaryText ?? ''), source: String(body.source ?? 'paste') as 'paste' })
      return back(ctx, `Kept "${saved.hook.slice(0, 60)}".`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not keep that'}`)
    }
  })

  router.post('/admin/ads/inspiration/read', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const read = await readInspiration({ url: String(body.url ?? ''), text: String(body.text ?? ''), brand: String(body.brand ?? '') }, undefined, modelFor(db(), current.store.id, 'extraction'))
      const saved = saveInspiration(db(), current.store.id, read)
      return back(ctx, `Kept "${saved.hook.slice(0, 60)}" (${saved.angle}).${saved.notes ? ` ${saved.notes}` : ''}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not read that'}`)
    }
  })

  router.post('/admin/ads/inspiration/:id/delete', (ctx) => {
    const current = session(ctx)
    deleteInspiration(db(), current.store.id, ctx.params.id as string)
    return back(ctx, 'Removed from the swipe file.')
  })

  /* -------------------------------------------------------------- build */

  router.get('/admin/build', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'build', 'Build', plan.buildPage(ctxFor(current, ctx)))
  })

  router.post('/admin/build/mode', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const mode = modeById(String(body.mode ?? ''))
    if (!mode) return back(ctx, '!No such build mode.')
    setBuildMode(db(), current.store.id, mode.id)
    return back(ctx, `Building as "${mode.name}". First step: ${mode.steps[0]?.label}.`)
  })

  router.post('/admin/build/shape', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const doors = Array.isArray(body.doors) ? body.doors.map(String) : body.doors ? [String(body.doors)] : []
    try {
      const state = setSiteShape(db(), current.store.id, { ...(body.shape ? { shape: String(body.shape) } : {}), doors, popup: String(body.popup ?? '') })
      return back(ctx, `Shape saved: ${state.shape || 'undecided'}${state.doors.length ? ` with ${state.doors.join(' and ')} in front` : ''}. The page plan is below.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : String(error)}`)
    }
  })

  router.post('/admin/build/answers', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const state = saveAnswers(db(), current.store.id, Object.fromEntries(QUESTIONS.map((question) => [question.key, { value: String(body[question.key] ?? ''), unknown: body[`${question.key}_unknown`] === 'true' }])))
    const unknown = Object.values(state.answers).filter((answer) => answer.unknown).length
    return back(ctx, `Answers saved.${unknown ? ` ${unknown} marked "I don't know" — the market analysis will fill them in and label them as assumed.` : ''}`)
  })

  router.post('/admin/build/skip', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    skipStep(db(), current.store.id, String(body.key ?? ''), body.skipped !== 'false')
    return back(ctx, body.skipped !== 'false' ? 'Step skipped. It stays on the list so you can come back to it.' : 'Step is back in the plan.')
  })

  /* ------------------------------------------------------------- market */

  router.get('/admin/market', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'market', 'Market', plan.marketPage(ctxFor(current, ctx)))
  })

  router.post('/admin/market/analysis', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const doc = await runAnalysis(db(), current.store.id, { ...(body.notes ? { notes: String(body.notes) } : {}) })
      return back(ctx, `Market analysis ${doc.source === 'rules' ? 'written from the research by rules; set a model key for the real read' : `written by ${doc.model}`}. ${doc.body.standOut.found ? `Stand out via ${doc.body.standOut.via}.` : 'No way to stand out has been found yet — read the recommendation.'}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not write the analysis'}`)
    }
  })

  router.post('/admin/market/overview', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const doc = await runOverview(db(), current.store.id, String(body.productId ?? ''), current.store.currency)
      return back(ctx, `Product overview written for ${doc.body.name} (${doc.source}). Everything in it is assumed until you confirm it.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not write the overview'}`)
    }
  })

  router.post('/admin/market/plan', async (ctx) => {
    const current = session(ctx)
    try {
      const doc = await runAdPlan(db(), current.store.id)
      return back(ctx, `Ad plan: ${doc.body.rows.length} rows (${doc.source}).`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not write the plan'}`)
    }
  })

  router.post('/admin/market/plan/:index', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const status = ['idea', 'working', 'learning', 'done'].includes(String(body.status)) ? (String(body.status) as AdPlanRow['status']) : 'idea'
    try {
      updatePlanRow(db(), current.store.id, Number(ctx.params.index), { angle: String(body.angle ?? ''), variations: String(body.variations ?? '').split('\n').map((line) => line.trim()).filter(Boolean), status: status === 'done' && !String(body.learnings ?? '').trim() ? 'learning' : status, result: String(body.result ?? ''), learnings: String(body.learnings ?? '') })
      return back(ctx, status === 'done' && !String(body.learnings ?? '').trim() ? 'Saved as learning: a row is not done until its learnings are written.' : 'Row saved.')
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not save'}`)
    }
  })

  router.post('/admin/market/loop', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const linesOf = (value: unknown) => String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    saveLoop(db(), current.store.id, { ...(body.id ? { id: String(body.id) } : {}), failing: String(body.failing ?? ''), working: String(body.working ?? ''), hypotheses: linesOf(body.hypotheses), actions: linesOf(body.actions), outcome: String(body.outcome ?? '') })
    return back(ctx, 'Feedback loop saved.')
  })

  router.post('/admin/market/docs/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    deleteDoc(db(), current.store.id, ctx.params.id as string)
    return back(ctx, 'Deleted.')
  })

  router.post('/admin/avatars/:id/subs', async (ctx) => {
    const current = session(ctx)
    try {
      const subs = await suggestSubAvatars(db(), current.store.id, ctx.params.id as string)
      return back(ctx, `${subs.length} sub-avatars on file under that core avatar. Turn on the ones to write to.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not suggest'}`)
    }
  })

  /* ----------------------------------------------------------- creative */

  router.get('/admin/creative', (ctx) => {
    const current = session(ctx)
    return page(ctx, current, 'creative', 'Creative', plan.creativePage(ctxFor(current, ctx)))
  })

  router.post('/admin/creative/briefs', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const product = getProduct(db(), current.store.id, String(body.productId ?? ''))
    if (!product) return back(ctx, '!No such product.')
    const briefs = queuePhotoBriefs(db(), current.store.id, product)
    return back(ctx, `${briefs.length} photo briefs on the queue for ${product.title}.`)
  })

  router.post('/admin/creative/ugc', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const product = getProduct(db(), current.store.id, String(body.productId ?? ''))
    if (!product) return back(ctx, '!No such product.')
    const avatar = body.avatarId ? getAvatar(db(), current.store.id, String(body.avatarId)) : listAvatars(db(), current.store.id).find((entry) => entry.selected) ?? null
    try {
      const items = await queueUgcConcepts(db(), current.store.id, product, avatar, latestResearch(db(), current.store.id), modelFor(db(), current.store.id, 'ads'))
      return back(ctx, `${items.length} concepts queued for vetting. They are briefs for a real person to film, never reviews.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not write concepts'}`)
    }
  })

  router.post('/admin/creative/gif', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const item = makeProductGif(db(), current.store.id, { productId: String(body.productId ?? ''), delay: Number(body.delay ?? 70) || 70, maxSide: Number(body.maxSide ?? 480) || 480 })
      return back(ctx, `${item.title} is on the queue; approve it to add it to the product.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not make the GIF'}`)
    }
  })

  router.post('/admin/creative/:id/status', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const itemId = ctx.params.id as string
    const item = getQueueItem(db(), current.store.id, itemId)
    if (!item) return back(ctx, '!No such item.')
    const status = String(body.status ?? '')
    if (status === 'delete') { deleteQueueItem(db(), current.store.id, itemId); return back(ctx, 'Deleted.') }
    if (status === 'approved' && item.kind === 'gif') { approveGif(db(), current.store.id, itemId); return back(ctx, 'Approved and added to the product\'s media.') }
    if (status === 'approved' || status === 'rejected') { setQueueStatus(db(), current.store.id, itemId, status, String(body.note ?? '')); return back(ctx, status === 'approved' ? 'Approved.' : 'Rejected.') }
    return back(ctx, '!Unknown action.')
  })

  /* -------------------------------------------------------- pages: rip, suggest */

  router.post('/admin/pages/rip', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const result = await ripToPage(db(), current.store, { url: String(body.url ?? '').trim(), html: String(body.html ?? ''), productId: String(body.productId ?? ''), keepAngle: body.keepAngle !== 'false', direction: String(body.direction ?? ''), avatarId: String(body.avatarId ?? '') })
      recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'rip_funnel', target: result.page.id, diff: { sourceUrl: result.rip.sourceUrl, sections: result.rip.sections.length } })
      return redirect(`/admin/pages/${result.page.id}/edit?flash=${encodeURIComponent(`Built from ${result.rip.sections.length} sections; ${result.rip.imageBriefs.length} image briefs are in the alt text of the image blocks. ${result.source === 'model' ? 'The copy is written.' : 'No model is configured, so the copy is placeholders that say what each section did.'}`)}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not read that page'}`)
    }
  })

  router.post('/admin/pages/suggest', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const goal = (PAGE_GOALS.includes(String(body.goal) as PageGoal) ? String(body.goal) : 'offer') as PageGoal
    const product = body.productId ? getProduct(db(), current.store.id, String(body.productId)) : null
    const avatar = body.avatarId ? getAvatar(db(), current.store.id, String(body.avatarId)) : listAvatars(db(), current.store.id).find((entry) => entry.selected) ?? null
    const suggestion = await suggestBlocks(modelFor(db(), current.store.id, 'pages'), { goal, product, research: latestResearch(db(), current.store.id), avatar, direction: String(body.direction ?? ''), custom: customCatalog(db(), current.store.id) })
    const created = createPage(db(), current.store.id, { title: `${product ? `${product.title} — ` : ''}${goal} page (suggested)`, kind: goal === 'advertorial' ? 'advertorial' : goal === 'checkout' ? 'checkout' : goal === 'pdp' ? 'product' : 'landing', role: goal === 'checkout' ? 'checkout' : 'page', blocks: suggestion.blocks.map((block) => newBlock(block.type, block.settings ?? {})), ...(product && goal !== 'checkout' ? { productId: product.id } : {}) })
    return redirect(`/admin/pages/${created.id}/edit?flash=${encodeURIComponent(`${suggestion.blocks.length} blocks laid out (${suggestion.source}). ${suggestion.note}`)}`)
  })

  /* -------------------------------------------------------- popup, legal */

  router.post('/admin/popup', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const trigger = ['exit', 'delay', 'scroll'].includes(String(body.trigger)) ? (String(body.trigger) as 'exit') : 'exit'
    const kind = (['email', 'offer', 'quiz'] as const).find((entry) => entry === String(body.kind ?? '')) ?? 'email'
    setTheme(db(), current.store.id, { popup: { enabled: body.enabled === 'true', trigger, after: Number(body.after ?? 20) || 20, kind, headline: String(body.headline ?? ''), text: String(body.text ?? ''), code: String(body.code ?? '').trim(), buttonLabel: String(body.buttonLabel ?? 'Send it'), href: String(body.href ?? '#offer').trim() || '#offer', validDays: Math.max(0, Number(body.validDays ?? 0) || 0), image: String(body.image ?? '').trim(), dismissDays: Number(body.dismissDays ?? 7) || 7 } }, { build: 'Popup edited' })
    return back(ctx, body.enabled === 'true' ? 'Popup saved to the draft. Publish to make it live.' : 'Popup is off in the draft.')
  })

  router.post('/admin/legal', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    saveLegal(db(), current.store.id, { company: String(body.company ?? ''), email: String(body.email ?? ''), address: String(body.address ?? ''), country: String(body.country ?? ''), returnsDays: Number(body.returnsDays ?? 30) || 30, guaranteeDays: Number(body.guaranteeDays ?? 30) || 30, privacyExtra: String(body.privacyExtra ?? ''), termsExtra: String(body.termsExtra ?? '') })
    return back(ctx, 'Legal details saved. The privacy and terms pages read them now.')
  })

  /* ------------------------------------------------------------ avatars */

  router.post('/admin/avatars/suggest', async (ctx) => {
    const current = session(ctx)
    const avatars = await suggestAvatars(db(), current.store.id)
    return back(ctx, avatars.length ? `${avatars.length} avatars on file.` : '!Run research first; avatars are suggested from it.')
  })

  router.post('/admin/avatars/save', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    if (body.toggle === 'true' && body.id) {
      const avatar = saveAvatar(db(), current.store.id, { id: String(body.id), name: String(body.name ?? ''), selected: body.selected === 'true' })
      return back(ctx, `${avatar.name} is ${avatar.selected ? 'on' : 'off'}.`)
    }
    try {
      const avatar = saveAvatar(db(), current.store.id, {
        ...(body.id ? { id: String(body.id) } : {}),
        name: String(body.name ?? ''),
        who: String(body.who ?? ''),
        wants: String(body.wants ?? ''),
        fears: String(body.fears ?? ''),
        buysWhen: String(body.buysWhen ?? ''),
        share: (Number(body.share ?? 0) || 0) / 100,
        angle: String(body.angle ?? ''),
        hooks: String(body.hooks ?? '').split('\n').map((line) => line.trim()).filter(Boolean),
        tone: String(body.tone ?? 'plain') as 'plain',
        objection: String(body.objection ?? ''),
        answer: String(body.answer ?? ''),
        selected: body.selected === 'true',
        ...(body.desire !== undefined ? { desire: String(body.desire ?? ''), experience: String(body.experience ?? ''), emotion: String(body.emotion ?? ''), behaviour: String(body.behaviour ?? ''), demographic: String(body.demographic ?? ''), label: String(body.label ?? ''), tier: (['niche', 'mid', 'mass'].includes(String(body.tier)) ? String(body.tier) : '') as 'niche', parentId: String(body.parentId ?? '') } : {}),
        ...(body.id ? {} : { source: 'manual' as const }),
      })
      return back(ctx, `Saved ${avatar.name}.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not save'}`)
    }
  })

  router.post('/admin/avatars/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    deleteAvatar(db(), current.store.id, ctx.params.id as string)
    return back(ctx, 'Avatar deleted.')
  })

  /* -------------------------------------------------------- competitors */

  router.post('/admin/competitors/read', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const angle = await readCompetitor({ url: String(body.url ?? ''), html: String(body.html ?? '') }, undefined, modelFor(db(), current.store.id, 'extraction'))
      const record = saveCompetitor(db(), current.store.id, { productId: String(body.productId ?? ''), angle })
      return back(ctx, `${record.brand || 'The page'} runs the ${record.angle} angle${record.headline ? `: "${record.headline.slice(0, 70)}"` : ''}. Edit what was pulled below.${record.notes.length ? ` ${record.notes.join(' ')}` : ''}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not read that page'}`)
    }
  })

  router.post('/admin/competitors/:id/save', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const linesOf = (value: unknown) => String(value ?? '').split('\n').map((line) => line.trim()).filter(Boolean)
    saveCompetitor(db(), current.store.id, {
      id: ctx.params.id as string,
      productId: String(body.productId ?? ''),
      angle: {
        brand: String(body.brand ?? ''),
        url: String(body.url ?? ''),
        angle: String(body.angle ?? 'benefit') as AngleKind,
        headline: String(body.headline ?? ''),
        subheadline: String(body.subheadline ?? ''),
        hooks: linesOf(body.hooks),
        benefits: linesOf(body.benefits),
        offer: { price: String(body.price ?? ''), comparePrice: String(body.comparePrice ?? ''), discount: String(body.discount ?? ''), shipping: String(body.shipping ?? ''), guarantee: String(body.guarantee ?? ''), bundle: String(body.bundle ?? '') },
        proof: { reviewCount: String(body.reviewCount ?? ''), rating: String(body.rating ?? ''), badges: String(body.badges ?? '').split(',').map((line) => line.trim()).filter(Boolean) },
        audience: String(body.audience ?? ''),
        ctas: String(body.ctas ?? '').split('|').map((line) => line.trim()).filter(Boolean),
        take: String(body.take ?? ''),
      },
    })
    return back(ctx, 'Saved.')
  })

  router.post('/admin/competitors/:id/apply', (ctx) => {
    const current = session(ctx)
    try {
      const research = applyCompetitor(db(), current.store.id, ctx.params.id as string)
      return back(ctx, `Folded in. The research now lists ${research.competitors.length} competitors and ${research.triggers.length} triggers.`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not apply'}`)
    }
  })

  router.post('/admin/competitors/:id/versions', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const record = getCompetitor(db(), current.store.id, ctx.params.id as string)
    if (!record?.productId) return back(ctx, '!Pick which product this competes with first.')
    try {
      const pages = await generateVersions(db(), current.store, { productId: record.productId, kind: 'pdp', direction: String(body.direction ?? ''), count: 2 })
      return redirect(`/admin/products/${record.productId}?flash=${encodeURIComponent(`Generated ${pages.length} versions from the ${record.angle} angle.`)}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not generate'}`)
    }
  })

  router.post('/admin/competitors/:id/ads', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const record = getCompetitor(db(), current.store.id, ctx.params.id as string)
    if (!record?.productId) return back(ctx, '!Pick which product this competes with first.')
    try {
      const ads = await draftAds(db(), current.store, { productId: record.productId, direction: String(body.direction ?? ''), count: 3 })
      return redirect(`/admin/ads?flash=${encodeURIComponent(`Drafted ${ads.length} ads from the ${record.angle} angle.`)}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not draft'}`)
    }
  })

  router.post('/admin/competitors/:id/delete', (ctx) => {
    const current = adminSession(ctx)
    deleteCompetitor(db(), current.store.id, ctx.params.id as string)
    return back(ctx, 'Deleted.')
  })

  /* -------------------------------------------------------------- images */

  router.post('/admin/products/:id/regenerate', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    try {
      const result = await execute(
        'regenerate_product_image',
        { productId: ctx.params.id as string, direction: String(body.direction ?? ''), preset: String(body.preset ?? 'white-seamless'), provider: String(body.provider ?? 'auto'), lanes: Math.min(4, Math.max(1, Number(body.lanes ?? 3) || 3)) },
        { db: db(), storeId: current.store.id, actor: { type: 'user', id: current.user.id }, page: 'products' },
      )
      return back(ctx, result.summary)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not render'}`)
    }
  })

  router.post('/admin/products/:id/use-image', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const product = getProduct(db(), current.store.id, ctx.params.id as string)
    if (!product) return notFound('No such product')
    const url = String(body.url ?? '')
    if (!url) return back(ctx, '!No image chosen.')
    const alt = `${product.title}`
    if (body.as === 'hero') updateProduct(db(), current.store.id, product.id, { heroImage: url, media: [{ url, alt }, ...product.media.filter((entry) => entry.url !== url)].slice(0, 8) })
    else updateProduct(db(), current.store.id, product.id, { media: [...product.media.filter((entry) => entry.url !== url), { url, alt }].slice(0, 8) })
    return back(ctx, body.as === 'hero' ? 'That is the hero image now.' : 'Added to the gallery.')
  })

  router.post('/admin/team', async (ctx) => {
    const current = session(ctx)
    requireRole(db(), current.user.id, current.store.id, 'owner')
    const body = await ctx.body()
    try {
      const role = body.role === 'admin' ? 'admin' : 'member'
      const result = inviteTeammate(db(), current.store.id, String(body.email ?? ''), role)
      const link = `${process.env.AMBORAS_PUBLIC_ORIGIN || ctx.url.origin}/join/${result.invite}`
      return back(ctx, result.joined ? 'They already had an account and now have access.' : `Invite created. Send them this link: ${link}`)
    } catch (error) {
      return back(ctx, `!${error instanceof Error ? error.message : 'Could not invite'}`)
    }
  })

  /** Which model writes what, per store. Empty means the environment default. */
  router.post('/admin/settings/models', async (ctx) => {
    const current = adminSession(ctx)
    const body = await ctx.body()
    const models: Partial<Record<Task, string>> = {}
    for (const task of TASKS) {
      const value = String(body[task.id] ?? '')
      const choice = parseChoice(value)
      if (choice && catalog().some((entry) => entry.provider === choice.provider && entry.model === choice.model)) models[task.id] = value
    }
    updateStore(db(), current.store.id, { models })
    recordAudit(db(), { storeId: current.store.id, actorType: 'user', actorId: current.user.id, action: 'set_models', diff: models })
    return back(ctx, 'Model choices saved for this store.')
  })

  /* ------------------------------------------------------------- the agent */

  router.post('/admin/ask', async (ctx) => {
    const current = session(ctx)
    const body = await ctx.body()
    const targetId=String(body.storeId || current.store.id)
    requireRole(db(),current.user.id,targetId,'admin')
    const text = String(body.text ?? '').trim().slice(0,16000)
    if (!text) return back(ctx)
    const request = enqueueAssistantRequest(db(), {
      storeId: targetId,
      userId: current.user.id,
      text,
      page: captureAssistantContext(db(),targetId,String(body.page||''),body.context),
    })
    queueMicrotask(() => void drainAssistantQueue(db(), targetId).catch(() => undefined))
    if(String(ctx.req.headers.accept||'').includes('application/json'))return {id:request.id,status:request.status}
    return back(ctx, `Request ${request.id.slice(-6)} queued.`)
  })

  router.get('/admin/assistant/state',ctx=>{
    const user=requireUser(db(),ctx),storeId=ctx.query.get('storeId')||session(ctx).store.id;
    requireRole(db(),user.id,storeId);const queue=listAssistantQueue(db(),storeId,8),active=queue.filter(r=>r.status==='queued'||r.status==='running');
    const recent=queue[0];return {html:assistantMessages(history(db(),storeId,30)),busy:active.length>0,status:active.length?`${active.length} request${active.length===1?'':'s'} in progress…`:recent?.status==='failed'?recent.error:recent?.status==='completed'?'Finished. Review the changes on your page.':''};
  });

  router.post('/admin/assistant/queue/:id/cancel', (ctx) => {
    const current = session(ctx)
    const cancelled = cancelAssistantRequest(db(), current.store.id, ctx.params.id as string)
    return back(ctx, cancelled ? 'Queued request cancelled.' : '!Only waiting requests can be cancelled.')
  })

  /** The live activity stream behind the rail dots. */
  router.get('/admin/activity', (ctx) => {
    const current = session(ctx)
    const stream = sse(ctx)
    for (const event of recentActivity(current.store.id, 5)) stream.send('activity', event)
    const off = onActivity(current.store.id, (event) => stream.send('activity', event))
    ctx.req.on('close', off)
    return undefined
  })

  return router
}

export { NoStores, STORE_COOKIE, storeUrl }
