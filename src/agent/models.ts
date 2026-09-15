import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { json, type Db } from '../lib/db.ts'
import { logger } from '../lib/log.ts'

const log = logger('models')

/**
 * The model router.
 *
 * Every piece of writing on the platform — research, the brand kit, product
 * pages, versions, ads, avatars, reading a competitor's page, and planning
 * what the assistant does — is authored by a model. Which model runs is a
 * choice per task: a default from the environment, overridable per store in
 * Settings. Two families are wired, Anthropic's Claude and OpenAI's GPT, and a
 * task can be pointed at either.
 *
 * With no key configured the callers fall back to their rules writers, which
 * exist so the platform boots, seeds and tests with nothing set. They are
 * scaffolding, not the product: the admin says plainly when it is looking at
 * rules output.
 */
export type Provider = 'anthropic' | 'openai'
export type Task = 'planner' | 'research' | 'brand' | 'pages' | 'ads' | 'extraction'
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ModelChoice = { provider: Provider; model: string }

export const TASKS: Array<{ id: Task; name: string; note: string; effort: Effort; maxTokens: number }> = [
  { id: 'planner', name: 'Assistant', note: 'Turns what you type in the panel into tool calls.', effort: 'medium', maxTokens: 4000 },
  { id: 'research', name: 'Customer research', note: 'Who buys, what stops them, competitors, the price anchor.', effort: 'high', maxTokens: 16000 },
  { id: 'brand', name: 'Brand and products', note: 'Naming, voice, and the product copy at onboarding.', effort: 'high', maxTokens: 16000 },
  { id: 'pages', name: 'Pages and versions', note: 'Product pages, PDP versions and advertorials.', effort: 'high', maxTokens: 16000 },
  { id: 'ads', name: 'Ads', note: 'Ad copy and video scripts per platform and format.', effort: 'high', maxTokens: 8000 },
  { id: 'extraction', name: 'Reading pages', note: 'Competitor pages and pasted ads read into records.', effort: 'medium', maxTokens: 8000 },
]

export function taskSpec(task: Task) {
  return TASKS.find((entry) => entry.id === task) ?? (TASKS[0] as (typeof TASKS)[number])
}

/* ------------------------------------------------------------- the catalog */

export type CatalogEntry = { provider: Provider; model: string; name: string; note: string; available: boolean }

/** The Anthropic model the platform reaches for unless told otherwise. */
export function anthropicDefault(): string {
  return process.env.AMBORAS_MODEL ?? 'claude-opus-5'
}

/** The OpenAI model; the id lives in configuration because it changes under us. */
export function openaiDefault(): string {
  return process.env.AMBORAS_OPENAI_MODEL ?? 'gpt-5'
}

export function keyFor(provider: Provider): string | undefined {
  return provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY
}

export function available(provider: Provider): boolean {
  return Boolean(keyFor(provider))
}

