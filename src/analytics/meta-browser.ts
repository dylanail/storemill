declare const window: any
declare const document: any
import { id } from '../lib/ids.ts'
import { minorDigits } from '../lib/money.ts'
import { getInstalled } from '../control/plugins.ts'
import { queueServerEvents, type ServerEventInput } from './server-events.ts'
import type { StoreView } from '../storefront/render.ts'

export type MetaEvent={id:string;name:string;data:Record<string,unknown>}
export const metaNames:Record<string,string>={'view.page':'PageView','view.collection':'ViewContent','view.product':'ViewContent','cart.add':'AddToCart','checkout.start':'InitiateCheckout','checkout.complete':'Purchase',signup:'Lead'};
export function metaEvent(input:ServerEventInput):MetaEvent|null {
 const name=metaNames[input.type];if(!name)return null;
 return {id:input.eventId,name,data:{...(input.currency?{currency:input.currency}:{}),...(input.valueCents!==undefined?{value:input.valueCents/10**minorDigits(input.currency||'USD')}:{}) ,...(input.productId?{content_ids:[input.productId],content_type:'product'}:{})}};
}
export function metaEventsHtml(view:StoreView):string {
 const plugin=getInstalled(view.db,view.store.id,'meta-pixel');if(view.preview||!plugin?.enabled||!plugin.settings.pixelId)return '';
 const pageInput:ServerEventInput={eventId:view.advertising?.eventId||id('pv'),type:'view.page',url:view.advertising?.url||'',ip:view.advertising?.ip||'',userAgent:view.advertising?.userAgent||'',...view.advertising};
 if(view.advertising)queueServerEvents(view.db,view.store.id,pageInput);
 const events=[metaEvent(pageInput),...(view.metaEvents||[])].filter(Boolean);
 const safe=JSON.stringify(events).replace(/</g,'\\u003c');
 const fallback=new URLSearchParams({id:String(plugin.settings.pixelId),ev:'PageView',eid:pageInput.eventId,noscript:'1'}).toString().replace(/&/g,'&amp;');
 return `<script data-meta-events>${safe}.forEach(function(event){window.amborasMeta&&window.amborasMeta(event)})</script><noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?${fallback}"></noscript>`;
}

/** The function is serialized into the installed Pixel's base code. */
export function metaClient(pixelId:string){
 const w=window as any;
 if(w.amborasMetaPixel===pixelId)return;
 const fbq=w.fbq=w.fbq||function(){(fbq.callMethod?fbq.callMethod.apply(fbq,arguments):fbq.queue.push(arguments));};
 if(!w._fbq)w._fbq=fbq;fbq.push=fbq;fbq.loaded=true;fbq.version='2.0';fbq.queue=fbq.queue||[];
 const script=document.createElement('script');script.async=true;script.src='https://connect.facebook.net/en_US/fbevents.js';document.head.appendChild(script);
 fbq('init',pixelId);w.amborasMetaPixel=pixelId;const seen=new Set();
 w.amborasMeta=(event:MetaEvent)=>{
   if(!event?.id||!event.name)return;const key=pixelId+':'+event.name+':'+event.id;
   if(seen.has(key))return;
   if(event.name==='Purchase'){try{if(sessionStorage.getItem(key))return;sessionStorage.setItem(key,'1');}catch{}}
   seen.add(key);fbq('trackSingle',pixelId,event.name,event.data||{},{eventID:event.id});
 };
}
