import { bool, json, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { minorDigits } from '../lib/money.ts'

export type ShippingOption = {
  id: string
  regionId: string
  name: string
  amountCents: number
  freeAboveCents: number | null
  position: number
}

export type Region = {
  id: string
  storeId: string
  name: string
  currency: string
  locale: string
  exchangeRate: number
  countries: string[]
  taxRate: number
  isDefault: boolean
  shipping: ShippingOption[]
}

function rowToOption(row: Row): ShippingOption {
  return {
    id: row.id as string,
    regionId: row.region_id as string,
    name: row.name as string,
    amountCents: row.amount_cents as number,
    freeAboveCents: (row.free_above_cents as number | null) ?? null,
    position: row.position as number,
  }
}

export function listRegions(db: Db, storeId: string): Region[] {
  return db.all('SELECT * FROM regions WHERE store_id = ? ORDER BY is_default DESC, name', storeId).map((row) => ({
    id: row.id as string,
    storeId,
    name: row.name as string,
    currency: row.currency as string,
    locale: (row.locale as string) || 'en-US',
    exchangeRate: Number(row.exchange_rate ?? 1),
    countries: json(row.countries, [] as string[]),
    taxRate: row.tax_rate as number,
    isDefault: bool(row.is_default),
    shipping: db.all('SELECT * FROM shipping_options WHERE region_id = ? ORDER BY position', row.id).map(rowToOption),
  }))
}

export function defaultRegion(db: Db, storeId: string): Region | null {
  const regions = listRegions(db, storeId)
  return regions.find((region) => region.isDefault) ?? regions[0] ?? null
}

export function getRegion(db: Db, storeId: string, regionId: string): Region | null {
  return listRegions(db, storeId).find((region) => region.id === regionId) ?? null
}

export function createRegion(
  db: Db,
  storeId: string,
  input: { name: string; currency: string; countries: string[]; locale?: string; exchangeRate?: number; taxRate?: number; isDefault?: boolean },
): Region {
  const regionId = id('reg')
  db.tx(() => {
    if (input.isDefault) db.run('UPDATE regions SET is_default = 0 WHERE store_id = ?', storeId)
    const existing = db.one<{ c: number }>('SELECT COUNT(*) c FROM regions WHERE store_id = ?', storeId)?.c ?? 0
    db.insert('regions', {
      id: regionId,
      store_id: storeId,
      name: input.name,
      currency: input.currency.toUpperCase(),
      locale: input.locale ?? 'en-US',
      exchange_rate: Math.max(0.000001, input.exchangeRate ?? 1),
      countries: input.countries,
      tax_rate: input.taxRate ?? 0,
      is_default: input.isDefault ?? existing === 0,
    })
  })
  return getRegion(db, storeId, regionId) as Region
}

export function updateRegion(
  db: Db,
  storeId: string,
  regionId: string,
  input: { name?: string; currency?: string; countries?: string[]; locale?: string; exchangeRate?: number; taxRate?: number; isDefault?: boolean },
): Region {
  const region = getRegion(db, storeId, regionId)
  if (!region) throw new Error('No such region')
  if (input.isDefault) db.run('UPDATE regions SET is_default = 0 WHERE store_id = ?', storeId)
  db.update('regions', regionId, {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.currency !== undefined ? { currency: input.currency.toUpperCase() } : {}),
    ...(input.countries !== undefined ? { countries: input.countries } : {}),
    ...(input.locale !== undefined ? { locale: input.locale } : {}),
    ...(input.exchangeRate !== undefined ? { exchange_rate: Math.max(0.000001, input.exchangeRate) } : {}),
    ...(input.taxRate !== undefined ? { tax_rate: input.taxRate } : {}),
    ...(input.isDefault !== undefined ? { is_default: input.isDefault } : {}),
  })
  return getRegion(db, storeId, regionId) as Region
}

export function regionForCountry(db: Db, storeId: string, country: string): Region | null {
  const normalized = country.trim().toUpperCase()
  return listRegions(db, storeId).find((region) => region.countries.map((entry) => entry.toUpperCase()).includes(normalized)) ?? defaultRegion(db, storeId)
}

export function minorUnitRate(region: Pick<Region, 'currency' | 'exchangeRate'> | null | undefined, sourceCurrency = 'USD'): number {
  if (!region) return 1
  const sourceScale = 10 ** minorDigits(sourceCurrency)
  const targetScale = 10 ** minorDigits(region.currency)
  return region.exchangeRate * targetScale / sourceScale
}

export function convertCents(cents: number, region: Region | null | undefined, sourceCurrency = 'USD'): number {
  return Math.round(cents * minorUnitRate(region, sourceCurrency))
}

/** Reverse a charged regional amount into the store's base minor unit. */
export function toBaseCents(cents: number, region: Region | null | undefined, baseCurrency = 'USD'): number {
  if (!region) return cents
  const targetScale = 10 ** minorDigits(region.currency)
  const baseScale = 10 ** minorDigits(baseCurrency)
  return Math.round((cents / targetScale / region.exchangeRate) * baseScale)
}

