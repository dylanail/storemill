import { readSourceCommerce, bindSourceProducts, type SourceProduct } from '../pages/source-commerce.ts'
import { createPromotion } from '../domain/promotions.ts'
import { getProduct } from '../domain/catalog.ts'
import { sourceThemeFromHtml, fontFacesFromHtml } from '../pages/source-theme.ts'
import type { Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { relocateUploads } from '../lib/uploads.ts'
import { clonePage, localizeImageUrls, type CloneResult, type ImageLocalizationReport } from '../pages/clone.ts'
import { mergeImageReports, saveCopyReport } from '../pages/clone-report.ts'
import { canonicalPageUrl, relatedSiteOrigin, copyUrlPriority, discoverPageLinks, inferCopiedPage, isCopyablePageUrl, isPaymentUrl, rewriteCopiedLinks, type CopyReport } from '../pages/site-copy.ts'
import { bindImportedOfferProduct, planImportedOfferProduct } from '../pages/imported-offers.ts'
import { installImportedBundle, planImportedBundle, repairImportedBundleHtml } from '../pages/imported-bundles.ts'
import { createPage, updatePage, type Page } from '../pages/store.ts'
import { seedDefaultRegion } from '../domain/regions.ts'
import { upsertFunnel } from '../domain/funnels.ts'
import { createFromImport, importProductFromUrl, type ImportedProduct } from '../domain/ops.ts'
import type { Brand, Product, Theme } from '../domain/types.ts'
import { seedTodos } from './todos.ts'
import { createStore, getStore, setTheme, updateStore, type Store } from './stores.ts'
import { setBuildMode, setSiteShape } from './build.ts'
import { addRedirect } from '../seo/schema.ts'
import { ensureCopiedCheckout } from '../pages/commerce-pages.ts'
import { installSourceCartShipping } from '../pages/imported-cart.ts'

export type AssetKind = Store['kind']
export type ImportProgress = { phase: 'pages'|'products'|'wiring'|'done'; percent: number; task: string; copied: number; discovered: number; products: number; images: number; currentUrl: string }

export function createBlankAsset(db: Db, ownerId: string, input: { name: string; kind: AssetKind; currency?: string }): Store {
  const name = input.name.trim()
  if (name.length < 2) throw new Error('Give the asset a name')
  const currency = (input.currency ?? 'USD').trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('Currency must be a three-letter code')
  const store = createStore(db, ownerId, { name, kind: input.kind, currency, prompt: input.kind === 'funnel' ? `A conversion funnel for ${name}` : `An online store for ${name}` })
  seedDefaultRegion(db, store.id, currency)
  seedTodos(db, store.id)
  setBuildMode(db, store.id, 'own-product')
  setSiteShape(db, store.id, { shape: input.kind })
  setTheme(db, store.id, input.kind === 'funnel' ? { nav: [], sections: [] } : {}, { build: `Created blank ${input.kind}` })
  return store
}

export async function importAssetFromUrl(
  db: Db,
  ownerId: string,
  input: { url: string; name?: string; kind: AssetKind; currency?: string; additionalUrls?: string[]; maxPages?: number; fetchImpl?: typeof fetch; signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void },
): Promise<{ store: Store; page: Page; pages: Page[]; products: Product[]; clone: CloneResult; report: CopyReport }> {
  stopIfAborted(input.signal)
  const url = input.url.trim()
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Paste a full URL starting with https://')
  let progress: ImportProgress = {phase:'pages',percent:1,task:'Opening the starting page',copied:0,discovered:1,products:0,images:0,currentUrl:url}
  const emit = (patch: Partial<ImportProgress>) => { progress={...progress,...patch,percent:Math.max(progress.percent,patch.percent??progress.percent)};input.onProgress?.({...progress}) }
  emit({})
  const pendingId = id('import')
  const localizedImages = new Map<string, string>()
  const cloneOptions = {
    storeId: pendingId,
    keepScripts: false,
    discoverSite: true,
    onProgress: (task: string) => emit({task,images:localizedImages.size}),
    localizedImages,
    stylesheetCache: new Map<string, string>(),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  }
  const additionalUrls = (input.additionalUrls ?? []).map((value) => value.trim()).filter(Boolean)
  if (additionalUrls.length > 100) throw new Error('Add up to 100 page links per copy')
  for (const value of additionalUrls) {
    if (!/^https?:\/\/[^\s]+$/i.test(value)) throw new Error(`Use a full https:// URL for each additional page: ${value}`)
  }
  const homeClone = await clonePage(url, cloneOptions)
  const documents: CloneResult[] = [homeClone]
  const report: CopyReport = { discovered: 1, copied: 1, complete: true, failed: [], remaining: [], externalSteps: [] }
  const maxPages = Number.isFinite(input.maxPages) ? Math.max(1, Math.min(1000, Math.floor(input.maxPages as number))) : 250
  const origins = new Set([new URL(homeClone.sourceUrl).origin, ...additionalUrls.filter((value) => !isPaymentUrl(value)).map((value) => new URL(value).origin)])
  const queued: string[] = []
  const nextSteps = new Set<string>(homeClone.nextStep ? [canonicalPageUrl(homeClone.nextStep)] : [])
  const seen = new Set([canonicalPageUrl(homeClone.sourceUrl)])
  const requested = new Set(seen)
  const aliases = new Map<string, string>([[canonicalPageUrl(url), canonicalPageUrl(homeClone.sourceUrl)]])
  const enqueue = (value: string, explicit = false) => {
    const canonical = canonicalPageUrl(value)
    if (requested.has(canonical)) return
    const candidate = new URL(canonical)
    const step = inferCopiedPage(canonical, '', input.kind === 'funnel').role
    if (relatedSiteOrigin(canonical, origins)) origins.add(candidate.origin)
    if (isPaymentUrl(canonical) || (!origins.has(candidate.origin) && ['checkout', 'upsell', 'downsell', 'thankyou'].includes(step))) {
      if (!report.externalSteps.includes(canonical)) report.externalSteps.push(canonical)
      return
    }
    if (!origins.has(candidate.origin) || !isCopyablePageUrl(canonical)) {
      if (explicit) report.failed.push({ url: canonical, reason: 'This is an action, payment-provider URL or unsupported document, not a readable page.' })
      return
    }
    requested.add(canonical)
    const fetchable = new URL(canonical)
    fetchable.pathname = new URL(value).pathname
    queued.push(fetchable.toString())
  }
  additionalUrls.forEach((value) => enqueue(value, true))
  for (const linked of homeClone.links ?? discoverPageLinks(homeClone.html, homeClone.sourceUrl)) enqueue(linked)
  emit({copied:1,discovered:requested.size,percent:8})
  while (queued.length && documents.length < maxPages) {
    queued.sort((a, b) => Number(nextSteps.has(canonicalPageUrl(b))) - Number(nextSteps.has(canonicalPageUrl(a))) || copyUrlPriority(a) - copyUrlPriority(b))
    const linked = queued.shift() as string
    if (seen.has(canonicalPageUrl(linked))) continue
    seen.add(canonicalPageUrl(linked))
    emit({currentUrl:linked,task:'Copying '+linked,percent:10+Math.floor(58*documents.length/(documents.length+queued.length+1)),copied:documents.length,discovered:requested.size,images:localizedImages.size})
    try {
      const document = await clonePage(linked, cloneOptions)
      const final = canonicalPageUrl(document.sourceUrl)
      if (!relatedSiteOrigin(final, origins) || isPaymentUrl(final)) {
        report.failed.push({ url: linked, reason: `Redirected outside the copied site to ${new URL(final).origin}.` })
        continue
      }
      origins.add(new URL(final).origin)
      aliases.set(canonicalPageUrl(linked), final)
      if (documents.some((entry) => canonicalPageUrl(entry.sourceUrl) === final)) continue
      seen.add(final)
      requested.add(final)
      documents.push(document)
      if(document.nextStep)nextSteps.add(canonicalPageUrl(document.nextStep))
      for (const discovered of document.links ?? discoverPageLinks(document.html, document.sourceUrl)) enqueue(discovered)
    } catch (error) {
      stopIfAborted(input.signal)
      report.failed.push({ url: linked, reason: error instanceof Error ? error.message : 'Could not read this page.' })
    }
  }
  report.copied = documents.length
  report.remaining = queued.filter((value) => !seen.has(canonicalPageUrl(value)))
  report.discovered = documents.length + report.failed.length + report.remaining.length
  report.complete = !report.failed.length && !report.remaining.length && !report.externalSteps.length
  for (const failure of report.failed) homeClone.notes.push(`Not copied: ${failure.url} — ${failure.reason}`)
  if (report.remaining.length) homeClone.notes.push(`${report.remaining.length} discovered pages remain after the ${maxPages}-page limit. Add their links in another copy or raise the limit.`)
  if (report.externalSteps.length) homeClone.notes.push(`${report.externalSteps.length} external checkout or funnel steps need review. Payment-provider sessions cannot be copied; connect the copied checkout to this store's Stripe account.`)
  homeClone.notes.push(`Copied ${documents.length} pages. Discovery follows readable links and declared next steps; add unlinked, protected or post-purchase step URLs explicitly.`)


  emit({phase:'products',percent:70,task:'Finding products, prices and offers across the copied site',copied:documents.length,discovered:report.discovered})
  const sourceData=new Map(documents.map(document=>[canonicalPageUrl(document.sourceUrl),readSourceCommerce(document.commerceHtml||document.html,document.sourceUrl,input.currency?.toUpperCase()||'USD')]))
  const roleFor=(document:CloneResult,index=0)=>{
    const type=sourceData.get(canonicalPageUrl(document.sourceUrl))?.stepType
    const roles:Record<number,Page['role']>={1:'checkout',2:'upsell',3:'thankyou',4:'downsell',7:'advertorial'}
    const role=type===undefined?undefined:roles[type]
    return role?{role,kind:(role==='checkout'?'checkout':role==='advertorial'?'advertorial':'custom') as Page['kind']}:inferCopiedPage(document.sourceUrl,document.html,input.kind==='funnel',index===0)
  }
  const commerce={products:0,linkedPages:0,bundles:0,bumps:0,upsells:0,downsells:0,issues:[] as Array<{url:string;reason:string}>}
  const candidates=new Map<string,SourceProduct>(),keysByPage=new Map<string,string[]>()
  const offerPlans=new Map(documents.map(document=>[canonicalPageUrl(document.sourceUrl),planImportedOfferProduct(document.html,document.sourceUrl,{currency:input.currency?.toUpperCase()||'USD'})]))
  const unresolved: Array<{url:string;reason:string}>=[]
  const productFetch=((request:string|URL|Request,init?:RequestInit)=>(input.fetchImpl??fetch)(request,{...init,...(input.signal?{signal:input.signal}:{})})) as typeof fetch
  for(const [index,document] of documents.entries()){
    const source=canonicalPageUrl(document.sourceUrl),data=sourceData.get(source)!,role=roleFor(document,index).role,offerPlan=offerPlans.get(source)
    emit({currentUrl:source,percent:70+Math.floor(12*index/documents.length),task:'Reading products and prices: '+document.title,products:candidates.size})
    commerce.issues.push(...data.issues.map(reason=>({url:source,reason})))
    let found=data.products
    // Shopify's catalog endpoint has complete variant/compare-at data; schema remains a fallback.
    if(data.platform!=='funnelish'&&!offerPlan&&isProductUrl(source)){
      try{const product=await importProductFromUrl(source,productFetch);if(!product.variants.length||product.variants.some(v=>!Number.isSafeInteger(v.priceCents)||v.priceCents<=0))throw Error('No explicit product price on this page');found=[{key:'product:'+source,product,purpose:'primary',sourceIds:[]}]}catch(error){stopIfAborted(input.signal);if(!found.length&&!offerPlan)unresolved.push({url:source,reason:error instanceof Error?error.message:'No explicit price'})}
    }
    if(!found.length&&offerPlan){found=[{key:'offer:'+source,product:offerPlan.product,purpose:'primary',sourceIds:[]}];document.notes.push(...offerPlan.notes)}
    for(const entry of found){
      if(entry.product.currency!==String(input.currency||'USD').toUpperCase()){commerce.issues.push({url:source,reason:`Source prices use ${entry.product.currency}; no automatic currency conversion was applied.`});continue}
      if(entry.purpose==='primary'&&['upsell','downsell'].includes(role))entry.product.metadata={...entry.product.metadata,hidden:'true',sourcePurpose:role}
      candidates.set(entry.key,candidates.get(entry.key)||entry)
      keysByPage.set(source,[...new Set([...(keysByPage.get(source)||[]),entry.key])])
    }
  }
  const importedProducts:ImportedProduct[]=[],productKeys:string[]=[],productImageReports:ImageLocalizationReport[]=[]
  for(const [key,entry] of candidates){
    const imported=entry.product
    const remoteMedia=[...new Set([...imported.images,...imported.variants.map(v=>v.image||'').filter(Boolean)])]
    emit({task:'Copying product media: '+imported.title,products:importedProducts.length,currentUrl:imported.source})
    const owned=await localizeImageUrls(remoteMedia,{storeId:pendingId,localizedImages,...(input.signal?{signal:input.signal}:{}),...(input.fetchImpl?{fetchImpl:input.fetchImpl}:{})},imported.source)
    productImageReports.push(owned.report)
    const media=new Map(remoteMedia.map((url,index)=>[url,owned.urls[index]||url]))
    importedProducts.push({...imported,images:imported.images.map(url=>media.get(url)||url),variants:imported.variants.map(v=>v.image?{...v,image:media.get(v.image)||v.image}:v)})
    productKeys.push(key)
  }
  stopIfAborted(input.signal)
  emit({phase:'wiring',percent:84,task:'Creating the owned catalog and wiring pages',products:importedProducts.length,images:localizedImages.size})
  const inferredName = homeClone.title.split(/\s+[|–—]\s+/)[0]?.trim() || new URL(homeClone.sourceUrl).hostname.replace(/^www\./, '')
  const store = createBlankAsset(db, ownerId, {
    name: input.name?.trim() || inferredName.slice(0, 80),
    kind: input.kind,
    currency: input.currency,
  })
  const clonedBrand = brandFromClone(homeClone.html)
  if (Object.keys(clonedBrand).length) updateStore(db, store.id, { brand: clonedBrand })
  relocateUploads(pendingId, store.id)
  const rehome = (value: string) => value.split(`/_uploads/${pendingId}/`).join(`/_uploads/${store.id}/`)
  const products = importedProducts.map((imported) => createFromImport(db, store.id, {
    ...imported,
    images: imported.images.map(rehome),
    variants: imported.variants.map((variant) => variant.image ? { ...variant, image: rehome(variant.image) } : variant),
  }, { asSupplier: false, status: 'draft' }))
  const productByKey=new Map(products.map((product,index)=>[productKeys[index]!,product]))
  const ownProduct=(source:string)=>{const entries=(keysByPage.get(source)||[]).map(key=>candidates.get(key)!).filter(entry=>entry.purpose==='primary');return entries.length===1?productByKey.get(entries[0]!.key):undefined}
  const productBySource=new Map<string,Product>()
  for(const [index,document] of documents.entries()){
    const source=canonicalPageUrl(document.sourceUrl),own=ownProduct(source)
    if(own){productBySource.set(source,own);continue}
    if (['upsell','downsell'].includes(roleFor(document,index).role)) { commerce.issues.push({url:source,reason:'This post-purchase page has no explicit priced offer; its commerce needs review.'}); continue }
    if(!['offer','pdp','advertorial','checkout'].includes(roleFor(document,index).role))continue
    const funnelId=sourceData.get(source)?.funnelId
    const checkout=funnelId?documents.find(other=>sourceData.get(canonicalPageUrl(other.sourceUrl))?.funnelId===funnelId&&roleFor(other).role==='checkout'&&ownProduct(canonicalPageUrl(other.sourceUrl))):undefined
    if(checkout){productBySource.set(source,ownProduct(canonicalPageUrl(checkout.sourceUrl))!);continue}
    // Follow actual page edges to the nearest priced offer; do not choose a random catalog product.
    let frontier=[source],visited=new Set<string>(),found:Product[]=[]
    for(let depth=0;depth<12&&frontier.length&&!found.length;depth++){
      const next:string[]=[]
      for(const current of frontier){if(visited.has(current))continue;visited.add(current);const doc=documents.find(d=>canonicalPageUrl(d.sourceUrl)===current);for(const link of doc?.links||[]){const canonical=aliases.get(canonicalPageUrl(link))||canonicalPageUrl(link);const product=ownProduct(canonical);if(product&&!product.metadata.hidden)found.push(product);else if(!visited.has(canonical))next.push(canonical)}}
      frontier=next
    }
    found=[...new Map(found.map(p=>[p.id,p])).values()]
    if(found.length===1)productBySource.set(source,found[0]!)
  }
  for(const failure of unresolved)if(!productBySource.has(failure.url))commerce.issues.push({url:failure.url,reason:failure.reason+'; no unambiguous priced next step was found.'})
  const variantBySource=new Map<string,{product:Product;variant:Product['variants'][number]}>()
  for(const product of products)for(const variant of product.variants){const source=product.metadata['sourceVariant:'+variant.id];if(source)variantBySource.set(source,{product,variant})}
  const shippingVariants=new Set<string>()
  for(const data of sourceData.values())for(const [source,gifts] of Object.entries(data.giftRules)){
    const paid=variantBySource.get(source);if(!paid)continue
    const included=gifts.map(id=>variantBySource.get(id)).filter((v):v is NonNullable<typeof v>=>!!v&&v.variant.priceCents===0)
    const shipping=included.filter(item=>/free shipping/i.test(item.product.title))
    if(shipping.length&&!shippingVariants.has(paid.variant.id)){shippingVariants.add(paid.variant.id);createPromotion(db,store.id,{title:paid.variant.title+' — free shipping',kind:'free_shipping',automatic:true,rules:{variantIds:[paid.variant.id]}})}
    const giftIds=included.filter(item=>!shipping.includes(item)).map(item=>item.variant.id)
    if(giftIds.length){const fresh=getProduct(db,store.id,paid.product.id)!;db.update('products',fresh.id,{metadata:{...fresh.metadata,['includedGifts:'+paid.variant.id]:JSON.stringify(giftIds)}})}
  }
  for (const [source, product] of productBySource) {
    try {
      const pathname = new URL(source).pathname
      if (isProductUrl(source) && pathname !== `/products/${product.handle}` && !/checkout|upsell|downsell/i.test(pathname)) addRedirect(db, store.id, pathname, `/products/${product.handle}`)
    } catch { /* malformed source URLs were already rejected earlier */ }
  }
  // A one-product store often links to a longer canonical Shopify handle than
  // the short discovery URL. Both are the same offer, so keep every cloned
  // product CTA working instead of sending the merchant to their new 404.
  if (products.length === 1) {
    for (const pathname of productPathsFromClone(homeClone.html, homeClone.sourceUrl)) {
      if (pathname !== `/products/${products[0]?.handle}`) addRedirect(db, store.id, pathname, `/products/${products[0]?.handle}`)
    }
  }
  const installedBundles=new Set<string>()
  for (const document of documents) if (installSourceCartShipping(db, store.id, document.commerceHtml || document.html)) break
  const pages = documents.map((document, index) => {
    emit({percent:86+Math.floor(10*index/documents.length),task:'Wiring page '+(index+1)+' of '+documents.length+': '+document.title,currentUrl:document.sourceUrl})
    const path = new URL(document.sourceUrl).pathname
    const product = productBySource.get(canonicalPageUrl(document.sourceUrl))
    const offerPlan = offerPlans.get(canonicalPageUrl(document.sourceUrl))
    let boundHtml = bindSourceProducts(offerPlan && product ? bindImportedOfferProduct(document.html, offerPlan, product) : document.html,products)
    try {
      const bundlePlan = planImportedBundle(document.html, document.sourceUrl, document.commerceHtml || document.html)
      if (bundlePlan) {
        const bundled=products.find(candidate=>candidate.variants.some(variant=>candidate.metadata['sourceVariant:'+variant.id]===bundlePlan.sourceVariantId))||product
        if (!bundled) throw new Error('No imported product matches this source bundle.')
        const installed = installImportedBundle(db, store.id, bundled.id, bundlePlan)
        installedBundles.add(installed.bundle.id)
        const repaired = repairImportedBundleHtml(boundHtml, bundlePlan, installed)
        if (!repaired.changed) throw new Error(repaired.reason || 'The copied bundle could not be placed in its source position.')
        boundHtml = repaired.html
        document.notes.push(...installed.notes)
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Bundle offers need review.'
      document.notes.push(reason)
      ;(report.interactionIssues ??= []).push({ url: document.sourceUrl, reason })
      report.complete = false
    }
    const created = createPage(db, store.id, {
      title: index === 0 ? input.kind === 'store' ? 'Imported home page' : 'Imported sales page' : document.title || path.split('/').filter(Boolean).at(-1) || 'Imported page',
      ...roleFor(document,index),
      mode: 'html',
      rawHtml: boundHtml.split(`/_uploads/${pendingId}/`).join(`/_uploads/${store.id}/`),
      seo: { title: document.title, description: document.description },
      status: 'draft',
      sourceUrl: document.sourceUrl,
      ...(product ? { productId: product.id, ...(roleFor(document,index).role==='pdp'?{handle:product.handle}:{}) } : {}),
    })
    saveCopyReport(db, store.id, created.id, { images: document.imageReport ? JSON.parse(rehome(JSON.stringify(document.imageReport))) : undefined, capture: document.captureReport, notes: document.notes })
    return index === 0 ? updatePage(db, store.id, created.id, { isHome: true }) : created
  })
  const page = pages[0] as Page
  const generatedCheckout = ensureCopiedCheckout(db, store.id)
  if (generatedCheckout) {
    pages.push(generatedCheckout)
    report.generatedPages = [{ id: generatedCheckout.id, role: 'checkout', reason: 'The source did not expose a readable checkout. Added an editable checkout using this asset’s branding and catalog.' }]
    homeClone.notes.push(report.generatedPages[0]!.reason)
  }
  const routes = pages.map((created, index) => ({
    source: documents[index]?.sourceUrl ?? new URL('/checkout', homeClone.sourceUrl).href,
    target: created.role === 'cart' ? '/cart' : created.role === 'checkout' ? (pages.find(p=>p.role==='checkout')?.id===created.id?'/checkout':`/pages/${created.handle}`) : index === 0 ? '/' : `/pages/${created.handle}`,
  }))
  for (const [alias, final] of aliases) {
    const target = routes.find((route) => canonicalPageUrl(route.source) === final)?.target
    if (target) routes.push({ source: alias, target })
  }
  const clonedNavigation: Theme['nav'] = input.kind === 'store' ? navigationFromClone(homeClone.html, homeClone.sourceUrl, routes) : []
  pages.forEach((created) => updatePage(db, store.id, created.id, { rawHtml: rewriteCopiedLinks(created.rawHtml, created.sourceUrl, routes) }))
  const primaryPages=pages.filter(p=>p.productId&&['checkout','offer','pdp'].includes(p.role)&&!products.find(product=>product.id===p.productId)?.metadata.hidden)
  const mainIds=[...new Set(primaryPages.map(p=>p.productId))]
  for(const productId of mainIds.length?mainIds:input.kind==='funnel'?['']:[]){
    const main=primaryPages.find(p=>p.productId===productId),sourceId=main?sourceData.get(canonicalPageUrl(main.sourceUrl))?.funnelId:undefined
    const related=pages.filter(p=>sourceId?sourceData.get(canonicalPageUrl(p.sourceUrl))?.funnelId===sourceId:p.productId===productId||!p.productId&&['checkout','thankyou'].includes(p.role)&&!sourceData.get(canonicalPageUrl(p.sourceUrl))?.funnelId)
    const bumpPages=related.filter(p=>p.role==='checkout'&&p.productId===productId)
    const bumpKey=(bumpPages.length?bumpPages:related).flatMap(p=>keysByPage.get(canonicalPageUrl(p.sourceUrl))||[]).find(key=>candidates.get(key)?.purpose==='bump')
    const bump=bumpKey?productByKey.get(bumpKey):undefined
    const offer=(role:'upsell'|'downsell')=>{const page=related.find(p=>p.role===role&&p.productId),product=page?products.find(product=>product.id===page.productId):undefined;const variant=product?.variants.find(v=>product.metadata['sourceVariant:'+v.id]===product.metadata.sourceDefaultVariant)||product?.variants[0];return variant?{enabled:true,variantId:variant.id,variantIds:product!.variants.map(v=>v.id),discountPercent:0,headline:page!.title,pageId:page!.id}:{enabled:false}}
    const upsell=offer('upsell'),downsell=offer('downsell')
    const steps=related.filter(p=>!['page','cart'].includes(p.role)).sort((a,b)=>(sourceData.get(canonicalPageUrl(a.sourceUrl))?.stepOrder||0)-(sourceData.get(canonicalPageUrl(b.sourceUrl))?.stepOrder||0)).map(p=>{
      const product=products.find(product=>product.id===p.productId),variant=product?.variants.find(v=>product.metadata['sourceVariant:'+v.id]===product.metadata.sourceDefaultVariant)||product?.variants[0]
      const document=documents.find(d=>canonicalPageUrl(d.sourceUrl)===canonicalPageUrl(p.sourceUrl))
      const next=pages.find(page=>document?.nextStep&&canonicalPageUrl(page.sourceUrl)===canonicalPageUrl(document.nextStep))
      return {pageId:p.id,label:p.title,role:p.role,...(['upsell','downsell'].includes(p.role)&&variant?{offer:{enabled:true,pageId:p.id,variantId:variant.id,variantIds:product!.variants.map(v=>v.id),discountPercent:0,headline:p.title},nextPageId:next?.id||'',declinePageId:next?.id||''}:{})}
    })
    upsertFunnel(db,store.id,{name:(products.find(p=>p.id===productId)?.title||store.name)+' funnel',productId,steps,offerPageId:related.find(p=>['offer','pdp'].includes(p.role)&&p.productId===productId)?.id||page.id,advertorialPageId:related.find(p=>p.role==='advertorial'&&p.productId===productId)?.id||'',bump:bump?.variants[0]?{enabled:true,variantId:bump.variants[0].id,priceCents:bump.variants[0].priceCents,label:bump.title}:{enabled:false},upsell,downsell,status:'active'})
    if(bump)commerce.bumps++;commerce.upsells+=steps.filter(s=>s.role==='upsell'&&s.offer).length;commerce.downsells+=steps.filter(s=>s.role==='downsell'&&s.offer).length
  }
  commerce.products=products.length;commerce.linkedPages=pages.filter(p=>p.productId).length;commerce.bundles=installedBundles.size;commerce.upsells=pages.filter(p=>p.role==='upsell'&&p.productId).length;commerce.downsells=pages.filter(p=>p.role==='downsell'&&p.productId).length
  if (input.kind === 'funnel' && !products.some(product => product.metadata.sourcePurpose !== 'gift' && product.metadata.sourcePurpose !== 'bump')) commerce.issues.push({url:homeClone.sourceUrl,reason:'No explicit purchasable price was found in the reachable pages. Add a protected or unlinked checkout URL to complete the catalog.'})
  report.commerce=commerce
  if(commerce.issues.length){report.complete=false;homeClone.notes.push(...commerce.issues.map(issue=>issue.url+': '+issue.reason))}
  report.images = mergeImageReports([...documents.map(document => document.imageReport), ...productImageReports])
  report.captureIssues = documents.flatMap(document => document.captureReport?.issues.map(reason => ({ url: document.sourceUrl, reason })) ?? [])
  // Test transports intentionally supply static fixtures; real copies must complete rendered capture too.
  if (!report.images.complete || (!input.fetchImpl && report.captureIssues.length)) report.complete = false
  const stylesheets = documents.reduce((sum, document) => sum + document.stylesheets, 0)
  const imagesLocalized = localizedImages.size
  db.update('stores', store.id, { reference_url: homeClone.sourceUrl })
  setTheme(db, store.id, clonedNavigation.length ? { nav: clonedNavigation } : {}, { build: `Cloned ${documents.length} pages and ${products.length} products from ${homeClone.sourceUrl}; ${stylesheets} stylesheets and ${imagesLocalized} images localized` })
  report.images=JSON.parse(rehome(JSON.stringify(report.images)))
  saveCopyReport(db,store.id,page.id,{images:report.images,capture:homeClone.captureReport,notes:[...new Set(documents.flatMap(document=>document.notes))],site:report,pages:pages.map(p=>({id:p.id,title:p.title,role:p.role,source:p.sourceUrl,productId:p.productId}))})
  emit({phase:'done',percent:100,task:report.complete?'Clone complete':'Clone complete — review the listed gaps',copied:pages.length,products:products.length,images:localizedImages.size})
  const freshPages = pages.map((created) => updatePage(db, store.id, created.id, {}))
  return {
    store: getStore(db, store.id) ?? { ...store, referenceUrl: homeClone.sourceUrl },
    page: freshPages[0] as Page,
    pages: freshPages,
    products,
    report,
    clone: { ...homeClone, report, imageReport: report.images, html: freshPages[0]?.rawHtml ?? homeClone.html, stylesheets, imagesLocalized, notes: [...new Set(documents.flatMap((document) => document.notes))] },
  }
}

function stopIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new DOMException('Clone cancelled', 'AbortError')
}

/**
 * Shopify themes expose their design system as CSS variables. Carry the
 * common palette and typography tokens into storemill so blocks extracted from
 * a clone immediately look like that site instead of the fallback theme.
 * Unknown themes simply return no values and keep the normal defaults.
 */
export function fontFamilyName(value: string): string | undefined {
  const clean = value.replace(/!important/gi, '').replace(/[;{}<>]/g, '').trim()
  if (!clean || /^(?:inherit|initial|unset|var\()/i.test(clean)) return undefined
  const first = clean.split(',')[0]?.trim().replace(/^["']|["']$/g, '').replace(/\+/g, ' ')
  if (!first || /^(?:serif|sans-serif|monospace|system-ui|ui-sans-serif|ui-serif|cursive|fantasy)$/i.test(first)) return undefined
  if (/^(?:-apple-system|blinkmacsystemfont|segoe ui|arial|helvetica|verdana|tahoma|trebuchet ms|times(?: new roman)?|georgia|courier(?: new)?|sfmono-regular|menlo|monaco)$/i.test(first)) return undefined
  if (/(?:font awesome|material (?:icons|symbols)|iconfont|glyphicons)/i.test(first)) return undefined
  return first.slice(0, 80)
}

/** Every real family declared by an imported document, without CSS fallback stacks. */
export function fontFamiliesFromClone(html: string): string[] {
  const found = new Set<string>()
  const add = (value: string) => { const family = fontFamilyName(value); if (family) found.add(family) }
  for (const match of html.matchAll(/(?:font-family|--[a-z0-9_-]*font[a-z0-9_-]*)\s*:\s*([^;}]+)/gi)) add(match[1] ?? '')
  for (const match of html.matchAll(/[?&]family=([^:&"'<>]+)/gi)) add(decodeURIComponent((match[1] ?? '').replace(/\+/g, ' ')))
  return [...found].slice(0, 32)
}

function selectorFont(html: string, wanted: RegExp): string | undefined {
  for (const match of html.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!wanted.test(match[1] ?? '')) continue
    const family = /font-family\s*:\s*([^;}]+)/i.exec(match[2] ?? '')?.[1]
    const parsed = family ? fontFamilyName(family) : undefined
    if (parsed) return parsed
  }
  return undefined
}

export function brandFromClone(html: string): Partial<Brand> {
  const captured=sourceThemeFromHtml(html)
  if(Object.keys(captured).length) return { ...captured, sourceTheme:captured, fonts:fontFamiliesFromClone(html), fontFaces:fontFacesFromHtml(html) } as Partial<Brand>
  const variable = (...names: string[]) => {
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const value = new RegExp(`--${escaped}\\s*:\\s*([^;}]+)`, 'i').exec(html)?.[1]?.trim()
      if (value) return value
    }
    return ''
  }
  const color = (value: string) => {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1]
    if (hex) return `#${hex.length === 3 ? [...hex].map((part) => part + part).join('') : hex}`.toLowerCase()
    const rgb = /^(?:rgb\()?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)?$/i.exec(value)
    if (!rgb) return undefined
    const channels = rgb.slice(1).map(Number)
    if (channels.some((channel) => channel < 0 || channel > 255)) return undefined
    return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
  }
  const primary = color(variable('color-base-accent-1', 'color-primary', 'primary', 'accent-color'))
  const secondary = color(variable('color-base-accent-2', 'color-secondary', 'secondary'))
  const paper = color(variable('color-base-background-1', 'color-background', 'background', 'paper'))
  const ink = color(variable('color-base-text', 'color-foreground', 'text-color', 'ink'))
  const declared = fontFamiliesFromClone(html)
  const displayFont = fontFamilyName(variable('font-heading-family', 'font-display-family', 'display-font'))
    ?? selectorFont(html, /(?:^|[\s,.>+~])(?:h1|h2|h3|\.heading|\.headline)(?:$|[\s,.#:[>+~])/i)
  const bodyFont = fontFamilyName(variable('font-body-family', 'body-font'))
    ?? selectorFont(html, /(?:^|[\s,>+~])body(?:$|[\s,.#:[>+~])/i)
  const fonts = [...new Set([displayFont, bodyFont, ...declared].filter((entry): entry is string => Boolean(entry)))]
  return { ...(primary ? { primary } : {}), ...(secondary ? { secondary } : {}), ...(paper ? { paper } : {}), ...(ink ? { ink } : {}), ...(displayFont ? { displayFont } : {}), ...(bodyFont ? { bodyFont } : {}), ...(fonts.length ? { fonts } : {}) }
}

/** Read the useful, same-site links from a cloned header into the global menu. */
export function navigationFromClone(html: string, sourceUrl: string, routes: Array<{ source: string; target: string }> = []): Theme['nav'] {
  let origin = ''
  try { origin = new URL(sourceUrl).origin } catch { return [] }
  const routeBySource = new Map(routes.filter((route) => route.source).map((route) => [canonicalPageUrl(route.source), route.target]))
  const regions = [...html.matchAll(/<(?:nav|header)\b[^>]*>[\s\S]*?<\/(?:nav|header)>/gi)].map((match) => match[0] as string)
  const source = regions.length ? regions.join('\n') : html
  const nav: Theme['nav'] = []
  const seen = new Set<string>()
  for (const match of source.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? ''
    const rawHref = /\bhref\s*=\s*["']([^"']*)/i.exec(attrs)?.[1]?.replace(/&amp;/gi, '&').trim() ?? ''
    const fallback = /\b(?:aria-label|title)\s*=\s*["']([^"']*)/i.exec(attrs)?.[1] ?? ''
    const label = clonedText(match[2] ?? '') || clonedText(fallback)
    if (!rawHref || !label || label.length > 60 || /^(?:cart|search|log ?in|account)$/i.test(label)) continue
    let url: URL
    try { url = new URL(rawHref, sourceUrl) } catch { continue }
    if (url.origin !== origin) continue
    const canonical = canonicalPageUrl(url.toString())
    let href = routeBySource.get(canonical)
    if (!href && url.pathname === '/') href = '/'
    if (!href && /^\/(?:products|collections|pages|blogs)(?:\/|$)/.test(url.pathname)) href = `${url.pathname}${url.search}${url.hash}`
    if (!href || seen.has(href)) continue
    seen.add(href)
    nav.push({ label: href === '/' ? 'Home' : label.slice(0, 60), href: href.slice(0, 240) })
    if (nav.length === 8) break
  }
  return nav
}

function clonedText(value: string): string {
  const named: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', trade: '™', reg: '®', copy: '©' }
  return value.replace(/<(?:style|script|svg)\b[\s\S]*?<\/(?:style|script|svg)>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] !== '#') return named[entity.toLowerCase()] ?? match
    const code = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10)
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
  }).replace(/\s+/g, ' ').trim()
}

export function productPathsFromClone(html: string, sourceUrl: string): string[] {
  let origin = ''
  try { origin = new URL(sourceUrl).origin } catch { return [] }
  const paths = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)/gi)) {
    try {
      const url = new URL((match[1] ?? '').replace(/&amp;/gi, '&'), sourceUrl)
      if (url.origin === origin && /^\/products\/[^/]+\/?$/i.test(url.pathname)) paths.add(url.pathname.replace(/\/$/, ''))
    } catch { /* malformed links do not belong in the redirect table */ }
  }
  return [...paths]
}

function isProductUrl(value: string): boolean {
  try { return /^\/products\/[^/]+\/?$/i.test(new URL(value).pathname) } catch { return false }
}
