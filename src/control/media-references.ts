/** Attribute entities are decoded for matching, then escaped by the caller on output. */
export const mediaDecode = (value: string) => value.replace(/&amp;/gi, '&').replace(/&#(?:x26|38);/gi, '&').replace(/&quot;/gi, '"').replace(/&#(?:x27|39);/gi, "'")
const attr = /\b(src|srcset|poster|data-src|data-srcset|data-lazy-src|data-original|content)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi
const clean = (raw: string) => mediaDecode(raw.replace(/^(["'])([\s\S]*)\1$/, '$2'))
export function srcsetUrls(value: string): string[] {
  return value.split(/,\s*(?![^ ]*;base64)/).map(entry => entry.trim().split(/\s+/)[0] || '').filter(Boolean)
}
export function htmlMedia(html: string): Array<{ url: string; kind: 'image' | 'video' | 'embed' }> {
  const out: Array<{ url: string; kind: 'image' | 'video' | 'embed' }> = []
  let video = false
  for (const match of html.matchAll(/<(\/)?(img|source|video|iframe)\b([^>]*)>/gi)) {
    const tag = match[2]!.toLowerCase()
    if (tag === 'video') video = !match[1]
    if (match[1]) continue
    for (const a of match[3]!.matchAll(attr)) {
      const name = a[1]!.toLowerCase()
      const kind = tag === 'iframe' ? 'embed' : name === 'poster' ? 'image' : tag === 'video' || tag === 'source' && video ? 'video' : 'image'
      for (const url of name.endsWith('srcset') ? srcsetUrls(clean(a[2]!)) : [clean(a[2]!)]) out.push({ url, kind })
    }
  }
  for (const m of html.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) out.push({ url: mediaDecode(m[2]!), kind: 'image' })
  return out
}

/** Replace a media reference, including its responsive alternatives, without changing prose or links. */
export function replaceMediaHtml(html: string, from: string, to: string): string {
  const matches = (value: string) => clean(value) === from || srcsetUrls(clean(value)).includes(from)
  const replaceTag = (tag: string, force = false) => {
    const selected = force || [...tag.matchAll(attr)].some(a => matches(a[2]!))
    return tag.replace(attr, (all, name: string, raw: string) => {
      const isVideo = /^<video\b/i.test(tag), isMeta = /^<meta\b/i.test(tag)
      if (!selected || isVideo && name === 'poster' && clean(raw) !== from || isMeta && clean(raw) !== from) return all
      if (name === 'content' && !isMeta) return all
      // A video poster remains an image. Replacing a poster must leave the video source intact.
      if (isVideo && name !== 'poster' && [...tag.matchAll(attr)].some(a => a[1] === 'poster' && clean(a[2]!) === from)) return all
      const value = name.endsWith('srcset') ? clean(raw).split(',').map(part => part.trim().replace(/^\S+/, to)).join(', ') : to
      return `${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`
    })
  }
  // Picture/source alternatives represent the same visual; video alternatives the same clip.
  let result = html.replace(/<(picture|video)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block => {
    if (!htmlMedia(block).some(m => m.url === from && m.kind !== 'embed')) return block
    const posterOnly = /^<video/i.test(block) && /\bposter\s*=/.test(block) && !htmlMedia(block).some(m => m.url === from && m.kind === 'video')
    return block.replace(/<(?:img|source|video)\b[^>]*>/gi, tag => replaceTag(tag, !posterOnly && !/^<video/i.test(tag)))
  })
  result = result.replace(/<(?:img|source|video|meta)\b[^>]*>/gi, tag => replaceTag(tag))
  return result.replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (all, _q, value) => mediaDecode(value) === from ? `url("${to}")` : all)
}

export function replaceMediaValue(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value === from ? to : /<|url\(/i.test(value) ? replaceMediaHtml(value, from, to) : value
  if (Array.isArray(value)) return value.map(entry => replaceMediaValue(entry, from, to))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, replaceMediaValue(entry, from, to)]))
  return value
}
