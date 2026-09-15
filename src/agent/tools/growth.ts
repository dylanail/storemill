import { getProduct, listProducts } from '../../domain/catalog.ts'
import { createArticle, createBlog, listBlogs } from '../../domain/content.ts'
import { listCustomers } from '../../domain/customers.ts'
import { listOrders } from '../../domain/orders.ts'
import { listReviews, moderate, replyTo, statsFor } from '../../domain/reviews.ts'
import { getStore } from '../../control/stores.ts'
import { findPlugin } from '../../control/catalog-plugins.ts'
import { install, invalidateStorefrontConfig, listInstalled, setSlot, uninstall } from '../../control/plugins.ts'
import type { SlotName } from '../../control/plugin-types.ts'
import { refreshTodos } from '../../control/todos.ts'
import { format } from '../../lib/money.ts'
import { BENCHMARK, funnel, kpis, recentEvents, topProducts, type Range } from '../../analytics/events.ts'
import { listSends, sendEmail } from '../../email/send.ts'
import { TEMPLATES, type TemplateKey } from '../../email/templates.ts'
import { readBrief } from '../copy.ts'
import { authorCampaign } from '../brand.ts'
import { modelFor } from '../models.ts'
import { latestResearch } from '../research.ts'
import { publicStoreUrl } from '../../lib/urls.ts'
import { defineTools, type Tool } from '../registry.ts'

const TEMPLATE_KEYS = TEMPLATES.map((template) => template.key)

