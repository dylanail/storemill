import assert from 'node:assert/strict'
import test from 'node:test'
import { fresh } from './helpers.ts'
import { createBlankAsset } from '../src/control/assets.ts'
import { createPage, getPage, listPages, newBlock, updatePage } from '../src/pages/store.ts'
import { upsertFunnel, getFunnel } from '../src/domain/funnels.ts'
import { duplicateWholeFunnel } from '../src/pages/funnel-clone.ts'
import { auditHtml, auditStore } from '../src/storefront/health.ts'
import { healthFix, runHealthFix, startHealthFix, undoHealthFix, recoverHealthFixes, FIX_SUGGESTIONS } from '../src/storefront/health-fixes.ts'
import { useModelTransport } from '../src/agent/models.ts'
import { pageRevisionToken } from '../src/pages/revision-token.ts'
import { id } from '../src/lib/ids.ts'
import { now } from '../src/lib/db.ts'
import { getStore, updateStore } from '../src/control/stores.ts'

const base = '<!doctype html><html lang="en"><head><style>:focus-visible{outline:2px solid}</style></head><body><a class="skip" href="#main">Skip</a><main id="main"><h1>Our product</h1><p>Existing facts.</p></main></body></html>'
function setup(){const {db,user}=fresh();const store=createBlankAsset(db,user.id,{name:'Speed store',kind:'funnel'});return {db,user,store}}

