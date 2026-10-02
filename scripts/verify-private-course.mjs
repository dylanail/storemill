import assert from 'node:assert/strict';
import { privateCourseStatus,retrievePrivateCourse } from '../src/agent/private-course.ts';
const status=privateCourseStatus();assert.equal(status.canonicalTranscripts,204);assert.equal(status.quarantinedTranscripts,13);
const queries=[
 [['pages','testing'],'How To Test Landing Pages On Meta top performing DCT change URL','landing|meta'],
 [['creatives'],'creative roadmap concept angle format','creative|roadmap'],
 [['sophistication'],'market awareness problem aware solution aware','awareness'],
 [['pages','offers'],'strategizing offers landing page bundle discount','offer|landing'],
 [['pages'],'optimize messaging landing page copy','messaging|landing'],
 [['testing'],'statistical significance powered stat sig test sample','stat|test'],
 [['avatars'],'build core avatar desires customer research','avatar|research'],
 [['product'],'winning product research criteria','product|research'],
];
const results=[];
for(const [topics,query,expected] of queries){const found=retrievePrivateCourse(topics,query);assert.ok(found.length);assert.ok(found.reduce((n,p)=>n+p.text.length,0)<=7000);assert.ok(found.some(p=>new RegExp(expected,'i').test(p.title)));assert.ok(found.every(p=>p.sha256.length===64));results.push({query,sources:found.map(p=>({id:p.id,title:p.title,kind:p.kind,startMs:p.startMs,endMs:p.endMs,flags:p.qualityFlags}))});}
assert.deepEqual(retrievePrivateCourse(['unknown'],'x'),[]);assert.deepEqual(retrievePrivateCourse(['pages'],'landing',0),[]);
console.log(JSON.stringify({status,queries:results},null,2));
