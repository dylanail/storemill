# Admin controls, assistant, deletion, and Meta tracking

The Theme & navigation preview uses segmented device and Draft/Live controls, with selected, hover, focus, and disabled states. Live uses the published theme inside the private preview route. Draft preview chrome reserves 36px of space and offsets fixed or sticky source headers beneath it. Preview traffic does not emit advertising events.

The business assistant starts collapsed behind a bottom-right launcher, including in the standalone page editor. Its panel supports minimize, Escape, draft-message retention, background request completion, and the existing per-asset conversation history. Sending a request does not reload the editor. Context includes the current asset, route, saved page, selected visual element, and allowlisted visible theme values; arbitrary form fields and credentials are excluded. The assistant uses the platform's existing tools. Imported HTML has scoped read and exact replacement tools with document hashes, revision history, and a bounded read-then-edit planning loop. HTML edits reject stale source and a known unsaved editor state. Open-ended assistance requires a configured model; the existing rules fallback remains available without one.

Stores and funnels can be deleted through All assets → More actions → Delete. The confirmation screen lists the affected data and requires the exact asset name, the current account password, and an explicit acknowledgement. The server requires the owner role and a session-bound confirmation that expires after ten minutes. Queued or running work and active builds block deletion. Deletion is atomic, takes the asset offline, and cascades its database records while keeping an audit entry. Shared templates and shared upload files remain. External provider subscriptions and payments are managed separately.

Meta tracking now loads on copied HTML as well as generated storefront pages. Browser and Conversions API events share the same event name and event ID for PageView, ViewContent, AddToCart, InitiateCheckout, and Purchase. Purchase uses the order ID and only emits for captured payments; refreshing the receipt does not send another browser purchase in the same session. Amounts use the currency's minor-unit scale. Shopper context captured during checkout is retained for webhook-created purchases, so a Stripe request cannot become the shopper's user agent. Contact identifiers are normalized and hashed; browser identifiers remain unhashed. Tokens and Test Events codes stay server-side. The delivery queue retries unsuccessful or unacknowledged responses.

## Meta setup

In Settings → Customer event pixels, enter the asset's Meta Pixel ID. Enter a Conversions API access token to enable server events, and optionally a Test Events code while validating in Events Manager. Remove the Test Events code when finished. A saved integration does not establish account-side delivery by itself; verify actual test events in that asset's Events Manager before relying on reporting.

Implementation references checked on September 4, 2026:

- [Meta Pixel conversion tracking](https://developers.facebook.com/documentation/meta-pixel/implementation/conversion-tracking)
- [Deduplicating Pixel and server events](https://developers.facebook.com/documentation/ads-commerce/conversions-api/deduplicate-pixel-and-server-events)

## Verification

`npm run typecheck`, `npm test`, `npm run test:admin`, `npm run test:editor`, `npm run test:theme`, `npm run test:storefront`, `npm run test:commerce`, and `npm run test:capture` cover backend and browser behavior. The admin browser suite uses an isolated temporary database, a mocked Meta endpoint, and a disposable deletion fixture. The commerce suite uses mocked Stripe payments and signed webhook fixtures. Responsive tests cover desktop, tablet, and mobile. Existing imported Rosabella and Nuvana snapshots are included through the optional fixture environment variables in the theme and editor suites.

These checks verify implementation and payloads; they do not validate real account credentials, actual Meta delivery, or a charged Stripe payment.
