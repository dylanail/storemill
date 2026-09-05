import type { Product } from '../domain/types.ts'
import { format } from '../lib/money.ts'

/** Public catalog fields only: never expose supplier costs or private metadata. */
export function pageProductData(product: Product, currency: string, convert: (value: number) => number = value => value) {
  const variant = product.variants.find(v => v.inventory > 0 || v.allowBackorder) ?? product.variants[0]
  return {
    id: product.id,
    title: product.title,
    description: product.description.replace(/<[^>]+>/g, ''),
    image: product.heroImage || product.media[0]?.url || '',
    price: variant ? format(convert(variant.priceCents), currency) : '',
    compareAtPrice: variant?.compareAtCents ? format(convert(variant.compareAtCents), currency) : '',
    variantId: variant?.id ?? '',
  }
}
