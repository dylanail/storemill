import { promises as dns } from 'node:dns'
import { json, now, type Db } from '../lib/db.ts'
import { id, token } from '../lib/ids.ts'

/**
 * Domains, per store.
 *
 * A store's domain is connected one of two ways, and the page says which:
 *
 *   host     the registrar points the name at this platform (CNAME for a
 *            subdomain, A or ALIAS for the apex) and the platform serves the
 *            store on it. Verified by looking the records up.
 *   forward  the registrar's own URL forwarding sends the name to the store's
 *            public address. Nothing is served here; the registrar redirects.
 *            Verified by following the redirect.
 *
 * The instructions are written per registrar because that is where the
 * merchant is stuck: not "add a CNAME" but where the button is on Namecheap.
 * A check records what it actually found, so a failure says what to fix.
 */
export type DomainMode = 'host' | 'forward'

export type Registrar = {
  id: string
  name: string
  /** Where the DNS records live. */
  dnsPath: string[]
  /** Where URL forwarding lives, or empty when the registrar has none. */
  forwardPath: string[]
  /** Does the apex accept an ALIAS / flattened CNAME? */
  apexAlias: boolean
  note: string
}

export const REGISTRARS: Registrar[] = [
  {
    id: 'namecheap',
    name: 'Namecheap',
    dnsPath: ['Domain List', 'Manage (next to the domain)', 'Advanced DNS tab', 'Host Records → Add New Record'],
    forwardPath: ['Domain List', 'Manage', 'Domain tab', 'Redirect Domain → Add Redirect (source: @, destination: your store URL, Permanent 301)'],
    apexAlias: true,
    note: 'Nameservers must be "Namecheap BasicDNS" for Advanced DNS to apply. If the domain uses Cloudflare or another DNS host, edit the records there instead. Namecheap host records use the bare host: "www", not "www.yourbrand.com", and "@" for the apex.',
  },
  {
    id: 'godaddy',
    name: 'GoDaddy',
    dnsPath: ['My Products', 'Domains → DNS (next to the domain)', 'DNS Records → Add New Record'],
    forwardPath: ['My Products', 'Domains → DNS', 'Forwarding tab → Add Forwarding (Permanent 301, forward only)'],
    apexAlias: false,
    note: 'GoDaddy has no ALIAS record: the apex needs an A record, or forwarding to www. Its forwarding creates its own A records, so remove any conflicting A record for "@" first.',
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    dnsPath: ['Websites → the domain', 'DNS → Records', 'Add record'],
    forwardPath: ['Websites → the domain', 'Rules → Redirect Rules → Create rule (static redirect, 301)'],
    apexAlias: true,
    note: 'Turn the orange cloud off (DNS only) on the records that point here until the certificate is issued, then turn it back on if you want Cloudflare in front. Cloudflare flattens a CNAME at the apex automatically.',
  },
  {
    id: 'squarespace',
    name: 'Squarespace Domains (ex Google Domains)',
    dnsPath: ['Domains', 'the domain → DNS', 'Custom Records → Add Record'],
    forwardPath: ['Domains', 'the domain → Domain Forwarding → Add Forward (301)'],
    apexAlias: false,
    note: 'Google Domains moved here in 2023. There is no ALIAS record; the apex takes an A record or a forward to www.',
  },
  {
    id: 'porkbun',
    name: 'Porkbun',
    dnsPath: ['Domain Management', 'DNS (the icon under the domain)', 'Add record'],
    forwardPath: ['Domain Management', 'URL Forwarding (under the domain) → Add'],
    apexAlias: true,
    note: 'Porkbun supports ALIAS at the apex. Its default parking records for "@" and "www" must be deleted first.',
  },
  {
    id: 'other',
    name: 'Another registrar or DNS host',
    dnsPath: ['Open the DNS or zone editor for the domain', 'Add the records below'],
    forwardPath: ['Look for "URL forwarding", "redirect" or "web forwarding" under the domain'],
    apexAlias: false,
    note: 'Any DNS host works; only the names of the menus differ. If it offers an ALIAS or ANAME record for the apex, use that instead of an A record.',
  },
]

