import { json, now, type Db } from '../lib/db.ts'
import type { BlockInstance } from '../pages/blocks.ts'
import { environment, setTheme } from './stores.ts'

/**
 * The guided build.
 *
 * A store is built one of three ways, and each way has its own order of
 * work. The order is not a wizard that locks the next screen: every step
 * links to where the work happens, and its status is read from what exists
 * (a product with images, research on file, avatars, versions) rather than
 * from a checkbox the owner ticked. Skipping is a decision, so it is kept.
 *
 * The buyer questions are asked up front. "I don't know" is an answer: it
 * is stored as such, research fills the blank, and the fill is marked as
 * assumed until the owner confirms it.
 */
export type BuildMode = 'copy-funnel' | 'copy-funnel-no-angle' | 'own-product'

export type BuildStep = {
  key: string
  label: string
  detail: string
  /** Admin path, without the /admin prefix. */
  href: string
}

export type BuildAnswer = { value: string; unknown: boolean; assumed?: string }

/**
 * The shape of the site. The reference stores the owner pointed at come in
 * two shapes, and the pages a build needs follow from which one it is:
 *
 *   store   a Shopify-style store: home, collections, product pages with a
 *           quantity-tier buy box, cart, checkout, the account pages
 *           (alevia, honex, callixe, beautyfrombees, slidebelts, selenepets,
 *           flovir, babybliss)
 *   funnel  a Funnelish-style funnel: one long sales page or offer page, a
 *           checkout with an order bump, a one-click upsell, a downsell, the
 *           thank-you page; no navigation, one product (pipitea, smoothspine,
 *           rosabella, primals)
 *
 * Either shape can have a front door in front of it: an advertorial (the
 * celinva listicle) or a quiz (rosabella). The front door is where the ad
 * lands; the shape is what it sells into.
 */
export type SiteShape = 'store' | 'funnel'
export type FrontDoor = 'advertorial' | 'quiz'

export type BuildState = {
  mode: BuildMode | ''
  shape: SiteShape | ''
  doors: FrontDoor[]
  /** The decision, kept apart from whether the popup is on: '' means not decided yet. */
  popup: 'yes' | 'no' | ''
  answers: Record<string, BuildAnswer>
  skipped: string[]
  startedAt: string
  /** The owner has actually made the shape and front-door decision, rather than inheriting the mode's default. */
  shapeConfirmed?: boolean
}

export const SHAPES: Array<{ id: SiteShape; name: string; description: string; pages: string }> = [
  {
    id: 'store',
    name: 'Shopify-style store',
    description: 'Home, collections, product pages with a bundle buy box, cart and a one-page checkout. The ad lands on a product page, or on an advertorial or quiz that sends people to one.',
    pages: 'Home · collections · product page · cart · checkout · legal',
  },
  {
    id: 'funnel',
    name: 'Funnel',
    description: 'One product, no navigation. A long sales page or a short offer page, then a checkout with an order bump, a one-click upsell, a downsell and a thank-you page. The ad lands on the sales page, or on an advertorial or quiz in front of it.',
    pages: 'Sales page · checkout with bump · upsell · downsell · thank-you · legal',
  },
]

export const DOORS: Array<{ id: FrontDoor; name: string; description: string }> = [
  { id: 'advertorial', name: 'Advertorial', description: 'An editorial page (a listicle, a story, a problem-agitate-solve) that teaches first and links to the product page or the sales page. Reads as an article; says it is an advertisement.' },
  { id: 'quiz', name: 'Quiz', description: 'Three to six questions, one per screen, each answer a label the buyer uses for themselves; the result names them and shows the offer built for them.' },
]

/**
 * What happens after publish, which is where the order of work used to stop.
 *
 * A published store is not a launched one: it takes money only once Stripe is
 * connected, it answers at its own address only once the domain is verified,
 * and it sells nothing at all until an ad runs and the spend behind it is
 * written down. The course's own order ends with reading the numbers against
 * breakeven and deciding — so the build ends there too, rather than at a green
 * "Published" and a shrug.
 */
export const LAUNCH_STEPS: BuildStep[] = [
  { key: 'payments', label: 'Connect Stripe and put one order through', detail: 'Keys in, webhook set, one real order through the live checkout before a pound of ad spend. A store that cannot take money converts at zero.', href: '/settings/payments' },
  { key: 'domain', label: 'Connect the domain', detail: 'The records for your registrar, verification, and SSL issued. Ads that land on a platform subdomain cost trust and, on some accounts, get rejected.', href: '/domains' },
  { key: 'ads', label: 'Write the ads for the angle', detail: 'The plan names the concepts; the ad writer fills them in inside each platform\'s limits, quoting only approved reviews.', href: '/ads' },
  { key: 'launch', label: 'Run the first test and record the spend', detail: 'Statics first as a marksman test across the sub-avatars, then a sniper video on what got traction. Record the spend each day: every number that follows is against it.', href: '/profit#spend' },
  { key: 'read', label: 'Read it against breakeven and decide', detail: 'Breakeven ROAS is 1 ÷ gross margin, target is that plus one. Revenue per session against the cost per click says whether it is the page, the price or the traffic. Write the loop down: what is failing, what is working, what you will change.', href: '/market#loops' },
]