export function addShippingOption(
  db: Db,
  regionId: string,
  input: { name: string; amountCents: number; freeAboveCents?: number | null },
): ShippingOption {
  const optionId = id('so')
  const count = db.one<{ c: number }>('SELECT COUNT(*) c FROM shipping_options WHERE region_id = ?', regionId)?.c ?? 0
  db.insert('shipping_options', {
    id: optionId,
    region_id: regionId,
    name: input.name,
    amount_cents: input.amountCents,
    free_above_cents: input.freeAboveCents ?? null,
    position: count,
  })
  return rowToOption(db.one('SELECT * FROM shipping_options WHERE id = ?', optionId) as Row)
}

/** Removes a region and its rates. The last one stays: a checkout with no region has no currency and no rate. */
export function deleteRegion(db: Db, storeId: string, regionId: string) {
  const regions = listRegions(db, storeId)
  const region = regions.find((entry) => entry.id === regionId)
  if (!region) throw new Error('No such region')
  if (regions.length === 1) throw new Error('A store needs one region: it is where the checkout gets its currency and its rates.')
  db.tx(() => {
    db.run('DELETE FROM shipping_options WHERE region_id = ?', regionId)
    db.run('DELETE FROM regions WHERE id = ? AND store_id = ?', regionId, storeId)
    if (region.isDefault) {
      const next = regions.find((entry) => entry.id !== regionId)
      if (next) db.run('UPDATE regions SET is_default = 1 WHERE id = ?', next.id)
    }
  })
}

export function updateShippingOption(
  db: Db,
  optionId: string,
  patch: { name?: string; amountCents?: number; freeAboveCents?: number | null; position?: number },
): ShippingOption {
  const values: Row = {}
  if (patch.name !== undefined) values.name = patch.name
  if (patch.amountCents !== undefined) values.amount_cents = patch.amountCents
  if (patch.freeAboveCents !== undefined) values.free_above_cents = patch.freeAboveCents
  if (patch.position !== undefined) values.position = patch.position
  if (Object.keys(values).length) db.update('shipping_options', optionId, values)
  return rowToOption(db.one('SELECT * FROM shipping_options WHERE id = ?', optionId) as Row)
}

/**
 * A rate by name: the same name changes the rate that is there rather than
 * adding a second one beside it. "Standard shipping" set twice used to leave
 * two standard rates, and the cart quoted whichever came first.
 */
export function setShippingOption(
  db: Db,
  regionId: string,
  input: { name: string; amountCents: number; freeAboveCents?: number | null },
): ShippingOption {
  const existing = db.one<{ id: string }>('SELECT id FROM shipping_options WHERE region_id = ? AND lower(name) = lower(?)', regionId, input.name)
  if (existing) return updateShippingOption(db, existing.id, { name: input.name, amountCents: input.amountCents, freeAboveCents: input.freeAboveCents ?? null })
  return addShippingOption(db, regionId, input)
}

/** Removes a rate. The last one in a region stays; without it the cart has nothing to quote. */
export function deleteShippingOption(db: Db, storeId: string, optionId: string) {
  const region = listRegions(db, storeId).find((entry) => entry.shipping.some((option) => option.id === optionId))
  if (!region) throw new Error('No such shipping rate')
  if (region.shipping.length === 1) throw new Error(`${region.name} needs one rate: the cart has nothing to quote without it.`)
  db.run('DELETE FROM shipping_options WHERE id = ?', optionId)
  // Positions stay contiguous — the first rate is the standard one a free
  // shipping promotion applies to, and a gap would make that arbitrary.
  region.shipping
    .filter((option) => option.id !== optionId)
    .forEach((option, index) => db.update('shipping_options', option.id, { position: index }))
}

/** Per-region free-shipping thresholds: the cheapest option that clears wins. */
export function rateFor(region: Region | null, subtotalCents: number, freeShipping: boolean, optionId?: string): { name: string; amountCents: number; gapCents: number | null; optionId: string } {
  if (!region || !region.shipping.length) {
    return { name: 'Standard', amountCents: 0, gapCents: null, optionId: '' }
  }
  const option = (optionId ? region.shipping.find((entry) => entry.id === optionId) : undefined) ?? (region.shipping[0] as ShippingOption)
  // Free shipping earned by a promotion applies to the standard rate; a
  // customer who picks express still pays the difference.
  if (freeShipping && option.position === 0) return { name: `${option.name} (free)`, amountCents: 0, gapCents: 0, optionId: option.id }
  const threshold = option.freeAboveCents
  if (threshold !== null && subtotalCents >= threshold) {
    return { name: `${option.name} (free over threshold)`, amountCents: 0, gapCents: 0, optionId: option.id }
  }
  return {
    name: option.name,
    amountCents: option.amountCents,
    gapCents: threshold === null ? null : Math.max(0, threshold - subtotalCents),
    optionId: option.id,
  }
}

export function seedDefaultRegion(db: Db, storeId: string, currency: string): Region {
  const region = createRegion(db, storeId, {
    name: 'United States',
    currency,
    locale: 'en-US',
    exchangeRate: 1,
    countries: ['US'],
    taxRate: 0,
    isDefault: true,
  })
  addShippingOption(db, region.id, { name: 'Standard shipping', amountCents: 900, freeAboveCents: 20000 })
  addShippingOption(db, region.id, { name: 'Express (2 day)', amountCents: 2400, freeAboveCents: null })
  return getRegion(db, storeId, region.id) as Region
}
