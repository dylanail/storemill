import { now, type Db, type Row } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { ask } from './chat.ts'

export type AssistantRequest = {
  id: string
  storeId: string
  userId: string
  text: string
  page: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  runId: string | null
  error: string
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

function rowToRequest(row: Row): AssistantRequest {
  return {
    id: row.id as string, storeId: row.store_id as string, userId: row.user_id as string,
    text: row.text as string, page: row.page as string, status: row.status as AssistantRequest['status'],
    runId: (row.run_id as string | null) ?? null, error: row.error as string,
    createdAt: row.created_at as string, startedAt: (row.started_at as string | null) ?? null,
    completedAt: (row.completed_at as string | null) ?? null,
  }
}

export function enqueueAssistantRequest(db: Db, input: { storeId: string; userId: string; text: string; page?: string }): AssistantRequest {
  const requestId = id('aq')
  db.insert('assistant_queue', {
    id: requestId, store_id: input.storeId, user_id: input.userId, text: input.text,
    page: input.page ?? '', status: 'queued', run_id: null, error: '', created_at: now(),
    started_at: null, completed_at: null,
  })
  return rowToRequest(db.one('SELECT * FROM assistant_queue WHERE id = ?', requestId) as Row)
}

export function listAssistantQueue(db: Db, storeId: string, limit = 12): AssistantRequest[] {
  return db.all('SELECT * FROM assistant_queue WHERE store_id = ? ORDER BY created_at DESC LIMIT ?', storeId, limit).map(rowToRequest)
}

export function cancelAssistantRequest(db: Db, storeId: string, requestId: string): boolean {
  return Number(db.run(
    "UPDATE assistant_queue SET status = 'cancelled', completed_at = ? WHERE id = ? AND store_id = ? AND status = 'queued'",
    now(), requestId, storeId,
  ).changes) > 0
}

const draining = new Set<string>()

/** FIFO per store. Different stores can run concurrently, while a burst of
 * voice prompts for one store stays ordered and visible. */
export async function drainAssistantQueue(db: Db, storeId?: string): Promise<number> {
  const stores = storeId
    ? [{ id: storeId }]
    : db.all<{ id: string }>("SELECT DISTINCT store_id id FROM assistant_queue WHERE status = 'queued'")
  let completed = 0
  for (const store of stores) {
    if (draining.has(store.id)) continue
    draining.add(store.id)
    try {
      while (true) {
        const row = db.one<Row>("SELECT * FROM assistant_queue WHERE store_id = ? AND status = 'queued' ORDER BY created_at LIMIT 1", store.id)
        if (!row) break
        const request = rowToRequest(row)
        const claimed = db.run("UPDATE assistant_queue SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'", now(), request.id)
        if (!Number(claimed.changes)) continue
        try {
          const result = await ask(db, { storeId: request.storeId, userId: request.userId, text: request.text, ...(request.page ? { page: request.page } : {}) })
          db.update('assistant_queue', request.id, {
            status: result.failures.length ? 'failed' : 'completed', run_id: result.runId,
            error: result.failures[0] ?? '', completed_at: now(),
          })
        } catch (error) {
          db.update('assistant_queue', request.id, { status: 'failed', error: error instanceof Error ? error.message : String(error), completed_at: now() })
        }
        completed++
      }
    } finally {
      draining.delete(store.id)
    }
  }
  return completed
}

export function recoverAssistantQueue(db: Db): number {
  // A waiting request has not executed and can remain queued. An interrupted
  // running request may already have changed the store, so never replay it
  // blindly; surface a failure that the operator can inspect and retry.
  return Number(db.run(
    "UPDATE assistant_queue SET status = 'failed', error = 'Interrupted by a server restart; review any completed changes before retrying.', completed_at = ? WHERE status = 'running'",
    now(),
  ).changes)
}
