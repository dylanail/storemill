import { createHash } from 'node:crypto'
import { now, type Db } from '../lib/db.ts'
import { hashPassword, verifyPassword } from '../lib/crypto.ts'
import { badRequest, forbidden, unauthorized, type Ctx } from '../lib/http.ts'
import { id, token } from '../lib/ids.ts'

export const SESSION_COOKIE = 'amboras_session'
const SESSION_DAYS = 30

export type User = { id: string; email: string; name: string; createdAt: string }

function hash(value: string): string {
  return createHash('sha256').update(value).digest('base64url')
}

export function register(db: Db, input: { email: string; password: string; name?: string }): User {
  const email = input.email.trim().toLowerCase()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address')
  if (input.password.length < 10) throw badRequest('Use a password of at least 10 characters')
  if (db.one('SELECT id FROM users WHERE email = ?', email)) throw badRequest('That email already has an account')
  const userId = id('usr')
  db.insert('users', {
    id: userId,
    email,
    name: input.name ?? email.split('@')[0],
    password_hash: hashPassword(input.password),
    created_at: now(),
  })
  return getUser(db, userId) as User
}

export function login(db: Db, email: string, password: string): User {
  const row = db.one<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', email.trim().toLowerCase())
  if (!row || !verifyPassword(password, row.password_hash)) throw unauthorized('That email and password do not match')
  return getUser(db, row.id) as User
}

/* ------------------------------------------------------------ password reset */

const RESET_MINUTES = 60

/**
 * A way back into an account.
 *
 * There was none: a forgotten password meant the store, its products, its
 * orders and its connected domain were gone, recoverable only by editing the
 * database by hand. The token is random, stored as a hash like a session, good
 * for an hour and usable once.
 *
 * Null for an address with no account — the caller answers the same either
 * way, so the form cannot be used to find out who has one.
 */
export function startPasswordReset(db: Db, email: string): { token: string; user: User } | null {
  const row = db.one<{ id: string }>('SELECT id FROM users WHERE email = ?', email.trim().toLowerCase())
  if (!row) return null
  // One live link at a time: asking again invalidates the last one, so a
  // forwarded or intercepted older mail stops working.
  db.run("UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL", now(), row.id)
  const secret = token()
  db.insert('password_resets', {
    id: id('pwr'),
    user_id: row.id,
    token_hash: hash(secret),
    expires_at: new Date(Date.now() + RESET_MINUTES * 60_000).toISOString(),
    used_at: null,
    created_at: now(),
  })
  return { token: secret, user: getUser(db, row.id) as User }
}

/** The user a live reset token belongs to, for rendering the form before anything is changed. */
export function userForReset(db: Db, secret: string): User | null {
  const row = db.one<{ user_id: string }>(
    'SELECT user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    hash(secret),
    now(),
  )
  return row ? getUser(db, row.user_id) : null
}

export function resetPassword(db: Db, secret: string, password: string): User {
  const row = db.one<{ id: string; user_id: string }>(
    'SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    hash(secret),
    now(),
  )
  if (!row) throw badRequest('That reset link has expired or has already been used. Ask for another.')
  if (password.length < 10) throw badRequest('Use a password of at least 10 characters')
  db.tx(() => {
    db.update('users', row.user_id, { password_hash: hashPassword(password) })
    db.update('password_resets', row.id, { used_at: now() })
    // Every other session ends. If the reason for the reset was that someone
    // else had the password, leaving their session alive undoes the reset.
    db.run('DELETE FROM sessions WHERE user_id = ?', row.user_id)
  })
  return getUser(db, row.user_id) as User
}

export function getUser(db: Db, userId: string): User | null {
  const row = db.one<{ id: string; email: string; name: string; created_at: string }>('SELECT id, email, name, created_at FROM users WHERE id = ?', userId)
  return row ? { id: row.id, email: row.email, name: row.name, createdAt: row.created_at } : null
}

