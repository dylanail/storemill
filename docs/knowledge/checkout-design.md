# Owned one-page checkout

Copied stores receive one editable Checkout form block containing the brand/cart header, checkout fields, summary, supported express wallets, and policy links. Existing merchant header/footer blocks retain their placement. HTML imports retain their source shell around the owned commerce controls.

The native checkout uses a separate light palette and system font rather than the imported storefront's surface tokens. Desktop has a 57/43 form/summary split, a sticky summary, 52px labeled fields, and a compact header. Below 1000px the summary collapses above the form; input fonts stay at least 16px to avoid mobile focus zoom. Shipping and billing addresses use distinct accessible names.

Discount application/removal, shipping and order bumps return authoritative server summaries. Invalid discounts don't replace a previously applied code. Country changes use configured shipping regions, retain form details, and reload currency/rates. Billing can differ from shipping and is saved in the cart draft and passed to Stripe. Wallet confirmation collects contact, delivery and billing details and uses the same server preparation and pricing path as card entry.

Preview card fields and wallet examples are disabled and explicitly labeled; they never collect card data or place orders. Live express buttons are Stripe's actual supported methods for the configured account, browser and device. Storemill does not provide Shopify's Shop Pay service. Existing payment-provider configuration remains necessary to charge a customer.

Design references checked September 5, 2026:

- [Shopify: one-page checkout](https://help.shopify.com/en/manual/checkout-settings/customize-checkout-configurations/one-page-checkout)
- [Shopify: one-page checkout examples and screenshots](https://www.shopify.com/enterprise/blog/one-page-checkout)
- [Stripe: Express Checkout Element, address collection and shipping events](https://docs.stripe.com/elements/express-checkout-element/accept-a-payment?payment-ui=elements)

Regression coverage includes the originally broken dark navy storefront surface, native and imported checkout, desktop and phone layout, preview payment protection, discount errors/removal, shipping quotes, billing draft persistence, country changes, and a wallet confirmation with a mocked payment provider. Real Nuvana screenshots are reviewed separately using its current brand/catalog data.
