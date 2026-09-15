import type { IncomingMessage, ServerResponse } from 'node:http'
import { brotliCompressSync, gzipSync, constants as zlib } from 'node:zlib'
import { logger } from './log.ts'

const log = logger('http')

export type Ctx = {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  /** Host without port — the router uses it to tell admin from storefront. */
  hostname: string
  params: Record<string, string>
  query: URLSearchParams
  cookies: Record<string, string>
  ip: string
  body: () => Promise<Record<string, unknown>>
  raw: () => Promise<Buffer>
  /** Files from a multipart form, keyed by field name. Empty for other bodies. */
  files: () => Promise<Record<string, UploadedFile>>
}

export type UploadedFile = { name: string; type: string; data: Buffer }

export type Handler = (ctx: Ctx) => unknown | Promise<unknown>

type Route = { method: string; segments: string[]; handler: Handler }

export class Router {
  private routes: Route[] = []

  add(method: string, pattern: string, handler: Handler): this {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler })
    return this
  }
  get(pattern: string, handler: Handler) { return this.add('GET', pattern, handler) }
  post(pattern: string, handler: Handler) { return this.add('POST', pattern, handler) }
  put(pattern: string, handler: Handler) { return this.add('PUT', pattern, handler) }
  del(pattern: string, handler: Handler) { return this.add('DELETE', pattern, handler) }

  /** Mounts another router under a prefix, preserving its own patterns. */
  mount(prefix: string, other: Router): this {
    const base = prefix.split('/').filter(Boolean)
    for (const route of other.routes) {
      this.routes.push({ ...route, segments: [...base, ...route.segments] })
    }
    return this
  }

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean)
    for (const route of this.routes) {
      if (route.method !== method && !(route.method === 'GET' && method === 'HEAD')) continue
      const params = matchSegments(route.segments, parts)
      if (params) return { handler: route.handler, params }
    }
    return null
  }
}

function matchSegments(segments: string[], parts: string[]): Record<string, string> | null {
  const params: Record<string, string> = {}
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i] as string
    if (segment === '*') {
      params['wildcard'] = parts.slice(i).join('/')
      return params
    }
    const part = parts[i]
    if (part === undefined) return null
    if (segment.startsWith(':')) {
      try { params[segment.slice(1)] = decodeURIComponent(part) }
      catch { throw badRequest('Invalid URL encoding') }
    }
    else if (segment !== part) return null
  }
  return segments.length === parts.length || segments.at(-1) === '*' ? params : null
}

export class HttpError extends Error {
  readonly status: number
  readonly detail: unknown
  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.detail = detail
  }
}

export const notFound = (what = 'Not found') => new HttpError(404, what)
export const badRequest = (what: string, detail?: unknown) => new HttpError(400, what, detail)
export const unauthorized = (what = 'Sign in to continue') => new HttpError(401, what)
export const forbidden = (what = 'Not allowed') => new HttpError(403, what)

/** Marker types the server turns into a response. */
export class Html {
  readonly body: string
  readonly status: number
  constructor(body: string, status = 200) {
    this.body = body
    this.status = status
  }
}
export class Redirect {
  readonly location: string
  readonly status: number
  constructor(location: string, status = 302) {
    this.location = location
    this.status = status
  }
}
export class Raw {
  readonly body: Buffer | string
  readonly contentType: string
  readonly headers: Record<string, string>
  readonly status: number
  constructor(body: Buffer | string, contentType: string, headers: Record<string, string> = {}, status = 200) {
    this.body = body
    this.contentType = contentType
    this.headers = headers
    this.status = status
  }
}

export function html(body: string, status = 200) { return new Html(body, status) }
export function redirect(location: string, status = 302) { return new Redirect(location, status) }

