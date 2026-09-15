export type QuantityPrice = { quantity:number; percent?:number; discountPercent?:number; unitPriceCents?:number; totalPriceCents?:number }
export type QuantityMode = 'bulk'|'multiples'

/** Used for the storefront, cart, checkout and discount builder preview. */
export function quantityPrice(tiers:QuantityPrice[], quantity:number, unit:number, mode:QuantityMode='bulk'):number {
  const full=Math.round(unit*quantity)
  if(!Number.isSafeInteger(quantity)||quantity<1)return full
  const price=(tier:QuantityPrice)=>Math.min(Math.round(unit*tier.quantity),tier.totalPriceCents??(tier.unitPriceCents!==undefined?tier.unitPriceCents*tier.quantity:Math.round(unit*tier.quantity*(1-(tier.percent??tier.discountPercent??0)/100))))
  if(mode==='bulk'){
    const tier=[...tiers].sort((a,b)=>b.quantity-a.quantity).find(tier=>quantity>=tier.quantity)
    return tier?Math.min(full,tier.totalPriceCents===undefined&&tier.unitPriceCents===undefined?Math.round(full*(1-(tier.percent??tier.discountPercent??0)/100)):Math.round(price(tier)*quantity/tier.quantity)):full
  }
  // Complete packs only; remaining units keep their normal price. Choose the
  // cheapest valid combination when several pack sizes fit the quantity.
  const prices=Array.from({length:quantity+1},(_,i)=>Math.round(i*unit))
  for(let count=1;count<=quantity;count++){
    prices[count]=Math.min(prices[count]!,Math.round(prices[count-1]!+unit))
    for(const tier of tiers)if(tier.quantity>0&&tier.quantity<=count)prices[count]=Math.min(prices[count]!,prices[count-tier.quantity]!+price(tier))
  }
  return prices[quantity]!
}
