import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Db } from '../lib/db.ts'
import { badRequest } from '../lib/http.ts'
import { getStore, type Store } from './stores.ts'
import { requireRole } from './auth.ts'
import { invalidateStorefrontConfig } from './plugins.ts'
import { recordAudit } from './todos.ts'

export function deletionToken(store:Store,userId:string,session:string,time=Date.now()):string {
 return time+'.'+createHmac('sha256',session).update([store.id,store.name,userId,time].join('|')).digest('hex')
}
export function assetImpact(db:Db,storeId:string){
 return Object.fromEntries(['pages','products','orders','customers','domains'].map(table=>[table,db.one<{n:number}>(`SELECT COUNT(*) n FROM ${table} WHERE store_id=?`,storeId)?.n||0]));
}
export function deleteAsset(db:Db,userId:string,storeId:string,input:{name:string;acknowledged:boolean;token:string;session:string}){
 requireRole(db,userId,storeId,'owner');const store=getStore(db,storeId)!;
 const time=Number(input.token.split('.')[0]),expected=deletionToken(store,userId,input.session,time);
 if(!Number.isFinite(time)||time>Date.now()||Date.now()-time>600_000||expected.length!==input.token.length||!timingSafeEqual(Buffer.from(expected),Buffer.from(input.token)))throw badRequest('This confirmation expired. Open the deletion screen again.');
 if(input.name!==store.name||!input.acknowledged)throw badRequest('Type the exact asset name and acknowledge the deletion.');
 const working=db.one<{n:number}>("SELECT COUNT(*) n FROM agent_runs WHERE store_id=? AND status IN ('queued','running')",storeId)?.n||0;
 const assistant=db.one<{n:number}>("SELECT COUNT(*) n FROM assistant_queue WHERE store_id=? AND status IN ('queued','running')",storeId)?.n||0;
 const building=db.one<{n:number}>("SELECT COUNT(*) n FROM store_environments WHERE store_id=? AND build_state='building'",storeId)?.n||0;
 if(working||assistant||building)throw badRequest('Wait for the active build or assistant request to finish before deleting this asset.');
 const impact=assetImpact(db,storeId);
 db.tx(()=>{db.run('DELETE FROM stores WHERE id=? AND owner_id=?',storeId,userId);recordAudit(db,{storeId,actorType:'user',actorId:userId,action:'delete_asset',target:storeId,diff:{name:store.name,kind:store.kind,impact}});});
 invalidateStorefrontConfig(storeId);return store;
}
