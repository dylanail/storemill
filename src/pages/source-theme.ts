import { readFileSync } from 'node:fs'
import type { Brand } from '../domain/types.ts'

export const sourceThemeScript = readFileSync(new URL('./source-theme.js', import.meta.url), 'utf8')
export const sourceThemeKeys = ['primary','secondary','paper','ink','surface','buttonText','border','displayFont','bodyFont','displayWeight','bodyWeight'] as const
export function cleanSourceTheme(input: unknown): NonNullable<Brand['sourceTheme']> {
  const result: Record<string,string|number> = {}
  if (!input || typeof input !== 'object') return result
  for (const key of sourceThemeKeys) {
    const value = (input as Record<string,unknown>)[key]
    if (key.endsWith('Weight')) { if (Number.isInteger(Number(value)) && Number(value)>=100 && Number(value)<=900) result[key]=Number(value) }
    else if (key.endsWith('Font')) { if (typeof value==='string' && /^[\w\s,'"-]{1,160}$/.test(value)) result[key]=value }
    else if (/^#[0-9a-f]{6}$/i.test(String(value))) result[key]=String(value).toLowerCase()
  }
  return result
}
export function sourceThemeFromHtml(html: string): NonNullable<Brand['sourceTheme']> {
  const tag=/<meta\b[^>]*name="amboras:source-theme"[^>]*>/i.exec(html)?.[0]
  const content=tag&&/content="([^"]*)"/i.exec(tag)?.[1]
  try { return cleanSourceTheme(JSON.parse((content||'').replace(/&quot;/g,'"').replace(/&amp;/g,'&'))) } catch { return {} }
}
export function fontFacesFromHtml(html: string): string {
  return [...new Set([...html.matchAll(/@font-face\s*\{[^{}]*\}/gi)].map(match=>match[0]).filter(rule=>!/[<>]/.test(rule)))].join('\n')
}
export function importedThemeHtml(brand: Brand): string {
  if(!brand.themeCustomized)return ''
  const data=JSON.stringify({...cleanSourceTheme(brand),themeCustomized:true,sourceTheme:cleanSourceTheme(brand.sourceTheme)}).replace(/</g,'\\u003c')
  return `<script data-store-theme-runtime>${sourceThemeScript}\napplySourceTheme(document,${data});</script>`
}
