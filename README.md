# storemill

One person's replacement for Shopify and the thirty apps a dropshipper bolts
onto it. Stores and funnels are separate top-level assets over the same
commerce backend: a store is a full Shopify-style catalog, while a funnel is
an advertorial or quiz → PDP → checkout conversion path. The work is research → pages → offers → ads → domains, and a model
does as much of it as a good operator would.

You type one sentence, optionally with a product photo and a site to read.
Customer research is written first: who buys this, what stops them, what
they compare it against, what they pay. From that, the brand and three
products with full pages, a welcome code, a free-shipping threshold and a
bundle, at an address you can open and buy from. Then the dropshipper's loop:
avatars, versions and advertorials under a direction, ads per platform, image
re-shoots, a competitor's page read for its angle, the domain connected with
the registrar's own words.

```
node --version     # 22.18 or newer
npm ci
cp .env.example .env               # a model key, and STOREMILL_SECRET
npm run seed                       # builds the Ironjaw & Co demo store
npm start                          # http://localhost:4100
```

```
npm run test:all     # typecheck, core/HTTP/production regressions, and every browser suite
npm test            # core and HTTP tests; model/service paths use controlled transports
npm run typecheck
npm run reset       # throw the database away and re-seed
```

For a server with TLS, storefront subdomains and custom domains, see
`docs/DEPLOY.md`: one `docker compose up` with Caddy in front, or the same
image on Railway with a volume and the `railway.json` in this repo.

---

## Written by a model

Everything that reads or writes words is authored by a model, chosen per
job: Claude by default (`claude-opus-5`; Fable, Sonnet and Haiku selectable),
or GPT with an OpenAI key. Model ids live in configuration, not code, and
Settings lets each store pick a different model per job.

| Job | What the model writes |
|---|---|
| **Research** | The customer research record: personas with shares, purchase triggers, objections with answers, competitors with price bands and weaknesses, the price anchor, keywords, proof points, the comparison rows. Reads a pasted site into it. |
| **Brand and products** | The name (unless you gave one), the mood the palette follows from, slogan, description, voice, announcement bar, and three products with 150–200 words of copy, options and prices inside the anchor. Rewrites of a product's copy under a steer. |
| **Pages and versions** | Every product page's sections (benefits answering the triggers, comparison, specs, FAQ from the objections, guarantee, shipping, trust strip) and the words inside PDP versions and advertorials in a named format, under a free-form direction and an avatar. |
| **Ads** | Copy per platform and format from the same research, avatar and direction: hooks, primary text, headline, search headlines within Google's limits, timed video scripts. Testimonials quote only approved reviews on file. |
| **Reading pages** | A competitor's page into an editable angle record: headline, hooks, offer, proof, audience, the angle it runs. |
| **The assistant** | The docked panel on every admin page: it sees the store, the conversation and the real tool schemas and answers with tool calls, words, or both. |

Without a key, rules writers stand in so the platform boots, seeds and
tests. They are scaffolding: generic outside a few categories, and the admin
says on every page and every record when it is looking at rules output.

## What is here