export const MODES: Array<{ id: BuildMode; name: string; description: string; steps: BuildStep[] }> = [
  {
    id: 'own-product',
    name: 'Bring your own product',
    description: 'You have the product. The platform researches the market, finds the avatar and the mechanism, writes the pages and briefs the photos.',
    steps: [
      { key: 'shape', label: 'Choose the shape and the front door', detail: 'A Shopify-style store or a funnel; an advertorial or a quiz in front of it, or neither; a popup or not. The page plan follows from this.', href: '/build#shape' },
      { key: 'images', label: 'Upload the product images', detail: 'The photos you have, at their best. Everything visual is derived from these.', href: '/products' },
      { key: 'reference', label: 'Make the 360 reference set', detail: 'Front, side, back, top and detail renders from your photo, so every page and ad has the same product.', href: '/products' },
      { key: 'guidance', label: 'Tell it what you know about the buyer', detail: 'Eight questions. "I don\'t know" is fine; research fills the blank and says it did.', href: '/build#answers' },
      { key: 'research', label: 'Run market research', detail: 'Who buys, what stops them, the competitors, the price band, and where the customer language lives.', href: '/research' },
      { key: 'market', label: 'Write the market analysis', detail: 'Awareness, sophistication, the mechanism, the new information, the underserved avatar. If no way to stand out is found, it says so.', href: '/market' },
      { key: 'avatars', label: 'Build the core avatar and sub-avatars', detail: 'One desire-based core avatar; sub-avatars layer experience, emotion and behaviour and each gives an angle.', href: '/market#avatars' },
      { key: 'targeting', label: 'Choose who to target first', detail: 'Turn on the avatars the pages and ads are written to. One core avatar under $100k a month.', href: '/research#avatars' },
      { key: 'copy', label: 'Write the page copy', detail: 'Product page versions and advertorials from the research, the avatar and the mechanism.', href: '/products' },
      { key: 'proof', label: 'Images, testimonials and reviews', detail: 'Photo briefs to shoot, real reviews imported, and any synthetic concepts vetted before they go anywhere.', href: '/creative' },
      { key: 'photos', label: 'Review the product photos against the briefs', detail: 'Hero, the pack per tier, in hand, in use, the four "before" moments, detail, the mechanism diagram, what arrives, size, result, goes-everywhere, the slides, 360; the expert, the origin and the texture when there are any. What is missing is listed.', href: '/creative#photos' },
      { key: 'pages', label: 'Build the pages the shape needs', detail: 'The page plan lists every page the shape and the front door call for, which exist, and a template for each one missing.', href: '/build#pages' },
      { key: 'offer', label: 'Set the offer and the funnel', detail: 'Bundle tiers, the bump, the upsell, the downsell; the checkout reads them.', href: '/bundles' },
      { key: 'ship', label: 'Legal pages, popup, tracking, publish', detail: 'Privacy and terms are generated; the popup is optional; behaviour tracking is on; then publish.', href: '/store' },
      ...LAUNCH_STEPS,
    ],
  },
  {
    id: 'copy-funnel',
    name: 'Copy a funnel',
    description: 'Point at a funnel that works. Its structure is kept, its angle is kept, and every word and every image is replaced with yours.',
    steps: [
      { key: 'rip', label: 'Read the funnel', detail: 'Paste the page URLs. The structure comes back as a block outline; the copy and the images do not.', href: '/pages#rip' },
      { key: 'shape', label: 'Confirm the shape and the front door', detail: 'The funnel you read is a funnel or a store with an advertorial or a quiz in front; keep that shape or change it.', href: '/build#shape' },
      { key: 'images', label: 'Add your product and images', detail: 'The product the funnel will sell, with your photos.', href: '/products' },
      { key: 'copy', label: 'Rewrite every word in the same angle', detail: 'Same order of sections, same reason to buy, new copy that is yours.', href: '/pages' },
      { key: 'proof', label: 'Replace every image', detail: 'Renders from your photos, photo briefs for the shots you do not have yet.', href: '/creative' },
      { key: 'pages', label: 'Build the rest of the pages', detail: 'The page plan lists what the shape still needs beyond the pages you read: the front door, the checkout offers, the popup.', href: '/build#pages' },
      { key: 'offer', label: 'Set the offer and the funnel', detail: 'Bundle tiers, the bump, the upsell, the downsell.', href: '/funnels' },
      { key: 'ship', label: 'Legal pages, popup, tracking, publish', detail: 'Generated legal pages, the optional popup, tracking on, then publish.', href: '/store' },
      ...LAUNCH_STEPS,
    ],
  },
  {
    id: 'copy-funnel-no-angle',
    name: 'Copy a funnel, change the angle',
    description: 'Keep the structure of a funnel that works, but sell to a different person or with a different mechanism.',
    steps: [
      { key: 'rip', label: 'Read the funnel', detail: 'Paste the page URLs. The structure comes back as a block outline.', href: '/pages#rip' },
      { key: 'shape', label: 'Confirm the shape and the front door', detail: 'Keep the shape of the funnel you read, or sell the new angle through a store, an advertorial or a quiz instead.', href: '/build#shape' },
      { key: 'research', label: 'Run market research', detail: 'What the market has already heard, so the new angle is actually new.', href: '/research' },
      { key: 'avatars', label: 'Find the underserved avatar or the new mechanism', detail: 'The market analysis names the reset; the sub-avatars give the angles.', href: '/market' },
      { key: 'angle', label: 'Pick the angle', detail: 'Turn on the avatar the pages are written to and write the angle down.', href: '/research#avatars' },
      { key: 'copy', label: 'Rewrite every word in the new angle', detail: 'Same order of sections, a different reason to buy.', href: '/pages' },
      { key: 'proof', label: 'Replace every image', detail: 'Renders and photo briefs that show the new avatar and the mechanism.', href: '/creative' },
      { key: 'pages', label: 'Build the rest of the pages', detail: 'The page plan lists what the shape still needs beyond the pages you read.', href: '/build#pages' },
      { key: 'offer', label: 'Set the offer and the funnel', detail: 'Bundle tiers, the bump, the upsell, the downsell.', href: '/funnels' },
      { key: 'ship', label: 'Legal pages, popup, tracking, publish', detail: 'Generated legal pages, the optional popup, tracking on, then publish.', href: '/store' },
      ...LAUNCH_STEPS,
    ],
  },
]

