import { json, now, type Db, type Row } from '../lib/db.ts'
import { handle as toHandle, id } from '../lib/ids.ts'

export type Article = {
  id: string
  blogId: string
  storeId: string
  title: string
  handle: string
  excerpt: string
  body: string
  image: string
  tags: string[]
  status: 'draft' | 'scheduled' | 'published'
  publishedAt: string | null
  createdAt: string
}

export type Blog = { id: string; storeId: string; title: string; handle: string; articles: Article[] }

function rowToArticle(row: Row): Article {
  return {
    id: row.id as string,
    blogId: row.blog_id as string,
    storeId: row.store_id as string,
    title: row.title as string,
    handle: row.handle as string,
    excerpt: row.excerpt as string,
    body: row.body as string,
    image: row.image as string,
    tags: json(row.tags, [] as string[]),
    status: row.status as Article['status'],
    publishedAt: (row.published_at as string | null) ?? null,
    createdAt: row.created_at as string,
  }
}

export function listBlogs(db: Db, storeId: string): Blog[] {
  return db.all('SELECT * FROM blogs WHERE store_id = ? ORDER BY created_at', storeId).map((row) => ({
    id: row.id as string,
    storeId,
    title: row.title as string,
    handle: row.handle as string,
    articles: db.all('SELECT * FROM articles WHERE blog_id = ? ORDER BY created_at DESC', row.id).map(rowToArticle),
  }))
}

export function createBlog(db: Db, storeId: string, title: string): Blog {
  const blogId = id('blog')
  db.insert('blogs', { id: blogId, store_id: storeId, title, handle: toHandle(title), created_at: now() })
  return listBlogs(db, storeId).find((blog) => blog.id === blogId) as Blog
}

export function createArticle(
  db: Db,
  storeId: string,
  blogId: string,
  input: { title: string; body?: string; excerpt?: string; image?: string; tags?: string[]; status?: Article['status']; publishAt?: string },
): Article {
  const articleId = id('art')
  let status = input.status ?? 'published'
  let publishedAt = status === 'published' ? now() : null
  if (input.publishAt) {
    const requested = new Date(input.publishAt)
    if (Number.isNaN(requested.getTime())) throw new Error('Publish time is not a valid date')
    publishedAt = requested.toISOString()
    status = requested.getTime() > Date.now() ? 'scheduled' : 'published'
  }
  db.insert('articles', {
    id: articleId,
    blog_id: blogId,
    store_id: storeId,
    title: input.title,
    handle: toHandle(input.title),
    excerpt: input.excerpt ?? input.body?.slice(0, 160) ?? '',
    body: input.body ?? '',
    image: input.image ?? '',
    tags: input.tags ?? [],
    status,
    published_at: publishedAt,
    created_at: now(),
  })
  return rowToArticle(db.one('SELECT * FROM articles WHERE id = ?', articleId) as Row)
}

export function getArticle(db: Db, storeId: string, articleId: string): Article | null {
  const row = db.one('SELECT * FROM articles WHERE id = ? AND store_id = ?', articleId, storeId)
  return row ? rowToArticle(row) : null
}

export function updateArticle(
  db: Db,
  storeId: string,
  articleId: string,
  patch: Partial<Pick<Article, 'title' | 'body' | 'excerpt' | 'image' | 'tags' | 'status'>> & { publishAt?: string | null },
): Article {
  const article = getArticle(db, storeId, articleId)
  if (!article) throw new Error('No such article')
  const values: Row = {}
  if (patch.title !== undefined) { values.title = patch.title; values.handle = toHandle(patch.title) }
  if (patch.body !== undefined) values.body = patch.body
  if (patch.excerpt !== undefined) values.excerpt = patch.excerpt
  if (patch.image !== undefined) values.image = patch.image
  if (patch.tags !== undefined) values.tags = patch.tags
  if (patch.status !== undefined) values.status = patch.status
  if (patch.publishAt !== undefined) {
    if (!patch.publishAt) values.published_at = null
    else {
      const requested = new Date(patch.publishAt)
      if (Number.isNaN(requested.getTime())) throw new Error('Publish time is not a valid date')
      values.published_at = requested.toISOString()
      values.status = requested.getTime() > Date.now() ? 'scheduled' : 'published'
    }
  } else if (patch.status === 'published' && !article.publishedAt) values.published_at = now()
  if (Object.keys(values).length) db.update('articles', articleId, values)
  return getArticle(db, storeId, articleId) as Article
}

export function deleteArticle(db: Db, storeId: string, articleId: string): boolean {
  return Number(db.run('DELETE FROM articles WHERE id = ? AND store_id = ?', articleId, storeId).changes) > 0
}

export function deleteBlog(db: Db, storeId: string, blogId: string): boolean {
  return Number(db.tx(() => {
    db.run('DELETE FROM articles WHERE blog_id = ? AND store_id = ?', blogId, storeId)
    return db.run('DELETE FROM blogs WHERE id = ? AND store_id = ?', blogId, storeId).changes
  })) > 0
}

/** Scheduled posts become public from their timestamp without needing a worker. */
export function articleIsPublic(article: Article, at = new Date()): boolean {
  if (article.status === 'published') return true
  return article.status === 'scheduled' && article.publishedAt !== null && Date.parse(article.publishedAt) <= at.getTime()
}

export function findArticle(db: Db, storeId: string, blogHandle: string, articleHandle: string): { blog: Blog; article: Article } | null {
  const blog = listBlogs(db, storeId).find((entry) => entry.handle === blogHandle)
  const article = blog?.articles.find((entry) => entry.handle === articleHandle && articleIsPublic(entry))
  return blog && article ? { blog, article } : null
}
