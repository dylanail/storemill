import { getStore } from '../../control/stores.ts'
import { getProduct, listProducts, updateProduct } from '../../domain/catalog.ts'
import { answerQuestion, createFromImport, importProductFromUrl, importReviews, listQuestions, marginFor, profitReport, recordAdSpend } from '../../domain/ops.ts'
import { upsertFunnel } from '../../domain/funnels.ts'
import { qualifyCatalogProduct, readQualifyNotes, TRENDS, writeQualifyNotes } from '../../domain/qualify.ts'
import { format } from '../../lib/money.ts'
import { ADVERTORIAL_FORMATS, PDP_FORMATS, readDirection, redirectContent } from '../directions.ts'
import { generateVersions, setVersionWeight, versionStats } from '../../pages/versions.ts'
import { defineTools, type Tool } from '../registry.ts'

export const dropshipTools: Tool[] = defineTools([
  {
    name: 'generate_page_versions',
    area: 'store',
    description: 'Generate product-page versions or advertorials for a product in chosen formats with free-form direction ("premium, for gift buyers, focus on the guarantee"). Each becomes a page; weights put pdp versions in a split test.',
    schema: {
      productId: { type: 'string', required: true },
      kind: { type: 'string', enum: ['pdp', 'advertorial'], default: 'pdp' },
      formats: { type: 'array', of: { type: 'string' }, help: `pdp: ${PDP_FORMATS.map((format) => format.id).join(', ')} · advertorial: ${ADVERTORIAL_FORMATS.map((format) => format.id).join(', ')}` },
      direction: { type: 'string', help: 'Free-form. Tone words, "quoted phrases", "for <audience>", "focus on <angle>".' },
      count: { type: 'number', integer: true, min: 1, max: 6, default: 3 },
      publish: { type: 'boolean', default: false },
      splitTest: { type: 'boolean', default: false, help: 'Put every generated pdp version in the test at equal weight.' },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const pages = await generateVersions(ctx.db, store, { productId: args.productId as string, kind: args.kind as 'pdp', formats: (args.formats as string[]) ?? [], direction: (args.direction as string) ?? '', count: args.count as number, publish: Boolean(args.publish || args.splitTest) })
      if (args.splitTest && args.kind === 'pdp') for (const page of pages) setVersionWeight(ctx.db, ctx.storeId, page.id, 1)
      return {
        summary: `Generated ${pages.length} ${args.kind === 'pdp' ? 'product page versions' : 'advertorials'} (${pages.map((page) => page.format).join(', ')})${args.splitTest ? ', all in the split test' : args.publish ? ', published' : ' as drafts'}.`,
        data: pages.map((page) => ({ id: page.id, handle: page.handle, format: page.format })),
        artifacts: pages.map((page) => ({ type: 'link' as const, href: `/admin/pages/${page.id}/edit`, label: `${page.format}: ${page.title}` })),
      }
    },
  },
  {
    name: 'restyle_product_page',
    area: 'products',
    description: 'Rewrite the built-in product page content in a direction ("blunt", "urgent", "for gift buyers", "focus on durability") without generating a new page.',
    schema: { productId: { type: 'string', required: true }, direction: { type: 'string', required: true } },
    handler(args, ctx) {
      const product = getProduct(ctx.db, ctx.storeId, args.productId as string)
      if (!product) throw new Error('No product with that id')
      const direction = readDirection(args.direction as string)
      updateProduct(ctx.db, ctx.storeId, product.id, { content: redirectContent(product.content, direction) })
      return { summary: `${product.title} page restyled: ${direction.tone} tone${direction.audience ? `, for ${direction.audience}` : ''}${direction.angle ? `, on ${direction.angle}` : ''}.` }
    },
  },
  {
    name: 'version_report',
    area: 'analytics',
    description: 'Views, carts, sales and conversion per product-page version in the split test.',
    schema: { productId: { type: 'string', required: true } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const rows = versionStats(ctx.db, ctx.storeId, args.productId as string)
      // Revenue per session, not conversion: the course is explicit that a page
      // converting worse at a higher order value can be the winner.
      const best = [...rows].filter((row) => row.views >= 20).sort((a, b) => b.revenuePerSessionCents - a.revenuePerSessionCents)[0]
      const currency = store?.currency ?? 'USD'
      return {
        summary: rows.length
          ? `${rows.length} versions. ${best ? `${best.format} leads on ${format(best.revenuePerSessionCents, currency)} per session (${(best.conversion * 100).toFixed(1)}% of ${best.views} views).` : 'Not enough views to call yet.'}`
          : 'No versions for that product.',
        artifacts: [{ type: 'table', columns: ['Version', 'Weight', 'Views', 'Carts', 'Sales', 'Revenue', 'CVR', 'Rev / session'], rows: rows.map((row) => [row.format, String(row.weight), String(row.views), String(row.carts), String(row.purchases), format(row.revenueCents, currency), `${(row.conversion * 100).toFixed(1)}%`, format(row.revenuePerSessionCents, currency)]) }],
      }
    },
  },
  {
    name: 'import_product_from_url',
    area: 'products',
    description: 'Import a product from any Shopify store product URL (their /products/x.json) or a supplier page with Open Graph tags. Keeps the supplier link; optionally treats their price as your cost with a markup on the landed cost (their price plus their shipping).',
    risk: 'confirm',
    schema: {
      url: { type: 'string', required: true, pattern: '^https?://' },
      markup: { type: 'number', min: 1, max: 10, default: 3, help: 'On the landed cost. The method asks for at least 3x, 5x ideal.' },
      supplierShippingCents: { type: 'number', integer: true, min: 0, default: 0, help: "What the supplier charges to ship one unit. It is part of the cost the markup is taken on, not something the margin absorbs." },
      asSupplier: { type: 'boolean', default: true },
      publish: { type: 'boolean', default: false },
    },
    async handler(args, ctx) {
      const imported = await importProductFromUrl(args.url as string)
      const product = createFromImport(ctx.db, ctx.storeId, imported, { markup: args.markup as number, supplierShippingCents: (args.supplierShippingCents as number) ?? 0, asSupplier: Boolean(args.asSupplier), status: args.publish ? 'published' : 'draft' })
      const store = getStore(ctx.db, ctx.storeId)
      const margin = marginFor(Math.min(...product.variants.map((variant) => variant.priceCents)), product.supplier)
      return {
        summary: `Imported "${product.title}" with ${product.variants.length} variants and ${product.media.length} images as a ${product.status}${args.asSupplier ? `; landed cost ${format(margin.costCents + margin.shippingCents, store?.currency ?? 'USD')}, selling at ${format(margin.priceCents, store?.currency ?? 'USD')} (${margin.marginPercent}% margin before ads, breakeven ROAS ${margin.breakevenRoas ?? '—'})` : ''}.`,
        data: { id: product.id, handle: product.handle },
        artifacts: [{ type: 'product', id: product.id, title: product.title, image: product.heroImage, href: `/admin/products/${product.id}` }],
      }
    },
  },
  {
    name: 'qualify_product',
    area: 'products',
    description: "Run the product-research checklist against a product: order value over $60, at least 3x the landed cost (supplier price plus their shipping), unit price over $15, a flat or rising five-year trend, light enough to ship, nothing patented, big-brand or print-on-demand, and a named way to stand out. Price and landed cost come from the product; the judgements passed in are kept on it, so the next run remembers them. Answer nothing you have not actually checked — an unchecked trend is a warning, a guessed one is a lie.",
    schema: {
      productId: { type: 'string', required: true },
      trend: { type: 'string', enum: TRENDS as unknown as string[], help: 'Google Trends, US, five years, on the niche keyword.' },
      weightGrams: { type: 'number', integer: true, min: 0 },
      aovCents: { type: 'number', integer: true, min: 0, help: 'Order value after bundles and add-ons, if it is higher than the unit price.' },
      seasonal: { type: 'boolean' },
      tech: { type: 'boolean', help: 'Electronics or anything with a battery.' },
      patented: { type: 'boolean' },
      bigBrand: { type: 'boolean' },
      printOnDemand: { type: 'boolean' },
      standOut: { type: 'string', help: 'The underserved avatar or the mechanism this will run on. None found is a reason not to run it.' },
    },
    handler(args, ctx) {
      const product = getProduct(ctx.db, ctx.storeId, args.productId as string)
      if (!product) throw new Error('No product with that id')
      const { productId: _productId, ...given } = args as Record<string, unknown>
      const notes = { ...readQualifyNotes(product.metadata), ...Object.fromEntries(Object.entries(given).filter(([, value]) => value !== undefined && value !== '')) }
      updateProduct(ctx.db, ctx.storeId, product.id, { metadata: { qualify: writeQualifyNotes(notes) } })
      const result = qualifyCatalogProduct(product, notes)
      return {
        summary: `${product.title}: ${result.decision === 'run' ? 'run it' : result.decision === 'work' ? 'work on it first' : 'skip it'}. ${result.summary}`,
        data: result,
        artifacts: [
          { type: 'table', columns: ['Check', 'Verdict', 'Detail'], rows: result.checks.map((check) => [check.label, check.verdict, check.detail]) },
          { type: 'link', href: `/admin/products/${product.id}#qualify`, label: 'Open the checklist' },
        ],
      }
    },
  },
  {
    name: 'set_supplier',
    area: 'products',
    description: 'Set where a product comes from and what it costs, which drives margins, profit and delivery estimates.',
    schema: { productId: { type: 'string', required: true }, name: { type: 'string' }, url: { type: 'string' }, costCents: { type: 'number', integer: true, min: 0 }, shippingCents: { type: 'number', integer: true, min: 0 }, processingDays: { type: 'number', integer: true, min: 0 }, shippingDaysMin: { type: 'number', integer: true, min: 0 }, shippingDaysMax: { type: 'number', integer: true, min: 0 } },
    handler(args, ctx) {
      const { productId, ...supplier } = args as { productId: string } & Record<string, unknown>
      const product = updateProduct(ctx.db, ctx.storeId, productId, { supplier })
      const store = getStore(ctx.db, ctx.storeId)
      const margin = marginFor(Math.min(...product.variants.map((variant) => variant.priceCents)), product.supplier)
      return { summary: `${product.title}: cost ${format(margin.costCents, store?.currency ?? 'USD')}, profit per unit ${format(margin.profitCents, store?.currency ?? 'USD')} (${margin.marginPercent}%).`, data: product.supplier }
    },
  },
  {
    name: 'record_ad_spend',
    area: 'analytics',
    description: 'Log ad spend for a day so the profit report can subtract it. Clicks are optional but give the report a cost per click to judge revenue per session against.',
    schema: { day: { type: 'string', help: 'YYYY-MM-DD; defaults to today.' }, platform: { type: 'string', default: 'Meta' }, amountCents: { type: 'number', integer: true, min: 0, required: true }, clicks: { type: 'number', integer: true, min: 0 }, note: { type: 'string' } },
    handler(args, ctx) {
      const clicks = (args.clicks as number) ?? 0
      const currency = getStore(ctx.db, ctx.storeId)?.currency ?? 'USD'
      recordAdSpend(ctx.db, ctx.storeId, { day: (args.day as string) || new Date().toISOString(), platform: args.platform as string, amountCents: args.amountCents as number, clicks, note: (args.note as string) ?? '' })
      return { summary: `Logged ${format(args.amountCents as number, currency)} of ${args.platform} spend${clicks ? ` over ${clicks} clicks — ${format(Math.round((args.amountCents as number) / clicks), currency)} a click` : ''}.` }
    },
  },
  {
    name: 'profit_report',
    area: 'analytics',
    description: 'Net profit over a window: revenue less refunds, supplier cost, supplier shipping, fees and logged ad spend.',
    schema: { days: { type: 'number', integer: true, min: 1, max: 365, default: 30 } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const currency = store?.currency ?? 'USD'
      const report = profitReport(ctx.db, ctx.storeId, args.days as number)
      return {
        summary: `${args.days} days: ${format(report.revenueCents, currency)} revenue, ${format(report.cogsCents + report.supplierShippingCents, currency)} COGS, ${format(report.adSpendCents, currency)} ads → ${format(report.profitCents, currency)} net${report.roas !== null ? ` (ROAS ${report.roas}×)` : ''}.${report.breakevenRoas !== null ? ` Gross margin ${report.marginPercent}% puts breakeven at ${report.breakevenRoas}× and target at ${report.targetRoas}×${report.verdict ? `: ${{ scale: 'above target, scale up 20%', hold: 'between the lines, hold', cut: 'below breakeven, scale down 20%' }[report.verdict]}` : ''}.` : ''}`,
        data: report,
        artifacts: [{ type: 'table', columns: ['Line', 'Amount'], rows: [['Revenue', format(report.revenueCents, currency)], ['Refunds', `−${format(report.refundsCents, currency)}`], ['COGS', `−${format(report.cogsCents, currency)}`], ['Supplier shipping', `−${format(report.supplierShippingCents, currency)}`], ['Card fees', `−${format(report.feesCents, currency)}`], ['Ad spend', `−${format(report.adSpendCents, currency)}`], ['Net profit', format(report.profitCents, currency)], ['Gross margin', `${report.marginPercent}%`], ['Breakeven ROAS', report.breakevenRoas === null ? '—' : `${report.breakevenRoas}×`], ['Target ROAS', report.targetRoas === null ? '—' : `${report.targetRoas}×`], ['Cost per click', report.cpcCents === null ? '—' : format(report.cpcCents, currency)]] }],
      }
    },
  },
  {
    name: 'answer_question',
    area: 'reviews',
    description: 'Answer a customer question so it shows on the product page.',
    schema: { questionId: { type: 'string', required: true }, answer: { type: 'string', required: true } },
    handler(args, ctx) {
      answerQuestion(ctx.db, ctx.storeId, args.questionId as string, args.answer as string)
      return { summary: 'Answered.' }
    },
  },
  {
    name: 'list_questions',
    area: 'reviews',
    description: 'Customer questions waiting for an answer.',
    schema: {},
    handler(_args, ctx) {
      const questions = listQuestions(ctx.db, ctx.storeId, { status: 'pending' })
      const titles = new Map(listProducts(ctx.db, ctx.storeId, { limit: 300 }).map((product) => [product.id, product.title]))
      return { summary: `${questions.length} waiting.`, artifacts: [{ type: 'table', columns: ['Id', 'Product', 'Question', 'From'], rows: questions.map((entry) => [entry.id, titles.get(entry.productId) ?? '', entry.question, entry.asker || '—']) }] }
    },
  },
  {
    name: 'import_reviews_csv',
    area: 'reviews',
    description: 'Import reviews from CSV text in the Loox / Judge.me / AliExpress export shape.',
    schema: { csv: { type: 'string', required: true, multiline: true }, productId: { type: 'string', help: 'Attach every row to this product instead of matching a column.' } },
    handler(args, ctx) {
      const result = importReviews(ctx.db, ctx.storeId, args.csv as string, { ...(args.productId ? { productId: args.productId as string } : {}) })
      return { summary: `Imported ${result.imported} reviews across ${result.products} products; ${result.skipped} skipped.` }
    },
  },
  {
    name: 'create_funnel',
    area: 'store',
    description: 'Create a funnel for a product: advertorial → offer → checkout with an order bump → upsell → downsell. Pages left empty are generated.',
    schema: {
      productId: { type: 'string', required: true },
      name: { type: 'string' },
      direction: { type: 'string', help: 'Direction for the generated advertorial and offer page.' },
      bumpVariantId: { type: 'string', help: 'Defaults to shipping protection.' },
      upsellVariantId: { type: 'string' },
      upsellDiscount: { type: 'number', min: 0, max: 90, default: 20 },
      downsellVariantId: { type: 'string' },
      downsellDiscount: { type: 'number', min: 0, max: 90, default: 35 },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const product = getProduct(ctx.db, ctx.storeId, args.productId as string)
      if (!store || !product) throw new Error('No product with that id')
      const [advertorial] = await generateVersions(ctx.db, store, { productId: product.id, kind: 'advertorial', formats: ['listicle'], direction: (args.direction as string) ?? '', publish: true })
      const [offer] = await generateVersions(ctx.db, store, { productId: product.id, kind: 'pdp', formats: ['offer'], direction: (args.direction as string) ?? '', publish: true })
      const funnel = upsertFunnel(ctx.db, ctx.storeId, {
        name: (args.name as string) || `${product.title} funnel`,
        productId: product.id,
        advertorialPageId: advertorial?.id ?? '',
        offerPageId: offer?.id ?? '',
        bump: { ...(args.bumpVariantId ? { variantId: args.bumpVariantId as string } : {}), enabled: true },
        upsell: { ...(args.upsellVariantId ? { variantId: args.upsellVariantId as string } : {}), discountPercent: args.upsellDiscount as number },
        downsell: { ...(args.downsellVariantId ? { variantId: args.downsellVariantId as string } : {}), discountPercent: args.downsellDiscount as number },
      })
      return {
        summary: `Funnel "${funnel.name}": advertorial /pages/${advertorial?.handle} → offer /pages/${offer?.handle} → checkout with ${args.bumpVariantId ? 'the bump' : 'shipping protection'} → upsell ${args.upsellDiscount}% off → downsell ${args.downsellDiscount}% off.`,
        artifacts: [{ type: 'link', href: '/admin/funnels', label: 'Open funnels' }, ...(advertorial ? [{ type: 'link' as const, href: `/admin/pages/${advertorial.id}/edit`, label: 'Edit the advertorial' }] : [])],
      }
    },
  },
])
