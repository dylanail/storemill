# Whole-site and funnel cloning

All assets → Clone from a link and Pages → Whole site / funnel create a separate draft asset. The importer follows reachable home, menu, policy, product, cart, checkout, upsell, downsell and confirmation pages. It follows branded landing/shop/main-domain links, removes tracking-only duplicates, keeps meaningful step queries, and prioritizes resolved next steps. The default limit is 250 pages (up to 1,000 through the importer); the report lists remaining links when a limit is reached.

Funnelish links such as `#next-step` are resolved through the public navigation service using public page identity and an empty customer in test mode. Source order, opt-in, subscription and payment endpoints are never submitted. The source is rendered at desktop, tablet and mobile sizes, media is copied locally, executable source scripts are removed, and internal links point to the owned pages. Unlinked or protected content needs a public direct URL. External payment sessions cannot become owned payment accounts.

Clones run as persistent background jobs. The progress page shows an estimated percentage, current task/URL, copied and discovered pages, product count and image count. Navigating away or losing the browser connection does not cancel a clone. Reopen it under Recent site clones in All assets. Cancel explicitly from the progress page. A server restart marks an interrupted job for review instead of silently starting a duplicate. The finished report lists every copied page and its associated product, failures and any incomplete commerce/media.

## Catalog and sales behavior

Public Shopify product data, structured Product offers, Funnelish product configuration and supported copied bundle widgets supply owned catalog records. Prices can come from a later checkout rather than the initial page. Explicit total prices, compare-at prices, availability, source variant identities, package-specific gifts and free shipping are retained. Per-bottle display copy is not substituted for the package total. Recurring offers or unsupported variant matrices are reported for review instead of becoming guessed one-time prices.

Each checkout is associated with its own products and source order bump. Alternate source checkouts remain separate editable pages, including versions with different prices. The main entry and cart select the matching checkout, and the package chooser only lists that checkout's products. Selecting a package refreshes the correct order bump and server-calculated totals. A removed package cannot leave its earned gift or free-shipping benefit behind.

Post-purchase pages are saved as an editable sequence in Funnel flow. Every copied offer has its own product/options, discount, accept destination and decline destination. Source CTA product IDs select the correct owned offer. Merchants can edit each step and its page; independent local funnel copies remap those step links. A source navigation resolver exposes the public next destination; private conditional experiments and customer-specific rules still require merchant configuration.

The owned offer renderer preserves copied page markup and adds explicit, server-priced purchase controls. Successive offers use persistent, per-order quotes and idempotent Stripe payment identities. Inventory is reserved before payment; retries do not append duplicate order lines. Pending payments retain their quote, and definitive failed/cancelled intents release the reservation. The copied confirmation page displays the owned order's lines and totals. Catalog and pages remain drafts until reviewed/published, and payments use this asset's connected account. Public copying does not provide the source merchant's credentials, fulfillment account, private inventory counts or payment history.

## Duplicating an existing asset

Funnels → Clone whole funnel duplicates its advertorial, offer, saved steps, linked local pages and checkout/post-purchase templates. Pages and native blocks receive independent IDs and handles; copied links and offer destinations point to copied pages. The duplicate is paused, with zero traffic weight and no split-test group, and its pages are drafts. This local campaign copy shares the store's products and media.

All assets → Duplicate creates an independent store/funnel, including its catalog, promotions, gift mappings, theme and local media. Credentials, customers, orders, connected domains, analytics and in-progress jobs are excluded.

Tests cover public navigation, recursive menus/policies, cross-subdomain links, tracking deduplication, downstream price discovery, gifts/free shipping, independent flow copies, repeated offers and payment retries, owner-scoped background jobs, progress across navigation, source package cards, alternate checkouts and dynamic order bumps.
