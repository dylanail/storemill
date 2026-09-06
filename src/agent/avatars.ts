import { json, now, type Db } from '../lib/db.ts'
import { id } from '../lib/ids.ts'
import { logger } from '../lib/log.ts'
import { latestResearch, type Persona, type Research } from './research.ts'
import { readDirection, type Direction, type Tone } from './directions.ts'
import { completeJson, describe, modelFor, S, type ModelChoice } from './models.ts'
import { knowledge } from './knowledge.ts'

const log = logger('avatars')

/**
 * Avatars.
 *
 * An avatar is one customer the page or the ad is written to: who they are,
 * what they want, what they are afraid of, and the angle that reaches them.
 * Research suggests them; the merchant edits them, adds their own, and picks
 * one when generating. Everything downstream — versions, advertorials, ads —
 * reads the avatar into the same Direction the free-form box produces, so
 * "for gift buyers" typed by hand and the Gift buyer avatar land in the same
 * place.
 */
export type Avatar = {
  id: string
  name: string
  who: string
  wants: string
  fears: string
  buysWhen: string
  share: number
  /** The angle that reaches this person: "durability over price". */
  angle: string
  hooks: string[]
  tone: Tone
  /** The objection this person raises first, and the answer. */
  objection: string
  answer: string
  source: 'research' | 'competitor' | 'manual'
  selected: boolean
  /** A sub-avatar belongs to a core avatar; the core has no parent. */
  parentId: string
  /** The five categories, when they were written down. The core avatar carries the desire; sub-avatars add one or more of the rest. */
  desire: string
  experience: string
  emotion: string
  behaviour: string
  demographic: string
  /** What this person calls themselves, for a hook: "night shift", "the last-minute kind". */
  label: string
  /** How many people the avatar can reach: niche (under 100k), mid (100k–1M), mass (1M+). */
  tier: 'niche' | 'mid' | 'mass' | ''
  createdAt: string
  updatedAt: string
}

export type AvatarInput = Partial<Omit<Avatar, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }

/* -------------------------------------------------------------- suggestions */

const TONE_FOR: Array<[RegExp, Tone]> = [
  [/gift|partner|parent|family/i, 'warm'],
  [/collector|craft|heritage|provenance|premium|luxury/i, 'premium'],
  [/ingredient|clinical|percent|science|spec|data/i, 'clinical'],
  [/coach|team|office|buys for others|bulk/i, 'blunt'],
]

export function personaToAvatar(persona: Persona, triggers: string[], objections: Array<{ objection: string; answer: string }>, index: number): AvatarInput {
  const text = `${persona.name} ${persona.who} ${persona.wants} ${persona.fears}`
  const tone = TONE_FOR.find(([pattern]) => pattern.test(text))?.[1] ?? 'plain'
  const angle = angleFromWants(persona.wants)
  const objection = objections[index % Math.max(1, objections.length)]
  return {
    name: persona.name,
    who: persona.who,
    wants: persona.wants,
    fears: persona.fears,
    buysWhen: persona.buysWhen,
    share: persona.share,
    angle,
    hooks: hooksFor(persona, triggers),
    tone,
    objection: objection?.objection ?? '',
    answer: objection?.answer ?? '',
    source: 'research',
    // Whether an avatar is the one being written to is suggestAvatars' call,
    // not a property of the persona it came from.
    selected: false,
  }
}

/** "Wrist support that survives a year and padding that protects a partner." → "wrist support that survives a year" */
export function angleFromWants(wants: string): string {
  const first = wants.split(/\band\b|,|;/)[0] ?? wants
  return first.replace(/\.$/, '').trim().toLowerCase()
}

export function hooksFor(persona: Persona, triggers: string[]): string[] {
  const hooks: string[] = []
  const fear = persona.fears.replace(/\.$/, '')
  const want = persona.wants.replace(/\.$/, '')
  const when = persona.buysWhen.replace(/\.$/, '')
  if (fear) hooks.push(`${capitalize(fear.replace(/^(paying|choosing|getting|a brand)/i, (match) => `Tired of ${match.toLowerCase()}`))}?`)
  if (want) hooks.push(`${capitalize(want)}. That is the whole product.`)
  if (when) hooks.push(`${capitalize(when)}? This is the one to replace it with.`)
  for (const trigger of triggers.slice(0, 2)) hooks.push(`${trigger}. Here is what to do about it.`)
  return hooks.slice(0, 5)
}

const TONES: Tone[] = ['plain', 'urgent', 'premium', 'warm', 'clinical', 'playful', 'blunt']

