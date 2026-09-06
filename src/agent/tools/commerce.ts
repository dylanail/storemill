import { createCollection, getProduct, listCollections, listProducts, setCollectionProducts } from '../../domain/catalog.ts'
import { listCustomers, segment } from '../../domain/customers.ts'
import { cancelOrder, fulfillOrder, getOrder, listOrders, refundOrder, returnOrder, salesSummary } from '../../domain/orders.ts'
import { createPromotion, listPromotions, setPromotionStatus } from '../../domain/promotions.ts'
import { getStore } from '../../control/stores.ts'
import { format } from '../../lib/money.ts'
import { refundThroughProvider } from '../../payments/stripe.ts'
import { defineTools, type Tool } from '../registry.ts'

export const commerceTools: Tool[] = defineTools([
  {
    name: 'create_collection',
    area: 'organization',
    description: 'Create a collection and optionally put products in it.',
    schema: {
      title: { type: 'string', required: true },
      description: { type: 'string' },
      productIds: { type: 'array', of: { type: 'string' } },
    },
    handler(args, ctx) {
      const collection = createCollection(ctx.db, ctx.storeId, {
        title: args.title as string,
        description: (args.description as string) ?? '',
        productIds: (args.productIds as string[]) ?? [],
      })
      return {
        summary: `Created the ${collection.title} collection with ${collection.productIds.length} product${collection.productIds.length === 1 ? '' : 's'}.`,
        data: { id: collection.id, handle: collection.handle },
        artifacts: [{ type: 'link', href: '/admin/collections', label: collection.title }],
      }
    },
  },
  {
    name: 'manage_collection_products',
    area: 'organization',
    description: 'Add products to, remove them from, or replace the contents of a collection.',
    schema: {
      collectionId: { type: 'string', required: true },
      productIds: { type: 'array', of: { type: 'string' }, required: true },
      mode: { type: 'string', enum: ['set', 'add', 'remove'], default: 'add' },
    },
    handler(args, ctx) {
      const collection = setCollectionProducts(
        ctx.db,
        ctx.storeId,
        args.collectionId as string,
        args.productIds as string[],
        args.mode as 'set' | 'add' | 'remove',
      )
      return { summary: `${collection.title} now holds ${collection.productIds.length} products.`, data: collection.productIds }
    },
  },
  {
    name: 'list_collections',
    area: 'organization',
    description: 'List the collections in the store and how many products each holds.',
    schema: {},
    handler(_args, ctx) {
      const collections = listCollections(ctx.db, ctx.storeId)
      return {
        summary: `${collections.length} collection${collections.length === 1 ? '' : 's'}.`,
        artifacts: [{ type: 'table', columns: ['Collection', 'Handle', 'Products'], rows: collections.map((entry) => [entry.title, entry.handle, String(entry.productIds.length)]) }],
      }
    },
  },
  {
    name: 'organize_catalog',
    area: 'organization',
    description: 'Group every published product into collections by a chosen axis and create the collections that are missing.',
    schema: { axis: { type: 'string', enum: ['tag', 'price', 'availability'], default: 'tag' } },
    handler(args, ctx) {
      const products = listProducts(ctx.db, ctx.storeId, { status: 'published', limit: 200 })
      const buckets = new Map<string, string[]>()
      for (const product of products) {
        const keys =
          args.axis === 'price'
            ? [bucketPrice(Math.min(...product.variants.map((variant) => variant.priceCents)))]
            : args.axis === 'availability'
              ? [product.variants.some((variant) => variant.inventory > 0) ? 'In stock' : 'Made to order']
              : product.tags.length
                ? product.tags.slice(0, 2)
                : ['Everything else']
        for (const key of keys) buckets.set(key, [...(buckets.get(key) ?? []), product.id])
      }
      const existing = new Map(listCollections(ctx.db, ctx.storeId).map((entry) => [entry.title.toLowerCase(), entry]))
      const touched: string[] = []
      for (const [title, productIds] of buckets) {
        const label = title.charAt(0).toUpperCase() + title.slice(1)
        const collection = existing.get(label.toLowerCase()) ?? createCollection(ctx.db, ctx.storeId, { title: label })
        setCollectionProducts(ctx.db, ctx.storeId, collection.id, productIds, 'set')
        touched.push(`${label} (${productIds.length})`)
      }
      return { summary: `Organised ${products.length} products into ${touched.length} collections by ${args.axis}: ${touched.join(', ')}.` }
    },
  },
  {
    name: 'create_promotion',
    area: 'promotions',
    description: 'Create a discount: a code, an automatic percentage, free shipping over a threshold, BOGO, a bundle or a quantity tier.',
    schema: {
      title: { type: 'string', required: true },
      kind: { type: 'string', enum: ['percentage', 'fixed', 'free_shipping', 'bogo', 'bundle', 'tiered'], required: true },
      value: { type: 'number', min: 0, default: 0, help: 'Percent for percentage/bundle, minor units for fixed.' },
      code: { type: 'string', help: 'Leave empty for an automatic discount.' },
      minSubtotalCents: { type: 'number', integer: true, min: 0 },
      buyQuantity: { type: 'number', integer: true, min: 1 },
      getQuantity: { type: 'number', integer: true, min: 1 },
      productIds: { type: 'array', of: { type: 'string' } },
      firstOrderOnly: { type: 'boolean' },
      // 'tiered' was in the enum with no way to say what the tiers are, so the
      // engine read an empty list, discounted nothing, and the promotion sat
      // in the table marked active for ever.
      tiers: { type: 'array', of: { type: 'string' }, help: 'For kind "tiered": one "quantity|percent" per entry, e.g. "2|10", "3|20".' },
      endsAt: { type: 'string', help: 'ISO date the promotion stops.' },
    },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const rules: Record<string, unknown> = {}
      for (const key of ['minSubtotalCents', 'buyQuantity', 'getQuantity', 'productIds', 'firstOrderOnly']) {
        if (args[key] !== undefined) rules[key] = args[key]
      }
      const tiers = ((args.tiers as string[] | undefined) ?? [])
        .map((entry) => {
          const [quantity = '', percent = ''] = String(entry).split('|')
          return { quantity: Math.max(1, Math.round(Number(quantity) || 0)), percent: Math.max(0, Math.min(100, Number(percent) || 0)) }
        })
        .filter((tier) => tier.quantity > 0 && tier.percent > 0)
      if (tiers.length) rules.tiers = tiers
      if (args.kind === 'tiered' && !tiers.length) throw new Error('A tiered promotion needs its tiers: pass tiers as "quantity|percent" entries, e.g. ["2|10","3|20"].')
      const promotion = createPromotion(ctx.db, ctx.storeId, {
        title: args.title as string,
        kind: args.kind as 'percentage',
        value: args.value as number,
        ...(args.code ? { code: args.code as string } : {}),
        rules,
        ...(args.endsAt ? { endsAt: args.endsAt as string } : {}),
      })
      const how =
        promotion.kind === 'free_shipping'
          ? `free shipping over ${format((rules.minSubtotalCents as number) ?? 0, store?.currency ?? 'USD')}`
          : promotion.kind === 'fixed'
            ? `${format(promotion.value, store?.currency ?? 'USD')} off`
            : `${promotion.value}% off`
      return {
        summary: `${promotion.title}: ${how}${promotion.code ? ` with code ${promotion.code}` : ', applied automatically'}.`,
        data: { id: promotion.id, code: promotion.code },
      }
    },
  },
  {
    name: 'list_promotions',
    area: 'promotions',
    description: 'List every promotion with its status and how often it has been used.',
    schema: {},
    handler(_args, ctx) {
      const promotions = listPromotions(ctx.db, ctx.storeId)
      return {
        summary: `${promotions.length} promotion${promotions.length === 1 ? '' : 's'}.`,
        artifacts: [
          {
            type: 'table',
            columns: ['Promotion', 'Code', 'Type', 'Value', 'Status', 'Used'],
            rows: promotions.map((promotion) => [
              promotion.title,
              promotion.code || 'automatic',
              promotion.kind,
              String(promotion.value),
              promotion.status,
              String(promotion.usageCount),
            ]),
          },
        ],
      }
    },
  },
  {
    name: 'disable_promotion',
    area: 'promotions',
    description: 'Turn a promotion off without deleting it.',
    schema: { promotionId: { type: 'string', required: true } },
    handler(args, ctx) {
      setPromotionStatus(ctx.db, ctx.storeId, args.promotionId as string, 'disabled')
      return { summary: 'Promotion disabled. Nothing new can use it; past orders are untouched.' }
    },
  },
  {
    name: 'list_orders',
    area: 'orders',
    description: 'List orders, newest first.',
    schema: { status: { type: 'string', enum: ['all', 'pending', 'completed', 'cancelled'], default: 'all' }, limit: { type: 'number', integer: true, min: 1, max: 100, default: 20 } },
    handler(args, ctx) {
      const orders = listOrders(ctx.db, ctx.storeId, { status: args.status as string, limit: args.limit as number })
      return {
        summary: `${orders.length} order${orders.length === 1 ? '' : 's'}.`,
        artifacts: [
          {
            type: 'table',
            columns: ['Order', 'Customer', 'Total', 'Payment', 'Fulfilment', 'Placed'],
            rows: orders.map((order) => [
              `#${order.displayId}`,
              order.email,
              format(order.totalCents, order.currency),
              order.paymentStatus,
              order.fulfillmentStatus,
              order.createdAt.slice(0, 10),
            ]),
          },
        ],
      }
    },
  },
  {
    name: 'get_order',
    area: 'orders',
    description: 'Get one order in full, by id or by its display number.',
    schema: { orderId: { type: 'string', required: true } },
    handler(args, ctx) {
      const order = getOrder(ctx.db, ctx.storeId, args.orderId as string)
      if (!order) throw new Error('No order with that id or number')
      return {
        summary: `Order #${order.displayId} — ${format(order.totalCents, order.currency)}, ${order.paymentStatus}, ${order.fulfillmentStatus}.`,
        data: order,
      }
    },
  },
  {
    name: 'refund_order',
    area: 'orders',
    description: 'Refund an order in full or in part. This moves money.',
    risk: 'confirm',
    schema: {
      orderId: { type: 'string', required: true },
      amountCents: { type: 'number', integer: true, min: 1, help: 'Leave empty to refund the remaining balance.' },
      reason: { type: 'string' },
    },
    async handler(args, ctx) {
      const existing = getOrder(ctx.db, ctx.storeId, args.orderId as string)
      if (!existing) throw new Error('No order with that id or number')
      // "This moves money" was only true from the admin's own button: this
      // tool used to write the refund row and say so without ever calling the
      // provider, leaving the customer's card untouched.
      const moved = await refundThroughProvider(ctx.db, ctx.storeId, existing, args.amountCents as number | undefined)
      if (!moved.ok) throw new Error(moved.message)
      const order = refundOrder(ctx.db, ctx.storeId, existing.id, {
        ...(args.amountCents ? { amountCents: args.amountCents as number } : {}),
        ...(args.reason ? { reason: args.reason as string } : {}),
      })
      const refunded = order.refunds.reduce((sum, refund) => sum + refund.amountCents, 0)
      return {
        summary: `Refunded ${format(refunded, order.currency)} on order #${order.displayId}${existing.paymentProvider === 'stripe' ? ' through Stripe' : ''}.`,
        data: { paymentStatus: order.paymentStatus },
      }
    },
  },
  {
    name: 'fulfill_order',
    area: 'orders',
    description: 'Mark an order fulfilled and attach a tracking number.',
    schema: { orderId: { type: 'string', required: true }, provider: { type: 'string', default: 'manual' }, tracking: { type: 'string' } },
    handler(args, ctx) {
      const order = fulfillOrder(ctx.db, ctx.storeId, args.orderId as string, {
        provider: args.provider as string,
        ...(args.tracking ? { tracking: args.tracking as string } : {}),
      })
      return { summary: `Order #${order.displayId} is fulfilled${args.tracking ? ` with tracking ${args.tracking}` : ''}.` }
    },
  },
  {
    name: 'cancel_order',
    area: 'orders',
    description: 'Cancel an order and return its stock to inventory.',
    risk: 'confirm',
    schema: { orderId: { type: 'string', required: true } },
    handler(args, ctx) {
      const order = cancelOrder(ctx.db, ctx.storeId, args.orderId as string)
      return { summary: `Cancelled order #${order.displayId} and returned its stock.` }
    },
  },
  {
    name: 'accept_return',
    area: 'orders',
    description: 'Accept a return: restock the items and refund the order.',
    risk: 'confirm',
    schema: { orderId: { type: 'string', required: true }, reason: { type: 'string' } },
    async handler(args, ctx) {
      const existing = getOrder(ctx.db, ctx.storeId, args.orderId as string)
      if (!existing) throw new Error('No order with that id or number')
      if (existing.fulfillmentStatus === 'returned') return { summary: `#${existing.displayId} was already returned; nothing was restocked or refunded twice.` }
      const moved = await refundThroughProvider(ctx.db, ctx.storeId, existing)
      if (!moved.ok) throw new Error(moved.message)
      const order = returnOrder(ctx.db, ctx.storeId, existing.id, (args.reason as string) ?? '')
      return { summary: `Return accepted on #${order.displayId}; stock is back and ${format(order.totalCents, order.currency)} is refunded.` }
    },
  },
  {
    name: 'sales_report',
    area: 'orders',
    description: 'Revenue, order count and average order value over a window.',
    schema: { days: { type: 'number', integer: true, min: 1, max: 365, default: 30 } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const summary = salesSummary(ctx.db, ctx.storeId, args.days as number)
      const currency = store?.currency ?? 'USD'
      return {
        summary: `${format(summary.revenueCents, currency)} across ${summary.orders} orders in ${args.days} days (AOV ${format(summary.aovCents, currency)}).`,
        data: summary,
      }
    },
  },
  {
    name: 'list_customers',
    area: 'customers',
    description: 'List customers, optionally searched by name or email.',
    schema: { search: { type: 'string' }, limit: { type: 'number', integer: true, min: 1, max: 100, default: 20 } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const customers = listCustomers(ctx.db, ctx.storeId, {
        ...(args.search ? { search: args.search as string } : {}),
        limit: args.limit as number,
      })
      return {
        summary: `${customers.length} customer${customers.length === 1 ? '' : 's'}.`,
        artifacts: [
          {
            type: 'table',
            columns: ['Customer', 'Email', 'Orders', 'Spend'],
            rows: customers.map((customer) => [customer.name || '—', customer.email, String(customer.ordersCount), format(customer.spendCents, store?.currency ?? 'USD')]),
          },
        ],
      }
    },
  },
  {
    name: 'segment_customers',
    area: 'customers',
    description: 'Repeat rate and average lifetime value across the customer base.',
    schema: {},
    handler(_args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const stats = segment(ctx.db, ctx.storeId)
      return {
        summary: `${stats.total} customers, ${Math.round(stats.repeatRate * 100)}% of them repeat, average lifetime value ${format(stats.lifetimeValueCents, store?.currency ?? 'USD')}.`,
        data: stats,
      }
    },
  },
  {
    name: 'inspect_product',
    area: 'products',
    description: 'Read one product back in full, including its variants and stock.',
    schema: { productId: { type: 'string', required: true } },
    handler(args, ctx) {
      const product = getProduct(ctx.db, ctx.storeId, args.productId as string)
      if (!product) throw new Error('No product with that id or handle')
      return { summary: `${product.title} — ${product.status}, ${product.variants.length} variants.`, data: product }
    },
  },
])

function bucketPrice(cents: number): string {
  if (cents < 5000) return 'Under 50'
  if (cents < 15000) return '50 to 150'
  if (cents < 40000) return '150 to 400'
  return '400 and up'
}