export function registrarById(registrarId: string): Registrar {
  return REGISTRARS.find((entry) => entry.id === registrarId) ?? (REGISTRARS[REGISTRARS.length - 1] as Registrar)
}

/** Where a hosted domain should point. */
export function edgeTarget(): { host: string; ip: string } {
  const root = process.env.AMBORAS_STOREFRONT_HOST ?? 'amboras.app'
  return { host: process.env.AMBORAS_EDGE_HOST ?? `edge.${root}`, ip: process.env.AMBORAS_EDGE_IP ?? '' }
}

export type DnsRecord = { type: 'CNAME' | 'A' | 'ALIAS' | 'TXT' | 'FORWARD'; name: string; value: string; why: string }

export type DomainRecord = {
  id: string
  hostname: string
  status: 'pending' | 'verified'
  ssl: 'pending' | 'issued'
  verificationToken: string
  mode: DomainMode
  registrar: string
  lastCheck: DomainCheck | null
  createdAt: string
}

export function isApex(hostname: string): boolean {
  return hostname.split('.').length === 2
}

/** The host field as registrars want it: "@" for the apex, "shop" for shop.brand.com. Two-label registered domains are assumed; a shop.brand.co.uk merchant edits it. */
export function hostLabel(hostname: string): string {
  return isApex(hostname) ? '@' : hostname.split('.').slice(0, -2).join('.')
}

/**
 * The records for this hostname at this registrar, in the words the registrar
 * uses. A hosted apex gets an ALIAS where the registrar has one, an A record
 * where an edge IP is configured, and otherwise a forward to www with the
 * www CNAME — which is what every "connect your domain" flow quietly does.
 */
export function dnsPlan(hostname: string, mode: DomainMode, registrarId: string, verification: string, publicUrl: string): { records: DnsRecord[]; steps: string[]; caveat: string } {
  const registrar = registrarById(registrarId)
  const edge = edgeTarget()
  const apex = isApex(hostname)
  const records: DnsRecord[] = []
  let caveat = ''
  if (mode === 'forward') {
    records.push({ type: 'FORWARD', name: hostLabel(hostname), value: publicUrl, why: 'The registrar redirects visitors to the store. Choose permanent (301) and "forward only", not masking.' })
    records.push({ type: 'TXT', name: `_storemill.${hostname}`, value: `storemill-verify=${verification}`, why: 'Optional here: proves you control the name. Forwarding is verified by following the redirect.' })
    return { records, steps: [...registrar.forwardPath, 'Save, then press Check below. Registrars take from a minute to an hour to start forwarding.'], caveat: 'Forwarding shows the store at its platform address, not at your domain. Use hosting to keep your domain in the address bar.' }
  }
  if (apex) {
    if (registrar.apexAlias) records.push({ type: 'ALIAS', name: '@', value: edge.host, why: 'Points the bare domain here. Some registrars call it ANAME or a flattened CNAME.' })
    else if (edge.ip) records.push({ type: 'A', name: '@', value: edge.ip, why: 'Points the bare domain at the platform edge.' })
    else {
      records.push({ type: 'FORWARD', name: '@', value: `https://www.${hostname}`, why: 'This registrar cannot alias the apex, so the bare domain forwards to www.' })
      caveat = `${registrar.name} cannot point a bare domain at a hostname. Connect www.${hostname} here and forward the apex to it, which is what Shopify and every other host tell you to do too.`
    }
    records.push({ type: 'CNAME', name: 'www', value: edge.host, why: 'So www works as well as the bare name.' })
  } else {
    records.push({ type: 'CNAME', name: hostLabel(hostname), value: edge.host, why: 'Points the subdomain here.' })
  }
  records.push({ type: 'TXT', name: `_storemill.${hostname}`, value: `storemill-verify=${verification}`, why: 'Proves you control the name before a certificate is issued for it.' })
  return { records, steps: [...registrar.dnsPath, 'Add each record below, save, then press Check. DNS usually settles in minutes; the TTL you set is the longest it can take.'], caveat }
}

/* ------------------------------------------------------------------- checks */

