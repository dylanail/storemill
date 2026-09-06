import type { Db } from '../lib/db.ts'
import { createPage, listPages, newBlock, type Page } from './store.ts'

/** A protected provider session is not a page. Keep an editable, owned checkout in every copied asset. */
export function ensureCopiedCheckout(db: Db, storeId: string): Page | null {
  if (listPages(db, storeId).some(page => page.role === 'checkout')) return null
  return createPage(db, storeId, {
    title: 'Checkout', handle: 'checkout', kind: 'checkout', role: 'checkout', status: 'draft',
    blocks: [
      newBlock('header', { cta: '', showNav: false }),
      newBlock('checkout-steps', { steps: 'Cart\nInformation\nPayment', current: 2 }),
      newBlock('checkout-form', { layout: 'two-column', showBump: true, showExpress: true, buttonLabel: 'Pay now', note: '' }),
      newBlock('footer', {}),
    ],
    seo: { title: 'Checkout' },
  })
}
