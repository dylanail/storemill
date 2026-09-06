import { listProducts } from '../../domain/catalog.ts'
import { statsFor } from '../../domain/reviews.ts'
import { environment, getStore, publish, publishState, rollback, setTheme, updateStore } from '../../control/stores.ts'
import { createRegion, defaultRegion, listRegions, setShippingOption } from '../../domain/regions.ts'
import { inviteTeammate } from '../../control/auth.ts'
import { refreshTodos } from '../../control/todos.ts'
import { addRedirect, listSeoPages, productJsonLd, upsertSeoPage, validateProductSchema } from '../../seo/schema.ts'
import type { Brand } from '../../domain/types.ts'
import { brandDescription, brandName, brandVoice, paletteFor, readBrief, slogan } from '../copy.ts'
import { generate } from '../images.ts'
import { publicStoreUrl } from '../../lib/urls.ts'
import { defineTools, type Tool } from '../registry.ts'

const SECTIONS = ['announcement', 'hero', 'featured', 'story', 'collection-grid', 'reviews', 'newsletter', 'footer']

export const storefrontTools: Tool[] = defineTools([
  {
    name: 'set_brand',
    area: 'store',
    description: 'Set the store name, slogan, palette, fonts and voice. Anything left empty is derived from the store prompt.',
    schema: {
      name: { type: 'string' },
      slogan: { type: 'string' },
      description: { type: 'string' },
      primary: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      secondary: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      paper: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      ink: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
      announcement: { type: 'string' },
      voice: { type: 'string' },
    },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const brief = readBrief(store.prompt || store.name)
      const palette = paletteFor(brief)
      const name = (args.name as string) || store.name || brandName(brief)
      const brand: Brand = {
        name,
        slogan: (args.slogan as string) || store.brand.slogan || slogan(brief, name),
        description: (args.description as string) || store.brand.description || brandDescription(brief, name),
        primary: (args.primary as string) || store.brand.primary || palette.primary,
        secondary: (args.secondary as string) || store.brand.secondary || palette.secondary,
        paper: (args.paper as string) || store.brand.paper || palette.paper,
        ink: (args.ink as string) || store.brand.ink || palette.ink,
        displayFont: store.brand.displayFont || palette.displayFont,
        bodyFont: store.brand.bodyFont || palette.bodyFont,
        announcement: (args.announcement as string) || store.brand.announcement || '',
        voice: (args.voice as string) || store.brand.voice || brandVoice(brief),
      }
      if (!store.brand.logoSvg) {
        brand.logoSvg = await generate({ subject: `${name} monogram`, kind: 'logo', label: name, palette: brand })
      }
      updateStore(ctx.db, ctx.storeId, { name, brand })
      return {
        summary: `Brand set on the draft: ${name}, "${brand.slogan}", ${brand.primary} on ${brand.paper}. Publish to make it live.`,
        data: brand,
        artifacts: [{ type: 'image', urls: [brand.logoSvg ?? store.brand.logoSvg ?? ''].filter(Boolean), caption: `${name} mark` }],
      }
    },
  },
  {
    name: 'generate_brand_logo',
    area: 'store',
    description: 'Draw a new brand mark from the current palette. Goes to the draft; publish makes it live.',
    schema: { note: { type: 'string', help: 'Optional steer for the mark.' } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const logoSvg = await generate({ subject: `${store.name} ${(args.note as string) ?? ''} monogram`, kind: 'logo', label: store.name, palette: store.brand })
      updateStore(ctx.db, ctx.storeId, { brand: { logoSvg } })
      return { summary: `New mark for ${store.name}, on the draft. Publish to make it live.`, artifacts: [{ type: 'image', urls: [logoSvg], caption: `${store.name} mark` }] }
    },
  },
  {
    name: 'generate_hero_image',
    area: 'store',
    description: 'Generate the storefront hero image and put it on the draft theme.',
    schema: { scene: { type: 'string', required: true }, headline: { type: 'string' }, sub: { type: 'string' } },
    async handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const heroImage = await generate({ subject: `${store.name}: ${args.scene as string}`, kind: 'hero', label: store.name, palette: store.brand })
      setTheme(
        ctx.db,
        ctx.storeId,
        {
          heroImage,
          ...(args.headline ? { heroHeadline: args.headline as string } : {}),
          ...(args.sub ? { heroSub: args.sub as string } : {}),
        },
        { build: 'Rebuilt the hero section' },
      )
      return { summary: 'New hero on the draft. Publish when it looks right.', artifacts: [{ type: 'image', urls: [heroImage], caption: args.scene as string }] }
    },
  },
  {
    name: 'edit_storefront',
    area: 'store',
    description: 'Change the draft storefront: which sections appear and in what order, the template, corner radius and density.',
    schema: {
      sections: { type: 'array', of: { type: 'string', enum: SECTIONS }, help: 'Full ordered list of sections.' },
      template: { type: 'string', enum: ['atelier', 'gallery', 'market'] },
      radius: { type: 'string', enum: ['0px', '2px', '8px', '999px'] },
      density: { type: 'string', enum: ['compact', 'roomy'] },
      heroHeadline: { type: 'string' },
      heroSub: { type: 'string' },
    },
    handler(args, ctx) {
      const patch: Record<string, unknown> = {}
      for (const key of ['sections', 'template', 'radius', 'density', 'heroHeadline', 'heroSub']) {
        if (args[key] !== undefined) patch[key] = args[key]
      }
      if (!Object.keys(patch).length) throw new Error('Nothing to change — say what should be different.')
      const draft = setTheme(ctx.db, ctx.storeId, patch, { build: `Edited ${Object.keys(patch).join(', ')}` })
      return {
        summary: `Draft updated (${Object.keys(patch).join(', ')}). It is not live until you publish.`,
        data: draft.theme,
        artifacts: [{ type: 'link', href: '/admin/store', label: 'Open the store designer' }],
      }
    },
  },
  {
    name: 'set_store_code',
    area: 'store',
    description: 'CSS and JavaScript for the whole store, on every page after the theme: a font tweak, a global animation, a sticky element, a script every page needs. Replaces or appends to what is there. For one page use a custom-code block; for one section define a block with create_block. Goes to the draft; publish makes it live.',
    schema: {
      css: { type: 'string', max: 40000, help: 'CSS. Empty leaves the current css alone.' },
      js: { type: 'string', max: 40000, help: 'JavaScript, run at the end of every page. No external scripts. Empty leaves the current script alone.' },
      mode: { type: 'string', enum: ['append', 'replace'], default: 'append', help: 'append adds to what is there; replace starts over.' },
      clear: { type: 'boolean', default: false, help: 'Remove all store-wide css and js.' },
    },
    handler(args, ctx) {
      const draft = environment(ctx.db, ctx.storeId, 'draft')
      if (args.clear) {
        setTheme(ctx.db, ctx.storeId, { customCss: '', customJs: '' }, { build: 'Store-wide css and js cleared by the assistant' })
        return { summary: 'Store-wide css and js cleared on the draft.' }
      }
      const css = String(args.css ?? '').trim()
      const js = String(args.js ?? '').trim()
      if (!css && !js) throw new Error('Give css, js, or clear.')
      if (/<script\b[^>]*\bsrc=/i.test(js)) throw new Error('No external scripts; write the script itself.')
      const join = (current: string, next: string) => (args.mode === 'replace' || !current ? next : `${current}\n\n${next}`)
      const patch = { ...(css ? { customCss: join(draft.theme.customCss ?? '', css) } : {}), ...(js ? { customJs: join(draft.theme.customJs ?? '', js) } : {}) }
      setTheme(ctx.db, ctx.storeId, patch, { build: `Store-wide ${[css ? 'css' : '', js ? 'js' : ''].filter(Boolean).join(' and ')} ${args.mode === 'replace' ? 'replaced' : 'added'} by the assistant` })
      const next = environment(ctx.db, ctx.storeId, 'draft').theme
      return { summary: `Store-wide code on the draft: ${(next.customCss ?? '').length} characters of css, ${(next.customJs ?? '').length} of js. Publish to make it live.`, artifacts: [{ type: 'link', href: '/admin/store#code', label: 'See it in the store designer' }] }
    },
  },
  {
    name: 'set_announcement',
    area: 'store',
    description: 'Set the announcement bar text at the top of the storefront. Goes to the draft; publish makes it live.',
    schema: { text: { type: 'string', required: true, max: 120 } },
    handler(args, ctx) {
      updateStore(ctx.db, ctx.storeId, { brand: { announcement: args.text as string } })
      return { summary: `Announcement bar on the draft now reads "${args.text}". Publish to make it live.` }
    },
  },
  {
    name: 'preview_store',
    area: 'store',
    description: 'Report what the draft looks like and whether it is ready to publish.',
    schema: {},
    handler(_args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const draft = environment(ctx.db, ctx.storeId, 'draft')
      const state = publishState(ctx.db, ctx.storeId)
      const products = listProducts(ctx.db, ctx.storeId, { status: 'published', limit: 100 })
      return {
        summary: `${draft.theme.template} template, ${draft.theme.sections.length} sections, ${products.length} published products. ${state.reason}`,
        data: { theme: draft.theme, publishState: state },
        artifacts: [{ type: 'link', href: `/preview/${store?.slug ?? ''}`, label: 'Open the preview' }],
      }
    },
  },
  {
    name: 'publish_store',
    area: 'store',
    description: 'Copy the draft over the live storefront. This is what customers see.',
    risk: 'confirm',
    schema: {},
    handler(_args, ctx) {
      const state = publishState(ctx.db, ctx.storeId)
      if (!state.ready && state.label !== 'Store is live') throw new Error(state.reason)
      const live = publish(ctx.db, ctx.storeId)
      refreshTodos(ctx.db, ctx.storeId)
      const store = getStore(ctx.db, ctx.storeId)
      return {
        summary: `Published v${live.version}. ${store?.name} is live.`,
        artifacts: [{ type: 'link', href: `/preview/${store?.slug ?? ''}`, label: 'View your store' }],
      }
    },
  },
  {
    name: 'rollback_store',
    area: 'store',
    description: 'Throw away the draft edits and start again from what is live.',
    risk: 'confirm',
    schema: {},
    handler(_args, ctx) {
      rollback(ctx.db, ctx.storeId)
      return { summary: 'Draft reset to the live version. Nothing customers see changed.' }
    },
  },
  {
    name: 'add_region',
    area: 'setup',
    description: 'Add a selling region with its own currency and countries.',
    schema: {
      name: { type: 'string', required: true },
      currency: { type: 'string', required: true, pattern: '^[A-Za-z]{3}$' },
      countries: { type: 'array', of: { type: 'string' }, required: true },
      taxRate: { type: 'number', min: 0, max: 1, default: 0 },
    },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const region = createRegion(ctx.db, ctx.storeId, {
        name: args.name as string,
        currency: args.currency as string,
        countries: args.countries as string[],
        taxRate: args.taxRate as number,
      })
      setShippingOption(ctx.db, region.id, { name: 'Standard shipping', amountCents: 900, freeAboveCents: 20000 })
      return { summary: `${region.name} is live in ${region.currency} for ${region.countries.join(', ')}, with a standard rate and a free-shipping threshold.`, data: region }
    },
  },
  {
    name: 'set_shipping_rate',
    area: 'setup',
    description: 'Add or change a shipping rate, with an optional free-shipping threshold, for a region. A rate of the same name is changed rather than duplicated.',
    schema: {
      name: { type: 'string', required: true },
      amountCents: { type: 'number', integer: true, min: 0, required: true },
      freeAboveCents: { type: 'number', integer: true, min: 0 },
      regionId: { type: 'string', help: 'Defaults to the store default region.' },
    },
    handler(args, ctx) {
      const region = args.regionId
        ? listRegions(ctx.db, ctx.storeId).find((entry) => entry.id === args.regionId)
        : defaultRegion(ctx.db, ctx.storeId)
      if (!region) throw new Error('No region to attach the rate to')
      const before = region.shipping.length
      const option = setShippingOption(ctx.db, region.id, {
        name: args.name as string,
        amountCents: args.amountCents as number,
        freeAboveCents: (args.freeAboveCents as number) ?? null,
      })
      refreshTodos(ctx.db, ctx.storeId)
      const added = listRegions(ctx.db, ctx.storeId).find((entry) => entry.id === region.id)?.shipping.length !== before
      return { summary: `${option.name} ${added ? 'added to' : 'changed on'} ${region.name}.`, data: option }
    },
  },
  {
    name: 'list_regions',
    area: 'setup',
    description: 'The selling regions on this store: currency, countries, tax and the shipping rates the cart quotes from.',
    schema: {},
    handler(_args, ctx) {
      const regions = listRegions(ctx.db, ctx.storeId)
      return {
        summary: regions.length
          ? `${regions.length} region${regions.length === 1 ? '' : 's'}: ${regions.map((region) => `${region.name} (${region.currency})`).join(', ')}.`
          : 'No regions. The checkout has no currency and no rate until there is one.',
        data: regions,
        artifacts: [{
          type: 'table',
          columns: ['Region', 'Currency', 'Countries', 'Tax', 'Rates'],
          rows: regions.map((region) => [
            `${region.name}${region.isDefault ? ' (default)' : ''}`,
            region.currency,
            region.countries.join(', '),
            `${(region.taxRate * 100).toFixed(2)}%`,
            region.shipping.map((option) => `${option.name} ${(option.amountCents / 100).toFixed(2)}${option.freeAboveCents === null ? '' : ` free over ${(option.freeAboveCents / 100).toFixed(2)}`}`).join(' · '),
          ]),
        }],
      }
    },
  },
  {
    name: 'invite_teammate',
    area: 'setup',
    description: 'Invite someone to this store as an admin or a member.',
    risk: 'confirm',
    schema: { email: { type: 'string', required: true }, role: { type: 'string', enum: ['admin', 'member'], default: 'member' } },
    handler(args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      const result = inviteTeammate(ctx.db, ctx.storeId, args.email as string, args.role as 'admin' | 'member')
      return {
        summary: result.joined
          ? `${args.email} already has an account and now has ${args.role} access.`
          : `Invite sent to ${args.email}. They join as ${args.role} when they accept.`,
        data: result,
      }
    },
  },
  {
    name: 'write_seo',
    area: 'seo',
    description: 'Write the meta title and description for a page and record the keyword it targets.',
    schema: {
      path: { type: 'string', required: true },
      title: { type: 'string', required: true, max: 70 },
      description: { type: 'string', required: true, max: 165 },
      keyword: { type: 'string' },
    },
    handler(args, ctx) {
      upsertSeoPage(ctx.db, ctx.storeId, {
        path: args.path as string,
        title: args.title as string,
        description: args.description as string,
        ...(args.keyword ? { keyword: args.keyword as string } : {}),
      })
      return { summary: `SEO saved for ${args.path} (${String(args.title).length} char title, ${String(args.description).length} char description).` }
    },
  },
  {
    name: 'validate_schema',
    area: 'seo',
    description: 'Check the structured data on every published product and report what a crawler would reject.',
    schema: {},
    handler(_args, ctx) {
      const store = getStore(ctx.db, ctx.storeId)
      if (!store) throw new Error('No store')
      const products = listProducts(ctx.db, ctx.storeId, { status: 'published', limit: 100 })
      const rows: string[][] = []
      for (const product of products) {
        const node = productJsonLd(store, product, `${publicStoreUrl(ctx.db, store)}/products/${product.handle}`, statsFor(ctx.db, ctx.storeId, product.id))
        for (const issue of validateProductSchema(node)) rows.push([product.title, issue.level, issue.message])
      }
      const errors = rows.filter((row) => row[1] === 'error').length
      return {
        summary: errors ? `${errors} structured-data error${errors === 1 ? '' : 's'} across ${products.length} products.` : `Structured data is clean on all ${products.length} products.`,
        artifacts: [{ type: 'table', columns: ['Product', 'Level', 'Issue'], rows, caption: 'Product, Offer, AggregateRating, BreadcrumbList' }],
      }
    },
  },
  {
    name: 'add_redirect',
    area: 'seo',
    description: 'Add a 301 redirect, usually to keep an old URL working after a migration.',
    schema: { source: { type: 'string', required: true }, target: { type: 'string', required: true }, code: { type: 'number', integer: true, min: 300, max: 399, default: 301 } },
    handler(args, ctx) {
      addRedirect(ctx.db, ctx.storeId, args.source as string, args.target as string, args.code as number)
      return { summary: `${args.source} now redirects to ${args.target} with a ${args.code}.` }
    },
  },
  {
    name: 'seo_report',
    area: 'seo',
    description: 'Which pages have meta written, which are thin, and what they target.',
    schema: {},
    handler(_args, ctx) {
      const pages = listSeoPages(ctx.db, ctx.storeId) as Array<{ path: string; title: string; description: string; keyword: string; health: string }>
      const thin = pages.filter((page) => !page.description || page.description.length < 60)
      return {
        summary: `${pages.length} pages tracked, ${thin.length} thin.`,
        artifacts: [{ type: 'table', columns: ['Path', 'Title', 'Keyword', 'Health'], rows: pages.map((page) => [page.path, page.title || '—', page.keyword || '—', page.description ? page.health : 'thin']) }],
      }
    },
  },
])
