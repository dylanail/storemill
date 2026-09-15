import { createHash } from 'node:crypto'
import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { getProduct } from '../domain/catalog.ts'
import { pageForVersion, setVersionWeight, versionStats, versionsFor, type VersionStats } from '../pages/versions.ts'

export type ExperimentVariant = {
  pageId: string
  title: string
  format: string
  control: boolean
}

export type ExperimentResultVariant = ExperimentVariant & VersionStats & {
  posteriorConversion: number
  probabilityBest: number
  upliftVsControl: number
}

export type ExperimentResults = {
  autoPromote: boolean
  confidence: number
  minViews: number
  previousWeights: Record<string, number>
  evaluatedAt?: string
  ready?: boolean
  reason?: string
  winnerId?: string
  variants?: ExperimentResultVariant[]
}

export type Experiment = {
  id: string
  storeId: string
  name: string
  surface: string
  hypothesis: string
  variants: ExperimentVariant[]
  status: 'running' | 'paused' | 'ready' | 'promoted' | 'rolled_back'
  traffic: number
  results: ExperimentResults
  createdAt: string
  decidedAt: string | null
}

function rowToExperiment(row: Row): Experiment {
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    name: row.name as string,
    surface: row.surface as string,
    hypothesis: row.hypothesis as string,
    variants: json(row.variants, [] as ExperimentVariant[]),
    status: row.status as Experiment['status'],
    traffic: row.traffic as number,
    results: json(row.results, { autoPromote: true, confidence: 0.95, minViews: 75, previousWeights: {} }),
    createdAt: row.created_at as string,
    decidedAt: (row.decided_at as string | null) ?? null,
  }
}

export function listExperiments(db: Db, storeId: string): Experiment[] {
  return db.all('SELECT * FROM experiments WHERE store_id = ? ORDER BY created_at DESC', storeId).map(rowToExperiment)
}

export function getExperiment(db: Db, storeId: string, experimentId: string): Experiment | null {
  const row = db.one('SELECT * FROM experiments WHERE id = ? AND store_id = ?', experimentId, storeId)
  return row ? rowToExperiment(row) : null
}

export function startPdpExperiment(
  db: Db,
  storeId: string,
  input: { productId: string; pageIds: string[]; hypothesis?: string; autoPromote?: boolean; minViews?: number; confidence?: number },
): Experiment {
  const product = getProduct(db, storeId, input.productId)
  if (!product) throw new Error('No such product')
  const unique = [...new Set(input.pageIds)]
  const pages = unique.map((pageId) => pageForVersion(db, storeId, pageId)).filter((page) => page?.role === 'pdp' && page.productId === product.id)
  if (pages.length < 2) throw new Error('Choose at least two product-page versions for the test')
  const running = listExperiments(db, storeId).find((entry) => entry.surface === `pdp:${product.id}` && ['running', 'ready', 'paused'].includes(entry.status))
  if (running) throw new Error(`${product.title} already has an active experiment`)

  const previousWeights = Object.fromEntries(versionsFor(db, storeId, product.id).filter((page) => page.role === 'pdp').map((page) => [page.id, page.weight]))
  const weight = Math.max(1, Math.floor(100 / pages.length))
  const remainder = 100 - weight * pages.length
  const experimentId = id('exp')
  const variants = pages.map((page, index) => ({ pageId: page!.id, title: page!.title, format: page!.format, control: index === 0 }))
  db.tx(() => {
    for (const page of versionsFor(db, storeId, product.id).filter((entry) => entry.role === 'pdp')) setVersionWeight(db, storeId, page.id, 0)
    pages.forEach((page, index) => setVersionWeight(db, storeId, page!.id, weight + (index === 0 ? remainder : 0)))
    db.insert('experiments', {
      id: experimentId,
      store_id: storeId,
      name: `${product.title} page test`,
      surface: `pdp:${product.id}`,
      hypothesis: input.hypothesis?.trim() || 'A different page angle will produce more purchases per visitor.',
      variants,
      status: 'running',
      traffic: 100,
      results: {
        autoPromote: input.autoPromote ?? true,
        confidence: clamp(input.confidence ?? 0.95, 0.8, 0.999),
        minViews: Math.max(25, Math.round(input.minViews ?? 75)),
        previousWeights,
      } satisfies ExperimentResults,
      created_at: now(),
      decided_at: null,
    })
  })
  return getExperiment(db, storeId, experimentId) as Experiment
}

/**
 * Beta(1,1) priors keep small samples humble. A deterministic Monte Carlo
 * seed makes the dashboard stable: the probability changes only when evidence
 * changes, not on every refresh.
 */
