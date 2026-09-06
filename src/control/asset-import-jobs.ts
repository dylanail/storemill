import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { notFound } from '../lib/http.ts'
import { importAssetFromUrl, type ImportProgress } from './assets.ts'
import { recordAudit } from './todos.ts'

type Input = {url:string;name?:string;kind:'store'|'funnel';currency?:string;additionalUrls?:string[];maxPages?:number}
export type ImportJob = {id:string;owner_id:string;input:string;status:'queued'|'working'|'done'|'failed'|'cancelled';progress:string;result:string;error:string;created_at:string;updated_at:string}
export type ImportResult = {storeId:string;pageId:string;pages:number;products:number;complete:boolean}
export function listImports(db: Db, ownerId: string): ImportJob[] {
  return db.all<ImportJob>('SELECT * FROM asset_import_jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 30',ownerId)
}
export function getImport(db: Db, ownerId: string, jobId: string): ImportJob {
  const job=db.one<ImportJob>('SELECT * FROM asset_import_jobs WHERE id=? AND owner_id=?',jobId,ownerId)
  if(!job)throw notFound('Clone not found')
  return job
}
export function startImport(db: Db, ownerId: string, input: Input, requestKey=''): ImportJob {
  input={...input,url:input.url.trim(),additionalUrls:(input.additionalUrls||[]).map(url=>url.trim()).filter(Boolean)}
  if(!/^https?:\/\/[^\s]+$/i.test(input.url))throw Error('Paste a full URL starting with https://')
  if(!['store','funnel'].includes(input.kind)||! /^[A-Z]{3}$/.test(input.currency||'USD'))throw Error('Choose an asset type and three-letter currency')
  if(input.additionalUrls!.length>100||input.additionalUrls!.some(url=>!/^https?:\/\/[^\s]+$/i.test(url)))throw Error('Use up to 100 full URLs for additional pages')
  if(requestKey&&!/^[a-zA-Z0-9_-]{8,100}$/.test(requestKey))throw Error('Reload the clone form and try again')
  const existing=(requestKey?db.one<ImportJob>('SELECT * FROM asset_import_jobs WHERE owner_id=? AND request_key=?',ownerId,requestKey):null)||listImports(db,ownerId).find(job=>['queued','working'].includes(job.status)&&job.input===JSON.stringify(input))
  if(existing)return existing
  if(listImports(db,ownerId).filter(job=>['queued','working'].includes(job.status)).length>=3)throw Error('Wait for a clone to finish before starting another')
  const jobId=id('copy'),timestamp=now()
  db.insert('asset_import_jobs',{id:jobId,owner_id:ownerId,request_key:requestKey,input,progress:{percent:0,task:'Waiting to start',copied:0,discovered:1,products:0,images:0,currentUrl:input.url},created_at:timestamp,updated_at:timestamp})
  return getImport(db,ownerId,jobId)
}
const workers=new WeakMap<Db,{busy:boolean;controllers:Map<string,AbortController>}>()
export async function drainImports(db: Db, run=importAssetFromUrl): Promise<void> {
  let state=workers.get(db)
  if(!state){state={busy:false,controllers:new Map()};workers.set(db,state);db.run("UPDATE asset_import_jobs SET status='failed',error='The server restarted during this clone. Start again to retry; any saved draft remains in Stores & funnels.',updated_at=? WHERE status='working'",now())}
  if(state.busy)return
  const job=db.one<ImportJob>("SELECT * FROM asset_import_jobs WHERE status='queued' ORDER BY created_at LIMIT 1")
  if(!job)return
  state.busy=true
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(6*60*60_000)])
  state.controllers.set(job.id,controller)
  try{
    db.update('asset_import_jobs',job.id,{status:'working',updated_at:now()})
    const imported=await run(db,job.owner_id,{...json<Input>(job.input,{} as Input),signal,onProgress:(progress:ImportProgress)=>{
      signal.throwIfAborted();db.update('asset_import_jobs',job.id,{progress,updated_at:now()})
    }})
    const result:ImportResult={storeId:imported.store.id,pageId:imported.page.id,pages:imported.pages.length,products:imported.products.length,complete:imported.report.complete}
    db.update('asset_import_jobs',job.id,{status:'done',result,updated_at:now()})
    recordAudit(db,{storeId:imported.store.id,actorType:'user',actorId:job.owner_id,action:'clone_asset',target:imported.clone.sourceUrl,diff:{jobId:job.id,pages:result.pages,products:result.products,complete:result.complete}})
  }catch(error){
    if(getImport(db,job.owner_id,job.id).status!=='cancelled')db.update('asset_import_jobs',job.id,{status:'failed',error:error instanceof Error?error.message:'Could not clone this site',updated_at:now()})
  }finally{state.controllers.delete(job.id);state.busy=false}
}
export function cancelImport(db: Db, ownerId: string, jobId: string): void {
  const job=getImport(db,ownerId,jobId)
  if(!['queued','working'].includes(job.status))return
  db.update('asset_import_jobs',jobId,{status:'cancelled',updated_at:now()})
  workers.get(db)?.controllers.get(jobId)?.abort(new Error('Clone cancelled'))
}