| | |
|---|---|
| **All assets** | card grid for every store and funnel with today and 30-day revenue, type filters and per-asset switching; create a blank asset, run the AI build, or paste one store URL to clone its home plus a bounded set of product, collection, content and blog pages into editable local pages |
| **Build** | three ways to build (bring your own product, copy a funnel, copy a funnel with a new angle), each with its own order of work; two shapes the result takes (a Shopify-style store or a funnel) with an advertorial or a quiz in front of either and a popup decision; a page plan that lists every page the shape needs with its status read from what exists and a template for each one missing; step statuses read from the world, not ticked; eight buyer questions where "I don't know" is an answer that research fills in and labels as assumed |
| **Market** | the market analysis (awareness, sophistication, desires ranked, the searches to run, competitors, mechanisms, new information, underserved avatars, whether there is a way to stand out at all), the product overview, core avatars with sub-avatars, the ad plan (concept → angle → variations → format → method) and feedback loops, all saved under the store |
| **Creative** | sixteen photo briefs (the course's eight plus the shots every reference page uses: the pack per tier, the "before" moments, the mechanism diagram, goes-everywhere, the infographic slides, and the expert, origin and texture when there are any) checked against each product's media; creator-content concepts for a real person to film, vetted in a queue and never published as reviews; a dependency-free GIF maker over the product's PNG renders; a layout suggester that picks blocks from the catalog for an offer page, advertorial, quiz, product page or home |
| **Research & avatars** | the research record; avatars suggested from it (who, wants, fears, angle, hooks, tone, first objection), editable and selectable; competitor pages read into editable angle records that fold into the research or become a direction |
| **Products** | options, variants, swatches, media, SEO, supplier cost and margin, size chart, import from any Shopify `/products/x.json` or Open Graph page, structured page content, image re-shoots from a sentence with GPT Image 2 or Gemini 3 Pro Image |
| **Pages & builder** | blocks the store defines for itself (a name, fields, an HTML template in a small language, css) when the catalog has nothing for a section, by the owner or by the assistant through `create_block`; they sit in the palette under Custom and render through the same validated path; the assistant can also drop a one-off `custom-html` section into a page, and the page writers may add a section a layout is missing; css and js wherever they are needed: a `custom-code` block for one page, a block's own css and script (run once per page that uses it), and store-wide css and js on the theme through the designer or `set_store_code`; 73 blocks (Shopify sections, Funnelish elements, advertorial parts, a quiz, the checkout's own pieces, and the parts the reference funnels run on: rating line, big numbers, results timeline, steps, value stack, expert quotes, founder letter, cost of the alternatives, video reviews, research citations, gallery, specs) in a drag-and-drop editor with live preview, HTML mode, a cloner that pulls reference URLs in with their styles and locally owned images, and a funnel rip that keeps only a page's structure: the section order comes back as blocks, every word is rewritten (in the source's angle or yours) and every image becomes a photo brief |
| **Templates** | offer page in the order that turned 1.18x into 3.59x, the long-form sales page, the Shopify-style product page, the science page, the story landing page, advertorial listicle, quiz funnel, product landing page, home page, and the checkout itself as blocks — published, it becomes the store's `/checkout` |
| **Dashboard** | Shopify-style operator home and organized channel/marketing/insights navigation with familiar icons; sales and profit, period-over-period KPIs, conversion funnel, live visitors, fulfillment load, experiments, recent orders, next steps and quick actions |
| **Versions & CRO** | PDP versions and advertorials in named formats with free-form direction; stable per-session assignment; Beta-Bernoulli probability-to-win; minimum-view and purchase guardrails; autonomous winner promotion; exact prior-weight rollback |
| **Funnels** | standalone Funnelish assets have their own navigation and visible ad → advertorial/quiz → PDP/sales page → checkout → post-purchase flow; store assets can still attach optional campaign funnels; test groups split traffic at `/go/<group>` by weight and compare revenue per session |
| **Media** | one per-asset library aggregating uploads, generated images, cloned assets, product and variant media, collections, block pages, imported HTML and creative output, with reusable URLs |
| **Bundles** | Kaching-style tiers enforced by a promotion the cart reads |
| **Checkout** | one page that re-sells the way the reference checkouts do (arrival date above the form, free shipping shown as a saving, the bump, the store's own guarantee and returns numbers under the button, reviews below the form), express row, buy-it-now, Stripe Payment Element with saved cards for the post-purchase offer, demo orders without keys; or laid out in the builder from the checkout blocks (form, summary, bump, steps) with a timer, the rating, the guarantee and proof around the same form |
| **Dropshipping ops** | supplier fulfilment with carrier detection, branded `/track`, live 17TRACK carrier status and event history cached in SQLite, delivery estimates, ad-spend log, profit report with ROAS |
| **Ads** | drafts per product, platform and format; every field editable; revisable; exported for the ad manager; a swipe file fed by the Meta Ad Library, competitor links, pasted ads and hook patterns |
| **Marketing automation** | native consent-aware welcome, abandoned-cart, post-purchase and win-back flows; editable timing and copy, idempotent delivery and a run log |
| **Domains** | host here or forward from the registrar, with the records and menu path for Namecheap, GoDaddy, Cloudflare, Squarespace, Porkbun; real DNS and redirect checks; certificates issued on demand by the edge once a name verifies |
| **Conversion widgets** | recent sales, live viewers, scarcity, free-shipping bar, delivery estimate, payment icons, size chart, customer photos, Q&A, back-in-stock, announcements, compare-at badges and GA4/Meta/TikTok events; each renders nothing when it has nothing honest to say |
| **Commerce core** | products, variants, inventory, collections, customers, carts, orders, fulfilments, refunds and returns; eight promotion types with stacking, audience, market, limit and priority rules; localized markets, currencies, taxes and shipping rates |
| **Storefront** | server-rendered per brand with Google Fonts pairings by mood, Brotli, one external request; home, collections, PDP, cart, checkout, order, offer, track, blog with scheduled publishing plus RSS and Atom feeds, pages, sitemap, robots, JSON-LD, `llms.txt`; a privacy policy and terms of sale generated from how the store is actually configured; one optional popup (exit, delay or scroll; an email for a code, the deal itself, or the quiz; says how long the code is valid; never on the checkout); skip link, landmarks, focus styles, reduced motion; a first-party beacon that records scroll depth, sections seen, buttons pressed, popup and quiz events |
| **Store Speed** | renders the pages as a visitor gets them and checks landmarks, alt text, labels, headings, button names, contrast, estimated HTML weight, scripts, fonts, lazy loading, and the template residue the reference pages shipped ("[confirm]" markers, dead links, placeholder images, counters at zero); every finding has a suggested repair and a verified, undoable AI fix |
| **Plugins** | manifest schema, settings validation, sealed credentials, storefront slots, plugin-contributed tools; eleven first-party integrations installable, the rest a directory |
| **Analytics, pixels, email, backup** | first/last-touch attribution, campaign revenue and ROAS alongside cookieless sessions, KPIs, funnel, live visitors, affinity and behaviour reports; GA4 plus Meta Pixel/CAPI and TikTok Pixel/Events API with shared purchase IDs and a durable retry outbox; transactional and flow email over Resend; one-click store-scoped JSON backup without login sessions |
| **Assistant** | typed or voice requests enter a visible, cancellable queue, run in order and recover safely after a restart; text and image generation models remain selectable per task |

`test/http.test.ts` walks the whole product over HTTP with no mocks,
`test/models.test.ts` walks the model path against a fake network (research,
the brand kit, onboarding, avatars, competitor reading and the planner, with
the exact requests the SDKs send checked), and `test/plan.test.ts` covers
the build flow, the market documents, the funnel rip, the creative queue,
the GIF encoder, the health audit, the legal pages, the popup, the quiz and
the behaviour report.

## What it knows

The writers do not start from nothing. `docs/knowledge/` is a distillation
of the course material the owner supplied: desires and the desire calendar,
awareness and sophistication with the three resets (new mechanism, new
information, new identity), core and sub-avatars, product research, offers,
the numbers and testing methods, creatives, and page anatomy.
`src/agent/knowledge.ts` is the short form, and every prompt asks for the
topics it needs: research reads desires, sophistication and avatars; pages
read page anatomy and offers; ads read creatives; the market analysis reads
all of it. Two rules ride along everywhere: nothing is invented (no review,
statistic, study or customer the merchant did not supply), and synthetic
"UGC" is a brief for a real person to film, never a customer on the page.

## The shape of it

```
src/
  agent/        models (the router), llm (the planner), research, brand, pages,
                directions (formats + versions), ads, avatars, angles, images,
                registry (tools + executor), runtime (durable runs), chat, onboarding
  domain/       the commerce core
  control/      auth, stores and environments, domains, plugins, todos and audit
  pages/        blocks, the builder's store, the cloner, versions
  storefront/   theme, render, routes
  admin/        shell, pages, growth pages, editor, routes
  analytics/ shipping/ email/ seo/ payments/ lib/
```

Five decisions carry the weight.

**Research first; pages say only what it found.** Onboarding writes the
research before a product exists. Product pages, versions, advertorials, ads
and avatars all read the same record, so the promise in the ad is the
promise on the page. Nothing here invents a review, a statistic or a place
of manufacture.

**One pricing engine.** `domain/cart.ts#totals` is the only place a total is
computed: the drawer, the checkout, the written order and the
free-shipping-gap upsell all call it.

**Every tool call is validated and audited.** Every call, from the panel,
onboarding, a plugin or a model, goes through `agent/registry.ts#execute`:
arguments are checked against the tool's own schema, and an audit row is
written whether it succeeded or not. Tools execute; there is no per-turn
permission gate. What keeps a store safe is the next decision.

**Draft and live are separate environments.** The assistant only edits the
draft. Publishing copies it over live and bumps a version; rollback goes the
other way. The publish button says what the store needs next.

**Runs are rows.** An agent run persists its steps, so a restart mid-onboarding
is survivable: finished steps stay finished, and the in-flight step re-queues
on boot. Branches inside a run execute concurrently.

## Configuration

See `.env.example` for everything. The ones that decide what runs:

| Variable | Effect |
|---|---|
| `STOREMILL_SECRET` | master key for password hashing, credential sealing and visitor fingerprints. **Set this in any real deployment.** |
| `ANTHROPIC_API_KEY`, `STOREMILL_MODEL` | Claude writes; the model defaults to `claude-opus-5` |
| `OPENAI_API_KEY`, `STOREMILL_OPENAI_MODEL` | GPT writes (default id `gpt-5`), and GPT Image 2 re-shoots |
| `STOREMILL_TEXT_PROVIDER` | which family answers when both keys are set; `STOREMILL_MODEL_<TASK>` pins one job |
| `GEMINI_API_KEY`, `STOREMILL_GOOGLE_IMAGE_MODEL` | Gemini 3 Pro Image re-shoots |
| `STOREMILL_STOREFRONT_HOST`, `STOREMILL_ADMIN_HOST`, `STOREMILL_EDGE_HOST` | storefronts at `*.host`, the admin's hostname, what custom domains point at |
| `META_AD_LIBRARY_TOKEN` | the Ads tab searches the Meta Ad Library |
| `STOREMILL_META_API_VERSION` | Graph API version for Meta CAPI; defaults to `v25.0` |
| `RESEND_API_KEY`, `STOREMILL_EMAIL_DOMAIN` | email actually sends |
| `STOREMILL_17TRACK_API_KEY` | registers supplier tracking numbers and powers live carrier events on `/track` |

On localhost, `/s/:slug` is the live storefront (tracked, plugins firing) and
`/preview/:slug` is the draft (untracked, pixels suppressed).

## Not built yet

- **Storefront export and the sandboxed build loop.** Stores render here;
  there is no per-store project to edit, build and screenshot. The block
  builder and the cloner are the page-building surface.
- **Subscriptions, Search Console keyword tracking,
  GEO prompt tracking, a custom visual workflow builder, migration
  importers beyond product import.** Listed in `ORIGINAL_INTENT.md` in order.
- **Upsell and post-purchase pages of the reference funnels.** The fifteen
  reference pages and their click-throughs (checkouts, a collection, a home
  page, a bundle page) were read and are broken down in
  `docs/knowledge/reference-pages.md`; the Funnelish upsell and thank-you
  steps only exist after a payment and could not be fetched, so those come
  from the course and the known shape of the builder.
- **Supplier API push and ad placement.** Fulfilment records the supplier
  order; it does not place it with DSers, CJ or AutoDS. Ads are written and
  exported, not published to Meta or TikTok.
- **Stripe is tested against a stand-in transport.** Keys, PaymentIntents,
  saved cards, refunds and webhook verification are wired; live Stripe was
  not reachable from where this was built.

## Where this came from

The platform was first built beside an unrelated project and inherited some
of its shape. `docs/DARWIN_INHERITANCE.md` lists every such decision with the
verdict on each; `ORIGINAL_INTENT.md` is the direction it was built to,
instruction by instruction.

Platform branding is storemill. New deployments may use `STOREMILL_*` settings; existing `AMBORAS_*` settings remain supported. The database path, encryption salt, cookies, saved-page metadata, and browser event hooks retain their existing identifiers for compatibility.

### Funnels and Store Speed

Clone a reference **page or whole funnel** from Pages, including direct URLs for unlinked steps. Existing funnels have **Clone whole funnel**, which copies the linked pages and offer settings into a paused draft. All Assets can duplicate the complete asset and catalog. See [funnel cloning](docs/funnel-cloning.md).

[Store Speed](docs/store-speed.md) now has its own admin screen with suggested fixes, background AI repairs, validation before saving, and undo. The visual editor keeps empty containers available as drop targets and adds **Move to…** and **Fit to content**. See [page editor](docs/page-editor.md).
