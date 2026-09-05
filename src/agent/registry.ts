import type { Db } from '../lib/db.ts'
import { check, toJsonSchema, type Schema } from '../lib/validate.ts'
import { recordAudit } from '../control/todos.ts'

export type ToolArea =
  | 'products'
  | 'organization'
  | 'promotions'
  | 'orders'
  | 'customers'
  | 'store'
  | 'emails'
  | 'content'
  | 'reviews'
  | 'analytics'
  | 'plugins'
  | 'setup'
  | 'seo'
  | 'ads'
  | 'domains'

export type Artifact =
  | { type: 'product'; id: string; title: string; image: string; href: string }
  | { type: 'image'; urls: string[]; caption: string }
  | { type: 'link'; href: string; label: string }
  | { type: 'table'; columns: string[]; rows: string[][]; caption?: string }
  | { type: 'note'; text: string }

export type ToolResult = { summary: string; data?: unknown; artifacts?: Artifact[] }

export type ToolContext = {
  db: Db
  storeId: string
  actor: { type: 'user' | 'agent'; id: string }
  page?: string
  emit?: (event: { area: ToolArea; tool: string; status: 'running' | 'done' | 'failed'; summary?: string }) => void
}

export type Tool = {
  name: string
  area: ToolArea
  description: string
  schema: Schema
  /** `confirm` marks tools that move money, delete data or reach outside the store. It is recorded in the audit row; it does not gate the call. */
  risk?: 'safe' | 'confirm'
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult> | ToolResult
}

const registry = new Map<string, Tool>()

export function defineTool(tool: Tool): Tool {
  if (registry.has(tool.name)) throw new Error(`Duplicate tool ${tool.name}`)
  registry.set(tool.name, tool)
  return tool
}

export function defineTools(tools: Tool[]): Tool[] {
  return tools.map(defineTool)
}

export function getTool(name: string): Tool | null {
  return registry.get(name) ?? null
}

export function listTools(area?: ToolArea): Tool[] {
  const all = [...registry.values()]
  return area ? all.filter((tool) => tool.area === area) : all
}

export function toolCountsByArea(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const tool of registry.values()) counts[tool.area] = (counts[tool.area] ?? 0) + 1
  return counts
}

/** The tool definitions handed to a model. */
export function toolDefinitions(names?: string[]) {
  return listTools()
    .filter((tool) => !names || names.includes(tool.name))
    .map((tool) => ({ name: tool.name, description: tool.description, input_schema: toJsonSchema(tool.schema) }))
}

export class ToolRefusal extends Error {
  readonly kind: 'unknown' | 'invalid'
  readonly detail: unknown
  constructor(kind: 'unknown' | 'invalid', message: string, detail?: unknown) {
    super(message)
    this.name = 'ToolRefusal'
    this.kind = kind
    this.detail = detail
  }
}

/**
 * The executor. Every tool call — from the chat panel, the onboarding
 * orchestrator, a plugin, or a model — goes through here and nowhere else.
 *
 * Arguments are validated against the tool's own schema before the handler
 * exists in the call stack, and the audit row is written whether the call
 * succeeded or not — the log is a record of what was attempted, not of what
 * worked. Tools execute; there is no per-turn permission gate. What keeps a
 * store safe is that the assistant only ever edits the draft environment and
 * that publishing is a separate, deliberate step with a rollback.
 */
export async function execute(name: string, rawArgs: unknown, ctx: ToolContext): Promise<ToolResult> {
  // A refusal is the most interesting thing in the log — a model reaching for
  // a tool that does not exist, or calling one with arguments it cannot
  // accept — and both used to throw before anything was written, which made
  // the log a record of what ran rather than what was attempted.
  const refuse = (kind: 'unknown' | 'invalid', message: string, detail?: unknown, area: ToolArea = 'setup') => {
    recordAudit(ctx.db, {
      storeId: ctx.storeId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: `${name} (refused)`,
      target: area,
      diff: { args: rawArgs, error: message, ...(detail ? { issues: detail } : {}) },
    })
    return new ToolRefusal(kind, message, detail)
  }
  const tool = getTool(name)
  if (!tool) throw refuse('unknown', `There is no tool called ${name}.`)

  const validated = check(tool.schema, rawArgs)
  if (!validated.ok) {
    throw refuse('invalid', `${name} was called with arguments it cannot accept.`, validated.issues, tool.area)
  }
  ctx.emit?.({ area: tool.area, tool: name, status: 'running' })
  try {
    const result = await tool.handler(validated.value, ctx)
    recordAudit(ctx.db, {
      storeId: ctx.storeId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: name,
      target: tool.area,
      diff: { args: validated.value, summary: result.summary, ...(tool.risk === 'confirm' ? { risk: 'confirm' } : {}) },
    })
    ctx.emit?.({ area: tool.area, tool: name, status: 'done', summary: result.summary })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    recordAudit(ctx.db, {
      storeId: ctx.storeId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.id,
      action: `${name} (failed)`,
      target: tool.area,
      diff: { args: validated.value, error: message },
    })
    ctx.emit?.({ area: tool.area, tool: name, status: 'failed', summary: message })
    throw error
  }
}
