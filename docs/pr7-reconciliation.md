# PR #7 reconciliation after #8 and #9

The integration combines `ab80efc` (PR #7) with `fd0369f` (main after PR #9). Main already contained adapted versions of much of #7, so overlapping implementations are reconciled into one active implementation.

## Preserved behavior

| Area | Combined result |
| --- | --- |
| Account and authentication | Password recovery, invitation redemption, role checks, private previews and publish/pause controls retain main's implementations. Accounts without stores get an account hub and can leave onboarding. Existing accounts retain the searchable store/funnel picker and asset management, with publication details and a direct Build link. |
| Research and creative | Product qualification, landed-cost pricing, buyer answers, avatar selection and tool-result-based responses remain. Market analysis and feedback loops reach the ad/page writers; ad-plan rows can be drafted directly. ROAS thresholds and click costs are visible in the admin. |
| Commerce | Main's owned checkouts, regional totals, payment idempotency, imported funnel sequences, preview isolation, exact pack totals and visual discounts stay intact. An explicit zero experiment weight remains zero. Engraving text is retained in cart/order line items and displayed with the variant; a different inscription for an existing variant is rejected rather than silently overwritten. |
| Editor and media | Main's visual HTML/block editor, revision checks, templates, shared galleries, original uncropped media, rebranding, and verified speed repairs remain. No older editor implementation replaces them. |
| Content and support | Main's scheduled blog publishing and feeds remain, with one blog panel. Contact submissions appear in settings. Storefront reviews require moderation; enabled review, companion-product and contact components render actual content. Shipping copy reads the store's policy. |
| Email and integrations | Main's marketing flows remain. The separate seven-day delivery review request runs hourly, retries failed delivery and prevents overlapping sweeps within the process. Delivery/refund/stock emails and review links use the store's public address. Saving integration settings retains sealed credentials. Directory entries have unique identifiers. |
| Analytics | Durable visitor assignment, attribution and the current browser/server event pipeline remain. The old cart-page-only analytics hook is superseded by that pipeline. |

## Database upgrade

Main's applied migrations 001–027 keep their names and SQL. The review scheduler adds `028_review_requested`; it does not reuse #7's conflicting migration numbers. The `experiments` table remains because main's experiment engine uses it. The obsolete-table removal from #7 is deliberately not applied.

A regression reconstructs a database at migration 027 and reopens it with the combined code. It verifies that existing migration records, imported page HTML, all nine original gallery images, exact bundle prices and quantity modes survive, and that reopening applies the new migration only once.

## Validation

Run `npm run test:all` for TypeScript, backend/HTTP and browser regressions. `test/reconciliation.test.ts` adds upgrade preservation, engraving persistence, failed/concurrent review delivery and content/settings integration checks. GitHub's Production checks also audit dependencies, build the production container and check its health endpoint.
