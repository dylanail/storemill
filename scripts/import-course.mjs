// Input JSON: {courseId,title,modules:[{moduleId,title,lessons:[{lessonId,title,transcript,timestamps?}]}]}
// Writes canonical raw source and deterministic chunks under a user-chosen local directory.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [input,out]=process.argv.slice(2);
if(!input||!out)throw new Error('Usage: node scripts/import-course.mjs course.json output-directory');
const raw=readFileSync(input,'utf8'),course=JSON.parse(raw),chunks=[];
const seen=new Set();
function id(value){if(typeof value!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(value))throw new Error('Supply stable safe Course/Module/Lesson IDs');return value;}
const courseId=id(course.courseId);
if(!Array.isArray(course.modules)||!course.modules.length)throw new Error('Modules required');
for(const module of course.modules){const moduleId=id(module.moduleId);
 for(const lesson of module.lessons??[]){const lessonId=id(lesson.lessonId),key=`${courseId}/${moduleId}/${lessonId}`;
  if(seen.has(key))throw new Error(`Duplicate lesson ${key}`);seen.add(key);
  if(typeof lesson.transcript!=='string'||!lesson.transcript.trim())throw new Error(`Transcript missing: ${key}`);
  const sha256=createHash('sha256').update(lesson.transcript).digest('hex');
  let text='',index=0;
  const flush=()=>{if(text){chunks.push({id:`${key}/${index++}`,courseId,moduleId,lessonId,title:lesson.title,sha256,text,timestamps:lesson.timestamps??null});text='';}};
  for(const paragraph of lesson.transcript.split(/\n\s*\n/)){for(let offset=0;offset<paragraph.length;offset+=2400){const piece=paragraph.slice(offset,offset+2400);if(text.length+piece.length+(text?2:0)>3000)flush();text+=(text?'\n\n':'')+piece;}}
  flush();
 }
}
if(!chunks.length)throw new Error('At least one lesson required');
const directory=join(resolve(out),courseId);
if(existsSync(directory))throw new Error('Course already exists; refusing to overwrite canonical source');
mkdirSync(directory,{recursive:true});
writeFileSync(join(directory,'raw.json'),raw);
writeFileSync(join(directory,'chunks.json'),JSON.stringify(chunks,null,2));
writeFileSync(join(directory,'manifest.json'),JSON.stringify({courseId,title:course.title,sourceSha256:createHash('sha256').update(raw).digest('hex'),lessons:seen.size,chunks:chunks.length},null,2));
console.log(JSON.stringify({directory,lessons:seen.size,chunks:chunks.length}));
