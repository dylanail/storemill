import type { Cents } from '../lib/money.ts'

export type ProductOption = {
  title: string
  /** Swatches are what makes a leather colour render as a colour, not a word. */
  values: Array<{ value: string; swatch?: string; note?: string }>
}

export type Media = { url: string; alt: string; kind?: 'image' | 'video'; poster?: string }

export type Variant = {
  id: string
  productId: string
  title: string
  sku: string
  priceCents: Cents
  compareAtCents: Cents | null
  inventory: number
  allowBackorder: boolean
  optionValues: Record<string, string>
  image: string
  position: number
}

/**
 * The conversion sections of a product page. Every field is optional because a
 * product imported from a CSV has none of them yet; the page renders what it
 * has and the assistant can fill the rest in one call.
 */
export type ProductContent = {
  benefits?: Array<{ title: string; body: string }>
  comparison?: { rows: Array<{ label: string; us: string; them: string }>; themLabel?: string }
  specs?: Array<{ label: string; value: string }>
  faq?: Array<{ q: string; a: string }>
  guarantee?: string
  shipping?: string
  audience?: string
  /** Short lines for the trust strip under the buy button. */
  trust?: string[]
}

/** Where it comes from and what it costs. Every profit number derives from this. */
export type Supplier = {
  name?: string
  url?: string
  sku?: string
  costCents?: number
  shippingCents?: number
  processingDays?: number
  shippingDaysMin?: number
  shippingDaysMax?: number
  notes?: string
}

export type Product = {
  id: string
  storeId: string
  title: string
  handle: string
  subtitle: string
  description: string
  status: 'draft' | 'published' | 'archived'
  heroImage: string
  media: Media[]
  options: ProductOption[]
  metadata: Record<string, string>
  seo: { title?: string; description?: string }
  tags: string[]
  subscription: { cadences?: string[]; discountPercent?: number; trialDays?: number }
  content: ProductContent
  supplier: Supplier
  position: number
  createdAt: string
  updatedAt: string
  variants: Variant[]
}

export type LineItem = {
  variantId: string
  productId: string
  title: string
  variantTitle: string
  image: string
  unitCents: Cents
  quantity: number
  /** Set when the line was added by a bundle, upsell or cross-sell component. */
  source?: string
  /** A gift line: added by a bundle tier, priced at zero, removed if the tier is lost. */
  giftOf?: string
}

export type Address = {
  name?: string
  line1?: string
  line2?: string
  state?: string
  city?: string
  postal?: string
  country?: string
  phone?: string
}

export type Totals = {
  subtotalCents: Cents
  discountCents: Cents
  shippingCents: Cents
  taxCents: Cents
  totalCents: Cents
  currency: string
  appliedPromotions: Array<{ id: string; title: string; code: string; amountCents: Cents; kind: string }>
  /** How much more the cart needs to clear the free-shipping threshold. */
  freeShippingGapCents: Cents | null
  shippingOptionId: string
  shippingName: string
}

export type Order = {
  id: string
  storeId: string
  displayId: number
  email: string
  items: LineItem[]
  currency: string
  subtotalCents: Cents
  discountCents: Cents
  shippingCents: Cents
  taxCents: Cents
  totalCents: Cents
  /** Total converted back to the store currency at checkout time. */
  baseTotalCents: Cents
  discountCode: string
  status: 'pending' | 'completed' | 'cancelled'
  paymentStatus: 'awaiting' | 'captured' | 'refunded' | 'partially_refunded'
  fulfillmentStatus: 'unfulfilled' | 'fulfilled' | 'shipped' | 'delivered' | 'returned'
  address: Address
  fulfillments: Array<{ id: string; provider: string; tracking: string; carrier?: string; createdAt: string }>
  refunds: Array<{ id: string; amountCents: Cents; reason: string; createdAt: string }>
  paymentProvider: 'demo' | 'stripe'
  paymentIntentId: string
  paymentCustomerId: string
  paymentMethodId: string
  shippingOptionId: string
  /** What the merchant needs to know about this order that the lines cannot say. */
  notes: string
  upsell: { offered?: string; accepted?: boolean; variantId?: string; amountCents?: Cents; paymentIntentId?: string }
  downsell: { offered?: string; accepted?: boolean; variantId?: string; amountCents?: Cents }
  supplierOrder: { supplier?: string; orderId?: string; costCents?: Cents; shippingCents?: Cents; placedAt?: string; carrier?: string }
  deliveredAt: string | null
  createdAt: string
  updatedAt: string
}

