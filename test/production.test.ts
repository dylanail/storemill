import assert from 'node:assert/strict'
import test from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'

const key = 'test-only-production-secret-at-least-32-characters'
async function boot(secret: string | undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'storemill-production-'))
  const env = { ...process.env }
  for (const name of Object.keys(env)) if (/^(STOREMILL_|AMBORAS_|RAILWAY_|ANTHROPIC_|OPENAI_|GEMINI_|RESEND_|STRIPE_)/.test(name)) delete env[name]
  Object.assign(env, { NODE_ENV: 'production', PORT: '0', AMBORAS_DB: join(dir, 'test.db'), AMBORAS_LOG_LEVEL: 'error' })
  if (secret !== undefined) env.AMBORAS_SECRET = secret
  const entry = new URL('../src/main.ts', import.meta.url).href
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', `const {server}=await import(${JSON.stringify(entry)});await new Promise(r=>server.listening?r():server.once('listening',r));console.log('READY:'+server.address().port)`], { cwd: dir, env, stdio: ['ignore','pipe','pipe'] })
  let output = ''
  child.stdout.on('data', chunk => { output += chunk })
  child.stderr.on('data', chunk => { output += chunk })
  const ready = await new Promise<{port:number|null,code?:number|null}>((resolve,reject) => {
    const timer = setTimeout(()=>reject(new Error('Startup timed out: '+output)),15000)
    child.stdout.on('data',()=>{const m=/READY:(\d+)/.exec(output);if(m){clearTimeout(timer);resolve({port:Number(m[1])})}})
    child.on('exit',code=>{clearTimeout(timer);resolve({port:null,code})})
    child.on('error',reject)
  }).catch(async error=>{child.kill('SIGKILL');rmSync(dir,{recursive:true,force:true});throw error})
  return { ...ready, output:()=>output, close:async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r))}rmSync(dir,{recursive:true,force:true})} }
}
function get(port:number,path:string,headers:Record<string,string>={}) { return new Promise<{status:number,body:string}>((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path,headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode!,body}))});req.on('error',reject);req.end()}) }

for (const [name,secret] of [['missing', undefined], ['placeholder','change-me-to-a-long-random-string'], ['short','short']] as const) {
  test(`production rejects a ${name} master key before listening`,async()=>{
    const app=await boot(secret)
    try {assert.equal(app.port,null,'production must not serve with an unsafe key');assert.notEqual(app.code,0);assert.match(app.output(),/STOREMILL_SECRET|AMBORAS_SECRET/)} finally {await app.close()}
  })
}

test('production survives malformed cookies, URLs and hosts',async()=>{
  const app=await boot(key)
  try {
    assert.ok(app.port,app.output())
    for(const [path,headers,status] of [
      ['/healthz',{cookie:'broken=%E0%A4%A'},200],
      ['/admin/products/%E0%A4%A',{},400],
      ['/healthz',{host:'[invalid'},400],
    ] as const) {
      const response=await get(app.port,path,headers)
      assert.equal(response.status,status,`${path}: ${response.body}`)
      assert.equal((await get(app.port,'/healthz')).status,200,'the process remains healthy')
    }
  } finally {await app.close()}
})
