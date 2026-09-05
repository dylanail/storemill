import { marginFor, type Margin } from './ops.ts'
import type { Product } from './types.ts'

/**
 * Product qualification.
 *
 * docs/knowledge/product-research.md opens the whole method: "you can make any
 * product work; the question is how hard, and whether a way to stand out
 * exists before the first dollar is spent." Its hard criteria are a table —
 * AOV over $60, 3x landed cost, unit price over $15, a flat or rising trend,
 * light enough to ship, nothing patented or big-brand, and a stand-out named
 * before anything runs — and none of it was anywhere in the product. A store
 * could be built end to end around a $9 seasonal item at 1.4x on a declining
 * trend, and nothing would say so until the ads had run.
 *
 * This is the checklist, applied. Every check names the rule it is applying,
 * so a fail is arguable rather than oracular.
 */
export type Trend = 'up' | 'flat' | 'declining' | 'spike' | 'unknown'

export type QualifyInput = {
  title?: string
  /** What the unit costs to get to the customer: the supplier's price plus their shipping. */
  landedCostCents: number
  sellPriceCents: number
  /** Order value after bundles and add-ons; defaults to the unit price. */
  aovCents?: number
  weightGrams?: number
  trend?: Trend
  seasonal?: boolean
  patented?: boolean
  bigBrand?: boolean
  printOnDemand?: boolean
  /** Electronics or anything with a battery: the doc asks for the physical unit first. */
  tech?: boolean
  /** The underserved avatar or the mechanism this will run on. Empty is a fail, not a warning. */
  standOut?: string
}

export type Verdict = 'pass' | 'warn' | 'fail'
export type Check = { key: string; label: string; verdict: Verdict; detail: string; rule: string }