export function makeCtx(req: IncomingMessage, res: ServerResponse, params: Record<string, string>): Ctx {
  const host = req.headers.host ?? 'localhost'
  // TLS ends at whatever fronts the process (Caddy, Railway's edge, any load
  // balancer), so the scheme the visitor used arrives as a header. Without
  // it every absolute link the admin builds would say http://.
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').split(',')[0]?.trim().toLowerCase()
  const protocol = forwarded === 'https' ? 'https' : 'http'
  let url: URL
  try { url = new URL(req.url ?? '/', `${protocol}://${host}`) }
  catch { throw badRequest('Invalid request URL or host') }
  let cached: Buffer | null = null
  const raw = async () => {
    if (cached) return cached
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      // The media upload route authenticates before reading a video body. Other routes keep the small default limit.
      const limit = (url.pathname === '/admin/media/upload'||/^\/admin\/pages\/[^/]+\/media\/upload$/.test(url.pathname)) ? 101 * 1024 * 1024 : (url.pathname === '/admin/media/rebrand'||/^\/admin\/pages\/[^/]+\/media\/rebrand$/.test(url.pathname)) ? 20 * 1024 * 1024 : 8 * 1024 * 1024
      if (size > limit) throw badRequest('Request body too large')
      chunks.push(chunk as Buffer)
    }
    cached = Buffer.concat(chunks)
    return cached
  }
  let parsed: { fields: Record<string, unknown>; files: Record<string, UploadedFile> } | null = null
  const multipart = async () => {
    if (parsed) return parsed
    const type = String(req.headers['content-type'] ?? '')
    const boundary = /boundary=("?)([^";]+)\1/.exec(type)?.[2]
    parsed = boundary ? parseMultipart(await raw(), boundary) : { fields: {}, files: {} }
    return parsed
  }
  return {
    req,
    res,
    url,
    hostname: url.hostname,
    params,
    query: url.searchParams,
    cookies: parseCookies(req.headers.cookie),
    ip: String(req.headers['x-forwarded-for'] ?? '').split(',')[0]?.trim() || req.socket.remoteAddress || '0.0.0.0',
    raw,
    files: async () => (await multipart()).files,
    body: async () => {
      const buffer = await raw()
      if (!buffer.length) return {}
      const type = String(req.headers['content-type'] ?? '')
      if (type.startsWith('multipart/form-data')) return (await multipart()).fields
      if (type.includes('application/json')) {
        try {
          const parsed: unknown = JSON.parse(buffer.toString('utf8'))
          return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
        } catch {
          throw badRequest('Body is not valid JSON')
        }
      }
      const form = new URLSearchParams(buffer.toString('utf8'))
      const out: Record<string, unknown> = {}
      for (const [key, value] of form) {
        const existing = out[key]
        if (existing === undefined) out[key] = value
        else if (Array.isArray(existing)) existing.push(value)
        else out[key] = [existing, value]
      }
      return out
    },
  }
}

/**
 * A multipart/form-data parser with no dependencies. It handles what a browser
 * sends: text fields and file fields, one boundary, CRLF line ends. It does not
 * try to handle nested multipart or content-transfer-encoding, which browsers
 * do not send.
 */
export function parseMultipart(buffer: Buffer, boundary: string): { fields: Record<string, unknown>; files: Record<string, UploadedFile> } {
  const fields: Record<string, unknown> = {}
  const files: Record<string, UploadedFile> = {}
  const delimiter = Buffer.from(`--${boundary}`)
  let cursor = buffer.indexOf(delimiter)
  while (cursor !== -1) {
    cursor += delimiter.length
    if (buffer[cursor] === 0x2d && buffer[cursor + 1] === 0x2d) break // closing "--"
    cursor += 2 // CRLF
    const headerEnd = buffer.indexOf('\r\n\r\n', cursor)
    if (headerEnd === -1) break
    const headers = buffer.subarray(cursor, headerEnd).toString('utf8')
    const next = buffer.indexOf(delimiter, headerEnd)
    const bodyEnd = next === -1 ? buffer.length : next - 2
    const body = buffer.subarray(headerEnd + 4, bodyEnd)
    const name = /name="([^"]*)"/.exec(headers)?.[1]
    const filename = /filename="([^"]*)"/.exec(headers)?.[1]
    const contentType = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? 'application/octet-stream'
    if (name !== undefined) {
      if (filename !== undefined) {
        if (filename && body.length) files[name] = { name: filename, type: contentType, data: Buffer.from(body) }
      } else {
        const value = body.toString('utf8')
        const existing = fields[name]
        if (existing === undefined) fields[name] = value
        else if (Array.isArray(existing)) existing.push(value)
        else fields[name] = [existing, value]
      }
    }
    cursor = next
  }
  return { fields, files }
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const pair of header.split(';')) {
    const index = pair.indexOf('=')
    if (index === -1) continue
    // A corrupt or unrelated cookie must not prevent the whole site loading.
    try { out[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim()) }
    catch { /* Ignore only the malformed cookie, retaining valid session cookies. */ }
  }
  return out
}

