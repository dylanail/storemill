import { platformContext } from './context.ts'
import { listProducts } from '../domain/catalog.ts'
import { listPromotions } from '../domain/promotions.ts'
import { getStore } from '../control/stores.ts'
import type { Db } from '../lib/db.ts'
import { logger } from '../lib/log.ts'
import { getTool, toolDefinitions } from './registry.ts'
import { complete, modelFor, planWithTools, type ModelChoice, type Turn } from './models.ts'
import type { PlannedStep } from './runtime.ts'

const log = logger('planner')

export type PlanContext = { db: Db; storeId: string; page?: string; history?: Turn[] }

export type Plan = {
  steps: PlannedStep[]
  /** What the assistant says before it starts working. */
  preamble: string
  source: 'model' | 'rules'
  model?: string
}

/* ------------------------------------------------------------------ the model */

/**
 * The model plans. It is given the store's current state, the recent
 * conversation and the real tool schemas; its tool calls become the run's
 * steps and its words become the reply. The model never executes anything
 * itself — the registry's executor still validates every argument.
 */
async function modelPlan(prompt: string, context: PlanContext, choice: ModelChoice): Promise<Plan | { error: string }> {
  try {
    const reply = await planWithTools(choice, {
      system: systemPrompt(context),
      history: context.history ?? [],
      prompt,
      tools: toolDefinitions(),
    })
    const steps: PlannedStep[] = reply.calls.map((call) => {
      const tool = getTool(call.name)
      return { tool: call.name, args: call.args, ...(tool ? { area: tool.area } : {}) }
    })
    return { steps, preamble: reply.text, source: 'model', model: choice.model }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    log.warn(`${choice.model} could not plan: ${message}`)
    return { error: message }
  }
}

function systemPrompt(context: PlanContext): string {
  const store = getStore(context.db, context.storeId)
  const products = listProducts(context.db, context.storeId, { limit: 20 })
  const promotions = listPromotions(context.db, context.storeId)
  return [
    `You run the admin of "${store?.name ?? 'a store'}", a dropshipping store on storemill, for its owner. You act by calling tools; you do not describe what the owner should click.`,
    platformContext(context.db,context.storeId,context.page),
    store?.brand.voice ? `Store voice: ${store.brand.voice}` : '',
    context.page ? `The current area is ${context.page.split('|')[0]}; use its asset/page IDs from the captured context.` : '',
    `Currency is ${store?.currency ?? 'USD'} and every amount you pass is in minor units (cents).`,
    products.length ? `Products: ${products.map((product) => `${product.title} (${product.id})`).join(', ')}` : 'The catalog is empty.',
    promotions.length ? `Promotions: ${promotions.map((promotion) => `${promotion.title}${promotion.code ? ` [${promotion.code}]` : ''}`).join(', ')}` : '',
    `A question gets an answer in words, from the tools that read the store. An instruction gets the tool calls that carry it out, and one line saying what you are doing. Prefer one call that does the job over three that approximate it. Everything you change lands on the draft; publishing is the owner's separate step.`,
    `If a request is genuinely ambiguous about something destructive (a delete, a refund, an email to customers), say what you would do and ask, instead of guessing.`,
    `How the owner sells: paid social into offer pages, advertorials, quiz funnels and a product page. The order of work is research, then one desire-based core avatar with sub-avatars, then a mechanism or an underserved avatar, then the offer, then the pages, then ads tested one concept a day. When asked what to do next, read that order and the build steps before answering; when asked why something is not selling, look at the offer and the ads before the layout.`,
  ]
    .filter(Boolean)
    .join('\n')
}

/* ------------------------------------------------------------------- the rules */

type Rule = {
  match: RegExp
  build: (groups: string[], input: string, context: PlanContext) => { steps: PlannedStep[]; preamble: string } | null
}

const money = (raw?: string) => (raw ? Math.round(parseFloat(raw.replace(/[^0-9.]/g, '')) * 100) : undefined)
const quoted = (input: string) => /["'“]([^"'”]{2,80})["'”]/.exec(input)?.[1]

/**
 * The rules planner: scaffolding for a deployment with no model key, and the
 * floor under the tests. It maps the things people actually type at an admin
 * onto tools, and says so when it is guessing.
 */