test('cloning a whole funnel copies linked steps and settings, with independent IDs and no traffic',()=>{
 const {db,store}=setup()
 const offer=createPage(db,store.id,{title:'Offer',role:'offer',blocks:[newBlock('button',{label:'Continue',href:'/pages/order-step'})]})
 const checkout=createPage(db,store.id,{title:'Order step',role:'checkout',mode:'html',rawHtml:'<a href="/pages/thanks#receipt">Continue</a>'})
 const thanks=createPage(db,store.id,{title:'Thanks',role:'thankyou'})
 const source=upsertFunnel(db,store.id,{name:'Original',offerPageId:offer.id,steps:[{pageId:offer.id,label:'Offer'},{pageId:checkout.id,label:'Checkout'},{pageId:thanks.id,label:'Thanks'}],upsell:{headline:'One more',discountPercent:20},bump:{priceCents:299,label:'Protect'},status:'active',testGroup:'main',weight:50})
 const result=duplicateWholeFunnel(db,store.id,source.id)
 assert.equal(result.pages.length,3);assert.equal(result.funnel.status,'paused');assert.equal(result.funnel.weight,0);assert.equal(result.funnel.testGroup,'')
 assert.deepEqual(result.funnel.upsell,source.upsell);assert.deepEqual(result.funnel.bump,source.bump)
 assert.notEqual(result.funnel.offerPageId,offer.id);assert.equal(getFunnel(db,store.id,source.id)?.status,'active')
 const copyOffer=getPage(db,store.id,result.funnel.offerPageId)!
 assert.notEqual(copyOffer.blocks[0]?.id,offer.blocks[0]?.id)
 assert.ok(JSON.stringify(copyOffer.blocks).includes('/pages/order-step-copy'))
 const copyCheckout=result.pages.find(page=>page.role==='checkout')!
 assert.match(getPage(db,store.id,copyCheckout.id)!.rawHtml,/thanks-copy#receipt/)
 assert.ok(result.pages.every(page=>page.status==='draft'))
 const owner=db.one<{id:string}>('SELECT id FROM users LIMIT 1')!
 const other=createBlankAsset(db,owner.id,{name:'Other',kind:'store'})
 // Cross-store reads must not resolve a source funnel.
 assert.throws(()=>duplicateWholeFunnel(db,other.id,source.id),/No such funnel/)
})

test('health audit understands wrapped/ARIA labels, named links and deferred scripts',()=>{
 const html=base.replace('</head>','<meta name="viewport" content="width=device-width"><script defer src="a.js"></script><script async src="b.js"></script><script type="module" src="c.js"></script><script type="application/ld+json">{"text":"[confirm] lorem ipsum <h1>fake</h1>"}</script></head>').replace('</main>','<label>Email<input type="email"></label><span id="label">Choice</span><input aria-labelledby="label"><a href="/" aria-label="Home"></a></main>')
 const report=auditHtml(html,{path:'/'})
 assert.equal(report.metrics.h1s,1);assert.equal(report.metrics.scripts,3)
 for(const name of ['input-label','link-name','scripts','unconfirmed','placeholder','skip-link','landmark'])assert.ok(!report.issues.some(issue=>issue.check===name),name)
 const placeholder=auditHtml(html.replace('<label>Email<input type="email"></label>','<input placeholder="Email">'),{path:'/'})
 assert.ok(placeholder.issues.some(issue=>issue.check==='input-label'))
 const ariaMain=auditHtml(html.replace('<main id="main">','<div role="main" id="content">').replace('</main>','</div>').replace('href="#main"','href="#content"'),{path:'/'})
 assert.ok(!ariaMain.issues.some(issue=>['skip-link','landmark'].includes(issue.check)))
 const blocking=auditHtml(html.replace(' defer',''),{path:'/'})
 assert.ok(blocking.issues.some(issue=>issue.check==='scripts'))
})

test('health audit uses the actual custom home and includes all saved pages',()=>{
 const {db,store}=setup()
 for(let index=0;index<12;index++)createPage(db,store.id,{title:'Page '+index,mode:'html',rawHtml:base})
 const home=createPage(db,store.id,{title:'Actual homepage',mode:'html',rawHtml:base.replace('<h1>Our product</h1>','')})
 updatePage(db,store.id,home.id,{isHome:true})
 const report=auditStore(db,store,{environment:'draft'})
 assert.equal(report.pages.length,14);assert.equal(report.pages[0]?.title,'Actual homepage')
 assert.ok(report.pages[0]?.issues.some(issue=>issue.check==='h1'))
 for(const page of report.pages)for(const issue of page.issues)assert.ok(FIX_SUGGESTIONS[issue.check],issue.check)
})

test('AI repairs are verified, undoable, conflict-safe and report failures honestly',async(t)=>{
 const prior={key:process.env.OPENAI_API_KEY,provider:process.env.AMBORAS_TEXT_PROVIDER,anthropic:process.env.ANTHROPIC_API_KEY}
 process.env.OPENAI_API_KEY='test-key';process.env.AMBORAS_TEXT_PROVIDER='openai';delete process.env.ANTHROPIC_API_KEY
 try{
  const {db,store,user}=setup();let page=createPage(db,store.id,{title:'Needs viewport',mode:'html',rawHtml:base})
  function job(){const fixId=id('fix');db.insert('health_fixes',{id:fixId,store_id:store.id,path:'/pages/'+page.handle,check_name:'viewport',status:'running',created_at:now(),updated_at:now()});return fixId}
  const answer=(find:string,replacement:string,onRequest?:()=>void)=>useModelTransport(async()=>{
    onRequest?.()
    return new Response(JSON.stringify({
      id:'resp_test',object:'response',status:'completed',
      output:[{type:'message',id:'msg_test',role:'assistant',status:'completed',content:[{
        type:'output_text',text:JSON.stringify({summary:'Added the mobile viewport.',edits:[{target:'rawHtml',find,replacement}]}),annotations:[]
      }]}]
    }),{headers:{'content-type':'application/json'}})
  })
  await t.test('applies a passing repair and restores the exact prior source',async()=>{
    answer('<head>','<head><meta name="viewport" content="width=device-width,initial-scale=1">');const fix=job();await runHealthFix(db,fix,user.id)
    assert.equal(healthFix(db,store.id,fix)?.status,'completed',String(healthFix(db,store.id,fix)?.message))
    assert.match(getPage(db,store.id,page.id)!.rawHtml,/name="viewport"/)
    undoHealthFix(db,store.id,fix);assert.equal(getPage(db,store.id,page.id)!.rawHtml,base)
  })
  await t.test('rejects an edit that does not actually fix the finding',async()=>{
    answer('Existing facts.','The same facts.');const fix=job();await runHealthFix(db,fix,user.id)
    assert.equal(healthFix(db,store.id,fix)?.status,'failed');assert.equal(getPage(db,store.id,page.id)!.rawHtml,base)
  })
  await t.test('never overwrites changes made while the model is running',async()=>{
    const later=base.replace('Existing facts.','Later edit.')
    answer('<head>','<head><meta name="viewport" content="width=device-width">',()=>{updatePage(db,store.id,page.id,{rawHtml:later})})
    const fix=job();await runHealthFix(db,fix,user.id);assert.equal(healthFix(db,store.id,fix)?.status,'failed');assert.equal(getPage(db,store.id,page.id)!.rawHtml,later)
    page=updatePage(db,store.id,page.id,{rawHtml:base})
  })
  await t.test('undo refuses to erase a subsequent merchant edit',async()=>{
    answer('<head>','<head><meta name="viewport" content="width=device-width">');const fix=job();await runHealthFix(db,fix,user.id)
    updatePage(db,store.id,page.id,{rawHtml:getPage(db,store.id,page.id)!.rawHtml+'<!--later-->'})
    assert.throws(()=>undoHealthFix(db,store.id,fix),/changed since/)
  })
  await t.test('restarts mark unfinished repairs as failed instead of replaying them',()=>{const fix=job();recoverHealthFixes(db);assert.equal(healthFix(db,store.id,fix)?.status,'failed')})
 }finally{useModelTransport(null);for(const [key,value] of [['OPENAI_API_KEY',prior.key],['AMBORAS_TEXT_PROVIDER',prior.provider],['ANTHROPIC_API_KEY',prior.anthropic]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value}}
})

test('editor revision tokens change with the source even in the same timestamp',()=>{const {db,store}=setup();const page=createPage(db,store.id,{title:'Page',rawHtml:base});assert.notEqual(pageRevisionToken(page),pageRevisionToken({...page,rawHtml:base+'a'}))})
