import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
test('canonical import preserves raw source, hierarchy and timestamps and refuses overwrite',()=>{
 const dir=mkdtempSync(join(tmpdir(),'course-import-'))
 try{
 const input=join(dir,'source.json'),raw=JSON.stringify({courseId:'evolve',title:'Fixture',modules:[{moduleId:'cro',lessons:[{lessonId:'checkout',title:'Checkout',transcript:'Address fields.\n\n'+ 'Proof is factual. '.repeat(500),timestamps:[{start:0,end:12}]}]}]})
 writeFileSync(input,raw)
 const args=['scripts/import-course.mjs',input,dir]
 assert.equal(spawnSync(process.execPath,args).status,0)
 assert.equal(readFileSync(join(dir,'evolve/raw.json'),'utf8'),raw)
 const chunks=JSON.parse(readFileSync(join(dir,'evolve/chunks.json'),'utf8'))
 assert.ok(chunks.length>1);assert.ok(chunks.every((c:any)=>c.moduleId==='cro'&&c.lessonId==='checkout'&&c.text.length<=3000&&c.timestamps[0].start===0))
 assert.notEqual(spawnSync(process.execPath,args).status,0)
 assert.equal(readFileSync(join(dir,'evolve/raw.json'),'utf8'),raw)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
