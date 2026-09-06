import type { Db } from '../lib/db.ts'
import { getPage, listPages, duplicatePage, updatePage, type Page } from './store.ts'
import { getFunnel, upsertFunnel } from '../domain/funnels.ts'

export function duplicateWholeFunnel(db: Db, storeId: string, funnelId: string) {
  const source = getFunnel(db, storeId, funnelId)
  if (!source) throw new Error('No such funnel')
  return db.tx(() => {
    const all = listPages(db, storeId)
    const ids = new Set([source.advertorialPageId, source.offerPageId, ...source.steps.map((step) => step.pageId)].filter(Boolean))
    // Include locally linked content and the shared checkout template.
    all.filter((page) => ['checkout','upsell','downsell','thankyou'].includes(page.role) && (!page.productId || page.productId === source.productId)).forEach((page) => ids.add(page.id))
    for (const pageId of ids) {
      const page = getPage(db, storeId, pageId)
      if (!page) throw new Error('A funnel step is missing; repair its page link before cloning')
      const paths = new Set(JSON.stringify([page.rawHtml, page.headHtml, page.blocks]).match(/\/pages\/[a-z0-9-]+/g) ?? [])
      all.filter((candidate) => paths.has(`/pages/${candidate.handle}`)).forEach((candidate) => ids.add(candidate.id))
    }
    const copies = new Map<string, Page>()
    for (const pageId of ids) copies.set(pageId, duplicatePage(db, storeId, pageId))
    const paths = all.filter((page) => copies.has(page.id)).map((page) => [`/pages/${page.handle}`, `/pages/${copies.get(page.id)!.handle}`] as const)
    for (const page of copies.values()) {
      const rewrite = (value: string) => value.replace(/\/pages\/[a-z0-9-]+/g, (path) => paths.find(([sourcePath]) => path === sourcePath)?.[1] ?? path)
      const updated=updatePage(db, storeId, page.id, { rawHtml: rewrite(page.rawHtml), headHtml: rewrite(page.headHtml), blocks: JSON.parse(rewrite(JSON.stringify(page.blocks))) })
      const original=[...copies].find(([,copy])=>copy.id===page.id)?.[0]
      if(original)copies.set(original,updated)
    }
    const funnel = upsertFunnel(db, storeId, {
      ...source, id: undefined, name: `${source.name} (copy)`, status: 'paused', testGroup: '', weight: 0,
      advertorialPageId: copies.get(source.advertorialPageId)?.id ?? '', offerPageId: copies.get(source.offerPageId)?.id ?? '',
      upsell:{...source.upsell,...(source.upsell.pageId?{pageId:copies.get(source.upsell.pageId)?.id||''}:{})},
      downsell:{...source.downsell,...(source.downsell.pageId?{pageId:copies.get(source.downsell.pageId)?.id||''}:{})},
      steps: [...copies].map(([originalId,page]) => {const step=source.steps.find(step=>step.pageId===originalId);return {...step,pageId:page.id,label:page.title,...(step?.offer?{offer:{...step.offer,pageId:page.id},nextPageId:copies.get(step.nextPageId||'')?.id||'',declinePageId:copies.get(step.declinePageId||'')?.id||''}:{})}}),
    })
    return { funnel, pages: [...copies.values()] }
  })
}
