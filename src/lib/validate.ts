/**
 * A tiny structural validator.
 *
 * Every agent tool declares its inputs with one of these, and the executor
 * validates before the handler ever runs: the model proposes, the registry
 * disposes. Plugin `settingsSchema` blocks are the same shape, which is why
 * one renderer can draw a settings form for any plugin in the catalog.
 */
export type Field =
  | { type: 'string'; label?: string; required?: boolean; pattern?: string; max?: number; enum?: string[]; default?: string; help?: string; multiline?: boolean }
  | { type: 'number'; label?: string; required?: boolean; min?: number; max?: number; integer?: boolean; default?: number; help?: string }
  | { type: 'boolean'; label?: string; required?: boolean; default?: boolean; help?: string }
  | { type: 'array'; label?: string; required?: boolean; of?: Field; max?: number; help?: string }
  | { type: 'object'; label?: string; required?: boolean; fields?: Schema; help?: string }
  | { type: 'any'; label?: string; required?: boolean; help?: string }

export type Schema = Record<string, Field>

export class ValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super(issues.join('; '))
    this.name = 'ValidationError'
    this.issues = issues
  }
}

export function validate<T = Record<string, unknown>>(schema: Schema, input: unknown): T {
  const issues: string[] = []
  const value = coerceObject(schema, input, '', issues)
  if (issues.length) throw new ValidationError(issues)
  return value as T
}

/**
 * `blankIsValue` keeps an empty string as an empty string instead of treating
 * it as "not supplied" and substituting the field's default.
 *
 * Tool arguments and settings forms want the default — a field left alone
 * posts as '' and should keep what it had. A block's settings are the
 * opposite: the owner deleting the shipped headline out of the panel meant
 * exactly that, and reinstating it at render made 116 of the catalog's string
 * settings impossible to clear.
 */
export function check(
  schema: Schema,
  input: unknown,
  opts: { blankIsValue?: boolean } = {},
): { ok: true; value: Record<string, unknown> } | { ok: false; issues: string[] } {
  const issues: string[] = []
  const value = coerceObject(schema, input, '', issues, opts.blankIsValue ?? false)
  return issues.length ? { ok: false, issues } : { ok: true, value }
}

function coerceObject(schema: Schema, input: unknown, path: string, issues: string[], blankIsValue = false): Record<string, unknown> {
  const source = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input))) {
    issues.push(`${path || 'input'} must be an object`)
  }
  const out: Record<string, unknown> = {}
  for (const [key, field] of Object.entries(schema)) {
    const at = path ? `${path}.${key}` : key
    const raw = source[key]
    const coerced = coerceField(field, raw, at, issues, blankIsValue)
    if (coerced !== undefined) out[key] = coerced
  }
  return out
}

function coerceField(field: Field, raw: unknown, at: string, issues: string[], blankIsValue = false): unknown {
  if (blankIsValue && raw === '' && field.type === 'string') return ''
  if (raw === undefined || raw === null || raw === '') {
    if ('default' in field && field.default !== undefined) return field.default
    if (field.required) issues.push(`${at} is required`)
    return undefined
  }
  switch (field.type) {
    case 'string': {
      const value = typeof raw === 'string' ? raw : String(raw)
      if (field.max && value.length > field.max) issues.push(`${at} must be at most ${field.max} characters`)
      if (field.enum && !field.enum.includes(value)) issues.push(`${at} must be one of ${field.enum.join(', ')}`)
      if (field.pattern && !new RegExp(field.pattern).test(value)) issues.push(`${at} does not match ${field.pattern}`)
      return value
    }
    case 'number': {
      const value = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(value)) {
        issues.push(`${at} must be a number`)
        return undefined
      }
      if (field.integer && !Number.isInteger(value)) issues.push(`${at} must be a whole number`)
      if (field.min !== undefined && value < field.min) issues.push(`${at} must be at least ${field.min}`)
      if (field.max !== undefined && value > field.max) issues.push(`${at} must be at most ${field.max}`)
      return value
    }
    case 'boolean':
      if (typeof raw === 'boolean') return raw
      if (raw === 'true' || raw === 'on' || raw === '1') return true
      if (raw === 'false' || raw === 'off' || raw === '0') return false
      issues.push(`${at} must be true or false`)
      return undefined
    case 'array': {
      const list = Array.isArray(raw) ? raw : [raw]
      if (field.max && list.length > field.max) issues.push(`${at} must have at most ${field.max} entries`)
      if (!field.of) return list
      return list.map((entry, index) => coerceField(field.of as Field, entry, `${at}[${index}]`, issues))
    }
    case 'object':
      return field.fields ? coerceObject(field.fields, raw, at, issues, blankIsValue) : raw
    default:
      return raw
  }
}

/** Renders a schema as the JSON shape an LLM sees in its tool definitions. */
export function toJsonSchema(schema: Schema): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, field] of Object.entries(schema)) {
    properties[key] = fieldToJsonSchema(field)
    if (field.required) required.push(key)
  }
  return { type: 'object', properties, required, additionalProperties: false }
}

function fieldToJsonSchema(field: Field): Record<string, unknown> {
  const base: Record<string, unknown> = { description: field.label ?? field.help }
  switch (field.type) {
    case 'string':
      return { ...base, type: 'string', ...(field.enum ? { enum: field.enum } : {}), ...(field.pattern ? { pattern: field.pattern } : {}) }
    case 'number':
      return { ...base, type: field.integer ? 'integer' : 'number' }
    case 'boolean':
      return { ...base, type: 'boolean' }
    case 'array':
      return { ...base, type: 'array', items: field.of ? fieldToJsonSchema(field.of) : {} }
    case 'object':
      return { ...base, type: 'object', ...(field.fields ? toJsonSchema(field.fields) : {}) }
    default:
      return base
  }
}
