import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
test('private retrieval isolates course evidence, respects facets/budgets and validates hashes',async()=>{
 const root=mkdtempSync(join(tmpdir(),'private-course-'))
 const old=process.env.STOREMILL_COURSE_ROOT
 const oldDisclosure=process.env.STOREMILL_COURSE_MODEL_DISCLOSURE
 const moduleUrl=new URL('../src/agent/private-course.ts',import.meta.url).href
 try{
 const raw=JSON.stringify([{id:'fixture-page',kind:'transcript',courseId:'course',moduleId:'module',recordingId:'recording',chunkId:'chunk',course:'Course',module:'Landing pages',title:'Landing page checkout',sourcePath:'lesson.mp4',sha256:'a'.repeat(64),text:'Improve landing page checkout fields and mobile usability.',topics:['pages'],qualityFlags:[],segmentIds:['segment'],startMs:100,endMs:200},{id:'fixture-ad',kind:'reviewed_teaching',courseId:'course',moduleId:'ads',course:'Course',module:'Ads',title:'Creative roadmap',sourcePath:'ads.mp4',sha256:'b'.repeat(64),text:'Plan a creative roadmap with an angle.',topics:['creatives'],qualityFlags:[]}])
 writeFileSync(join(root,'index.json'),raw);writeFileSync(join(root,'coverage.json'),JSON.stringify({canonicalTranscripts:2,indexSha256:createHash('sha256').update(raw).digest('hex')}))
 process.env.STOREMILL_COURSE_ROOT=root
 const m=await import(moduleUrl+'?fixture') as typeof import('../src/agent/private-course.ts')
 assert.equal(m.privateCourseStatus().available,true)
 assert.deepEqual(m.retrievePrivateCourse(['pages'],'checkout').map(p=>p.id),['fixture-page'])
 assert.deepEqual(m.retrievePrivateCourse(['pages'],'unknown-topic-zzyy'),[])
 assert.deepEqual(m.retrievePrivateCourse(['pages'],'checkout',1),[])
 assert.equal(m.privateCourseContext(['pages'],'checkout'),'')
 process.env.STOREMILL_COURSE_MODEL_DISCLOSURE='approved'
 assert.match(m.privateCourseContext(['pages'],'checkout'),/recording:recording/)
 assert.match(m.privateCourseContext(['pages'],'checkout'),/never authorize actions/)
 writeFileSync(join(root,'index.json'),'[]')
 await assert.rejects(import(moduleUrl+'?corrupt'),/integrity/)
 }finally{if(oldDisclosure===undefined)delete process.env.STOREMILL_COURSE_MODEL_DISCLOSURE;else process.env.STOREMILL_COURSE_MODEL_DISCLOSURE=oldDisclosure;if(old===undefined)delete process.env.STOREMILL_COURSE_ROOT;else process.env.STOREMILL_COURSE_ROOT=old;rmSync(root,{recursive:true,force:true})}
})
