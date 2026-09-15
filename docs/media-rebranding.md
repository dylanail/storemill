# Edit and rebrand images and videos

## From the page editor

Select an image, background image, video or video poster, then choose **Regenerate with branding** in its Content settings. Native blocks expose the same controls beside their image/video settings. **Upload / choose asset** opens replacement controls directly. Embedded YouTube/Vimeo players require an uploaded original video; replacement converts the player to a direct video element.

The dialog opens an **Edit suggestions** text box. Choose a brand and logo, upload a reference logo from your computer, or pick one from **Logos**. Add up to three other reference images and describe their intended roles. **Keep unchanged** specifies details to retain. Edit goals include branding, custom instructions, object/text removal, background changes, lighting/clarity and restyling. Image output can retain its original dimensions or use square, landscape or portrait format. AI images are new interpretations: review text, logos and product details in the preview.

**Exact logo overlay** adds the original logo without AI reinterpretation, at a corner or the center with adjustable size. It does not apply written suggestions. Video controls offer a reference frame for AI edits and a choice to retain or mute original audio. AI provider availability and supported clip limits are shown in the dialog.

Choose **Create preview**, review the result, then **Use this version**. Replacement can affect the selected placement or all matching image/video placements on the current page. Image replacements clear old responsive sources; video replacement retains the existing poster and controls. Background images and posters can also be edited separately. Replacing a product-bound image disconnects that placement's binding, with an explanation in the dialog. Undo restores both the media and binding. New images retain their placement size and use contain when the original fit would stretch them; Design settings can change the fit.

Uploads and generated previews are saved to Media. Opening the dialog, generating, or applying a preview does **not** save or publish the page. Existing unsaved copy remains intact; use page Undo or Save normally. Closing the dialog leaves generation running; recent versions are available when reopening the saved media, or from **Media → Recent media edits**. Unsaved inline image uploads can also be regenerated without saving the page first. Changes made while a dialog is open are checked before its result can replace a placement.

## Logo library

**Media** has separate **Logos** and **Images & videos** sections. Choose a destination when uploading; existing images have **Move to logos** / **Move to other media** controls. Logo uploads from the editor and rebranding form go straight to Logos. Known URL-based brand logos are recognized automatically. Labels and categories persist and are copied with a whole asset; copied local files belong to the new asset.

## From the media library

Open an asset, choose **Media**, then **Rebrand** on an image or a video. Enter the desired brand name and choose a logo from the asset’s library or upload a new one. These choices are remembered separately for each asset.

- **AI brand replacement** edits existing brand names and logos on packaging, products or graphics. Images use the selected OpenAI or Google image provider. Videos use an edited reference frame plus Runway Aleph 2 to guide the change through the footage. Pick a reference time where the branding is visible.
- **Exact logo overlay** places the supplied logo at a selected corner and size (the page editor also supports centered overlays). It works without an AI key. It does not remove other branding outside the overlay.

Choose **Create preview**. The job continues in the background and is available under **Media → Recent media edits**. Review the original and result, then choose **Apply to this asset**, download the result, or redo it with different instructions. A preview alone never changes the storefront. Apply replaces matching media references in pages, products, variants, collections, custom blocks, creatives and draft brand/theme settings for the selected asset. Responsive alternatives in the same picture element are updated together. Reviews, original store copies and other stores are not changed.

Applying to a live asset can update published page/catalog media immediately; theme edits stay in draft. The preview lists the affected record types. **Undo replacement** restores the fields changed by that application. It refuses to overwrite later edits; page revisions also retain the before/after versions. Original media files remain available.

## Provider setup

The Docker image includes FFmpeg and FFprobe. Local installations need both executables on PATH; `STOREMILL_FFMPEG` and `STOREMILL_FFPROBE` can specify alternative paths. SVGs render in an isolated Chromium image context using the existing Playwright installation (`PLAYWRIGHT_EXECUTABLE_PATH` is supported).

For AI image replacement, configure `OPENAI_API_KEY` or `GEMINI_API_KEY` and restart. Model IDs continue to use `AMBORAS_IMAGE_MODEL` (default `gpt-image-2`) and `AMBORAS_GOOGLE_IMAGE_MODEL` (default `gemini-3-pro-image-preview`). AI video replacement also requires `RUNWAYML_API_SECRET`. Keys remain server-side. Provider charges apply when a preview is generated. A missing key or provider error is shown explicitly; no synthetic fallback is substituted for an AI result.

Reference documentation: [OpenAI image editing](https://developers.openai.com/api/docs/guides/image-generation), [Runway input requirements](https://docs.dev.runwayml.com/assets/inputs/), [Runway Aleph 2 release and limits](https://docs.dev.runwayml.com/api-details/api_changelog/).

## Limits and recovery

Images and logos are limited to 12MB. Animated images produce a still image. Videos must be direct MP4, WebM or modern MOV files under 100MB. Embedded YouTube/Vimeo players require the original video upload. Logo overlays support complete clips up to five minutes. AI video replacement supports complete clips from 2 to 30 seconds; input is normalized to at most 1080p and 30 FPS. The original audio is restored after AI editing unless Mute was selected in the page editor. Longer clips are rejected rather than silently truncated.

Jobs have persistent status and explicit cancellation. Runway tasks resume polling after a server restart if their provider task ID was saved. Interrupted submissions without a saved task ID fail visibly and are not automatically resubmitted. Check provider usage before manually retrying an interrupted paid edit. Repeated submissions of the same form use an idempotency key to avoid duplicate jobs.

## Verification

`node --test test/media-rebrand.test.ts` covers actual image/video overlays, audio and duration retention, provider request contracts, saved results, failure handling, cancellation, duplicate isolation, and conflict-safe apply/undo. `node --test test/media-rebrand.browser.mjs` covers responsive UI, native/imported page controls, logo/reference uploads, unsaved-edit preservation, selected/all-placement replacement, picture/background/poster handling, keyboard isolation, preview/apply/undo, retries, duplicate submissions, tenant isolation and video byte ranges. AI responses are deterministic fixtures in tests; actual provider output quality still needs a live account test.
