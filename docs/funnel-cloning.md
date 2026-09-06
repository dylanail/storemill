# Funnel cloning

Pages → Clone a reference page or funnel offers **This page only** and **Whole funnel**. Whole-funnel import creates a separate draft asset, discovers linked steps, copies media and available product data, and rewrites internal links. Add direct URLs for checkout, upsell or thank-you steps that are not linked. The existing copy report identifies blocked pages, incomplete media, and the default 50-page crawl limit. Private/payment-only content still needs an accessible direct URL; a partial copy is reported honestly.

Funnels → **Clone whole funnel** duplicates a local funnel's advertorial, offer, saved steps, linked local pages and matching checkout/post-purchase templates. Pages and native blocks receive independent IDs and handles; copied links point to copied pages. Order bump, upsell, downsell and thank-you settings are retained. The new funnel is paused, with zero traffic weight and no split-test group, and all pages are drafts. Review and publish pages, then select **Active** when ready. This local campaign copy shares the store's products, media and commerce configuration.

Use All Assets → Duplicate for a fully independent store/funnel asset, including its catalog, theme and media. Credentials, customers, orders, connected domains and analytics are excluded from that copy.

Regression coverage checks independent IDs, linked-step rewriting, preserved offer settings, paused traffic, cross-store isolation, and the actual clone button over HTTP in Chromium.
