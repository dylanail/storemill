# Knowledge base

What the platform knows about selling through paid social, distilled from the
Origins Program and Evolve course transcripts the owner supplied, plus the
fifteen reference pages the owner pointed at, read page by page. The long form lives here; the short
form the writers actually read at generation time is `src/agent/knowledge.ts`,
which quotes the rules below into the research, avatar, page, ad and planner
prompts by topic.

| File | Read it for |
|---|---|
| `desires.md` | The six permanent instincts, the six technology problems, the forces of change, desire hunting, and the month-by-month desire calendar |
| `sophistication.md` | Market awareness and sophistication stages, and the three resets: new mechanism, new information, new identity |
| `avatars.md` | Core avatars (desire-based) and sub-avatars (the other four categories), the questions that define one, scale tiers |
| `product-research.md` | What a winning product is, the hard criteria, the evaluation walk-through, tools |
| `offers.md` | Every offer type with when to use it, the law of large numbers, the RatVac case, revenue per session |
| `testing.md` | Gross margin, breakeven and target ROAS, minimum daily spend, 3:2:2, marksman/sniper/shotgun, the 14 ad review questions, scaling SOP |
| `creatives.md` | Ad formats, the static templates, video structure, hooks |
| `pages.md` | What a page has to do in what order: the two shapes and the two front doors, the buy box, the sales page, the offer page, advertorials, quiz funnels, product pages, home and collections, the checkout, the popup; the behaviour metrics to track |
| `reference-pages.md` | The fifteen reference pages and their click-throughs read section by section: the anatomy, the tiers, the guarantees, the urgency, the copy patterns, the image sets, and what a naive builder ships by mistake |
| `meta-setup.md` | Facebook asset structure and warm-up |

Two rules the writers hold to that the course does not spell out: nothing is
invented (no review counts, statistics, studies or awards the merchant did not
supply), and any synthetic "UGC" is a concept for a real shoot or a real
customer to fulfil, never published as if it were a customer.

## Runtime source retrieval

`src/agent/course-corpus.ts` routes each requested topic to these canonical
checked-in distillations, extracts paragraph passages with section names and
SHA-256 source fingerprints, and ranks query matches (headings weighted higher).
Budgets are bounded and divided across sources so checkout and reference-page
material can both inform page decisions. `knowledge()` appends these excerpts
to existing rules for every generator; the business assistant uses the same
context, separately from current draft/live store state. The Docker image ships
these source files. Merchant facts, configured offers and consent override
course examples. No embeddings or remote retrieval provider is required.

These files are distilled notes, not the original transcripts. The original
Course → Module → Lesson hierarchy, timestamps, audio and raw transcripts are
not present in this checkout. Do not treat document filenames or generated
paragraph identifiers as recovered lesson IDs. Full transcript ingestion and
semantic/vector retrieval remain blocked until those source files are located.

### Canonical transcript import

When the originals are available, run `node scripts/import-course.mjs course.json output-directory`.
Input contains `courseId`, `title`, `modules` with `moduleId`, `title`, and
`lessons` with `lessonId`, `title`, `transcript` and optional `timestamps`.
Supply original stable IDs. The importer preserves exact raw JSON, emits
bounded paragraph chunks with hierarchy IDs and transcript hashes, retains
supplied timestamps, and refuses to overwrite an existing course. This is a
local preparation path; imported chunks are not automatically trusted or
connected to runtime retrieval. Review the corpus and its course map before
connecting it. Current runtime retrieval uses only the checked-in distillations.
