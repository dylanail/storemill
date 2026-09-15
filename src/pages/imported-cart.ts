import type { Db } from '../lib/db.ts'
import { defaultRegion, updateShippingOption } from '../domain/regions.ts'
import { minorDigits } from '../lib/money.ts'
import { decodeMediaAttribute } from './clone-media.ts'

/** Only an empty source cart states the full threshold; a populated cart states the remaining gap. */
export function sourceFreeShippingThreshold(html: string, currency: string): number | null {
  if (!/cart-drawer-items\b[^>]*data-subtotal\s*=\s*["']0["']/i.test(html)) return null
  const text = decodeMediaAttribute(/<p\b[^>]*class=["'][^"']*cart-progress__text[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(html)?.[1] || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const symbol = currency === 'USD' ? '\\$' : currency === 'EUR' ? '€' : currency === 'GBP' ? '£' : null
  if (!symbol) return null
  const value = new RegExp(`Spend\\s*${symbol}\\s*([\\d,]+(?:\\.\\d{1,2})?)\\s*more to get FREE shipping`, 'i').exec(text)?.[1]
  const amount = value ? Math.round(Number(value.replace(/,/g, '')) * 10 ** minorDigits(currency)) : 0
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null
}

export function installSourceCartShipping(db: Db, storeId: string, html: string): boolean {
  const region = defaultRegion(db, storeId)
  if (!region?.shipping[0]) return false
  const threshold = sourceFreeShippingThreshold(html, region.currency)
  if (threshold === null) return false
  updateShippingOption(db, region.shipping[0].id, { freeAboveCents: threshold })
  return true
}
