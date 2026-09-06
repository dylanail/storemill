import { productGalleryRuntime } from './product-gallery-runtime.ts'
import { columnLayoutStyle } from './column-layout.ts'
import { escapeHtml } from '../lib/http.ts'
import { format, minorDigits } from '../lib/money.ts'
import type { Schema } from '../lib/validate.ts'
import { check } from '../lib/validate.ts'

/**
 * The block library.
 *
 * A page is a flat list of blocks, the way Shopify's theme editor is a flat
 * list of sections; the vocabulary is Shopify's sections plus Funnelish's
 * conversion elements plus the parts an advertorial needs. Every block has a
 * schema (the same shape plugins and tools use, so one form renderer draws
 * the settings panel for all of them) and a render function that takes the
 * validated settings and the page context and returns HTML.
 *
 * Blocks never reach into the database. Anything that needs store data — a
 * buy box, a review wall, a bundle widget — is handed it through `context`,
 * which the storefront route assembles once per page.
 */
export type BlockInstance = { id: string; type: string; settings: Record<string, unknown> }

export type BlockContext = {
  storeName: string
  base: string
  currency: string
  products: Array<{
    id: string
    handle: string
    title: string
    subtitle: string
    image: string
    media?: Array<{url:string;alt:string;kind?:'image'|'video';poster?:string}>
    priceCents: number
    variants: Array<{ id: string; title: string; priceCents: number }>
    options: Array<{ title: string; values: Array<{ value: string; swatch?: string }> }>
  }>
  reviews: Array<{ productId: string; rating: number; title: string; body: string; author: string; verified: boolean; media?: string[] }>
  bundles: Array<{ productId: string; html: string }>
  brand: { primary?: string; secondary?: string; logoSvg?: string; slogan?: string }
  /** The blocks this store defined for itself (custom-blocks.ts), resolved alongside the catalog. */
  custom?: BlockDefinition[]
  /**
   * Where this page's call to action leads inside its funnel: the offer page
   * for an advertorial, the checkout for an offer page. The funnel model is
   * ad → advertorial → offer → checkout, and the advertorial's own CTA
   * defaults to `#offer`, an anchor on itself — so the offer page a merchant
   * had chosen in the funnel editor was never linked from anywhere.
   */
  funnelNext?: string
  /** Live numbers the conversion blocks read. Always from real data; empty when there is none. */
  live?: {
    purchases: Array<{ name: string; city: string; product: string; image: string; at: string }>
    viewers: Record<string, number>
    stock: Record<string, number>
    estimates: Record<string, { from: string; to: string }>
    questions: Array<{ productId: string; question: string; answer: string; asker: string }>
    sizeCharts: Record<string, string>
  }
  /**
   * Present only while the checkout renders. The storefront builds the form,
   * the summary, the express row and the bump once from the real cart and the
   * checkout blocks place them; a block page that is not the checkout sees
   * none of this and the checkout blocks say so instead of rendering nothing.
   */
  checkout?: {
    /** The contact, delivery, shipping and payment form with the pay button. Carries a `<!--bump-->` marker where the order bump goes. */
    formHtml: string
    headerHtml?: string
    footerHtml?: string
    /** Line items, discount code and totals. */
    summaryHtml: string
    /** The express wallet row; empty without a payment provider. */
    expressHtml: string
    /** The order-bump checkbox; empty when the funnel has none. */
    bumpHtml: string
    totalCents: number
    itemCount: number
    error?: string
    /** No real cart: the editor preview, filled with a sample line. */
    sample: boolean
  }
}

export type BlockDefinition = {
  type: string
  name: string
  group: 'Layout' | 'Text & media' | 'Commerce' | 'Social proof' | 'Conversion' | 'Advertorial' | 'Checkout' | 'Forms' | 'Advanced' | 'Custom'
  icon: string
  description: string
  schema: Schema
  render: (settings: Record<string, unknown>, context: BlockContext, block: BlockInstance) => string
  /** A script the block needs, run once per page that uses it (custom blocks). It finds its instances by `.blk--<type>`. */
  js?: string
}

/* --------------------------------------------------------------- helpers */

const COMMON: Schema = {
  background: { type: 'string', label: 'Background', enum: ['paper', 'raise', 'ink', 'primary', 'none'], default: 'none' },
  padding: { type: 'string', label: 'Vertical padding', enum: ['none', 'small', 'medium', 'large'], default: 'medium' },
  width: { type: 'string', label: 'Width', enum: ['narrow', 'regular', 'wide', 'full'], default: 'regular' },
  align: { type: 'string', label: 'Text align', enum: ['left', 'center'], default: 'left' },
}

const e = escapeHtml

function wrap(settings: Record<string, unknown>, block: BlockInstance, inner: string, extra = ''): string {
  const classes = ['blk', `blk--${block.type}`, `bg-${settings.background ?? 'none'}`, `pad-${settings.padding ?? 'medium'}`, `w-${settings.width ?? 'regular'}`, `al-${settings.align ?? 'left'}`, extra]
  return `<section class="${classes.filter(Boolean).join(' ')}" data-block="${e(block.id)}"><div class="blk-in">${inner}</div></section>`
}

function button(label: unknown, href: unknown, style: unknown = 'primary'): string {
  if (!label) return ''
  return `<a class="btn ${style === 'ghost' ? 'btn--ghost' : ''} ${style === 'wide' ? 'btn--wide' : ''}" href="${e(href || '#')}">${e(label)}</a>`
}

