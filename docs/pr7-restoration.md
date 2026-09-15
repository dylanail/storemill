# PR #7 behavior restoration and copy scope

This follow-up checks the original #7 tip (`ab80efc`) against the result after #8/#9 and the reconciled main (`be311da`). It restores useful behavior that remained missing without replacing the newer visual editor, original-media gallery, checkout, regional pricing or offer builder.

## Restored behavior

- GA4 and browser-only TikTok receive add-to-cart events on native and copied pages. Redirects and AJAX responses carry the same ID used by the server event queue. Browser delivery is deduplicated; Meta retains its existing independent dispatcher. Preview pages emit none of these events.
- Product qualification accepts clearly labeled currency amounts instead of an unlabeled cents field. The research method, readable trend choices, differentiation guidance and non-USD threshold notice return. Existing stored cents and older form/API payloads remain supported.
- Store Speed defaults to the live environment for live stores and offers an explicit draft/live choice. Verified repairs and undo remain on the draft view.
- The optional custom-domain checklist is visible and reflects actual verification.
- Stores & funnels uses the account shell for existing accounts too, without a selected-store rail, assistant or publish control. Current asset cards, search, type filters, management actions, public addresses and metrics remain.
- HTML product versions inherit the public product title, description and canonical URL, matching native block versions.
- Review, domain and shipping prompt suggestions return alongside the newer suggestions. Onboarding completion points to Build for next steps and partial failures.
- Switching the default shipping region is transactional again and cannot silently unset the only default.

## Copying a page versus copying a site

Both URL-copy forms expose three scopes:

| Scope | Pages copied | Destination |
| --- | --- | --- |
| One page only | The starting URL only | Current site from Pages; a new draft from Stores & funnels |
| Only the pages I list | Starting URL plus the explicitly listed URLs, deduplicated | New draft |
| Whole site | Readable linked pages plus additional starting URLs and their linked pages | New draft |

Only whole-site mode follows links and may generate a missing checkout. Page and listed-page modes copy the media and related product data needed by those pages, but do not add other page documents. Contradictory one-page requests with extra URLs are rejected, not silently expanded. Durable jobs store their scope and the progress screen states it. Existing persisted jobs without a scope retain whole-site behavior.

The existing local-copy actions are labeled **Duplicate page only**, **Duplicate whole store/funnel**, and **Clone whole funnel** to distinguish their boundaries.

## Original #7 intent ledger

“Retained” below identifies implementations carried into the current branch, often expanded by #8/#9. It is a mapping of original intent, not a claim that every live third-party integration has been exercised.

| Original commit | Intent | Current disposition |
| --- | --- | --- |
| `a21f511` | Sign-in and account flow | Empty-account escape retained; separate account shell restored for existing stores too |
| `caa0917` | ROAS thresholds and click price | Retained in supplier/profit/behavior views |
| `86531fb` | Checklist links and real readiness | Domain verification item restored alongside existing catalog/payment/shipping/publish checks |
| `1add2f0` | Publish opens the store; pause closes it | Retained with newer store/funnel controls |
| `e166220` | Demo orders, configured bumps and real refunds | Retained through newer checkout/order/payment implementations |
| `a3a6380` | Storefront claims backed by actual store data | Retained |
| `5460063` | Working bumps and post-purchase offers | Retained and extended to linked offer sequences |
| `9a54455` | Agent promises match available tools | Retained |
| `8d7e63c` | Integration/domain actions and operational emails | Retained; discovery prompts restored |
| `bfbe2ea` | Private drafts, bounded discounts and clearable copy | Retained through newer preview isolation, promotion math and editing |
| `7fe509c` | Funnel second steps and revenue-based test decisions | Retained with newer linked funnels and experiments |
| `9d6ffde` | Research method informs generated pages | Retained |
| `f04ca38` | Invitation acceptance and accurate documentation | Retained |
| `005c7d6` | Build order based on actual store state | Retained; completion guidance points to Build again |
| `4a9235b` | Roles constrain consequential actions | Retained |
| `676c726` | Consistent money, reversible settings and relevant popups | Retained |
| `841ed3d` | Product versions keep product SEO identity | Retained for blocks and extended to HTML versions |
| `1280548` | Remove dead-end surfaces | Restored support/components remain; clearer copy scopes avoid a further misleading surface |
| `cdc66ea` | Admin-only store JS, secure cookies, foreign-store refusal | Retained |
| `afba242` | Promised storefront surfaces actually render | Reviews, companion/contact components and engraving retained from reconciliation |
| `e9d6ac2` | Answers use tool results, partial-run reporting, nonblocking builds | Retained; Build follow-through guidance restored |
| `1eddab1` | Sticky tests and editable placed blocks | Retained with newer editor and durable visitor identity |
| `9c8be66` | Editable regions, tax and shipping | Newer regional features retained; atomic default switching restored |
| `50c753a` | Photo briefs, verified ad quotes and variant-specific tiers | Retained with original-media preservation and exact pack pricing |
| `13ad5af` | Selected avatar, live audit, source attribution | Avatar/attribution retained; live audit view restored |
| `93cee6a` | Build-to-launch, actionable plans and learning loops | Retained, including plan-to-ad actions and writer feedback context |
| `a383d8b` | Qualification and landed-cost pricing | Engine retained; form guidance and money input improved |
| `6c519f9` | Safe inline scripts and fewer payment intents | Retained through newer checkout/editor code |
| `7d1eb10` | Shipping arithmetic, funnel totals and dead hooks | Price corrections retained; TikTok/GA4 browser cart dispatch restored. Active experiment storage is intentionally kept |
| `49f4ebc` | Blog administration and unique directory entries | Retained with scheduling/feeds and duplicate-entry cleanup |
| `ab80efc` | Password reset and complete offer content | Retained |

## Validation

Regression coverage checks exact page sets and fetch boundaries for all three scopes, durable job scope, contradictory inputs, browser form state, native/copied cart events and duplicate delivery, product SEO, currency amount persistence, account-level navigation, live/draft audits, domain verification and failed default-region switches. The existing backend/HTTP and browser suites cover the retained editor, media, checkout and offer workflows.
