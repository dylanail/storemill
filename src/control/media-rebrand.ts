import { notFound } from '../lib/http.ts'
import { createHash } from 'node:crypto'
import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { saveMediaUpload } from '../lib/uploads.ts'
import { requireRole } from './auth.ts'
import { environment, getStore } from './stores.ts'
import { listStoreMedia, setMediaDetails } from './media.ts'
import { replaceMediaHtml, replaceMediaValue } from './media-references.ts'
import { getPage, savePageRevision } from '../pages/store.ts'
import { recordAudit } from './todos.ts'
import { cancelVideoTask, loadMedia, mediaEditingAvailability, renderRebrand, type RebrandSpec } from './media-render.ts'

export type RebrandJob = { id: string; store_id: string; actor_id: string; request_key: string; source_url: string; original_url: string; result_url: string; kind: 'image' | 'video'; spec: string; status: 'queued' | 'working' | 'review' | 'applied' | 'failed' | 'cancelled' | 'undone'; phase: string; error: string; provider_task: string; changes: string; created_at: string; updated_at: string }
export function listRebrands(db: Db, storeId: string) { return db.all<RebrandJob>('SELECT * FROM media_rebrands WHERE store_id = ? ORDER BY created_at DESC LIMIT 50', storeId) }
export function getRebrand(db: Db, storeId: string, jobId: string): RebrandJob {
  const job = db.one<RebrandJob>('SELECT * FROM media_rebrands WHERE id = ? AND store_id = ?', jobId, storeId)
  if (!job) throw notFound('This rebrand was not found in the selected asset')
  return job
}
export function rebrandDefaults(db: Db, storeId: string): RebrandSpec {
  const store = getStore(db, storeId)!, draft = environment(db, storeId, 'draft')
  const last = db.one<{ spec: string }>('SELECT spec FROM media_rebrands WHERE store_id=? ORDER BY created_at DESC LIMIT 1', storeId)
  const preferred = json<Partial<RebrandSpec>>(last?.spec, {})
  return { brandName: preferred.brandName || draft.brand.name || store.brand.name || store.name, logo: preferred.logo ?? (draft.brand.logoSvg || store.brand.logoSvg || ''), oldBrand: '', direction: '', method: 'ai', provider: process.env.OPENAI_API_KEY ? 'openai' : 'google', position: 'bottom-right', width: 18, frame: 0, intent:'rebrand',references:[],preserve:'',shape:'original',audio:'keep' }
}
export function startRebrand(db: Db, storeId: string, actorId: string, source: string, input: Partial<RebrandSpec>, requestKey = ''): RebrandJob {
  requireRole(db, actorId, storeId)
  if (requestKey && !/^[a-z0-9_]{8,80}$/.test(requestKey)) throw new Error('Invalid edit request. Reload the form.')
  if (requestKey) { const prior = db.one<RebrandJob>('SELECT * FROM media_rebrands WHERE store_id=? AND request_key=?', storeId, requestKey); if (prior) return prior }
  const media = listStoreMedia(db, storeId).find(item => item.url === source)
  if (!media || media.kind === 'embed') throw new Error('Choose an image or direct video file from this asset’s Media library. Embedded players need the original video file.')
  const defaults = rebrandDefaults(db, storeId), spec = { ...defaults, ...input }
  for (const key of ['brandName', 'logo', 'oldBrand', 'direction', 'preserve'] as const) spec[key] = String(spec[key] ?? '').trim()
  if (!spec.brandName || spec.brandName.length > 100 || spec.oldBrand.length > 100 || spec.direction.length > 6000 || (spec.preserve?.length||0) > 1500 || spec.logo.length > 100_000) throw new Error('Enter a brand name up to 100 characters and directions up to 6,000 characters')
  if (!['ai', 'overlay'].includes(spec.method) || !['openai', 'google'].includes(spec.provider) || !['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'].includes(spec.position)) throw new Error('Choose one of the available editing options')
  if (!Number.isFinite(spec.width) || spec.width < 5 || spec.width > 40 || !Number.isFinite(spec.frame) || spec.frame < 0 || spec.frame > 29.9) throw new Error('Logo width must be 5–40%; video reference time must be between 0 and 29.9 seconds')
  if (spec.logo && spec.logo !== defaults.logo && !listStoreMedia(db, storeId).some(item => item.url === spec.logo && item.kind === 'image')) throw new Error('Upload the desired logo to this asset’s Media library first')
  if(!['rebrand','custom','cleanup','background','enhance','restyle'].includes(spec.intent||'rebrand')||!['original','square','landscape','portrait'].includes(spec.shape||'original')||!['keep','mute'].includes(spec.audio||'keep'))throw new Error('Choose supported output and editing options')
  if(spec.method==='ai'&&spec.intent==='custom'&&!spec.direction)throw new Error('Describe what you want to change')
  if(!Array.isArray(spec.references)||spec.references.length>3||spec.references.some(url=>typeof url!=='string'||!listStoreMedia(db,storeId).some(item=>item.url===url&&item.kind==='image')))throw new Error('Choose up to three reference images from this asset')
  if(media.kind==='video'&&spec.shape!=='original')throw new Error('Video edits keep the original frame shape')
  const available = mediaEditingAvailability()
  if (!available.rendering) throw new Error('Media editing needs FFmpeg and FFprobe installed on the server')
  if (spec.method === 'overlay' && !spec.logo) throw new Error('Choose or upload your desired logo for the overlay')
  if (spec.method === 'ai' && !available.images.find(model => model.id === spec.provider)?.available) throw new Error('Connect the selected image provider, or choose a logo overlay')
  if (spec.method === 'ai' && media.kind === 'video' && !available.video) throw new Error('AI video replacement needs a Runway API key and an image provider. Logo overlays work without API keys.')
  // A double click, reload or network retry must not submit the same paid edit twice.
  const existing = listRebrands(db, storeId).find(job => job.source_url === source && ['queued', 'working'].includes(job.status) && job.spec === JSON.stringify(spec))
  if (existing) return existing
  if ((db.one<{ n: number }>("SELECT COUNT(*) n FROM media_rebrands WHERE store_id = ? AND status IN ('queued','working')", storeId)?.n || 0) >= 10) throw new Error('Wait for an existing edit to finish before adding more')
  const jobId = id('rebrand'), time = now()
  db.insert('media_rebrands', { id: jobId, store_id: storeId, actor_id: actorId, request_key: requestKey, source_url: source, kind: media.kind, spec, created_at: time, updated_at: time })
  recordAudit(db, { storeId, actorType: 'user', actorId, action: 'start_media_rebrand', target: jobId, diff: { source, method: spec.method, brandName: spec.brandName } })
  return getRebrand(db, storeId, jobId)
}