function lines(text: unknown): string {
  return String(text ?? '')
    .split(/\n{2,}/)
    .filter((part) => part.trim())
    .map((part) => `<p>${e(part.trim()).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/** One entry per line. Fields inside a line are split on `|` by the block itself. */
function list(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}

function productFor(context: BlockContext, id: unknown) {
  return context.products.find((product) => product.id === id || product.handle === id) ?? context.products[0] ?? null
}

/** YouTube and Vimeo become a click-to-load embed; anything else is treated as a video file. */
function embedFor(url: string): string {
  const yt = /(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/.exec(url)?.[1]
  const vimeo = /vimeo\.com\/(\d+)/.exec(url)?.[1]
  return yt ? `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1` : vimeo ? `https://player.vimeo.com/video/${vimeo}?autoplay=1` : ''
}

function videoTile(url: string, poster: string): string {
  const embed = embedFor(url)
  if (embed) return `<div class="video" data-embed="${e(embed)}">${poster ? `<img src="${e(poster)}" alt="" loading="lazy">` : ''}<button type="button" class="play" aria-label="Play">▶</button></div>`
  return url ? `<video class="video" controls preload="none" ${poster ? `poster="${e(poster)}"` : ''} src="${e(url)}"></video>` : '<div class="ph">Add a video URL</div>'
}

/** An icon cell is an emoji or a glyph; a URL or an upload path becomes an image. */
function icon(value: string): string {
  return /^(https?:\/\/|\/)/.test(value.trim()) ? `<img src="${e(value.trim())}" alt="" loading="lazy">` : e(value)
}

function stars(rating: number): string {
  const full = Math.max(0, Math.min(5, Math.round(rating)))
  return `<span class="stars" aria-label="${full} out of 5">${'★'.repeat(full)}${'☆'.repeat(5 - full)}</span>`
}

/* ---------------------------------------------------------------- blocks */

export const BLOCKS: BlockDefinition[] = [
  /* Layout */
  {
    type: 'announcement-bar',
    name: 'Announcement bar',
    group: 'Layout',
    icon: '▬',
    description: 'One line across the top: shipping promise, offer, deadline.',
    schema: { text: { type: 'string', label: 'Lines (one per line rotate)', multiline: true, required: true, default: 'FREE SHIPPING OVER $200 · 30-DAY RETURNS' }, ...COMMON },
    render: (settings, _context, block) => {
      const items = list(settings.text)
      if (items.length <= 1) return `<div class="announce" data-block="${e(block.id)}">${e(items[0] ?? settings.text)}</div>`
      return `<div class="announce announce--rotate" data-block="${e(block.id)}" data-rotate>${items.map((line, index) => `<span ${index ? 'hidden' : ''}>${e(line)}</span>`).join('')}</div>`
    },
  },
  {
    type: 'header',
    name: 'Header',
    group: 'Layout',
    icon: '⌂',
    description: 'Logo, name and navigation. Minimal by default, as a landing page should be.',
    schema: {
      showNav: { type: 'boolean', label: 'Show navigation', default: false },
      links: { type: 'string', label: 'Links (label|href per line)', multiline: true, default: 'Shop|/collections/all' },
      cta: { type: 'string', label: 'Button label', default: '' },
      ctaHref: { type: 'string', label: 'Button link', default: '#offer' },
    },
    render: (settings, context, block) => `<header class="site" data-block="${e(block.id)}"><div class="wrap row">
      <a class="brandmark" href="${context.base}/">${context.brand.logoSvg ? `<img src="${e(context.brand.logoSvg)}" alt="">` : ''}<span><span class="name">${e(context.storeName)}</span></span></a>
      ${settings.showNav ? `<button type="button" data-nav-toggle aria-controls="navigation-${e(block.id)}" aria-expanded="false" aria-label="Open menu">Menu</button><nav class="main" id="navigation-${e(block.id)}" aria-label="Main">${list(settings.links).map((entry) => { const [label = '', href = '#'] = entry.split('|'); return `<a href="${e(href.startsWith('/') ? context.base + href : href)}">${e(label)}</a>` }).join('')}</nav>` : '<span style="margin-left:auto"></span>'}
      ${settings.cta ? `<div class="tools">${button(settings.cta, settings.ctaHref)}</div>` : ''}</div></header>`,
  },
  {
    type: 'spacer',
    name: 'Spacer',
    group: 'Layout',
    icon: '↕',
    description: 'Vertical space.',
    schema: { height: { type: 'number', label: 'Height (px)', integer: true, min: 4, max: 400, default: 48 } },
    render: (settings, _context, block) => `<div data-block="${e(block.id)}" style="height:${Number(settings.height)}px"></div>`,
  },
  {
    type: 'divider',
    name: 'Divider',
    group: 'Layout',
    icon: '—',
    description: 'A rule between sections.',
    schema: { width: COMMON.width as never },
    render: (settings, _context, block) => wrap({ ...settings, padding: 'none' }, block, '<hr class="rule">'),
  },
  {
    type: 'footer',
    name: 'Footer',
    group: 'Layout',
    icon: '▁',
    description: 'Store name, links, legal line.',
    schema: { links: { type: 'string', label: 'Links (label|href per line)', multiline: true, default: 'Shipping & returns|/pages/shipping\nAbout|/pages/about\nPrivacy|/pages/privacy\nTerms|/pages/terms' }, legal: { type: 'string', label: 'Legal line', default: '' } },
    render: (settings, context, block) => `<footer class="site" data-block="${e(block.id)}"><div class="wrap"><div><div class="word">${e(context.storeName)}</div><p style="opacity:.7;margin-top:.6rem">${e(context.brand.slogan ?? '')}</p></div>
      <div>${list(settings.links).map((entry) => { const [label = '', href = '#'] = entry.split('|'); return `<a href="${e(href.startsWith('/') ? context.base + href : href)}">${e(label)}</a>` }).join('')}</div>
      <div style="opacity:.6;font-size:.8rem">${e(settings.legal || `© ${new Date().getFullYear()} ${context.storeName}`)}</div></div></footer>`,
  },

  /* Text & media */
  {
    type: 'hero',
    name: 'Image banner',
    group: 'Text & media',
    icon: '▣',
    description: 'Full-width image with headline, subheading and a button. The Shopify "Image banner".',
    schema: {
      eyebrow: { type: 'string', label: 'Eyebrow', default: '' },
      headline: { type: 'string', label: 'Headline', required: true, default: 'The headline that earns the scroll' },
      sub: { type: 'string', label: 'Subheading', multiline: true, default: '' },
      image: { type: 'string', label: 'Background image URL', default: '' },
      cta: { type: 'string', label: 'Button label', default: 'Shop now' },
      ctaHref: { type: 'string', label: 'Button link', default: '#offer' },
      cta2: { type: 'string', label: 'Second button', default: '' },
      cta2Href: { type: 'string', label: 'Second button link', default: '' },
      height: { type: 'string', label: 'Height', enum: ['small', 'medium', 'large'], default: 'medium' },
      overlay: { type: 'number', label: 'Darken image (0–90)', integer: true, min: 0, max: 90, default: 45 },
    },
    render: (settings, _context, block) => `<div class="hero hero--${e(settings.height)}" data-block="${e(block.id)}" style="--overlay:${Number(settings.overlay) / 100}">
      ${settings.image ? `<img src="${e(settings.image)}" alt="" loading="eager" fetchpriority="high">` : ''}
      <div class="inner">${settings.eyebrow ? `<div class="eyebrow light">${e(settings.eyebrow)}</div>` : ''}<h1>${e(settings.headline)}</h1>${settings.sub ? `<p>${e(settings.sub)}</p>` : ''}
      <p class="ctas">${button(settings.cta, settings.ctaHref)} ${button(settings.cta2, settings.cta2Href, 'ghost')}</p></div></div>`,
  },
  {
    type: 'headline',
    name: 'Headline',
    group: 'Text & media',
    icon: 'H',
    description: 'A heading on its own, with optional eyebrow and subheading.',
    schema: {
      eyebrow: { type: 'string', label: 'Eyebrow', default: '' },
      text: { type: 'string', label: 'Headline', required: true, default: 'Say the one thing' },
      sub: { type: 'string', label: 'Subheading', multiline: true, default: '' },
      level: { type: 'string', label: 'Size', enum: ['h1', 'h2', 'h3'], default: 'h2' },
      ...COMMON,
    },
    render: (settings, _context, block) => wrap(settings, block, `${settings.eyebrow ? `<div class="eyebrow">${e(settings.eyebrow)}</div>` : ''}<${e(settings.level)} class="head">${e(settings.text)}</${e(settings.level)}>${settings.sub ? `<p class="lead">${e(settings.sub)}</p>` : ''}`),
  },
  {
    type: 'rich-text',
    name: 'Rich text',
    group: 'Text & media',
    icon: '¶',
    description: 'Paragraphs. A blank line starts a new one.',
    schema: { text: { type: 'string', label: 'Text', multiline: true, required: true, default: 'Write like you would say it.' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="prose">${lines(settings.text)}</div>`),
  },
  {
    type: 'image',
    name: 'Image',
    group: 'Text & media',
    icon: '▨',
    description: 'One image, optional caption.',
    schema: { src: { type: 'string', label: 'Image URL', required: true, default: '' }, alt: { type: 'string', label: 'Alt text', default: '' }, caption: { type: 'string', label: 'Caption', default: '' }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, `<figure class="fig">${settings.src ? `<img src="${e(settings.src)}" alt="${e(settings.alt)}" loading="lazy" decoding="async">` : '<div class="ph">Add an image</div>'}${settings.caption ? `<figcaption>${e(settings.caption)}</figcaption>` : ''}</figure>`),
  },
  {
    type: 'image-with-text',
    name: 'Image with text',
    group: 'Text & media',
    icon: '◧',
    description: 'Image on one side, headline, text and a button on the other.',
    schema: {
      image: { type: 'string', label: 'Image URL', default: '' },
      imageSide: { type: 'string', label: 'Image side', enum: ['left', 'right'], default: 'left' },
      eyebrow: { type: 'string', label: 'Eyebrow', default: '' },
      headline: { type: 'string', label: 'Headline', required: true, default: 'A benefit, not a feature' },
      text: { type: 'string', label: 'Text', multiline: true, default: '' },
      cta: { type: 'string', label: 'Button label', default: '' },
      ctaHref: { type: 'string', label: 'Button link', default: '#offer' },
      ...COMMON,
    },
    render: (settings, _context, block) => wrap(settings, block, `<div class="iwt iwt--${e(settings.imageSide)}">
      <figure>${settings.image ? `<img src="${e(settings.image)}" alt="" loading="lazy" decoding="async">` : '<div class="ph">Image</div>'}</figure>
      <div>${settings.eyebrow ? `<div class="eyebrow">${e(settings.eyebrow)}</div>` : ''}<h2>${e(settings.headline)}</h2><div class="prose">${lines(settings.text)}</div><p>${button(settings.cta, settings.ctaHref)}</p></div></div>`),
  },
  {
    type: 'video',
    name: 'Video',
    group: 'Text & media',
    icon: '▶',
    description: 'YouTube, Vimeo or an MP4 URL. Loads on click, so it costs nothing until watched.',
    schema: { url: { type: 'string', label: 'Video URL', required: true, default: '' }, poster: { type: 'string', label: 'Poster image URL', default: '' }, caption: { type: 'string', label: 'Caption', default: '' }, ...COMMON },
    render: (settings, _context, block) => {
      const inner = videoTile(String(settings.url ?? ''), String(settings.poster ?? ''))
      return wrap(settings, block, `${inner}${settings.caption ? `<p class="micro">${e(settings.caption)}</p>` : ''}`)
    },
  },
  {
    type: 'carousel',
    name: 'Media carousel',
    group: 'Text & media',
    icon: '◫',
    description: 'A row of images that scrolls sideways. Slideshow on Shopify, carousel on Funnelish.',
    schema: { images: { type: 'string', label: 'Image URLs (one per line)', multiline: true, required: true, default: '' }, ...COMMON, width: { ...(COMMON.width as object), default: 'wide' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="carousel">${list(settings.images).map((src) => `<img src="${e(src)}" alt="" loading="lazy" decoding="async">`).join('')}</div>`),
  },
  {
    type: 'before-after',
    name: 'Before / after',
    group: 'Text & media',
    icon: '◐',
    description: 'Two images with a slider between them.',
    schema: { before: { type: 'string', label: 'Before image URL', required: true, default: '' }, after: { type: 'string', label: 'After image URL', required: true, default: '' }, beforeLabel: { type: 'string', default: 'Before' }, afterLabel: { type: 'string', default: 'After' }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, `<div class="ba" style="--pos:50%"><img src="${e(settings.before)}" alt="${e(settings.beforeLabel)}" loading="lazy"><img class="after" src="${e(settings.after)}" alt="${e(settings.afterLabel)}" loading="lazy">
      <span class="lbl l">${e(settings.beforeLabel)}</span><span class="lbl r">${e(settings.afterLabel)}</span><input type="range" min="0" max="100" value="50" aria-label="Compare"></div>`),
  },
  {
    type: 'multicolumn',
    name: 'Multicolumn',
    group: 'Text & media',
    icon: '⫼',
    description: 'One to six adjustable columns of icon, heading and text. Features, benefits, pain points. An image URL in the icon cell becomes a picture.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: '' },
      columns: { type: 'string', label: 'Columns (icon or image URL|title|text per line)', multiline: true, required: true, default: '✦|Made properly|Named materials, one maker, small runs.\n✦|Repaired for life|Post it back; we fix it.\n✦|Free returns|Thirty days, no questions.' },
      perRow: { type: 'number', label: 'Columns per row', integer: true, min: 1, max: 6, default: 3 },
      columnWidths: { type: 'string', label: 'Column widths (%)', default: '' },
      tabletPerRow: { type: 'number', label: 'Tablet columns (0 = automatic)', integer: true, min: 0, max: 6, default: 0 },
      tabletColumnWidths: { type: 'string', label: 'Tablet column widths (%)', default: '' },
      mobilePerRow: { type: 'number', label: 'Mobile columns', integer: true, min: 1, max: 6, default: 1 },
      mobileColumnWidths: { type: 'string', label: 'Mobile column widths (%)', default: '' },
      ...COMMON,
    },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="cols" style="${columnLayoutStyle(settings)}">${list(settings.columns).map((entry) => { const [glyph = '', title = '', text = ''] = entry.split('|'); return `<div class="col"><div class="ico">${icon(glyph)}</div><h3>${e(title)}</h3><p>${e(text)}</p></div>` }).join('')}</div>`),
  },
  {
    type: 'button',
    name: 'Button',
    group: 'Text & media',
    icon: '▭',
    description: 'A call to action on its own.',
    schema: { label: { type: 'string', label: 'Label', required: true, default: 'Get yours' }, href: { type: 'string', label: 'Link', default: '#offer' }, style: { type: 'string', enum: ['primary', 'ghost', 'wide'], default: 'primary' }, note: { type: 'string', label: 'Line under the button', default: '' }, ...COMMON, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<p>${button(settings.label, settings.href, settings.style)}</p>${settings.note ? `<p class="micro">${e(settings.note)}</p>` : ''}`),
  },

  /* Commerce */
  {
    type: 'buy-box',
    name: 'Product buy box',
    group: 'Commerce',
    icon: '🛒',
    description: 'A product with its options, price and add-to-cart, embedded in any page. Funnelish order form, Shopify featured product.',
    schema: {
      productId: { type: 'string', label: 'Product', required: true, default: '' },
      showImage: { type: 'boolean', label: 'Show image', default: true },
      buyNow: { type: 'boolean', label: 'Skip cart, go straight to checkout', default: true },
      eyebrow: { type: 'string', label: 'Eyebrow (a credential or the rating line; empty for none)', default: '' },
      showRating: { type: 'boolean', label: 'Show the rating from real reviews', default: true },
      bullets: { type: 'string', label: 'Check bullets (lead|text per line; the lead is bold)', multiline: true, default: '' },
      offerLabel: { type: 'string', label: 'Offer label above the tiers', default: '' },
      shipLine: { type: 'string', label: 'Stock and ship line (empty uses the delivery estimate)', default: '' },
      cta: { type: 'string', label: 'Button label (the price is added)', default: '' },
      chips: { type: 'string', label: 'Trust chips under the button (icon|text per line)', multiline: true, default: '🔒|Secure checkout\n↩|30-day money-back guarantee\n🚚|Free shipping' },
      note: { type: 'string', label: 'Line after the button (the compliance line: renewal terms, results vary)', default: '' },
      guaranteeHeadline: { type: 'string', label: 'Guarantee headline', default: '' },
      guaranteeText: { type: 'string', label: 'Guarantee text', multiline: true, default: '' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'regular' } as never,
    },
    render: (settings, context, block) => {
      const product = productFor(context, settings.productId)
      if (!product) return wrap(settings, block, '<div class="ph">Choose a product</div>')
      const cheapest = product.variants[0]
      const bundle = context.bundles.find((entry) => entry.productId === product.id)
      const reviews = context.reviews.filter((review) => review.productId === product.id)
      const average = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0
      const rating = settings.showRating && reviews.length ? `<div class="rating"><a href="#reviews">${stars(average)} ${average.toFixed(1)} / 5 · ${reviews.length} review${reviews.length === 1 ? '' : 's'}</a></div>` : ''
      const bullets = list(settings.bullets).map((entry) => { const [lead = '', text = ''] = entry.split('|'); return `<li><i>✓</i><span>${lead ? `<b>${e(lead)}</b>${text ? ' — ' : ''}` : ''}${e(text)}</span></li>` })
      const estimate = context.live?.estimates[product.id]
      const stock = context.live?.stock[product.id]
      const shipLine = settings.shipLine ? e(settings.shipLine) : estimate ? `${stock === 0 ? 'Back-ordered' : 'In stock'} · arrives ${e(estimate.from)}–${e(estimate.to)}` : ''
      const chips = list(settings.chips).map((entry) => { const [icon = '', text = ''] = entry.split('|'); return `<span><i>${e(icon)}</i>${e(text)}</span>` })
      return wrap(settings, block, `<div class="buybox-blk" id="offer">
        ${settings.showImage ? `<figure><img src="${e(product.image)}" alt="${e(product.title)}" loading="lazy"></figure>` : ''}
        <div>
          ${settings.eyebrow ? `<div class="eyebrow">${e(settings.eyebrow)}</div>` : ''}${rating}
          <h2>${e(product.title)}</h2>${product.subtitle ? `<p class="lead">${e(product.subtitle)}</p>` : ''}
          ${bullets.length ? `<ul class="checks">${bullets.join('')}</ul>` : ''}
          ${settings.offerLabel ? `<div class="offer-label">${e(settings.offerLabel)}</div>` : ''}
          <div class="price-lg" data-variant-price>${format(cheapest?.priceCents ?? product.priceCents, context.currency)}</div>
          <form method="post" action="${context.base}${settings.buyNow ? '/checkout/buy' : '/cart/add'}" class="buyform" data-currency="${e(context.currency)}" data-minor-digits="${minorDigits(context.currency)}">
            ${product.variants.length > 1 ? `<label class="opt"><span class="label">Choose</span><select name="variantId">${product.variants.map((variant) => `<option value="${e(variant.id)}" data-price="${variant.priceCents}">${e(variant.title)} — ${format(variant.priceCents, context.currency)}</option>`).join('')}</select></label>` : `<input type="hidden" name="variantId" value="${e(cheapest?.id ?? '')}">`}
            ${bundle ? bundle.html : '<input type="hidden" name="quantity" value="1">'}
            ${shipLine ? `<p class="shipline"><i class="dot" aria-hidden="true"></i>${shipLine}</p>` : ''}
            <button class="btn btn--wide" type="submit">${e(settings.cta || (settings.buyNow ? 'Buy now' : 'Add to cart'))} — <span data-total>${format(cheapest?.priceCents ?? 0, context.currency)}</span></button>
          </form>
          ${chips.length ? `<div class="badges chips">${chips.join('')}</div>` : ''}
          ${settings.note ? `<p class="micro">${e(settings.note)}</p>` : ''}
          ${settings.guaranteeHeadline || settings.guaranteeText ? `<div class="guarantee-inline"><i>⛨</i><div>${settings.guaranteeHeadline ? `<b>${e(settings.guaranteeHeadline)}</b>` : ''}${settings.guaranteeText ? `<p>${e(settings.guaranteeText)}</p>` : ''}</div></div>` : ''}
        </div></div>`)
    },
  },
  {
    type: 'featured-products',
    name: 'Featured products',
    group: 'Commerce',
    icon: '▦',
    description: 'A grid of products from the catalog.',
    schema: { headline: { type: 'string', label: 'Headline', default: 'What we make' }, count: { type: 'number', label: 'How many', integer: true, min: 1, max: 12, default: 3 }, ...COMMON },
    render: (settings, context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="grid">${context.products.slice(0, Number(settings.count)).map((product) => `<a class="card" href="${context.base}/products/${e(product.handle)}"><figure><img src="${e(product.image)}" alt="${e(product.title)}" loading="lazy"></figure><div class="body"><div class="title">${e(product.title)}</div><div class="sub">${e(product.subtitle)}</div><div class="price">${format(product.priceCents, context.currency)}</div></div></a>`).join('')}</div>`),
  },
  {
    type: 'bundle-offer',
    name: 'Bundle offer',
    group: 'Commerce',
    icon: '⧉',
    description: 'The quantity-break widget for a product: buy 1, 2, 3 with savings, badges, free shipping and a gift on the higher tiers.',
    schema: { productId: { type: 'string', label: 'Product', required: true, default: '' }, headline: { type: 'string', label: 'Headline', default: 'Bundle & save' }, ...COMMON },
    render: (settings, context, block) => {
      const product = productFor(context, settings.productId)
      const bundle = product ? context.bundles.find((entry) => entry.productId === product.id) : null
      if (!product || !bundle) return wrap(settings, block, '<div class="ph">Create a bundle for this product under Bundles, then it renders here.</div>')
      return wrap(settings, block, `<div id="offer">${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<form method="post" action="${context.base}/checkout/buy" class="buyform"><input type="hidden" name="variantId" value="${e(product.variants[0]?.id ?? '')}">${bundle.html}<button class="btn btn--wide" type="submit">Claim this offer — <span data-total>${format(product.priceCents, context.currency)}</span></button></form></div>`)
    },
  },
  {
    type: 'guarantee',
    name: 'Guarantee',
    group: 'Commerce',
    icon: '✓',
    description: 'The risk reversal, with a badge.',
    schema: { days: { type: 'number', label: 'Days', integer: true, min: 1, max: 365, default: 30 }, headline: { type: 'string', default: 'Thirty-day guarantee' }, text: { type: 'string', multiline: true, default: 'If it is not what you hoped, send it back and we refund the lot. We cover the return label.' }, note: { type: 'string', label: 'Line under it (e.g. how few people use it — only if true)', default: '' }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, `<div class="guarantee"><span class="badge">${Number(settings.days)}</span><div><strong>${e(settings.headline)}</strong><p class="micro" style="margin:.2rem 0 0">${e(settings.text)}</p></div></div>${settings.note ? `<p class="micro" style="margin:.6rem 0 0">${e(settings.note)}</p>` : ''}`),
  },
  {
    type: 'comparison',
    name: 'Comparison table',
    group: 'Commerce',
    icon: '⊞',
    description: 'Us against the usual, row by row.',
    schema: { usLabel: { type: 'string', label: 'Our column', default: '' }, themLabel: { type: 'string', label: 'Their column', default: 'The usual' }, rows: { type: 'string', label: 'Rows (label|us|them per line)', multiline: true, required: true, default: 'Materials|Named, chosen one at a time|Unspecified\nMade|Small runs, by name|Factory line\nRepairs|In-house|None\nReturns|30 days, free|Varies' }, ...COMMON },
    render: (settings, context, block) => wrap(settings, block, `<div class="tablewrap"><table class="compare"><thead><tr><th></th><th class="us">${e(settings.usLabel || context.storeName)}</th><th>${e(settings.themLabel)}</th></tr></thead><tbody>${list(settings.rows).map((entry) => { const [label = '', us = '', them = ''] = entry.split('|'); return `<tr><th>${e(label)}</th><td class="us">${e(us)}</td><td>${e(them)}</td></tr>` }).join('')}</tbody></table></div>`),
  },

  /* Social proof */
  {
    type: 'testimonials',
    name: 'Testimonials',
    group: 'Social proof',
    icon: '❝',
    description: 'Quotes you type in. For real product reviews use the review wall.',
    schema: { headline: { type: 'string', default: '' }, quotes: { type: 'string', label: 'Quotes (stars|quote|name per line)', multiline: true, required: true, default: '5|Four months of sparring and the stitching has not moved.|Marisol A.\n5|My old gloves went soft inside a year. These have not.|Dev P.' }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="reviews">${list(settings.quotes).map((entry) => { const [rating = '5', quote = '', name = ''] = entry.split('|'); return `<article class="review">${stars(Number(rating))}<p style="margin:.5rem 0 0">${e(quote)}</p><div class="who">${e(name)}</div></article>` }).join('')}</div>`),
  },
  {
    type: 'review-wall',
    name: 'Review wall',
    group: 'Social proof',
    icon: '★',
    description: 'Approved reviews from the catalog, live.',
    schema: { productId: { type: 'string', label: 'Product (empty for all)', default: '' }, count: { type: 'number', integer: true, min: 1, max: 24, default: 6 }, headline: { type: 'string', default: 'What people say' }, histogram: { type: 'boolean', label: 'Show the star breakdown', default: false }, ...COMMON },
    render: (settings, context, block) => {
      const all = context.reviews.filter((review) => !settings.productId || review.productId === settings.productId)
      const reviews = all.slice(0, Number(settings.count))
      const average = all.length ? all.reduce((sum, review) => sum + review.rating, 0) / all.length : 0
      const histogram = settings.histogram && all.length
        ? `<div class="histo">${[5, 4, 3, 2, 1].map((star) => { const n = all.filter((review) => Math.round(review.rating) === star).length; return `<div><span>${star}★</span><i><b style="width:${Math.round((n / all.length) * 100)}%"></b></i><span>${Math.round((n / all.length) * 100)}%</span></div>` }).join('')}</div>`
        : ''
      return wrap(settings, block, `<div id="reviews"></div>${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}${all.length ? `<div class="rating">${stars(average)} ${average.toFixed(1)} · ${all.length} reviews</div>` : ''}${histogram}<div class="reviews">${reviews.map((review) => `<article class="review">${stars(review.rating)}${review.title ? `<h3 style="margin:.5rem 0 .3rem">${e(review.title)}</h3>` : ''}<p style="margin:.4rem 0 0">${e(review.body)}</p><div class="who">${e(review.author)}${review.verified ? ' · verified buyer' : ''}</div></article>`).join('') || '<p class="micro">No approved reviews yet.</p>'}</div>`)
    },
  },
  {
    type: 'logos',
    name: 'As seen on',
    group: 'Social proof',
    icon: '◈',
    description: 'A strip of publication or partner names.',
    schema: { label: { type: 'string', default: 'As seen in' }, names: { type: 'string', label: 'Names (one per line)', multiline: true, required: true, default: 'The Fight Journal\nRingside Weekly\nGym Quarterly' }, ...COMMON, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="eyebrow">${e(settings.label)}</div><div class="logos">${list(settings.names).map((name) => `<span>${e(name)}</span>`).join('')}</div>`),
  },
  {
    type: 'trust-badges',
    name: 'Trust badges',
    group: 'Social proof',
    icon: '⛨',
    description: 'Secure checkout, free returns, made-in — the row under the button.',
    schema: { items: { type: 'string', label: 'Badges (icon|text per line)', multiline: true, required: true, default: '🔒|Secure checkout\n↩|Free 30-day returns\n🚚|Free shipping over $200\n✎|Repaired for life' }, ...COMMON, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="badges">${list(settings.items).map((entry) => { const [icon = '', text = ''] = entry.split('|'); return `<span><i>${e(icon)}</i>${e(text)}</span>` }).join('')}</div>`),
  },
  {
    type: 'comments',
    name: 'Comments',
    group: 'Social proof',
    icon: '💬',
    description: 'A social-style comment thread. Label it honestly; the FTC does.',
    schema: { comments: { type: 'string', label: 'Comments (name|time|text per line)', multiline: true, required: true, default: 'Priya N.|2h|Sizing runs true. 14oz for bags, 16oz for sparring.\nOwen B.|5h|Asked about a repair and got a real answer in two hours.' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="comments">${list(settings.comments).map((entry) => { const [name = '', time = '', text = ''] = entry.split('|'); return `<div class="comment"><span class="av">${e(name.slice(0, 1))}</span><div><div class="meta"><strong>${e(name)}</strong> · ${e(time)}</div><p>${e(text)}</p></div></div>` }).join('')}</div>`),
  },

  /* Conversion */
  {
    type: 'countdown',
    name: 'Countdown timer',
    group: 'Conversion',
    icon: '⏱',
    description: 'A deadline. Fixed date, or evergreen per visitor.',
    schema: { text: { type: 'string', label: 'Text', default: 'Offer ends in' }, mode: { type: 'string', enum: ['evergreen', 'fixed'], default: 'evergreen' }, minutes: { type: 'number', label: 'Evergreen minutes', integer: true, min: 1, max: 10080, default: 15 }, endsAt: { type: 'string', label: 'Fixed end (ISO date)', default: '' }, ...COMMON, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="countdown" data-mode="${e(settings.mode)}" data-minutes="${Number(settings.minutes)}" data-ends="${e(settings.endsAt)}" data-key="cd-${e(block.id)}"><span class="lbl">${e(settings.text)}</span><span class="clock"><b data-h>00</b>:<b data-m>00</b>:<b data-s>00</b></span></div>`),
  },
  {
    type: 'progress-bar',
    name: 'Progress bar',
    group: 'Conversion',
    icon: '▰',
    description: '"73% claimed", "stock nearly gone": momentum you can see.',
    schema: { label: { type: 'string', default: '73% of this batch claimed' }, percent: { type: 'number', integer: true, min: 1, max: 100, default: 73 }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="progress"><div class="meta">${e(settings.label)}</div><div class="track"><div class="fill" style="width:${Number(settings.percent)}%"></div></div></div>`),
  },
  {
    type: 'sticky-cta',
    name: 'Sticky button',
    group: 'Conversion',
    icon: '⤓',
    description: 'A bar pinned to the bottom of the screen once the reader scrolls past the first button.',
    schema: { label: { type: 'string', required: true, default: 'Claim the offer' }, href: { type: 'string', default: '#offer' }, note: { type: 'string', default: '' }, productId: { type: 'string', label: 'Product (shows its image, name and price in the bar)', default: '' } },
    render: (settings, context, block) => {
      const product = settings.productId ? productFor(context, settings.productId) : null
      const left = product
        ? `<div class="sticky-product">${product.image ? `<img src="${e(product.image)}" alt="" loading="lazy">` : ''}<div><b>${e(product.title)}</b><span class="micro">${settings.note ? e(settings.note) : format(product.priceCents, context.currency)}</span></div></div>`
        : `<div>${settings.note ? `<div class="p">${e(settings.note)}</div>` : ''}</div>`
      // The shipped default is an anchor on this page; when the page is a step
      // in a funnel, the next step is where the button belongs.
      const href = settings.href === '#offer' && context.funnelNext ? context.funnelNext : (settings.href as string)
      return `<div class="stickybar" data-block="${e(block.id)}" data-sticky>${left}<a class="btn" href="${e(href)}">${e(settings.label)}${product ? ` — ${format(product.priceCents, context.currency)}` : ''}</a></div>`
    },
  },
  {
    type: 'offer-box',
    name: 'Offer box',
    group: 'Conversion',
    icon: '◘',
    description: 'The boxed offer: what they get, what it costs, the button. Points at the buy box or the checkout.',
    schema: { headline: { type: 'string', required: true, default: 'Today only: 15% off + free shipping' }, bullets: { type: 'string', label: 'What they get (one per line)', multiline: true, default: 'Free shipping\n30-day returns\nRepaired for life' }, price: { type: 'string', label: 'Price line', default: '' }, cta: { type: 'string', default: 'Get the offer' }, href: { type: 'string', default: '#offer' }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, `<div class="offer"><h2>${e(settings.headline)}</h2><ul>${list(settings.bullets).map((line) => `<li>${e(line)}</li>`).join('')}</ul>${settings.price ? `<div class="price-lg">${e(settings.price)}</div>` : ''}<p>${button(settings.cta, settings.href, 'wide')}</p></div>`),
  },
  {
    type: 'faq',
    name: 'Collapsible content',
    group: 'Conversion',
    icon: '⌄',
    description: 'Questions that open. Shopify calls it collapsible content.',
    schema: { headline: { type: 'string', default: 'Questions' }, items: { type: 'string', label: 'Items (question|answer per line)', multiline: true, required: true, default: 'When will it ship?|Built to order; fourteen days.\nWhat if it is not right?|Send it back within thirty days.' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}${list(settings.items).map((entry, index) => { const [q = '', a = ''] = entry.split('|'); return `<details class="faq" ${index === 0 ? 'open' : ''}><summary>${e(q)}</summary><p>${e(a)}</p></details>` }).join('')}`),
  },

  /* Advertorial */
  {
    type: 'publication-bar',
    name: 'Publication bar',
    group: 'Advertorial',
    icon: '▔',
    description: 'The masthead an advertorial sits under, with the "advertisement" label the FTC expects.',
    schema: { name: { type: 'string', required: true, default: 'The Fight Journal' }, section: { type: 'string', default: 'Gear' }, label: { type: 'string', label: 'Disclosure label', default: 'Advertisement' } },
    render: (settings, _context, block) => `<div class="pubbar" data-block="${e(block.id)}"><div class="wrap"><span class="pub">${e(settings.name)}</span><span class="sec">${e(settings.section)}</span><span class="adv">${e(settings.label)}</span></div></div>`,
  },
  {
    type: 'byline',
    name: 'Byline',
    group: 'Advertorial',
    icon: '✎',
    description: 'Author, date, read time.',
    schema: { author: { type: 'string', required: true, default: 'By a staff writer' }, date: { type: 'string', default: '' }, readTime: { type: 'string', default: '4 min read' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never, padding: { ...(COMMON.padding as object), default: 'small' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="byline"><span class="av">${e(String(settings.author).replace(/^By /i, '').slice(0, 1))}</span><div><strong>${e(settings.author)}</strong><div class="micro">${e(settings.date || new Date().toISOString().slice(0, 10))} · ${e(settings.readTime)}</div></div></div>`),
  },
  {
    type: 'numbered-reason',
    name: 'Numbered reason',
    group: 'Advertorial',
    icon: '①',
    description: 'One item of a listicle: number, heading, image, text.',
    schema: { number: { type: 'number', integer: true, min: 1, max: 99, default: 1 }, headline: { type: 'string', required: true, default: 'The reason' }, image: { type: 'string', label: 'Image URL', default: '' }, text: { type: 'string', multiline: true, default: '' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="reason"><div class="num">${Number(settings.number)}</div><h2>${e(settings.headline)}</h2>${settings.image ? `<figure class="fig"><img src="${e(settings.image)}" alt="" loading="lazy" decoding="async"></figure>` : ''}<div class="prose">${lines(settings.text)}</div></div>`),
  },
  {
    type: 'pull-quote',
    name: 'Pull quote',
    group: 'Advertorial',
    icon: '“',
    description: 'A big quote between paragraphs.',
    schema: { quote: { type: 'string', required: true, default: 'I stopped thinking about my gear. That is the whole point.' }, who: { type: 'string', default: '' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<blockquote class="pull">${e(settings.quote)}${settings.who ? `<cite>${e(settings.who)}</cite>` : ''}</blockquote>`),
  },
  {
    type: 'disclaimer',
    name: 'Disclaimer',
    group: 'Advertorial',
    icon: '§',
    description: 'The small print. Required on advertorials.',
    schema: { text: { type: 'string', multiline: true, required: true, default: 'This is an advertisement. The page is sponsored by the brand featured; results described are individual experiences and not a guarantee.' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<p class="micro disclaimer">${e(settings.text)}</p>`),
  },
  {
    type: 'share-bar',
    name: 'Share bar',
    group: 'Advertorial',
    icon: '⇪',
    description: 'Share links for the article.',
    schema: { text: { type: 'string', default: 'Share this' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never, padding: { ...(COMMON.padding as object), default: 'small' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="share"><span class="eyebrow">${e(settings.text)}</span><a href="#" data-share="facebook">Facebook</a><a href="#" data-share="x">X</a><a href="#" data-share="copy">Copy link</a></div>`),
  },

  /* Checkout — the pieces of the one-page checkout, so a checkout can be laid out like any other page */
  {
    type: 'checkout-form',
    name: 'Checkout form',
    group: 'Checkout',
    icon: '💳',
    description: 'The real checkout: express wallets, contact, delivery, shipping method, the order bump, payment and the pay button. With the summary beside it, or on its own so the summary can be placed as a block.',
    schema: {
      layout: { type: 'string', label: 'Layout', enum: ['two-column', 'stacked'], default: 'two-column', help: 'Two-column puts the order summary beside the form, the way Shopify does. Stacked leaves it out so an Order summary block can go anywhere.' },
      summaryHeadline: { type: 'string', label: 'Summary heading', default: 'Your order' },
      showHeader: { type: 'boolean', label: 'Show brand and cart header', default: true },
      showPolicies: { type: 'boolean', label: 'Show policy links', default: true },
      showExpress: { type: 'boolean', label: 'Show express wallets first', default: true },
      showBump: { type: 'boolean', label: 'Show the order bump before payment', default: true },
      buttonLabel: { type: 'string', label: 'Pay button', default: 'Complete order' },
      note: { type: 'string', label: 'Line under the button', default: '' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'wide' } as never,
    },
    render: (settings, context, block) => {
      const checkout = context.checkout
      if (!checkout) return wrap(settings, block, '<div class="ph">The checkout form renders here with the visitor\'s cart: contact, delivery, shipping, the bump, payment. Preview this page to see it filled with a sample order.</div>')
      const total = format(checkout.totalCents, context.currency)
      const two = settings.layout === 'two-column'
      const form = checkout.formHtml.replace('<!--bump-->', settings.showBump ? checkout.bumpHtml : '').replace('<!--pay-label-->', e(settings.buttonLabel || 'Pay now'))
      return wrap(settings, block, `${settings.showHeader ? checkout.headerHtml||'' : ''}<div class="checkout checkout--blk${two ? '' : ' checkout--stacked'}" data-checkout aria-label="${checkout.sample ? 'Sample order' : 'Checkout'}">
        <div class="co-main">
          ${checkout.error ? `<div class="notice" style="border-left-color:#b3261e;margin-bottom:1.2rem">${e(checkout.error)}</div>` : ''}
          ${two ? `<details class="co-summary-mobile"><summary><span>Show order summary</span><b>${total}</b></summary>${checkout.summaryHtml}</details>` : ''}
          ${settings.showExpress ? checkout.expressHtml : ''}
          ${form}
          ${settings.showPolicies ? checkout.footerHtml||'' : ''}
          ${settings.note ? `<p class="micro center">${e(settings.note)}</p>` : ''}
        </div>
        ${two ? `<aside class="co-side">${settings.summaryHeadline ? `<h2 class="co-h">${e(settings.summaryHeadline)}</h2>` : ''}${checkout.summaryHtml}</aside>` : ''}</div>`)
    },
  },
  {
    type: 'order-summary',
    name: 'Order summary',
    group: 'Checkout',
    icon: '☰',
    description: 'What is in the order, the discount code and the totals, as its own block. Pair it with a stacked checkout form.',
    schema: { headline: { type: 'string', label: 'Heading', default: 'Your order' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never, padding: { ...(COMMON.padding as object), default: 'small' } as never },
    render: (settings, context, block) => {
      const checkout = context.checkout
      if (!checkout) return wrap(settings, block, '<div class="ph">The order summary — lines, discount code, totals — renders here on the checkout.</div>')
      return wrap(settings, block, `<div class="co-summary-blk">${settings.headline ? `<h2 class="co-h">${e(settings.headline)}</h2>` : ''}${checkout.summaryHtml}</div>`)
    },
  },
  {
    type: 'order-bump',
    name: 'Order bump',
    group: 'Checkout',
    icon: '☑',
    description: 'The one-checkbox add-on from the funnel (shipping protection by default), placed wherever it converts best. Turn off the bump inside the checkout form if you use this.',
    schema: { eyebrow: { type: 'string', label: 'Eyebrow', default: 'One-time offer' }, headline: { type: 'string', label: 'Headline', default: 'Wait — add this to your order?' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never, padding: { ...(COMMON.padding as object), default: 'small' } as never },
    render: (settings, context, block) => {
      const checkout = context.checkout
      if (!checkout) return wrap(settings, block, '<div class="ph">The order bump from the funnel renders here on the checkout.</div>')
      if (!checkout.bumpHtml) return `<!-- data-block="${e(block.id)}" order-bump: the funnel has no bump -->`
      return wrap(settings, block, `<div class="bump-blk">${settings.eyebrow ? `<div class="eyebrow">${e(settings.eyebrow)}</div>` : ''}${settings.headline ? `<h2 class="co-h">${e(settings.headline)}</h2>` : ''}${checkout.bumpHtml}</div>`)
    },
  },
  {
    type: 'checkout-steps',
    name: 'Checkout steps',
    group: 'Checkout',
    icon: '①②③',
    description: '"Cart → Information → Payment", with the current step lit. The progress row every funnel checkout has.',
    schema: { steps: { type: 'string', label: 'Steps (one per line)', multiline: true, required: true, default: 'Cart\nInformation\nPayment' }, current: { type: 'number', label: 'Current step', integer: true, min: 1, max: 9, default: 2 }, ...COMMON, padding: { ...(COMMON.padding as object), default: 'small' } as never, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, _context, block) => {
      const current = Number(settings.current)
      return wrap(settings, block, `<ol class="costeps">${list(settings.steps).map((step, index) => `<li class="${index + 1 < current ? 'done' : index + 1 === current ? 'now' : ''}" ${index + 1 === current ? 'aria-current="step"' : ''}><span>${index + 1 < current ? '✓' : index + 1}</span>${e(step)}</li>`).join('')}</ol>`)
    },
  },

  /* Forms */
  {
    type: 'email-signup',
    name: 'Email signup',
    group: 'Forms',
    icon: '✉',
    description: 'Collect an email. Lands in customers with marketing on.',
    schema: { headline: { type: 'string', default: 'Get the next drop first' }, text: { type: 'string', default: '' }, button: { type: 'string', default: 'Join' }, ...COMMON, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}${settings.text ? `<p class="lead">${e(settings.text)}</p>` : ''}<form method="post" action="${context.base}/subscribe" class="signup"><input name="email" type="email" required placeholder="you@example.com" aria-label="Email"><button class="btn" type="submit">${e(settings.button)}</button></form>`),
  },
  {
    type: 'contact-form',
    name: 'Contact form',
    group: 'Forms',
    icon: '✍',
    description: 'Name, email, message.',
    schema: { headline: { type: 'string', default: 'Ask us anything' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<form method="post" action="${context.base}/contact" class="contact"><div class="two"><div class="field"><label>Name</label><input name="name" required></div><div class="field"><label>Email</label><input name="email" type="email" required></div></div><div class="field"><label>Message</label><textarea name="message" rows="4" required></textarea></div><button class="btn" type="submit">Send</button></form>`),
  },

  /* Dropshipping conversion set */
  {
    type: 'recent-sales',
    name: 'Recent sales popups',
    group: 'Conversion',
    icon: '◉',
    description: '"Marisol from Mexico City bought…" — from real orders only. Shows nothing until there are some.',
    schema: { delaySeconds: { type: 'number', integer: true, min: 3, max: 120, default: 8 }, everySeconds: { type: 'number', integer: true, min: 5, max: 300, default: 25 }, position: { type: 'string', enum: ['bottom-left', 'bottom-right'], default: 'bottom-left' } },
    render: (settings, context, block) => {
      const purchases = context.live?.purchases ?? []
      if (!purchases.length) return `<!-- data-block="${e(block.id)}" recent-sales: no orders yet -->`
      return `<div class="salespop salespop--${e(settings.position)}" data-block="${e(block.id)}" data-delay="${Number(settings.delaySeconds)}" data-every="${Number(settings.everySeconds)}" data-items='${e(JSON.stringify(purchases.slice(0, 10)))}' hidden><img alt=""><div><b></b><span></span><small></small></div></div>`
    },
  },
  {
    type: 'live-viewers',
    name: 'Live viewers',
    group: 'Conversion',
    icon: '👁',
    description: '"14 people are looking at this right now" — real sessions in the last 30 minutes.',
    schema: { productId: { type: 'string', label: 'Product', required: true, default: '' }, minimum: { type: 'number', label: 'Hide below', integer: true, min: 1, default: 3 }, ...COMMON, padding: { ...(COMMON.padding as object), default: 'none' } as never },
    render: (settings, context, block) => {
      const product = productFor(context, settings.productId)
      const count = product ? (context.live?.viewers[product.id] ?? 0) : 0
      if (count < Number(settings.minimum)) return `<!-- data-block="${e(block.id)}" live-viewers: ${count} -->`
      return wrap(settings, block, `<div class="viewers"><i></i> ${count} people are looking at this right now</div>`)
    },
  },
  {
    type: 'stock-scarcity',
    name: 'Stock scarcity',
    group: 'Conversion',
    icon: '▮',
    description: '"Only 7 left" with a bar — from real inventory.',
    schema: { productId: { type: 'string', label: 'Product', required: true, default: '' }, threshold: { type: 'number', label: 'Show when at or below', integer: true, min: 1, default: 15 }, ...COMMON, padding: { ...(COMMON.padding as object), default: 'none' } as never },
    render: (settings, context, block) => {
      const product = productFor(context, settings.productId)
      const stock = product ? (context.live?.stock[product.id] ?? 0) : 0
      if (!product || stock <= 0 || stock > Number(settings.threshold)) return `<!-- data-block="${e(block.id)}" stock-scarcity: ${stock} -->`
      const percent = Math.max(6, Math.round((stock / Number(settings.threshold)) * 100))
      return wrap(settings, block, `<div class="scarcity"><div class="meta">Only <b>${stock}</b> left in this batch</div><div class="track"><div class="fill" style="width:${percent}%"></div></div></div>`)
    },
  },
  {
    type: 'delivery-estimate',
    name: 'Delivery estimate',
    group: 'Conversion',
    icon: '🚚',
    description: '"Order in the next 3h to have it by Sep 12–16" — from the supplier lead times.',
    schema: { productId: { type: 'string', label: 'Product', required: true, default: '' }, cutoffHour: { type: 'number', label: 'Cut-off hour (24h)', integer: true, min: 0, max: 23, default: 15 }, ...COMMON, padding: { ...(COMMON.padding as object), default: 'none' } as never },
    render: (settings, context, block) => {
      const product = productFor(context, settings.productId)
      const estimate = product ? context.live?.estimates[product.id] : null
      if (!estimate) return `<!-- data-block="${e(block.id)}" delivery-estimate -->`
      return wrap(settings, block, `<div class="edd" data-cutoff="${Number(settings.cutoffHour)}"><span class="ico">🚚</span><div>Order <b data-cutoff-text>today</b> for delivery by <b>${e(estimate.from)} – ${e(estimate.to)}</b></div></div>`)
    },
  },
  {
    type: 'free-shipping-bar',
    name: 'Free shipping bar',
    group: 'Conversion',
    icon: '▬',
    description: 'How far the cart is from free shipping. Sits at the top like an announcement.',
    schema: { thresholdCents: { type: 'number', label: 'Threshold (minor units)', integer: true, min: 0, default: 20000 }, text: { type: 'string', default: 'Free shipping on orders over {threshold}' } },
    render: (settings, context, block) => `<div class="shipbar" data-block="${e(block.id)}" data-threshold="${Number(settings.thresholdCents)}" data-currency="${e(context.currency)}"><span data-text>${e(String(settings.text).replace('{threshold}', format(Number(settings.thresholdCents), context.currency)))}</span><i class="track"><i class="fill" style="width:0"></i></i></div>`,
  },
  {
    type: 'payment-icons',
    name: 'Payment icons',
    group: 'Social proof',
    icon: '💳',
    description: 'The row of card and wallet marks that says "this is a real shop".',
    schema: { methods: { type: 'string', label: 'Methods (one per line)', multiline: true, default: 'VISA\nMastercard\nAMEX\nApple Pay\nGoogle Pay\nLink\nKlarna' }, ...COMMON, padding: { ...(COMMON.padding as object), default: 'small' } as never, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="payicons">${list(settings.methods).map((method) => `<i>${e(method)}</i>`).join('')}</div>`),
  },
  {
    type: 'size-chart',
    name: 'Size chart',
    group: 'Commerce',
    icon: '📏',
    description: 'A measurements table, in a collapsible so it does not eat the page.',
    schema: { title: { type: 'string', default: 'Size guide' }, rows: { type: 'string', label: 'Rows (first line is the header; cells separated by |)', multiline: true, required: true, default: 'Size|Chest|Waist\nS|86–91|71–76\nM|91–97|76–81\nL|97–102|81–86\nXL|102–107|86–91' }, note: { type: 'string', default: 'Measurements in cm. Between sizes? Size up.' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => {
      const [header = '', ...body] = list(settings.rows)
      return wrap(settings, block, `<details class="sizechart"><summary>${e(settings.title)}</summary><div class="tablewrap"><table class="compare"><thead><tr>${header.split('|').map((cell) => `<th>${e(cell.trim())}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.split('|').map((cell, index) => index === 0 ? `<th>${e(cell.trim())}</th>` : `<td>${e(cell.trim())}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${settings.note ? `<p class="micro">${e(settings.note)}</p>` : ''}</details>`)
    },
  },
  {
    type: 'ugc-gallery',
    name: 'Customer photos',
    group: 'Social proof',
    icon: '▦',
    description: 'A grid of photos from reviews. Real ones; nothing until there are some.',
    schema: { productId: { type: 'string', label: 'Product (empty for all)', default: '' }, headline: { type: 'string', default: 'From customers' }, count: { type: 'number', integer: true, min: 2, max: 24, default: 8 }, ...COMMON },
    render: (settings, context, block) => {
      const photos = context.reviews.filter((review) => (!settings.productId || review.productId === settings.productId) && review.media?.length).flatMap((review) => (review.media ?? []).map((url) => ({ url, author: review.author, body: review.body }))).slice(0, Number(settings.count))
      if (!photos.length) return `<!-- data-block="${e(block.id)}" ugc-gallery: no photos yet -->`
      return wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="ugc">${photos.map((photo) => `<figure><img src="${e(photo.url)}" alt="${e(photo.body.slice(0, 80))}" loading="lazy"><figcaption>${e(photo.author)}</figcaption></figure>`).join('')}</div>`)
    },
  },
  {
    type: 'product-qa',
    name: 'Questions & answers',
    group: 'Social proof',
    icon: '?',
    description: 'Answered customer questions, and a form to ask one.',
    schema: { productId: { type: 'string', label: 'Product', required: true, default: '' }, headline: { type: 'string', default: 'Questions people asked' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, context, block) => {
      const product = productFor(context, settings.productId)
      const questions = (context.live?.questions ?? []).filter((entry) => product && entry.productId === product.id && entry.answer)
      return wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}${questions.map((entry) => `<details class="faq"><summary>${e(entry.question)}</summary><p>${e(entry.answer)}${entry.asker ? ` <span class="micro">— asked by ${e(entry.asker)}</span>` : ''}</p></details>`).join('') || '<p class="micro">No questions yet — ask the first.</p>'}
        ${product ? `<form method="post" action="${context.base}/products/${e(product.handle)}/questions" class="qa-form"><div class="two"><input name="asker" placeholder="Your name"><input name="email" type="email" placeholder="Email (for the answer)"></div><textarea name="question" rows="2" required placeholder="Ask a question about ${e(product.title)}"></textarea><button class="btn btn--ghost" type="submit">Ask</button></form>` : ''}`)
    },
  },

  /* What the reference pages taught (docs/knowledge/reference-pages.md) */
  {
    type: 'benefit-bullets',
    name: 'Check bullets',
    group: 'Text & media',
    icon: '✓',
    description: 'Bold-lead check bullets: the buy-box benefits, or the "get your life back" list. Outcome-negations for cold traffic ("No more…").',
    schema: { headline: { type: 'string', default: '' }, items: { type: 'string', label: 'Items (lead|text per line; the lead is bold)', multiline: true, required: true, default: 'Holds firm at hour 8|never flattens\nWorks on any seat|car, office chair, kitchen stool\nNo pills, no stretches|and no $1,200 chair' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<ul class="checks">${list(settings.items).map((entry) => { const [lead = '', text = ''] = entry.split('|'); return `<li><i>✓</i><span>${lead ? `<b>${e(lead)}</b>${text ? ' — ' : ''}` : ''}${e(text)}</span></li>` }).join('')}</ul>`),
  },
  {
    type: 'image-grid',
    name: 'Image cards',
    group: 'Text & media',
    icon: '▦',
    description: 'Two to four image cards with a caption each: the "before" micro-scenes ("By mid-afternoon at your desk, sitting turns to a deep ache."), or the "goes everywhere" lifestyle tiles.',
    schema: { headline: { type: 'string', default: '' }, sub: { type: 'string', multiline: true, default: '' }, items: { type: 'string', label: 'Cards (image URL|caption per line)', multiline: true, required: true, default: '' }, perRow: { type: 'number', integer: true, min: 2, max: 4, default: 4 }, bridge: { type: 'string', label: 'Line after the cards (the reframe)', default: '' }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}${settings.sub ? `<p class="lead">${e(settings.sub)}</p>` : ''}<div class="cols scenes" style="--per:${Number(settings.perRow)}">${list(settings.items).map((entry) => { const [src = '', caption = ''] = entry.split('|'); return `<figure class="scene">${src ? `<img src="${e(src)}" alt="${e(caption)}" loading="lazy" decoding="async">` : '<div class="ph">Image</div>'}${caption ? `<figcaption>${e(caption)}</figcaption>` : ''}</figure>` }).join('') || '<div class="ph">Add cards: image URL|caption</div>'}</div>${settings.bridge ? `<p class="bridge">${e(settings.bridge)}</p>` : ''}`),
  },
  {
    type: 'alternatives',
    name: 'Instead of…',
    group: 'Text & media',
    icon: '⇄',
    description: 'The failed alternatives, each dismissed in two sentences that end on a feeling: "Instead of fish oil: the burps, the giant capsules."',
    schema: { headline: { type: 'string', default: 'Why the usual fixes keep failing' }, items: { type: 'string', label: 'Alternatives (name|why it fails per line)', multiline: true, required: true, default: 'The $1,200 chair|Built for a showroom, not a human tailbone.\nPain pills|Dull the ache, leave you foggy, never touch the cause.\nPhysical therapy|Helped for an hour; could not touch the eight hours a day in the seat.' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<dl class="alts">${list(settings.items).map((entry) => { const [name = '', why = ''] = entry.split('|'); return `<div><dt>Instead of ${e(name)}:</dt><dd>${e(why)}</dd></div>` }).join('')}</dl>`),
  },
  {
    type: 'included',
    name: 'What\'s included',
    group: 'Commerce',
    icon: '📦',
    description: 'The gift stack next to the tiers: each free item with its value, then "N free gifts included". Also the "inside the box" list.',
    schema: { headline: { type: 'string', default: 'What\'s included' }, items: { type: 'string', label: 'Items (item|value|image URL per line; a value marks it as a free gift)', multiline: true, required: true, default: 'The product||\n2 replacement filters|$19.98|\nThe 5-year warranty|Free|' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => {
      const items = list(settings.items).map((entry) => { const [item = '', value = '', src = ''] = entry.split('|'); return { item, value, src } })
      const gifts = items.filter((entry) => entry.value).length
      return wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<ul class="included">${items.map((entry) => `<li>${entry.src ? `<img src="${e(entry.src)}" alt="" loading="lazy">` : '<i>📦</i>'}<span>${e(entry.item)}</span>${entry.value ? `<em>${/free/i.test(entry.value) ? '' : `<s>${e(entry.value)}</s> `}FREE</em>` : ''}</li>`).join('')}</ul>${gifts ? `<p class="micro"><b>${gifts} free gift${gifts === 1 ? '' : 's'} included</b></p>` : ''}`)
    },
  },
  {
    type: 'press-quotes',
    name: 'Featured in',
    group: 'Social proof',
    icon: '“',
    description: 'Pull-quotes from publications, each with its source. Only real mentions; for names alone use "As seen on".',
    schema: { label: { type: 'string', default: 'Featured in' }, items: { type: 'string', label: 'Quotes (quote|source per line)', multiline: true, required: true, default: '' }, ...COMMON, align: { ...(COMMON.align as object), default: 'center' } as never },
    render: (settings, _context, block) => wrap(settings, block, `<div class="eyebrow">${e(settings.label)}</div><div class="press">${list(settings.items).map((entry) => { const [quote = '', source = ''] = entry.split('|'); return `<blockquote><p>“${e(quote)}”</p><cite>${e(source)}</cite></blockquote>` }).join('') || '<div class="ph">Add quotes: quote|source</div>'}</div>`),
  },
  {
    type: 'ingredients',
    name: 'Ingredients',
    group: 'Text & media',
    icon: '🌿',
    description: 'Every ingredient or material with what it does — all of them, not a chosen few. Also the materials and specs of a device.',
    schema: { headline: { type: 'string', default: 'What is in it' }, lead: { type: 'string', multiline: true, default: '' }, items: { type: 'string', label: 'Items (name|what it does|image URL per line)', multiline: true, required: true, default: '' }, perRow: { type: 'number', integer: true, min: 2, max: 4, default: 3 }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}${settings.lead ? `<p class="lead">${e(settings.lead)}</p>` : ''}<div class="cols ingredients" style="--per:${Number(settings.perRow)}">${list(settings.items).map((entry) => { const [name = '', what = '', src = ''] = entry.split('|'); return `<div class="col">${src ? `<img src="${e(src)}" alt="" loading="lazy">` : ''}<h3>${e(name)}</h3><p>${e(what)}</p></div>` }).join('') || '<div class="ph">Add items: name|what it does</div>'}</div>`),
  },
  {
    type: 'audience',
    name: 'Built for',
    group: 'Text & media',
    icon: '⌂',
    description: 'The people it is for, one line each, so cold traffic finds itself: "Long-haul drivers", "Desk workers", "Postpartum and seniors".',
    schema: { headline: { type: 'string', default: 'Built for every seat that hurts you' }, items: { type: 'string', label: 'Personas (who|the line for them per line)', multiline: true, required: true, default: 'Long-haul drivers|Hours behind the wheel without the tailbone counting the miles.\nDesk workers|Make it to 5 p.m. without the lower-back lockup.\nPostpartum, post-surgery and seniors|Gentler than any chair, on any chair.' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<dl class="alts audience">${list(settings.items).map((entry) => { const [who = '', line = ''] = entry.split('|'); return `<div><dt>${e(who)}</dt><dd>${e(line)}</dd></div>` }).join('')}</dl>`),
  },
  /* From the reference pages: the parts a Checkout Champ sales page, a GemPages product page and a science page have that the Shopify set does not */
  {
    type: 'rating-strip',
    name: 'Rating line',
    group: 'Social proof',
    icon: '★',
    description: '"Rated 4.8/5 by 1,204 verified buyers" under the headline — from approved reviews only. Shows nothing below the minimum.',
    schema: {
      productId: { type: 'string', label: 'Product (empty for all)', default: '' },
      text: { type: 'string', label: 'Text ({rating} and {count} are filled in)', default: 'Rated {rating}/5 by {count}+ verified buyers' },
      minimum: { type: 'number', label: 'Hide below this many reviews', integer: true, min: 1, default: 3 },
      href: { type: 'string', label: 'Link', default: '#reviews' },
      ...COMMON,
      padding: { ...(COMMON.padding as object), default: 'none' } as never,
      align: { ...(COMMON.align as object), default: 'center' } as never,
    },
    render: (settings, context, block) => {
      const reviews = context.reviews.filter((review) => !settings.productId || review.productId === settings.productId)
      if (reviews.length < Number(settings.minimum)) return `<!-- data-block="${e(block.id)}" rating-strip: ${reviews.length} reviews -->`
      const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length
      const text = String(settings.text).replace('{rating}', average.toFixed(1)).replace('{count}', String(reviews.length))
      return wrap(settings, block, `<a class="ratingline" href="${e(settings.href || '#reviews')}">${stars(average)} <span>${e(text)}</span></a>`)
    },
  },
  {
    type: 'stats',
    name: 'Big numbers',
    group: 'Social proof',
    icon: '%',
    description: 'Survey results, counts, savings: three or four numbers with a caption each, and the line that says where they came from. Only numbers you can stand behind.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: '' },
      items: { type: 'string', label: 'Numbers (number|caption per line)', multiline: true, required: true, default: '76%|Said their hands felt fresher after a session\n14 days|Until the leather has moulded to your hand\n3 years|Of sparring before a restitch' },
      source: { type: 'string', label: 'Where the numbers come from', default: '' },
      perRow: { type: 'number', label: 'Per row', integer: true, min: 2, max: 4, default: 3 },
      ...COMMON,
      align: { ...(COMMON.align as object), default: 'center' } as never,
    },
    render: (settings, _context, block) => !String(settings.source ?? '').trim()
      ? wrap(settings, block, '<div class="ph">Big numbers need a source line (who was asked, when, how many) before they render: a number without a source is an invented one.</div>')
      : wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="stats" style="--per:${Number(settings.perRow)}">${list(settings.items).map((entry) => { const [number = '', caption = ''] = entry.split('|'); return `<div class="stat"><b>${e(number.trim())}</b><span>${e(caption.trim())}</span></div>` }).join('')}</div>${settings.source ? `<p class="micro">${e(settings.source)}</p>` : ''}`),
  },
  {
    type: 'timeline',
    name: 'Results timeline',
    group: 'Text & media',
    icon: '⟶',
    description: 'What to expect and when: week 1–2, week 3–4, month 3. Or hour by hour. The block every supplement and relief page has.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: 'What to expect' },
      steps: { type: 'string', label: 'Steps (when|title|text per line)', multiline: true, required: true, default: 'Week 1|Break-in|Stiff at first; wrap tight and work the bag.\nWeek 2–3|Moulded|The padding takes the shape of your fist.\nMonth 3+|Settled|Nothing moves. Check the laces monthly.' },
      note: { type: 'string', label: 'Line under it', default: '' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'narrow' } as never,
    },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<ol class="tl">${list(settings.steps).map((entry) => { const [when = '', title = '', text = ''] = entry.split('|'); return `<li><span class="when">${e(when.trim())}</span><div><strong>${e(title.trim())}</strong><p>${e(text.trim())}</p></div></li>` }).join('')}</ol>${settings.note ? `<p class="micro">${e(settings.note)}</p>` : ''}`),
  },
  {
    type: 'how-it-works',
    name: 'Steps',
    group: 'Text & media',
    icon: '①',
    description: 'Three numbered steps with a picture each: charge it, lay it down, relax. How to use it, how it is made, how to set it up.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: 'How it works' },
      steps: { type: 'string', label: 'Steps (title|text|image URL per line)', multiline: true, required: true, default: 'Wrap|Wrap your hands the way you always do.|\nLace|Pull the laces from the wrist up.|\nGo|Twelve rounds, no adjusting.|' },
      ...COMMON,
      align: { ...(COMMON.align as object), default: 'center' } as never,
    },
    render: (settings, _context, block) => {
      const steps = list(settings.steps)
      return wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="hiw" style="--per:${Math.min(4, Math.max(2, steps.length))}">${steps.map((entry, index) => { const [title = '', text = '', image = ''] = entry.split('|'); return `<div class="hiw-step">${image.trim() ? `<img src="${e(image.trim())}" alt="" loading="lazy">` : ''}<span class="num">${index + 1}</span><h3>${e(title.trim())}</h3><p>${e(text.trim())}</p></div>` }).join('')}</div>`)
    },
  },
  {
    type: 'value-stack',
    name: 'Value stack',
    group: 'Conversion',
    icon: 'Σ',
    description: '"Act now and you get": each thing with its value, the total, the price today, the button. The Checkout Champ offer block.',
    schema: {
      eyebrow: { type: 'string', label: 'Eyebrow', default: 'Special offer' },
      headline: { type: 'string', label: 'Headline', default: 'Act now and you get' },
      items: { type: 'string', label: 'What they get (item|value per line)', multiline: true, required: true, default: 'The gloves, built to order|$340\nRepairs for life|Included\nPriority shipping|$24\nThe wrap-and-lace guide|$19' },
      totalLabel: { type: 'string', label: 'Total label', default: 'Total value' },
      total: { type: 'string', label: 'Total', default: '$383' },
      priceLabel: { type: 'string', label: 'Price label', default: 'Today only' },
      price: { type: 'string', label: 'Price', default: '$289' },
      cta: { type: 'string', label: 'Button', default: 'Claim this offer' },
      href: { type: 'string', label: 'Button link', default: '#offer' },
      note: { type: 'string', label: 'Line under the button', default: '' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'narrow' } as never,
    },
    render: (settings, _context, block) => wrap(settings, block, `<div class="vstack">${settings.eyebrow ? `<div class="eyebrow">${e(settings.eyebrow)}</div>` : ''}<h2>${e(settings.headline)}</h2><ul>${list(settings.items).map((entry) => { const [item = '', value = ''] = entry.split('|'); return `<li><span>✓ ${e(item.trim())}</span><b>${e(value.trim())}</b></li>` }).join('')}</ul>
      ${settings.total ? `<div class="vtotal"><span>${e(settings.totalLabel)}</span><s>${e(settings.total)}</s></div>` : ''}${settings.price ? `<div class="vprice"><span>${e(settings.priceLabel)}</span><b>${e(settings.price)}</b></div>` : ''}<p>${button(settings.cta, settings.href, 'wide')}</p>${settings.note ? `<p class="micro">${e(settings.note)}</p>` : ''}</div>`),
  },
  {
    type: 'expert-quote',
    name: 'Expert quotes',
    group: 'Social proof',
    icon: '⚕',
    description: 'A doctor, a vet, a physio, a coach: photo, quote, name and credentials. Real people who agreed to be quoted, or leave it out.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: 'Trusted by the people who see hands every day' },
      quotes: { type: 'string', label: 'Quotes (quote|name|title|image URL per line)', multiline: true, required: true, default: 'The wrist support is the closest to a taped wrist I have seen in a glove.|Marisol Ábrego|Cutman, CDMX|\nI recommend them to every amateur who asks.|Coach Dev Patel|Head coach, Ringside Gym|' },
      ...COMMON,
    },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="experts">${list(settings.quotes).map((entry) => { const [quote = '', name = '', title = '', image = ''] = entry.split('|'); return `<article class="expert">${image.trim() ? `<img src="${e(image.trim())}" alt="${e(name.trim())}" loading="lazy">` : `<span class="av">${e(name.trim().slice(0, 1))}</span>`}<blockquote>${e(quote.trim())}</blockquote><div class="who"><strong>${e(name.trim())}</strong>${title.trim() ? `<span>${e(title.trim())}</span>` : ''}</div></article>` }).join('')}</div>`),
  },
  {
    type: 'letter',
    name: 'Founder letter',
    group: 'Advertorial',
    icon: '✉',
    description: 'A letter from the founder or the specialist behind it: photo, headline, the paragraphs, a signature. The block that makes a page a person.',
    schema: {
      eyebrow: { type: 'string', label: 'Eyebrow', default: 'A note from the founder' },
      headline: { type: 'string', label: 'Headline', default: 'Why I made this' },
      text: { type: 'string', label: 'The letter (a blank line starts a paragraph)', multiline: true, required: true, default: 'I bought four pairs in two years. Each one went soft at the wrist first.\n\nSo we started with the wrist and worked outward.' },
      image: { type: 'string', label: 'Photo URL', default: '' },
      name: { type: 'string', label: 'Signed', default: 'The founder' },
      title: { type: 'string', label: 'Title', default: '' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'narrow' } as never,
    },
    render: (settings, _context, block) => wrap(settings, block, `<div class="letter">${settings.image ? `<img src="${e(settings.image)}" alt="${e(settings.name)}" loading="lazy">` : ''}<div>${settings.eyebrow ? `<div class="eyebrow">${e(settings.eyebrow)}</div>` : ''}<h2>${e(settings.headline)}</h2><div class="prose">${lines(settings.text)}</div><div class="sig"><strong>${e(settings.name)}</strong>${settings.title ? `<span>${e(settings.title)}</span>` : ''}</div></div></div>`),
  },
  {
    type: 'cost-comparison',
    name: 'Cost of the alternatives',
    group: 'Commerce',
    icon: '$',
    description: '"20x cheaper than the proper fix": what each alternative costs, the running total, and what this costs instead.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: 'What the alternatives cost' },
      rows: { type: 'string', label: 'Alternatives (what|cost per line)', multiline: true, required: true, default: 'Three cheap pairs that went soft|$210\nA restitch at the cobbler|$60\nTaping every session for a year|$90' },
      totalLabel: { type: 'string', label: 'Total label', default: 'Total' },
      total: { type: 'string', label: 'Total', default: '$360+' },
      usLabel: { type: 'string', label: 'This instead', default: 'One pair, repaired for life' },
      us: { type: 'string', label: 'Our price', default: '$289' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'narrow' } as never,
    },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="costs">${list(settings.rows).map((entry) => { const [what = '', cost = ''] = entry.split('|'); return `<div><span>${e(what.trim())}</span><b>${e(cost.trim())}</b></div>` }).join('')}${settings.total ? `<div class="total"><span>${e(settings.totalLabel)}</span><b>${e(settings.total)}</b></div>` : ''}${settings.us ? `<div class="us"><span>${e(settings.usLabel)}</span><b>${e(settings.us)}</b></div>` : ''}</div>`),
  },
  {
    type: 'video-wall',
    name: 'Video reviews',
    group: 'Social proof',
    icon: '▶',
    description: 'A grid of customer videos that load on click. Real customers, labelled as such; a creator brief is not a review.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: 'Watch unfiltered reviews' },
      videos: { type: 'string', label: 'Videos (URL|poster URL|caption per line)', multiline: true, required: true, default: '' },
      perRow: { type: 'number', label: 'Per row', integer: true, min: 2, max: 4, default: 3 },
      ...COMMON,
    },
    render: (settings, _context, block) => {
      const videos = list(settings.videos)
      return wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<div class="vwall" style="--per:${Number(settings.perRow)}">${videos.map((entry) => { const [url = '', poster = '', caption = ''] = entry.split('|'); return `<figure>${videoTile(url.trim(), poster.trim())}${caption.trim() ? `<figcaption class="micro">${e(caption.trim())}</figcaption>` : ''}</figure>` }).join('') || '<div class="ph">Add videos: URL|poster|caption, one per line</div>'}</div>`)
    },
  },
  {
    type: 'studies',
    name: 'Research citations',
    group: 'Advertorial',
    icon: '§',
    description: 'The peer-reviewed studies behind the mechanism: journal and year, the finding in plain words, the link. Only papers you have read; a page never invents one.',
    schema: {
      eyebrow: { type: 'string', label: 'Eyebrow', default: 'Peer-reviewed evidence' },
      headline: { type: 'string', label: 'Headline', default: 'The research behind it' },
      items: { type: 'string', label: 'Studies (journal, year|finding in plain words|URL per line)', multiline: true, required: true, default: 'Journal of Sports Sciences, 2019|Wrist stiffness cut impact load in the small bones by about a third.|https://example.com/study' },
      disclaimer: { type: 'string', label: 'Disclaimer', multiline: true, default: 'The studies describe the mechanism in general; they did not test this product.' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'narrow' } as never,
    },
    render: (settings, _context, block) => wrap(settings, block, `${settings.eyebrow ? `<div class="eyebrow">${e(settings.eyebrow)}</div>` : ''}${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<ol class="studies">${list(settings.items).map((entry) => { const [source = '', finding = '', url = ''] = entry.split('|'); return `<li><div class="src">${e(source.trim())}</div><p>${e(finding.trim())}</p>${url.trim() ? `<a href="${e(url.trim())}" rel="noopener" target="_blank">Read the study</a>` : ''}</li>` }).join('')}</ol>${settings.disclaimer ? `<p class="micro">${e(settings.disclaimer)}</p>` : ''}`),
  },
  {
    type: 'gallery',
    name: 'Product gallery',
    group: 'Text & media',
    icon: '▤',
    description: 'One big image with thumbnails under it, the way a product page opens. Click a thumbnail to swap.',
    schema: { productId: {type:'string',label:'Product',default:''}, gallery: {type:'string',label:'Gallery configuration',default:''}, images: { type: 'string', label: 'Image URLs (one per line)', multiline: true, default: '' }, alt: { type: 'string', label: 'Alt text', default: '' }, ...COMMON, padding: { ...(COMMON.padding as object), default: 'small' } as never },
    render: (settings, context, block) => {
      let gallery: {mode:string;productId?:string;items:Array<{url:string;alt:string;kind?:string}>;settings?:Record<string,unknown>}
      try {gallery=JSON.parse(String(settings.gallery||''))}catch{gallery={mode:settings.productId?'product':'custom',productId:String(settings.productId||''),items:list(settings.images).map(url=>({url,alt:String(settings.alt||'')})),settings:{}}}
      if(gallery.mode==='product'){
        const product=context.products.find(item=>item.id===gallery.productId)
        if(product)gallery.items=product.media?.length?product.media:product.image?[{url:product.image,alt:product.title}]:[]
      }
      return wrap(settings, block, `<div class="gal" data-gallery data-pb-gallery="${e(JSON.stringify(gallery))}"><div data-pg-track>${gallery.items.map(item=>`<div data-pg-slide><img src="${e(item.url)}" alt="${e(item.alt)}"></div>`).join('')}</div>${gallery.items.length>1?`<div class="gal-thumbs" data-pg-thumbs>${gallery.items.map((item,index)=>`<button type="button" class="${index?'':'on'}" data-src="${e(item.url)}" data-pg-thumb="${index}" aria-label="Show slide ${index+1}"><img src="${e(item.url)}" alt=""></button>`).join('')}</div>`:''}</div>`)
    },
  },
  {
    type: 'specs',
    name: 'Specifications',
    group: 'Commerce',
    icon: '≡',
    description: 'Label and value, row by row: size, weight, materials, what is in the box.',
    schema: { headline: { type: 'string', label: 'Headline', default: 'Specifications' }, rows: { type: 'string', label: 'Rows (label|value per line)', multiline: true, required: true, default: 'Weight|14oz / 16oz\nShell|Full-grain cowhide\nPadding|Layered latex foam\nClosure|Lace-up\nIn the box|Gloves, spare laces, care card' }, ...COMMON, width: { ...(COMMON.width as object), default: 'narrow' } as never },
    render: (settings, _context, block) => wrap(settings, block, `${settings.headline ? `<h2 class="head">${e(settings.headline)}</h2>` : ''}<dl class="specs">${list(settings.rows).map((entry) => { const [label = '', value = ''] = entry.split('|'); return `<div><dt>${e(label.trim())}</dt><dd>${e(value.trim())}</dd></div>` }).join('')}</dl>`),
  },

  /* Advanced */
  {
    type: 'quiz',
    name: 'Quiz',
    group: 'Conversion',
    icon: '?',
    description: 'One question per screen. Each answer is a label the buyer uses for themselves; the result names them and shows the offer.',
    schema: {
      headline: { type: 'string', label: 'Headline', default: 'Find the right one for you' },
      steps: { type: 'string', label: 'Steps — one per line: question|answer|answer|answer', multiline: true, default: 'What is it for?|Every day|Weekends|Travel\nWhat did you try before?|Nothing yet|Something cheap that broke|Something expensive that disappointed\nWhat matters most?|It lasts|It looks right|It is easy' },
      resultHeadline: { type: 'string', label: 'Result headline', default: 'Here is the one for you' },
      resultText: { type: 'string', label: 'Result text', multiline: true, default: 'Based on what you told us, this is the build to start with.' },
      ctaLabel: { type: 'string', label: 'Button', default: 'See the offer' },
      ctaHref: { type: 'string', label: 'Button link', default: '#offer' },
      productId: { type: 'string', label: 'Product to show in the result', default: '' },
      ...COMMON,
      width: { ...(COMMON.width as object), default: 'narrow' } as never,
      align: { ...(COMMON.align as object), default: 'center' } as never,
    },
    render: (settings, context, block) => {
      const steps = list(settings.steps).map((line) => line.split('|').map((part) => part.trim()).filter(Boolean)).filter((parts) => parts.length >= 2)
      const product = settings.productId ? productFor(context, settings.productId) : null
      const screens = steps
        .map((parts, index) => `<fieldset class="qstep" data-step="${index + 1}" ${index ? 'hidden' : ''}><legend class="head">${e(parts[0])}</legend><div class="qopts">${parts.slice(1).map((answer) => `<button type="button" class="qopt" data-answer="${e(answer)}">${e(answer)}</button>`).join('')}</div></fieldset>`)
        .join('')
      const result = `<div class="qresult" hidden><h2 class="head">${e(settings.resultHeadline)}</h2><p class="lead" data-result-text>${e(settings.resultText)}</p>${product ? `<div class="qproduct">${product.image ? `<img src="${e(product.image)}" alt="${e(product.title)}" loading="lazy" decoding="async">` : ''}<div><strong>${e(product.title)}</strong><div class="micro">${e(product.subtitle)}</div><div class="price">${format(product.priceCents, context.currency)}</div></div></div>` : ''}<p><a class="btn" href="${e(settings.ctaHref || (product ? `${context.base}/products/${product.handle}` : '#offer'))}" data-quiz-cta>${e(settings.ctaLabel)}</a></p></div>`
      return wrap(settings, block, `<div class="quiz" data-quiz data-total="${steps.length}">${settings.headline ? `<div class="eyebrow">${e(settings.headline)}</div>` : ''}<div class="qprogress" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="1" aria-label="Question 1 of ${steps.length}"><span style="width:${steps.length ? Math.round(100 / steps.length) : 100}%"></span></div>${screens || '<p class="ph">Add steps: question|answer|answer</p>'}${result}</div>`)
    },
  },
  {
    type: 'custom-html',
    name: 'Custom HTML',
    group: 'Advanced',
    icon: '</>',
    description: 'Raw HTML, rendered as-is. Shopify calls it custom liquid.',
    schema: { html: { type: 'string', label: 'HTML', multiline: true, required: true, default: '<p>Anything.</p>' }, ...COMMON },
    render: (settings, _context, block) => wrap(settings, block, String(settings.html ?? '')),
  },
  {
    type: 'custom-code',
    name: 'Custom code',
    group: 'Advanced',
    icon: '{}',
    description: 'CSS and script for this page only.',
    schema: { css: { type: 'string', label: 'CSS', multiline: true, default: '' }, js: { type: 'string', label: 'JavaScript', multiline: true, default: '' } },
    render: (settings, _context, block) => `<!-- custom-code data-block="${e(block.id)}" -->${settings.css ? `<style data-block="${e(block.id)}">${inlineStyle(settings.css)}</style>` : ''}${settings.js ? `<script data-block="${e(block.id)}">${inlineScript(settings.js)}</script>` : ''}`,
  },
]

const byType = new Map(BLOCKS.map((block) => [block.type, block]))

export function blockDefinition(type: string): BlockDefinition | null {
  return byType.get(type) ?? null
}

export function blockGroups(custom: BlockDefinition[] = []): Array<{ group: BlockDefinition['group']; blocks: BlockDefinition[] }> {
  const order: BlockDefinition['group'][] = ['Layout', 'Text & media', 'Commerce', 'Social proof', 'Conversion', 'Advertorial', 'Checkout', 'Forms', 'Advanced', 'Custom']
  return order.map((group) => ({ group, blocks: [...BLOCKS, ...custom].filter((block) => block.group === group) })).filter((entry) => entry.blocks.length)
}

/* --------------------------------------------------------- custom blocks */

export type CustomField = { key: string; label?: string; type: 'string' | 'number' | 'boolean'; multiline?: boolean; default?: string | number | boolean; help?: string }
export type CustomBlockInput = { type: string; name: string; description?: string; icon?: string; fields: CustomField[]; template: string; css?: string; js?: string }

/**
 * The template language a custom block is written in. Small on purpose:
 *   {{key}}            a setting, escaped          {{{key}}}   the same, raw HTML
 *   {{#if key}}…{{else}}…{{/if}}                    shown when the setting is set
 *   {{#each key}}…{{/each}}                          one pass per line of a multiline setting;
 *      inside: {{.}} the line, {{0}} {{1}} … its "|" parts, {{{0}}} raw, {{@index}} from 1
 *   {{store.name}} {{base}} {{currency}}             the store
 *   {{product.title}} {{product.image}} {{product.price}} {{product.handle}} {{product.subtitle}}
 *      the product a `productId` setting names, else the first one
 */
/**
 * A script or a style element ends at the first closing tag in its text, not
 * at the one the template meant. `</script>` inside a block's own script broke
 * out of it and everything after was parsed as markup — the browser's rule,
 * not a preference — so a stray closing tag in a snippet someone pasted took
 * the rest of the page with it.
 */
export function inlineScript(js: unknown): string {
  return String(js ?? '').replace(/<\/script/gi, '<\\/script')
}

export function inlineStyle(css: unknown): string {
  return String(css ?? '').replace(/<\/style/gi, '')
}

/**
 * The rule is "no <script> in a block template; put it in the js field, which
 * runs once per page". It was checked against the template's own text, and a
 * template can carry one in through a raw `{{{field}}}` — the check saw
 * nothing and the page got the script. Enforcing it on what was rendered
 * covers both, and covers a tag assembled out of two halves besides.
 */
function withoutScripts(html: string): string {
  return html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '').replace(/<\/?script\b[^>]*>/gi, '')
}

export function renderTemplate(template: string, settings: Record<string, unknown>, context: BlockContext): string {
  const product = productFor(context, settings.productId)
  const scope: Record<string, unknown> = {
    ...settings,
    base: context.base,
    currency: context.currency,
    'store.name': context.storeName,
    'product.title': product?.title ?? '',
    'product.subtitle': product?.subtitle ?? '',
    'product.image': product?.image ?? '',
    'product.handle': product?.handle ?? '',
    'product.price': product ? format(product.priceCents, context.currency) : '',
  }
  const truthy = (value: unknown) => value === true || (typeof value === 'number' && value !== 0) || (typeof value === 'string' && value.trim() !== '')
  const vars = (source: string, local: Record<string, unknown>) =>
    source
      .replace(/\{\{\{\s*([\w.@]+)\s*\}\}\}/g, (_m, key: string) => String(local[key] ?? scope[key] ?? ''))
      .replace(/\{\{\s*([\w.@]+)\s*\}\}/g, (_m, key: string) => e(local[key] ?? scope[key] ?? ''))
  const ifs = (source: string, local: Record<string, unknown>): string =>
    source.replace(/\{\{#if\s+([\w.]+)\s*\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g, (_m, key: string, yes: string, no = '') => (truthy(local[key] ?? scope[key]) ? yes : no))
  const eaches = (source: string): string =>
    source.replace(/\{\{#each\s+([\w.]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g, (_m, key: string, body: string) =>
      list(scope[key])
        .map((line, index) => {
          const parts = line.split('|').map((part) => part.trim())
          const local: Record<string, unknown> = { '.': line, '@index': index + 1 }
          parts.forEach((part, at) => { local[String(at)] = part })
          return vars(ifs(body, local), local)
        })
        .join(''),
    )
  return withoutScripts(vars(ifs(eaches(template), {}), {}))
}

const CUSTOM_LIMITS = { fields: 24, template: 40_000, css: 10_000, js: 20_000 }

/** Turns a stored custom block into a definition the renderer, the editor and the tools treat like any catalog block. */
export function customDefinition(input: CustomBlockInput): BlockDefinition {
  const issues: string[] = []
  if (!/^custom-[a-z0-9][a-z0-9-]{1,40}$/.test(input.type)) issues.push('type must be "custom-" followed by letters, digits and dashes')
  if (!input.name.trim()) issues.push('a name is needed')
  if (!input.template.trim()) issues.push('a template is needed')
  if (input.template.length > CUSTOM_LIMITS.template) issues.push(`the template is over ${CUSTOM_LIMITS.template} characters`)
  if ((input.css ?? '').length > CUSTOM_LIMITS.css) issues.push(`the css is over ${CUSTOM_LIMITS.css} characters`)
  if (input.fields.length > CUSTOM_LIMITS.fields) issues.push(`more than ${CUSTOM_LIMITS.fields} fields`)
  if ((input.js ?? '').length > CUSTOM_LIMITS.js) issues.push(`the js is over ${CUSTOM_LIMITS.js} characters`)
  if (/<script\b/i.test(input.template)) issues.push('no <script> in a block template; put the block\'s script in its js field, which runs once per page')
  const schema: Schema = {}
  for (const field of input.fields) {
    if (!/^[a-z][a-zA-Z0-9]{0,30}$/.test(field.key)) { issues.push(`field key "${field.key}" must be a camelCase word`); continue }
    if (field.key in COMMON || field.key === 'productId') { issues.push(`"${field.key}" is reserved`); continue }
    if (field.type === 'number') schema[field.key] = { type: 'number', label: field.label ?? field.key, default: typeof field.default === 'number' ? field.default : Number(field.default) || 0, ...(field.help ? { help: field.help } : {}) }
    else if (field.type === 'boolean') schema[field.key] = { type: 'boolean', label: field.label ?? field.key, default: Boolean(field.default), ...(field.help ? { help: field.help } : {}) }
    else schema[field.key] = { type: 'string', label: field.label ?? field.key, default: field.default === undefined ? '' : String(field.default), ...(field.multiline ? { multiline: true } : {}), ...(field.help ? { help: field.help } : {}) }
  }
  const referenced = [...input.template.matchAll(/\{\{[#{]?\s*(?:if|each)?\s*([a-z][a-zA-Z0-9]*)\b/g)].map((match) => match[1] as string)
  for (const key of new Set(referenced)) {
    if (['if', 'each', 'else', 'base', 'currency', 'store', 'product', 'productId'].includes(key) || key in schema) continue
    issues.push(`the template uses {{${key}}} but no field "${key}" is declared`)
  }
  if (issues.length) throw new Error(`Custom block "${input.type}": ${issues.join('; ')}`)
  const usesProduct = /\{\{\{?\s*product\./.test(input.template)
  const css = (input.css ?? '').replace(/<\/style/gi, '')
  const js = (input.js ?? '').replace(/<\/script/gi, '<\\/script').trim()
  return {
    ...(js ? { js } : {}),
    type: input.type,
    name: input.name.trim(),
    group: 'Custom',
    icon: (input.icon ?? '✚').slice(0, 4) || '✚',
    description: (input.description ?? '').trim() || 'A block this store defined for itself.',
    schema: { ...(usesProduct ? { productId: { type: 'string', label: 'Product', default: '' } } : {}), ...schema, ...COMMON },
    render: (settings, context, block) => wrap(settings, block, `${css ? `<style data-custom="${e(input.type)}">${inlineStyle(css)}</style>` : ''}${renderTemplate(input.template, settings, context)}`),
  }
}

/** The catalog, then the store's own blocks. */
function resolve(type: string, context?: BlockContext): BlockDefinition | null {
  return byType.get(type) ?? context?.custom?.find((definition) => definition.type === type) ?? null
}

/** Validated settings for a block, with defaults filled in. Unknown types render a visible note, never nothing. */
export function renderBlock(block: BlockInstance, context: BlockContext): string {
  const definition = resolve(block.type, context)
  if (!definition) return `<section class="blk" data-block="${e(block.id)}"><div class="blk-in"><p class="micro">Unknown block: ${e(block.type)}</p></div></section>`
  // blankIsValue: text the owner deleted stays deleted. coerceField treats ''
  // as absent everywhere else — which is right for a settings form — and here
  // it silently reinstated the shipped copy at render, so no stock headline
  // in the catalog could ever be removed.
  const validated = check(definition.schema, block.settings, { blankIsValue: true })
  // A setting that fails its own field takes the default; the rest survive.
  // A page with one bad number in one block must not lose the block.
  const settings = validated.ok ? validated.value : { ...defaultsFor(definition), ...pickValid(definition, block.settings) }
  try {
    const rendered = definition.render(settings, context, block)
    const mode = block.settings._font
    if (mode !== 'body' && mode !== 'display' && mode !== 'custom') return rendered
    const custom = typeof block.settings._customFont === 'string'
      ? block.settings._customFont.replace(/[;{}<>]/g, '').trim().slice(0, 160)
      : ''
    const family = mode === 'body' ? 'var(--body)' : mode === 'display' ? 'var(--display)' : custom
    return family ? `<div class="blk-font" style="--block-font:${e(family)};--block-display:${e(family)}">${rendered}</div>` : rendered
  } catch (error) {
    return `<section class="blk" data-block="${e(block.id)}"><div class="blk-in"><p class="micro">${e(definition.name)} could not render: ${e(error instanceof Error ? error.message : String(error))}</p></div></section>`
  }
}

function pickValid(definition: BlockDefinition, raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(definition.schema)) {
    if (raw[key] === undefined) continue
    const single = check({ [key]: { ...field, required: false } }, { [key]: raw[key] }, { blankIsValue: true })
    if (single.ok && single.value[key] !== undefined) out[key] = single.value[key]
  }
  return out
}

export function renderBlocks(blocks: BlockInstance[], context: BlockContext): string {
  return blocks.map((block) => renderBlock(block, context)).join('\n')
}

export function defaultsFor(definition: BlockDefinition): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(definition.schema)) if ('default' in field && field.default !== undefined) out[key] = field.default
  return out
}

/** The runtime the blocks need: countdowns, lazy video, before/after, sticky bar, share. Small, inline, dependency-free. */
export const BLOCK_RUNTIME = `${productGalleryRuntime}\n(function(){
function pad(n){return String(Math.max(0,n)).padStart(2,'0')}
document.querySelectorAll('.countdown').forEach(function(el){
  var ends; if(el.dataset.mode==='fixed'&&el.dataset.ends){ends=Date.parse(el.dataset.ends)}
  else{var k=el.dataset.key;try{ends=Number(localStorage.getItem(k))}catch(e){ends=0}
    if(!ends||ends<Date.now()){ends=Date.now()+Number(el.dataset.minutes||15)*60000;try{localStorage.setItem(k,String(ends))}catch(e){}}}
  function tick(){var d=Math.max(0,Math.floor((ends-Date.now())/1000));el.querySelector('[data-h]').textContent=pad(Math.floor(d/3600));el.querySelector('[data-m]').textContent=pad(Math.floor(d%3600/60));el.querySelector('[data-s]').textContent=pad(d%60)}
  tick();setInterval(tick,1000)});
document.querySelectorAll('.video[data-embed]').forEach(function(el){el.addEventListener('click',function(){var f=document.createElement('iframe');f.src=el.dataset.embed;f.allow='autoplay; encrypted-media';f.allowFullscreen=true;el.replaceChildren(f);el.classList.add('on')})});
document.querySelectorAll('.ba input').forEach(function(r){r.addEventListener('input',function(){r.parentElement.style.setProperty('--pos',r.value+'%')})});
var bar=document.querySelector('[data-sticky]'),first=document.querySelector('.btn');
if(bar&&first&&'IntersectionObserver' in window){new IntersectionObserver(function(en){bar.classList.toggle('show',!en[0].isIntersecting&&en[0].boundingClientRect.top<0)}).observe(first)}
document.querySelectorAll('[data-share]').forEach(function(a){a.addEventListener('click',function(ev){ev.preventDefault();var u=location.href,t=a.dataset.share;
  if(t==='copy'){navigator.clipboard&&navigator.clipboard.writeText(u);a.textContent='Copied';return}
  window.open(t==='x'?'https://twitter.com/intent/tweet?url='+encodeURIComponent(u):'https://www.facebook.com/sharer/sharer.php?u='+encodeURIComponent(u),'_blank','noopener')})});
document.querySelectorAll('[data-rotate]').forEach(function(bar){var i=0,items=bar.querySelectorAll('span');if(items.length<2)return;setInterval(function(){items[i].hidden=true;i=(i+1)%items.length;items[i].hidden=false},4000)});
document.querySelectorAll('.salespop').forEach(function(pop){var items=[];try{items=JSON.parse(pop.dataset.items||'[]')}catch(e){}if(!items.length)return;var i=0;
  function show(){var it=items[i%items.length];i++;pop.querySelector('img').src=it.image||'';pop.querySelector('b').textContent=it.name+(it.city?' from '+it.city:'');pop.querySelector('span').textContent='bought '+it.product;pop.querySelector('small').textContent='verified purchase';pop.hidden=false;setTimeout(function(){pop.hidden=true},6000)}
  setTimeout(function(){show();setInterval(show,Number(pop.dataset.every||25)*1000)},Number(pop.dataset.delay||8)*1000)});
document.querySelectorAll('.edd').forEach(function(el){var cutoff=Number(el.dataset.cutoff||15),now=new Date(),h=cutoff-now.getHours()-1,m=60-now.getMinutes();var t=el.querySelector('[data-cutoff-text]');if(h>=0)t.textContent='in the next '+(h?h+'h ':'')+m+'m';else t.textContent='today'});
document.querySelectorAll('.shipbar').forEach(function(bar){var thr=Number(bar.dataset.threshold||0);var sub=Number((document.body.dataset.cartSubtotal)||0);if(!thr)return;var fill=bar.querySelector('.fill');var pct=Math.min(100,Math.round(sub/thr*100));fill.style.width=pct+'%';if(sub>=thr){bar.querySelector('[data-text]').textContent='You have free shipping'}else if(sub>0){var cur=bar.dataset.currency||'USD';try{bar.querySelector('[data-text]').textContent=new Intl.NumberFormat('en-US',{style:'currency',currency:cur}).format((thr-sub)/100)+' away from free shipping'}catch(e){}}});
document.querySelectorAll('[data-quiz]').forEach(function(quiz){var steps=quiz.querySelectorAll('.qstep'),total=steps.length,answers=[],bar=quiz.querySelector('.qprogress');
  function go(n){steps.forEach(function(s,i){s.hidden=i!==n});if(bar){bar.setAttribute('aria-valuenow',String(n+1));bar.setAttribute('aria-label','Question '+(n+1)+' of '+total);bar.firstElementChild.style.width=Math.round((n+1)/total*100)+'%'}var l=steps[n]&&steps[n].querySelector('legend');l&&l.focus&&(l.tabIndex=-1,l.focus())}
  quiz.querySelectorAll('.qopt').forEach(function(opt){opt.addEventListener('click',function(){var step=opt.closest('.qstep'),n=Number(step.dataset.step);answers.push(opt.dataset.answer);window.__track&&window.__track('quiz.step',{step:n,answer:opt.dataset.answer});
    if(n<total){go(n)}else{steps.forEach(function(s){s.hidden=true});var r=quiz.querySelector('.qresult');r.hidden=false;if(bar)bar.hidden=true;var cta=r.querySelector('[data-quiz-cta]');if(cta&&cta.getAttribute('href')&&cta.getAttribute('href').charAt(0)!=='#'){try{var u=new URL(cta.getAttribute('href'),location.href);u.searchParams.set('quiz',answers.join(','));cta.setAttribute('href',u.pathname+u.search)}catch(e){}}var h=r.querySelector('h2');h&&(h.tabIndex=-1,h.focus());window.__track&&window.__track('quiz.complete',{answers:answers.join(',')})}})});});
document.querySelectorAll('[data-gallery]').forEach(function(g){if(g.hasAttribute('data-pb-gallery'))return;var main=g.querySelector('.gal-main'),thumbs=g.querySelectorAll('.gal-thumbs button');thumbs.forEach(function(b){b.addEventListener('click',function(){main.src=b.dataset.src;thumbs.forEach(function(o){o.classList.toggle('on',o===b)})})})});
document.querySelectorAll('.buyform').forEach(function(form){var total=form.querySelector('button [data-total]');function sync(){
  var select=form.querySelector('select[name=variantId]'),option=select&&select.selectedOptions[0];
  if(option&&option.dataset.price){var price=Number(option.dataset.price),currency=form.dataset.currency||'USD',digits=Number(form.dataset.minorDigits||2);
    function money(cents){return new Intl.NumberFormat(undefined,{style:'currency',currency:currency}).format(cents/Math.pow(10,digits))}
    var base=form.parentElement.querySelector('[data-variant-price]');if(base)base.textContent=money(price);if(total)total.textContent=money(price);
    form.querySelectorAll('.tier').forEach(function(card){var input=card.querySelector('input[name=quantity]');if(!input)return;var quantity=Number(input.value)||1,full=price*quantity,amount=Math.round(full*(1-Number(input.dataset.discount||0)/100));input.dataset.total=money(amount);
      var value=card.querySelector('[data-tier-total]'),compare=card.querySelector('[data-tier-compare]'),unit=card.querySelector('[data-tier-unit]');if(value)value.textContent=money(amount);if(compare)compare.textContent=money(full);if(unit)unit.textContent=money(Math.round(amount/quantity))+' each';});
  }
  var t=form.querySelector('input[name=quantity]:checked');if(t&&total&&t.dataset.total)total.textContent=t.dataset.total
}form.addEventListener('change',sync);sync()});
})();`