export type Resolver = {
  txt(name: string): Promise<string[]>
  cname(name: string): Promise<string[]>
  a(name: string): Promise<string[]>
  head(url: string): Promise<{ status: number; location: string }>
}

export const realResolver: Resolver = {
  txt: async (name) => (await dns.resolveTxt(name)).map((chunks) => chunks.join('')),
  cname: (name) => dns.resolveCname(name),
  a: (name) => dns.resolve4(name),
  head: async (url) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const response = await fetch(url, { method: 'HEAD', redirect: 'manual', signal: controller.signal })
      return { status: response.status, location: response.headers.get('location') ?? '' }
    } finally {
      clearTimeout(timer)
    }
  },
}

export type DomainCheck = {
  at: string
  verified: boolean
  mode: DomainMode
  txt: { ok: boolean; found: string[] }
  target: { ok: boolean; found: string[]; wanted: string }
  forward: { ok: boolean; status: number; location: string; wanted: string }
  reason: string
}

async function quiet<T>(work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch {
    return fallback
  }
}

/**
 * Looks the name up and records what it found. Hosting verifies when the TXT
 * matches and the name resolves to the edge (by CNAME, or by A when an edge IP
 * is configured). Forwarding verifies when a plain request to the name is
 * redirected to the store's public address; the TXT is not required for it.
 */
export async function checkDomain(db: Db, storeId: string, hostname: string, publicUrl: string, resolver: Resolver = realResolver): Promise<DomainCheck> {
  const row = db.one<{ id: string; verification_token: string; mode: DomainMode }>('SELECT id, verification_token, mode FROM domains WHERE store_id = ? AND hostname = ?', storeId, hostname)
  if (!row) throw new Error('That domain is not attached to this store')
  const edge = edgeTarget()
  const currentTxt = await quiet(() => resolver.txt(`_storemill.${hostname}`), [] as string[])
  const currentOk = currentTxt.some(entry => entry.trim() === `storemill-verify=${row.verification_token}`)
  // Previously verified domains continue working while owners update their DNS.
  const legacyTxt = currentOk ? [] : await quiet(() => resolver.txt(`_amboras.${hostname}`), [] as string[])
  const txtFound = [...currentTxt, ...legacyTxt]
  const txtOk = currentOk || legacyTxt.some(entry => entry.trim() === `amboras-verify=${row.verification_token}`)
  let check: DomainCheck
  if (row.mode === 'forward') {
    const head = await quiet(() => resolver.head(`http://${hostname}/`), { status: 0, location: '' })
    const wanted = publicUrl.replace(/\/$/, '')
    const forwardOk = head.status >= 300 && head.status < 400 && head.location.replace(/\/$/, '').startsWith(wanted)
    check = {
      at: now(),
      verified: forwardOk,
      mode: 'forward',
      txt: { ok: txtOk, found: txtFound },
      target: { ok: false, found: [], wanted: '' },
      forward: { ok: forwardOk, status: head.status, location: head.location, wanted },
      reason: forwardOk
        ? `The name redirects to ${head.location}.`
        : head.status === 0
          ? 'The name does not answer yet. The registrar may still be setting the forward up, or the domain still points at parking.'
          : head.status >= 300 && head.status < 400
            ? `The name redirects to ${head.location || '(no location)'}, not to ${wanted}.`
            : `The name answers ${head.status} instead of redirecting. Forwarding is not set, or something else is hosting it.`,
    }
  } else {
    const cnameFound = await quiet(() => resolver.cname(hostname), [] as string[])
    const aFound = cnameFound.length ? [] : await quiet(() => resolver.a(hostname), [] as string[])
    const cnameOk = cnameFound.some((entry) => entry.replace(/\.$/, '').toLowerCase() === edge.host.toLowerCase())
    const aOk = Boolean(edge.ip) && aFound.includes(edge.ip)
    const targetOk = cnameOk || aOk
    const reason = !txtOk
      ? `No TXT record at _storemill.${hostname} with the verification value${txtFound.length ? ` (found: ${txtFound.join(', ')})` : ''}.`
      : !targetOk
        ? `${hostname} points at ${[...cnameFound, ...aFound].join(', ') || 'nothing yet'}, not at ${edge.host}${edge.ip ? ` or ${edge.ip}` : ''}.`
        : `Verified: TXT matches and ${hostname} points at ${cnameOk ? edge.host : edge.ip}.`
    check = {
      at: now(),
      verified: txtOk && targetOk,
      mode: 'host',
      txt: { ok: txtOk, found: txtFound },
      target: { ok: targetOk, found: [...cnameFound, ...aFound], wanted: edge.host },
      forward: { ok: false, status: 0, location: '', wanted: '' },
      reason,
    }
  }
  db.update('domains', row.id, {
    last_check: check,
    // A hosted name that verifies is cleared for a certificate: the edge (Caddy
    // with on-demand TLS, see docs/DEPLOY.md) issues it on the first HTTPS visit.
    ...(check.verified ? { status: 'verified', ssl: row.mode === 'forward' ? 'pending' : 'issued' } : {}),
  })
  return check
}