/** The buyer questions, in the order they are asked. Every one accepts "I don't know". */
export const QUESTIONS: Array<{ key: string; label: string; help: string }> = [
  { key: 'who', label: 'Who buys this, in one sentence they would agree with?', help: '"People whose back hurts from sitting all day", not "adults 25–54".' },
  { key: 'instinct', label: 'Which instinct is it really about?', help: 'Health, status, sex, comfort, control or belonging. Pick the strongest one the product can truthfully serve.' },
  { key: 'tried', label: 'What did they try before this, and why did it fail?', help: 'The product experience with its outcome: "tried nose strips, still tired".' },
  { key: 'outcome', label: 'What do they say when it works?', help: 'The result in their words, not in yours.' },
  { key: 'fear', label: 'What are they afraid of getting wrong?', help: 'Wrong size, wasted money, looking foolish, it not working for them.' },
  { key: 'where', label: 'Where do they find out about things like this?', help: 'A subreddit, a creator, a store, a friend, a doctor.' },
  { key: 'cost', label: 'What does it cost them to not solve this, per month?', help: 'Money, time, pain. A number if you have one.' },
  { key: 'competitors', label: 'Who else is selling to them, and what do those pages say?', help: 'Paste URLs; the competitor reader will pull the angles.' },
]

export function modeById(id: string): (typeof MODES)[number] | null {
  return MODES.find((mode) => mode.id === id) ?? null
}

export function buildState(db: Db, storeId: string): BuildState {
  const row = db.one<{ build: string }>('SELECT build FROM stores WHERE id = ?', storeId)
  const stored = json<Partial<BuildState>>(row?.build, {})
  return { mode: stored.mode ?? '', shape: stored.shape ?? '', doors: stored.doors ?? [], popup: stored.popup ?? '', answers: stored.answers ?? {}, skipped: stored.skipped ?? [], startedAt: stored.startedAt ?? '', shapeConfirmed: stored.shapeConfirmed ?? false }
}

function save(db: Db, storeId: string, state: BuildState) {
  db.run('UPDATE stores SET build = ? WHERE id = ?', JSON.stringify(state), storeId)
}

export function setBuildMode(db: Db, storeId: string, mode: BuildMode): BuildState {
  if (!modeById(mode)) throw new Error('No such build mode')
  const state = buildState(db, storeId)
  // Copying a funnel implies a funnel until the owner says otherwise; a
  // product of one's own is more often a store. Either can be changed — and
  // the plan needs a shape to list anything, so the default stands. What it
  // does not do is answer the question for them: `shapeConfirmed` is set only
  // when the owner presses save on the shape card, so step one stays open
  // until the front-door and popup decisions in it have actually been made.
  const shape: SiteShape | '' = state.shape || (mode === 'own-product' ? 'store' : 'funnel')
  const next = { ...state, mode, shape, startedAt: state.startedAt || now() }
  save(db, storeId, next)
  return next
}

