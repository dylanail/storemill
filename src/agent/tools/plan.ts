import { getStore } from '../../control/stores.ts'
import { buildProgress, DOORS, MODES, pagePlan, QUESTIONS, saveAnswers, setBuildMode, setSiteShape, SHAPES, type BuildMode } from '../../control/build.ts'
import { getProduct, listProducts } from '../../domain/catalog.ts'
import { latestResearch } from '../research.ts'
import { getAvatar, listAvatars } from '../avatars.ts'
import { latestDoc, planRowRequest, runAdPlan, runAnalysis, runOverview, suggestSubAvatars, updatePlanRow, type AdPlan, type MarketAnalysis } from '../market.ts'
import { draftAds } from '../ads.ts'
import { modelFor } from '../models.ts'
import { ripToPage } from '../../pages/rip.ts'
import { createPage, newBlock } from '../../pages/store.ts'
import { customCatalog } from '../../pages/custom-blocks.ts'
import { PAGE_GOALS, queuePhotoBriefs, queueUgcConcepts, suggestBlocks, listQueue, type PageGoal } from '../../creative/briefs.ts'
import { makeProductGif } from '../../creative/product-gif.ts'
import { auditStore } from '../../storefront/health.ts'
import { defineTools, type Tool } from '../registry.ts'

const MODE_IDS = MODES.map((mode) => mode.id)

