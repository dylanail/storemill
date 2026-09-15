# Theme editor

The dashboard no longer embeds a storefront preview. The explicit Preview action remains available.

Theme settings pair a scrolling settings panel with a scaled desktop/tablet/mobile storefront. Colors are identified by purpose: background, text, cards, solid button, button label, announcement/accent, and borders. The color scheme card and storefront update as settings change. Font selection uses searchable samples rendered in each family, with separate 100–900 thickness choices for headings and body. Imported font-face rules remain available; system families persist after saving.

Rendered imports record computed colors and font weights in an inert `amboras:source-theme` meta element. This takes precedence over framework variables such as Bootstrap's `--primary`. Older imported sites are measured from the theme preview when first opened. Saving records the source palette and selected values in the draft brand. Named source roles are mapped onto matching source colors; source markup is retained. Explicit per-element editor overrides remain later in the cascade. Publishing still uses the existing draft/live workflow.

The visual editor centers a sheet that matches the selected device width. Script-dependent purchase panels and galleries have canvas-only state selectors. These selectors show one panel/image at a time, retain all editable content, and do not enter saved HTML. Images are fitted to the gallery width instead of retaining a stale slider width.

Validation: `npm run typecheck`, `npm test`, `npm run test:editor`, `npm run test:theme`, `npm run test:storefront`, and `npm run test:capture`. Optional `THEME_REAL_FIXTURE` and `THEME_ASSET_ORIGIN` exercise a previously imported Rosabella page using read-only local assets. No test publishes or modifies an existing store.

Design reference: [Shopify theme settings](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/theme-settings) and [color settings](https://help.shopify.com/en/manual/online-store/themes/customizing-themes/theme-editor/color-settings). The implementation uses purpose-based settings and visual font selection within this project's own editor.
