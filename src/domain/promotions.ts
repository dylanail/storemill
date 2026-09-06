import { bool, json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { percentOf } from '../lib/money.ts'
import type { LineItem, Promotion } from './types.ts'

function rowToPromotion(row: Row): Promotion {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    code: row.code as string,
    title: row.title as string,
    kind: row.kind as Promotion['kind'],
    value: row.value as number,
    rules: json(row.rules, {}),
    automatic: bool(row.automatic),
    status: row.status as Promotion['status'],
    startsAt: (row.starts_at as string | null) ?? null,
    endsAt: (row.ends_at as string | null) ?? null,
    usageCount: row.usage_count as number,
    createdAt: row.created_at as string,
  }
}

export function listPromotions(db: Db, storeId: string): Promotion[] {
  return db.all('SELECT * FROM promotions WHERE store_id = ? ORDER BY created_at DESC', storeId).map(rowToPromotion)
}

export function getPromotionByCode(db: Db, storeId: string, code: string): Promotion | null {
  const row = db.one('SELECT * FROM promotions WHERE store_id = ? AND code = ? COLLATE NOCASE', storeId, code.trim())
  return row ? rowToPromotion(row) : null
}

export function createPromotion(
  db: Db,
  storeId: string,
  input: {
    title: string
    kind: Promotion['kind']
    value?: number
    code?: string
    automatic?: boolean
    rules?: Promotion['rules']
    startsAt?: string | null
    endsAt?: string | null
  },
): Promotion {
  const promotionId = id('promo')
  db.insert('promotions', {
    id: promotionId,
    store_id: storeId,
    code: (input.code ?? '').toUpperCase(),
    title: input.title,
    kind: input.kind,
    value: input.value ?? 0,
    rules: input.rules ?? {},
    automatic: input.automatic ?? !input.code,
    status: input.startsAt && input.startsAt > now() ? 'scheduled' : 'active',
    starts_at: input.startsAt ?? null,
    ends_at: input.endsAt ?? null,
    usage_count: 0,
    created_at: now(),
  })
  return rowToPromotion(db.one('SELECT * FROM promotions WHERE id = ?', promotionId) as Row)
}

export function setPromotionStatus(db: Db, storeId: string, promotionId: string, status: Promotion['status']) {
  db.run('UPDATE promotions SET status = ? WHERE id = ? AND store_id = ?', status, promotionId, storeId)
}

function isLive(promotion: Promotion, at: string): boolean {
  if (promotion.status !== 'active' && promotion.status !== 'scheduled') return false
  if (promotion.startsAt && promotion.startsAt > at) return false
  if (promotion.endsAt && promotion.endsAt < at) return false
  return true
}

function eligibleItems(promotion: Promotion, items: LineItem[], collectionsByProduct: Map<string, string[]>): LineItem[] {
  const { productIds, variantIds, collectionIds } = promotion.rules
  if (!productIds?.length && !variantIds?.length && !collectionIds?.length) return items
  return items.filter((item) => {
    if (variantIds?.includes(item.variantId)) return true
    if (productIds?.includes(item.productId)) return true
    if (collectionIds?.length) {
      const memberships = collectionsByProduct.get(item.productId) ?? []
      return memberships.some((collectionId) => collectionIds.includes(collectionId))
    }
    return false
  })
}

export type PromotionOutcome = {
  discountCents: number
  freeShipping: boolean
  applied: Array<{ id: string; title: string; code: string; amountCents: number; kind: Promotion['kind'] }>
}

/**
 * The whole discount engine, in one pass.
 *
 * Automatic promotions always apply; a code applies on top of them. Order
 * matters: percentage and tier discounts come off the eligible subtotal,
 * BOGO discounts the cheapest qualifying units, and free shipping is a flag
 * the shipping calculation reads rather than a negative line.
 */
