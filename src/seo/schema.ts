import { now, type Db } from '../lib/db.ts'
import { escapeHtml } from '../lib/http.ts'
import { id } from '../lib/ids.ts'
import type { Product } from '../domain/types.ts'
import type { ReviewStats } from '../domain/reviews.ts'
import type { Store } from '../control/stores.ts'

/**
 * Structured data is written on save, not crawled for later. Every product
 * page ships Product, Offer, AggregateRating and BreadcrumbList; the validator
 * below is the same code the admin's SEO tab runs, so what it reports is what
 * a crawler sees.
 */
export function productJsonLd(store: Store, product: Product, url: string, stats: ReviewStats): Record<string, unknown> {
  const prices = product.variants.map((variant) => variant.priceCents)
  const currency = store.currency
  const node: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.title,
    description: product.seo.description || product.subtitle || product.description.slice(0, 300),
    image: [product.heroImage, ...product.media.map((media) => media.url)].filter(Boolean).slice(0, 6),
    brand: { '@type': 'Brand', name: store.name },
    sku: product.variants[0]?.sku ?? product.handle,
    offers: {
      '@type': 'AggregateOffer',
      priceCurrency: currency,
      lowPrice: (Math.min(...prices) / 100).toFixed(2),
      highPrice: (Math.max(...prices) / 100).toFixed(2),
      offerCount: product.variants.length,
      availability: product.variants.some((variant) => variant.inventory > 0 || variant.allowBackorder)
        ? 'https://schema.org/InStock'
        : 'https://schema.org/OutOfStock',
      url,
    },
  }
  if (stats.count > 0) {
    node.aggregateRating = { '@type': 'AggregateRating', ratingValue: stats.average, reviewCount: stats.count }
  }
  return node
}

export function breadcrumbJsonLd(trail: Array<{ name: string; url: string }>): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((entry, index) => ({ '@type': 'ListItem', position: index + 1, name: entry.name, item: entry.url })),
  }
}

export function jsonLdTag(nodes: Array<Record<string, unknown>>): string {
  return nodes
    .map((node) => `<script type="application/ld+json">${JSON.stringify(node).replace(/</g, '\\u003c')}</script>`)
    .join('\n')
}

export type SchemaIssue = { level: 'error' | 'warning'; message: string }

export function validateProductSchema(node: Record<string, unknown>): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const offers = node.offers as Record<string, unknown> | undefined
  if (!node.name) issues.push({ level: 'error', message: 'Product is missing a name' })
  if (!node.description) issues.push({ level: 'error', message: 'Product has no description — Google will not show a rich result' })
  if (!Array.isArray(node.image) || !node.image.length) issues.push({ level: 'error', message: 'Product has no image' })
  if (!offers) issues.push({ level: 'error', message: 'Product has no offer' })
  else if (!offers.priceCurrency) issues.push({ level: 'error', message: 'Offer is missing priceCurrency' })
  if (!node.aggregateRating) issues.push({ level: 'warning', message: 'No reviews yet, so no star rating in search results' })
  if (String(node.description ?? '').length > 5000) issues.push({ level: 'warning', message: 'Description is longer than Google will index' })
  return issues
}

export function metaTags(input: { title: string; description: string; url: string; image?: string; type?: string }): string {
  const title = escapeHtml(input.title)
  const description = escapeHtml(input.description.slice(0, 300))
  return [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<link rel="canonical" href="${escapeHtml(input.url)}">`,
    `<meta property="og:type" content="${escapeHtml(input.type ?? 'website')}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${escapeHtml(input.url)}">`,
    input.image ? `<meta property="og:image" content="${escapeHtml(input.image)}">` : '',
    `<meta name="twitter:card" content="${input.image ? 'summary_large_image' : 'summary'}">`,
  ]
    .filter(Boolean)
    .join('\n')
}

export function sitemap(base: string, paths: Array<{ path: string; updated?: string }>): string {
  const entries = paths
    .map((entry) => `  <url><loc>${escapeHtml(base + entry.path)}</loc>${entry.updated ? `<lastmod>${entry.updated.slice(0, 10)}</lastmod>` : ''}</url>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>`
}

export function robots(base: string): string {
  return `User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\n\nSitemap: ${base}/sitemap.xml\n`
}

/**
 * `llms.txt` and the knowledge card are the whole of GEO that a store actually
 * controls. Generative engines cite what they can parse; this is the parseable
 * version of the brand.
 */
export function llmsTxt(store: Store, products: Product[], storefrontUrl?: string): string {
  const brand = store.brand
  return [
    `# ${store.name}`,
    '',
    brand.description ?? brand.slogan ?? '',
    '',
    '## What we sell',
    ...products.slice(0, 20).map((product) => `- ${product.title}: ${product.subtitle || product.description.slice(0, 120)}`),
    '',
    '## What makes us different',
    ...(brand.voice ? [brand.voice] : []),
    '',
    `## Contact`,
    // The slug is an internal handle with a random suffix, never a hostname:
    // the whole point of this file is an address an engine can cite.
    `Storefront: ${storefrontUrl ?? `https://${store.slug}`}`,
  ].join('\n')
}

export function upsertSeoPage(db: Db, storeId: string, input: { path: string; title: string; description: string; keyword?: string }) {
  const existing = db.one<{ id: string }>('SELECT id FROM seo_pages WHERE store_id = ? AND path = ?', storeId, input.path)
  if (existing) {
    db.update('seo_pages', existing.id, { title: input.title, description: input.description, keyword: input.keyword ?? '', updated_at: now() })
    return
  }
  db.insert('seo_pages', {
    id: id('seo'),
    store_id: storeId,
    path: input.path,
    title: input.title,
    description: input.description,
    keyword: input.keyword ?? '',
    position: null,
    delta: 0,
    clicks: [],
    health: input.description ? 'green' : 'amber',
    updated_at: now(),
  })
}

export function listSeoPages(db: Db, storeId: string) {
  return db.all('SELECT * FROM seo_pages WHERE store_id = ? ORDER BY path', storeId)
}

export function addRedirect(db: Db, storeId: string, source: string, target: string, code = 301) {
  db.run('INSERT OR REPLACE INTO redirects (id, store_id, source, target, code) VALUES (?, ?, ?, ?, ?)', id('rdr'), storeId, source, target, code)
}

export function findRedirect(db: Db, storeId: string, path: string) {
  return db.one<{ target: string; code: number }>('SELECT target, code FROM redirects WHERE store_id = ? AND source = ?', storeId, path)
}
