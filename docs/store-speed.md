# Store Speed

Open **Store Speed** in the store navigation. Each finding shows the problem, a suggested repair, and **Fix with AI**. Repairs run in the background and appear in Recent fixes; the page resumes watching unfinished work after navigation. Failed requests can be retried. Configure a model for the `pages` task in Settings first.

The audit parses actual HTML. It recognizes wrapped labels, ARIA names and main landmarks, link names, async/deferred scripts, module scripts, and JSON-LD. It checks the actual custom homepage, every saved page, and up to three published product pages using the draft theme. It does not treat a placeholder as an input label or JSON/script content as visible page copy. Imported HTML does not inherit unrelated theme contrast warnings.

This is a static source/accessibility audit, not a network benchmark or Core Web Vitals measurement. Gzip size covers HTML only; image downloads, font downloads and third-party timings are excluded. External CSS/computed visibility and interaction accessibility require browser review. The score describes these checks, not a guarantee that a site is fully accessible or fast.

The model proposes small exact source edits. Before applying them, Storemill checks source matches, block/schema validity, protected scripts and commerce attributes, the original finding, and whether new errors appeared elsewhere. It refuses ambiguous or ineffective edits and reports the reason. It also refuses to overwrite source changed during the model request. General JavaScript rewrites and changes beyond the editable page/theme surface may require the code editor; the tool does not claim success for those.

Saved HTML/block fixes update the page, including an already published page. Theme/brand styling fixes remain in the draft environment. Each applied fix records before/after source and an audit entry. **Undo fix** restores the prior source only when it has not changed since the fix; otherwise use the page revision history. Interrupted jobs become failed on restart instead of being replayed.

Tests cover apply/recheck/undo, ineffective repairs, concurrent edits, undo conflicts, interrupted jobs, real HTTP controls, editor save conflicts, and mobile overflow. Model transport is deterministic in automated tests; no paid inference or customer data is used by the suite.
