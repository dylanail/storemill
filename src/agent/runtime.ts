import { json, now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import { emitActivity } from './events.ts'
import { execute, ToolRefusal, type Artifact, type ToolArea, type ToolContext, type ToolResult } from './registry.ts'

const log = logger('agent')

export type PlannedStep = {
  tool: string
  args: Record<string, unknown>
  /** Steps in different branches may run at the same time. */
  branch?: string
  area?: ToolArea
}

export type RunStep = PlannedStep & {
  id: string
  position: number
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  result: (ToolResult & { error?: string }) | null
}

export type Run = {
  id: string
  storeId: string
  kind: 'chat' | 'onboarding' | 'automation'
  prompt: string
  /** `partial` is some steps done and some failed — it used to be filed as `completed`, green. */
  status: 'queued' | 'running' | 'paused' | 'completed' | 'partial' | 'failed' | 'cancelled'
  page: string
  sessionId: string | null
  cursor: number
  error: string
  createdAt: string
  updatedAt: string
  steps: RunStep[]
}

/** The steps table stores `{}` for "no result yet"; callers want null. */
function emptyToNull(value: Record<string, unknown>): RunStep['result'] {
  return Object.keys(value).length ? (value as RunStep['result']) : null
}

function rowToRun(db: Db, row: Row): Run {
  const steps = db.all('SELECT * FROM agent_steps WHERE run_id = ? ORDER BY position', row.id).map((step) => ({
    id: step.id as string,
    position: step.position as number,
    tool: step.tool as string,
    args: json(step.args, {} as Record<string, unknown>),
    branch: step.branch as string,
    area: (step.area as ToolArea) || undefined,
    status: step.status as RunStep['status'],
    result: emptyToNull(json(step.result, {} as Record<string, unknown>)),
  }))
  return {
    id: row.id as string,
    storeId: row.store_id as string,
    kind: row.kind as Run['kind'],
    prompt: row.prompt as string,
    status: row.status as Run['status'],
    page: row.page as string,
    sessionId: (row.session_id as string | null) ?? null,
    cursor: row.cursor as number,
    error: row.error as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    steps,
  }
}

export function getRun(db: Db, runId: string): Run | null {
  const row = db.one('SELECT * FROM agent_runs WHERE id = ?', runId)
  return row ? rowToRun(db, row) : null
}

export function listRuns(db: Db, storeId: string, limit = 20): Run[] {
  return db.all('SELECT * FROM agent_runs WHERE store_id = ? ORDER BY created_at DESC LIMIT ?', storeId, limit).map((row) => rowToRun(db, row))
}

export function createRun(
  db: Db,
  input: { storeId: string; kind?: Run['kind']; prompt: string; page?: string; sessionId?: string; steps: PlannedStep[] },
): Run {
  const runId = id('run')
  const timestamp = now()
  db.tx(() => {
    db.insert('agent_runs', {
      id: runId,
      store_id: input.storeId,
      kind: input.kind ?? 'chat',
      prompt: input.prompt,
      status: 'queued',
      page: input.page ?? '',
      session_id: input.sessionId ?? null,
      plan: input.steps,
      cursor: 0,
      error: '',
      created_at: timestamp,
      updated_at: timestamp,
    })
    input.steps.forEach((step, index) => {
      db.insert('agent_steps', {
        id: id('step'),
        run_id: runId,
        store_id: input.storeId,
        position: index,
        branch: step.branch ?? 'main',
        tool: step.tool,
        args: step.args,
        status: 'pending',
        result: {},
        area: step.area ?? '',
        started_at: null,
        ended_at: null,
      })
    })
  })
  return getRun(db, runId) as Run
}

export function appendSteps(db: Db, runId: string, steps: PlannedStep[]) {
  const run = getRun(db, runId)
  if (!run) throw new Error('No run')
  const base = run.steps.length
  steps.forEach((step, index) => {
    db.insert('agent_steps', {
      id: id('step'),
      run_id: runId,
      store_id: run.storeId,
      position: base + index,
      branch: step.branch ?? 'main',
      tool: step.tool,
      args: step.args,
      status: 'pending',
      result: {},
      area: step.area ?? '',
      started_at: null,
      ended_at: null,
    })
  })
}

export function cancelRun(db: Db, runId: string) {
  db.run("UPDATE agent_runs SET status = 'cancelled', updated_at = ? WHERE id = ? AND status IN ('queued','running','paused')", now(), runId)
  db.run("UPDATE agent_steps SET status = 'skipped' WHERE run_id = ? AND status = 'pending'", runId)
}

export function pauseRun(db: Db, runId: string) {
  db.run("UPDATE agent_runs SET status = 'paused', updated_at = ? WHERE id = ? AND status IN ('queued','running')", now(), runId)
}

export function resumeRun(db: Db, runId: string) {
  db.run("UPDATE agent_runs SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'paused'", now(), runId)
}

/**
 * Recovery on boot.
 *
 * A run that was mid-flight when the process died is not lost and is not
 * silently re-run from the start: completed steps stay completed, the one step
 * that was in flight goes back to pending, and the run re-queues. That is the
 * whole reason steps are rows rather than a closure — a deploy in the middle
 * of a merchant's onboarding has to be survivable.
 */
/**
 * Mark work a restart interrupted as ready to run again.
 *
 * Finished steps stay finished: runToCompletion skips every step already
 * marked done, so what comes back is what was in flight and what never
 * started. `resumeQueuedRuns` is what actually runs them.
 */
export function recoverRuns(db: Db): number {
  const stuck = db.all<{ id: string }>("SELECT id FROM agent_runs WHERE status IN ('running','queued')")
  for (const row of stuck) {
    db.run("UPDATE agent_steps SET status = 'pending', started_at = NULL WHERE run_id = ? AND status = 'running'", row.id)
    db.run("UPDATE agent_runs SET status = 'queued', updated_at = ? WHERE id = ?", now(), row.id)
  }
  if (stuck.length) log.info(`recovered ${stuck.length} interrupted run(s)`)
  return stuck.length
}

/**
 * Run the queue. Nothing else does.
 *
 * `recoverRuns` marks the interrupted work ready and this is what picks it
 * up; without it a queued run sat there forever, because the only other
 * callers of runToCompletion are `chat.ask` and `onboard`, both in the same
 * tick they create their run. Not awaited: the server has a port to bind, and
 * a run that fails on resume fails the way it would have in the request.
 */
export function resumeQueuedRuns(db: Db): number {
  const queued = db.all<{ id: string }>("SELECT id FROM agent_runs WHERE status = 'queued' ORDER BY created_at")
  for (const row of queued) {
    void runToCompletion(db, row.id, { actor: { type: 'agent', id: 'recovery' } })
      .then((outcome) => log.info(`resumed ${row.id}: ${outcome.run.status}${outcome.failures.length ? ` (${outcome.failures.length} failed)` : ''}`))
      .catch((error) => log.error(`could not resume ${row.id}: ${error instanceof Error ? error.message : String(error)}`))
  }
  if (queued.length) log.info(`resuming ${queued.length} queued run(s)`)
  return queued.length
}

export type RunOutcome = { run: Run; results: ToolResult[]; artifacts: Artifact[]; failures: string[] }

/**
 * Executes a run to completion.
 *
 * Steps are grouped by branch. Branches run concurrently — onboarding's naming,
 * catalog, brand and promotion work has no reason to be serial and the merchant
 * is watching — while steps inside one branch stay strictly ordered, because
 * "create the product" must finish before "photograph it".
 */
export async function runToCompletion(db: Db, runId: string, ctx: Omit<ToolContext, 'db' | 'storeId' | 'emit'>): Promise<RunOutcome> {
  const run = getRun(db, runId)
  if (!run) throw new Error('No run')
  if (run.status === 'cancelled' || run.status === 'completed') {
    return { run, results: [], artifacts: [], failures: [] }
  }
  db.run("UPDATE agent_runs SET status = 'running', updated_at = ? WHERE id = ?", now(), runId)
  emitActivity({ storeId: run.storeId, runId, at: now(), kind: 'run.started', summary: run.prompt })

  const branches = new Map<string, RunStep[]>()
  for (const step of run.steps) {
    if (step.status === 'done') continue
    const list = branches.get(step.branch ?? 'main') ?? []
    list.push(step)
    branches.set(step.branch ?? 'main', list)
  }

  const results: ToolResult[] = []
  const artifacts: Artifact[] = []
  const failures: string[] = []

  await Promise.all(
    [...branches.values()].map(async (steps) => {
      for (const step of steps) {
        const current = getRun(db, runId)
        if (!current || current.status === 'cancelled' || current.status === 'paused') return
        db.update('agent_steps', step.id, { status: 'running', started_at: now() })
        emitActivity({ storeId: run.storeId, runId, at: now(), kind: 'step.started', tool: step.tool, ...(step.area ? { area: step.area } : {}), status: 'running' })
        try {
          const result = await execute(step.tool, step.args, {
            ...ctx,
            db,
            storeId: run.storeId,
            emit: (event) => emitActivity({ storeId: run.storeId, runId, at: now(), kind: 'step.started', area: event.area, tool: event.tool, status: event.status, ...(event.summary ? { summary: event.summary } : {}) }),
          })
          db.update('agent_steps', step.id, { status: 'done', result, ended_at: now() })
          results.push(result)
          artifacts.push(...(result.artifacts ?? []))
          emitActivity({ storeId: run.storeId, runId, at: now(), kind: 'step.done', tool: step.tool, ...(step.area ? { area: step.area } : {}), status: 'done', summary: result.summary })
        } catch (error) {
          const message = error instanceof ToolRefusal ? `${error.message}${error.detail ? ` (${JSON.stringify(error.detail)})` : ''}` : error instanceof Error ? error.message : String(error)
          db.update('agent_steps', step.id, { status: 'failed', result: { summary: message, error: message }, ended_at: now() })
          failures.push(`${step.tool}: ${message}`)
          emitActivity({ storeId: run.storeId, runId, at: now(), kind: 'step.failed', tool: step.tool, ...(step.area ? { area: step.area } : {}), status: 'failed', summary: message })
          // One failed step does not abandon the branch's siblings: a store
          // whose logo failed to render still wants its products.
        }
      }
    }),
  )

  const final = getRun(db, runId) as Run
  // A run that produced one product and failed nine steps is not a success.
  // It used to be filed as 'completed' and rendered green, which is how an
  // onboarding that mostly failed looked like one that worked.
  const status =
    final.status === 'cancelled' || final.status === 'paused'
      ? final.status
      : failures.length
        ? results.length
          ? 'partial'
          : 'failed'
        : 'completed'
  db.run('UPDATE agent_runs SET status = ?, error = ?, cursor = ?, updated_at = ? WHERE id = ?', status, failures.join('; '), final.steps.length, now(), runId)
  emitActivity({
    storeId: run.storeId,
    runId,
    at: now(),
    kind: status === 'completed' ? 'run.finished' : 'run.failed',
    summary: results.map((result) => result.summary).join(' '),
  })
  return { run: getRun(db, runId) as Run, results, artifacts, failures }
}