export function shapeById(id: string): (typeof SHAPES)[number] | null {
  return SHAPES.find((shape) => shape.id === id) ?? null
}

/** The shape, the front doors and the popup decision. Anything left undefined is kept as it was. */
export function setSiteShape(db: Db, storeId: string, input: { shape?: string; doors?: string[]; popup?: string }): BuildState {
  const state = buildState(db, storeId)
  const next = { ...state }
  if (input.shape !== undefined) {
    if (!shapeById(input.shape)) throw new Error('No such shape: store or funnel')
    next.shape = input.shape as SiteShape
  }
  if (input.doors !== undefined) {
    const known = new Set(DOORS.map((door) => door.id))
    next.doors = [...new Set(input.doors.filter((door): door is FrontDoor => known.has(door as FrontDoor)))]
  }
  next.shapeConfirmed = true
  if (input.popup !== undefined) {
    next.popup = input.popup === 'yes' ? 'yes' : input.popup === 'no' ? 'no' : ''
    // The decision has to reach the thing it decides. It used to live only in
    // the build state and control whether a Popup row appeared in the plan,
    // while the storefront read theme.popup.enabled and kept showing one.
    if (next.popup === 'no') {
      const theme = environment(db, storeId, 'draft').theme
      if (theme.popup?.enabled) setTheme(db, storeId, { popup: { ...theme.popup, enabled: false } })
    }
  }
  next.startedAt = next.startedAt || now()
  save(db, storeId, next)
  return next
}

/** Answers are kept verbatim; an unknown keeps whatever was assumed for it later. */
export function saveAnswers(db: Db, storeId: string, input: Record<string, { value?: string; unknown?: boolean }>): BuildState {
  const state = buildState(db, storeId)
  const answers = { ...state.answers }
  for (const question of QUESTIONS) {
    const given = input[question.key]
    if (!given) continue
    const value = (given.value ?? '').trim()
    // Typing an answer is knowing it. The card leaves "I don't know" ticked on
    // an assumed answer and tells the owner to type it in to confirm — and the
    // tick used to win, so what they typed was thrown away.
    const unknown = !value
    const previous = answers[question.key]
    answers[question.key] = { value: unknown ? '' : value, unknown, ...(unknown && previous?.assumed ? { assumed: previous.assumed } : {}) }
  }
  const next = { ...state, answers }
  save(db, storeId, next)
  return next
}

/** Research fills the blanks the owner left; the fill stays labelled as assumed. */
export function assumeAnswers(db: Db, storeId: string, assumed: Record<string, string>): BuildState {
  const state = buildState(db, storeId)
  const answers = { ...state.answers }
  for (const question of QUESTIONS) {
    const fill = assumed[question.key]?.trim()
    if (!fill) continue
    const current = answers[question.key]
    if (current && !current.unknown && current.value) continue
    answers[question.key] = { value: '', unknown: true, assumed: fill }
  }
  const next = { ...state, answers }
  save(db, storeId, next)
  return next
}

export function skipStep(db: Db, storeId: string, key: string, skipped = true): BuildState {
  const state = buildState(db, storeId)
  const set = new Set(state.skipped)
  if (skipped) set.add(key)
  else set.delete(key)
  const next = { ...state, skipped: [...set] }
  save(db, storeId, next)
  return next
}

/** The answers as a block of owner input for a prompt, unknowns and assumptions labelled. */
export function answersForPrompt(state: BuildState): string {
  const lines = QUESTIONS.map((question) => {
    const answer = state.answers[question.key]
    if (!answer) return `${question.label} (not asked yet)`
    if (!answer.unknown) return `${question.label} ${answer.value}`
    return `${question.label} The owner does not know.${answer.assumed ? ` Assumed so far: ${answer.assumed}` : ''}`
  })
  return `What the owner said about the buyer:\n${lines.map((line) => `- ${line}`).join('\n')}`
}

export type StepStatus = 'done' | 'next' | 'waiting' | 'skipped'

/**
 * Each step's status comes from the world. The first step that is neither
 * done nor skipped is "next"; everything after it waits.
 */
export function buildProgress(db: Db, storeId: string): { mode: (typeof MODES)[number] | null; state: BuildState; steps: Array<BuildStep & { status: StepStatus; why: string }> } {
  const state = buildState(db, storeId)
  const mode = modeById(state.mode)
  if (!mode) return { mode: null, state, steps: [] }
  const facts = worldFacts(db, storeId, state)
  let nextFound = false
  const steps = mode.steps.map((step) => {
    const check = facts[step.key] ?? { done: false, why: '' }
    let status: StepStatus
    if (state.skipped.includes(step.key)) status = 'skipped'
    else if (check.done) status = 'done'
    else if (!nextFound) { status = 'next'; nextFound = true }
    else status = 'waiting'
    return { ...step, status, why: check.why }
  })
  return { mode, state, steps }
}

