import { createHash } from 'node:crypto'
import type { Db } from '../lib/db.ts'
import { now } from '../lib/db.ts'
import { minorDigits } from '../lib/money.ts'
import { getProduct, getVariant, listProducts, listCollections } from '../domain/catalog.ts'
import { listBundles, upsertBundle, setBundleStatus, type Bundle, type BundleTier } from '../domain/bundles.ts'
import { listPromotions, createPromotion, setPromotionStatus, applyPromotions } from '../domain/promotions.ts'
import { listRegions } from '../domain/regions.ts'
import type { Promotion, LineItem } from '../domain/types.ts'
import type { Store } from './stores.ts'
import { recordAudit } from './todos.ts'

export const discountTypes = [
  {id:'quantity',name:'Multipacks & product tiers',description:'Buy 1, 2 or 4 cards, exact pack prices, bulk pricing and gifts.'},
  {id:'amount',name:'Amount off',description:'A percentage or money amount off products or the order.'},
  {id:'tiered',name:'Bulk discount',description:'Quantity thresholds across eligible products or collections.'},
  {id:'bogo',name:'Buy X, get Y',description:'Buy qualifying items and discount matching or different items.'},
  {id:'mix_match',name:'Mix & match',description:'Save when a cart contains different eligible products.'},
  {id:'fixed_bundle',name:'Set price',description:'Any complete set of eligible items for one fixed price.'},
  {id:'free_shipping',name:'Free shipping',description:'Free delivery with optional spend and quantity requirements.'},
]
const revision=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex')
const promoRevision=(p:Promotion)=>revision({...p,usageCount:0})
const promotionState=(p:Promotion)=>p.status==='disabled'?'disabled':p.endsAt&&p.endsAt<=now()?'expired':p.rules.maxUses&&p.usageCount>=p.rules.maxUses?'exhausted':p.startsAt&&p.startsAt>now()?'scheduled':p.status
const money=(value:unknown,currency:string,label:string,optional=false)=>{
  if(optional&&(value===''||value===undefined||value===null))return undefined
  const text=String(value??'').trim(),digits=minorDigits(currency)
  if(!new RegExp(`^\\d+(?:\\.\\d{1,${Math.max(1,digits)}})?$`).test(text)||!digits&&text.includes('.'))throw new Error(`Enter ${label} in ${currency}, for example ${digits?'19.99':'1999'}`)
  const amount=Math.round(Number(text)*10**digits)
  if(!Number.isSafeInteger(amount)||amount<0||amount>1_000_000_000)throw new Error(`${label} is outside the supported range`)
  return amount
}
const integer=(value:unknown,label:string,min=1,max=999)=>{const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)throw new Error(`${label} must be a whole number from ${min} to ${max}`);return n}
const percent=(value:unknown)=>{const n=Number(value);if(value===''||!Number.isFinite(n)||n<0||n>100)throw new Error('Enter a percentage from 0 to 100');return n}
const ids=(value:unknown,available:Set<string>,label:string)=>{if(!Array.isArray(value))throw new Error(`Choose ${label} from this store`);const result=[...new Set(value)];if(result.some(id=>typeof id!=='string'||!available.has(id)))throw new Error(`Choose ${label} from this store`);return result as string[]}
const short=(value:unknown,max=150)=>String(value??'').trim().slice(0,max)
const date=(value:unknown,label:string)=>{if(!value)return null;const at=new Date(String(value));if(!Number.isFinite(at.getTime()))throw new Error(`Choose a valid ${label}`);return at.toISOString()}
const displayMoney=(value:number|undefined,currency:string)=>value===undefined?'':(value/10**minorDigits(currency)).toFixed(minorDigits(currency))