export type PromotionKind =
  | 'percentage'
  | 'fixed'
  | 'free_shipping'
  | 'bogo'
  | 'bundle'
  | 'tiered'
  | 'mix_match'
  | 'fixed_bundle'

export type Promotion = {
  id: string
  storeId: string
  code: string
  title: string
  kind: PromotionKind
  /** percent for percentage/bundle/tiered, minor units for fixed. */
  value: number
  rules: {
    minSubtotalCents?: number
    productIds?: string[]
    variantIds?: string[]
    collectionIds?: string[]
    buyQuantity?: number
    getQuantity?: number
    buyProductIds?: string[]
    getProductIds?: string[]
    requiredDistinctProducts?: number
    bundlePriceCents?: number
    bundleProductId?: string
    tiers?: Array<{ quantity: number; percent: number; unitPriceCents?: number }>
    regionIds?: string[]
    firstOrderOnly?: boolean
    /** Minimum eligible units before the promotion pays out (bundle tiers). */
    minQuantity?: number
    maxUses?: number
    priority?: number
    combinable?: boolean
  }
  automatic: boolean
  status: 'active' | 'scheduled' | 'disabled' | 'expired'
  startsAt: string | null
  endsAt: string | null
  usageCount: number
  createdAt: string
}

export type Brand = {
  name?: string
  slogan?: string
  description?: string
  primary?: string
  secondary?: string
  ink?: string
  paper?: string
  displayFont?: string
  bodyFont?: string
  displayWeight?: number
  bodyWeight?: number
  surface?: string
  buttonText?: string
  border?: string
  fontFaces?: string
  themeCustomized?: boolean
  sourceTheme?: Partial<Pick<Brand, 'primary' | 'secondary' | 'paper' | 'ink' | 'surface' | 'buttonText' | 'border' | 'displayFont' | 'bodyFont' | 'displayWeight' | 'bodyWeight'>>
  /** Font families discovered in a cloned site's CSS, available for block-level overrides. */
  fonts?: string[]
  logoSvg?: string
  announcement?: string
  voice?: string
}

export type Theme = {
  template: string
  sections: string[]
  radius: string
  density: 'compact' | 'roomy'
  heroImage?: string
  heroHeadline?: string
  heroSub?: string
  nav: Array<{ label: string; href: string }>
  slots: Record<string, string[]>
  /** The one popup a store gets. Off unless enabled; never shown over the buy box on a phone. */
  popup?: Popup
  /** CSS the owner or the assistant wrote for the whole store, inlined after the theme on every page. */
  customCss?: string
  /** A script for the whole store, at the end of every page. */
  customJs?: string
}

export type Popup = {
  enabled: boolean
  trigger: 'exit' | 'delay' | 'scroll'
  /** Seconds (delay) or percent scrolled (scroll). */
  after: number
  /**
   * What it offers (from the reference stores): `email` asks for an address
   * and hands over the code; `offer` shows the code or the deal and sends
   * the visitor to the buy box; `quiz` sends them to the quiz page.
   */
  kind?: 'email' | 'offer' | 'quiz'
  headline: string
  text: string
  /** A discount code shown after the email is given; empty for a plain sign-up. */
  code: string
  buttonLabel: string
  /** Where the button goes for the offer and quiz kinds. */
  href?: string
  /** "Valid for 7 days after sign-up": how long the code is good for; 0 says nothing. */
  validDays?: number
  /** An image at the top of the card, when there is one. */
  image?: string
  /** Days before it may show again after being dismissed. */
  dismissDays: number
}
