import type { Db } from '../lib/db.ts'
import { saveMediaUpload, MAX_UPLOAD_BYTES } from '../lib/uploads.ts'
import { listStoreMedia, mediaKind, setMediaDetails } from './media.ts'
import { loadMedia, type RebrandSpec } from './media-render.ts'

/** Only documented options enter the persisted edit specification. */
export function mediaEditInput(body:Record<string,unknown>):Partial<RebrandSpec> {
  const keys=['brandName','logo','oldBrand','direction','method','provider','position','width','frame','intent','references','preserve','shape','audio'] as const
  return Object.fromEntries(keys.filter(key=>body[key]!==undefined).map(key=>[key,['width','frame'].includes(key)?Number(body[key]):body[key]])) as Partial<RebrandSpec>
}

/** Unsaved canvas uploads may be used without saving or publishing the page. */
export async function prepareEditorMedia(db:Db,storeId:string,source:string,kind:'image'|'video',signal:AbortSignal) {
  const found=listStoreMedia(db,storeId).find(item=>item.url===source)
  if(found){if(found.kind!==kind)throw new Error('Choose the original image or direct video file');return source}
  let file
  if(source.startsWith('data:')){
    const match=/^data:(image\/(?:png|jpeg|webp|gif|svg\+xml|avif));base64,([a-z0-9+/=\s]+)$/i.exec(source)
    if(!match||kind!=='image'||match[2]!.length>Math.ceil(MAX_UPLOAD_BYTES*4/3)+10)throw new Error('Upload a supported image up to 12MB')
    file={type:match[1]!,data:Buffer.from(match[2]!,'base64')}
  }else{
    if(mediaKind(source)==='embed')throw new Error('Upload the original video file to edit an embedded player')
    file=await loadMedia(source,storeId,kind,signal)
  }
  const saved=saveMediaUpload({...file,name:'Canvas '+kind},storeId)
  setMediaDetails(db,storeId,saved.url,'media','Canvas '+kind)
  return saved.url
}