export function setCookie(res: ServerResponse, name: string, value: string, options: { maxAge?: number; httpOnly?: boolean; path?: string } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path ?? '/'}`, 'SameSite=Lax']
  // Secure wherever the deployment is served over TLS — which is every real
  // one, since Caddy and Railway both terminate it. Left off on a plain
  // localhost origin, where the browser would drop the cookie entirely.
  if ((process.env.AMBORAS_PUBLIC_ORIGIN ?? '').startsWith('https://') || process.env.AMBORAS_STOREFRONT_HOST || process.env.RAILWAY_PUBLIC_DOMAIN) parts.push('Secure')
  if (options.httpOnly !== false) parts.push('HttpOnly')
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  const existing = res.getHeader('Set-Cookie')
  const list = Array.isArray(existing) ? existing : existing ? [String(existing)] : []
  res.setHeader('Set-Cookie', [...list, parts.join('; ')])
}

/**
 * Every text response is compressed when the client accepts it. Brotli where
 * offered, gzip otherwise; nothing under a kilobyte, nothing already binary.
 * A generated storefront page is ~40KB of HTML with its CSS inlined — about
 * 8KB on the wire this way, in one round trip, with no external stylesheet to
 * block on.
 */
function writeBody(req: IncomingMessage | undefined, res: ServerResponse, status: number, body: Buffer, headers: Record<string, string | number>) {
  const type = String(headers['Content-Type'] ?? '')
  const compressible = /^(text\/|application\/(json|xml|javascript)|image\/svg)/.test(type) && body.length > 1024
  const accept = String(req?.headers['accept-encoding'] ?? '')
  if (compressible && /\bbr\b/.test(accept)) {
    const out = brotliCompressSync(body, { params: { [zlib.BROTLI_PARAM_QUALITY]: 5 } })
    res.writeHead(status, { ...headers, 'Content-Encoding': 'br', 'Content-Length': out.length, Vary: 'Accept-Encoding' })
    res.end(out)
    return
  }
  if (compressible && /\bgzip\b/.test(accept)) {
    const out = gzipSync(body, { level: 6 })
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': out.length, Vary: 'Accept-Encoding' })
    res.end(out)
    return
  }
  res.writeHead(status, { ...headers, 'Content-Length': body.length })
  res.end(body)
}

export async function send(res: ServerResponse, result: unknown, req?: IncomingMessage) {
  // A handler that streams (server-sent events) has already written headers and
  // owns the response for as long as it stays open. Anything the router would
  // add after that is a crash, not a response.
  if (res.headersSent || res.writableEnded) return
  if (result instanceof Redirect) {
    res.writeHead(result.status, { Location: result.location })
    res.end()
    return
  }
  if (result instanceof Html) {
    writeBody(req, res, result.status, Buffer.from(result.body, 'utf8'), { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-cache' })
    return
  }
  if (result instanceof Raw) {
    const body = Buffer.isBuffer(result.body) ? result.body : Buffer.from(result.body, 'utf8')
    writeBody(req, res, result.status, body, { 'Content-Type': result.contentType, ...result.headers })
    return
  }
  if (result === undefined) {
    res.writeHead(204)
    res.end()
    return
  }
  writeBody(req, res, 200, Buffer.from(JSON.stringify(result, null, 2), 'utf8'), { 'Content-Type': 'application/json; charset=utf-8' })
}

export function sendError(res: ServerResponse, error: unknown, wantsHtml: boolean) {
  const status = error instanceof HttpError ? error.status : 500
  const message = error instanceof Error ? error.message : 'Something went wrong'
  const detail = error instanceof HttpError ? error.detail : undefined
  if (status >= 500) log.error(message, error instanceof Error ? error.stack : error)
  if (res.headersSent || res.writableEnded) return
  if (wantsHtml) {
    const body = Buffer.from(errorPage(status, message), 'utf8')
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length })
    res.end(body)
    return
  }
  const body = Buffer.from(JSON.stringify({ error: message, status, detail }, null, 2), 'utf8')
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length })
  res.end(body)
}

function errorPage(status: number, message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${status}</title>
<style>body{font:16px/1.6 ui-sans-serif,system-ui;background:#faf6f2;color:#1a1a1a;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:32rem;padding:2rem}h1{font-size:3rem;margin:0 0 .5rem;font-weight:300}a{color:#7a4a2b}</style>
<main><h1>${status}</h1><p>${escapeHtml(message)}</p><p><a href="/">Back</a></p></main>`
}

export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Server-sent events: the admin's live activity stream rides this. */
export function sse(ctx: Ctx) {
  ctx.res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  ctx.res.write(': open\n\n')
  const keepalive = setInterval(() => {
    if (!ctx.res.writableEnded) ctx.res.write(': ping\n\n')
  }, 15000)
  const close = () => {
    clearInterval(keepalive)
    if (!ctx.res.writableEnded) ctx.res.end()
  }
  ctx.req.on('close', close)
  return {
    send(event: string, data: unknown) {
      if (ctx.res.writableEnded) return
      ctx.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    close,
  }
}