const AVATARS_SCHEMA = S.obj({
  avatars: S.arr(
    S.obj({
      name: S.str('"The serious amateur" — a label the owner will recognise.'),
      who: S.str('Who they are, one or two sentences with concrete detail.'),
      wants: S.str('The outcome they are buying.'),
      fears: S.str('What they are afraid of getting wrong.'),
      buysWhen: S.str('The moment that triggers the purchase.'),
      share: S.num('Fraction of buyers, 0 to 1; shares add up to 1.'),
      angle: S.str('The angle that reaches this person, in five to eight words.'),
      hooks: S.arr(S.str(), 'Five first lines for an ad aimed at this person.'),
      tone: S.enumOf(TONES, 'The tone that lands with them.'),
      objection: S.str('The objection they raise first.'),
      answer: S.str('The answer that gets past it.'),
      desire: S.str('The surface desire as "I want X" or "I need Y".'),
      experience: S.str('The circumstance or the product they tried and its outcome, emotion removed. Empty if unknown.'),
      emotion: S.str('How they feel about it, as one of the six primary emotions or a secondary one unpacked. Empty if unknown.'),
      behaviour: S.str('What they do about it now and how often. Empty if unknown.'),
      label: S.str('What they call themselves, for a hook.'),
      tier: S.enumOf(['niche', 'mid', 'mass'], 'How many people this reaches.'),
    }),
    'Three to five avatars, biggest share first. The first is the core avatar: one desire, nothing else layered.',
  ),
})

async function modelAvatars(choice: ModelChoice, research: Research): Promise<AvatarInput[]> {
  const prompt = [
    `Customer research on file:\n${JSON.stringify({ category: research.category, positioning: research.positioning, audience: research.audience, triggers: research.triggers, objections: research.objections, competitors: research.competitors, proofPoints: research.proofPoints })}`,
    'Turn the personas into avatars a media buyer can write to: one person each, with the angle that reaches them, five scroll-stopping hooks in their language, the tone, and the objection they raise first with its answer. Keep the persona names from the research where they fit.',
  ].join('\n\n')
  const parsed = await completeJson<{ avatars: Array<Omit<AvatarInput, 'source' | 'selected'>> }>(choice, {
    task: 'research',
    system: `You write customer avatars for a dropshipping brand that sells through paid social. Specific people, real language, no invented statistics. Each avatar is desire-based first; the angle is the reason to buy in that person's terms.\n\n${knowledge('avatars', 'desires', 'honesty')}`,
    prompt,
    schema: AVATARS_SCHEMA,
    name: 'avatars',
    maxTokens: 6000,
  })
  return (parsed.avatars ?? []).map((avatar) => ({ ...avatar, tone: TONES.includes(avatar.tone as Tone) ? avatar.tone : 'plain', hooks: (avatar.hooks ?? []).slice(0, 5), tier: (['niche', 'mid', 'mass'] as const).includes(avatar.tier as 'niche') ? avatar.tier : ('' as const), source: 'research' as const, selected: false }))
}

/**
 * Reads the research on file into avatars. With a model it writes them;
 * without one the personas are mapped by rules. Existing avatars with the
 * same name are left alone: the merchant's edits are theirs, and re-running
 * should add what is new, not overwrite what they fixed.
 *
 * One of them arrives switched on, not all of them. Everything that writes to
 * an avatar takes the first selected one, so a set where every avatar is on is
 * a set where "selected" means nothing and the ad is written to whichever row
 * the database returned first. The core avatar — the largest share — is the
 * one on; the rest are suggestions to switch on deliberately. And a store that
 * has already chosen keeps its choice: a second run adds, it does not re-pick.
 */
export async function suggestAvatars(db: Db, storeId: string, model?: ModelChoice | null): Promise<Avatar[]> {
  const research = latestResearch(db, storeId)
  if (!research) return listAvatars(db, storeId)
  const choice = model === undefined ? modelFor(db, storeId, 'research') : model
  let suggested: AvatarInput[]
  try {
    suggested = choice ? await modelAvatars(choice, research) : []
    if (choice) log.info(`avatars written by ${describe(choice)}`)
  } catch (error) {
    log.warn(`${describe(choice)} could not write avatars; mapping the personas instead: ${error instanceof Error ? error.message : String(error)}`)
    suggested = []
  }
  if (!suggested.length) suggested = research.audience.map((persona, index) => personaToAvatar(persona, research.triggers, research.objections, index))
  const already = listAvatars(db, storeId)
  const chosen = already.some((avatar) => avatar.selected)
  const core = suggested.reduce((best, avatar, index) => ((avatar.share ?? 0) > (suggested[best]?.share ?? 0) ? index : best), 0)
  const existing = new Set(already.map((avatar) => avatar.name.toLowerCase()))
  for (const [index, avatar] of suggested.entries()) {
    if (!avatar.name?.trim() || existing.has(avatar.name.toLowerCase())) continue
    saveAvatar(db, storeId, { ...avatar, selected: !chosen && index === core })
    existing.add(avatar.name.toLowerCase())
  }
  return listAvatars(db, storeId)
}

/* ------------------------------------------------------------------ storage */

type AvatarRow = { id: string; store_id: string; name: string; body: string; source: string; selected: number; parent_id?: string; created_at: string; updated_at: string }

