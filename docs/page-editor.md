# Visual page editor

The imported-page editor uses the existing saved HTML, page revisions, and product catalog. It does not convert cloned pages into approximate native blocks. The editor is a three-pane workbench: meaningful Layers, an isolated page canvas, and a content-first inspector. Native block pages retain their existing block workflow; their Preview now renders unsaved changes without saving.

## Everyday editing

- Click and drag any editable block directly on the canvas to move it; no preliminary selection is needed. Release at the blue insertion line, or pause inside an empty column to move content into it. Horizontal rows use left/right ordering. Images keep their responsive picture sources when moved. Escape cancels, and Undo restores the previous layout. Native block cards also support direct dragging, including scrolling while dragging.
- Click an element to select it. Text and icons inside a link or purchase button select that action; enter its children using Enter or Layers.
- Double-click text to write in place. Enter commits, Shift+Enter adds a line, Escape cancels. Paste inserts plain text. Ctrl/Cmd+B and Ctrl/Cmd+I create semantic strong/em markup.
- Use the floating toolbar for text/image controls, drag, move up/down, duplicate, and delete. Breadcrumbs navigate the hierarchy without hunting through nested wrappers.
- Padding is always visible above the content/design controls. Edit top, right, bottom, and left independently, or turn on Link sides to update all four. Values update the canvas as you type, accept pixels or CSS lengths, and respect the selected desktop/tablet/mobile size. Reset restores the imported or inherited value. One continuous edit is one Undo step.
- Hover or select content to reveal its section's **Drag section** and **Padding** buttons. Drag the handle, or grab a section's empty background, to reorder it. A blue line previews the insertion point, even over nested text or buttons. Single-child imported wrappers travel with the section. Section drags stay within their source parent; Escape cancels, and Undo restores the original order. Layers can still be used for deliberate nesting changes.
- Content contains text, images, destinations, product connections, and layout for containers. Design contains responsive sizing, typography, appearance, and visibility.
- Replace an image by URL or upload. Replacement clears stale responsive image sources. Undo restores the prior picture sources, image attributes, dimensions, and selection.
- Add sections or add content after/inside a selection. The chooser filters invalid types and can match the nearest similar element's typography, colors, and spacing. Saved HTML sections can be inserted again.
- Search Layers, expand hierarchy, rename, change inferred type, lock, or temporarily show hidden content. Renaming and type changes are organizational metadata.
- Ctrl/Cmd+D duplicates; Delete removes; Ctrl/Cmd+C/X/V copies, cuts, or pastes editor elements; arrows reorder; Shift+Enter selects the parent; Enter selects a child. Text fields keep their native editing shortcuts.

## Column layouts

Select an imported row/grid, a newly added **Columns** group, or a native **Multicolumn** block. The **Columns** panel appears above padding/settings. Choose **Columns per row** (1–6), then type percentages or use the sliders. Changing one width adjusts the others proportionally so the total stays at 100%; **Equal widths** resets the split. Layout tracks divide the available width after gaps so gutters do not cause horizontal overflow.

Use the Desktop, Tablet, and Mobile buttons to edit each layout separately. Changing an imported desktop row starts tablet with at most two columns and mobile with one; customize these independently. Native blocks use their storefront breakpoints (tablet <=820px, mobile <=520px). Imported HTML uses the visual editor breakpoints below.

New Columns groups provide empty drop areas. Increasing their desktop column count adds containers; reducing it moves content into the final remaining container. Imported and native multicolumn content is preserved and wraps to additional rows. Locked columns and original inline `!important` layout declarations remain protected. Counts, weights, and device settings support Undo, Save/reload, and existing template reuse.

## Source preservation and history

The source DOM is annotated with stable `data-pb-id` identifiers. The semantic model hides inert wrappers and formatting spans; it does not insert wrapper elements. Hover, selection, insertion, and drag-target UI live outside the iframe.

An untouched document saves its original source string byte-for-byte. After an edit, the parsed document is serialized with its source styles, editor-owned override sheet, and JSON metadata. `data-pb-id` remains in the saved/public HTML because override selectors and product bindings use it. This is intentionally different from the suggestion document's attribute-stripping export.

Style changes use per-element rules in an editor-owned stylesheet, never shared source classes. The inspector displays original, inherited, and editor-override states with reset controls. If multiple layers share the same classes, users can explicitly choose to affect all of them. This scope is a fixed set of current matching layers, not a rewrite of a shared CSS rule.

Original inline `!important` declarations are reported when they prevent an override; they are not silently rewritten. Code remains available for this uncommon case. The inspector also lists relevant imported media-query conditions read-only.

Content edits, styling, bindings, insertion, duplication, deletion, and dragging all enter one undo path. Continuous text input is one committed undo step. Selection is restored with undo/redo. Session history holds up to 80 operations; the existing server-side save history provides durable revisions. Source saves flush pending canvas refreshes. A response to an older save cannot mark newer edits as saved.

## Responsive design

The canvas uses real 1200/820/390 px iframe viewports, scaled to the available workspace. Switching sizes does not reload the iframe. Desktop overrides apply globally, tablet overrides apply at <=991 px, and mobile overrides at <=767 px. Imported media queries stay intact. Scope is visible before a style change. Visibility is independently overridable at these sizes.

## Product connections

Text can connect to title, price, original price, or description. Images can connect to the product image. Purchase actions use the existing cart and checkout paths with the product's first available variant. Connected content retains the selected element and its styles; disconnecting restores the original content and attributes. Saved pages refresh connections from a small public catalog endpoint that excludes drafts, hidden products, supplier data, and private metadata. Admin product lookups are store-scoped.

## Editing safety

The editing iframe does not execute imported scripts or submit forms. Its canvas endpoint also returns a restrictive sandbox CSP. Preview uses a separate sandboxed frame. This deliberately retains the project's safe import policy instead of executing arbitrary imported JavaScript with access to the admin origin. It does not promise run-once/freeze support for arbitrary third-party widgets.

## Validation

Run `npm run typecheck`, `npm test`, and `npm run test:editor`.

The browser suite uses Playwright and either the installed Chrome executable, `PLAYWRIGHT_EXECUTABLE_PATH`, or Playwright Chromium. CI without Chrome should run `npx playwright install chromium` first.

Five deterministic fixtures cover Shopify-like product markup, Funnelish-like landing markup, WooCommerce-like forms, Webflow-like grids, and a sales letter. For each, tests verify exact untouched source, meaningful selection, navigation suppression, and canvas/reference screenshots with a 0.01% pixel-difference tolerance (small rasterization variation is allowed). A sixth fixture exercises wrapped imported sections and flex-based section detection. Additional tests exercise text/formatting, selection history, image restoration, canvas and Layers drag, first-gesture background dragging, drag cancellation, live/linked/responsive padding, responsive resets, shared styles, insertion, product binding, reload, hidden layers, and save races. An optional `EDITOR_IMPORT_FIXTURE` path checks section padding and undo on a real imported page without adding that site's markup to the repository.

These fixtures are representative markup, not claims of full compatibility with every third-party site. The original 50-item checklist has not been certified against five live websites.

## Scope of this implementation

The supplied specification was treated as design input rather than a binding migration contract. This implementation prioritizes merchant editing and preservation within the project's existing HTML model. It does not implement automatic re-import/replay and conflict resolution, automatic visual-fidelity reporting in the importer, arbitrary product/review repeater binding, custom breakpoint thresholds, or a complete source CSS cascade debugger. Those require separate importer and document-format work. Existing generated/native block pages are not migrated into the new arbitrary-HTML semantic model.
