import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

type ResolveHost = (hostname: string, options: { all: true }) => Promise<Array<{ address: string }>>

export class PublicNetworkError extends Error {}

/** Public unicast destinations only; do not let copied markup reach local services. */
export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number)
    return a !== 0 && a !== 10 && a !== 127 && a < 224
      && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99))
      && !(a === 198 && (b === 18 || b === 19 || b === 51 && c === 100))
      && !(a === 203 && b === 0 && c === 113)
  }
  if (isIP(address) === 6) {
    // Exclude local, mapped/NAT64, multicast and transition ranges as well as
    // documentation/benchmark prefixes within otherwise global unicast space.
    const normalized = new URL(`http://[${address}]/`).hostname.slice(1, -1)
    const [first = 0, second = 0] = normalized.split(':').map(value => Number.parseInt(value || '0', 16))
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002
      && !(first === 0x2001 && (second < 0x200 || second === 0xdb8))
      && !(first === 0x3fff && second < 0x1000)
  }
  return false
}

export async function isPublicHost(host: string, resolve: ResolveHost = lookup): Promise<boolean> {
  const hostname = host.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
  if (hostname === 'localhost' || /\.(?:localhost|local|internal)$/.test(hostname)) return false
  try {
    const addresses = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname, { all: true })
    return addresses.length > 0 && addresses.every(({ address }) => isPublicAddress(address))
  } catch { return false }
}

export async function assertPublicNetworkUrl(raw: string, options: { signal?: AbortSignal; resolve?: ResolveHost } = {}): Promise<URL> {
  options.signal?.throwIfAborted()
  let url: URL
  try { url = new URL(raw) } catch { throw new PublicNetworkError('Invalid source asset URL') }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new PublicNetworkError('Source assets require public HTTP(S) URLs without embedded credentials')
  const allowed = await isPublicHost(url.hostname, options.resolve)
  options.signal?.throwIfAborted()
  if (!allowed) throw new PublicNetworkError(`Source asset host is private, reserved or unavailable: ${url.hostname}`)
  return url
}