export function discountData(db:Db,store:Store){
  const products=listProducts(db,store.id,{limit:1000}),collections=listCollections(db,store.id),regions=listRegions(db,store.id)
  const offers:any[] = listBundles(db,store.id).map(bundle=>({
    id:bundle.id,entity:'bundle',type:'quantity',revision:revision(bundle),title:bundle.title,productId:bundle.productId,status:bundle.status,pricingMode:bundle.pricingMode||'bulk',
    layout:bundle.style.layout||'stacked',accent:bundle.style.accent||'',showCompare:bundle.style.showCompare!==false,showPerUnit:bundle.style.showPerUnit!==false,
    tiers:bundle.tiers.map(tier=>({quantity:tier.quantity,priceType:tier.totalPriceCents!==undefined||tier.unitPriceCents!==undefined?'total':'percent',value:tier.totalPriceCents!==undefined?displayMoney(tier.totalPriceCents,store.currency):tier.unitPriceCents!==undefined?displayMoney(tier.unitPriceCents*tier.quantity,store.currency):String(tier.discountPercent),compare:displayMoney(tier.compareAtTotalCents,store.currency),label:tier.label,badge:tier.badge||'',freeShipping:!!tier.freeShipping,giftVariantId:tier.giftVariantId||'',giftLabel:tier.giftLabel||''})),
  }))
  offers.push(...listPromotions(db,store.id).filter(p=>!p.rules.bundleProductId).map(p=>({
    id:p.id,entity:'promotion',type:['percentage','fixed'].includes(p.kind)?'amount':p.kind==='bundle'?'tiered':p.kind,revision:promoRevision(p),title:p.title,status:promotionState(p),
    method:p.code?'code':'automatic',code:p.code,value:p.kind==='fixed'?displayMoney(p.value,store.currency):String(p.value),amountType:p.kind==='fixed'?'fixed':'percentage',
    scope:[p.rules.variantIds,p.rules.productIds,p.rules.collectionIds].filter(ids=>ids?.length).length>1?'selection':p.rules.variantIds?.length?'variants':p.rules.productIds?.length?'products':p.rules.collectionIds?.length?'collections':'all',variantIds:p.rules.variantIds||[],productIds:p.rules.productIds||[],collectionIds:p.rules.collectionIds||[],
    buyProductIds:p.rules.buyProductIds||[],getProductIds:p.rules.getProductIds||[],rewardScope:p.rules.getProductIds?.length?'different':'same',
    minSubtotal:displayMoney(p.rules.minSubtotalCents,store.currency),minQuantity:p.rules.minQuantity||'',buyQuantity:p.rules.buyQuantity||1,getQuantity:p.rules.getQuantity||1,
    requiredDistinctProducts:p.rules.requiredDistinctProducts||2,bundlePrice:displayMoney(p.rules.bundlePriceCents??(p.kind==='fixed_bundle'?p.value:undefined),store.currency),setQuantity:p.rules.minQuantity||p.rules.buyQuantity||2,
    firstOrderOnly:!!p.rules.firstOrderOnly,combinable:p.rules.combinable!==false,priority:p.rules.priority||0,maxUses:p.rules.maxUses||'',regionScope:p.rules.regionIds?.length?'selected':'all',regionIds:p.rules.regionIds||[],startsAt:p.startsAt||'',endsAt:p.endsAt||'',
    tiers:(p.kind==='bundle'?[{quantity:p.rules.buyQuantity||2,percent:p.value}]:p.rules.tiers||[]).map(tier=>({quantity:tier.quantity,priceType:tier.totalPriceCents!==undefined?'total':tier.unitPriceCents!==undefined?'each':'percent',value:tier.totalPriceCents!==undefined?displayMoney(tier.totalPriceCents,store.currency):tier.unitPriceCents!==undefined?displayMoney(tier.unitPriceCents,store.currency):String(tier.percent)})),
    usageCount:p.usageCount,
  })))
  return {currency:store.currency,digits:minorDigits(store.currency),storeId:store.id,types:discountTypes,offers,products:products.map(p=>({id:p.id,title:p.title,image:p.heroImage,variants:p.variants.map(v=>({id:v.id,title:v.title,priceCents:v.priceCents,compareAtCents:v.compareAtCents}))})),collections:collections.map(c=>({id:c.id,title:c.title})),regions:regions.map(r=>({id:r.id,title:r.name}))}
}

