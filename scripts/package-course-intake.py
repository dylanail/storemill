"""Read an existing course_intake export; never alter it or infer lesson boundaries."""
import argparse, pathlib, json, hashlib, gzip, sqlite3, re, shutil
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');a=p.parse_args()
src=pathlib.Path(a.source);out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
def read(path):return json.loads(path.read_text())
def lines(path):return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]
def sha(data):return hashlib.sha256(data).hexdigest()
manifest=read(src/'manifest/manifest.json');records=lines(src/'manifest/recordings.jsonl')
ledger=sqlite3.connect('file:'+str(src/'intake.sqlite3')+'?mode=ro&immutable=1',uri=True)
expected={r[0]:r[1] for r in ledger.execute('select content_id,canonical_sha256 from transcripts')}
language=read(src/'main-extraction-pilot/language-audit/language-audit.json')
quarantine={x['content_id'] for x in language['affected_parts']}
by_content={}
for r in records:by_content.setdefault(r['content_id'],[]).append(r)
modules={m['module_id']:m for m in manifest['modules']};courses={c['course_id']:c for c in manifest['courses']}
index=[];validated=0;skipped=0;original_chunks=0
archive=out/'canonical';archive.mkdir(exist_ok=True)
def topics(title):
 title=title.lower();tags=[]
 for topic,pattern in {'pages':'landing|cro|page|checkout|content|messaging|theme|functionality','offers':'offer|promo|bundle|coupon','testing':'test|scale|analy|stat|feedback','creatives':'ads|creative|ugc|whitelist|hook','avatars':'avatar|customer|feedback','desires':'psychology|desire|awareness','sophistication':'awareness|angle|competitor|psychology','product':'product|research'}.items():
  if re.search(pattern,title):tags.append(topic)
 return tags
for cid,recs in sorted(by_content.items()):
 raw=(src/'transcripts'/cid/'canonical.json').read_bytes();digest=sha(raw)
 if expected.get(cid)!=digest:raise ValueError('Canonical ledger hash mismatch: '+cid)
 canon=json.loads(raw);validated+=1
 with gzip.GzipFile(filename='',mode='wb',fileobj=(archive/(cid+'.json.gz')).open('wb'),mtime=0) as f:f.write(raw)
 if cid in quarantine:continue
 segments={s['segment_id']:dict(s) for s in canon['segments']}
 for flag in canon.get('quality_flags',[]):
  if isinstance(flag,dict) and flag.get('segment_id') in segments:
   seg=segments[flag['segment_id']];seg['quality_flags']=list(seg.get('quality_flags',[]))+[flag['code']]
 for chunk in lines(src/'chunks'/cid/'chunks.jsonl'):
  original_chunks+=1
  if any(sid not in segments for sid in chunk['segment_ids']):raise ValueError('Missing canonical segment')
  for s in chunk['segments']:
   original=segments[s['segment_id']]
   if any(s[k]!=original[k] for k in ['text','start_ms','end_ms','source_part_id']):raise ValueError('Changed canonical segment')
  group=[];size=0
  def flush():
   global group,size
   if not group:return
   for r in recs:
    index.append({'id':chunk['chunk_id']+':'+group[0]['segment_id']+':'+r['recording_id'],'chunkId':chunk['chunk_id'],'contentId':cid,'courseId':r['course_id'],'moduleId':r['module_id'],'recordingId':r['recording_id'],'course':courses[r['course_id']]['title'],'module':modules[r['module_id']]['title'],'title':r['title'],'sourcePath':r['relative_path'],'transcriptVersion':canon['transcript_version'],'sha256':digest,'segmentIds':[s['segment_id'] for s in group],'startMs':group[0]['start_ms'],'endMs':group[-1]['end_ms'],'text':' '.join(s['text'].strip() for s in group),'qualityFlags':sorted({(f if isinstance(f,str) else f['code']) for s in group for f in segments[s['segment_id']].get('quality_flags',[])}),'topics':topics(modules[r['module_id']]['title']+' '+r['title']),'kind':'transcript'})
   group=[];size=0
  for s in chunk['segments']:
   flags=segments[s['segment_id']].get('quality_flags',[])
   if any((f if isinstance(f,str) else f['code'])=='suspicious_repetition' for f in flags):skipped+=1;flush();continue
   if size+len(s['text'])>1800:flush()
   group.append(s);size+=len(s['text'])+1
  flush()
