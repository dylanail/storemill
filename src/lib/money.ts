/** Every amount in the platform is an integer of the currency's minor unit. */
export type Cents = number

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK'])
export const minorDigits = (currency: string) => ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2

export function format(cents: Cents, currency = 'USD', locale = 'en-US'): string {
  const minor = minorDigits(currency)
  const value = cents / 10 ** minor
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: minor,
      maximumFractionDigits: minor,
    }).format(value)
  } catch {
    return `${value.toFixed(minor)} ${currency}`
  }
}

export function percentOf(cents: Cents, percent: number): Cents {
  return Math.round((cents * percent) / 100)
}

/** Estimate Stripe-style card processing; personal mode adds no platform fee. */
export function cardFee(cents: Cents, rate: number): Cents {
  return Math.round(cents * rate) + 30
}
