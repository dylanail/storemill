import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { execFile, spawnSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readUpload, saveMediaUpload, MAX_VIDEO_BYTES, MAX_UPLOAD_BYTES, sniffImageType } from '../lib/uploads.ts'
import { assertPublicNetworkUrl } from '../pages/public-network.ts'
import { imageModels, renderSvg } from '../agent/images.ts'

export type RebrandSpec = { brandName: string; logo: string; oldBrand: string; direction: string; method: 'ai' | 'overlay'; provider: 'openai' | 'google'; position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; width: number; frame: number }
export type MediaFile = { data: Buffer; type: string }
export type MediaTransport = (url: string, init: RequestInit) => Promise<Response>
let testTransport: MediaTransport | null = null
export function useMediaTransport(transport: MediaTransport | null) { testTransport = transport }
const request: MediaTransport = (url, init) => (testTransport ?? fetch)(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(180_000)]) : AbortSignal.timeout(180_000) })
const runFile = promisify(execFile)
const ffmpeg = () => process.env.STOREMILL_FFMPEG || 'ffmpeg'
const ffprobe = () => process.env.STOREMILL_FFPROBE || 'ffprobe'
let ffAvailable: boolean | undefined
export function mediaEditingAvailability() {
  ffAvailable ??= spawnSync(ffmpeg(), ['-version'], { timeout: 3000, stdio: 'ignore' }).status === 0 && spawnSync(ffprobe(), ['-version'], { timeout: 3000, stdio: 'ignore' }).status === 0
  return { rendering: ffAvailable, images: imageModels().filter(m => m.id !== 'svg'), video: Boolean(process.env.RUNWAYML_API_SECRET) }
}
async function command(args: string[], signal: AbortSignal) {
  try { await runFile(ffmpeg(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...args], { signal, timeout: 600_000, maxBuffer: 1024 * 1024 }) }
  catch (error) { signal.throwIfAborted(); throw new Error((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Media editing needs FFmpeg installed on the server.' : 'Could not process this media file. Try a PNG logo or a standard MP4 video.') }
}
export async function downloadMedia(url: string, limit: number, signal: AbortSignal): Promise<MediaFile> {
  for (let hops = 0; hops < 6; hops++) {
    // Tests use an in-memory provider; production validates every redirect destination.
    if (!testTransport) await assertPublicNetworkUrl(url, { signal })
    else if (!/^https:\/\//i.test(url)) throw new Error('Media requires a public HTTPS URL')
    const response = await request(url, { redirect: 'manual', signal })
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel(); const next = response.headers.get('location')
      if (!next) throw new Error('The source media redirect has no destination')
      url = new URL(next, url).href; continue
    }
    if (!response.ok || !response.body) throw new Error(`Could not download the media (${response.status}). Upload a copy to the Media library.`)
    if (Number(response.headers.get('content-length') || 0) > limit) { await response.body.cancel(); throw new Error('This media file is too large') }
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let bytes = 0
    try {
      while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > limit) throw new Error('This media file is too large'); chunks.push(part.value) }
    } finally { await reader.cancel().catch(() => undefined) }
    const data = Buffer.concat(chunks)
    const type = sniffImageType(data) || (data.subarray(4, 8).toString() === 'ftyp' ? 'video/mp4' : data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) ? 'video/webm' : '')
    if (!type) throw new Error('The source URL did not return a supported image or video')
    return { data, type }
  }
  throw new Error('The media URL redirects too many times')
}
export async function loadMedia(url: string, storeId: string, kind: 'image' | 'video', signal: AbortSignal): Promise<MediaFile> {
  let file: MediaFile | null
  if (url.trim().startsWith('<svg') || url.trim().startsWith('<?xml')) file = { data: Buffer.from(url), type: 'image/svg+xml' }
  else if (url.startsWith('/_media/render.svg?')) {
    const params = new URL(url, 'http://storemill.invalid').searchParams, reference = params.get('ref')
    if (reference && !reference.startsWith(`/_uploads/${storeId}/`)) throw new Error('Choose media owned by this asset')
    file = { data: Buffer.from(renderSvg(params)), type: 'image/svg+xml' }
  } else if (url.startsWith('/_uploads/')) {
    if (!url.startsWith(`/_uploads/${storeId}/`)) throw new Error('Choose media owned by this asset')
    file = readUpload(url)
  } else file = await downloadMedia(url.startsWith('//') ? 'https:' + url : url, kind === 'video' ? MAX_VIDEO_BYTES : MAX_UPLOAD_BYTES, signal)
  if (!file || !file.type.startsWith(kind + '/')) throw new Error(`Choose a supported ${kind} file from this asset`)
  return file
}
/** Rasterize SVG as an isolated image, never as executable merchant HTML. */
export async function rasterizeSvg(data: Buffer, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted()
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH || (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome') ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : undefined)
  const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) })
  const abort = () => { void browser.close() }; signal.addEventListener('abort', abort, { once: true })
  try {
    const context = await browser.newContext({ viewport: { width: 4096, height: 4096 }, javaScriptEnabled: false, serviceWorkers: 'block' })
    await context.route('**/*', route => route.abort())
    const page = await context.newPage(); page.setDefaultTimeout(15000)
    await page.setContent(`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"></head><body style="margin:0;background:transparent"><img style="display:block;max-width:4096px;max-height:4096px" src="data:image/svg+xml;base64,${data.toString('base64')}"></body></html>`)
    await page.waitForFunction('document.images[0].complete && document.images[0].naturalWidth > 0')
    return await page.locator('img').screenshot({ omitBackground: true })
  } finally { signal.removeEventListener('abort', abort); await browser.close() }
}
async function raster(file: MediaFile, dir: string, name: string, signal: AbortSignal): Promise<MediaFile> {
  if (file.type === 'image/svg+xml') {
    // Native SVG decoders may resolve files independently of FFmpeg's network options.
    const svg = file.data.toString()
    if (/<!DOCTYPE|<!ENTITY|<script|<foreignObject|@import|url\(\s*(?!["']?#)|(?:href|src)\s*=\s*["'](?!#|data:image\/(?:png|jpeg|webp);base64,)|\bon\w+\s*=/i.test(svg)) throw new Error('This SVG contains external or active content. Upload a PNG version of your logo.')
    file = { data: await rasterizeSvg(file.data, signal), type: 'image/png' }
  }
  const input = join(dir, name + '.input'), output = join(dir, name + '.png')
  await writeFile(input, file.data)
  await command(['-protocol_whitelist', 'file,pipe', '-i', input, '-frames:v', '1', '-vf', "scale=w='min(4096,iw)':h='min(4096,ih)':force_original_aspect_ratio=decrease", output], signal)
  return { data: await readFile(output), type: 'image/png' }
}
export function rebrandPrompt(spec: RebrandSpec): string {
  return `Edit the first image for the merchant brand ${JSON.stringify(spec.brandName)}. ${spec.logo ? 'The second image is the exact desired brand logo: reproduce its lettering, symbol and colors accurately wherever branding appears.' : 'Use the desired brand name as the wordmark.'} Replace ${spec.oldBrand ? JSON.stringify(spec.oldBrand) : 'the existing commercial brand names and logos'} on packaging, products, labels and marketing graphics with the desired brand. Preserve the product shape, people, scene, composition, perspective, lighting, factual product information and image dimensions. Integrate the new branding naturally into the original surfaces. Do not add unrequested badges, claims or borders. Merchant direction: ${JSON.stringify(spec.direction || 'Keep the original design and change only branding.')}`
}
async function imageEdit(source: MediaFile, logo: MediaFile | null, spec: RebrandSpec, signal: AbortSignal): Promise<MediaFile> {
  const model = imageModels().find(m => m.id === spec.provider), key = model && process.env[model.envKey]
  if (!model || !key) throw new Error('Connect an image provider before using AI replacement.')
  const prompt = rebrandPrompt(spec)
  let response: Response
  if (spec.provider === 'openai') {
    const form = new FormData(); form.set('model', model.model); form.set('prompt', prompt); form.set('size', 'auto'); form.set('output_format', 'png')
    for (const [i, file] of [source, ...(logo ? [logo] : [])].entries()) form.append('image[]', new Blob([new Uint8Array(file.data)], { type: file.type }), i ? 'desired-logo.png' : 'original.png')
    response = await request('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal })
  } else {
    response = await request(`https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [...[source, ...(logo ? [logo] : [])].map(file => ({ inline_data: { mime_type: file.type, data: file.data.toString('base64') } })), { text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }), signal })
  }
  if (!response.ok) throw new Error(`The image provider rejected this edit (${response.status}). Check the provider key, credits and image access, then try again.`)
  const payload = await response.json() as any
  let data = payload.data?.[0]?.b64_json, type = 'image/png'
  if (!data) for (const c of payload.candidates ?? []) for (const p of c.content?.parts ?? []) { const i = p.inlineData ?? p.inline_data; if (i?.data) { data = i.data; type = i.mimeType ?? i.mime_type ?? type } }
  if (!data) throw new Error('The image provider returned no edited image. Try a clearer branding instruction.')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length > MAX_UPLOAD_BYTES || !sniffImageType(bytes)) throw new Error('The provider returned an invalid or oversized image')
  return { data: bytes, type }
}
async function runway(path: string, signal: AbortSignal, body?: unknown, method?: string): Promise<any> {
  const response = await request(`https://api.dev.runwayml.com/v1/${path}`, { method: method ?? (body ? 'POST' : 'GET'), headers: { Authorization: `Bearer ${process.env.RUNWAYML_API_SECRET}`, 'X-Runway-Version': '2024-11-06', 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal })
  if (!response.ok) throw new Error(`The video provider could not complete the request (${response.status}). Check your Runway key and credits.`)
  return response.status === 204 ? {} : response.json()
}
async function runwayUpload(file: MediaFile, name: string, signal: AbortSignal): Promise<string> {
  const uri = `data:${file.type};base64,${file.data.toString('base64')}`
  if (uri.length < 4 * 1024 * 1024) return uri
  const upload = await runway('uploads', signal, { filename: name, type: 'ephemeral' })
  if (typeof upload.uploadUrl !== 'string' || !/^runway:\/\//.test(upload.runwayUri)) throw new Error('The video provider returned an invalid upload destination')
  if (!testTransport) await assertPublicNetworkUrl(upload.uploadUrl, { signal })
  const form = new FormData(); for (const [key, value] of Object.entries(upload.fields ?? {})) form.set(key, String(value))
  form.set('file', new Blob([new Uint8Array(file.data)], { type: file.type }), name)
  const response = await request(upload.uploadUrl, { method: 'POST', body: form, redirect: 'error', signal })
  if (!response.ok) throw new Error('The video could not be uploaded to the editing provider')
  return upload.runwayUri
}
export async function cancelVideoTask(task: string) { if (task) await runway('tasks/' + encodeURIComponent(task), AbortSignal.timeout(15_000), undefined, 'DELETE').catch(() => undefined) }
const pause = (signal: AbortSignal) => new Promise<void>((resolve, reject) => { const onAbort = () => { clearTimeout(timer); reject(signal.reason) }; const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, 5000); signal.addEventListener('abort', onAbort, { once: true }); if (signal.aborted) onAbort() })

export async function renderRebrand(input: { storeId: string; source: string; kind: 'image' | 'video'; spec: RebrandSpec; task: string; signal: AbortSignal; phase: (text: string) => void; saveTask: (task: string) => void }): Promise<string> {
  const { storeId, kind, spec, signal, phase } = input, dir = await mkdtemp(join(tmpdir(), 'storemill-media-'))
  try {
    const source = await loadMedia(input.source, storeId, kind, signal), sourcePath = join(dir, 'source'), output = join(dir, kind === 'video' ? 'result.mp4' : 'result.png')
    await writeFile(sourcePath, source.data)
    const logo = spec.logo ? await raster(await loadMedia(spec.logo, storeId, 'image', signal), dir, 'logo', signal) : null
    const sourceImage = kind === 'image' ? await raster(source, dir, 'source-image', signal) : null
    if (sourceImage) await writeFile(sourcePath, sourceImage.data)
    const { stdout } = await runFile(ffprobe(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', sourcePath], { signal, timeout: 30_000 })
    const metadata = JSON.parse(stdout), width = Number(metadata.streams?.[0]?.width), height = Number(metadata.streams?.[0]?.height), duration = Number(metadata.format?.duration)
    if (!width || !height || width * height > 40_000_000) throw new Error('Unsupported image or video dimensions')
    if (kind === 'video' && (!duration || duration > 300)) throw new Error('Use a video up to 5 minutes long for logo overlays')
    if (spec.method === 'overlay') {
      if (!logo) throw new Error('Choose a logo for the overlay')
      phase('Adding your logo')
      const logoWidth = Math.max(16, Math.round(width * spec.width / 100)), margin = Math.max(8, Math.round(Math.min(width, height) * .025))
      const x = spec.position.endsWith('right') ? `W-w-${margin}` : String(margin), y = spec.position.startsWith('bottom') ? `H-h-${margin}` : String(margin)
      await command(['-protocol_whitelist', 'file,pipe', '-i', sourcePath, '-i', join(dir, 'logo.png'), '-filter_complex', `[1:v]scale=${logoWidth}:-1[logo];[0:v][logo]overlay=${x}:${y}:format=auto${kind === 'video' ? ',pad=ceil(iw/2)*2:ceil(ih/2)*2' : ''}[v]`, '-map', '[v]', ...(kind === 'video' ? ['-map', '0:a?', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart'] : ['-frames:v', '1']), output], signal)
    } else if (kind === 'image') {
      phase('Replacing image branding')
      const edited = await imageEdit(sourceImage!, logo, spec, signal)
      await writeFile(join(dir, 'edited.png'), edited.data)
      // Keep the exact source dimensions, so the replacement cannot shift the page layout.
      await command(['-i', join(dir, 'edited.png'), '-vf', `scale=${width}:${height}`, '-frames:v', '1', output], signal)
    } else {
      if (duration < 2 || duration > 30) throw new Error('AI video replacement supports complete clips from 2 to 30 seconds. Use a logo overlay for longer videos.')
      if (spec.frame >= duration) throw new Error('Choose a branding reference time inside this video')
      let task = input.task
      if (!task) {
        phase('Preparing a branded reference frame')
        await command(['-ss', String(spec.frame), '-i', sourcePath, '-frames:v', '1', join(dir, 'frame.png')], signal)
        const frame = await imageEdit({ data: await readFile(join(dir, 'frame.png')), type: 'image/png' }, logo, spec, signal)
        await writeFile(join(dir, 'frame-edit.png'), frame.data)
        const maxW = width >= height ? 1920 : 1080, maxH = width >= height ? 1080 : 1920
        await command(['-i', sourcePath, '-vf', `scale=w='min(${maxW},iw)':h='min(${maxH},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(dir, 'input.mp4')], signal)
        await command(['-i', join(dir, 'frame-edit.png'), '-vf', `scale=${width}:${height},scale=w='min(${maxW},iw)':h='min(${maxH},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2`, '-frames:v', '1', join(dir, 'guidance.png')], signal)
        phase('Sending the video for AI editing')
        const videoUri = await runwayUpload({ data: await readFile(join(dir, 'input.mp4')), type: 'video/mp4' }, 'source.mp4', signal)
        const referenceUri = await runwayUpload({ data: await readFile(join(dir, 'guidance.png')), type: 'image/png' }, 'reference.png', signal)
        const created = await runway('video_to_video', signal, { model: 'aleph2', videoUri, keyframes: [{ seconds: spec.frame, uri: referenceUri }], promptText: `Replace existing branding with ${spec.brandName}, matching the branded keyframe consistently throughout the entire video. Preserve the original product, scene, motion, camera and timing. ${spec.direction}`.slice(0, 1000), outputFormat: 'mp4' })
        if (typeof created.id !== 'string' || !created.id) throw new Error('The video provider returned no editing task')
        task = created.id; input.saveTask(task)
      }
      let finished: MediaFile | null = null
      while (!finished) {
        signal.throwIfAborted()
        const state = await runway('tasks/' + encodeURIComponent(task), signal)
        if (['FAILED', 'CANCELED', 'CANCELLED'].includes(state.status)) throw new Error('Video editing did not complete. Try another reference frame or a clearer branding instruction.')
        if (state.status === 'SUCCEEDED') {
          if (!state.output?.[0]) throw new Error('The video provider returned no edited clip')
          finished = await downloadMedia(state.output[0], MAX_VIDEO_BYTES, signal)
        } else { phase(state.status === 'RUNNING' ? 'Replacing branding throughout the video' : 'Waiting for the video provider'); await pause(signal) }
      }
      if (!finished.type.startsWith('video/')) throw new Error('The provider output is not a video')
      phase('Restoring the original audio')
      await writeFile(join(dir, 'edited.mp4'), finished.data)
      const probe = await runFile(ffprobe(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', join(dir, 'edited.mp4')], { signal, timeout: 30_000 })
      if (Math.abs(Number(JSON.parse(probe.stdout).format?.duration) - duration) > .6) throw new Error('The edited video has a different duration. The original has been kept.')
      await command(['-i', join(dir, 'edited.mp4'), '-i', sourcePath, '-map', '0:v:0', '-map', '1:a?', '-c:v', 'copy', '-c:a', 'aac', '-t', String(duration), '-movflags', '+faststart', output], signal)
    }
    signal.throwIfAborted()
    phase('Saving the preview')
    return saveMediaUpload({ name: kind === 'video' ? 'rebranded.mp4' : 'rebranded.png', type: kind === 'video' ? 'video/mp4' : 'image/png', data: await readFile(output) }, storeId).url
  } finally { await rm(dir, { recursive: true, force: true }) }
}
