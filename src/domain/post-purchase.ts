import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { getProduct, reserveInventory, releaseInventory } from './catalog.ts'
import { getOrder } from './orders.ts'
import { reconcileGifts } from './cart.ts'
import { resolveOffer, type Funnel } from './funnels.ts'
import type { LineItem, Order } from './types.ts'

export type OfferReceipt = {id:string;store_id:string;order_id:string;page_id:string;status:'pending'|'accepted'|'declined';quote:string;payment_intent_id:string}
export function offerReceipts(db: Db, storeId: string, orderId: string): OfferReceipt[] {
  return db.all<OfferReceipt>('SELECT * FROM post_purchase_offers WHERE store_id=? AND order_id=? ORDER BY created_at,rowid',storeId,orderId)
}
/** Walk the copied page graph, including repeated upsells, rather than stopping after the first. */
export function currentOfferStep(db: Db, storeId: string, order: Order, funnel: Funnel) {
  const receipts=offerReceipts(db,storeId,order.id),visited=new Set<string>()
  let step=funnel.steps.find(step=>step.offer?.enabled)
  while(step&&!visited.has(step.pageId)){
    visited.add(step.pageId)
    if(!step.offer?.enabled){step=funnel.steps.find(next=>next.pageId===step!.nextPageId);continue}
    const receipt=receipts.find(receipt=>receipt.page_id===step!.pageId)
    if(!receipt||receipt.status==='pending')return step
    const next=receipt.status==='accepted'?step.nextPageId:step.declinePageId
    step=funnel.steps.find(step=>step.pageId===next&&step.offer)
  }
  return null
}
type Quote = {amountCents:number;baseAmountCents:number;currency:string;lines:LineItem[]}
/** Persist a quote and reserve inventory before payment; every retry uses the same payment identity. */
export async function respondToOffer(db: Db, storeId: string, orderId: string, funnel: Funnel, input: {pageId:string;accept:boolean;variantId?:string},
  convert:(amount:number)=>number, charge:(quote:Quote,key:string)=>Promise<{ok:boolean;intentId:string;failed?:boolean}>): Promise<'done'|'pending'|'failed'|'accepted'> {
  let receipt=db.tx(()=>{
    const order=getOrder(db,storeId,orderId)
    if(!order||order.paymentStatus!=='captured'||order.status==='cancelled')throw Error('This offer requires a paid order')
    const prior=offerReceipts(db,storeId,orderId).find(row=>row.page_id===input.pageId)
    if(prior){if(prior.status==='pending'&&input.variantId&&json<Quote>(prior.quote,{} as Quote).lines[0]?.variantId!==input.variantId)throw Error('A previous option is awaiting payment confirmation. Retry that same option.');return prior}
    const step=currentOfferStep(db,storeId,order,funnel)
    if(!step||step.pageId!==input.pageId)throw Error('This offer is no longer the current step')
    const timestamp=now(),receiptId=id('offer')
    if(!input.accept){db.insert('post_purchase_offers',{id:receiptId,store_id:storeId,order_id:orderId,page_id:step.pageId,status:'declined',created_at:timestamp,updated_at:timestamp});return offerReceipts(db,storeId,orderId).find(row=>row.id===receiptId)!}
    const variantId=input.variantId||step.offer?.variantId
    if(!variantId||!(step.offer?.variantIds||[step.offer?.variantId]).includes(variantId))throw Error('Choose a product option from this offer')
    const offer=resolveOffer(db,storeId,{...step.offer,variantId},()=>null,0)
    if(!offer||getProduct(db,storeId,offer.product.id)?.status!=='published')throw Error('This offer is not available yet')
    const variant=offer.product.variants.find(v=>v.id===variantId)!,baseAmountCents=Math.round(offer.priceCents*(1-offer.discountPercent/100)),amountCents=convert(baseAmountCents)
    if(!Number.isSafeInteger(amountCents)||amountCents<=0)throw Error('This offer needs a valid price')
    const lines=reconcileGifts(db,storeId,[{productId:offer.product.id,variantId,title:offer.product.title,variantTitle:variant.title,image:variant.image||offer.product.heroImage,unitCents:amountCents,quantity:1,source:'post-purchase'}])
    for(const line of lines)if(!reserveInventory(db,line.variantId,line.quantity))throw Error('This offer is sold out')
    const quote:Quote={amountCents,baseAmountCents,currency:order.currency,lines}
    db.insert('post_purchase_offers',{id:receiptId,store_id:storeId,order_id:orderId,page_id:step.pageId,status:'pending',quote,created_at:timestamp,updated_at:timestamp})
    return offerReceipts(db,storeId,orderId).find(row=>row.id===receiptId)!
  })
  if(receipt.status!=='pending')return 'done'
  const quote=json<Quote>(receipt.quote,{} as Quote)
  // An uncertain network response keeps the reservation and quote for an idempotent retry.
  const paid=await charge(quote,receipt.id)
  if(!paid.ok){
    if(!paid.failed)return 'pending'
    db.tx(()=>{const latest=offerReceipts(db,storeId,orderId).find(row=>row.id===receipt.id);if(latest?.status==='pending'){for(const line of quote.lines)releaseInventory(db,line.variantId,line.quantity);db.update('post_purchase_offers',receipt.id,{status:'declined',payment_intent_id:paid.intentId,updated_at:now()})}})
    return 'failed'
  }
  const added=db.tx(()=>{
    receipt=offerReceipts(db,storeId,orderId).find(row=>row.id===receipt.id)!
    if(receipt.status!=='pending')return false
    const order=getOrder(db,storeId,orderId)!
    db.update('orders',orderId,{items:[...order.items,...quote.lines],subtotal_cents:order.subtotalCents+quote.amountCents,total_cents:order.totalCents+quote.amountCents,base_total_cents:order.baseTotalCents+quote.baseAmountCents,updated_at:now()})
    db.update('post_purchase_offers',receipt.id,{status:'accepted',payment_intent_id:paid.intentId,updated_at:now()});return true
  })
  return added?'accepted':'done'
}