function parseDraft(db:Db,store:Store,input:any){
  if(!input||typeof input!=='object'||!discountTypes.some(type=>type.id===input.type))throw new Error('Choose a discount type')
  const title=short(input.title);if(!title)throw new Error('Give this discount a name')
  const products=listProducts(db,store.id,{limit:1000}),productIds=new Set(products.map(p=>p.id)),collectionIds=new Set(listCollections(db,store.id).map(c=>c.id))
  const existing=input.id?(input.entity==='bundle'?listBundles(db,store.id).find(b=>b.id===input.id):listPromotions(db,store.id).find(p=>p.id===input.id&&!p.rules.bundleProductId)):undefined
  if(input.id&&!existing)throw new Error('Choose an existing discount from this store')
  if(existing&&input.revision!==('kind' in existing?promoRevision(existing):revision(existing)))throw new Error('This discount changed in another tab. Reload before saving; your draft is still open.')
  if(existing&&(('kind' in existing)!==(input.type!=='quantity')))throw new Error('Create a new discount to change between a product offer and a general discount')
  const parseTiers=():BundleTier[]=>{
    if(!Array.isArray(input.tiers)||!input.tiers.length||input.tiers.length>20)throw new Error('Add between 1 and 20 pricing tiers')
    const quantities=new Set<number>()
    return input.tiers.map((tier:any)=>{
      const quantity=integer(tier.quantity,'Tier quantity');if(quantities.has(quantity))throw new Error('Each tier needs a different quantity');quantities.add(quantity)
      if(!['percent','total','each'].includes(tier.priceType))throw new Error('Choose a price type for each tier')
      const value=tier.priceType==='percent'?percent(tier.value):money(tier.value,store.currency,'tier price')!
      if(tier.priceType!=='percent'&&value<=0)throw new Error('Tier prices must be greater than zero')
      const giftVariantId=short(tier.giftVariantId),compare=money(tier.compare,store.currency,'original total',true)
      if(giftVariantId&&!getVariant(db,store.id,giftVariantId))throw new Error('Choose a gift from this store')
      return {quantity,discountPercent:tier.priceType==='percent'?value:0,...(tier.priceType==='total'?{totalPriceCents:value}:tier.priceType==='each'?{unitPriceCents:value}:{}),...(compare!==undefined?{compareAtTotalCents:compare}:{}),label:short(tier.label)||`Buy ${quantity}`,badge:short(tier.badge,60),freeShipping:!!tier.freeShipping,...(giftVariantId?{giftVariantId,giftLabel:short(tier.giftLabel)||'Free gift'}:{})}
    }).sort((a:BundleTier,b:BundleTier)=>a.quantity-b.quantity)
  }
  if(input.type==='quantity'){
    const product=getProduct(db,store.id,String(input.productId));if(!product)throw new Error('Choose a product for this offer')
    const previous=listBundles(db,store.id).find(b=>b.productId===product.id)
    if(previous&&previous.id!==input.id)throw new Error('This product already has a quantity offer. Open its Edit button to preserve its existing prices.')
    if(existing&&'productId' in existing&&existing.productId!==product.id)throw new Error('Create a new offer to change its product')
    if(!['multiples','bulk'].includes(input.pricingMode))throw new Error('Choose how quantity pricing works')
    const tiers=parseTiers(),unit=Math.min(...product.variants.map(v=>v.priceCents))
    for(const tier of tiers){const total=tier.totalPriceCents??(tier.unitPriceCents!==undefined?tier.unitPriceCents*tier.quantity:Math.round(unit*tier.quantity*(1-tier.discountPercent/100)));if(total>unit*tier.quantity)throw new Error('An offer price cannot exceed the regular item price');if(tier.compareAtTotalCents!==undefined&&tier.compareAtTotalCents<total)throw new Error('The original total must be at least the sale total')}
    if(input.accent&&!/^#[0-9a-f]{6}$/i.test(input.accent))throw new Error('Choose a valid accent color')
    const bundle={productId:product.id,title,tiers,pricingMode:input.pricingMode==='multiples'?'multiples' as const:'bulk' as const,style:{...((existing as Bundle|undefined)?.style||{}),layout:input.layout==='row'?'row' as const:'stacked' as const,accent:input.accent||'',showCompare:input.showCompare!==false,showPerUnit:input.showPerUnit!==false}}
    return {existing,bundle}
  }
  const kind=(input.type==='amount'?(input.amountType==='fixed'?'fixed':'percentage'):input.type) as Promotion['kind']
  const rules:Promotion['rules']={combinable:!!input.combinable,firstOrderOnly:!!input.firstOrderOnly,priority:integer(input.priority||0,'Priority',0,100)}
  if(input.scope==='selection'){rules.productIds=ids(input.productIds,productIds,'products');rules.variantIds=ids(input.variantIds,new Set(products.flatMap(p=>p.variants.map(v=>v.id))),'variants');rules.collectionIds=ids(input.collectionIds,collectionIds,'collections');if(!rules.productIds.length&&!rules.variantIds.length&&!rules.collectionIds.length)throw new Error('Select at least one eligible item')}
  else if(input.scope==='products'){rules.productIds=ids(input.productIds,productIds,'products');if(!rules.productIds.length)throw new Error('Select at least one eligible product')}
  else if(input.scope==='variants'){rules.variantIds=ids(input.variantIds,new Set(products.flatMap(p=>p.variants.map(v=>v.id))),'variants');if(!rules.variantIds.length)throw new Error('Select at least one eligible variant')}
  else if(input.scope==='collections'){rules.collectionIds=ids(input.collectionIds,collectionIds,'collections');if(!rules.collectionIds.length)throw new Error('Select at least one eligible collection')}
  else if(input.scope!=='all')throw new Error('Choose which items qualify')
  let value=['percentage','bogo','mix_match'].includes(kind)?percent(input.value):kind==='fixed'?money(input.value,store.currency,'discount amount')!:0
  if(['percentage','fixed','mix_match'].includes(kind)&&value<=0)throw new Error('Enter a discount greater than zero')
  if(input.minSubtotal!=='')rules.minSubtotalCents=money(input.minSubtotal,store.currency,'minimum spend',true)
  if(input.minQuantity)rules.minQuantity=integer(input.minQuantity,'Minimum quantity')
  if(input.maxUses)rules.maxUses=integer(input.maxUses,'Usage limit',1,1_000_000)
  if(input.regionScope==='selected'){rules.regionIds=ids(input.regionIds,new Set(listRegions(db,store.id).map(r=>r.id)),'markets');if(!rules.regionIds.length)throw new Error('Select at least one market')}
  else if(input.regionScope!=='all')throw new Error('Choose which markets qualify')
  if(kind==='bogo'){
    rules.buyQuantity=integer(input.buyQuantity,'Buy quantity');rules.getQuantity=integer(input.getQuantity,'Get quantity')
    if(value<=0)throw new Error('Enter a reward discount greater than zero')
    if(input.rewardScope==='different'){
      rules.buyProductIds=ids(input.buyProductIds,productIds,'buy products');rules.getProductIds=ids(input.getProductIds,productIds,'reward products')
      if(!rules.buyProductIds.length||!rules.getProductIds.length)throw new Error('Choose both the buy products and reward products')
      if(rules.buyProductIds.some(id=>rules.getProductIds!.includes(id)))throw new Error('Use different buy and reward products, or choose the same-item offer')
      delete rules.productIds;delete rules.collectionIds;delete rules.variantIds
    }
  }
  if(kind==='mix_match')rules.requiredDistinctProducts=integer(input.requiredDistinctProducts,'Different products required',2,50)
  if(kind==='fixed_bundle'){rules.minQuantity=integer(input.setQuantity,'Items per set');rules.bundlePriceCents=money(input.bundlePrice,store.currency,'set price')!;if(rules.bundlePriceCents<=0)throw new Error('Enter a set price greater than zero');value=rules.bundlePriceCents}
  if(kind==='tiered'){
    rules.tiers=parseTiers().map(t=>({quantity:t.quantity,percent:t.discountPercent,...(t.unitPriceCents!==undefined?{unitPriceCents:t.unitPriceCents}:{}),...(t.totalPriceCents!==undefined?{totalPriceCents:t.totalPriceCents}:{})}))
    if(rules.tiers.some(t=>t.unitPriceCents!==undefined||t.totalPriceCents!==undefined)&&(rules.productIds?.length!==1||rules.variantIds?.length||rules.collectionIds?.length))throw new Error('Exact bulk prices need one eligible product; use percentages for mixed products or collections')
    rules.quantityMode='bulk'
  }
  if(!['code','automatic'].includes(input.method))throw new Error('Choose a discount method')
  const code=input.method==='code'?short(input.code,40).toUpperCase():''
  if(input.method==='code'&&!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code))throw new Error('Enter a code with 2–40 letters, numbers, dashes or underscores')
  if(code&&listPromotions(db,store.id).some(p=>p.id!==input.id&&p.code.toUpperCase()===code))throw new Error('That code already exists in this store')
  const startsAt=date(input.startsAt,'start date'),endsAt=date(input.endsAt,'end date')
  if(endsAt&&startsAt&&endsAt<=startsAt)throw new Error('The end date must be after the start date')
  return {existing,promotion:{title,kind,value,code,automatic:!code,rules,startsAt,endsAt}}
}

