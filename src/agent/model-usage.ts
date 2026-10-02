import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Sanitized per HTTP attempt: never persist prompts, replies, keys or course excerpts. */
export type Usage = { input: number; cached: number; cacheWrite: number; output: number; reasoning: number }
export type Rates = { input: number; cached: number; cacheWrite: number; output: number }
export const RATE_DATE = '2026-10-02'
export const RATE_SOURCE = 'https://developers.openai.com/api/docs/models/gpt-5'
const GPT5: Rates = { input: 1.25, cached: 0.125, cacheWrite: 0, output: 10 }
export function estimateCost(provider: string, usage: Usage, rates: Rates): number {
  // Anthropic's input_tokens excludes both cache buckets. OpenAI's includes cache reads.
  const uncached = provider === 'openai' ? Math.max(0, usage.input - usage.cached - usage.cacheWrite) : usage.input
  return (uncached * rates.input + usage.cached * rates.cached + usage.cacheWrite * rates.cacheWrite + usage.output * rates.output) / 1e6
}
export function usageFor(provider: string, raw: any): Usage | null {
  if (!raw || typeof raw !== 'object') return null
  return { input: Number(raw.input_tokens || 0), cached: Number(provider === 'openai' ? raw.input_tokens_details?.cached_tokens || 0 : raw.cache_read_input_tokens || 0), cacheWrite: Number(provider === 'openai' ? raw.input_tokens_details?.cache_write_tokens || 0 : raw.cache_creation_input_tokens || 0), output: Number(raw.output_tokens || 0), reasoning: Number(raw.output_tokens_details?.reasoning_tokens || 0) }
}
export function meteredFetch(provider: string, model: string, task: string, delegate: typeof fetch): typeof fetch {
  return async (input, init) => {
    const start = Date.now()
    const entry: Record<string, unknown> = { at: new Date().toISOString(), provider, requestedModel: model, task, sdkMaxRetries: 2 }
    try {
      const response = await delegate(input, init)
      let body: any = null
      try { body = await response.clone().json() } catch { /* HTTP errors may not be JSON. */ }
      const usage = usageFor(provider, body?.usage)
      const actualModel = body?.model || model
      const rates = provider === 'openai' && /^gpt-5(?:-2025-08-07)?$/.test(actualModel) && (!usage?.cacheWrite) && (!body?.service_tier || ['default', 'auto'].includes(body.service_tier)) ? GPT5 : null
      Object.assign(entry, { httpStatus: response.status, responseId: body?.id || null, requestId: response.headers.get('x-request-id') || response.headers.get('request-id'), actualModel, serviceTier: body?.service_tier || null, status: body?.status || body?.stop_reason || (response.ok ? 'unknown' : 'http_error'), incompleteReason: body?.incomplete_details?.reason || null, usage, estimatedUsd: usage && rates ? estimateCost(provider, usage, rates) : null, costStatus: usage && rates ? 'estimate' : 'unknown', ...(rates ? { rateDate: RATE_DATE, rateSource: RATE_SOURCE, ratesPerMillion: rates } : {}) })
      return response
    } catch (error) {
      Object.assign(entry, { status: 'transport_error', usage: null, estimatedUsd: null, costStatus: 'unknown', errorType: error instanceof Error ? error.name : 'unknown' })
      throw error
    } finally {
      entry.elapsedMs = Date.now() - start
      try {
        const file = process.env.STOREMILL_MODEL_USAGE_FILE || resolve(dirname(process.env.AMBORAS_DB || 'data/storemill.db'), 'model-usage.jsonl')
        mkdirSync(dirname(file), { recursive: true })
        appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 })
      } catch { console.error('Model usage ledger could not be persisted; billing usage is unknown.') }
    }
  }
}
