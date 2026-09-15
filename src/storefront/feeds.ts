import { articleIsPublic, type Blog } from '../domain/content.ts'

type FeedInput = {
  blog: Blog
  storeName: string
  /** Absolute storefront root, without a trailing slash. */
  storefrontUrl: string
}

const xml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

function publicArticles(blog: Blog) {
  return blog.articles
    .filter((article) => articleIsPublic(article))
    .sort((a, b) => Date.parse(b.publishedAt ?? b.createdAt) - Date.parse(a.publishedAt ?? a.createdAt))
}

function urls(input: FeedInput) {
  const root = input.storefrontUrl.replace(/\/$/, '')
  const blog = `${root}/blogs/${encodeURIComponent(input.blog.handle)}`
  return { blog }
}

export function rssFeed(input: FeedInput): string {
  const articles = publicArticles(input.blog)
  const { blog } = urls(input)
  const self = `${blog}/rss.xml`
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${xml(`${input.storeName} — ${input.blog.title}`)}</title>
<link>${xml(blog)}</link>
<description>${xml(`New articles from ${input.storeName}`)}</description>
<atom:link href="${xml(self)}" rel="self" type="application/rss+xml" />
${articles.map((article) => {
    const url = `${blog}/${encodeURIComponent(article.handle)}`
    const published = new Date(article.publishedAt ?? article.createdAt).toUTCString()
    return `<item><title>${xml(article.title)}</title><link>${xml(url)}</link><guid isPermaLink="true">${xml(url)}</guid><pubDate>${xml(published)}</pubDate><description>${xml(article.excerpt)}</description></item>`
  }).join('\n')}
</channel></rss>`
}

export function atomFeed(input: FeedInput): string {
  const articles = publicArticles(input.blog)
  const { blog } = urls(input)
  const self = `${blog}/atom.xml`
  const updated = articles[0]?.publishedAt ?? articles[0]?.createdAt ?? new Date(0).toISOString()
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>${xml(`${input.storeName} — ${input.blog.title}`)}</title>
<id>${xml(blog)}</id><link href="${xml(blog)}" /><link href="${xml(self)}" rel="self" type="application/atom+xml" />
<updated>${xml(new Date(updated).toISOString())}</updated>
${articles.map((article) => {
    const url = `${blog}/${encodeURIComponent(article.handle)}`
    const published = new Date(article.publishedAt ?? article.createdAt).toISOString()
    return `<entry><title>${xml(article.title)}</title><id>${xml(url)}</id><link href="${xml(url)}" /><published>${xml(published)}</published><updated>${xml(published)}</updated><summary>${xml(article.excerpt)}</summary></entry>`
  }).join('\n')}
</feed>`
}