export function saveDiscount(db:Db,store:Store,input:unknown,actorId:string){
  const parsed=parseDraft(db,store,input)
  let id:string
  if(parsed.bundle){const bundle=upsertBundle(db,store.id,parsed.bundle);id=bundle.id;if(parsed.existing?.status==='paused')setBundleStatus(db,store.id,id,'paused')}
  else {
    const promotion=parsed.promotion!
    if(parsed.existing){id=parsed.existing.id;db.update('promotions',id,{title:promotion.title,kind:promotion.kind,value:promotion.value,code:promotion.code,automatic:promotion.automatic,rules:promotion.rules,starts_at:promotion.startsAt,ends_at:promotion.endsAt,status:parsed.existing.status==='disabled'?'disabled':promotion.startsAt&&promotion.startsAt>now()?'scheduled':'active'})}
    else id=createPromotion(db,store.id,promotion).id
  }
  recordAudit(db,{storeId:store.id,actorType:'user',actorId,action:'save_discount',target:id,diff:{before:parsed.existing||null,after:parsed.bundle||parsed.promotion}})
  return {id,...discountData(db,store)}
}

export function previewDiscount(db:Db,store:Store,input:any){
  const parsed=parseDraft(db,store,input),bundle=parsed.bundle
  const rules=bundle?{title:bundle.title,kind:'tiered' as const,value:0,automatic:true,rules:{productIds:[bundle.productId],quantityMode:bundle.pricingMode,tiers:bundle.tiers.map(t=>({quantity:t.quantity,percent:t.discountPercent,...(t.unitPriceCents!==undefined?{unitPriceCents:t.unitPriceCents}:{}),...(t.totalPriceCents!==undefined?{totalPriceCents:t.totalPriceCents}:{})}))}}:parsed.promotion!
  const sample=Array.isArray(input.sample)?input.sample:[]
  if(!sample.length||sample.length>10)throw new Error('Add 1–10 items to the test cart')
  const items:LineItem[]=sample.map((item:any)=>{const variant=getVariant(db,store.id,String(item.variantId)),quantity=integer(item.quantity,'Test quantity');if(!variant)throw new Error('Choose a test item from this store');const product=getProduct(db,store.id,variant.productId)!;return {variantId:variant.id,productId:product.id,title:product.title,variantTitle:variant.title,image:product.heroImage,unitCents:variant.priceCents,quantity}})
  const subtotalCents=items.reduce((sum,item)=>sum+item.unitCents*item.quantity,0)
  // Preview is a read-only quote from the same engine that prices carts.
  const promotion={id:'preview',storeId:store.id,code:'',status:'active',startsAt:null,endsAt:null,usageCount:0,createdAt:now(),...rules} as Promotion
  promotion.startsAt=null;promotion.endsAt=null
  const result=applyPromotions(db,store.id,items,{subtotalCents,code:promotion.code,isFirstOrder:true,regionId:promotion.rules.regionIds?.[0],promotions:[promotion]})
  const count=bundle?items.filter(item=>item.productId===bundle.productId).reduce((sum,item)=>sum+item.quantity,0):0
  const hit=bundle?[...bundle.tiers].reverse().find(t=>count>=t.quantity):undefined
  return {subtotalCents,discountCents:result.discountCents,totalCents:subtotalCents-result.discountCents,freeShipping:result.freeShipping||!!bundle?.tiers.some(t=>t.freeShipping&&count>=t.quantity),gift:hit?.giftVariantId?(hit.giftLabel||getProduct(db,store.id,getVariant(db,store.id,hit.giftVariantId)!.productId)?.title||'Free gift'):null,items,qualifies:result.applied.length>0||!!hit}
}

export function changeDiscountStatus(db:Db,store:Store,input:any){
  if(input.entity==='bundle')setBundleStatus(db,store.id,String(input.id),input.active?'active':'paused')
  else {const promo=listPromotions(db,store.id).find(p=>p.id===input.id&&!p.rules.bundleProductId);if(!promo)throw new Error('Choose a discount from this store');if(input.active&&promo.endsAt&&promo.endsAt<=now())throw new Error('Edit the end date before activating this discount');if(input.active&&promo.rules.maxUses&&promo.usageCount>=promo.rules.maxUses)throw new Error('Edit the use limit before activating this discount');setPromotionStatus(db,store.id,promo.id,input.active?(promo.startsAt&&promo.startsAt>now()?'scheduled':'active'):'disabled')}
  return discountData(db,store)
}