const RULES: Rule[] = [
  {
    match: /\b(add|create|make)\b.*\b(product|item|sku)\b/i,
    build(_groups, input) {
      const title = quoted(input) ?? /(?:called|named)\s+([A-Za-z0-9' -]{2,60})/i.exec(input)?.[1]?.trim() ?? 'New Product'
      const price = money(/(?:for|at|priced?)\s*\$?\s*([0-9]+(?:\.[0-9]{2})?)/i.exec(input)?.[1]) ?? 9900
      const sizes = /\b(with|in)\s+(sizes?|variants?)\b/i.test(input) || /\b(s\/m\/l|small.*large)\b/i.test(input)
      return {
        preamble: `Adding ${title} at ${(price / 100).toFixed(2)}, writing the copy and rendering an image for it.`,
        steps: [
          {
            tool: 'create_product',
            area: 'products',
            args: {
              title,
              priceCents: price,
              status: 'published',
              ...(sizes ? { options: [{ title: 'Size', values: ['S', 'M', 'L', 'XL'] }] } : {}),
            },
          },
        ],
      }
    },
  },
  {
    match: /\bdelete\b.*\b(product|prod_[a-z0-9]+)\b/i,
    build(_groups, input) {
      const productId = /\b(prod_[a-z0-9]+)\b/i.exec(input)?.[1]
      if (!productId) return { preamble: 'Say which product to delete, by id or from the product list.', steps: [{ tool: 'list_products', area: 'products', args: { limit: 20 } }] }
      return { preamble: `Deleting ${productId}.`, steps: [{ tool: 'delete_product', area: 'products', args: { productId } }] }
    },
  },
  {
    match: /\b(discount|promo|promotion|coupon|sale|code)\b|free\s+(shipping|delivery)/i,
    build(_groups, input) {
      const percent = Number(/([0-9]{1,2})\s*%/.exec(input)?.[1] ?? 10)
      const code = /\bcode\s+([A-Z0-9]{3,20})\b/.exec(input)?.[1] ?? /\b([A-Z]{4,12}[0-9]{0,2})\b/.exec(input)?.[1]
      const freeShipping = /free\s+(shipping|delivery)/i.test(input)
      if (freeShipping) {
        const threshold = money(/(?:over|above)\s*\$?\s*([0-9]+)/i.exec(input)?.[1]) ?? 20000
        return {
          preamble: `Setting up free shipping over ${(threshold / 100).toFixed(0)}.`,
          steps: [{ tool: 'create_promotion', area: 'promotions', args: { title: `Free shipping over ${(threshold / 100).toFixed(0)}`, kind: 'free_shipping', minSubtotalCents: threshold } }],
        }
      }
      return {
        preamble: `Creating a ${percent}% discount${code ? ` on code ${code}` : ' that applies automatically'}.`,
        steps: [
          {
            tool: 'create_promotion',
            area: 'promotions',
            args: { title: code ? `${percent}% off with ${code}` : `${percent}% off`, kind: 'percentage', value: percent, ...(code ? { code } : {}) },
          },
        ],
      }
    },
  },
  {
    match: /\b(analytics|how (are|is) (we|the store|sales)|performance|kpis?|conversion|revenue|traffic)\b/i,
    build() {
      return {
        preamble: 'Pulling the numbers and the funnel.',
        steps: [
          { tool: 'get_kpis', area: 'analytics', args: { range: '7d' } },
          { tool: 'get_funnel', area: 'analytics', args: { range: '7d' } },
        ],
      }
    },
  },
  {
    match: /\b(home ?page|hero|storefront|theme|design|look|redesign)\b/i,
    build(_groups, input) {
      const headline = quoted(input)
      const darker = /\b(dark|darker|moody|black)\b/i.test(input)
      const roomier = /\b(roomy|airy|spacious|breathing)\b/i.test(input)
      const scene = /\b(?:with|showing|of)\s+([^.,]{6,80})/i.exec(input)?.[1]?.trim()
      const steps: PlannedStep[] = []
      if (scene || !headline) {
        steps.push({
          tool: 'generate_hero_image',
          area: 'store',
          args: { scene: scene ?? 'the flagship product on a plain ground, single soft light', ...(headline ? { headline } : {}) },
        })
      }
      if (headline || darker || roomier) {
        steps.push({
          tool: 'edit_storefront',
          area: 'store',
          args: { ...(headline ? { heroHeadline: headline } : {}), ...(roomier ? { density: 'roomy' } : {}), ...(darker ? { template: 'gallery' } : {}) },
        })
      }
      return { preamble: 'Editing the draft storefront. Nothing changes for customers until you publish.', steps }
    },
  },
  {
    match: /\b(publish|go live|make it live|ship it)\b/i,
    build() {
      return { preamble: 'Publishing the draft over the live storefront.', steps: [{ tool: 'publish_store', area: 'store', args: {} }] }
    },
  },
  {
    match: /\brefund\b/i,
    build(_groups, input) {
      const order = /#?([0-9]{3,6})\b/.exec(input)?.[1]
      if (!order) return null
      return { preamble: `Refunding order #${order}.`, steps: [{ tool: 'refund_order', area: 'orders', args: { orderId: order, reason: 'Requested from the admin' } }] }
    },
  },
  {
    match: /\b(fulfil+|ship)\b.*\b(order)\b|\border\b.*\b(fulfil+|ship)\b/i,
    build(_groups, input) {
      const order = /#?([0-9]{3,6})\b/.exec(input)?.[1]
      if (!order) return null
      return { preamble: `Marking order #${order} fulfilled.`, steps: [{ tool: 'fulfill_order', area: 'orders', args: { orderId: order } }] }
    },
  },
  {
    match: /\borders?\b/i,
    build() {
      return { preamble: 'Here are the most recent orders.', steps: [{ tool: 'list_orders', area: 'orders', args: { limit: 10 } }] }
    },
  },
  {
    match: /\breviews?\b/i,
    build(_groups, input) {
      const pending = /\b(pending|moderat|queue|waiting)\b/i.test(input)
      return {
        preamble: pending ? 'Here is the moderation queue.' : 'Here are the reviews.',
        steps: [{ tool: 'list_reviews', area: 'reviews', args: { status: pending ? 'pending' : 'all', limit: 20 } }],
      }
    },
  },
  {
    match: /\b(domain|dns)\b/i,
    build(_groups, input) {
      const host = /([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/i.exec(input)?.[1]
      if (!host) return { preamble: 'Tell me the domain you own and I will set it up.', steps: [{ tool: 'list_domains', area: 'domains', args: {} }] }
      return { preamble: `Attaching ${host}.`, steps: [{ tool: 'connect_domain', area: 'domains', args: { hostname: host } }] }
    },
  },
  {
    match: /\b(install|connect|add)\b.*\b(stripe|shippo|klaviyo|ga4|analytics|pixel|reviews?|upsells?|exit intent|engraving)\b/i,
    build(_groups, input) {
      const map: Array<[RegExp, string]> = [
        [/stripe/i, 'stripe'],
        [/shippo/i, 'shippo'],
        [/klaviyo/i, 'klaviyo'],
        [/ga4|google analytics/i, 'ga4'],
        [/pixel|meta|facebook/i, 'meta-pixel'],
        [/reviews?/i, 'product-reviews'],
        [/upsells?|cross.?sell/i, 'upsells'],
        [/exit.?intent/i, 'exit-intent'],
        [/engraving/i, 'engraving'],
      ]
      const pluginId = map.find(([pattern]) => pattern.test(input))?.[1]
      if (!pluginId) return null
      return { preamble: `Installing ${pluginId}.`, steps: [{ tool: 'install_plugin', area: 'plugins', args: { pluginId } }] }
    },
  },
  {
    match: /\b(blog|article|journal|post)\b/i,
    build(_groups, input, context) {
      const store = getStore(context.db, context.storeId)
      const title = quoted(input) ?? /\babout\s+([^.?!]{4,70})/i.exec(input)?.[1]?.trim() ?? 'How this is made'
      const body = `${store?.brand.description ?? ''}\n\n${title}. The short version: we build in small runs, we name our materials, and we repair what we sell. The long version is below.`
      return { preamble: `Writing "${title}".`, steps: [{ tool: 'create_article', area: 'content', args: { title, body, status: 'published' } }] }
    },
  },
  {
    match: /\b(collection|organi[sz]e|categor)/i,
    build(_groups, input) {
      const title = quoted(input)
      if (title) return { preamble: `Creating the ${title} collection.`, steps: [{ tool: 'create_collection', area: 'organization', args: { title } }] }
      return { preamble: 'Grouping the catalog into collections.', steps: [{ tool: 'organize_catalog', area: 'organization', args: { axis: 'tag' } }] }
    },
  },
  {
    match: /\b(seo|search|google|schema|structured data)\b/i,
    build() {
      return {
        preamble: 'Checking what a crawler sees.',
        steps: [
          { tool: 'validate_schema', area: 'seo', args: {} },
          { tool: 'seo_report', area: 'seo', args: {} },
        ],
      }
    },
  },
  {
    match: /\b(stock|inventory|out of stock|low)\b/i,
    build() {
      return { preamble: 'Checking stock levels.', steps: [{ tool: 'low_stock_report', area: 'products', args: { threshold: 5 } }] }
    },
  },
  {
    match: /\b(customers?|buyers?)\b/i,
    build() {
      return {
        preamble: 'Here is the customer base.',
        steps: [
          { tool: 'list_customers', area: 'customers', args: { limit: 10 } },
          { tool: 'segment_customers', area: 'customers', args: {} },
        ],
      }
    },
  },
  {
    match: /\b(email|campaign|newsletter)\b/i,
    build(_groups, input) {
      return { preamble: 'Drafting it. Nothing sends until you say so.', steps: [{ tool: 'draft_campaign', area: 'emails', args: { brief: input } }] }
    },
  },
  {
    match: /\b(products?|catalog|catalogue|inventory list)\b/i,
    build() {
      return { preamble: 'Here is the catalog.', steps: [{ tool: 'list_products', area: 'products', args: { limit: 20 } }] }
    },
  },
]

export function rulesPlan(prompt: string, context: PlanContext): Plan {
  for (const rule of RULES) {
    const groups = rule.match.exec(prompt)
    if (!groups) continue
    const built = rule.build([...groups], prompt, context)
    if (built) return { ...built, source: 'rules' }
  }
  return {
    steps: [{ tool: 'get_kpis', area: 'analytics', args: { range: '7d' } }],
    preamble:
      'No model is configured, so I matched that against a short list of patterns and it fit none of them. Here is where the store stands — or tell me plainly what to change (a product, a discount, the homepage, a domain). Set ANTHROPIC_API_KEY or OPENAI_API_KEY and I will understand the rest.',
    source: 'rules',
  }
}

export async function plan(prompt: string, context: PlanContext): Promise<Plan> {
  const choice = modelFor(context.db, context.storeId, 'planner')
  if (!choice) return rulesPlan(prompt, context)
  const planned = await modelPlan(prompt, context, choice)
  if ('error' in planned) {
    // The model was configured and failed; the rules answer, and say so, rather than pretending.
    const fallback = rulesPlan(prompt, context)
    return { ...fallback, preamble: `${choice.model} was unreachable (${planned.error}), so this is the rules planner: ${fallback.preamble}` }
  }
  if (!planned.steps.length && !planned.preamble) return { steps: [], preamble: 'I did not find anything to do with that. Say what should change, or ask a question about the store.', source: 'model', model: choice.model }
  return planned
}

/** The reply the merchant reads once the run finishes. */
/**
 * The second turn.
 *
 * The planner makes one call: its tool calls become the run's steps and its
 * words become the reply, written before any tool has run. So the system
 * prompt's promise — "a question gets an answer in words, from the tools that
 * read the store" — was one a single-turn loop could not keep: asked what to
 * do next, the assistant answered from the store summary in its own system
 * prompt and never saw what `get_kpis` or `build_status` actually returned.
 *
 * This is that missing turn. It goes back to the model with what the tools
 * returned and asks for the answer. Returns null when there is no model, or
 * when the model cannot be reached — the caller falls back to stitching the
 * tools' own summaries together, which is what always happened before.
 */
export async function answer(
  context: PlanContext,
  input: { prompt: string; preamble: string; results: Array<{ tool?: string; summary: string; data?: unknown }>; failures: string[] },
): Promise<string | null> {
  const choice = modelFor(context.db, context.storeId, 'planner')
  if (!choice || !input.results.length) return null
  const findings = input.results.slice(0, 12).map((result) => {
    const data = result.data === undefined ? '' : JSON.stringify(result.data).slice(0, 1500)
    return `- ${result.tool ?? 'tool'}: ${result.summary}${data ? `\n  data: ${data}` : ''}`
  })
  try {
    const text = await complete(choice, {
      task: 'planner',
      system: `${systemPrompt(context)}\n\nYou have already run the tools. Answer the owner in plain words, using what came back. State numbers exactly as the tools gave them and never invent one they did not. If something failed, say so in a sentence. Do not name the tools, do not describe what you are about to do, and do not offer a list of things you could do instead — this is the answer.`,
      prompt: [
        `The owner asked: ${input.prompt}`,
        input.preamble.trim() ? `You said you would: ${input.preamble.trim()}` : '',
        `What the tools returned:\n${findings.join('\n')}`,
        input.failures.length ? `What failed:\n${input.failures.map((failure) => `- ${failure}`).join('\n')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    })
    return text.trim() || null
  } catch (error) {
    log.warn(`${choice.model} could not write the answer: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

export function compose(preamble: string, summaries: string[], failures: string[]): string {
  const parts = [preamble.trim()]
  if (summaries.length) parts.push(summaries.join(' '))
  if (failures.length) parts.push(`I could not finish everything: ${failures.join('; ')}.`)
  return parts.filter(Boolean).join('\n\n')
}