const workers = new WeakMap<Db, { busy: boolean; controllers: Map<string, AbortController> }>()
function worker(db: Db) {
  let state = workers.get(db)
  if (!state) {
    state = { busy: false, controllers: new Map() }; workers.set(db, state)
    // A provider submission interrupted before its task ID was saved is deliberately not repeated.
    db.run("UPDATE media_rebrands SET status='failed', error='The server restarted during this edit. Review provider usage before starting a new edit.', phase='Edit interrupted', updated_at=? WHERE status='working' AND provider_task=''", now())
  }
  return state
}
export async function drainRebrands(db: Db): Promise<void> {
  const state = worker(db)
  if (state.busy) return
  const job = db.one<RebrandJob>("SELECT * FROM media_rebrands WHERE status IN ('queued','working') ORDER BY created_at LIMIT 1")
  if (!job) return
  state.busy = true
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(job.kind === 'video' ? 30 * 60_000 : 10 * 60_000)])
  state.controllers.set(job.id, controller)
  const update = (values: Row) => { if (!signal.aborted && db.one<{ status: string }>('SELECT status FROM media_rebrands WHERE id=?', job.id)?.status === 'working') db.update('media_rebrands', job.id, { ...values, updated_at: now() }) }
  try {
    db.update('media_rebrands', job.id, { status: 'working', phase: 'Preparing the original media', updated_at: now() })
    let original = job.original_url
    if (!original) {
      const file = await loadMedia(job.source_url, job.store_id, job.kind, signal)
      signal.throwIfAborted()
      original = saveMediaUpload({ ...file, name: 'original' }, job.store_id).url
      update({ original_url: original })
    }
    const result = await renderRebrand({ storeId: job.store_id, source: original, kind: job.kind, spec: json<RebrandSpec>(job.spec, {} as RebrandSpec), task: job.provider_task, signal, phase: phase => update({ phase }), saveTask: task => {
      // Always retain the task identity, even if cancellation raced with the create response.
      db.update('media_rebrands', job.id, { provider_task: task }); if (signal.aborted) void cancelVideoTask(task)
    } })
    const category=listStoreMedia(db,job.store_id).find(item=>item.url===job.source_url)?.category||'media'
    setMediaDetails(db,job.store_id,result,category,'Edited '+(category==='logo'?'logo':job.kind))
    update({ result_url: result, status: 'review', phase: 'Ready to review', error: '' })
  } catch (error) {
    const current = db.one<RebrandJob>('SELECT * FROM media_rebrands WHERE id=?', job.id)
    if (current && current.status !== 'cancelled') db.update('media_rebrands', job.id, { status: 'failed', phase: 'Edit needs attention', error: signal.aborted ? 'The edit timed out. Your original is safe. Check provider usage before trying again.' : error instanceof Error ? error.message : 'Could not edit this media', updated_at: now() })
    if (current?.provider_task && signal.aborted) await cancelVideoTask(current.provider_task)
  } finally { state.controllers.delete(job.id); state.busy = false }
}
export async function cancelRebrand(db: Db, storeId: string, actorId: string, jobId: string) {
  requireRole(db, actorId, storeId)
  const job = getRebrand(db, storeId, jobId)
  if (!['queued', 'working'].includes(job.status)) return
  db.update('media_rebrands', jobId, { status: 'cancelled', phase: 'Cancelled', updated_at: now() })
  workers.get(db)?.controllers.get(jobId)?.abort(new Error('Cancelled'))
  await cancelVideoTask(job.provider_task)
}

