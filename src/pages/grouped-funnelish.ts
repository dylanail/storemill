import { parse } from 'parse5'
import { minorDigits } from '../lib/money.ts'
import type { SourceCommerce, SourceProduct } from './source-commerce.ts'

/** Public input names and configuration prices are data; source scripts are never executed. */
export function groupedFunnelish(html:string,source:string,funnel:any,step:any,entries:any[]):SourceCommerce|null {
 const controls:Array<{id:string;kind:string;checked:boolean;hidden:boolean;aggregate:boolean}>=[];let unknown=false
 const walk=(node:any,aggregate=false)=>{const a=Object.fromEntries((node.attrs||[]).map((x:any)=>[x.name,x.value]))
  if(node.tagName==='input'&&String(a.name||'').startsWith('product-id')){
   const kind=a.name==='product-id_main_product'&&a.type==='radio'?'primary':a.name==='product-id_shipping_product'&&a.type==='radio'?'shipping':a.name==='product-id'&&a.type==='checkbox'?'addon':''
   if(!kind)unknown=true
   controls.push({id:String(a.value||''),kind,checked:'checked'in a,hidden:'hidden'in a||/display\s*:\s*none/i.test(a.style||''),aggregate:aggregate||a['data-source']==='currentProduct'})
  }for(const child of node.childNodes||[])walk(child,aggregate||a['data-source']==='currentProduct')
 };walk(parse(html))
 if(!controls.some(c=>c.kind==='primary'||c.kind==='shipping'))return null
 const out:SourceCommerce={platform:'funnelish',funnelId:String(funnel.id),stepType:Number(step.type),stepOrder:Number(step.order_index||0),products:[],issues:[],giftRules:{},shipping:[]}
 const blocked=(reason:string)=>{out.products=[];out.shipping=[];out.issues.push('Grouped Funnelish checkout is blocked: '+reason);return out}
 if(unknown)return blocked('an unsupported product selector was found; configure its meaning before publishing.')
 if(!/^[A-Z]{3}$/.test(funnel.currency_code))return blocked('source currency is missing or invalid.')
 const currency=funnel.currency_code,group=`funnelish:${funnel.id}:${step.id}`,plain=(x:any)=>String(x||'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()
 const chosen=new Map<string,typeof controls[number]>()
 for(const c of controls){const prior=chosen.get(c.id);if(prior&&(prior.kind!==c.kind||prior.checked!==c.checked))return blocked('conflicting duplicated selectors for '+c.id);chosen.set(c.id,c)}
 if(![...chosen.values()].some(c=>c.kind==='primary'))return blocked('there is no explicit main-product selector.')
 if(![...chosen.values()].some(c=>c.kind==='shipping'))return blocked('there is no explicit source shipping group; no free shipping rate is invented.')
 if([...chosen.values()].filter(c=>c.kind==='shipping'&&c.checked).length!==1)return blocked('the shipping default is ambiguous; choose an explicit source rate.')
 for(const kind of ['primary','shipping'])if([...chosen.values()].filter(c=>c.kind===kind&&c.checked).length>1)return blocked('multiple defaults in the '+kind+' radio group.')
 const primary:SourceProduct[]=[]
 for(const c of chosen.values()){
  if(c.hidden&&c.checked)return blocked('a hidden default purchase selection needs explicit merchant mapping.')
  const matches=entries.filter(p=>String(p.id)===c.id);if(matches.length!==1)return blocked('selector '+c.id+' has no unique source price record.')
  const p=matches[0];let matrix;try{matrix=typeof p.variants==='string'?JSON.parse(p.variants):p.variants}catch{return blocked('invalid variant configuration for '+c.id)}
  if(p.isSub||matrix?.variants?.length||!Array.isArray(p.options)||p.options.length!==1)return blocked('recurring or multi-option selection '+c.id+' needs explicit mapping.')
  const option=p.options[0],value=option.price??p.price
  if(typeof option.soldout!=='boolean')return blocked('source availability is unknown for '+c.id)
  if(c.checked&&option.soldout)return blocked('a default source option is unavailable: '+c.id)
  if(!/^(?:\d+)(?:\.\d+)?$/.test(String(value)))return blocked('no explicit non-negative source price for '+c.id)
  const price=Math.round(Number(value)*10**minorDigits(currency));if(!Number.isSafeInteger(price)||Math.abs(price-Number(value)*10**minorDigits(currency))>0.000001||!plain(p.name))return blocked('invalid price or label for '+c.id)
  if(c.kind==='shipping'){
   if(option.soldout)return blocked('shipping availability cannot be represented for '+c.id)
   out.shipping!.push({sourceId:c.id,name:plain(p.name),amountCents:price,currency,isDefault:c.checked,group});continue
  }
  const image=(()=>{try{const value=option.imageUrl||p.imageUrl;return value&&/^https?:$/.test(new URL(value,source).protocol)?new URL(value,source).href:''}catch{return ''}})()
  const entry:SourceProduct={key:group+':'+c.id,purpose:c.kind==='primary'?'primary':'addon',sourceIds:[c.id],defaultSourceId:c.checked?c.id:undefined,product:{title:plain(p.name),description:'',images:image?[image]:[],priceCents:price,currency,options:[],variants:[{title:plain(p.name),priceCents:price,image,sourceId:c.id,sourceAliases:[c.id,String(option.id)],inventory:0,allowBackorder:!option.soldout}],source,metadata:{sourcePlatform:'funnelish',sourceGroup:group,sourcePurpose:c.kind,sourceDefaultChecked:String(c.checked),sourceControlHidden:String(c.hidden),...(c.kind==='addon'?{hidden:'true'}:{})}}}
  if(c.kind==='primary')primary.push(entry);else out.products.push(entry)
  if(c.hidden)out.issues.push('Hidden source selection '+plain(p.name)+' was preserved in the catalog without exposing it as a new purchase option. Its custom source behavior needs merchant review.')
 }
 const defaults=primary.find(p=>p.defaultSourceId)||primary[0]!
 out.products.unshift({key:group+':primary',purpose:'primary',sourceIds:primary.flatMap(p=>p.sourceIds),defaultSourceId:defaults.defaultSourceId,product:{...defaults.product,title:plain(entries.find(p=>[...chosen.values()].some(c=>c.aggregate&&c.hidden&&!c.checked&&c.id===String(p.id)))?.name)||primary[0]!.product.title,images:[...new Set(primary.flatMap(p=>p.product.images))],variants:primary.flatMap(p=>p.product.variants),metadata:{...defaults.product.metadata,sourceDefaultVariant:defaults.defaultSourceId||'',sourceGrouped:'true'}}})
 const referenced=new Set(chosen.keys()),unmapped=entries.filter(p=>!referenced.has(String(p.id)))
 if(unmapped.length)return blocked('source catalog entries have no explicit selector: '+unmapped.map(p=>plain(p.name)).join(', '))
 return out
}
