# Product media fidelity

Product imports preserve the original files and ordering. They do not take screenshots, crop rendered page regions, stage photos, or turn video posters into product images.

- Shopify's product image feed supplies the full gallery without a 24-image cutoff. Its Ajax media feed adds original video files and alt text when it includes every original image. Unsupported players/models are reported for review.
- HTML imports read main gallery slides, with explicit original/zoom links and the largest declared responsive image. Loop clones and thumbnail strips do not become extra slides. Structured Product images and then Open Graph are fallbacks; arbitrary page images, logos, badges and reviews are not collected as product photos.
- The editor and importer share source selection. Responsive mobile crops do not override the main image. Changing carousel settings cannot truncate a long gallery.
- Owned image/video uploads contain the downloaded bytes without rendering. Product video imports reject image responses, preserving the unresolved video URL and reporting the failure instead of substituting its poster.
- Product administration shows all media, uncropped, in order with full-file links. Original uploads are the default; staging requires an explicit preset. Upload, generation and hero-selection actions preserve existing gallery entries.

Regression coverage: `product-media-import.test.ts`, `product-media.browser.mjs`, `image-localization.test.ts`, `http.test.ts`, and `editor-gallery.browser.mjs`.

Source API: [Shopify Ajax Product API](https://shopify.dev/docs/api/ajax/reference/product).