/** Update the signed-in person's account details without touching store ownership. */
export function updateProfile(db: Db, userId: string, input: { name: string; email: string }): User {
  const name = input.name.trim()
  const email = input.email.trim().toLowerCase()
  if (name.length < 1 || name.length > 80) throw badRequest('Enter a name between 1 and 80 characters')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest('Enter a valid email address')
  const duplicate = db.one<{ id: string }>('SELECT id FROM users WHERE email = ? AND id != ?', email, userId)
  if (duplicate) throw badRequest('That email already has an account')
  if (!getUser(db, userId)) throw unauthorized()
  db.tx(() => {
    db.update('users', userId, { name, email })
    db.run('UPDATE team_members SET email = ? WHERE user_id = ?', email, userId)
  })
  return getUser(db, userId) as User
}

export function startSession(db: Db, userId: string): string {
  const secret = token()
  db.insert('sessions', {
    id: id('ses'),
    user_id: userId,
    token_hash: hash(secret),
    expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
    created_at: now(),
  })
  return secret
}

export function endSession(db: Db, secret: string) {
  db.run('DELETE FROM sessions WHERE token_hash = ?', hash(secret))
}

export function userFor(db: Db, ctx: Ctx): User | null {
  const secret = ctx.cookies[SESSION_COOKIE]
  if (!secret) return null
  const row = db.one<{ user_id: string; expires_at: string }>('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', hash(secret))
  if (!row) return null
  if (row.expires_at < now()) {
    db.run('DELETE FROM sessions WHERE token_hash = ?', hash(secret))
    return null
  }
  return getUser(db, row.user_id)
}

export function requireUser(db: Db, ctx: Ctx): User {
  const user = userFor(db, ctx)
  if (!user) throw unauthorized()
  return user
}

export type Role = 'owner' | 'admin' | 'member'

/** Store access is owner-or-membership; there is no global admin bypass. */
export function roleOn(db: Db, userId: string, storeId: string): Role | null {
  const store = db.one<{ owner_id: string }>('SELECT owner_id FROM stores WHERE id = ?', storeId)
  if (!store) return null
  if (store.owner_id === userId) return 'owner'
  const member = db.one<{ role: string; status: string }>('SELECT role, status FROM team_members WHERE store_id = ? AND user_id = ?', storeId, userId)
  if (!member || member.status !== 'active') return null
  return member.role === 'admin' ? 'admin' : 'member'
}

export function requireRole(db: Db, userId: string, storeId: string, minimum: Role = 'member'): Role {
  const role = roleOn(db, userId, storeId)
  if (!role) throw forbidden('You do not have access to that store')
  const rank: Record<Role, number> = { member: 1, admin: 2, owner: 3 }
  if (rank[role] < rank[minimum]) throw forbidden(`That action needs ${minimum} access`)
  return role
}

export function inviteTeammate(db: Db, storeId: string, email: string, role: 'admin' | 'member') {
  const invite = token(24)
  const existingUser = db.one<{ id: string }>('SELECT id FROM users WHERE email = ?', email.toLowerCase())
  db.run('DELETE FROM team_members WHERE store_id = ? AND email = ?', storeId, email.toLowerCase())
  db.insert('team_members', {
    id: id('tm'),
    store_id: storeId,
    user_id: existingUser?.id ?? null,
    email: email.toLowerCase(),
    role,
    status: existingUser ? 'active' : 'invited',
    invite_token: invite,
    created_at: now(),
  })
  return { invite, joined: Boolean(existingUser) }
}

export function acceptInvite(db: Db, userId: string, inviteToken: string): boolean {
  const row = db.one<{ id: string }>('SELECT id FROM team_members WHERE invite_token = ? AND status = ?', inviteToken, 'invited')
  if (!row) return false
  db.update('team_members', row.id, { user_id: userId, status: 'active', invite_token: null })
  return true
}

export function listTeam(db: Db, storeId: string) {
  return db.all('SELECT id, email, role, status, created_at FROM team_members WHERE store_id = ? ORDER BY created_at', storeId)
}
