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
paragraph identifiers as recovered lesson IDs. The recovered private originals now use the separate provenance-preserving pipeline described below. Audio and raw course content remain outside this public checkout.

### Canonical transcript import

For a separately supplied canonical lesson hierarchy, run `node scripts/import-course.mjs course.json output-directory`.
Input contains `courseId`, `title`, `modules` with `moduleId`, `title`, and
`lessons` with `lessonId`, `title`, `transcript` and optional `timestamps`.
Supply original stable IDs. The importer preserves exact raw JSON, emits
bounded paragraph chunks with hierarchy IDs and transcript hashes, retains
supplied timestamps, and refuses to overwrite an existing course. This is a
local preparation path; imported chunks are not automatically trusted or
connected to runtime retrieval. Review the corpus and its course map before
connecting it. Runtime retrieval also supports the recovered private intake described below.

## Private original Evolve corpus

The original intake was recovered from `/Volumes/Non-Time Machine/Storemill-course-intake`.
`package-course-intake.py` consumes its existing ledger, canonical transcripts,
recording manifests, chunks, attachment text and three source-reviewed pilot
extractions. It validates canonical hashes against the read-only ledger,
preserves all 204 original JSON files as exact-byte compressed private archives,
and retains original course/module/recording/chunk/segment IDs and timestamps.
Transport chunks are not relabeled as lessons. The source course map and reviewed
pilot lesson boundaries remain separate from retrieval passages.

The runtime uses topic facets plus BM25 ranking, title weighting and commerce-term
expansion. This is local metadata/lexical retrieval; no embedding model is used.
All existing writers and the business assistant consume the same context builder.
Selected source citations contain exact hierarchy IDs, timestamps and fingerprints.
Source transcripts are evidence with caveats; merchant data stays separate.

Thirteen language-suspect transcript identities are quarantined, repeated segments
are excluded, and remaining quality warnings are retained and downweighted.
The 61 source-reviewed teaching items retain applicability, ordered procedures,
exceptions, dependencies and evidence. Attachment instructor text excludes saved
page discussions and navigation. PDF text retains page numbers and visual flags;
spreadsheets lacking reviewed interpretation are deferred. Full visual review,
language repair and full-corpus reviewed teaching extraction remain incomplete.

`course-data/` is ignored by Git. NEVER commit it, its archives, or transcripts to
this public repository. A private CLI deployment bundles the data; runtime startup
persists it under `data/course-corpus` on the existing `/app/data` volume, outside
public uploads. Subsequent code-only deployments load that persisted index. A
configured `STOREMILL_COURSE_ROOT` can select another private directory. `/healthz`
reports counts and index hash only, never course text or local source paths.
Runtime integrity checks fail on a mismatched index hash. No public corpus endpoint
exists. Live calls that disclose private excerpts to model providers require the
owner's specific disclosure approval.

Private excerpts are excluded from model context unless `STOREMILL_COURSE_MODEL_DISCLOSURE=approved` is explicitly configured following owner approval. Local retrieval and aggregate health reporting work while the gate is closed.
