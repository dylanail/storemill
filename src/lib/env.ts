/**
 * `.env`, read before anything else.
 *
 * The README's quickstart is `cp .env.example .env` then `npm start`, and
 * nothing was reading that file: the platform booted with no master key and
 * no model key, silently, and the admin blamed a missing key the owner had
 * already written down. Node's own loader is used, so there is no dependency
 * and no parser of our own.
 *
 * Two properties matter and both come from `loadEnvFile`:
 *   - a real environment variable always wins over the file, which keeps
 *     docker-compose's `env_file`, Railway's variables and the tests
 *     authoritative;
 *   - it is the first thing this process does, because `lib/crypto.ts`,
 *     `lib/log.ts` and `lib/uploads.ts` read their settings once, at import.
 *     Import this module before them and nowhere else matters.
 */
try {
  process.loadEnvFile()
} catch {
  /* no .env — every setting has a default, and the deployments pass real variables */
}

// Storemill settings take precedence; legacy deployment variables remain valid.
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('STOREMILL_') && value !== undefined) process.env['AMBORAS_' + name.slice(10)] = value
}

if (process.env.NODE_ENV === 'production') {
  const secret = process.env.AMBORAS_SECRET ?? ''
  if (secret.trim().length < 32 || /^(change-me|dev-secret)/i.test(secret.trim())) {
    throw new Error('Set STOREMILL_SECRET (or AMBORAS_SECRET) to a persistent random value of at least 32 characters before starting production.')
  }
}

export {}
