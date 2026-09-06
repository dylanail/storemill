import { getStore, verifyDomain } from '../../control/stores.ts'
import { attachDomain, checkDomain, dnsPlan, domainsFor, REGISTRARS, type DomainMode } from '../../control/domains.ts'
import { getProduct, listProducts, updateProduct } from '../../domain/catalog.ts'
import { AD_FORMATS, draftAds, getAd, limitWarnings, listAds, patternInspiration, PLATFORMS, readInspiration, reviseAd, saveAd, saveInspiration, searchAdLibrary, type AdPlatform } from '../ads.ts'
import { applyCompetitor, directionFrom, listCompetitors, readCompetitor, saveCompetitor } from '../angles.ts'
import { deleteAvatar, listAvatars, saveAvatar, suggestAvatars, type Avatar } from '../avatars.ts'
import { readBrief } from '../copy.ts'
import { generate, imageModels, PRESETS, type ImageProvider, type PresetId } from '../images.ts'
import { modelFor } from '../models.ts'
import { publicStoreUrl } from '../../lib/urls.ts'
import { defineTools, type Tool } from '../registry.ts'

const PRESET_IDS = PRESETS.map((preset) => preset.id) as unknown as string[]
const FORMAT_IDS = AD_FORMATS.map((format) => format.id)
const PLATFORM_IDS = PLATFORMS.map((platform) => platform.id)

function publicUrlFor(storeSlug: string): string {
  return publicStoreUrl(null, { slug: storeSlug })
}

/** The photo a re-shoot should start from: an upload on the product, else the store's. */
function referenceFor(hero: string, media: string[], storeReference?: string): string | undefined {
  return [hero, ...media].find((url) => url.startsWith('/_uploads/')) ?? (storeReference || undefined)
}