type Change = { table: string; id: string; before: Record<string, unknown>; after: Record<string, unknown> }
const fields: Record<string, { json: string[]; html?: string[]; plain?: string[] }> = {
  products: { json: ['media', 'metadata'], plain: ['hero_image'] }, variants: { json: [], plain: ['image'] }, collections: { json: [], plain: ['image'] },
  pages: { json: ['blocks', 'seo'], html: ['raw_html'] }, custom_blocks: { json: ['fields'], html: ['template', 'css'] },
  stores: { json: ['brand'], plain: ['reference_image'] }, store_environments: { json: ['brand', 'theme'] },
  creative_queue: { json: ['body'] },
}
export function rebrandChanges(db: Db, storeId: string, source: string, result: string): Change[] {
  const changes: Change[] = []
  for (const [table, shape] of Object.entries(fields)) {
    const rows = db.all(`SELECT * FROM ${table} WHERE ${table === 'stores' ? 'id' : 'store_id'} = ?${table === 'store_environments' ? " AND kind = 'draft'" : ''}`, storeId)
    for (const row of rows) {
      const before: Row = {}, after: Row = {}
      for (const key of [...shape.json, ...(shape.html || []), ...(shape.plain || [])]) {
        const value = row[key]; if (typeof value !== 'string') continue
        const next = shape.json.includes(key) ? JSON.stringify(replaceMediaValue(json(value, null), source, result)) : shape.html?.includes(key) ? replaceMediaHtml(value, source, result) : value === source ? result : value
        // Do not count JSON whitespace normalization as a media edit.
        if (next !== value && (!shape.json.includes(key) || next !== JSON.stringify(json(value, null)))) { before[key] = value; after[key] = next }
      }
      if (Object.keys(after).length) changes.push({ table, id: row.id as string, before, after })
    }
  }
  return changes
}
export function changesToken(changes: Change[]): string { return createHash('sha256').update(JSON.stringify(changes)).digest('hex') }
export function applyRebrand(db: Db, storeId: string, actorId: string, jobId: string, token: string): number {
  requireRole(db, actorId, storeId)
  return db.tx(() => {
    const job = getRebrand(db, storeId, jobId)
    if (job.status === 'applied') return json<Change[]>(job.changes, []).length
    if (job.status !== 'review' || !job.result_url) throw new Error('Wait for a completed preview before applying')
    const changes = rebrandChanges(db, storeId, job.source_url, job.result_url)
    if (changesToken(changes) !== token) throw new Error('This asset changed since you opened the preview. Refresh and review the updated usage before applying.')
    if (!changes.length) throw new Error('This media is no longer used in editable content. Copy the new URL from the preview to use it.')
    for (const change of changes) {
      if (change.table === 'pages') { const page = getPage(db, storeId, change.id); if (page) savePageRevision(db, page, 'Before media rebrand') }
      db.update(change.table, change.id, change.after)
      if (change.table === 'pages') { const page = getPage(db, storeId, change.id); if (page) savePageRevision(db, page, 'Applied media rebrand') }
    }
    db.update('media_rebrands', jobId, { status: 'applied', phase: 'Applied to this asset', changes, updated_at: now() })
    recordAudit(db, { storeId, actorType: 'user', actorId, action: 'apply_media_rebrand', target: jobId, diff: { records: changes.length, source: job.source_url, result: job.result_url } })
    return changes.length
  })
}
export function undoRebrand(db: Db, storeId: string, actorId: string, jobId: string): number {
  requireRole(db, actorId, storeId)
  return db.tx(() => {
    const job = getRebrand(db, storeId, jobId)
    if (job.status !== 'applied') throw new Error('This rebrand is not currently applied')
    const changes = json<Change[]>(job.changes, [])
    for (const change of changes) {
      if (!fields[change.table]) throw new Error('Invalid rebrand history')
      const current = db.one(`SELECT * FROM ${change.table} WHERE id=? AND ${change.table === 'stores' ? 'id' : 'store_id'}=?`, change.id, storeId)
      if (!current || Object.entries(change.after).some(([key, value]) => current[key] !== value)) throw new Error('Some media fields were edited after this rebrand. Restore those fields in the editor to preserve the newer work.')
    }
    for (const change of changes) {
      db.update(change.table, change.id, change.before)
      if (change.table === 'pages') { const page = getPage(db, storeId, change.id); if (page) savePageRevision(db, page, 'Undid media rebrand') }
    }
    db.update('media_rebrands', jobId, { status: 'undone', phase: 'Original media restored', updated_at: now() })
    recordAudit(db, { storeId, actorType: 'user', actorId, action: 'undo_media_rebrand', target: jobId, diff: { records: changes.length } })
    return changes.length
  })
}