function rowToAvatar(row: AvatarRow): Avatar {
  const body = json<Partial<Avatar>>(row.body, {})
  return {
    id: row.id,
    name: row.name,
    who: body.who ?? '',
    wants: body.wants ?? '',
    fears: body.fears ?? '',
    buysWhen: body.buysWhen ?? '',
    share: body.share ?? 0,
    angle: body.angle ?? '',
    hooks: body.hooks ?? [],
    tone: body.tone ?? 'plain',
    objection: body.objection ?? '',
    answer: body.answer ?? '',
    source: (row.source as Avatar['source']) ?? 'manual',
    selected: Boolean(row.selected),
    parentId: row.parent_id ?? '',
    desire: body.desire ?? '',
    experience: body.experience ?? '',
    emotion: body.emotion ?? '',
    behaviour: body.behaviour ?? '',
    demographic: body.demographic ?? '',
    label: body.label ?? '',
    tier: body.tier ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function listAvatars(db: Db, storeId: string): Avatar[] {
  return db.all<AvatarRow>('SELECT * FROM avatars WHERE store_id = ? ORDER BY created_at', storeId).map(rowToAvatar)
}

export function getAvatar(db: Db, storeId: string, avatarId: string): Avatar | null {
  const row = db.one<AvatarRow>('SELECT * FROM avatars WHERE store_id = ? AND id = ?', storeId, avatarId)
  return row ? rowToAvatar(row) : null
}

export function saveAvatar(db: Db, storeId: string, input: AvatarInput & { id?: string }): Avatar {
  const name = input.name.trim()
  if (!name) throw new Error('An avatar needs a name')
  const current = input.id ? getAvatar(db, storeId, input.id) : null
  const merged: Omit<Avatar, 'id' | 'createdAt' | 'updatedAt'> = {
    name,
    who: input.who ?? current?.who ?? '',
    wants: input.wants ?? current?.wants ?? '',
    fears: input.fears ?? current?.fears ?? '',
    buysWhen: input.buysWhen ?? current?.buysWhen ?? '',
    share: input.share ?? current?.share ?? 0,
    angle: input.angle ?? current?.angle ?? angleFromWants(input.wants ?? current?.wants ?? ''),
    hooks: input.hooks ?? current?.hooks ?? [],
    tone: input.tone ?? current?.tone ?? 'plain',
    objection: input.objection ?? current?.objection ?? '',
    answer: input.answer ?? current?.answer ?? '',
    source: input.source ?? current?.source ?? 'manual',
    selected: input.selected ?? current?.selected ?? true,
    parentId: input.parentId ?? current?.parentId ?? '',
    desire: input.desire ?? current?.desire ?? '',
    experience: input.experience ?? current?.experience ?? '',
    emotion: input.emotion ?? current?.emotion ?? '',
    behaviour: input.behaviour ?? current?.behaviour ?? '',
    demographic: input.demographic ?? current?.demographic ?? '',
    label: input.label ?? current?.label ?? '',
    tier: input.tier ?? current?.tier ?? '',
  }
  const { name: _name, source, selected, parentId, ...body } = merged
  if (current) {
    db.update('avatars', current.id, { name, body, source, selected: selected ? 1 : 0, parent_id: parentId, updated_at: now() })
    return getAvatar(db, storeId, current.id) as Avatar
  }
  const avatarId = id('ava')
  db.insert('avatars', { id: avatarId, store_id: storeId, name, body, source, selected: selected ? 1 : 0, parent_id: parentId, created_at: now(), updated_at: now() })
  return getAvatar(db, storeId, avatarId) as Avatar
}

export function deleteAvatar(db: Db, storeId: string, avatarId: string) {
  db.run('DELETE FROM avatars WHERE store_id = ? AND id = ?', storeId, avatarId)
  db.run("UPDATE avatars SET parent_id = '' WHERE store_id = ? AND parent_id = ?", storeId, avatarId)
}

/** Core avatars first, each followed by its sub-avatars. */
export function avatarTree(db: Db, storeId: string): Array<{ core: Avatar; subs: Avatar[] }> {
  const all = listAvatars(db, storeId)
  const cores = all.filter((avatar) => !avatar.parentId || !all.some((other) => other.id === avatar.parentId))
  return cores.map((core) => ({ core, subs: all.filter((avatar) => avatar.parentId === core.id) }))
}

/* ---------------------------------------------------------------- direction */

/**
 * The avatar fills what the free-form direction left blank. Typed words win:
 * "for coaches" on top of the Gift buyer avatar targets coaches, and a tone
 * word overrides the avatar's suggested tone.
 */
export function directionFor(raw: string, avatar: Avatar | null): Direction {
  const direction = readDirection(raw)
  if (!avatar) return direction
  const typedTone = direction.tone !== 'plain'
  return {
    ...direction,
    tone: typedTone ? direction.tone : avatar.tone,
    audience: direction.audience || shortWho(avatar),
    angle: direction.angle || avatar.angle,
    mustSay: direction.mustSay,
    avatar: avatar.name,
  }
}

/** "The serious amateur" → "serious amateurs"; falls back to the first clause of `who`. */
export function shortWho(avatar: Avatar): string {
  const name = avatar.name.replace(/^the\s+/i, '').trim().toLowerCase()
  if (name && name.split(/\s+/).length <= 4) return name.endsWith('s') ? name : `${name}s`
  return (avatar.who.split(/[.,;]/)[0] ?? '').trim().toLowerCase()
}

function capitalize(input: string): string {
  return input.charAt(0).toUpperCase() + input.slice(1)
}