export function catalog(): CatalogEntry[] {
  const entries: Array<Omit<CatalogEntry, 'available'>> = [
    { provider: 'anthropic', model: 'claude-opus-5', name: 'Claude Opus 5', note: 'The default. The strongest all-rounder for research, pages and ads.' },
    { provider: 'anthropic', model: 'claude-fable-5-1', name: 'Claude Fable 5.1', note: 'The most capable Claude, for the hardest research; priced above Opus.' },
    { provider: 'anthropic', model: 'claude-sonnet-5', name: 'Claude Sonnet 5', note: 'Faster and cheaper; fine for the assistant and for reading pages.' },
    { provider: 'anthropic', model: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', note: 'Cheapest; reading pages only.' },
    { provider: 'openai', model: openaiDefault(), name: `OpenAI ${openaiDefault()}`, note: 'The newest GPT. Set STOREMILL_OPENAI_MODEL to move to a newer id.' },
  ]
  const anthropic = anthropicDefault()
  if (!entries.some((entry) => entry.model === anthropic)) {
    entries.unshift({ provider: 'anthropic', model: anthropic, name: `Claude ${anthropic}`, note: 'From STOREMILL_MODEL.' })
  }
  return entries.map((entry) => ({ ...entry, available: available(entry.provider) }))
}

export function parseChoice(value: string | undefined): ModelChoice | null {
  if (!value) return null
  const [provider, ...rest] = value.split(':')
  const model = rest.join(':')
  if ((provider === 'anthropic' || provider === 'openai') && model) return { provider, model }
  return null
}

export function choiceKey(choice: ModelChoice): string {
  return `${choice.provider}:${choice.model}`
}

export function describe(choice: ModelChoice | null): string {
  if (!choice) return 'rules (no model key configured)'
  return catalog().find((entry) => entry.provider === choice.provider && entry.model === choice.model)?.name ?? choice.model
}

/** The provider used when a task has no explicit choice: the configured one, else the first with a key. */
export function defaultProvider(): Provider | null {
  const wanted = process.env.AMBORAS_TEXT_PROVIDER as Provider | undefined
  if (wanted && (wanted === 'anthropic' || wanted === 'openai') && available(wanted)) return wanted
  return (['anthropic', 'openai'] as Provider[]).find(available) ?? null
}

export function defaultChoice(task: Task): ModelChoice | null {
  const fromEnv = parseChoice(process.env[`AMBORAS_MODEL_${task.toUpperCase()}`])
  if (fromEnv && available(fromEnv.provider)) return fromEnv
  const provider = defaultProvider()
  if (!provider) return null
  return { provider, model: provider === 'anthropic' ? anthropicDefault() : openaiDefault() }
}

export function storeModels(db: Db, storeId: string): Partial<Record<Task, string>> {
  const row = db.one<{ models: string }>('SELECT models FROM stores WHERE id = ?', storeId)
  return row ? json<Partial<Record<Task, string>>>(row.models, {}) : {}
}

/**
 * The model for a task on a store: the store's own choice when it is set and
 * its key is present, else the environment default. `null` means no model is
 * configured at all and the caller should use its rules writer.
 */
export function modelFor(db: Db | null, storeId: string | null, task: Task): ModelChoice | null {
  if (db && storeId) {
    const chosen = parseChoice(storeModels(db, storeId)[task])
    if (chosen && available(chosen.provider)) return chosen
  }
  return defaultChoice(task)
}

export function anyModel(): boolean {
  return defaultProvider() !== null
}

/* ------------------------------------------------------------- transport */

export type ModelTransport = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
let transport: ModelTransport | null = null
/** Tests swap the network out; nothing else should. */
export function useModelTransport(next: ModelTransport | null) {
  transport = next
}

export class ModelError extends Error {
  readonly choice: ModelChoice
  constructor(choice: ModelChoice, message: string) {
    super(`${choice.model}: ${message}`)
    this.name = 'ModelError'
    this.choice = choice
  }
}

const TIMEOUT_MS = 10 * 60 * 1000

function anthropicClient(apiKey: string): Anthropic {
  return new Anthropic({ apiKey, maxRetries: 2, timeout: TIMEOUT_MS, ...(transport ? { fetch: transport } : {}) })
}

function openaiClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, maxRetries: 2, timeout: TIMEOUT_MS, ...(transport ? { fetch: transport } : {}) })
}

/* ------------------------------------------------------------- completion */

export type JsonSchema = Record<string, unknown>

export type CompletionRequest = {
  task: Task
  system: string
  prompt: string
  /** When set, the reply is constrained to this schema and parsed. */
  schema?: JsonSchema
  /** A short name for the schema; OpenAI requires one. */
  name?: string
  effort?: Effort
  maxTokens?: number
}

/**
 * One request, one reply. Structured output when a schema is given: the API
 * constrains the reply to it, so the parse here is a formality rather than
 * a hunt for braces. Thinking is left at the model's default (adaptive on the
 * current families) and steered with effort per task.
 */
export async function complete(choice: ModelChoice, request: CompletionRequest): Promise<string> {
  const apiKey = keyFor(choice.provider)
  if (!apiKey) throw new ModelError(choice, `no key for ${choice.provider}`)
  const spec = taskSpec(request.task)
  const effort = request.effort ?? spec.effort
  const maxTokens = request.maxTokens ?? spec.maxTokens
  const started = Date.now()
  let text: string
  if (choice.provider === 'anthropic') {
    const response = await anthropicClient(apiKey).beta.messages.create({
      model: choice.model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: request.system,
      messages: [{ role: 'user', content: request.prompt }],
      output_config: { effort, ...(request.schema ? { format: { type: 'json_schema', schema: request.schema } } : {}) },
    })
    if (response.stop_reason === 'refusal') {
      throw new ModelError(choice, `declined the request${response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : ''}`)
    }
    text = response.content
      .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
  } else {
    const response = await openaiClient(apiKey).responses.create({
      model: choice.model,
      instructions: request.system,
      input: request.prompt,
      reasoning: { effort },
      max_output_tokens: maxTokens,
      ...(request.schema ? { text: { format: { type: 'json_schema', name: request.name ?? 'reply', schema: request.schema, strict: true } } } : {}),
    })
    text = response.output_text || outputText(response)
  }
  log.debug(`${choice.model} ${request.task}: ${text.length} chars in ${Date.now() - started}ms`)
  if (!text.trim()) throw new ModelError(choice, 'returned nothing')
  return text
}

function outputText(response: OpenAI.Responses.Response): string {
  const parts: string[] = []
  for (const item of response.output) {
    if (item.type !== 'message') continue
    for (const content of item.content) if (content.type === 'output_text') parts.push(content.text)
  }
  return parts.join('')
}