export const planTools: Tool[] = defineTools([
  {
    name: 'build_progress',
    area: 'store',
    description: 'Where the guided build is: the mode, each step and whether it is done, and what is next. Use it to answer "what should I do next".',
    schema: {},
    handler(_args, ctx) {
      const progress = buildProgress(ctx.db, ctx.storeId)
      if (!progress.mode) return { summary: `No build mode is set. The modes are: ${MODES.map((mode) => `${mode.name} (${mode.id})`).join('; ')}.`, artifacts: [{ type: 'link', href: '/admin/build', label: 'Pick a build mode' }] }
      const next = progress.steps.find((step) => step.status === 'next')
      const plan = pagePlan(ctx.db, ctx.storeId, progress.state)
      const missing = plan.pages.filter((entry) => entry.status === 'missing')
      return {
        summary: `${progress.mode.name}: ${progress.steps.filter((step) => step.status === 'done').length} of ${progress.steps.length} steps done.${next ? ` Next: ${next.label} — ${next.detail}` : ' Every step is done or skipped.'}${plan.shape ? ` Shape: ${plan.shape}${plan.doors.length ? ` with ${plan.doors.join(' and ')} in front` : ''}; ${missing.length ? `pages still missing: ${missing.map((entry) => entry.label).join(', ')}.` : 'every page the shape needs exists.'}` : ' No shape chosen yet (store or funnel).'}`,
        data: { ...progress, plan },
        artifacts: [
          { type: 'table', columns: ['Step', 'Status', 'Why'], rows: progress.steps.map((step) => [step.label, step.status, step.why]) },
          ...(plan.pages.length ? [{ type: 'table' as const, columns: ['Page', 'Status', 'Why'], rows: plan.pages.map((entry) => [entry.label, entry.status, entry.why]) }] : []),
          ...(next ? [{ type: 'link' as const, href: `/admin${next.href}`, label: `Go to: ${next.label}` }] : []),
        ],
      }
    },
  },
  {
    name: 'set_build_mode',
    area: 'store',
    description: 'Choose how this store is built: copy-funnel, copy-funnel-no-angle or own-product.',
    schema: { mode: { type: 'string', enum: MODE_IDS, required: true } },
    handler(args, ctx) {
      const state = setBuildMode(ctx.db, ctx.storeId, args.mode as BuildMode)
      const mode = MODES.find((entry) => entry.id === state.mode)
      return { summary: `Building as "${mode?.name}". ${mode?.steps.length} steps, starting with: ${mode?.steps[0]?.label}.`, artifacts: [{ type: 'link', href: '/admin/build', label: 'Open the build plan' }] }
    },
  },
  {
    name: 'set_site_shape',
    area: 'store',
    description: 'Choose the shape of the site (a Shopify-style store or a funnel), what stands in front of it (an advertorial, a quiz, both or neither) and whether it gets a popup. The page plan follows from this.',
    schema: {
      shape: { type: 'string', enum: SHAPES.map((shape) => shape.id), help: 'store: home, collections, product pages, cart, checkout. funnel: one sales page into a checkout with a bump, an upsell and a downsell.' },
      doors: { type: 'array', of: { type: 'string', enum: DOORS.map((door) => door.id) }, help: 'Where the ad lands before the product: advertorial, quiz, or leave empty for the ad to land on the product page or sales page itself.' },
      popup: { type: 'string', enum: ['yes', 'no', ''], help: 'yes for one popup (exit, delay or scroll), no for none, empty to decide later.' },
    },
    handler(args, ctx) {
      const state = setSiteShape(ctx.db, ctx.storeId, { ...(args.shape !== undefined ? { shape: args.shape as string } : {}), ...(args.doors !== undefined ? { doors: args.doors as string[] } : {}), ...(args.popup !== undefined ? { popup: args.popup as string } : {}) })
      const plan = pagePlan(ctx.db, ctx.storeId, state)
      return {
        summary: `Shape: ${state.shape || 'undecided'}${state.doors.length ? ` with ${state.doors.join(' and ')} in front` : ''}${state.popup ? `, popup ${state.popup}` : ''}. Pages: ${plan.pages.map((entry) => `${entry.label} (${entry.status})`).join(', ')}.`,
        data: plan,
        artifacts: [{ type: 'link', href: '/admin/build#pages', label: 'Open the page plan' }],
      }
    },
  },
  {
    name: 'answer_buyer_questions',
    area: 'store',
    description: `Record what the owner knows about the buyer. Keys: ${QUESTIONS.map((question) => question.key).join(', ')}. Pass "unknown" as the value for a question the owner does not know.`,
    schema: { answers: { type: 'object', required: true, help: 'A map of question key to answer text, or "unknown".' } },
    handler(args, ctx) {
      const given = (args.answers ?? {}) as Record<string, string>
      const state = saveAnswers(ctx.db, ctx.storeId, Object.fromEntries(Object.entries(given).map(([key, value]) => [key, /^unknown$/i.test(String(value).trim()) ? { unknown: true } : { value: String(value) }])))
      const answered = Object.values(state.answers).filter((answer) => !answer.unknown).length
      return { summary: `Saved. ${answered} answered, ${Object.values(state.answers).length - answered} marked unknown for research to fill.`, artifacts: [{ type: 'link', href: '/admin/build#answers', label: 'See the answers' }] }
    },
  },
  {
    name: 'write_market_analysis',
    area: 'products',
    description: 'Write the market analysis from the research, the competitor pages, the avatars and the owner\'s answers: awareness, sophistication, desires ranked, mechanisms, new information, underserved avatars, and whether there is a way to stand out.',
    schema: { notes: { type: 'string', help: 'Anything the owner adds.' } },
    async handler(args, ctx) {
      const doc = await runAnalysis(ctx.db, ctx.storeId, { ...(args.notes ? { notes: args.notes as string } : {}) })
      const a = doc.body
      return {
        summary: `Market analysis ${doc.source === 'rules' ? 'from rules' : `by ${doc.model}`}: ${a.awareness}-aware market at sophistication stage ${a.sophistication}. Lead desire: ${a.leadDesire || 'not chosen'}. ${a.standOut.found ? `Stand out via ${a.standOut.via}: ${a.standOut.recommendation}` : `No way to stand out found yet: ${a.standOut.recommendation}`}`,
        data: a,
        artifacts: [{ type: 'note', text: a.summary }, { type: 'link', href: '/admin/market', label: 'Open the market tab' }],
      }
    },
  },
  {
    name: 'get_market_analysis',
    area: 'products',
    description: 'Read the latest market analysis on file.',
    schema: {},
    handler(_args, ctx) {
      const doc = latestDoc<MarketAnalysis>(ctx.db, ctx.storeId, 'analysis')
      if (!doc) return { summary: 'No market analysis yet. Run write_market_analysis.' }
      return { summary: `${doc.title} (${doc.updatedAt.slice(0, 10)}): ${doc.body.summary}`, data: doc.body }
    },
  },
  {
    name: 'write_product_overview',
    area: 'products',
    description: 'Fill the product overview: what it is, what it does, the benefits, the desires behind them, the mechanisms and the hidden ones. Assumed until confirmed.',
    schema: { productId: { type: 'string', required: true } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const doc = await runOverview(ctx.db, ctx.storeId, args.productId as string, store?.currency ?? 'USD')
      return { summary: `Product overview for ${doc.body.name}: ${doc.body.features.length} features, ${doc.body.benefits.length} benefits, ${doc.body.mechanisms.length} mechanisms. Everything is assumed until you confirm it.`, data: doc.body, artifacts: [{ type: 'link', href: '/admin/market', label: 'Open the market tab' }] }
    },
  },
  {
    name: 'suggest_sub_avatars',
    area: 'products',
    description: 'Write sub-avatars under a core avatar: the same desire layered with an experience, an emotion or a behaviour, each with its angle and hooks.',
    schema: { avatarId: { type: 'string', help: 'Defaults to the first selected avatar.' } },
    async handler(args, ctx) {
      const core = args.avatarId ? getAvatar(ctx.db, ctx.storeId, args.avatarId as string) : listAvatars(ctx.db, ctx.storeId).find((avatar) => avatar.selected && !avatar.parentId) ?? listAvatars(ctx.db, ctx.storeId)[0]
      if (!core) return { summary: 'No avatar to build under. Suggest avatars from the research first.' }
      const subs = await suggestSubAvatars(ctx.db, ctx.storeId, core.id)
      return { summary: `${subs.length} sub-avatars under ${core.name}: ${subs.map((sub) => sub.name).join('; ')}.`, artifacts: [{ type: 'table', columns: ['Sub-avatar', 'Angle', 'First hook'], rows: subs.map((sub) => [sub.name, sub.angle, sub.hooks[0] ?? '']) }, { type: 'link', href: '/admin/market#avatars', label: 'See them' }] }
    },
  },
  {
    name: 'write_ad_plan',
    area: 'ads',
    description: 'Write or extend the ad plan: concept → angle → variations → format → method, statics first as marksman tests, then a sniper video.',
    schema: {},
    async handler(_args, ctx) {
      const doc = await runAdPlan(ctx.db, ctx.storeId)
      return { summary: `Ad plan: ${doc.body.rows.length} rows. ${doc.body.note}`, artifacts: [{ type: 'table', columns: ['Concept', 'Angle', 'Method', 'Format'], rows: doc.body.rows.map((row) => [row.concept, row.angle, row.method, row.format]) }, { type: 'link', href: '/admin/market#plan', label: 'Open the plan' }] }
    },
  },
  {
    name: 'draft_ads_from_plan',
    area: 'ads',
    description: 'Take a row of the ad plan and write it as ads: its angle, its variations and its format go to the ad writer as they are, and the row moves to "working". Rows are numbered from 0 in the order write_ad_plan returned them.',
    schema: {
      row: { type: 'number', integer: true, min: 0, required: true, help: 'Which plan row, from 0.' },
      productId: { type: 'string', help: 'Defaults to the first published product.' },
      platform: { type: 'string', enum: ['meta', 'tiktok', 'google', 'youtube'], default: 'meta' },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const doc = latestDoc<AdPlan>(ctx.db, ctx.storeId, 'ad-plan')
      const index = args.row as number
      const row = doc?.body.rows[index]
      if (!row) throw new Error(doc ? `The plan has ${doc.body.rows.length} rows; there is no row ${index}.` : 'No ad plan yet — write_ad_plan first.')
      const productId = (args.productId as string) || listProducts(ctx.db, ctx.storeId, { status: 'published', limit: 1 })[0]?.id
      if (!productId) throw new Error('Publish a product first; an ad has to point at something.')
      const request = planRowRequest(row, listAvatars(ctx.db, ctx.storeId))
      const ads = await draftAds(ctx.db, store, { productId, platform: args.platform as 'meta', ...request })
      if (row.status === 'idea') updatePlanRow(ctx.db, ctx.storeId, index, { status: 'working' })
      return {
        summary: `${ads.length} ad${ads.length === 1 ? '' : 's'} drafted from "${row.concept}" (${row.method}, ${row.format}). The row is working; its learnings are what finishes it.`,
        artifacts: [{ type: 'table', columns: ['Ad', 'Format', 'Hook'], rows: ads.map((ad) => [ad.name, ad.format, ad.body.hooks[0] ?? '']) }, { type: 'link', href: '/admin/ads', label: 'Open the ads' }],
      }
    },
  },
  {
    name: 'rip_funnel',
    area: 'store',
    description: 'Read a competitor page for its structure and build the same order of sections for our product, with new copy and no images copied. keepAngle keeps its reason to buy in our words; false uses our direction instead.',
    schema: { url: { type: 'string', required: true }, productId: { type: 'string', required: true }, keepAngle: { type: 'boolean', default: true }, direction: { type: 'string' } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const result = await ripToPage(ctx.db, store, { url: args.url as string, productId: args.productId as string, keepAngle: args.keepAngle !== false, ...(args.direction ? { direction: args.direction as string } : {}) })
      return { summary: `Built "${result.page.title}" as a draft from ${result.rip.sections.length} sections (${result.source === 'model' ? 'copy written by the model' : 'placeholders; set a model key for the copy'}); ${result.rip.imageBriefs.length} image briefs to shoot.`, artifacts: [{ type: 'link', href: `/admin/pages/${result.page.id}/edit`, label: 'Open the page' }, { type: 'note', text: result.rip.imageBriefs.slice(0, 6).join('\n') }] }
    },
  },
  {
    name: 'suggest_page_layout',
    area: 'store',
    description: 'Choose the blocks and their order for a kind of page (offer, advertorial, quiz, pdp, home, science, checkout) and create it as a draft. A checkout page, once published, becomes the store\'s /checkout.',
    schema: { goal: { type: 'string', enum: PAGE_GOALS, required: true }, productId: { type: 'string' }, direction: { type: 'string' }, title: { type: 'string' } },
    async handler(args, ctx) {
      const product = args.productId ? getProduct(ctx.db, ctx.storeId, args.productId as string) : null
      const avatar = listAvatars(ctx.db, ctx.storeId).find((entry) => entry.selected) ?? null
      const suggestion = await suggestBlocks(modelFor(ctx.db, ctx.storeId, 'pages'), { goal: args.goal as PageGoal, product, research: latestResearch(ctx.db, ctx.storeId), avatar, ...(args.direction ? { direction: args.direction as string } : {}), custom: customCatalog(ctx.db, ctx.storeId) })
      const page = createPage(ctx.db, ctx.storeId, { title: (args.title as string) || `${product ? `${product.title} — ` : ''}${args.goal} page (suggested)`, kind: args.goal === 'advertorial' ? 'advertorial' : args.goal === 'checkout' ? 'checkout' : args.goal === 'pdp' ? 'product' : 'landing', role: args.goal === 'checkout' ? 'checkout' : 'page', blocks: suggestion.blocks.map((block) => newBlock(block.type, block.settings ?? {})), ...(product && args.goal !== 'checkout' ? { productId: product.id } : {}) })
      return { summary: `Created "${page.title}" with ${suggestion.blocks.length} blocks (${suggestion.source}). ${suggestion.note}`, artifacts: [{ type: 'table', columns: ['Block', 'Job'], rows: suggestion.blocks.map((block) => [block.type, block.why]) }, { type: 'link', href: `/admin/pages/${page.id}/edit`, label: 'Open it' }] }
    },
  },
  {
    name: 'queue_photo_briefs',
    area: 'products',
    description: 'Check a product against the photo briefs (the shots every reference page uses: hero, the pack per tier, in hand, in use, the "before" moments, detail, the mechanism diagram, what arrives, size, result, goes-everywhere, the slides, 360) and queue the missing shots for the owner to take.',
    schema: { productId: { type: 'string', required: true } },
    handler(args, ctx) {
      const product = getProduct(ctx.db, ctx.storeId, args.productId as string)
      if (!product) throw new Error('No product with that id')
      const briefs = queuePhotoBriefs(ctx.db, ctx.storeId, product)
      return { summary: `${briefs.length} photo briefs queued for ${product.title}: ${briefs.map((brief) => brief.body.name).join(', ')}.`, artifacts: [{ type: 'link', href: '/admin/creative#photos', label: 'See the briefs' }] }
    },
  },
  {
    name: 'write_ugc_concepts',
    area: 'ads',
    description: 'Write three creator-content concepts for a real person to film, to an avatar. They go to the vetting queue and never become reviews.',
    schema: { productId: { type: 'string', required: true }, avatarId: { type: 'string' } },
    async handler(args, ctx) {
      const product = getProduct(ctx.db, ctx.storeId, args.productId as string)
      if (!product) throw new Error('No product with that id')
      const avatar = args.avatarId ? getAvatar(ctx.db, ctx.storeId, args.avatarId as string) : listAvatars(ctx.db, ctx.storeId).find((entry) => entry.selected) ?? null
      const items = await queueUgcConcepts(ctx.db, ctx.storeId, product, avatar, latestResearch(ctx.db, ctx.storeId), modelFor(ctx.db, ctx.storeId, 'ads'))
      return { summary: `${items.length} concepts queued for vetting: ${items.map((item) => item.body.title).join('; ')}.`, artifacts: [{ type: 'link', href: '/admin/creative#queue', label: 'Vet them' }] }
    },
  },
  {
    name: 'make_product_gif',
    area: 'products',
    description: 'Make a looping GIF from a product\'s renders and PNG images; it waits in the creative queue for approval.',
    schema: { productId: { type: 'string', required: true }, delay: { type: 'number', default: 70, help: 'Hundredths of a second per frame.' } },
    handler(args, ctx) {
      const item = makeProductGif(ctx.db, ctx.storeId, { productId: args.productId as string, delay: Number(args.delay ?? 70) })
      return { summary: `${item.title} made (${item.body.width}×${item.body.height}); approve it on the creative page to add it to the product.`, artifacts: [{ type: 'image', urls: [item.body.url], caption: item.title }, { type: 'link', href: '/admin/creative#queue', label: 'Approve it' }] }
    },
  },
  {
    name: 'creative_queue',
    area: 'products',
    description: 'What is waiting for vetting: photo briefs, creator-content concepts, GIFs.',
    schema: {},
    handler(_args, ctx) {
      const pending = listQueue(ctx.db, ctx.storeId, { status: 'pending' })
      return { summary: pending.length ? `${pending.length} waiting: ${pending.map((item) => `${item.kind} — ${item.title}`).join('; ')}.` : 'Nothing is waiting for vetting.', artifacts: [{ type: 'link', href: '/admin/creative', label: 'Open the creative page' }] }
    },
  },
  {
    name: 'site_health',
    area: 'store',
    description: 'Accessibility and speed report on the rendered pages: landmarks, alt text, labels, headings, contrast, weight, scripts, fonts, lazy loading.',
    schema: {},
    handler(_args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const report = auditStore(ctx.db, store)
      const issues = report.pages.flatMap((page) => page.issues.map((issue) => [page.path, issue.severity, issue.detail]))
      return { summary: `Site score ${report.score}/100 across ${report.pages.length} pages of the ${report.environment === 'live' ? 'live site' : 'unpublished draft'}; ${issues.length} findings.`, data: report, artifacts: [{ type: 'table', columns: ['Page', 'Severity', 'Finding'], rows: issues.slice(0, 20) }, { type: 'link', href: '/admin/store?health=1#health', label: 'Full report' }] }
    },
  },
])