function worldFacts(db: Db, storeId: string, state: BuildState): Record<string, { done: boolean; why: string }> {
  const count = (sql: string, ...params: unknown[]) => db.one<{ c: number }>(sql, storeId, ...params)?.c ?? 0
  const products = count("SELECT COUNT(*) c FROM products WHERE store_id = ? AND status != 'archived'")
  const withImages = count("SELECT COUNT(*) c FROM products WHERE store_id = ? AND hero_image != ''")
  const withSheet = count("SELECT COUNT(*) c FROM products WHERE store_id = ? AND json_extract(metadata, '$.imageSheet') IS NOT NULL")
  const research = count('SELECT COUNT(*) c FROM store_research WHERE store_id = ?')
  const analysis = count("SELECT COUNT(*) c FROM market_docs WHERE store_id = ? AND kind = 'analysis'")
  const avatars = count('SELECT COUNT(*) c FROM avatars WHERE store_id = ?')
  const subAvatars = count("SELECT COUNT(*) c FROM avatars WHERE store_id = ? AND parent_id != ''")
  const selected = count('SELECT COUNT(*) c FROM avatars WHERE store_id = ? AND selected = 1')
  const versions = count("SELECT COUNT(*) c FROM pages WHERE store_id = ? AND role IN ('pdp','advertorial')")
  const ripped = count("SELECT COUNT(*) c FROM pages WHERE store_id = ? AND source_url != ''")
  const reviews = count("SELECT COUNT(*) c FROM reviews WHERE store_id = ? AND status = 'approved'")
  const briefs = count("SELECT COUNT(*) c FROM creative_queue WHERE store_id = ? AND kind = 'photo-brief'")
  // Reviewing the photos against the briefs is deciding on each one, not
  // generating the list: queueing the briefs is what creates the work.
  const briefsReviewed = count("SELECT COUNT(*) c FROM creative_queue WHERE store_id = ? AND kind = 'photo-brief' AND status != 'pending'")
  const vetted = count("SELECT COUNT(*) c FROM creative_queue WHERE store_id = ? AND status != 'pending'")
  const bundles = count("SELECT COUNT(*) c FROM bundles WHERE store_id = ? AND status = 'active'")
  const funnels = count('SELECT COUNT(*) c FROM funnels WHERE store_id = ?')
  const live = db.one<{ status: string }>('SELECT status FROM stores WHERE id = ?', storeId)?.status === 'live'
  // After publish. A published store is not a launched one.
  const stripeReady = count("SELECT COUNT(*) c FROM store_plugins WHERE store_id = ? AND plugin_id = 'stripe' AND enabled = 1") > 0
  const paidOrders = count("SELECT COUNT(*) c FROM orders WHERE store_id = ? AND payment_status = 'paid'")
  const verifiedDomains = count("SELECT COUNT(*) c FROM domains WHERE store_id = ? AND status = 'verified'")
  const ads = count('SELECT COUNT(*) c FROM ads WHERE store_id = ?')
  const spendCents = db.one<{ c: number }>('SELECT COALESCE(SUM(amount_cents), 0) c FROM ad_spend WHERE store_id = ?', storeId)?.c ?? 0
  const spendDays = count('SELECT COUNT(DISTINCT day) c FROM ad_spend WHERE store_id = ?')
  const loopsWithOutcome = count("SELECT COUNT(*) c FROM market_docs WHERE store_id = ? AND kind = 'loop' AND trim(COALESCE(json_extract(body, '$.outcome'), '')) != ''")
  // Answers, not keys: saveAnswers writes an entry for all eight questions on
  // every save, so counting keys made one submit of an empty form report
  // "8 of 8 questions answered".
  const answered = Object.values(state.answers).filter((entry) => entry.value.trim() || entry.assumed).length
  const plan = pagePlan(db, storeId, state)
  // Bundle tiers, the checkout's bump and the upsell are the offer step's work
  // and appear in the plan for completeness; the pages step is about pages, and
  // could only be finished by finishing the step after it.
  const OFFER_ROWS = new Set(['bundle', 'checkout', 'upsell'])
  const missing = plan.pages.filter((entry) => entry.status !== 'done' && entry.status !== 'built-in' && !entry.optional && !OFFER_ROWS.has(entry.key))
  return {
    shape: { done: Boolean(state.shape) && Boolean(state.shapeConfirmed), why: state.shape ? `${shapeById(state.shape)?.name ?? state.shape}${state.doors.length ? ` with ${state.doors.join(' and ')} in front` : ', the ad lands on it directly'}${state.popup ? `, popup ${state.popup}` : ''}${state.shapeConfirmed ? '' : ' — a starting point; confirm it and the front door'}` : 'Store or funnel not chosen yet' },
    pages: {
      done: Boolean(state.shape) && missing.length === 0,
      why: !state.shape
        ? 'Needs the shape first'
        : missing.length
          ? `${missing.map((entry) => `${entry.label} (${entry.status === 'draft' ? 'draft' : 'missing'})`).join(', ')}`
          : `Every page the ${state.shape} needs is published`,
    },
    images: { done: withImages > 0, why: withImages ? `${withImages} product${withImages === 1 ? '' : 's'} with an image` : products ? 'Products exist but none has an image yet' : 'No products yet' },
    reference: { done: withSheet > 0, why: withSheet ? 'A reference sheet has been rendered' : 'No renders yet' },
    guidance: { done: answered > 0, why: answered ? `${answered} of ${QUESTIONS.length} questions answered` : 'Nothing answered yet' },
    research: { done: research > 0, why: research ? 'Research on file' : 'No research yet' },
    market: { done: analysis > 0, why: analysis ? 'Market analysis written' : 'No market analysis yet' },
    avatars: { done: avatars > 0 && subAvatars > 0, why: avatars ? `${avatars} avatars, ${subAvatars} of them sub-avatars` : 'No avatars yet' },
    targeting: { done: selected > 0 && avatars > 0, why: selected ? `${selected} avatar${selected === 1 ? '' : 's'} turned on` : 'None turned on' },
    angle: { done: selected > 0 && analysis > 0, why: selected && analysis ? 'An avatar is on and the analysis names the reset' : 'Needs the analysis and an avatar turned on' },
    copy: { done: versions > 0, why: versions ? `${versions} page version${versions === 1 ? '' : 's'}` : 'No versions written yet' },
    proof: { done: reviews > 0 || vetted > 0, why: reviews ? `${reviews} approved reviews` : vetted ? 'Creative has been vetted' : 'No reviews or vetted creative yet' },
    photos: { done: briefs > 0 && briefsReviewed === briefs, why: !briefs ? 'Briefs not generated yet' : briefsReviewed ? `${briefsReviewed} of ${briefs} briefs decided` : `${briefs} briefs queued, none reviewed yet` },
    offer: { done: bundles > 0 || funnels > 0, why: bundles ? 'Bundle tiers set' : funnels ? 'A funnel exists' : 'No bundle or funnel yet' },
    rip: { done: ripped > 0, why: ripped ? `${ripped} page${ripped === 1 ? '' : 's'} read from a funnel` : 'Nothing read yet' },
    ship: { done: live, why: live ? 'Published' : 'Not published yet' },
    payments: { done: stripeReady, why: stripeReady ? (paidOrders ? `Stripe connected, ${paidOrders} paid order${paidOrders === 1 ? '' : 's'} through it` : 'Stripe connected — put one order through before you spend on ads') : 'No payment provider connected; the checkout cannot take money' },
    domain: { done: verifiedDomains > 0, why: verifiedDomains ? `${verifiedDomains} domain${verifiedDomains === 1 ? '' : 's'} verified` : 'Running on the platform address' },
    ads: { done: ads > 0, why: ads ? `${ads} ad${ads === 1 ? '' : 's'} written` : 'No ads written yet' },
    launch: { done: spendCents > 0, why: spendCents > 0 ? `${(spendCents / 100).toFixed(2)} of spend recorded across ${spendDays} day${spendDays === 1 ? '' : 's'}` : 'No spend recorded, so nothing can be measured against it' },
    read: { done: loopsWithOutcome > 0, why: loopsWithOutcome ? `${loopsWithOutcome} loop${loopsWithOutcome === 1 ? '' : 's'} closed with an outcome` : spendCents > 0 ? 'Spend is running and no loop has been written yet' : 'Needs a test to read' },
  }
}

