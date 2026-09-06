import type { Db } from '../lib/db.ts'
import { getStore } from '../control/stores.ts'
import { createPage, listPages, newBlock, type Page } from './store.ts'

/** A protected provider session is not a page. Keep an editable, owned checkout in every copied asset. */
export function ensureCopiedCheckout(db: Db, storeId: string): Page | null {
  if (listPages(db, storeId).some(page => page.role === 'checkout')) return null
  const funnel = getStore(db, storeId)?.kind === 'funnel'
  return createPage(db, storeId, {
    title: 'Checkout', handle: 'checkout', kind: 'checkout', role: 'checkout', status: 'draft',
    blocks: [
      ...(funnel ? [newBlock('header', { showNav: false, cta: '' }), newBlock('checkout-steps', { steps: 'Cart\nInformation\nPayment', current: 2 })] : []),
      newBlock('checkout-form', { layout: 'two-column', summaryHeadline: funnel ? 'Your order' : '', showHeader: !funnel, showPolicies: !funnel, showBump: true, showExpress: true, buttonLabel: funnel ? 'Complete order' : 'Pay now', note: '' }),
      ...(funnel ? [newBlock('footer', {})] : []),
    ],
    seo: { title: 'Checkout' },
  })
}