export const growthTools: Tool[] = defineTools([
  {
    name: 'list_reviews',
    area: 'reviews',
    description: 'List reviews, filtered by product or moderation status.',
    schema: {
      productId: { type: 'string' },
      status: { type: 'string', enum: ['all', 'pending', 'approved', 'rejected'], default: 'all' },
      limit: { type: 'number', integer: true, min: 1, max: 100, default: 20 },
    },
    handler(args, ctx) {
      const reviews = listReviews(ctx.db, ctx.storeId, {
        ...(args.productId ? { productId: args.productId as string } : {}),
        status: args.status as string,
        limit: args.limit as number,
      })
      return {
        summary: `${reviews.length} review${reviews.length === 1 ? '' : 's'}${args.status !== 'all' ? ` (${args.status})` : ''}.`,
        artifacts: [
          {
            type: 'table',
            columns: ['Rating', 'Title', 'Author', 'Status', 'Flags'],
            rows: reviews.map((review) => [`${review.rating}/5`, review.title || '—', review.author, review.status, review.flags.join(', ') || '—']),
          },
        ],
      }
    },
  },
  {
    name: 'moderate_review',
    area: 'reviews',
    description: 'Approve or reject a review.',
    schema: { reviewId: { type: 'string', required: true }, status: { type: 'string', enum: ['approved', 'rejected'], required: true } },
    handler(args, ctx) {
      moderate(ctx.db, ctx.storeId, args.reviewId as string, args.status as 'approved')
      return { summary: `Review ${args.status}.` }
    },
  },
  {
    name: 'reply_to_review',
    area: 'reviews',
    description: 'Post a public reply under a review.',
    schema: { reviewId: { type: 'string', required: true }, reply: { type: 'string', required: true, max: 600 } },
    handler(args, ctx) {
      replyTo(ctx.db, ctx.storeId, args.reviewId as string, args.reply as string)
      return { summary: 'Reply posted under the review.' }
    },
  },
  {
    name: 'review_summary',
    area: 'reviews',
    description: 'The rating distribution and the themes customers keep mentioning for one product.',
    schema: { productId: { type: 'string', required: true } },
    handler(args, ctx) {
      const stats = statsFor(ctx.db, ctx.storeId, args.productId as string)
      return {
        summary: stats.count ? `${stats.average}/5 from ${stats.count} reviews.` : 'No approved reviews for that product yet.',
        data: stats,
        artifacts: stats.summary.length ? [{ type: 'note', text: stats.summary.join('\n') }] : [],
      }
    },
  },
  {
    name: 'request_reviews',
    area: 'reviews',
    description: 'Email review requests to customers whose orders were delivered and who have not reviewed yet.',
    risk: 'confirm',
    schema: { limit: { type: 'number', integer: true, min: 1, max: 50, default: 10 }, code: { type: 'string', help: 'Optional discount code to include.' } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const storeUrl = store ? publicStoreUrl(ctx.db, store) : ''
      const orders = listOrders(ctx.db, ctx.storeId, { status: 'completed', limit: args.limit as number })
      let sent = 0
      for (const order of orders) {
        const product = order.items[0]
        if (!product) continue
        // The link has to be the product's public address: it used to be
        // https://<internal slug>/products/<internal id>, which resolves to
        // nothing, in an email sent to a real customer.
        const productHandle = getProduct(ctx.db, ctx.storeId, product.productId)?.handle ?? ''
        await sendEmail(ctx.db, ctx.storeId, {
          template: 'review_request',
          to: order.email,
          context: {
            product: { title: product.title },
            code: (args.code as string) ?? '',
            discount: '10%',
            reviewUrl: `${storeUrl}/products/${productHandle}#review`,
          },
        })
        sent++
      }
      return { summary: sent ? `Asked ${sent} customer${sent === 1 ? '' : 's'} for a review.` : 'No delivered orders to ask about yet.' }
    },
  },
  {
    name: 'send_email',
    area: 'emails',
    description: 'Send one transactional email from a template to an address.',
    risk: 'confirm',
    schema: {
      template: { type: 'string', enum: TEMPLATE_KEYS as unknown as string[], required: true },
      to: { type: 'string', required: true },
      context: { type: 'object' },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const result = await sendEmail(ctx.db, ctx.storeId, {
        template: args.template as TemplateKey,
        to: args.to as string,
        context: { storeUrl: store ? publicStoreUrl(ctx.db, store) : '', ...((args.context as Record<string, unknown>) ?? {}) },
      })
      return { summary: `"${result.subject}" ${result.status} to ${args.to}.`, data: result }
    },
  },
  {
    name: 'list_email_sends',
    area: 'emails',
    description: 'The send log: what went out, to whom, and whether it landed.',
    schema: { limit: { type: 'number', integer: true, min: 1, max: 100, default: 20 } },
    handler(args, ctx) {
      const rows = listSends(ctx.db, ctx.storeId, args.limit as number) as Array<{ template: string; recipient: string; subject: string; status: string; attempts: number }>
      return {
        summary: `${rows.length} send${rows.length === 1 ? '' : 's'} in the log.`,
        artifacts: [{ type: 'table', columns: ['Template', 'To', 'Subject', 'Status', 'Tries'], rows: rows.map((row) => [row.template, row.recipient, row.subject, row.status, String(row.attempts)]) }],
      }
    },
  },
  {
    name: 'draft_campaign',
    area: 'emails',
    description: 'Draft a marketing email from a brief, with three subject lines to choose between.',
    schema: { brief: { type: 'string', required: true }, productId: { type: 'string' } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const products = listProducts(ctx.db, ctx.storeId, { status: 'published', limit: 3 })
      const featured = args.productId ? products.find((product) => product.id === args.productId) ?? products[0] : products[0]
      const brief = readBrief(`${store?.prompt ?? ''} ${args.brief as string}`)
      const subjects = [
        `${featured?.title ?? store?.name}: ${brief.material} out of ${brief.place}`,
        `Made this week in ${brief.place}`,
        `${store?.name}: the ${brief.category} we would keep`,
      ]
      const body = [
        `${store?.brand.slogan ?? ''}`.trim(),
        '',
        args.brief as string,
        '',
        featured ? `${featured.title} — ${featured.subtitle || featured.description.split('. ')[0]}. From ${format(Math.min(...featured.variants.map((variant) => variant.priceCents)), store?.currency ?? 'USD')}.` : '',
        '',
        `Everything is built to order in ${brief.place} and repaired in-house for as long as we are here.`,
      ]
        .filter((line) => line !== undefined)
        .join('\n')
      const written = await authorCampaign(modelFor(ctx.db, ctx.storeId, 'ads'), {
        store: { name: store?.name ?? 'the store', voice: store?.brand.voice ?? '', slogan: store?.brand.slogan ?? '' },
        brief: args.brief as string,
        product: featured ? { title: featured.title, subtitle: featured.subtitle || featured.description.split('. ')[0] || '', price: format(Math.min(...featured.variants.map((variant) => variant.priceCents)), store?.currency ?? 'USD') } : null,
        research: latestResearch(ctx.db, ctx.storeId),
        fallback: { subjects, body },
      })
      return {
        summary: `Drafted a campaign with three subject lines${written.source === 'rules' ? ' (rules writer; set a model key for real copy)' : ''}. Nothing has been sent.`,
        data: { subjects: written.subjects, body: written.body },
        artifacts: [{ type: 'table', columns: ['#', 'Subject line'], rows: written.subjects.map((subject, index) => [String(index + 1), subject]) }, { type: 'note', text: written.body }],
      }
    },
  },
  {
    name: 'create_blog',
    area: 'content',
    description: 'Create a blog on the storefront.',
    schema: { title: { type: 'string', required: true } },
    handler(args, ctx) {
      const blog = createBlog(ctx.db, ctx.storeId, args.title as string)
      return { summary: `Created the ${blog.title} blog at /blogs/${blog.handle}.`, data: { id: blog.id, handle: blog.handle } }
    },
  },
  {
    name: 'create_article',
    area: 'content',
    description: 'Write an article into a blog.',
    schema: {
      blogId: { type: 'string', help: 'Defaults to the first blog, creating one if there is none.' },
      title: { type: 'string', required: true },
      body: { type: 'string', required: true, multiline: true },
      excerpt: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'published'], default: 'published' },
      publishAt: { type: 'string', help: 'Optional ISO date/time. A future time schedules the article.' },
    },
    handler(args, ctx) {
      const blogs = listBlogs(ctx.db, ctx.storeId)
      const blog = (args.blogId ? blogs.find((entry) => entry.id === args.blogId) : blogs[0]) ?? createBlog(ctx.db, ctx.storeId, 'Journal')
      const article = createArticle(ctx.db, ctx.storeId, blog.id, {
        title: args.title as string,
        body: args.body as string,
        ...(args.excerpt ? { excerpt: args.excerpt as string } : {}),
        status: args.status as 'draft' | 'published',
        ...(args.publishAt ? { publishAt: args.publishAt as string } : {}),
      })
      return {
        summary: `${article.status === 'published' ? 'Published' : article.status === 'scheduled' ? `Scheduled for ${article.publishedAt}` : 'Drafted'} "${article.title}" in ${blog.title}.`,
        artifacts: [{ type: 'link', href: `${publicStoreUrl(ctx.db, { slug: getStore(ctx.db, ctx.storeId)?.slug ?? '', id: ctx.storeId })}/blogs/${blog.handle}/${article.handle}`, label: article.title }],
      }
    },
  },
  {
    name: 'list_blogs',
    area: 'content',
    description: 'List blogs and how many articles each holds.',
    schema: {},
    handler(_args, ctx) {
      const blogs = listBlogs(ctx.db, ctx.storeId)
      return {
        summary: `${blogs.length} blog${blogs.length === 1 ? '' : 's'}.`,
        artifacts: [{ type: 'table', columns: ['Blog', 'Handle', 'Articles'], rows: blogs.map((blog) => [blog.title, blog.handle, String(blog.articles.length)]) }],
      }
    },
  },
  {
    name: 'get_kpis',
    area: 'analytics',
    description: 'Sessions, revenue, orders, conversion rate and average order value, each with its change against the previous window.',
    schema: { range: { type: 'string', enum: ['24h', '7d', '30d', '90d'], default: '7d' } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const stats = kpis(ctx.db, ctx.storeId, args.range as Range)
      const currency = store?.currency ?? 'USD'
      const pct = (value: number) => `${value >= 0 ? '+' : ''}${Math.round(value * 100)}%`
      return {
        summary: `${stats.sessions} sessions, ${format(stats.revenueCents, currency)} across ${stats.orders} orders, ${(stats.conversionRate * 100).toFixed(2)}% conversion, ${format(stats.aovCents, currency)} AOV.`,
        data: stats,
        artifacts: [
          {
            type: 'table',
            columns: ['Metric', 'Value', 'vs previous'],
            rows: [
              ['Sessions', String(stats.sessions), pct(stats.deltas.sessions ?? 0)],
              ['Revenue', format(stats.revenueCents, currency), pct(stats.deltas.revenueCents ?? 0)],
              ['Orders', String(stats.orders), pct(stats.deltas.orders ?? 0)],
              ['Conversion', `${(stats.conversionRate * 100).toFixed(2)}%`, pct(stats.deltas.conversionRate ?? 0)],
              ['AOV', format(stats.aovCents, currency), pct(stats.deltas.aovCents ?? 0)],
            ],
          },
        ],
      }
    },
  },
  {
    name: 'get_funnel',
    area: 'analytics',
    description: 'The four-stage funnel with drop-offs, compared against the DTC median.',
    schema: { range: { type: 'string', enum: ['24h', '7d', '30d', '90d'], default: '7d' } },
    handler(args, ctx) {
      const stages = funnel(ctx.db, ctx.storeId, args.range as Range)
      const purchase = stages.at(-1)
      const verdict = purchase
        ? purchase.share >= BENCHMARK.topDecilePurchase
          ? 'top decile'
          : purchase.share >= BENCHMARK.purchase
            ? 'above the median'
            : 'below the median'
        : 'no data'
      return {
        summary: `Purchase rate ${((purchase?.share ?? 0) * 100).toFixed(2)}% — ${verdict} (median ${(BENCHMARK.purchase * 100).toFixed(1)}%).`,
        data: stages,
        artifacts: [
          {
            type: 'table',
            columns: ['Stage', 'Sessions', 'Share', 'Drop-off'],
            rows: stages.map((stage) => [stage.stage, String(stage.count), `${(stage.share * 100).toFixed(1)}%`, `${(stage.dropOff * 100).toFixed(1)}%`]),
          },
        ],
      }
    },
  },
  {
    name: 'top_products',
    area: 'analytics',
    description: 'The most-viewed products.',
    schema: { limit: { type: 'number', integer: true, min: 1, max: 20, default: 5 } },
    handler(args, ctx) {
      const rows = topProducts(ctx.db, ctx.storeId, args.limit as number) as Array<{ product_id: string; views: number }>
      const products = new Map(listProducts(ctx.db, ctx.storeId, { limit: 200 }).map((product) => [product.id, product.title]))
      return {
        summary: rows.length ? `${rows.length} products with traffic.` : 'No product views recorded yet.',
        artifacts: [{ type: 'table', columns: ['Product', 'Views'], rows: rows.map((row) => [products.get(row.product_id) ?? row.product_id, String(row.views)]) }],
      }
    },
  },
  {
    name: 'recent_activity',
    area: 'analytics',
    description: 'The live event ticker: what visitors are doing right now.',
    schema: { limit: { type: 'number', integer: true, min: 1, max: 50, default: 15 } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const rows = recentEvents(ctx.db, ctx.storeId, args.limit as number) as Array<{ type: string; path: string; amount_cents: number; city: string; country: string; created_at: string }>
      return {
        summary: `${rows.length} recent events.`,
        artifacts: [
          {
            type: 'table',
            columns: ['Event', 'Where', 'Amount', 'From', 'When'],
            rows: rows.map((row) => [
              row.type,
              row.path || '—',
              row.amount_cents ? format(row.amount_cents, store?.currency ?? 'USD') : '—',
              [row.city, row.country].filter(Boolean).join(', ') || '—',
              row.created_at.slice(11, 19),
            ]),
          },
        ],
      }
    },
  },
  {
    name: 'install_plugin',
    area: 'plugins',
    description: 'Install a first-party plugin and set it up. Its AI tools become available immediately.',
    schema: { pluginId: { type: 'string', required: true }, settings: { type: 'object' } },
    handler(args, ctx) {
      const installed = install(ctx.db, ctx.storeId, args.pluginId as string, (args.settings as Record<string, unknown>) ?? {})
      invalidateStorefrontConfig(ctx.storeId)
      refreshTodos(ctx.db, ctx.storeId)
      const adds = [
        ...(installed.plugin.manifest.storefront?.components ?? []).map((component) => component.id),
        ...(installed.plugin.manifest.capabilities ?? []).map((capability) => capability.label),
      ]
      return {
        summary: `${installed.plugin.name} installed${adds.length ? `, adding ${adds.join(', ')}` : ''}.`,
        data: { pluginId: installed.pluginId, settings: installed.settings },
      }
    },
  },
  {
    name: 'uninstall_plugin',
    area: 'plugins',
    description: 'Remove a plugin and its stored credentials.',
    risk: 'confirm',
    schema: { pluginId: { type: 'string', required: true } },
    handler(args, ctx) {
      const plugin = findPlugin(args.pluginId as string)
      const removed = uninstall(ctx.db, ctx.storeId, args.pluginId as string)
      invalidateStorefrontConfig(ctx.storeId)
      if (!removed) throw new Error(`${plugin?.name ?? args.pluginId} is not installed`)
      return { summary: `${plugin?.name ?? args.pluginId} removed, along with its credentials.` }
    },
  },
  {
    name: 'list_plugins',
    area: 'plugins',
    description: 'What is installed on this store, and what it contributes.',
    schema: {},
    handler(_args, ctx) {
      const installed = listInstalled(ctx.db, ctx.storeId)
      return {
        summary: `${installed.length} plugin${installed.length === 1 ? '' : 's'} installed.`,
        artifacts: [
          {
            type: 'table',
            columns: ['Plugin', 'Category', 'Enabled', 'Adds'],
            rows: installed.map((entry) => [
              entry.plugin.name,
              entry.plugin.category,
              entry.enabled ? 'yes' : 'no',
              [
                ...(entry.plugin.manifest.storefront?.components ?? []).map((component) => component.id),
                ...(entry.plugin.manifest.capabilities ?? []).map((capability) => capability.label),
              ].join(', ') || '—',
            ]),
          },
        ],
      }
    },
  },
  {
    name: 'place_plugin_component',
    area: 'plugins',
    description: 'Move a plugin component into a different storefront slot.',
    schema: {
      pluginId: { type: 'string', required: true },
      componentId: { type: 'string', required: true },
      slot: { type: 'string', required: true },
    },
    handler(args, ctx) {
      setSlot(ctx.db, ctx.storeId, args.pluginId as string, args.componentId as string, args.slot as SlotName)
      invalidateStorefrontConfig(ctx.storeId)
      return { summary: `${args.componentId} now renders in ${args.slot}.` }
    },
  },
  {
    name: 'list_email_templates',
    area: 'emails',
    description: 'The transactional templates, what fires them, and any delay.',
    schema: {},
    handler() {
      return {
        summary: `${TEMPLATES.length} transactional templates.`,
        artifacts: [
          {
            type: 'table',
            columns: ['Template', 'Trigger', 'Delay', 'Subject'],
            rows: TEMPLATES.map((template) => [template.name, template.trigger, template.delayHours ? `${template.delayHours}h` : 'immediate', template.subject]),
          },
        ],
      }
    },
  },
  {
    name: 'customer_lookup',
    area: 'customers',
    description: 'Find one customer and their order history.',
    schema: { query: { type: 'string', required: true } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const matches = listCustomers(ctx.db, ctx.storeId, { search: args.query as string, limit: 5 })
      const first = matches[0]
      if (!first) return { summary: `No customer matches "${args.query}".` }
      const orders = listOrders(ctx.db, ctx.storeId, { email: first.email, limit: 20 })
      return {
        summary: `${first.name || first.email}: ${orders.length} orders, ${format(first.spendCents, store?.currency ?? 'USD')} lifetime.`,
        data: { customer: first, orders: orders.map((order) => ({ displayId: order.displayId, total: order.totalCents, status: order.status })) },
      }
    },
  },
])
