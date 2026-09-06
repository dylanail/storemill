# Owned one-page checkout

The Shopify-style checkout applies to stores only. Copied stores receive one editable Checkout form block containing the brand/cart header, checkout fields, summary, supported express wallets, and policy links. Funnel checkouts retain their own copied HTML or editable block layout and theme; store checkout CSS, header/footer injection, and address widgets do not apply to them. A missing funnel checkout gets its own header, steps, form and footer. Existing merchant header/footer blocks retain their placement. HTML imports retain their source shell around the owned commerce controls.

The native store checkout uses neutral light surfaces and the site's logo and accent colors. Fields stay readable even when the imported storefront is dark. Button labels and link colors are checked for contrast. New imports save the main header logo into branding with its final owned upload path. Older imports can use the logo from their copied header. Until a merchant customizes the palette, checkout can use the purchased product's captured CTA color when the home capture only found a neutral cart/menu button. Logo/color edits in Theme & navigation take precedence.

Desktop has a 57/43 form/summary split, a sticky summary, 52px labeled fields, and a compact header. Below 1000px the summary collapses above the form; input fonts stay at least 16px to avoid mobile focus zoom. The header, pay button and policy footer use small lock icons and restrained security copy. The footer describes an encrypted connection only on HTTPS. No unverified encryption-bit count, certification or security-provider seal is added.

Connected Stripe store checkouts use shipping and separate billing Address Elements alongside the Payment Element. Stripe supplies supported-country address suggestions without a separate Maps key. Selected addresses sync to the existing named cart fields before quotes/payment preparation; native autocomplete attributes support saved browser addresses. Incomplete provider addresses cannot start a payment. Address lookup failure or “Enter address manually” restores editable fields with current values. Billing elements exist only while a separate billing address is selected. Express wallets use their own supplied addresses and do not get blocked by an empty address widget. Preview and no-provider checkouts keep native browser autofill and manual entry; preview does not contact an address provider.

Discount application/removal, shipping and order bumps return authoritative server summaries. Invalid discounts don't replace a previously applied code. Country changes use configured shipping regions, retain form details, and reload currency/rates. Billing can differ from shipping and is saved in the cart draft and passed to Stripe. Wallet confirmation collects contact, delivery and billing details and uses the same server preparation and pricing path as card entry.

Preview card fields and wallet examples are disabled and explicitly labeled; they never collect card data or place orders. Live express buttons are Stripe's actual supported methods for the configured account, browser and device. Storemill does not provide Shopify's Shop Pay service. Existing payment-provider configuration remains necessary to charge a customer.

Design and integration references checked September 6, 2026:

- [Shopify: one-page checkout](https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/one-page-checkout)
- [Shopify: one-page checkout examples and screenshots](https://www.shopify.com/enterprise/blog/one-page-checkout)
- [Stripe: Express Checkout Element, address collection and shipping events](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?payment-ui=elements)
- [Shopify: checkout logos and colors](https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/checkout-style)
- [Stripe: Address Element, supported countries and autocomplete](https://docs.stripe.com/elements/address-element?platform=web)
- [Stripe: Address Element options](https://docs.stripe.com/js/elements_object/create_address_element)

Regression coverage includes the originally broken dark navy storefront surface, brand contrast, owned logo import, native and imported funnel isolation, desktop and phone layout, preview payment protection, discount errors/removal, shipping quotes, billing draft persistence, address suggestions/failure/manual switching, country changes, and wallet confirmation with a mocked payment provider. Real Nuvana screenshots are reviewed separately using its current brand/catalog data.
