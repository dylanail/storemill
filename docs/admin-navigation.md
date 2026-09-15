# Admin navigation

The sidebar separates day-to-day commerce, sales channels and tools. Top-level Products, Marketing and Analytics links navigate directly; their adjacent chevrons reveal related pages. Other group headings expand their children. The selected destination is the only link with `aria-current="page"` and uses a white rounded highlight on a neutral gray sidebar. Child links use indentation rather than a second set of icons.

| Group | Destinations |
| --- | --- |
| Main navigation | Home, Orders, Products, Customers, Marketing, Discounts, Analytics, Content |
| Products | Reviews, Collections, Bundles |
| Marketing | Ad campaigns |
| Analytics | A/B tests, Profit reports |
| Content | Media & logos, Page templates |
| Online store / Funnel | Theme & navigation or Funnel flow, Store/Funnel pages, Performance, Domains |
| Sales channels (store assets) | Funnels |
| Tools | Assistant, AI studio, Integrations |
| AI studio | Store/Funnel builder, Customer research, Market strategy, Ad creative |
| Fixed footer | Stores & funnels, Settings |

“Stores & funnels” replaces the ambiguous “All assets” workspace label; media pickers still use “assets” to describe files. “Analytics” replaces “Insights,” while “A/B tests” and “Profit reports” make the report destinations clearer. URLs and permission scopes are unchanged.

The current store selector searches authorized stores and funnels, groups them by type, marks the current choice, and links to workspace management/creation. It supports keyboard navigation and dismissal. Sidebar expansion preferences persist locally; the selected page's ancestors always open when navigating to it. The mobile drawer has a backdrop, Escape dismissal, focus containment and scrollable navigation, with Settings reachable at the bottom.

Reference: [Shopify admin navigation](https://help.shopify.com/en/manual/shopify-admin/shopify-admin-overview). The implementation is native Storemill navigation and retains its existing commerce, editor and assistant features.

## Account pages and optional setup

Account pages use a compact header with **Stores & funnels**, **New store or funnel**, and sign-out. They do not choose a store implicitly. Open a store to use its sidebar and store-specific settings.

**Domains** remains under Online store / Funnel. Its **Custom domain checklist (optional)** starts collapsed under the page title; the hosted Storemill address is usable without completing it. It is not a launch gate or an extra top-level navigation item.

**Recent site clones** on Stores & funnels shows active jobs with an estimated percentage, progress bar, current task and copied-page count. It polls every 1.5 seconds, retries a lost connection and stops when the job finishes, fails or is cancelled. Completed jobs show 100% and open the copied site.
