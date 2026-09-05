import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createBlankAsset } from '../src/control/assets.ts'
import { deleteAsset, deletionToken } from '../src/control/delete-asset.ts'
import { createPage, getPage, listPageRevisions } from '../src/pages/store.ts'
import { createProduct } from '../src/domain/catalog.ts'
import { captureAssistantContext, platformContext } from '../src/agent/context.ts'
import { getTool } from '../src/agent/registry.ts'
import { enqueueAssistantRequest, cancelAssistantRequest } from '../src/agent/queue.ts'
import { install } from '../src/control/plugins.ts'
import { queueServerEvents, dispatchServerEvents } from '../src/analytics/server-events.ts'

test('asset deletion enforces owner, fresh session confirmation and exact name, and preserves other assets',()=>{
 const {db,user}=fresh(),store=createBlankAsset(db,user.id,{name:'Disposable funnel',kind:'funnel',currency:'USD'}),other=createBlankAsset(db,user.id,{name:'Keep me',kind:'store',currency:'USD'});
 const page=createPage(db,store.id,{title:'Remove this page'});createProduct(db,store.id,{title:'Delete me'});
 const token=deletionToken(store,user.id,'session'),input={name:store.name,acknowledged:true,token,session:'session'};
 assert.throws(()=>deleteAsset(db,'somebody-else',store.id,input),/access/);
 assert.throws(()=>deleteAsset(db,user.id,store.id,{...input,name:'Disposable'}),/exact asset name/);
 assert.throws(()=>deleteAsset(db,user.id,store.id,{...input,acknowledged:false}),/acknowledge/);
 assert.throws(()=>deleteAsset(db,user.id,store.id,{...input,session:'different'}),/expired/);
 assert.throws(()=>deleteAsset(db,user.id,store.id,{...input,token:deletionToken(store,user.id,'session',Date.now()-700000)}),/expired/);
 const request=enqueueAssistantRequest(db,{storeId:store.id,userId:user.id,text:'Keep working'});assert.throws(()=>deleteAsset(db,user.id,store.id,input),/Wait for the active/);cancelAssistantRequest(db,store.id,request.id);
 deleteAsset(db,user.id,store.id,input);assert.equal(getPage(db,store.id,page.id),null);assert.equal(db.one('SELECT id FROM stores WHERE id=?',store.id),null);assert.ok(db.one('SELECT id FROM stores WHERE id=?',other.id));assert.ok(db.one("SELECT id FROM audit_log WHERE action='delete_asset' AND target=?",store.id));
});

test('assistant context is scoped to the current asset and excludes sensitive form fields',()=>{
 const {db,user}=fresh(),a=createBlankAsset(db,user.id,{name:'Current',kind:'funnel',currency:'USD'}),b=createBlankAsset(db,user.id,{name:'Other',kind:'store',currency:'USD'}),p=createPage(db,b.id,{title:'Foreign secret'});
 const context=captureAssistantContext(db,a.id,'editor',{path:'/admin/pages/'+p.id+'/edit',password:'never-include',selection:{id:'pb-1'}});
 const prompt=platformContext(db,a.id,context);assert.doesNotMatch(prompt,/Foreign secret|never-include/);assert.match(prompt,/"kind":"funnel"/);
 const theme=captureAssistantContext(db,a.id,'store',{path:'/admin/store',theme:{primary:'#123456',accessToken:'secret-token'},unsaved:true});assert.match(theme,/#123456/);assert.doesNotMatch(theme,/secret-token/);
});

test('assistant HTML edits reject stale and ambiguous source and retain restorable revisions',async()=>{
 const {db,user}=fresh(),store=createBlankAsset(db,user.id,{name:'HTML editor',kind:'store',currency:'USD'}),page=createPage(db,store.id,{title:'Source',mode:'html',rawHtml:'<!doctype html><h1>Original title</h1><p>Keep this</p>'});
 const ctx={db,storeId:store.id,actor:{type:'agent' as const,id:user.id}};
 const read=await getTool('read_page_html')!.handler({pageId:page.id,search:'Original title'},ctx);const hash=(read.data as {hash:string}).hash;
 const patch={pageId:page.id,hash,find:'Original title',replacement:'A better title'};
 assert.throws(()=>getTool('replace_page_html')!.handler({...patch,hash:'stale'},ctx),/changed/);
 assert.throws(()=>getTool('replace_page_html')!.handler(patch,{...ctx,page:captureAssistantContext(db,store.id,'editor',{path:'/admin/pages/'+page.id+'/edit',unsaved:true})}),/Save the changes/);
 await getTool('replace_page_html')!.handler(patch,ctx);assert.match(getPage(db,store.id,page.id)!.rawHtml,/A better title/);assert.match(listPageRevisions(db,store.id,page.id).at(-1)!.snapshot.rawHtml,/Original title/);
});

test('Meta CAPI Test Events codes stay server-side and delivery requires acknowledgement',async()=>{
 const {db,user}=fresh(),store=createBlankAsset(db,user.id,{name:'Meta test',kind:'store',currency:'JPY'});install(db,store.id,'meta-pixel',{pixelId:'1234567890',accessToken:'private-token',testEventCode:'TEST123'});
 queueServerEvents(db,store.id,{eventId:'purchase-one',type:'checkout.complete',url:'https://example.com/receipt',ip:'127.0.0.1',userAgent:'test',currency:'JPY',valueCents:1200,email:' BUYER@Example.com ',fbp:'fb.1.123.456'});
 let payload:any;const result=await dispatchServerEvents(db,async(_url,init)=>{payload=JSON.parse(String(init.body));return {ok:true,status:200,text:async()=>'{"events_received":0}'};});
 assert.equal(result.sent,0);assert.equal(result.failed,1);assert.equal(payload.test_event_code,'TEST123');assert.equal(payload.data[0].custom_data.value,1200);assert.match(payload.data[0].user_data.em[0],/^[a-f0-9]{64}$/);assert.equal(payload.data[0].user_data.fbp,'fb.1.123.456');
});
