import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { logger } from './log.ts'

const log = logger('db')

export type Row = Record<string, unknown>

/**
 * One SQLite file holds both planes: the control plane (users, stores,
 * environments, plugins, agent runs) and the commerce core (products, orders,
 * promotions). The blueprint's target runs Postgres under Medusa plus a
 * separate control-plane database; the split there is a deployment decision,
 * not a modelling one, so the tables keep the same shape and the same
 * `store_id` tenancy key that the multi-database version would use.
 */
export class Db {
  readonly handle: DatabaseSync

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(resolve(file)), { recursive: true })
    this.handle = new DatabaseSync(file)
    this.handle.exec('PRAGMA journal_mode = WAL')
    this.handle.exec('PRAGMA foreign_keys = ON')
    this.handle.exec('PRAGMA busy_timeout = 5000')
    migrate(this)
  }

  exec(sql: string) {
    this.handle.exec(sql)
  }

  all<T = Row>(sql: string, ...params: unknown[]): T[] {
    return this.handle.prepare(sql).all(...(params as never[])) as T[]
  }

  one<T = Row>(sql: string, ...params: unknown[]): T | null {
    const row = this.handle.prepare(sql).get(...(params as never[]))
    return (row as T | undefined) ?? null
  }

  run(sql: string, ...params: unknown[]) {
    return this.handle.prepare(sql).run(...(params as never[]))
  }

  /** Every write path that touches more than one table goes through here. */
  tx<T>(fn: () => T): T {
    this.handle.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.handle.exec('COMMIT')
      return out
    } catch (error) {
      try { this.handle.exec('ROLLBACK') } catch { /* already rolled back */ }
      throw error
    }
  }

  insert(table: string, values: Row): void {
    const keys = Object.keys(values)
    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`
    this.run(sql, ...keys.map((key) => normalize(values[key])))
  }

  update(table: string, id: string, values: Row): void {
    const keys = Object.keys(values).filter((key) => key !== 'id')
    if (!keys.length) return
    const sql = `UPDATE ${table} SET ${keys.map((key) => `${key} = ?`).join(', ')} WHERE id = ?`
    this.run(sql, ...keys.map((key) => normalize(values[key])), id)
  }
}

function normalize(value: unknown): string | number | null | Uint8Array {
  if (value === undefined || value === null) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value instanceof Uint8Array) return value
  return JSON.stringify(value)
}

/** JSON columns carry the shapes that would be their own tables in Postgres. */
export function json<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

export function bool(value: unknown): boolean {
  return value === 1 || value === true || value === '1'
}

export const now = () => new Date().toISOString()

const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: '001_control_plane',
    sql: `
    CREATE TABLE users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL);

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE INDEX sessions_user ON sessions(user_id);

    CREATE TABLE stores (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, plan_slug TEXT NOT NULL DEFAULT 'free',
      currency TEXT NOT NULL DEFAULT 'USD', brand TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'draft', prompt TEXT NOT NULL DEFAULT '',
      credits_used INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
    CREATE INDEX stores_owner ON stores(owner_id);

    CREATE TABLE store_environments (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, theme TEXT NOT NULL DEFAULT '{}', build_state TEXT NOT NULL DEFAULT 'idle',
      build_log TEXT NOT NULL DEFAULT '[]', version INTEGER NOT NULL DEFAULT 1,
      published_at TEXT, updated_at TEXT NOT NULL, UNIQUE (store_id, kind));

    CREATE TABLE team_members (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE, email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'invited',
      invite_token TEXT, created_at TEXT NOT NULL);
    CREATE INDEX team_store ON team_members(store_id);

    CREATE TABLE domains (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      hostname TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
      verification_token TEXT NOT NULL, ssl TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL);

    CREATE TABLE todos (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      key TEXT NOT NULL, label TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'waiting', href TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0, UNIQUE (store_id, key));

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY, store_id TEXT, actor_type TEXT NOT NULL, actor_id TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', diff TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL);
    CREATE INDEX audit_store ON audit_log(store_id, created_at DESC);

    CREATE TABLE store_plugins (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
      settings TEXT NOT NULL DEFAULT '{}', slots TEXT NOT NULL DEFAULT '{}',
      installed_at TEXT NOT NULL, UNIQUE (store_id, plugin_id));

    CREATE TABLE store_plugin_credentials (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      plugin_id TEXT NOT NULL, sealed TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (store_id, plugin_id));
    `,
  },
  {
    name: '002_commerce',
    sql: `
    CREATE TABLE regions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL, currency TEXT NOT NULL, countries TEXT NOT NULL DEFAULT '[]',
      tax_rate REAL NOT NULL DEFAULT 0, is_default INTEGER NOT NULL DEFAULT 0);

    CREATE TABLE shipping_options (
      id TEXT PRIMARY KEY, region_id TEXT NOT NULL REFERENCES regions(id) ON DELETE CASCADE,
      name TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0,
      free_above_cents INTEGER, position INTEGER NOT NULL DEFAULT 0);

    CREATE TABLE products (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL, handle TEXT NOT NULL, subtitle TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
      hero_image TEXT NOT NULL DEFAULT '', media TEXT NOT NULL DEFAULT '[]',
      options TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}',
      seo TEXT NOT NULL DEFAULT '{}', tags TEXT NOT NULL DEFAULT '[]',
      subscription TEXT NOT NULL DEFAULT '{}', position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (store_id, handle));
    CREATE INDEX products_store ON products(store_id, status);

    CREATE TABLE variants (
      id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL, title TEXT NOT NULL, sku TEXT NOT NULL DEFAULT '',
      price_cents INTEGER NOT NULL DEFAULT 0, compare_at_cents INTEGER,
      inventory INTEGER NOT NULL DEFAULT 0, allow_backorder INTEGER NOT NULL DEFAULT 0,
      option_values TEXT NOT NULL DEFAULT '{}', image TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX variants_product ON variants(product_id);

    CREATE TABLE collections (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL, handle TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, UNIQUE (store_id, handle));

    CREATE TABLE collection_products (
      collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (collection_id, product_id));

    CREATE TABLE customers (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      email TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', marketing INTEGER NOT NULL DEFAULT 0,
      address TEXT NOT NULL DEFAULT '{}', orders_count INTEGER NOT NULL DEFAULT 0,
      spend_cents INTEGER NOT NULL DEFAULT 0, tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, UNIQUE (store_id, email));

    CREATE TABLE carts (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      email TEXT NOT NULL DEFAULT '', items TEXT NOT NULL DEFAULT '[]',
      discount_code TEXT NOT NULL DEFAULT '', region_id TEXT, order_id TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    CREATE TABLE orders (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      display_id INTEGER NOT NULL, email TEXT NOT NULL, customer_id TEXT,
      items TEXT NOT NULL DEFAULT '[]', currency TEXT NOT NULL DEFAULT 'USD',
      subtotal_cents INTEGER NOT NULL DEFAULT 0, discount_cents INTEGER NOT NULL DEFAULT 0,
      shipping_cents INTEGER NOT NULL DEFAULT 0, tax_cents INTEGER NOT NULL DEFAULT 0,
      total_cents INTEGER NOT NULL DEFAULT 0, discount_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', payment_status TEXT NOT NULL DEFAULT 'awaiting',
      fulfillment_status TEXT NOT NULL DEFAULT 'unfulfilled', address TEXT NOT NULL DEFAULT '{}',
      fulfillments TEXT NOT NULL DEFAULT '[]', refunds TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX orders_store ON orders(store_id, created_at DESC);

    CREATE TABLE promotions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      code TEXT NOT NULL DEFAULT '', title TEXT NOT NULL, kind TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0, rules TEXT NOT NULL DEFAULT '{}',
      automatic INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT, ends_at TEXT, usage_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL);
    CREATE INDEX promotions_store ON promotions(store_id, status);

    CREATE TABLE reviews (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL, rating INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '', author TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending', verified INTEGER NOT NULL DEFAULT 0,
      flags TEXT NOT NULL DEFAULT '[]', media TEXT NOT NULL DEFAULT '[]',
      reply TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE INDEX reviews_product ON reviews(product_id, status);
    `,
  },
  {
    name: '003_agent_and_content',
    sql: `
    CREATE TABLE agent_runs (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'chat', prompt TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued', page TEXT NOT NULL DEFAULT '',
      session_id TEXT, plan TEXT NOT NULL DEFAULT '[]', cursor INTEGER NOT NULL DEFAULT 0,
      error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX agent_runs_store ON agent_runs(store_id, created_at DESC);

    CREATE TABLE agent_steps (
      id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL, position INTEGER NOT NULL, branch TEXT NOT NULL DEFAULT 'main',
      tool TEXT NOT NULL, args TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
      result TEXT NOT NULL DEFAULT '{}', area TEXT NOT NULL DEFAULT '',
      started_at TEXT, ended_at TEXT);
    CREATE INDEX agent_steps_run ON agent_steps(run_id, position);

    CREATE TABLE chat_sessions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      page TEXT NOT NULL DEFAULT '', run_id TEXT, artifacts TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL);
    CREATE INDEX chat_messages_session ON chat_messages(session_id, created_at);

    CREATE TABLE email_sends (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      template TEXT NOT NULL, recipient TEXT NOT NULL, subject TEXT NOT NULL,
      html TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      opened_at TEXT, clicked_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX email_store ON email_sends(store_id, created_at DESC);

    CREATE TABLE blogs (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL, handle TEXT NOT NULL, created_at TEXT NOT NULL,
      UNIQUE (store_id, handle));

    CREATE TABLE articles (
      id TEXT PRIMARY KEY, blog_id TEXT NOT NULL REFERENCES blogs(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL, title TEXT NOT NULL, handle TEXT NOT NULL,
      excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'draft', published_at TEXT, created_at TEXT NOT NULL);

    CREATE TABLE sessions_analytics (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL, country TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '',
      referrer TEXT NOT NULL DEFAULT '', variant TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL, last_seen TEXT NOT NULL);
    CREATE INDEX sessions_analytics_store ON sessions_analytics(store_id, last_seen DESC);

    CREATE TABLE analytics_events (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL, type TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
      product_id TEXT, amount_cents INTEGER NOT NULL DEFAULT 0,
      meta TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE INDEX analytics_events_store ON analytics_events(store_id, created_at DESC);
    CREATE INDEX analytics_events_type ON analytics_events(store_id, type, created_at);

    CREATE TABLE experiments (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL, surface TEXT NOT NULL, hypothesis TEXT NOT NULL DEFAULT '',
      variants TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft',
      traffic INTEGER NOT NULL DEFAULT 50, results TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, decided_at TEXT);

    CREATE TABLE seo_pages (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      path TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      keyword TEXT NOT NULL DEFAULT '', position REAL, delta REAL NOT NULL DEFAULT 0,
      clicks TEXT NOT NULL DEFAULT '[]', health TEXT NOT NULL DEFAULT 'green',
      updated_at TEXT NOT NULL, UNIQUE (store_id, path));

    CREATE TABLE geo_prompts (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      prompt TEXT NOT NULL, model TEXT NOT NULL, placement TEXT NOT NULL DEFAULT 'not_cited',
      snippet TEXT NOT NULL DEFAULT '', history TEXT NOT NULL DEFAULT '[]',
      checked_at TEXT NOT NULL);

    CREATE TABLE redirects (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      source TEXT NOT NULL, target TEXT NOT NULL, code INTEGER NOT NULL DEFAULT 301,
      UNIQUE (store_id, source));
    `,
  },
  {
    name: '004_research_and_page_content',
    sql: `
    -- The page a product renders is more than a description: benefits, a
    -- comparison, specs, questions and a guarantee. They are one JSON column
    -- because they are written together, from the same research, in one pass.
    ALTER TABLE products ADD COLUMN content TEXT NOT NULL DEFAULT '{}';

    -- What was uploaded or pasted to seed the store, so the imagery and the
    -- research can be regenerated from the same source later.
    ALTER TABLE stores ADD COLUMN reference_image TEXT NOT NULL DEFAULT '';
    ALTER TABLE stores ADD COLUMN reference_url TEXT NOT NULL DEFAULT '';

    CREATE TABLE store_research (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'rules', brief TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE INDEX store_research_store ON store_research(store_id, created_at DESC);
    `,
  },
  {
    name: '005_pages_bundles_payments',
    sql: `
    -- A page is either a list of blocks or a raw HTML document. Cloned pages
    -- start as HTML; built pages start as blocks; either can be switched.
    CREATE TABLE pages (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL, handle TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'landing',
      mode TEXT NOT NULL DEFAULT 'blocks', blocks TEXT NOT NULL DEFAULT '[]',
      raw_html TEXT NOT NULL DEFAULT '', head_html TEXT NOT NULL DEFAULT '',
      seo TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
      source_url TEXT NOT NULL DEFAULT '', is_home INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (store_id, handle));
    CREATE INDEX pages_store ON pages(store_id, status);

    CREATE TABLE bundles (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      tiers TEXT NOT NULL DEFAULT '[]', style TEXT NOT NULL DEFAULT '{}',
      promotion_id TEXT, status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, UNIQUE (store_id, product_id));

    ALTER TABLE orders ADD COLUMN payment_provider TEXT NOT NULL DEFAULT 'demo';
    ALTER TABLE orders ADD COLUMN payment_intent_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN payment_customer_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN payment_method_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN shipping_option_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE orders ADD COLUMN upsell TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE carts ADD COLUMN shipping_option_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE carts ADD COLUMN payment_intent_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE carts ADD COLUMN checkout TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    name: '006_dropshipping_and_funnels',
    sql: `
    -- Where a product comes from and what it costs: the numbers a dropshipper
    -- actually runs the business on.
    ALTER TABLE products ADD COLUMN supplier TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE orders ADD COLUMN supplier_order TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE orders ADD COLUMN delivered_at TEXT;
    ALTER TABLE orders ADD COLUMN downsell TEXT NOT NULL DEFAULT '{}';
    ALTER TABLE carts ADD COLUMN abandon_emailed_at TEXT;

    -- A page can be one version of a product's page, weighted for a split test.
    ALTER TABLE pages ADD COLUMN product_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE pages ADD COLUMN role TEXT NOT NULL DEFAULT 'page';
    ALTER TABLE pages ADD COLUMN weight INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE pages ADD COLUMN format TEXT NOT NULL DEFAULT '';
    ALTER TABLE pages ADD COLUMN direction TEXT NOT NULL DEFAULT '';

    CREATE TABLE funnels (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL, product_id TEXT NOT NULL DEFAULT '',
      advertorial_page_id TEXT NOT NULL DEFAULT '', offer_page_id TEXT NOT NULL DEFAULT '',
      bump TEXT NOT NULL DEFAULT '{}', upsell TEXT NOT NULL DEFAULT '{}', downsell TEXT NOT NULL DEFAULT '{}',
      thankyou TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);

    CREATE TABLE questions (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL DEFAULT '',
      asker TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL);
    CREATE INDEX questions_product ON questions(product_id, status);

    CREATE TABLE stock_alerts (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      variant_id TEXT NOT NULL, email TEXT NOT NULL, notified_at TEXT, created_at TEXT NOT NULL,
      UNIQUE (store_id, variant_id, email));

    CREATE TABLE ad_spend (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      day TEXT NOT NULL, platform TEXT NOT NULL, amount_cents INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
    CREATE INDEX ad_spend_store ON ad_spend(store_id, day);
    `,
  },
  {
    name: '007_ads_domains_avatars',
    sql: `
    -- A domain is either hosted here (CNAME to the edge) or forwarded by the
    -- registrar to the store's public address. What the last check actually
    -- found is kept, so "not verified" always says why.
    ALTER TABLE domains ADD COLUMN mode TEXT NOT NULL DEFAULT 'host';
    ALTER TABLE domains ADD COLUMN registrar TEXT NOT NULL DEFAULT '';
    ALTER TABLE domains ADD COLUMN last_check TEXT NOT NULL DEFAULT '{}';

    -- Who the pages and ads are written for. Suggested from research, edited
    -- by hand, chosen per generation.
    CREATE TABLE avatars (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL, body TEXT NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'research',
      selected INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX avatars_store ON avatars(store_id);

    -- A competitor's page selling the same product, read for its angle.
    CREATE TABLE competitor_sites (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX competitor_sites_store ON competitor_sites(store_id);

    -- Ads: drafted from research, an avatar and a direction; edited by hand.
    CREATE TABLE ads (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL DEFAULT '', platform TEXT NOT NULL DEFAULT 'meta', format TEXT NOT NULL DEFAULT 'static',
      name TEXT NOT NULL, direction TEXT NOT NULL DEFAULT '', avatar_id TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX ads_store ON ads(store_id, status);

    -- The swipe file: ads worth learning from, wherever they came from.
    CREATE TABLE ad_inspiration (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      source TEXT NOT NULL DEFAULT 'paste', brand TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
    CREATE INDEX ad_inspiration_store ON ad_inspiration(store_id);
    `,
  },
  {
    name: '008_models_per_store',
    sql: `
    -- Which model writes what, per store: {"research":"anthropic:claude-opus-5"}.
    -- Empty means the environment default. The plan and credit columns from
    -- the SaaS scaffolding stay in place but nothing reads them any more.
    ALTER TABLE stores ADD COLUMN models TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    name: '009_build_market_creative',
    sql: `
    -- How this store is being built: the mode (copy a funnel, copy a funnel
    -- without its angle, or bring your own product), what the owner answered
    -- about the buyer (with "I don't know" kept as an answer), and which
    -- steps were skipped on purpose.
    ALTER TABLE stores ADD COLUMN build TEXT NOT NULL DEFAULT '{}';
    -- Overrides for the generated legal pages: company, contact, address.
    ALTER TABLE stores ADD COLUMN legal TEXT NOT NULL DEFAULT '{}';

    -- Planning documents saved under the store: market analysis, the product
    -- overview, the ad plan, feedback loops. One JSON body per document.
    CREATE TABLE market_docs (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '{}',
      source TEXT NOT NULL DEFAULT 'rules', model TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX market_docs_store ON market_docs(store_id, kind, updated_at DESC);

    -- A sub-avatar is an avatar with a parent; the body carries the category
    -- fields (desire, experience, emotion, behaviour, demographic, label).
    ALTER TABLE avatars ADD COLUMN parent_id TEXT NOT NULL DEFAULT '';

    -- Creative work that needs a human before it is used anywhere: photo
    -- briefs to shoot, synthetic UGC concepts to vet, GIFs to approve.
    CREATE TABLE creative_queue (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX creative_queue_store ON creative_queue(store_id, status, kind);

    -- Funnels in the same test group split traffic by weight at /go/:group.
    ALTER TABLE funnels ADD COLUMN test_group TEXT NOT NULL DEFAULT '';
    ALTER TABLE funnels ADD COLUMN weight INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: '010_custom_blocks',
    sql: `
    -- Blocks a store defines for itself, by the owner or by the model, when
    -- no block in the catalog does the job: a name, the fields the settings
    -- panel shows, an HTML template over those fields, and its CSS. They
    -- sit in the builder palette under "Custom" and render like any other.
    CREATE TABLE custom_blocks (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      type TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '✚', fields TEXT NOT NULL DEFAULT '[]',
      template TEXT NOT NULL DEFAULT '', css TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (store_id, type));
    `,
  },
  {
    name: '011_custom_block_js',
    sql: `
    -- A custom block may need a script (a tab switcher, a counter); it runs
    -- once per page that uses the block. Store-wide css and js live on the
    -- theme.
    ALTER TABLE custom_blocks ADD COLUMN js TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    name: '012_tracking_snapshots',
    sql: `
    -- 17TRACK is polled on demand and cached. This keeps the public tracking
    -- page fast and avoids spending an API quota on every customer refresh.
    CREATE TABLE tracking_snapshots (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      tracking TEXT NOT NULL, carrier TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', sub_status TEXT NOT NULL DEFAULT '',
      estimate TEXT NOT NULL DEFAULT '{}', events TEXT NOT NULL DEFAULT '[]',
      registered_at TEXT, synced_at TEXT, error TEXT NOT NULL DEFAULT '',
      UNIQUE (store_id, tracking));
    CREATE INDEX tracking_order ON tracking_snapshots(store_id, order_id);
    `,
  },
  {
    name: '013_growth_automation',
    sql: `
    -- Localized storefronts keep product prices in the store's base currency
    -- and convert once, at the cart boundary. Rates are deliberately owned by
    -- the operator rather than fetched during checkout.
    ALTER TABLE regions ADD COLUMN locale TEXT NOT NULL DEFAULT 'en-US';
    ALTER TABLE regions ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1;

    -- First/last touch lives with the anonymous first-party session; the order
    -- snapshot is immutable so reports do not change when a visitor returns.
    ALTER TABLE sessions_analytics ADD COLUMN attribution TEXT NOT NULL DEFAULT '{}';
    CREATE TABLE order_attribution (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL, first_touch TEXT NOT NULL DEFAULT '{}',
      last_touch TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
      UNIQUE (store_id, order_id));
    CREATE INDEX order_attribution_store ON order_attribution(store_id, created_at DESC);

    -- Meta CAPI and TikTok Events API are delivered from a durable outbox.
    -- A shared event id is also handed to browser pixels for deduplication.
    CREATE TABLE server_event_deliveries (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      provider TEXT NOT NULL, event_id TEXT NOT NULL, event_name TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'queued',
      attempts INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, sent_at TEXT, UNIQUE (store_id, provider, event_id));
    CREATE INDEX server_events_store ON server_event_deliveries(store_id, status, created_at);

    -- Native lifecycle flows and their idempotent delivery ledger.
    CREATE TABLE marketing_flows (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT NOT NULL, trigger_kind TEXT NOT NULL, delay_hours INTEGER NOT NULL DEFAULT 0,
      subject TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
      sent_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE (store_id, trigger_kind));
    CREATE TABLE marketing_flow_deliveries (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      flow_id TEXT NOT NULL REFERENCES marketing_flows(id) ON DELETE CASCADE,
      event_key TEXT NOT NULL, recipient TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
      email_send_id TEXT, error TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, sent_at TEXT,
      UNIQUE (flow_id, event_key));
    CREATE INDEX marketing_flow_store ON marketing_flow_deliveries(store_id, created_at DESC);

    -- Requests are queued independently of the chat/run ledger so several
    -- voice or typed jobs can wait while the current agent run is executing.
    CREATE TABLE assistant_queue (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL, text TEXT NOT NULL, page TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'queued', run_id TEXT, error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT);
    CREATE INDEX assistant_queue_store ON assistant_queue(store_id, status, created_at);
    `,
  },
  {
    name: '014_server_event_backoff',
    sql: `
    ALTER TABLE server_event_deliveries ADD COLUMN next_attempt_at TEXT;
    `,
  },
  {
    name: '015_base_order_totals',
    sql: `
    -- A charged order keeps its regional currency, while this immutable base
    -- snapshot makes dashboard, profit and attribution totals comparable.
    ALTER TABLE orders ADD COLUMN base_total_cents INTEGER;
    `,
  },
  {
    name: '016_ad_clicks',
    sql: `
    ALTER TABLE ad_spend ADD COLUMN clicks INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    name: '017_order_notes',
    sql: `
    ALTER TABLE orders ADD COLUMN notes TEXT NOT NULL DEFAULT '';
    `,
  },
  {
    name: '018_environment_brand',
    sql: `
    ALTER TABLE store_environments ADD COLUMN brand TEXT NOT NULL DEFAULT '{}';
    UPDATE store_environments SET brand = (SELECT brand FROM stores WHERE stores.id = store_environments.store_id);
    `,
  },
  {
    name: '019_password_resets',
    sql: `
    CREATE TABLE password_resets (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE, expires_at TEXT NOT NULL,
      used_at TEXT, created_at TEXT NOT NULL);
    CREATE INDEX password_resets_user ON password_resets(user_id, created_at DESC);
    `,
  },
  {
    name: '020_block_presets',
    sql: `
    -- A configured section can be named once and reused on any of this
    -- owner's stores or funnels. The definition remains in the catalog (or
    -- the owner's shared custom-block catalog); this table stores the chosen
    -- settings, not another rendering implementation.
    CREATE TABLE block_presets (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
      name TEXT NOT NULL, block_type TEXT NOT NULL, settings TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (owner_id, name));
    CREATE INDEX block_presets_owner ON block_presets(owner_id, updated_at DESC);
    `,
  },
  {
    name: '021_page_revisions',
    sql: `
    -- Every deliberate builder save is recoverable. Page revisions are kept
    -- separately from storefront publishing because a page can be restored
    -- without rolling back the entire store theme and catalog.
    CREATE TABLE page_revisions (
      id TEXT PRIMARY KEY, page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL DEFAULT '{}',
      note TEXT NOT NULL DEFAULT 'Saved', created_at TEXT NOT NULL,
      UNIQUE (page_id, version));
    CREATE INDEX page_revisions_page ON page_revisions(page_id, version DESC);
    `,
  },
  {
    name: '022_page_template_library',
    sql: `
    CREATE TABLE page_templates (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      source_store_id TEXT REFERENCES stores(id) ON DELETE SET NULL,
      name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'page',
      snapshot TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX page_templates_owner ON page_templates(owner_id, updated_at DESC);
    `,
  },
  {
    name: '023_media_rebrands',
    sql: `
    CREATE TABLE media_rebrands (
      id TEXT PRIMARY KEY, store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      actor_id TEXT NOT NULL, request_key TEXT NOT NULL DEFAULT '', source_url TEXT NOT NULL, original_url TEXT NOT NULL DEFAULT '',
      result_url TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, spec TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued', phase TEXT NOT NULL DEFAULT 'Waiting to start',
      provider_task TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
      changes TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE INDEX media_rebrands_store ON media_rebrands(store_id, created_at DESC);
    CREATE UNIQUE INDEX media_rebrands_request ON media_rebrands(store_id, request_key) WHERE request_key <> '';
    `,
  },
]

function migrate(db: Db) {
  db.exec('CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const applied = new Set(db.all<{ name: string }>('SELECT name FROM migrations').map((row) => row.name))
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue
    db.handle.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.run('INSERT INTO migrations (name, applied_at) VALUES (?, ?)', migration.name, now())
      db.handle.exec('COMMIT')
      log.info(`applied ${migration.name}`)
    } catch (error) {
      db.handle.exec('ROLLBACK')
      throw error
    }
  }
}

let singleton: Db | null = null

export function getDb(): Db {
  if (!singleton) singleton = new Db(process.env.AMBORAS_DB ?? 'data/amboras.db')
  return singleton
}

export function setDb(db: Db) {
  singleton = db
}