export const adTools: Tool[] = defineTools([
  /* ------------------------------------------------------------- images */
  {
    name: 'regenerate_product_image',
    area: 'products',
    description: 'Re-shoot a product image from a free-form art direction, with a choice of image model. Renders a contact sheet; attach one lane or none.',
    schema: {
      productId: { type: 'string', required: true },
      direction: { type: 'string', help: 'Free-form: "on marble, morning light, a hand holding it, no props".' },
      preset: { type: 'string', enum: PRESET_IDS, default: 'white-seamless' },
      provider: { type: 'string', enum: ['auto', 'openai', 'google', 'svg'], default: 'auto', help: 'openai = GPT Image 2, google = Gemini 3 Pro Image (Nano Banana Pro), svg = stage the photo without a model.' },
      lanes: { type: 'number', integer: true, min: 1, max: 4, default: 3 },
      attachLane: { type: 'number', integer: true, min: 0, max: 3, help: 'Leave empty to keep the sheet on the product and choose later.' },
      asHero: { type: 'boolean', default: true, help: 'When attaching, make it the hero image; otherwise add to the gallery.' },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const product = getProduct(ctx.db, ctx.storeId, args.productId as string)
      if (!product) throw new Error('No product with that id')
      const reference = referenceFor(product.heroImage, product.media.map((entry) => entry.url), store?.referenceImage)
      const provider = args.provider === 'auto' ? undefined : (args.provider as ImageProvider)
      const wanted = imageModels().find((entry) => entry.id === provider)
      if (provider && wanted && !wanted.available) throw new Error(`${wanted.name} needs ${wanted.envKey} set`)
      const started = Date.now()
      const lanes = await Promise.all(
        Array.from({ length: (args.lanes as number) ?? 3 }, (_, lane) =>
          generate({
            subject: `${product.title} ${store?.name ?? ''}#${lane}${args.direction ? ` ${String(args.direction).slice(0, 40)}` : ''}`,
            preset: args.preset as PresetId,
            kind: 'product',
            label: product.title,
            direction: (args.direction as string) ?? '',
            storeId: ctx.storeId,
            ...(provider ? { provider } : {}),
            ...(store?.brand ? { palette: store.brand } : {}),
            ...(reference ? { reference } : {}),
          }),
        ),
      )
      const used = imageModels().find((entry) => entry.id === (provider ?? (lanes[0]?.startsWith('/_media/') ? 'svg' : imageModels().find((model) => model.available)?.id)))
      const sheet = { direction: (args.direction as string) ?? '', preset: args.preset, provider: used?.id ?? 'svg', model: used?.model ?? 'built-in', lanes, at: new Date().toISOString() }
      const lane = args.attachLane as number | undefined
      const chosen = lane !== undefined ? lanes[lane] : undefined
      updateProduct(ctx.db, ctx.storeId, product.id, {
        metadata: { ...product.metadata, imageSheet: JSON.stringify(sheet) },
        ...(chosen
          ? args.asHero !== false
            ? { heroImage: chosen, media: [{ url: chosen, alt: `${product.title}, ${sheet.direction || sheet.preset}` }, ...product.media.filter((entry) => entry.url !== chosen)].slice(0, 8) }
            : { media: [...product.media, { url: chosen, alt: `${product.title}, ${sheet.direction || sheet.preset}` }].slice(0, 8) }
          : {}),
      })
      return {
        summary: `Rendered ${lanes.length} ${used?.name ?? 'vector'} lane${lanes.length === 1 ? '' : 's'} for ${product.title}${sheet.direction ? ` — "${sheet.direction}"` : ''} in ${Date.now() - started}ms${chosen ? `, attached lane ${lane}` : '; pick one on the product page'}.`,
        data: sheet,
        artifacts: [{ type: 'image', urls: lanes, caption: `${product.title}: ${sheet.direction || sheet.preset} (${used?.name ?? 'vector'})` }, { type: 'link', href: `/admin/products/${product.id}`, label: 'Choose a lane' }],
      }
    },
  },
  {
    name: 'list_image_models',
    area: 'products',
    description: 'Which image models are configured and which one runs by default.',
    schema: {},
    handler() {
      const models = imageModels()
      return {
        summary: models.map((model) => `${model.name}: ${model.available ? `ready (${model.model})` : `set ${model.envKey}`}`).join('; '),
        data: models,
        artifacts: [{ type: 'table', columns: ['Model', 'Id', 'Status'], rows: models.map((model) => [model.name, model.model, model.available ? 'ready' : `needs ${model.envKey}`]) }],
      }
    },
  },

  /* ------------------------------------------------------------ avatars */
  {
    name: 'suggest_avatars',
    area: 'products',
    description: 'Turn the research personas into editable customer avatars, each with an angle, hooks and a tone. Existing avatars are kept.',
    schema: {},
    async handler(_args, ctx) {
      const avatars = await suggestAvatars(ctx.db, ctx.storeId)
      if (!avatars.length) return { summary: 'No research on file yet, so nothing to suggest from. Run run_customer_research first.' }
      return {
        summary: `${avatars.length} avatars on file: ${avatars.map((avatar) => avatar.name).join(', ')}.`,
        data: avatars,
        artifacts: [{ type: 'table', columns: ['Avatar', 'Angle', 'Tone', 'First hook'], rows: avatars.map((avatar) => [avatar.name, avatar.angle, avatar.tone, avatar.hooks[0] ?? '']) }, { type: 'link', href: '/admin/research#avatars', label: 'Edit the avatars' }],
      }
    },
  },
  {
    name: 'list_avatars',
    area: 'products',
    description: 'The customer avatars on file and which are selected for generation.',
    schema: {},
    handler(_args, ctx) {
      const avatars = listAvatars(ctx.db, ctx.storeId)
      return { summary: avatars.length ? avatars.map((avatar) => `${avatar.name}${avatar.selected ? '' : ' (off)'}`).join(', ') : 'No avatars yet.', data: avatars }
    },
  },
  {
    name: 'save_avatar',
    area: 'products',
    description: 'Create or edit a customer avatar: who they are, what they want and fear, the angle and hooks that reach them.',
    schema: {
      id: { type: 'string', help: 'Leave empty to create.' },
      name: { type: 'string', required: true },
      who: { type: 'string' },
      wants: { type: 'string' },
      fears: { type: 'string' },
      buysWhen: { type: 'string' },
      angle: { type: 'string' },
      hooks: { type: 'array', of: { type: 'string' } },
      tone: { type: 'string', enum: ['plain', 'urgent', 'premium', 'warm', 'clinical', 'playful', 'blunt'] },
      objection: { type: 'string' },
      answer: { type: 'string' },
      selected: { type: 'boolean' },
    },
    handler(args, ctx) {
      const avatar = saveAvatar(ctx.db, ctx.storeId, { ...(args as Partial<Avatar> & { name: string }), source: args.id ? undefined : 'manual' } as Parameters<typeof saveAvatar>[2])
      return { summary: `${args.id ? 'Updated' : 'Created'} avatar ${avatar.name}: ${avatar.angle || 'no angle yet'}.`, data: avatar }
    },
  },
  {
    name: 'delete_avatar',
    area: 'products',
    description: 'Remove an avatar.',
    schema: { id: { type: 'string', required: true } },
    risk: 'confirm',
    handler(args, ctx) {
      deleteAvatar(ctx.db, ctx.storeId, args.id as string)
      return { summary: 'Avatar removed.' }
    },
  },

  /* -------------------------------------------------------- competitors */
  {
    name: 'read_competitor_site',
    area: 'products',
    description: 'Read a competitor page selling the same product into an editable angle record: headline, hooks, offer, proof, audience, the angle it runs. Paste the HTML when the site blocks fetching.',
    schema: {
      url: { type: 'string' },
      html: { type: 'string', multiline: true, help: 'The page source or its text, when the URL cannot be fetched.' },
      productId: { type: 'string', help: 'Which of your products this competes with.' },
    },
    async handler(args, ctx) {
      const angle = await readCompetitor({ url: args.url as string | undefined, html: args.html as string | undefined }, undefined, modelFor(ctx.db, ctx.storeId, 'extraction'))
      const record = saveCompetitor(ctx.db, ctx.storeId, { productId: args.productId as string | undefined, angle })
      return {
        summary: `${record.brand || 'The competitor'} runs the ${record.angle} angle: "${record.headline || record.subheadline || '(no headline found)'}"${record.offer.price ? `, priced ${record.offer.price}${record.offer.comparePrice ? ` (was ${record.offer.comparePrice})` : ''}` : ''}${record.proof.reviewCount ? `, ${record.proof.reviewCount} reviews` : ''}. ${record.hooks.length} hooks, ${record.benefits.length} benefits pulled.`,
        data: record,
        artifacts: [
          { type: 'table', columns: ['Field', 'Found'], rows: [['Headline', record.headline], ['Subheadline', record.subheadline], ['Audience', record.audience], ['Guarantee', record.offer.guarantee], ['Shipping', record.offer.shipping], ['Bundle', record.offer.bundle], ['Rating', record.proof.rating], ['CTAs', record.ctas.join(' / ')]] },
          { type: 'note', text: `Direction it turns into: ${directionFrom(record)}` },
          { type: 'link', href: '/admin/research#competitors', label: 'Edit what was pulled' },
        ],
      }
    },
  },
  {
    name: 'apply_competitor_angle',
    area: 'products',
    description: "Fold a competitor record into the research on file: a competitor row, an avatar from its audience, and what they promise and how they say it recorded as notes about them. Their claims never become this store's proof points or triggers — that would put a promise the merchant never made on the merchant's own page.",
    schema: { id: { type: 'string', required: true } },
    handler(args, ctx) {
      const research = applyCompetitor(ctx.db, ctx.storeId, args.id as string)
      return { summary: `Research now lists ${research.competitors.length} competitors and ${research.triggers.length} triggers.`, artifacts: [{ type: 'link', href: '/admin/research', label: 'Open the research' }] }
    },
  },
  {
    name: 'list_competitor_sites',
    area: 'products',
    description: 'Competitor pages read so far, with the angle each one runs.',
    schema: { productId: { type: 'string' } },
    handler(args, ctx) {
      const records = listCompetitors(ctx.db, ctx.storeId, args.productId as string | undefined)
      return { summary: records.length ? records.map((record) => `${record.brand || record.url}: ${record.angle}`).join('; ') : 'No competitor pages read yet.', data: records }
    },
  },

  /* ---------------------------------------------------------------- ads */
  {
    name: 'draft_ads',
    area: 'ads',
    description: 'Draft ads for a product from the research, an avatar and a free-form direction. Formats: static, UGC script, PAS, testimonial (real reviews only), us-vs-them, founder, 10 hooks, offer, retargeting, search.',
    schema: {
      productId: { type: 'string', required: true },
      platform: { type: 'string', enum: PLATFORM_IDS, default: 'meta' },
      formats: { type: 'array', of: { type: 'string', enum: FORMAT_IDS }, help: 'Leave empty and the direction picks.' },
      direction: { type: 'string', help: 'Free-form: "urgent, for coaches, focus on the repair guarantee, say \\"built to order\\"".' },
      avatarId: { type: 'string', help: 'Defaults to the first selected avatar.' },
      count: { type: 'number', integer: true, min: 1, max: 8, default: 3 },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const ads = await draftAds(ctx.db, store, { productId: args.productId as string, platform: args.platform as AdPlatform, formats: args.formats as string[] | undefined, direction: args.direction as string | undefined, avatarId: args.avatarId as string | undefined, count: args.count as number | undefined })
      return {
        summary: `Drafted ${ads.length} ${args.platform ?? 'meta'} ad${ads.length === 1 ? '' : 's'}: ${ads.map((ad) => ad.format).join(', ')}${ads[0]?.body.avatar ? ` for ${ads[0].body.avatar}` : ''}. Every field is editable on the Ads page.`,
        data: ads,
        artifacts: [{ type: 'table', columns: ['Ad', 'Hook', 'Headline'], rows: ads.map((ad) => [ad.format, ad.body.hooks[0] ?? '', ad.body.headline]) }, { type: 'link', href: '/admin/ads', label: 'Open the ads' }],
      }
    },
  },
  {
    name: 'revise_ad',
    area: 'ads',
    description: 'Re-draft one ad under a new direction; platform, format and avatar stay.',
    schema: { id: { type: 'string', required: true }, direction: { type: 'string', required: true } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const ad = await reviseAd(ctx.db, store, args.id as string, args.direction as string)
      return { summary: `Revised ${ad.name}: "${ad.body.hooks[0] ?? ad.body.headline}".`, data: ad, artifacts: [{ type: 'link', href: `/admin/ads/${ad.id}`, label: 'Open the ad' }] }
    },
  },
  {
    name: 'update_ad',
    area: 'ads',
    description: 'Edit an ad by hand: any text field, or its status.',
    schema: {
      id: { type: 'string', required: true },
      name: { type: 'string' },
      hooks: { type: 'array', of: { type: 'string' } },
      primaryText: { type: 'string', multiline: true },
      headline: { type: 'string' },
      description: { type: 'string' },
      cta: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'ready', 'archived'] },
    },
    handler(args, ctx) {
      const { id, name, status, ...body } = args as Record<string, unknown>
      const clean = Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined))
      const ad = saveAd(ctx.db, ctx.storeId, { id: id as string, ...(name ? { name: name as string } : {}), ...(status ? { status: status as 'draft' } : {}), body: clean })
      const warnings = limitWarnings(ad)
      return { summary: `Saved ${ad.name}.${warnings.length ? ` ${warnings.join(' ')}` : ''}`, data: ad }
    },
  },
  {
    name: 'list_ads',
    area: 'ads',
    description: 'The ads drafted for this store.',
    schema: { productId: { type: 'string' }, status: { type: 'string', enum: ['draft', 'ready', 'archived'] } },
    handler(args, ctx) {
      const ads = listAds(ctx.db, ctx.storeId, { productId: args.productId as string | undefined, status: args.status as string | undefined })
      return { summary: ads.length ? `${ads.length} ads: ${ads.map((ad) => `${ad.platform}/${ad.format}`).join(', ')}` : 'No ads yet.', data: ads, artifacts: [{ type: 'table', columns: ['Ad', 'Platform', 'Status', 'Hook'], rows: ads.map((ad) => [ad.name, ad.platform, ad.status, ad.body.hooks[0] ?? '']) }] }
    },
  },
  {
    name: 'get_ad',
    area: 'ads',
    description: 'Read one ad in full.',
    schema: { id: { type: 'string', required: true } },
    handler(args, ctx) {
      const ad = getAd(ctx.db, ctx.storeId, args.id as string)
      if (!ad) throw new Error('No such ad')
      return { summary: `${ad.name}: ${ad.body.primaryText.slice(0, 200)}`, data: ad }
    },
  },
  {
    name: 'find_ad_inspiration',
    area: 'ads',
    description: 'Look for ads to learn from: the Meta Ad Library (with a token), a competitor URL, pasted ad text, and proven hook patterns filled with your product.',
    schema: {
      query: { type: 'string', help: 'Search terms for the Ad Library, e.g. the product\'s generic name.' },
      url: { type: 'string', help: 'A competitor landing page or ad link to read.' },
      text: { type: 'string', multiline: true, help: 'Ad text pasted from anywhere; the first line is treated as the hook.' },
      productId: { type: 'string', help: 'Fills the hook patterns with this product.' },
      country: { type: 'string', help: 'Ad Library reach country; EU/UK return commercial ads. Default GB.' },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const product = args.productId ? getProduct(ctx.db, ctx.storeId, args.productId as string) : listProducts(ctx.db, ctx.storeId, { limit: 1 })[0]
      const notes: string[] = []
      const found = []
      if (args.query) {
        const library = await searchAdLibrary(args.query as string, { country: args.country as string | undefined })
        notes.push(library.note)
        found.push(...library.results)
      }
      if (args.url || args.text) found.push(await readInspiration({ url: args.url as string | undefined, text: args.text as string | undefined }, undefined, modelFor(ctx.db, ctx.storeId, 'extraction')))
      const patterns = patternInspiration(product?.title ?? store?.name ?? 'this', readBrief(store?.prompt ?? '').category)
      return {
        summary: `${found.length} found${notes.length ? ` (${notes.join(' ')})` : ''}, plus ${patterns.length} hook patterns for ${product?.title ?? 'the store'}. Save the ones worth keeping with save_ad_inspiration.`,
        data: { found, patterns },
        artifacts: [{ type: 'table', columns: ['Source', 'Brand', 'Hook', 'Angle'], rows: [...found, ...patterns.slice(0, 5)].map((entry) => [entry.source, entry.brand, entry.hook, entry.angle]) }, { type: 'link', href: '/admin/ads#inspiration', label: 'Open the swipe file' }],
      }
    },
  },
  {
    name: 'save_ad_inspiration',
    area: 'ads',
    description: 'Keep an ad in the swipe file. Drafts read the file for hooks and angles.',
    schema: {
      hook: { type: 'string', required: true },
      brand: { type: 'string' },
      url: { type: 'string' },
      primaryText: { type: 'string', multiline: true },
      notes: { type: 'string' },
      source: { type: 'string', enum: ['ad-library', 'url', 'paste', 'pattern'], default: 'paste' },
    },
    handler(args, ctx) {
      const saved = saveInspiration(ctx.db, ctx.storeId, args as Parameters<typeof saveInspiration>[2])
      return { summary: `Kept "${saved.hook}" (${saved.angle}).`, data: saved }
    },
  },

  /* ------------------------------------------------------------ domains */
  {
    name: 'connect_domain',
    area: 'domains',
    description: 'Attach a domain to this store, hosted here (DNS points at the platform) or forwarded by the registrar, with the exact records and the registrar\'s menu path.',
    schema: {
      hostname: { type: 'string', required: true },
      mode: { type: 'string', enum: ['host', 'forward'], default: 'host' },
      registrar: { type: 'string', enum: REGISTRARS.map((registrar) => registrar.id), default: 'namecheap' },
    },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const record = attachDomain(ctx.db, ctx.storeId, { hostname: args.hostname as string, mode: args.mode as DomainMode, registrar: args.registrar as string })
      const plan = dnsPlan(record.hostname, record.mode, record.registrar, record.verificationToken, publicUrlFor(store.slug))
      return {
        summary: `${record.hostname} attached (${record.mode}). ${plan.records.length} records to add at ${args.registrar}; then check it.${plan.caveat ? ` ${plan.caveat}` : ''}`,
        data: { record, plan },
        artifacts: [{ type: 'table', columns: ['Type', 'Host', 'Value'], rows: plan.records.map((entry) => [entry.type, entry.name, entry.value]) }, { type: 'note', text: plan.steps.join(' → ') }, { type: 'link', href: '/admin/domains', label: 'Open domains' }],
      }
    },
  },
  {
    name: 'check_domain',
    area: 'domains',
    description: 'Look the domain up and say exactly what was found: the TXT, where the name points, or where it redirects.',
    schema: { hostname: { type: 'string', required: true } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const check = await checkDomain(ctx.db, ctx.storeId, args.hostname as string, publicUrlFor(store.slug))
      return { summary: check.reason, data: check }
    },
  },
  {
    name: 'mark_domain_verified',
    area: 'domains',
    description: 'Skip the lookup and mark a domain verified. For DNS behind a proxy the check cannot see; if the name does not actually resolve here, visitors will not arrive.',
    schema: { hostname: { type: 'string', required: true } },
    risk: 'confirm',
    handler(args, ctx) {
      const result = verifyDomain(ctx.db, ctx.storeId, (args.hostname as string).toLowerCase())
      return { summary: `${result.hostname} marked verified without a lookup.`, data: result }
    },
  },
  {
    name: 'list_domains',
    area: 'domains',
    description: 'The domains attached to this store and their state.',
    schema: {},
    handler(_args, ctx) {
      const domains = domainsFor(ctx.db, ctx.storeId)
      return { summary: domains.length ? domains.map((domain) => `${domain.hostname}: ${domain.status} (${domain.mode})`).join(', ') : 'No domains attached. The store is live at its platform address.', data: domains }
    },
  },
])
