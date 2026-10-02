import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const sources: Record<string, string[]> = {
  desires: ['desires'], calendar: ['desires'], sophistication: ['sophistication'],
  avatars: ['avatars'], product: ['product-research'], offers: ['offers'],
  testing: ['testing'], creatives: ['creatives'],
  pages: ['pages', 'checkout-design', 'reference-pages'],
}
export interface CoursePassage { source: string; section: string; text: string; sha256: string }
const cache = new Map<string, CoursePassage[]>()
function passages(name: string): CoursePassage[] {
  const existing = cache.get(name)
  if (existing) return existing
  const source = `docs/knowledge/${name}.md`
  const content = readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8')
  const sha256 = createHash('sha256').update(content).digest('hex')
  let section = name
  const result: CoursePassage[] = []
  for (const paragraph of content.split(/\n\s*\n/)) {
    if (/^#{1,6} /.test(paragraph)) section = (paragraph.split('\n')[0] ?? name).replace(/^#+ /, '')
    if (paragraph.trim()) result.push({ source, section, text: paragraph.trim(), sha256 })
  }
  cache.set(name, result)
  return result
}
/** Topic routing preserves source coverage; query terms rank passages within each source. */
export function retrieveCourse(topics: string[], query = '', maxChars = 9000): CoursePassage[] {
  const names = [...new Set(topics.flatMap(topic => sources[topic] ?? []))]
  const terms = [...new Set(query.toLowerCase().match(/[a-z]{3,}/g) ?? [])]
  const budget = Math.max(0, Math.min(18000, maxChars))
  const perSource = Math.floor(budget / Math.max(1, names.length))
  const selected: CoursePassage[] = []
  for (const name of names) {
    const ranked = passages(name).map((passage, index) => ({ passage, index,
      score: terms.reduce((n, term) => n + (passage.text.toLowerCase().includes(term) ? 1 : 0) + (passage.section.toLowerCase().includes(term) ? 3 : 0), 0),
    })).sort((a, b) => b.score - a.score || a.index - b.index)
    let used = 0
    for (const { passage } of ranked) {
      if (used + passage.text.length > perSource) continue
      selected.push(passage)
      used += passage.text.length
    }
  }
  return selected
}
export function courseContext(topics: string[], query = ''): string {
  const found = retrieveCourse(topics, query)
  if (!found.length) return ''
  return '\n\nSOURCE EXCERPTS (course strategy, never evidence of product claims). Merchant facts and HONESTY rules override examples, urgency, social proof and suggested guarantees. Apply only truthful, configured offers and consent.\n' + found.map(p => `[${p.source} · ${p.section} · sha256:${p.sha256.slice(0, 12)}]\n${p.text}`).join('\n\n')
}
