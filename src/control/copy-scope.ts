export type CopyScope = 'page' | 'selected' | 'site'

export function copyScope(value: unknown, fallback: CopyScope = 'page'): CopyScope {
  if (value === undefined || value === '') return fallback
  if (value === 'page' || value === 'selected' || value === 'site') return value
  // Existing saved forms used "funnel" to mean an entire linked site.
  if (value === 'funnel') return 'site'
  throw new Error('Choose one page, only the listed pages, or the whole site.')
}
