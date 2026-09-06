/* Gallery operations share page selection, serialization and undo. */
let galleryEngine,detectedGalleries=[];
const galleryViews=new WeakMap();
function galleryConfig(n){return galleryEngine.config(n.el)||{mode:'custom',productId:$('page-product').value||'',items:galleryEngine.read(n.el),settings:{arrows:true,thumbnails:true,loop:n.el.querySelector('[data-copy-gallery-loop="true"]')!==null}};}
function syncGalleryRuntime(){
  doc.querySelectorAll('script[data-pg-runtime]').forEach(script=>script.remove());
  if(!doc.querySelector('[data-pb-gallery]'))return;
  const script=doc.createElement('script');script.dataset.pgRuntime='';script.textContent=window.__PRODUCT_GALLERY_RUNTIME;doc.body.append(script);
}
function applyGallery(n,c){
  const meta=nodeMeta(n.id);
  if(!meta.galleryOriginal)meta.galleryOriginal={html:n.el.innerHTML,attributes:Object.fromEntries([...n.el.attributes].map(a=>[a.name,a.value]))};
  meta.type='Product gallery';
  if(c.mode==='product')meta.binding={productId:c.productId,field:'gallery'};else if(meta.binding?.field==='gallery')delete meta.binding;
  const index=Number(n.el.querySelector('[data-pg-thumb][aria-current="true"]')?.dataset.pgThumb||0),view=galleryEngine.render(n.el,c);view.select(index);galleryViews.set(n.el,view);syncGalleryRuntime();
}
function mountVisualGallery(n){
  const host=props.querySelector('[data-gallery-editor]');if(!host)return;
  host.closest('fieldset').prepend(host);
  const before=JSON.stringify(galleryConfig(n));
  window.__EDITOR_GALLERY.mount(host,{
    get:()=>galleryConfig(n),valid:()=>get(n.id)?.el===n.el&&!isLocked(get(n.id))&&JSON.stringify(galleryConfig(n))===before,
    apply:(c,label)=>operation(label,()=>applyGallery(n,c)),
    show:index=>{let view=galleryViews.get(n.el);if(!view){operation('enable editable gallery',()=>applyGallery(n,galleryConfig(n)));view=galleryViews.get(n.el);}view?.select(index);draw();},
    productUpdated:(id,items)=>{for(const root of detectedGalleries){const c=galleryEngine.config(root);if(root!==n.el&&c?.mode==='product'&&c.productId===id)galleryViews.set(root,galleryEngine.render(root,c,items));}},
    ...(nodeMeta(n.id).galleryOriginal?{restore:()=>operation('restore imported gallery',()=>{const original=nodeMeta(n.id).galleryOriginal,copiedStyles=[...n.el.querySelectorAll('style[data-pb-copy-styles]')].map(el=>el.cloneNode(true));n.el.innerHTML=original.html;copiedStyles.forEach(el=>n.el.append(el));[...n.el.attributes].forEach(a=>{if(a.name!==ID)n.el.removeAttribute(a.name);});Object.entries(original.attributes).forEach(([k,v])=>n.el.setAttribute(k,v));delete nodeMeta(n.id).galleryOriginal;delete nodeMeta(n.id).binding;syncGalleryRuntime();})}:{}),
  });
}
function attachGalleries(){
  galleryEngine=productGalleries(doc);detectedGalleries=galleryEngine.roots();
  for(const root of detectedGalleries){
    const c=galleryEngine.config(root);if(!c)continue;
    galleryViews.set(root,galleryEngine.render(root,c));
    if(c.mode==='product'&&c.productId){const signature=JSON.stringify(c);window.__EDITOR_GALLERY.product(c.productId).then(p=>{
      if(root.isConnected&&JSON.stringify(galleryEngine.config(root))===signature){galleryViews.set(root,galleryEngine.render(root,{...c,productRevision:p.mediaRevision},p.media||[]));analyze();if(current()?.el===root)renderInspector();}
    }).catch(()=>{});}
  }
}