export type Qualification = {
  checks: Check[]
  /** run: nothing failing. work: something to fix first. skip: a hard criterion says no. */
  decision: 'run' | 'work' | 'skip'
  margin: Margin
  markup: number
  summary: string
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export function qualifyProduct(input: QualifyInput): Qualification {
  const price = Math.max(0, Math.round(input.sellPriceCents))
  const landed = Math.max(0, Math.round(input.landedCostCents))
  const aov = Math.max(price, Math.round(input.aovCents ?? price))
  const markup = landed > 0 ? Math.round((price / landed) * 100) / 100 : 0
  // The margin is the one the profit page uses, so the breakeven and target
  // ROAS a qualification quotes are the same numbers the campaign is read
  // against later.
  const margin = marginFor(price, { costCents: landed, shippingCents: 0 })
  const checks: Check[] = []
  const add = (key: string, label: string, verdict: Verdict, detail: string, rule: string) => checks.push({ key, label, verdict, detail, rule })

  add(
    'aov',
    'Order value',
    aov >= 6000 ? 'pass' : aov >= 4000 ? 'warn' : 'fail',
    aov >= 6000
      ? `${money(aov)} per order clears the line.`
      : `${money(aov)} per order. ${aov >= 4000 ? 'Bundles, a longer supply or an add-on can carry it over $60.' : 'A cost per purchase of $20–30 eats an order this size whole.'}`,
    'AOV over $60 after bundles; US CPMs are fixed and a low AOV cannot absorb a $20–30 cost per purchase',
  )

  add(
    'markup',
    'Markup on landed cost',
    !landed ? 'warn' : markup >= 3 ? 'pass' : markup >= 2 ? 'warn' : 'fail',
    !landed
      ? 'No landed cost on file, so the markup is unknown — the supplier quote and their shipping are what this is measured on.'
      : `${markup}x on ${money(landed)} landed${markup >= 5 ? ' — the ideal band' : markup >= 3 ? '' : `; 3x would be ${money(landed * 3)}`}.`,
    'At least 3x landed cost (COGS + shipping); 5x ideal',
  )

  add(
    'unit-price',
    'Unit price',
    price >= 1500 ? 'pass' : 'fail',
    price >= 1500 ? `${money(price)}.` : `${money(price)} is under the $15 floor; the ad cost does not scale down with the price.`,
    'Average unit price over $15',
  )

  if (price > 17000) {
    const breakevenCpa = Math.round((price * Math.max(0, margin.marginPercent)) / 100)
    add(
      'high-ticket',
      'High ticket',
      'warn',
      `At ${money(price)} the breakeven cost per purchase is about ${money(breakevenCpa)}. Days with zero purchases are normal at that price and are hard to read.`,
      'Avoid high ticket for beginners; a $170 product at 2x target ROAS has an $85 breakeven CPA',
    )
  }

  const trend = input.trend ?? 'unknown'
  add(
    'trend',
    'Trend',
    trend === 'up' || trend === 'flat' ? 'pass' : trend === 'unknown' ? 'warn' : 'fail',
    trend === 'unknown'
      ? 'Not checked. Google Trends, US, five years, on the niche keyword and two variants.'
      : trend === 'spike'
        ? 'A spike and crash is a moment that has already passed.'
        : trend === 'declining'
          ? 'Declining over five years: the market is leaving.'
          : `${trend === 'up' ? 'Rising' : 'Flat'} over five years.`,
    'Google Trends, US, 5 years: flat or up passes; declining fails; spike-and-crash fails',
  )

  if (input.weightGrams !== undefined) {
    add(
      'weight',
      'Weight',
      input.weightGrams <= 1000 ? 'pass' : input.weightGrams <= 2500 ? 'warn' : 'fail',
      `${(input.weightGrams / 1000).toFixed(2)}kg. ${input.weightGrams <= 1000 ? 'Cheap to ship.' : 'Shipping and returns both cost more than the margin expects.'}`,
      'Avoid heavy items; prefer supplements, skincare, small goods',
    )
  }

  if (input.seasonal) add('seasonality', 'Seasonality', 'warn', 'Fine to get going on; it will not carry a brand through a year.', 'Seasonality: fine to get going, not for a brand')
  if (input.tech) add('tech', 'Tech or battery', 'warn', 'Order the physical unit and test it before a pound of ad spend. Returns on a device that fails are the whole margin.', 'Tech and battery: extra caution; test the physical unit first')
  if (input.patented) add('patented', 'Patented', 'fail', 'Never a patented product.', 'Legal: never a patented product')
  if (input.bigBrand) add('big-brand', 'Big brand', 'fail', 'A brand with its own demand is not a product to test; the ad spend buys them the sale.', 'Disqualify instantly: patented, big-brand, print-on-demand, heavy, too cheap')
  if (input.printOnDemand) add('print-on-demand', 'Print on demand', 'fail', 'Print on demand has neither the margin nor the mechanism.', 'Disqualify instantly: patented, big-brand, print-on-demand, heavy, too cheap')

  add(
    'stand-out',
    'A way to stand out',
    input.standOut?.trim() ? 'pass' : 'fail',
    input.standOut?.trim() || 'No underserved avatar and no mechanism named. The doc is plain about this one: none found, do not run it.',
    'Decide the stand-out: list candidate underserved avatars and mechanisms. None → do not run it',
  )

  const failed = checks.filter((check) => check.verdict === 'fail')
  const warned = checks.filter((check) => check.verdict === 'warn')
  const decision = failed.length ? 'skip' : warned.length ? 'work' : 'run'
  const summary = failed.length
    ? `Skip it: ${failed.map((check) => check.label.toLowerCase()).join(', ')}.`
    : warned.length
      ? `Work on it first: ${warned.map((check) => check.label.toLowerCase()).join(', ')}.`
      : `Every hard criterion passes${margin.breakevenRoas ? `; breakeven ROAS ${margin.breakevenRoas}, target ${margin.targetRoas}` : ''}.`
  return { checks, decision, margin, markup, summary }
}

/**
 * The judgements a person has to make, as they are kept on the product. The
 * numbers come from the catalog; the trend, the weight and whether anyone has
 * found a way to stand out do not, and guessing them would be worse than
 * leaving them unchecked.
 */
export type QualifyNotes = Omit<QualifyInput, 'landedCostCents' | 'sellPriceCents' | 'title'>

export function readQualifyNotes(metadata: Record<string, string>): QualifyNotes {
  const raw = metadata.qualify
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const trend = String(parsed.trend ?? '')
    return {
      ...(TRENDS.includes(trend as Trend) ? { trend: trend as Trend } : {}),
      ...(Number(parsed.weightGrams) > 0 ? { weightGrams: Math.round(Number(parsed.weightGrams)) } : {}),
      ...(Number(parsed.aovCents) > 0 ? { aovCents: Math.round(Number(parsed.aovCents)) } : {}),
      ...(parsed.seasonal ? { seasonal: true } : {}),
      ...(parsed.tech ? { tech: true } : {}),
      ...(parsed.patented ? { patented: true } : {}),
      ...(parsed.bigBrand ? { bigBrand: true } : {}),
      ...(parsed.printOnDemand ? { printOnDemand: true } : {}),
      ...(String(parsed.standOut ?? '').trim() ? { standOut: String(parsed.standOut).trim() } : {}),
    }
  } catch {
    return {}
  }
}

export function writeQualifyNotes(notes: QualifyNotes): string {
  return JSON.stringify(notes)
}

export const TRENDS: Trend[] = ['up', 'flat', 'declining', 'spike', 'unknown']

/** The same checklist against a product already in the catalog, from its supplier row and its cheapest variant. */
export function qualifyCatalogProduct(product: Product, extra: Omit<QualifyInput, 'landedCostCents' | 'sellPriceCents' | 'title'> = {}): Qualification {
  const price = Math.min(...product.variants.map((variant) => variant.priceCents).concat(product.variants.length ? [] : [0]))
  const supplier = product.supplier ?? {}
  return qualifyProduct({
    title: product.title,
    landedCostCents: (supplier.costCents ?? 0) + (supplier.shippingCents ?? 0),
    sellPriceCents: price,
    ...extra,
  })
}
