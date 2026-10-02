import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { estimateCost, meteredFetch, usageFor } from '../src/agent/model-usage.ts'
import { defaultChoice, openaiDefault } from '../src/agent/models.ts'
test('cost buckets differ by provider and reasoning is included exactly once', () => {
 const usage={input:1000,cached:800,cacheWrite:100,output:200,reasoning:150};const rates={input:1,cached:.1,cacheWrite:2,output:10}
 assert.equal(estimateCost('openai',usage,rates),.00238)
 assert.equal(estimateCost('anthropic',usage,rates),.00328)
 assert.deepEqual(usageFor('openai',{input_tokens:1000,input_tokens_details:{cached_tokens:800,cache_write_tokens:100},output_tokens:200}),{input:1000,cached:800,cacheWrite:100,output:200,reasoning:0})
 assert.deepEqual(usageFor('anthropic',{input_tokens:100,cache_read_input_tokens:20,cache_creation_input_tokens:30,output_tokens:40}),{input:100,cached:20,cacheWrite:30,output:40,reasoning:0})
})
test('every HTTP attempt records incomplete and unknown failures without private payloads', async () => {
 const dir=mkdtempSync(join(tmpdir(),'model-ledger-'));const old=process.env.STOREMILL_MODEL_USAGE_FILE;process.env.STOREMILL_MODEL_USAGE_FILE=join(dir,'usage.jsonl')
 try {const f=meteredFetch('openai','gpt-5','pages',async()=>new Response(JSON.stringify({id:'response-test',model:'gpt-5-2025-08-07',status:'incomplete',incomplete_details:{reason:'max_output_tokens'},input:'SECRET COURSE',usage:{input_tokens:1000,input_tokens_details:{cached_tokens:800},output_tokens:200,output_tokens_details:{reasoning_tokens:200}}}),{headers:{'x-request-id':'req-test'}}));await f('https://example.test');const bad=meteredFetch('openai','unknown','pages',async()=>{throw new TypeError('secret payload')});await assert.rejects(bad('https://example.test'));const text=readFileSync(process.env.STOREMILL_MODEL_USAGE_FILE,'utf8');assert.doesNotMatch(text,/SECRET|secret payload/);const rows=text.trim().split('\n').map(line=>JSON.parse(line));assert.equal(rows[0].estimatedUsd,.00235);assert.equal(rows[0].incompleteReason,'max_output_tokens');assert.equal(rows[1].estimatedUsd,null);assert.equal(rows[1].costStatus,'unknown') }finally {if(old===undefined)delete process.env.STOREMILL_MODEL_USAGE_FILE;else process.env.STOREMILL_MODEL_USAGE_FILE=old;rmSync(dir,{recursive:true,force:true})}
})
test('documented model overrides take precedence while legacy settings remain supported',()=>{
 const keys=['STOREMILL_MODEL_PAGES','AMBORAS_MODEL_PAGES','STOREMILL_OPENAI_MODEL','AMBORAS_OPENAI_MODEL','OPENAI_API_KEY'];const old=keys.map(k=>process.env[k]);try{process.env.OPENAI_API_KEY='test';process.env.AMBORAS_MODEL_PAGES='openai:legacy';process.env.STOREMILL_MODEL_PAGES='openai:documented';process.env.AMBORAS_OPENAI_MODEL='legacy-default';process.env.STOREMILL_OPENAI_MODEL='documented-default';assert.equal(defaultChoice('pages')?.model,'documented');assert.equal(openaiDefault(),'documented-default');delete process.env.STOREMILL_MODEL_PAGES;assert.equal(defaultChoice('pages')?.model,'legacy')}finally{keys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i])}
})