# Only already source-reviewed pilot teaching is included as derived rules.
active=read(src/'main-extraction-pilot/ACTIVE_EXTRACTIONS.json')
reviewed=[]
for name,entry in active['extractions'].items():
 f=pathlib.Path(entry['json']);raw=f.read_bytes()
 if sha(raw)!=entry['sha256']:raise ValueError('Reviewed extraction hash mismatch')
 j=json.loads(raw);reviewed.append(j)
 r=next(r for r in records if r['recording_id']==j['recording_id'])
 for item in j['items']:
  evidence=item['evidence'];text=json.dumps({k:v for k,v in item.items() if k!='evidence'},ensure_ascii=False)
  index.append({'id':j['recording_id']+':'+item['item_id'],'courseId':r['course_id'],'moduleId':r['module_id'],'recordingId':r['recording_id'],'contentId':r['content_id'],'course':courses[r['course_id']]['title'],'module':modules[r['module_id']]['title'],'title':r['title']+' / '+item['label'],'sourcePath':r['relative_path'],'sha256':entry['sha256'],'segmentIds':[sid for e in evidence for sid in e['segment_ids']],'startMs':min((e['start_ms'] for e in evidence if e['start_ms'] is not None),default=None),'endMs':max((e['end_ms'] for e in evidence if e['end_ms'] is not None),default=None),'text':text,'qualityFlags':[],'topics':topics(modules[r['module_id']]['title']+' '+r['title']),'kind':'reviewed_teaching','evidence':evidence})
# Instructor attachment text remains distinct from transcript evidence and discussions.
attachment_count=0;attachment_deferred=[]
for attachment in lines(src/'manifest/attachments.jsonl'):
 aid=attachment['attachment_id'];matches=list((src/'attachments/structured').glob(aid+'.*.json'));parts=[];kind='attachment'
 if matches:
  structured=read(matches[0]);digest=sha(matches[0].read_bytes())
  if 'instructor_content' in structured:parts=[(None,structured['instructor_content'].get('text',''),structured.get('review_flags',[]))]
  elif 'pages' in structured:parts=[(p['page_number'],p['text'],p.get('quality_flags',[])) for p in structured['pages']]
  else:attachment_deferred.append(aid);continue
 else:
  f=pathlib.Path(attachment.get('extracted_text_path') or '')
  if not f.is_file():attachment_deferred.append(aid);continue
  raw=f.read_bytes();digest=sha(raw)
  if attachment.get('extracted_text_sha256') and attachment['extracted_text_sha256']!=digest:raise ValueError('Attachment hash mismatch')
  parts=[(None,raw.decode('utf8'),[])]
 found=False
 for page,text,flags in parts:
  if not text.strip():continue
  for i,offset in enumerate(range(0,len(text),1600)):
   found=True;index.append({'id':aid+':'+str(page)+':'+str(i),'courseId':attachment['course_id'],'moduleId':attachment['module_id'],'recordingIds':json.loads(attachment.get('recording_ids_json') or '[]'),'associationType':attachment['association_type'],'course':courses[attachment['course_id']]['title'],'module':modules.get(attachment['module_id'],{'title':'Course-level resource; module unresolved'})['title'],'title':attachment['title'],'sourcePath':attachment['relative_path'],'sha256':digest,'text':text[offset:offset+1600],'qualityFlags':[str(x) for x in flags],'topics':topics(modules.get(attachment['module_id'],{'title':'Course-level resource; module unresolved'})['title']+' '+attachment['title']),'kind':kind,'pageNumber':page})
 if found:attachment_count+=1
shutil.copyfile(src/'manifest/attachments.jsonl',out/'attachments.jsonl')
(out/'course-map.json').write_text(json.dumps({'courses':manifest['courses'],'modules':manifest['modules'],'recordings':records,'boundaries':{j['recording_id']:j['lesson_boundaries'] for j in reviewed}},ensure_ascii=False))
(out/'operating-model.json').write_text(json.dumps({'status':'source-reviewed-pilot-rules-plus-full-source-retrieval','method':'Research → core avatar → mechanism → offer → page → creatives → test → learn. Treat this sequence as the existing distilled operating model; use source citations and merchant facts to choose applicable steps.','reviewedPlaybooks':reviewed,'unreviewedSourceIsEvidenceNotVerifiedRules':True},ensure_ascii=False))
shutil.copyfile(src/'manifest/manifest.json',out/'source-manifest.json');shutil.copyfile(src/'manifest/recordings.jsonl',out/'recordings.jsonl')
(out/'reviewed-teaching.json').write_text(json.dumps(reviewed,ensure_ascii=False))
(out/'index.json').write_text(json.dumps(index,ensure_ascii=False,separators=(',',':')))
report={'schema':'storemill-course-bundle-v1','canonicalTranscripts':validated,'recordingLocations':len(records),'languageQuarantinedContentIds':sorted(quarantine),'originalChunksValidated':original_chunks,'retrievalPassages':len(index),'reviewedTeachingItems':sum(len(x['items']) for x in reviewed),'skippedRepeatedSegments':skipped,'attachmentTextSources':attachment_count,'deferredAttachmentIds':attachment_deferred,'indexSha256':sha((out/'index.json').read_bytes()),'lessonBoundaryPolicy':'Preserve source recording identity; transport chunks are not lessons. Only three reviewed pilot lesson boundaries exist.','unresolved':'Language-suspect recordings excluded; full visual/PDF review and full-corpus teaching extraction incomplete.'}
(out/'coverage.json').write_text(json.dumps(report,indent=2));print(json.dumps({k:v for k,v in report.items() if k!='languageQuarantinedContentIds'},indent=2))
