import { drainImports } from './control/asset-import-jobs.ts'
import './lib/env.ts'
import { recoverHealthFixes } from './storefront/health-fixes.ts'
import { createReadStream } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { drainRebrands } from './control/media-rebrand.ts'
import { brandAsset } from './brand/index.ts'
import { createServer } from 'node:http'
import { getDb } from './lib/db.ts'
import { HttpError, makeCtx, Raw, redirect, send, sendError, type Ctx } from './lib/http.ts'
import { logger } from './lib/log.ts'
import { renderSvg } from './agent/images.ts'
import { readUpload, uploadFileInfo } from './lib/uploads.ts'
import { recoverRuns, resumeQueuedRuns } from './agent/runtime.ts'
import { sweepMarketingFlows } from './email/flows.ts'
import { dispatchServerEvents } from './analytics/server-events.ts'
import { drainAssistantQueue, recoverAssistantQueue } from './agent/queue.ts'
import './agent/tools/index.ts'
import { adminRouter, NoStores } from './admin/routes.ts'
import { redirectFor, storeFromSlug, storefrontNotFound, storefrontRouter } from './storefront/routes.ts'
import { storeForHost, type Store } from './control/stores.ts'
import { roleOn, userFor } from './control/auth.ts'
import { tlsAllowed } from './control/domains.ts'
import { evaluateRunningExperiments } from './analytics/experiments.ts'

const log = logger('server')
const PORT = Number(process.env.PORT ?? 4100)
// Railway hands every service a public hostname; if no origin was configured
// by hand, that is the one abandoned-cart emails and ad links should carry.
if (!process.env.AMBORAS_PUBLIC_ORIGIN && process.env.RAILWAY_PUBLIC_DOMAIN) process.env.AMBORAS_PUBLIC_ORIGIN = `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
const ROOT_DOMAIN = process.env.AMBORAS_STOREFRONT_HOST ?? ''

/**
 * One process, three surfaces.
 *
 * Which one answers a request is decided by the host: a storefront domain (or
 * a subdomain of the configured root) gets the generated storefront, and
 * everything else gets the control plane. Two path prefixes make the whole
 * thing work on localhost with no DNS at all, and they are deliberately
 * different things:
 *
 *   /s/:slug        the live storefront, tracked, plugins firing — a customer
 *   /preview/:slug  the draft environment, untracked, pixels suppressed — the
 *                   merchant looking at their own unpublished work
 *
 * Collapsing those two would either count the merchant's own dashboard visits
 * as traffic or leave a host-less deployment with no analytics at all.
 */
function resolveStorefront(ctx: Ctx): { store: Store; preview: boolean; rest: string } | null {
  const path = ctx.url.pathname
  for (const [prefix, preview] of [['/preview/', true], ['/s/', false]] as const) {
    if (!path.startsWith(prefix)) continue
    const [slug = '', ...rest] = path.slice(prefix.length).split('/')
    const store = storeFromSlug(slug)
    if (!store) return null
    return { store, preview, rest: `/${rest.join('/')}` }
  }
  const store = storeForHost(getDb(), ctx.hostname, ROOT_DOMAIN)
  return store ? { store, preview: false, rest: path } : null
}

function closedStorefront(store: Store): Raw {
  const paused = store.status === 'paused'
  return new Raw(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${paused ? 'Temporarily closed' : 'Not open yet'}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f6f7;color:#202223;font:15px/1.6 ui-sans-serif,system-ui;padding:2rem;text-align:center}p{color:#6d7175;max-width:34rem}a{color:#2c6ecb}</style></head><body><div><h1>${paused ? 'Temporarily closed' : 'Not open yet'}</h1><p>${paused ? 'This shop is paused. It will be back.' : 'This shop has not opened yet.'}</p><p>If this is your asset, open its draft from <a href="/admin">your admin</a>.</p></div></body></html>`, 'text/html; charset=utf-8', { 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store' }, 503)
}

const admin = adminRouter()
const storefront = storefrontRouter((ctx) => {
  const resolved = (ctx as Ctx & { storefront?: { store: Store; preview: boolean } }).storefront
  return resolved ?? null
})

