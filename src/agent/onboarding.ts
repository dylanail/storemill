import type { Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import { createStore, getStore, setTheme, type Store } from '../control/stores.ts'
import { seedDefaultRegion } from '../domain/regions.ts'
import { seedTodos, refreshTodos } from '../control/todos.ts'
import { upsertSeoPage } from '../seo/schema.ts'
import { paletteFor, promotionPlan, readBrief, type Brief } from './copy.ts'
import { authorBrandKit, type BrandKit } from './brand.ts'
import { authorResearch, readSite, saveResearch, type AuthoredResearch } from './research.ts'
import { describe, modelFor } from './models.ts'
import { listCollections, listProducts } from '../domain/catalog.ts'
import { createRun, runToCompletion, type PlannedStep, type Run } from './runtime.ts'

const log = logger('onboarding')

/**
 * One sentence to a live store.
 *
 * Research is written first, then the brand kit from it, then the store
 * exists and the run builds it: naming, catalog, brand and merchandising in
 * parallel branches, because they genuinely do not depend on each other. Only
 * the product photography depends on the product existing, which is why it
 * sits *inside* the catalog branch rather than beside it.
 */
export function planOnboarding(kit: BrandKit, brief: Brief, opts: { referenceImage?: string } = {}): PlannedStep[] {
  const palette = paletteFor({ ...brief, mood: kit.mood })
  const steps: PlannedStep[] = []

  steps.push({
    branch: 'brand',
    area: 'store',
    tool: 'set_brand',
    args: {
      name: kit.name,
      slogan: kit.slogan,
      description: kit.description,
      voice: kit.voice,
      primary: palette.primary,
      secondary: palette.secondary,
      paper: palette.paper,
      ink: palette.ink,
      announcement: kit.announcement,
    },
  })
  const hero = kit.products[0]
  steps.push({
    branch: 'brand',
    area: 'store',
    tool: 'generate_hero_image',
    args: {
      scene: `${hero?.title ?? brief.category} on a plain ground, single soft light`,
      headline: kit.name.toUpperCase(),
      sub: kit.slogan,
    },
  })

  kit.products.forEach((product, index) => {
    steps.push({
      branch: `catalog-${index}`,
      area: 'products',
      tool: 'create_product',
      args: {
        title: product.title,
        subtitle: product.subtitle,
        description: product.description,
        priceCents: product.priceCents,
        status: 'published',
        tags: product.tags,
        options: product.options.map((option) => ({ title: option.title, values: option.values.map((value) => value.value) })),
        inventory: 24,
        role: product.role,
        ...(opts.referenceImage ? { reference: opts.referenceImage } : {}),
      },
    })
  })

  for (const promotion of promotionPlan()) {
    steps.push({
      branch: 'merchandising',
      area: 'promotions',
      tool: 'create_promotion',
      args: {
        title: promotion.title,
        kind: promotion.kind,
        value: promotion.value,
        ...(promotion.code ? { code: promotion.code } : {}),
        ...(promotion.rules ?? {}),
      },
    })
  }
  for (const collection of kit.collections) {
    steps.push({ branch: 'merchandising', area: 'organization', tool: 'create_collection', args: { title: collection.title, description: collection.description } })
  }

  return steps
}

function phaseTwo(db: Db, storeId: string): PlannedStep[] {
  const products = listProducts(db, storeId, { status: 'published', limit: 20 })
  const collections = listCollections(db, storeId)
  const steps: PlannedStep[] = []
  const everything = collections.find((collection) => /new arrivals/i.test(collection.title)) ?? collections[0]
  const essentials = collections.find((collection) => /essentials/i.test(collection.title)) ?? collections[1]
  if (everything) {
    steps.push({
      branch: 'merch',
      area: 'organization',
      tool: 'manage_collection_products',
      args: { collectionId: everything.id, productIds: products.map((product) => product.id), mode: 'set' },
    })
  }
  if (essentials && essentials.id !== everything?.id) {
    steps.push({
      branch: 'merch',
      area: 'organization',
      tool: 'manage_collection_products',
      args: { collectionId: essentials.id, productIds: products.slice(0, 2).map((product) => product.id), mode: 'set' },
    })
  }
  steps.push({ branch: 'plugins', area: 'plugins', tool: 'install_plugin', args: { pluginId: 'product-reviews' } })
  steps.push({ branch: 'plugins', area: 'plugins', tool: 'install_plugin', args: { pluginId: 'upsells' } })
  return steps
}

export type OnboardingResult = { store: Store; run: Run; summaries: string[]; failures: string[]; research: AuthoredResearch; kit: BrandKit }

/**
 * Research, then the brand kit, then the store, then the run. The store row
 * exists before any tool fires so the preview URL is real from the first
 * second — the merchant can open it and watch products appear.
 */
/**
 * Onboarding, watched rather than waited on.
 *
 * `onboard` is minutes of work — research, a brand kit, three products with a
 * model call and an image each, then merchandising — and it used to run inside
 * the POST. The merchant stared at a spinning tab, anything with a request
 * timeout in front of the process (Caddy, Railway) returned a gateway error
 * while the store was built anyway, and the flash afterwards reported success
 * whether or not the steps had failed.
 *
 * The build runs detached and reports progress against a ticket. Tickets are
 * in memory: they exist for the minutes a build takes, and if the process
 * restarts mid-build the store row and its runs are still on disk, which is
 * what `recoverRuns` and `resumeQueuedRuns` pick up at boot.
 */
export type BuildTicket = {
  id: string
  ownerId: string
  state: 'working' | 'done' | 'failed'
  stage: string
  storeId: string
  storeName: string
  summaries: string[]
  failures: string[]
  error: string
  startedAt: number
}

const tickets = new Map<string, BuildTicket>()

export function startOnboarding(db: Db, input: { ownerId: string; prompt: string; currency?: string; referenceImage?: string; referenceUrl?: string }): BuildTicket {
  for (const [key, entry] of tickets) if (Date.now() - entry.startedAt > 30 * 60_000) tickets.delete(key)
  const ticket: BuildTicket = {
    id: id('build'),
    ownerId: input.ownerId,
    state: 'working',
    stage: 'Researching who buys this',
    storeId: '',
    storeName: '',
    summaries: [],
    failures: [],
    error: '',
    startedAt: Date.now(),
  }
  tickets.set(ticket.id, ticket)
  void onboard(db, input, (stage, store) => {
    ticket.stage = stage
    if (store) {
      ticket.storeId = store.id
      ticket.storeName = store.name
    }
  })
    .then((result) => {
      ticket.state = 'done'
      ticket.stage = 'Built'
      ticket.storeId = result.store.id
      ticket.storeName = result.store.name
      ticket.summaries = result.summaries
      ticket.failures = result.failures
    })
    .catch((error) => {
      ticket.state = 'failed'
      ticket.error = error instanceof Error ? error.message : String(error)
      log.error(`onboarding failed: ${ticket.error}`)
    })
  return ticket
}

export function buildTicket(id: string, ownerId: string): BuildTicket | null {
  const ticket = tickets.get(id)
  return ticket && ticket.ownerId === ownerId ? ticket : null
}

export async function onboard(
  db: Db,
  input: { ownerId: string; prompt: string; currency?: string; referenceImage?: string; referenceUrl?: string },
  onStage?: (stage: string, store?: { id: string; name: string }) => void,
): Promise<OnboardingResult> {
  const brief = readBrief(input.prompt)
  const currency = (input.currency ?? 'USD').toUpperCase()
  const notes: string[] = []
  let sourceText = ''
  if (input.referenceUrl) {
    const site = await readSite(input.referenceUrl)
    sourceText = site.text
    notes.push(...site.notes)
  }
  if (input.referenceImage) notes.push('The merchant supplied a product photograph; imagery is derived from it.')

  // Research first, and on its own: the brand kit and every product page read it.
  onStage?.('Researching who buys this, what stops them and what they pay')
  const researchModel = modelFor(db, null, 'research')
  const research = await authorResearch(researchModel, brief, { sourceText, notes, currency, hasSite: Boolean(input.referenceUrl && sourceText) })
  onStage?.('Naming the brand and picking its palette, fonts and mark')
  const kit = await authorBrandKit(modelFor(db, null, 'brand'), brief, research.research, { currency })
  log.info(`research by ${describe(researchModel)}, brand kit by ${kit.source === 'model' ? kit.model : 'rules'}: ${kit.name}`)

  const store = createStore(db, input.ownerId, {
    name: kit.name,
    prompt: input.prompt,
    currency,
    ...(input.referenceImage ? { referenceImage: input.referenceImage } : {}),
    ...(input.referenceUrl ? { referenceUrl: input.referenceUrl } : {}),
  })
  saveResearch(db, store.id, research, input.prompt)
  seedDefaultRegion(db, store.id, store.currency)
  seedTodos(db, store.id)
  setTheme(db, store.id, {
    template: kit.mood === 'monochrome' ? 'gallery' : 'atelier',
    nav: [
      { label: 'Shop', href: '/collections/all' },
      { label: 'Journal', href: '/blogs/journal' },
      { label: 'About', href: '/pages/about' },
    ],
  }, { build: `Generated from: "${input.prompt.slice(0, 80)}"` })
  upsertSeoPage(db, store.id, { path: '/', title: kit.name, description: kit.slogan, keyword: research.research.category })

  const actor = { actor: { type: 'agent' as const, id: 'onboarding' }, page: 'onboarding' }
  const steps = planOnboarding(kit, brief, { ...(input.referenceImage ? { referenceImage: input.referenceImage } : {}) })
  onStage?.('Writing three products with full pages, prices and imagery', store)
  const run = createRun(db, { storeId: store.id, kind: 'onboarding', prompt: input.prompt, steps })
  const outcome = await runToCompletion(db, run.id, actor)

  // Phase two reads the world the first phase built. Merchandising cannot be
  // planned up front because it needs the product ids that phase one minted,
  // and inventing a placeholder id to patch later would be a lie in the run log.
  onStage?.('Setting the welcome code, the free-shipping threshold and the bundle', store)
  const merchandising = createRun(db, {
    storeId: store.id,
    kind: 'onboarding',
    prompt: 'Merchandise the new catalog',
    steps: phaseTwo(db, store.id),
  })
  const second = await runToCompletion(db, merchandising.id, actor)
  outcome.results.push(...second.results)
  outcome.failures.push(...second.failures)
  refreshTodos(db, store.id)

  return {
    store: getStore(db, store.id) ?? store,
    run: outcome.run,
    summaries: outcome.results.map((result) => result.summary),
    failures: outcome.failures,
    research,
    kit,
  }
}
