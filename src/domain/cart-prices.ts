import type { Db } from '../lib/db.ts'
import type { Cart } from './cart.ts'
import type { Totals } from './types.ts'
import { getVariant } from './catalog.ts'
import { bundleFor } from './bundles.ts'
import { convertCents, getRegion, defaultRegion, minorUnitRate } from './regions.ts'
import { promotionLineDiscounts } from './promotions.ts'

/** Public cart line prices use the same final discounts as checkout. */
export function cartDisplayLines(db: Db, storeId: string, cart: Cart, totals: Totals) {
  const region = cart.regionId ? getRegion(db, storeId, cart.regionId) : defaultRegion(db, storeId)
  const currency = db.one<{currency:string}>('SELECT currency FROM stores WHERE id=?',storeId)!.currency
  const localized = cart.items.map(item => ({ ...item, unitCents: convertCents(item.unitCents, region, currency) }))
  const discounts = promotionLineDiscounts(db, storeId, localized, totals.appliedPromotions, minorUnitRate(region,currency))
  return localized.map((item, index) => {
    const variant = getVariant(db, storeId, item.variantId)
    const bundle = bundleFor(db, storeId, item.productId)
    const tier = bundle?.tiers.find(tier => tier.quantity === item.quantity)
    const compare = tier?.compareAtTotalCents !== undefined ? convertCents(tier.compareAtTotalCents, region, currency) : convertCents(variant?.compareAtCents || variant?.priceCents || item.unitCents, region, currency) * item.quantity
    return { variantId:item.variantId,productId:item.productId,title:item.title,variantTitle:item.variantTitle,image:item.image,quantity:item.quantity,lineCents:item.unitCents * item.quantity - discounts[index]!,originalLineCents:item.unitCents * item.quantity,compareAtLineCents:compare,discountCents:discounts[index]!,gift:!!item.giftOf }
  })
}
