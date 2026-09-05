import type { Db } from './db.ts'

/**
 * Where a store answers on the public internet.
 *
 * Several places needed this and each invented its own: the ads tools had a
 * helper that guessed `localhost:3000`, and `request_reviews` and `send_email`
 * built `https://<slug>` — the internal handle with its random suffix, which
 * is not a hostname. Every review request the assistant sent went to a real
 * customer with a dead link.
 *
 * The order is the one the admin's store list uses: a custom domain the store
 * has verified, then the storefront subdomain, then this deployment's public
 * origin with the `/s/:slug` path.
 */
export function publicStoreUrl(db: Db | null, store: { slug: string; id?: string }): string {
  if (db && store.id) {
    const hosted = db.one<{ hostname: string }>(
      "SELECT hostname FROM domains WHERE store_id = ? AND status = 'verified' AND mode = 'host' ORDER BY created_at LIMIT 1",
      store.id,
    )
    if (hosted) return `https://${hosted.hostname}`
  }
  const root = process.env.AMBORAS_STOREFRONT_HOST
  if (root) return `https://${store.slug}.${root}`
  const origin = process.env.AMBORAS_PUBLIC_ORIGIN ?? `http://localhost:${process.env.PORT ?? 4100}`
  return `${origin}/s/${store.slug}`
}
