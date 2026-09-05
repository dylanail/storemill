# Copying sites and reusing designs

The page editor supports padding controls, section dragging, desktop/tablet/mobile editing, and saved revisions. This upgrade extends the copy flow and shared template library.

## Copy an external site or funnel

Use **Copy from URL** in the stores/funnels hub. The importer follows linked pages and declared next-step URLs, preserves meaningful query parameters, and maps copied navigation to the new site. Add known unlinked steps under the extra URLs field.

The import report shows copied/discovered counts, failed URLs, remaining URLs, and external payment steps. Discovery defaults to 50 pages; the API accepts a limit up to 100. Unlinked, authenticated, session-only, or protected pages cannot be guaranteed by crawling. Partial imports report the gaps.

Public URL copies now render the source in a fresh browser, scroll through desktop/tablet/mobile layouts, wait for image decoding, and snapshot embedded review documents before removing source scripts. Embedded snapshots retain their CSS and owned images in scriptless, responsive frames. A browser capture failure stops the copy instead of silently switching to incomplete raw HTML.

Copied pages retain responsive CSS, nested stylesheet imports, lazy images, background/image-set URLs, SVG references and responsive image candidates. There is no default per-page or per-site image count cap. Downloads use bounded concurrency, retries, cancellation and a 12MB per-file upload limit; an explicit caller limit or unavailable asset appears in the report.

Open **Page settings → View copy report** in the editor for the saved per-page inventory, including every failed/skipped URL and reason. Page discovery and image completeness are separate checks. Assets that are protected, unavailable, generated only in unsupported embedded widgets, or omitted by a source at capture time cannot be asserted identical; these cases need review.

Copied pages retain responsive CSS, nested stylesheet imports, lazy images, and localized image sources. Scripts from the source site are replaced by supported first-party interactions for menus, galleries, offers, forms, carts, and checkout.

## Duplicate an existing asset

Choose **Duplicate store/funnel** on an existing asset. It copies every saved page, products and variants, collections, funnel steps, bundles, promotions, markets, shipping configuration, custom blocks, media, and current draft branding/theme. The duplicate gets independent identifiers and draft pages/products.

Connect the destination payment provider before publishing. Customer records, orders, credentials, domains, and publication history remain with the original asset.

## Template library

- Open **Template library** in the navigation. Save a page by URL and choose its page type.
- In **Page settings**, edit the page link, page type, and connected product. Use **Save page to library** to save the current edits as a full-page template.
- Select a copied section and choose **Save section**. Its responsive design is included. Native blocks use **Save to library**.
- Reuse saved designs from any of your sites. Whole pages create a new draft; saved blocks also appear under **Add** in the editor.
- Choose a destination product when applying a design. Source product connections are remapped; source variant IDs are cleared because variants belong to their own catalog.

## Commerce behavior

Funnels go directly to checkout. They can arrive with an empty order and choose a published package, variant or quantity bundle there. Changing that choice replaces the main order using verified catalog prices and configured discounts, while retaining contact details, shipping and discount code. An unfinished Stripe payment is canceled before changing the package; an in-progress payment cannot be changed.

Stores keep their copied cart drawers and carry the selected items into checkout. In a copied page's visual editor, **Edit cart drawer** opens the original drawer so its content and styling can be changed; this temporary open state is never saved. Preview tests the functional cart.

Entering checkout does not create or automatically add shipping protection. Only a merchant's explicitly configured order add-on is offered, and the shopper must select it.

Copied purchase controls use the destination catalog. Variant selection must match; unsupported recurring subscription offers cannot silently purchase a one-time package. The importer can extract explicitly priced one-time Funnelish packages when structured product data is unavailable. Copied quantity bundles retain their source labels, while actual totals use validated server prices. Any source label/price inconsistency appears in copy notes for review.

Copied checkout pages retain the available source shell while the platform supplies the contact/delivery form, live order summary, and payment controls. Stripe PaymentIntents and signed webhooks use the store's own connection. Order completion verifies the cart/store, amount, currency, and successful payment status; repeated callbacks/webhooks do not create another order.

The supported capture mode is Automatic. Existing Manual settings remain unchanged and must be explicitly switched before checkout can charge. The Payments page shows the correct store webhook URL.

Draft catalog products are editable and selectable in the editor. Public commerce uses published products. An empty funnel with only draft or unavailable products shows that no package is available and disables payment. The saved Rosabella copies can retain their source design for editing while their draft catalog remains unavailable for purchase. No product or page is automatically published by this repair. Keep copies as drafts while reviewing prices, inventory, shipping, and product connections.

## Verification

Run `npm run typecheck`, `npm test`, `npm run test:editor`, `npm run test:storefront`, `npm run test:commerce`, and `npm run test:capture`. Browser tests use Playwright Chromium or an installed Chrome.

Optional real imported documents can be supplied with `EDITOR_IMPORT_FIXTURE`, `STOREFRONT_IMPORT_FIXTURE`, `STOREFRONT_IMPORT_ASSETS_ROOT`, and `IMPORTED_CHECKOUT_FIXTURE`. These paths let local browser tests exercise actual imported markup without checking large third-party documents into the repository. All purchase tests use isolated databases and a mocked Stripe provider.

The September 2026 audit used the existing Nuvana and Rosabella imports as visual references and checked generated pages at 1440, 820, 390, and 320 pixels. Nuvana's hosted Shopify checkout returns 403 to a stateless request; its checkout uses the platform's branded layout rather than a copy of that protected session page.

## Browser runtime

Playwright is a production dependency. The Docker image installs Chromium and its system dependencies. For a local installation, run `npx playwright install chromium`, or set `PLAYWRIGHT_EXECUTABLE_PATH` to the browser executable. Installed macOS Chrome is detected automatically. Capture uses fresh browser contexts; source forms, cart mutations and payment requests are blocked.

Static HTML fixtures can explicitly use `captureMode: 'static'` or `fetchImpl`; their report does not imply JavaScript content was captured. `sourceCapture` accepts pre-rendered HTML and embedded documents for reproducible audits.
