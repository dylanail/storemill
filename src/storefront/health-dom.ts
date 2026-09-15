import { parse } from 'parse5'
export type HtmlNode = { tagName?: string; value?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: HtmlNode[]; parentNode?: HtmlNode }
export const attribute = (node: HtmlNode, name: string) => node.attrs?.find(item => item.name === name)?.value
export function visibleText(node: HtmlNode): string {
  if (['script','style','template','noscript'].includes(node.tagName ?? '') || attribute(node, 'aria-hidden') === 'true') return ''
  return (node.value ?? '') + (node.childNodes ?? []).map(visibleText).join(' ')
}
export function inspectHtml(html: string) {
  const root = parse(html) as HtmlNode
  const nodes: HtmlNode[] = []
  function visit(node: HtmlNode) { if (node.tagName) nodes.push(node); if (!['script','style','template','noscript'].includes(node.tagName ?? '')) node.childNodes?.forEach(visit) }
  visit(root)
  const byId = new Map(nodes.filter(node => attribute(node,'id')).map(node => [attribute(node,'id'), node]))
  const contentName = (node: HtmlNode): string => visibleText(node).trim() || (node.childNodes ?? []).map(child => attribute(child, 'alt') ?? '').join('').trim()
  function name(node: HtmlNode): string {
    const labelled = attribute(node,'aria-labelledby')?.split(/\s+/).map(id => byId.get(id)).filter(Boolean).map(target => visibleText(target!)).join(' ').trim()
    if (labelled) return labelled
    if (attribute(node,'aria-label')?.trim()) return attribute(node,'aria-label')!.trim()
    const label = nodes.find(candidate => candidate.tagName === 'label' && attribute(candidate,'for') && attribute(candidate,'for') === attribute(node,'id'))
    if (label && visibleText(label).trim()) return visibleText(label).trim()
    let parent = node.parentNode
    while (parent) { if (parent.tagName === 'label' && visibleText(parent).trim()) return visibleText(parent).trim(); parent = parent.parentNode }
    return attribute(node,'title')?.trim() || (['button','a'].includes(node.tagName ?? '') ? contentName(node) : '')
  }
  return { root, nodes, name, text: visibleText(root) }
}