/** `complete`, parsed. The schema is enforced server-side; a parse failure is a real error, not a retry loop. */
export async function completeJson<T>(choice: ModelChoice, request: CompletionRequest & { schema: JsonSchema }): Promise<T> {
  const text = await complete(choice, request)
  try {
    return JSON.parse(text) as T
  } catch {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1)) as T
    throw new ModelError(choice, 'did not return JSON')
  }
}

/* ---------------------------------------------------------------- planning */

export type ToolDefinition = { name: string; description: string; input_schema: JsonSchema }
export type Turn = { role: 'user' | 'assistant'; content: string }
export type PlanReply = { text: string; calls: Array<{ name: string; args: Record<string, unknown> }> }

/**
 * A planning turn: the model sees the store, the recent conversation and the
 * real tool schemas, and answers with tool calls, words, or both. The calls
 * are handed to the runtime as steps; the words become the reply.
 */
export async function planWithTools(choice: ModelChoice, request: { system: string; history: Turn[]; prompt: string; tools: ToolDefinition[]; maxTokens?: number }): Promise<PlanReply> {
  const apiKey = keyFor(choice.provider)
  if (!apiKey) throw new ModelError(choice, `no key for ${choice.provider}`)
  const history = trimHistory(request.history)
  const maxTokens = request.maxTokens ?? taskSpec('planner').maxTokens
  if (choice.provider === 'anthropic') {
    const response = await anthropicClient(apiKey).beta.messages.create({
      model: choice.model,
      max_tokens: maxTokens,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: request.system,
      tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema as Anthropic.Beta.BetaTool['input_schema'] })),
      messages: [...history.map((turn) => ({ role: turn.role, content: turn.content })), { role: 'user', content: request.prompt }],
      output_config: { effort: taskSpec('planner').effort },
    })
    if (response.stop_reason === 'refusal') throw new ModelError(choice, 'declined the request')
    const calls: PlanReply['calls'] = []
    const text: string[] = []
    for (const block of response.content) {
      if (block.type === 'tool_use') calls.push({ name: block.name, args: (block.input ?? {}) as Record<string, unknown> })
      else if (block.type === 'text') text.push(block.text)
    }
    return { text: text.join(' ').trim(), calls }
  }
  const response = await openaiClient(apiKey).responses.create({
    model: choice.model,
    instructions: request.system,
    input: [...history.map((turn) => ({ role: turn.role, content: turn.content })), { role: 'user', content: request.prompt }],
    reasoning: { effort: taskSpec('planner').effort },
    max_output_tokens: maxTokens,
    tools: request.tools.map((tool) => ({ type: 'function' as const, name: tool.name, description: tool.description, parameters: tool.input_schema, strict: false })),
  })
  const calls: PlanReply['calls'] = []
  for (const item of response.output) {
    if (item.type !== 'function_call') continue
    let args: Record<string, unknown> = {}
    try {
      args = JSON.parse(item.arguments || '{}') as Record<string, unknown>
    } catch {
      args = {}
    }
    calls.push({ name: item.name, args })
  }
  return { text: (response.output_text || outputText(response)).trim(), calls }
}

/** The API wants the first message from the user and no empty turns. */
function trimHistory(history: Turn[]): Turn[] {
  const clean = history.filter((turn) => turn.content.trim())
  while (clean[0]?.role === 'assistant') clean.shift()
  return clean.slice(-12)
}

/* -------------------------------------------------------------- schemas */

/**
 * Small builders for the JSON schemas the writers hand to the API. Every
 * object lists all of its properties as required and forbids extras, which is
 * what strict structured output on both families asks for.
 */
export const S = {
  obj(properties: Record<string, unknown>, description?: string): JsonSchema {
    return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) }
  },
  arr(items: unknown, description?: string): JsonSchema {
    return { type: 'array', items, ...(description ? { description } : {}) }
  },
  str(description?: string): JsonSchema {
    return { type: 'string', ...(description ? { description } : {}) }
  },
  int(description?: string): JsonSchema {
    return { type: 'integer', ...(description ? { description } : {}) }
  },
  num(description?: string): JsonSchema {
    return { type: 'number', ...(description ? { description } : {}) }
  },
  bool(description?: string): JsonSchema {
    return { type: 'boolean', ...(description ? { description } : {}) }
  },
  enumOf(values: readonly string[], description?: string): JsonSchema {
    return { type: 'string', enum: [...values], ...(description ? { description } : {}) }
  },
}

/** Which model each task resolves to right now, for the settings page and the logs. */
export function resolvedModels(db: Db | null, storeId: string | null): Array<{ task: Task; name: string; note: string; choice: ModelChoice | null; label: string; stored: string }> {
  const stored = db && storeId ? storeModels(db, storeId) : {}
  return TASKS.map((spec) => {
    const choice = modelFor(db, storeId, spec.id)
    return { task: spec.id, name: spec.name, note: spec.note, choice, label: describe(choice), stored: stored[spec.id] ?? '' }
  })
}
