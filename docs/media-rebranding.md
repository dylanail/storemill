# Rebrand existing images and videos

Open an asset, choose **Media**, then **Rebrand** on an image or a video. Enter the desired brand name and choose a logo from the asset’s library or upload a new one. These choices are remembered separately for each asset.

- **AI brand replacement** edits existing brand names and logos on packaging, products or graphics. Images use the selected OpenAI or Google image provider. Videos use an edited reference frame plus Runway Aleph 2 to guide the change through the footage. Pick a reference time where the branding is visible.
- **Exact logo overlay** places the supplied logo at a selected corner and size. It works without an AI key. It does not remove other branding outside the overlay.

Choose **Create preview**. The job continues in the background and is available under **Media → Recent media edits**. Review the original and result, then choose **Apply to this asset**, download the result, or redo it with different instructions. A preview alone never changes the storefront. Apply replaces matching media references in pages, products, variants, collections, custom blocks, creatives and draft brand/theme settings for the selected asset. Responsive alternatives in the same picture element are updated together. Reviews, original store copies and other stores are not changed.

Applying to a live asset can update published page/catalog media immediately; theme edits stay in draft. The preview lists the affected record types. **Undo replacement** restores the fields changed by that application. It refuses to overwrite later edits; page revisions also retain the before/after versions. Original media files remain available.

## Provider setup

The Docker image includes FFmpeg and FFprobe. Local installations need both executables on PATH; `STOREMILL_FFMPEG` and `STOREMILL_FFPROBE` can specify alternative paths. SVGs render in an isolated Chromium image context using the existing Playwright installation (`PLAYWRIGHT_EXECUTABLE_PATH` is supported).

For AI image replacement, configure `OPENAI_API_KEY` or `GEMINI_API_KEY` and restart. Model IDs continue to use `AMBORAS_IMAGE_MODEL` (default `gpt-image-2`) and `AMBORAS_GOOGLE_IMAGE_MODEL` (default `gemini-3-pro-image-preview`). AI video replacement also requires `RUNWAYML_API_SECRET`. Keys remain server-side. Provider charges apply when a preview is generated. A missing key or provider error is shown explicitly; no synthetic fallback is substituted for an AI result.

Reference documentation: [OpenAI image editing](https://developers.openai.com/api/docs/guides/image-generation), [Runway input requirements](https://docs.dev.runwayml.com/assets/inputs/), [Runway Aleph 2 release and limits](https://docs.dev.runwayml.com/api-details/api_changelog/).

## Limits and recovery

Images and logos are limited to 12MB. Animated images produce a still image. Videos must be direct MP4, WebM or modern MOV files under 100MB. Embedded YouTube/Vimeo players require the original video upload. Logo overlays support complete clips up to five minutes. AI video replacement supports complete clips from 2 to 30 seconds; input is normalized to at most 1080p and 30 FPS. The original audio is restored after AI editing. Longer clips are rejected rather than silently truncated.

Jobs have persistent status and explicit cancellation. Runway tasks resume polling after a server restart if their provider task ID was saved. Interrupted submissions without a saved task ID fail visibly and are not automatically resubmitted. Check provider usage before manually retrying an interrupted paid edit. Repeated submissions of the same form use an idempotency key to avoid duplicate jobs.

## Verification

`node --test test/media-rebrand.test.ts` covers actual image/video overlays, audio and duration retention, provider request contracts, saved results, failure handling, cancellation, duplicate isolation, and conflict-safe apply/undo. `node --test test/media-rebrand.browser.mjs` covers responsive UI, progress across navigation, preview/apply/undo, retries, duplicate submissions, tenant isolation and video byte ranges. AI responses are deterministic fixtures in tests; actual provider output quality still needs a live account test.