/* --------------------------------------------------------------- the page plan */

export type PlanPage = {
  key: string
  label: string
  detail: string
  /** Rendered by the storefront itself; nothing to build, only to configure. */
  builtIn: boolean
  /** The template under Pages that makes this page, when it is a page. */
  template?: 'advertorial' | 'quiz' | 'offer' | 'sales' | 'landing'
  optional: boolean
  /** 'draft' is written but not published, so the storefront still 404s it. */
  status: 'done' | 'draft' | 'missing' | 'built-in'
  why: string
  /** Where to go: the page's editor when it exists, else where it is made. */
  href: string
}

type PageRow = { id: string; kind: string; role: string; blocks: string; is_home: number; product_id: string; status: string; source_url: string }

function hasBlock(row: PageRow, type: string): boolean {
  return json<BlockInstance[]>(row.blocks, []).some((block) => block.type === type)
}

/**
 * The pages a site needs, from its shape and its front doors, each with a
 * status read from what exists. This is the list the Build tab shows and
 * the "pages" step reads; a missing page links to the template that makes
 * it, an existing one to its editor.
 */
export function pagePlan(db: Db, storeId: string, given?: BuildState): { shape: SiteShape | ''; doors: FrontDoor[]; popup: BuildState['popup']; pages: PlanPage[] } {
  const state = given ?? buildState(db, storeId)
  const pages: PlanPage[] = []
  if (!state.shape) return { shape: '', doors: state.doors, popup: state.popup, pages }
  const rows = db.all<PageRow>('SELECT id, kind, role, blocks, is_home, product_id, status, source_url FROM pages WHERE store_id = ? ORDER BY updated_at DESC', storeId)
  const products = db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND status = 'published'", storeId)?.c ?? 0
  const withPage = db.one<{ c: number }>("SELECT COUNT(*) c FROM products WHERE store_id = ? AND status = 'published' AND hero_image != '' AND description != ''", storeId)?.c ?? 0
  const funnel = db.one<{ id: string; offer_page_id: string; upsell: string; bump: string }>("SELECT id, offer_page_id, upsell, bump FROM funnels WHERE store_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1", storeId)
  const themeRow = db.one<{ theme: string }>("SELECT theme FROM store_environments WHERE store_id = ? AND kind = 'draft'", storeId)
  const popupOn = Boolean(json<{ popup?: { enabled?: boolean } }>(themeRow?.theme, {}).popup?.enabled)
  const bundles = db.one<{ c: number }>("SELECT COUNT(*) c FROM bundles WHERE store_id = ? AND status = 'active'", storeId)?.c ?? 0
  const editor = (row: PageRow | undefined) => (row ? `/pages/${row.id}/edit` : '/pages')

  const advertorial = rows.find((row) => row.kind === 'advertorial' || row.role === 'advertorial')
  const quiz = rows.find((row) => hasBlock(row, 'quiz'))
  // The quiz template is a landing page with a buy box on it, so it used to
  // satisfy this row too and the sales page could never be created from the
  // plan. A ripped page is written with role 'pdp' and was invisible here,
  // which left "Copy a funnel" demanding the page its first two steps had
  // just produced.
  const offer = rows.find(
    (row) =>
      row.id !== quiz?.id &&
      (row.role === 'offer' ||
        (row.source_url && row.kind !== 'advertorial') ||
        (row.kind === 'landing' && row.role !== 'pdp' && (hasBlock(row, 'buy-box') || hasBlock(row, 'bundle-offer') || hasBlock(row, 'offer-box')))),
  )
  // A page the storefront will not serve is not done. Every generator here
  // writes drafts by default, so the plan could report a complete site whose
  // sales page and advertorial both 404.
  const built = (row: PageRow | undefined, made: string): { status: PlanPage['status']; why: string } =>
    !row ? { status: 'missing', why: '' } : row.status === 'published' ? { status: 'done', why: made } : { status: 'draft', why: `${made}, but it is still a draft — publish it or the storefront serves a 404` }
  const home = rows.find((row) => row.is_home === 1)
  const versions = rows.filter((row) => row.role === 'pdp').length

  const door = (which: FrontDoor): PlanPage =>
    which === 'advertorial'
      ? { key: 'advertorial', label: 'Advertorial', detail: 'Publication bar, editorial headline, byline, the lead, numbered reasons or story beats with an image each, the offer after the teaching, FAQ, guarantee, comments, the disclaimer. Links to the sales page — the funnel supplies the link.', builtIn: false, template: 'advertorial', optional: false, ...built(advertorial, 'An advertorial exists'), why: built(advertorial, 'An advertorial exists').why || 'No advertorial yet', href: editor(advertorial) }
      : { key: 'quiz', label: 'Quiz', detail: 'One question per screen, a progress bar, a result that names the buyer and shows the offer for them. Every step is an event.', builtIn: false, template: 'quiz', optional: false, ...built(quiz, 'A page with a quiz exists'), why: built(quiz, 'A page with a quiz exists').why || 'No quiz yet', href: editor(quiz) }

  for (const which of state.doors) pages.push(door(which))

  if (state.shape === 'store') {
    pages.push(
      { key: 'home', label: 'Home', detail: 'Announcement bar, hero with the promise, the featured products, the story, reviews, the newsletter, footer. The theme renders one; a block page marked as home replaces it.', builtIn: true, template: 'landing', optional: true, status: home ? 'done' : 'built-in', why: home ? 'A custom home page is set' : 'Rendered by the theme', href: editor(home) || '/store' },
      { key: 'collection', label: 'Collections', detail: 'The catalog grid; every store has /collections/all.', builtIn: true, optional: true, status: 'built-in', why: 'Rendered by the theme', href: '/products' },
      { key: 'pdp', label: 'Product page', detail: 'Gallery, rating, title, price with compare-at, the quantity tiers with a badge on the best one, add to cart and buy now, the shipping line, benefit icons, guarantee; below: benefits with images, how it works, comparison, FAQ, reviews with photos, the sticky add-to-cart.', builtIn: true, template: 'landing', optional: false, status: withPage > 0 ? 'done' : 'missing', why: withPage ? `${withPage} of ${products} products have an image and copy${versions ? `, ${versions} page version${versions === 1 ? '' : 's'}` : ''}` : products ? 'Products exist without an image or copy yet' : 'No published product yet', href: '/products' },
      { key: 'bundle', label: 'Bundle tiers on the buy box', detail: 'Buy 1, 2, 3 with the per-unit price, the saving in the bigger number, a badge on the tier to pick, free shipping and a gift on the higher tiers.', builtIn: true, optional: false, status: bundles > 0 ? 'done' : 'missing', why: bundles ? 'Bundle tiers set' : 'No bundle yet', href: '/bundles' },
      { key: 'checkout', label: 'Cart and checkout', detail: 'The drawer with the free-shipping bar, then one page: express pay first, one form, shipping options, the order bump, trust and the guarantee.', builtIn: true, optional: true, status: 'built-in', why: funnel ? 'Built in; the active funnel supplies the bump' : 'Built in; a funnel adds an order bump', href: '/funnels' },
    )
  } else {
    pages.push(
      { key: 'sales', label: 'Sales page', detail: 'The saving and the timer above the fold, the trust bar, the problem, the failed alternatives, the mechanism, how it works, proof, the buy box with the tiers, the education for the sceptic, FAQ, reviews, the sticky button. Long form (the sales page) or short (the offer page).', builtIn: false, template: 'sales', optional: false, ...built(offer, 'A sales or offer page exists'), why: built(offer, 'A sales or offer page exists').why || 'No sales page yet', href: editor(offer) },
      { key: 'bundle', label: 'Bundle tiers on the buy box', detail: 'Buy 1, 2, 3 with the per-unit price, the saving in the bigger number, a badge on the tier to pick, free shipping and a gift on the higher tiers.', builtIn: true, optional: false, status: bundles > 0 ? 'done' : 'missing', why: bundles ? 'Bundle tiers set' : 'No bundle yet', href: '/bundles' },
      { key: 'checkout', label: 'Checkout with the order bump', detail: 'One page, no navigation: order summary with the bump ticked off, express pay first, one form, the guarantee beside the button.', builtIn: true, optional: false, status: funnel?.offer_page_id ? 'done' : 'missing', why: funnel?.offer_page_id ? `The funnel has its offer page${json<{ variantId?: string; enabled?: boolean }>(funnel.bump, {}).variantId ? ' and a bump' : ''}` : funnel ? 'A funnel exists but no offer page is set on it' : 'No funnel yet', href: '/funnels' },
      { key: 'upsell', label: 'One-click upsell and downsell', detail: 'After payment, the saved card buys the upsell in one click; the downsell shows only if the upsell is declined.', builtIn: true, optional: true, status: funnel && json<{ variantId?: string }>(funnel.upsell, {}).variantId ? 'done' : 'missing', why: funnel && json<{ variantId?: string }>(funnel.upsell, {}).variantId ? 'Upsell set' : 'No upsell chosen', href: '/funnels' },
      { key: 'thankyou', label: 'Thank-you page', detail: 'The order, the tracking link, the related products.', builtIn: true, optional: true, status: 'built-in', why: 'Built in; the funnel record sets its headline', href: '/funnels' },
    )
  }

  if (state.popup !== 'no') {
    pages.push({ key: 'popup', label: 'Popup', detail: 'One popup: on exit, after a delay or at a scroll depth. It offers one thing (a code for an email, a gift, the quiz) and never covers the buy box on a phone.', builtIn: true, optional: state.popup !== 'yes', status: popupOn ? 'done' : state.popup === 'yes' ? 'missing' : 'built-in', why: popupOn ? 'Popup on' : state.popup === 'yes' ? 'Chosen but not switched on yet' : 'Not decided', href: '/store#popup' })
  }
  pages.push({ key: 'legal', label: 'Privacy, terms, shipping and returns', detail: 'Generated from how the store is configured; linked from every footer.', builtIn: true, optional: true, status: 'built-in', why: 'Generated', href: '/store#legal' })
  return { shape: state.shape, doors: state.doors, popup: state.popup, pages }
}
