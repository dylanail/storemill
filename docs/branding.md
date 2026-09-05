# storemill branding

The platform uses the supplied storemill full wordmark and icon. The original transparent PNGs live in `src/brand/assets/` and are served from an allowlisted `/_brand/` route. `src/brand/index.ts` provides the shared wordmark, icon, favicon, and display styles. CSS makes the artwork white on dark backgrounds; black artwork appears on light account screens. The icon is framed with an SVG viewBox so its transparent padding does not make it appear too small. The PNG files themselves are unchanged.

The admin header uses the full white wordmark on larger screens and the icon on mobile. The assistant launcher and header use the supplied icon. Login, registration, onboarding, and password recovery share the black wordmark. Admin/editor document titles, application metadata, email branding, assistant platform context, first-party plugin labels, and new backup filenames use storemill.

New deployments can use `STOREMILL_*` settings. The environment loader maps these to existing runtime settings, with explicitly supplied Storemill values taking precedence. Existing `AMBORAS_*` deployments still work. Database filenames, encryption salts, cookies, browser hooks, and saved-page metadata retain their compatibility identifiers. Historical source attribution in the project history is preserved.

New DNS verification instructions use `_storemill` and `storemill-verify`; verification also accepts existing `_amboras` records. Operational hostnames and email domains remain configured separately from the product name. Set `STOREMILL_EMAIL_DOMAIN`, `STOREMILL_PUBLIC_ORIGIN`, `STOREMILL_ADMIN_HOST`, `STOREMILL_STOREFRONT_HOST`, and `STOREMILL_EDGE_HOST` to the actual verified deployment domains before changing their operational values.

Verified with the existing 277 backend/HTTP tests, the five admin browser checks, TypeScript, and a visual audit at desktop, tablet, and mobile widths using the current assets. Account login logos and the favicon were checked as well. No customer emails were sent as part of the rebrand.