export function applyPromotions(
  db: Db,
  storeId: string,
  items: LineItem[],
  opts: { code?: string; subtotalCents: number; isFirstOrder?: boolean; regionId?: string; currencyRate?: number } = { subtotalCents: 0 },
): PromotionOutcome {
  const at = now()
  const all = listPromotions(db, storeId).filter((promotion) => isLive(promotion, at))
  const code = (opts.code ?? '').trim().toUpperCase()
  const candidates = all
    .filter((promotion) => (promotion.automatic && !promotion.code) || (code && promotion.code === code))
    .filter((promotion) => !promotion.rules.maxUses || promotion.usageCount < promotion.rules.maxUses)
    .filter((promotion) => !promotion.rules.regionIds?.length || Boolean(opts.regionId && promotion.rules.regionIds.includes(opts.regionId)))
    .sort((a, b) => (b.rules.priority ?? 0) - (a.rules.priority ?? 0))

  const collectionsByProduct = new Map<string, string[]>()
  if (items.length) {
    const placeholders = items.map(() => '?').join(', ')
    for (const row of db.all<{ product_id: string; collection_id: string }>(
      `SELECT product_id, collection_id FROM collection_products WHERE product_id IN (${placeholders})`,
      ...items.map((item) => item.productId),
    )) {
      const list = collectionsByProduct.get(row.product_id) ?? []
      list.push(row.collection_id)
      collectionsByProduct.set(row.product_id, list)
    }
  }

  const outcome: PromotionOutcome = { discountCents: 0, freeShipping: false, applied: [] }
  for (const promotion of candidates) {
    if (promotion.rules.minSubtotalCents && opts.subtotalCents < Math.round(promotion.rules.minSubtotalCents * (opts.currencyRate ?? 1))) continue
    if (promotion.rules.firstOrderOnly && opts.isFirstOrder === false) continue
    const eligible = eligibleItems(promotion, items, collectionsByProduct).filter((item) => !item.giftOf && item.source !== 'order-bump')
    const scoped = promotion.rules.productIds?.length || promotion.rules.variantIds?.length || promotion.rules.collectionIds?.length
    if (!eligible.length && (promotion.kind !== 'free_shipping' || scoped)) continue
    const eligibleTotal = eligible.reduce((sum, item) => sum + item.unitCents * item.quantity, 0)
    const units = eligible.reduce((sum, item) => sum + item.quantity, 0)
    if (promotion.rules.minQuantity && units < promotion.rules.minQuantity) continue
    let amount = 0

    switch (promotion.kind) {
      case 'percentage':
        amount = percentOf(eligibleTotal, promotion.value)
        break
      case 'fixed':
        amount = Math.min(Math.round(promotion.value * (opts.currencyRate ?? 1)), eligibleTotal)
        break
      case 'free_shipping':
        outcome.freeShipping = true
        break
      case 'bundle':
        // A bundle only pays out once the whole set is in the cart.
        if (units >= (promotion.rules.buyQuantity ?? 2)) amount = percentOf(eligibleTotal, promotion.value)
        break
      case 'tiered': {
        const tiers = [...(promotion.rules.tiers ?? [])].filter(tier => Number.isSafeInteger(tier.quantity) && tier.quantity > 0).sort((a, b) => b.quantity - a.quantity)
        const exactUnits = eligible.filter(item => promotion.rules.productIds?.includes(item.productId)).reduce((sum,item) => sum + item.quantity, 0)
        const hit = tiers.find((tier) => (tier.unitPriceCents === undefined ? units : exactUnits) >= tier.quantity)
        if (hit?.unitPriceCents !== undefined) {
          // Exact copied offers have a verified product scope and positive price.
          // Never turn malformed/unscoped rules into an order-wide discount.
          if (promotion.rules.productIds?.length && Number.isSafeInteger(hit.unitPriceCents) && hit.unitPriceCents > 0) {
            const unit = Math.round(hit.unitPriceCents * (opts.currencyRate ?? 1))
            if (Number.isSafeInteger(unit) && unit > 0) amount = eligible.filter(item => promotion.rules.productIds!.includes(item.productId)).reduce((sum, item) => sum + Math.max(0, item.unitCents - unit) * item.quantity, 0)
          }
        } else if (hit) amount = percentOf(eligibleTotal, hit.percent)
        break
      }
      case 'bogo': {
        const buy = promotion.rules.buyQuantity ?? 1
        const free = promotion.rules.getQuantity ?? 1
        const buying = promotion.rules.buyProductIds?.length
          ? items.filter((item) => promotion.rules.buyProductIds?.includes(item.productId) && !item.giftOf)
          : eligible
        const rewards = promotion.rules.getProductIds?.length
          ? items.filter((item) => promotion.rules.getProductIds?.includes(item.productId) && !item.giftOf)
          : eligible
        const buyUnits = buying.reduce((sum, item) => sum + item.quantity, 0)
        const sets = promotion.rules.getProductIds?.length ? Math.floor(buyUnits / buy) : Math.floor(buyUnits / (buy + free))
        if (sets > 0) {
          const unitPrices = rewards
            .flatMap((item) => Array.from({ length: item.quantity }, () => item.unitCents))
            .sort((a, b) => a - b)
          amount = percentOf(unitPrices.slice(0, sets * free).reduce((sum, price) => sum + price, 0), promotion.value || 100)
        }
        break
      }
      case 'mix_match': {
        const distinct = new Set(eligible.map((item) => item.productId)).size
        if (distinct >= (promotion.rules.requiredDistinctProducts ?? 2)) amount = percentOf(eligibleTotal, promotion.value)
        break
      }
      case 'fixed_bundle': {
        const required = promotion.rules.minQuantity ?? promotion.rules.buyQuantity ?? 2
        const target = Math.round((promotion.rules.bundlePriceCents ?? promotion.value) * (opts.currencyRate ?? 1))
        if (units >= required && target >= 0) amount = Math.max(0, eligibleTotal - target)
        break
      }
    }

    const takeable = Math.max(0, opts.subtotalCents - outcome.discountCents)
    amount = Math.min(amount, takeable)
    if (amount > 0 || (promotion.kind === 'free_shipping' && outcome.freeShipping)) {
      outcome.discountCents += amount
      outcome.applied.push({ id: promotion.id, title: promotion.title, code: promotion.code, amountCents: amount, kind: promotion.kind })
      if (promotion.rules.combinable === false) break
    }
  }

  // Quantity discounts do not stack. A store-wide "buy two, save 15%" and a
  // product's own bundle tiers are two answers to the same question; the
  // customer gets the better one, not both.
  const quantityKinds = new Set(['bundle', 'tiered', 'mix_match', 'fixed_bundle'])
  const quantity = outcome.applied.filter((entry) => quantityKinds.has(entry.kind))
  if (quantity.length > 1) {
    const best = quantity.reduce((top, entry) => (entry.amountCents > top.amountCents ? entry : top))
    const dropped = quantity.filter((entry) => entry.id !== best.id)
    outcome.applied = outcome.applied.filter((entry) => !dropped.includes(entry))
    outcome.discountCents -= dropped.reduce((sum, entry) => sum + entry.amountCents, 0)
  }
  return outcome
}

export function recordPromotionUse(db: Db, promotionIds: string[]) {
  for (const promotionId of promotionIds) {
    db.run('UPDATE promotions SET usage_count = usage_count + 1 WHERE id = ?', promotionId)
  }
}
