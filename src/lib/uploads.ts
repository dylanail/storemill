import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, renameSync, rmdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { id } from './ids.ts'
import type { UploadedFile } from './http.ts'

/**
 * Merchant uploads live on disk next to the database and are served from
 * `/_uploads/<id>.<ext>`. The id is random, so an upload URL cannot be
 * enumerated; the extension is derived from the declared type and never from
 * the client's filename, so nothing a browser sends can name a file `.html`.
 */
const ROOT = resolve(dirname(process.env.AMBORAS_DB ?? 'data/amboras.db'), 'uploads')

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/vnd.microsoft.icon': 'ico',
  'image/x-icon': 'ico',
}

const VIDEO_TYPES: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' }
const MEDIA_TYPES = { ...TYPES, ...VIDEO_TYPES }
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024

/** Media jobs and duplication can store videos; image-only form fields stay image-only. */
export function saveMediaUpload(file: UploadedFile, storeId: string): { url: string; path: string; type: string } {
  if (!/^[a-z0-9_]+$/.test(storeId)) throw new UploadError('Invalid asset id')
  if (!file.type.startsWith('video/')) return saveUpload(file, storeId)
  const ext = VIDEO_TYPES[file.type]
  if (!ext || file.data.length > MAX_VIDEO_BYTES) throw new UploadError('Use an MP4, WebM or MOV video under 100MB')
  const valid = ext === 'webm' ? file.data.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) : file.data.subarray(4, 8).toString() === 'ftyp'
  if (!valid) throw new UploadError('That file does not look like a supported video')
  const name = `${id('up')}.${ext}`, dir = join(ROOT, storeId)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, file.data)
  return { url: `/_uploads/${storeId}/${name}`, path, type: file.type }
}

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

export class UploadError extends Error {}

export type StoredUpload = { url: string; type: string; bytes: number; uploadedAt: string }

export function saveUpload(file: UploadedFile, storeId: string): { url: string; path: string; type: string } {
  const ext = TYPES[file.type.toLowerCase()]
  if (!ext) throw new UploadError(`Images only — ${file.type || 'that file'} is not one`)
  if (file.data.length > MAX_UPLOAD_BYTES) throw new UploadError('That image is over 12MB')
  if (!sniffs(file.data, ext)) throw new UploadError('That file does not look like the image it claims to be')
  const name = `${id('up')}.${ext}`
  const dir = join(ROOT, storeId)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, file.data)
  return { url: `/_uploads/${storeId}/${name}`, path, type: file.type }
}

export function uploadFileInfo(urlPath: string): { path: string; type: string; bytes: number } | null {
  const match = /^\/_uploads\/([a-z0-9_]+)\/(up_[a-z0-9]+\.[a-z0-9]+)$/.exec(urlPath)
  if (!match) return null
  const path = join(ROOT, match[1] as string, match[2] as string)
  if (!existsSync(path)) return null
  const ext = (match[2] as string).split('.').pop() ?? ''
  const type = Object.entries(MEDIA_TYPES).find(([, value]) => value === ext)?.[0] ?? 'application/octet-stream'
  const stat = statSync(path)
  return stat.isFile() ? { path, type, bytes: stat.size } : null
}

export function readUpload(urlPath: string): { data: Buffer; type: string } | null {
  const found = uploadFileInfo(urlPath)
  return found ? { data: readFileSync(found.path), type: found.type } : null
}

/** Every locally-owned image for one asset, including clones and model output. */
export function listUploads(storeId: string): StoredUpload[] {
  if (!/^[a-z0-9_]+$/.test(storeId)) return []
  const dir = join(ROOT, storeId)
  if (!existsSync(dir)) return []
  const uploads: StoredUpload[] = []
  for (const name of readdirSync(dir)) {
    if (!/^up_[a-z0-9]+\.[a-z0-9]+$/.test(name)) continue
    try {
      const stats = statSync(join(dir, name))
      const ext = name.split('.').pop() ?? ''
      const type = Object.entries(MEDIA_TYPES).find(([, value]) => value === ext)?.[0]
      if (type && stats.isFile()) uploads.push({ url: `/_uploads/${storeId}/${name}`, type, bytes: stats.size, uploadedAt: stats.mtime.toISOString() })
    } catch { /* a file removed during the scan simply disappears from the library */ }
  }
  return uploads.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
}

/** Move images cloned under a temporary id into the asset that now owns them. */
export function relocateUploads(fromStoreId: string, toStoreId: string): number {
  if (!/^[a-z0-9_]+$/.test(fromStoreId) || !/^[a-z0-9_]+$/.test(toStoreId)) throw new UploadError('Invalid asset id')
  const from = join(ROOT, fromStoreId)
  if (!existsSync(from)) return 0
  const to = join(ROOT, toStoreId)
  mkdirSync(to, { recursive: true })
  let moved = 0
  for (const name of readdirSync(from)) {
    if (!/^up_[a-z0-9]+\.[a-z0-9]+$/.test(name)) continue
    renameSync(join(from, name), join(to, name))
    moved++
  }
  try { rmdirSync(from) } catch { /* leave a non-empty temporary directory alone */ }
  return moved
}

/** Turns an upload URL back into a data URI, for embedding in generated SVG. */
export function uploadAsDataUri(urlPath: string): string | null {
  const found = readUpload(urlPath)
  if (!found) return null
  return `data:${found.type};base64,${found.data.toString('base64')}`
}

function sniffs(data: Buffer, ext: string): boolean {
  const sniffed = sniffImageType(data)
  return sniffed !== null && TYPES[sniffed] === ext
}

/** Share byte validation with the importer; MIME headers and filename extensions are not evidence of image bytes. */
export function sniffImageType(data: Buffer): string | null {
  const head = data.subarray(0, 12)
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg'
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (/^GIF8[79]a/.test(head.subarray(0, 6).toString())) return 'image/gif'
  if (head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP') return 'image/webp'
  if (head.subarray(4, 8).toString() === 'ftyp' && /(?:avif|avis)/.test(data.subarray(8, Math.min(data.readUInt32BE(0), 4096)).toString())) return 'image/avif'
  if (data.length >= 22 && head.readUInt16LE(0) === 0 && head.readUInt16LE(2) === 1 && head.readUInt16LE(4) > 0) return 'image/vnd.microsoft.icon'
  // SVG font/icon files often have an XML declaration, license comment and a
  // DOCTYPE before the root. Parse only that bounded prolog; never resolve DTDs.
  const text = data.subarray(0, 64 * 1024).toString('utf8')
  let index = 0
  while (index < text.length) {
    while (/[\s\uFEFF]/.test(text[index] ?? '') && index < text.length) index++
    if (/^<svg[\s/>]/i.test(text.slice(index))) return 'image/svg+xml'
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4)
      if (end < 0) return null
      index = end + 3
      continue
    }
    if (text.startsWith('<?', index)) {
      const end = text.indexOf('?>', index + 2)
      if (end < 0) return null
      index = end + 2
      continue
    }
    if (/^<!DOCTYPE\s+svg(?:\s|\[|>)/i.test(text.slice(index))) {
      let quote = '', subset = 0
      for (index += 9; index < text.length; index++) {
        const char = text[index]!
        if (quote) { if (char === quote) quote = ''; continue }
        if (char === '"' || char === "'") quote = char
        else if (char === '[') subset++
        else if (char === ']') subset--
        else if (char === '>' && subset === 0) { index++; break }
      }
      continue
    }
    return null
  }
  return null
}
