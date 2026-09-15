import { parse, type DefaultTreeAdapterMap } from 'parse5'

/** Prefer the site's header mark, never a product photo or payment-provider badge. */
export function logoFromClone(html: string): string {
  const candidates: Array<{ url: string; score: number }> = []
  function walk(node: DefaultTreeAdapterMap['node'], header = false, logo = false) {
    if (!('tagName' in node)) { if ('childNodes' in node) node.childNodes.forEach(child => walk(child, header, logo)); return }
    const attrs = Object.fromEntries(node.attrs.map(attr => [attr.name, attr.value]))
    const identity = `${attrs.class || ''} ${attrs.id || ''}`
    header ||= node.tagName === 'header' || attrs.role === 'banner'
    logo ||= /logo|brandmark|header__heading-link/i.test(identity)
    if (node.tagName === 'img' && (header || logo)) {
      const url = attrs.src || attrs['data-src'] || ''
      const details = `${identity} ${attrs.alt || ''} ${url}`
      if (/^(?:https?:\/\/|\/(?!\/))/i.test(url) && !/payment|visa|mastercard|paypal|trustpilot|badge|avatar/i.test(details)) {
        const score = (logo ? 10 : 0) + (header ? 5 : 0) + (/logo/i.test(details) ? 5 : 0) - (/secondary|mobile|white/i.test(identity) ? 2 : 0)
        if (score >= 10) candidates.push({ url, score })
      }
    }
    node.childNodes.forEach(child => walk(child, header, logo))
  }
  walk(parse(html))
  return candidates.sort((a, b) => b.score - a.score)[0]?.url || ''
}