export function analyzeExperiment(db: Db, storeId: string, experimentId: string): Experiment {
  const experiment = getExperiment(db, storeId, experimentId)
  if (!experiment) throw new Error('No such experiment')
  const productId = experiment.surface.startsWith('pdp:') ? experiment.surface.slice(4) : ''
  const allStats = new Map(versionStats(db, storeId, productId).map((entry) => [entry.pageId, entry]))
  const stats = experiment.variants.map((variant) => allStats.get(variant.pageId) ?? {
    pageId: variant.pageId,
    title: variant.title,
    format: variant.format,
    weight: 0,
    status: 'missing',
    views: 0,
    carts: 0,
    purchases: 0,
    revenueCents: 0,
    conversion: 0,
  })
  const probabilities = probabilityBest(stats, `${experiment.id}:${stats.map((entry) => `${entry.views}/${entry.purchases}`).join('|')}`)
  const control = stats[experiment.variants.findIndex((entry) => entry.control)] ?? stats[0]
  const controlPosterior = control ? (control.purchases + 1) / (control.views + 2) : 0
  const variants: ExperimentResultVariant[] = experiment.variants.map((variant, index) => {
    const stat = stats[index] as VersionStats
    const posterior = (stat.purchases + 1) / (stat.views + 2)
    return {
      ...variant,
      ...stat,
      posteriorConversion: posterior,
      probabilityBest: probabilities[index] ?? 0,
      upliftVsControl: controlPosterior ? posterior / controlPosterior - 1 : 0,
    }
  })
  const winner = [...variants].sort((a, b) => b.probabilityBest - a.probabilityBest)[0]
  const enoughViews = variants.every((variant) => variant.views >= experiment.results.minViews)
  const enoughPurchases = variants.reduce((sum, variant) => sum + variant.purchases, 0) >= Math.max(5, variants.length * 2)
  const confident = Boolean(winner && winner.probabilityBest >= experiment.results.confidence)
  const ready = enoughViews && enoughPurchases && confident
  const reason = !enoughViews
    ? `Waiting for ${experiment.results.minViews} views per version.`
    : !enoughPurchases
      ? 'Waiting for enough purchases to make the result dependable.'
      : !confident
        ? `No version has reached ${(experiment.results.confidence * 100).toFixed(0)}% probability of winning yet.`
        : `${winner?.title ?? 'The leader'} has enough evidence to promote.`
  const results: ExperimentResults = { ...experiment.results, evaluatedAt: now(), ready, reason, winnerId: ready ? winner?.pageId : undefined, variants }
  db.update('experiments', experiment.id, { results, status: ready ? 'ready' : experiment.status === 'ready' ? 'running' : experiment.status })
  const analyzed = getExperiment(db, storeId, experiment.id) as Experiment
  if (ready && results.autoPromote && experiment.status !== 'paused') return promoteExperiment(db, storeId, experiment.id)
  return analyzed
}

export function promoteExperiment(db: Db, storeId: string, experimentId: string): Experiment {
  const experiment = getExperiment(db, storeId, experimentId)
  if (!experiment) throw new Error('No such experiment')
  const winnerId = experiment.results.winnerId
  if (!winnerId || !experiment.variants.some((entry) => entry.pageId === winnerId)) throw new Error('There is no evidence-backed winner to promote yet')
  const productId = experiment.surface.slice(4)
  db.tx(() => {
    for (const page of versionsFor(db, storeId, productId).filter((entry) => entry.role === 'pdp')) setVersionWeight(db, storeId, page.id, page.id === winnerId ? 100 : 0)
    db.update('experiments', experiment.id, { status: 'promoted', decided_at: now() })
  })
  return getExperiment(db, storeId, experiment.id) as Experiment
}

export function pauseExperiment(db: Db, storeId: string, experimentId: string): Experiment {
  const experiment = getExperiment(db, storeId, experimentId)
  if (!experiment) throw new Error('No such experiment')
  if (experiment.status === 'promoted' || experiment.status === 'rolled_back') throw new Error('That experiment is already decided')
  db.update('experiments', experiment.id, { status: experiment.status === 'paused' ? 'running' : 'paused' })
  return getExperiment(db, storeId, experiment.id) as Experiment
}

export function rollbackExperiment(db: Db, storeId: string, experimentId: string): Experiment {
  const experiment = getExperiment(db, storeId, experimentId)
  if (!experiment) throw new Error('No such experiment')
  if (experiment.status !== 'promoted') throw new Error('Only a promoted experiment can be rolled back')
  const productId = experiment.surface.slice(4)
  db.tx(() => {
    for (const page of versionsFor(db, storeId, productId).filter((entry) => entry.role === 'pdp')) {
      setVersionWeight(db, storeId, page.id, experiment.results.previousWeights[page.id] ?? 0)
    }
    db.update('experiments', experiment.id, { status: 'rolled_back', decided_at: now() })
  })
  return getExperiment(db, storeId, experiment.id) as Experiment
}

export function evaluateRunningExperiments(db: Db): number {
  const rows = db.all<{ id: string; store_id: string }>("SELECT id, store_id FROM experiments WHERE status IN ('running','ready')")
  for (const row of rows) {
    try { analyzeExperiment(db, row.store_id, row.id) } catch { /* one malformed test must not stop the rest */ }
  }
  return rows.length
}

export function probabilityBest(stats: Array<Pick<VersionStats, 'views' | 'purchases'>>, seed: string, draws = 6000): number[] {
  if (!stats.length) return []
  const random = seededRandom(seed)
  const wins = stats.map(() => 0)
  for (let draw = 0; draw < draws; draw++) {
    let best = 0
    let bestValue = -1
    stats.forEach((entry, index) => {
      const value = sampleBeta(entry.purchases + 1, Math.max(0, entry.views - entry.purchases) + 1, random)
      if (value > bestValue) { best = index; bestValue = value }
    })
    wins[best] = (wins[best] ?? 0) + 1
  }
  return wins.map((count) => count / draws)
}

function sampleBeta(alpha: number, beta: number, random: () => number): number {
  const a = sampleGamma(alpha, random)
  const b = sampleGamma(beta, random)
  return a / (a + b)
}

function sampleGamma(shape: number, random: () => number): number {
  if (shape < 1) return sampleGamma(shape + 1, random) * Math.pow(Math.max(Number.EPSILON, random()), 1 / shape)
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (;;) {
    let x = 0
    let v = 0
    do {
      const u = Math.max(Number.EPSILON, random())
      const w = Math.max(Number.EPSILON, random())
      x = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w)
      v = 1 + c * x
    } while (v <= 0)
    v *= v * v
    const u = random()
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v
  }
}

function seededRandom(seed: string): () => number {
  let state = Number.parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 8), 16) || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