const server = createServer(async (req, res) => {
  const wantsHtml = String(req.headers.accept ?? '').includes('text/html')
  try {
    const ctx = makeCtx(req, res, {})
    const branding = brandAsset(ctx.url.pathname)
    if (branding && (req.method === 'GET' || req.method === 'HEAD')) {
      await send(res, new Raw(branding.body, branding.type, { 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' }), req)
      return
    }
    // Generated imagery is deterministic, so it can be cached hard and served
    // without touching the database at all.
    if (ctx.url.pathname === '/_media/render.svg') {
      await send(res, new Raw(renderSvg(ctx.url.searchParams), 'image/svg+xml; charset=utf-8', { 'Cache-Control': 'public, max-age=31536000, immutable' }), req)
      return
    }
    if (ctx.url.pathname.startsWith('/_uploads/')) {
      const found = uploadFileInfo(ctx.url.pathname)
      if (!found) throw new HttpError(404, 'No such upload')
      const headers: Record<string, string> = { 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', ...(found.type.startsWith('image/svg+xml') ? { 'Content-Security-Policy': "sandbox; script-src 'none'; object-src 'none'; base-uri 'none'" } : {}) }
      if (found.type.startsWith('video/')) {
        headers['Accept-Ranges'] = 'bytes'
        const range = req.headers.range
        if (range) {
          const match = /^bytes=(\d*)-(\d*)$/.exec(range)
          const start = match?.[1] ? Number(match[1]) : match?.[2] ? Math.max(0, found.bytes - Number(match[2])) : NaN
          const end = match?.[1] && match[2] ? Math.min(Number(match[2]), found.bytes - 1) : found.bytes - 1
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= found.bytes) { await send(res, new Raw('', found.type, { ...headers, 'Content-Range': `bytes */${found.bytes}` }, 416), req); return }
          res.writeHead(206, { ...headers, 'Content-Type': found.type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${found.bytes}` })
          if (req.method === 'HEAD') res.end()
          else await pipeline(createReadStream(found.path, { start, end }), res).catch(error => { if (!res.destroyed) throw error })
          return
        }
        res.writeHead(200, { ...headers, 'Content-Type': found.type, 'Content-Length': found.bytes })
        if (req.method === 'HEAD') res.end()
        else await pipeline(createReadStream(found.path), res).catch(error => { if (!res.destroyed) throw error })
        return
      }
      await send(res, new Raw(readUpload(ctx.url.pathname)!.data, found.type, headers), req)
      return
    }
    if (ctx.url.pathname === '/healthz') {
      await send(res, { ok: true, uptime: Math.round(process.uptime()) })
      return
    }
    // Caddy asks here before issuing a certificate on demand. Only names this
    // deployment actually serves get one: the admin host, the storefront root
    // and its subdomains, and custom domains that have verified as hosted.
    if (ctx.url.pathname === '/_edge/tls-ask') {
      const domain = (ctx.query.get('domain') ?? '').trim().toLowerCase()
      if (domain && tlsAllowed(getDb(), domain, ROOT_DOMAIN)) {
        await send(res, { ok: true, domain })
        return
      }
      throw new HttpError(404, 'Not a hostname this deployment serves')
    }

    const store = resolveStorefront(ctx)
    if (store?.preview) {
      const viewer = userFor(getDb(), ctx)
      if (!viewer || !roleOn(getDb(), viewer.id, store.store.id)) throw new HttpError(401, 'The draft of an asset is private')
    }
    if (store && !store.preview && store.store.status !== 'live') {
      await send(res, closedStorefront(store.store), req)
      return
    }
    if (store) {
      const moved = redirectFor(store.store, store.rest)
      if (moved) {
        await send(res, redirect(`${ROOT_DOMAIN && !store.preview ? '' : `${store.preview ? '/preview' : '/s'}/${store.store.slug}`}${moved.target}`, moved.code))
        return
      }
      const match = storefront.match(req.method ?? 'GET', store.rest)
      if (match) {
        const scoped = makeCtx(req, res, match.params) as Ctx & { storefront: { store: Store; preview: boolean } }
        scoped.storefront = { store: store.store, preview: store.preview }
        try {
          await send(res, await match.handler(scoped), req)
        } catch (error) {
          if (error instanceof HttpError && error.status === 404 && wantsHtml) await send(res, storefrontNotFound(scoped, store.store, store.preview), req)
          else throw error
        }
        return
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && wantsHtml) {
        await send(res, storefrontNotFound(ctx, store.store, store.preview), req)
        return
      }
    }

    const adminMatch = admin.match(req.method ?? 'GET', ctx.url.pathname)
    if (adminMatch) {
      await send(res, await adminMatch.handler(makeCtx(req, res, adminMatch.params)), req)
      return
    }

    // This deployment is one person's: there is nothing to sell at the root. It is the admin.
    if (ctx.url.pathname === '/') {
      await send(res, redirect('/admin'), req)
      return
    }
    throw new HttpError(404, 'Nothing here')
  } catch (error) {
    if (error instanceof NoStores) {
      await send(res, redirect('/onboarding'))
      return
    }
    if (error instanceof HttpError && error.status === 401 && wantsHtml) {
      await send(res, redirect('/login'))
      return
    }
    sendError(res, error, wantsHtml)
  }
})

const db = getDb()
recoverRuns(db)
resumeQueuedRuns(db)
recoverAssistantQueue(db)
recoverHealthFixes(db)
const origin = process.env.AMBORAS_PUBLIC_ORIGIN ?? `http://localhost:${PORT}`
setInterval(() => void sweepMarketingFlows(db, { origin }).catch(() => undefined), 5 * 60_000).unref()
setInterval(() => void dispatchServerEvents(db).catch(() => undefined), 15_000).unref()
setInterval(() => void drainImports(db).catch(() => undefined), 1_000).unref()
setInterval(() => void drainRebrands(db).catch(() => undefined), 2_000).unref()
setInterval(() => void drainAssistantQueue(db).catch(() => undefined), 1_000).unref()
// Experiment decisions are cheap, local reads. Running them beside lifecycle
// flows keeps CRO autonomous without adding another process to a personal tool.
setInterval(() => evaluateRunningExperiments(db), 10 * 60_000).unref()
server.listen(PORT, () => {
  log.info(`storemill on http://localhost:${PORT}`)
  log.info(ROOT_DOMAIN ? `storefronts on *.${ROOT_DOMAIN}` : 'storefronts on /preview/:slug (set STOREMILL_STOREFRONT_HOST for subdomains)')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    log.info(`${signal} — closing`)
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 3000).unref()
  })
}

export { server }