export function attachDomain(db: Db, storeId: string, input: { hostname: string; mode?: DomainMode; registrar?: string }): DomainRecord {
  const clean = input.hostname.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) throw new Error('That does not look like a domain name')
  const existing = db.one<{ id: string; verification_token: string }>('SELECT id, verification_token FROM domains WHERE store_id = ? AND hostname = ?', storeId, clean)
  const verification = existing?.verification_token ?? token(12)
  if (existing) {
    db.update('domains', existing.id, { mode: input.mode ?? 'host', registrar: input.registrar ?? '', status: 'pending', ssl: 'pending', last_check: {} })
  } else {
    db.insert('domains', {
      id: id('dom'),
      store_id: storeId,
      hostname: clean,
      status: 'pending',
      verification_token: verification,
      ssl: 'pending',
      mode: input.mode ?? 'host',
      registrar: input.registrar ?? '',
      last_check: {},
      created_at: now(),
    })
  }
  return domainsFor(db, storeId).find((entry) => entry.hostname === clean) as DomainRecord
}

export function removeDomain(db: Db, storeId: string, hostname: string) {
  db.run('DELETE FROM domains WHERE store_id = ? AND hostname = ?', storeId, hostname)
}

/**
 * Whether the edge may issue a certificate for a hostname. Caddy's on-demand
 * TLS asks this before every first issuance, so a stranger pointing a name at
 * the server does not get a certificate minted for it: only the admin host,
 * the storefront root and its subdomains, and custom domains that verified
 * as hosted (www and apex count as one).
 */
export function tlsAllowed(db: Db, hostname: string, rootDomain: string): boolean {
  const clean = hostname.trim().toLowerCase()
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(clean)) return false
  const admin = (process.env.AMBORAS_ADMIN_HOST ?? '').toLowerCase()
  if (admin && clean === admin) return true
  if (rootDomain && (clean === rootDomain.toLowerCase() || clean.endsWith(`.${rootDomain.toLowerCase()}`))) return true
  const bare = clean.replace(/^www\./, '')
  return Boolean(db.one("SELECT id FROM domains WHERE hostname IN (?, ?, ?) AND status = 'verified' AND mode = 'host'", clean, bare, `www.${bare}`))
}

export function domainsFor(db: Db, storeId: string): DomainRecord[] {
  return db
    .all<{ id: string; hostname: string; status: string; ssl: string; verification_token: string; mode: string; registrar: string; last_check: string; created_at: string }>(
      'SELECT * FROM domains WHERE store_id = ? ORDER BY created_at',
      storeId,
    )
    .map((row) => ({
      id: row.id,
      hostname: row.hostname,
      status: row.status as DomainRecord['status'],
      ssl: row.ssl as DomainRecord['ssl'],
      verificationToken: row.verification_token,
      mode: (row.mode as DomainMode) || 'host',
      registrar: row.registrar ?? '',
      lastCheck: (() => {
        const parsed = json<DomainCheck | Record<string, never>>(row.last_check, {})
        return parsed && 'at' in parsed ? (parsed as DomainCheck) : null
      })(),
      createdAt: row.created_at,
    }))
}
