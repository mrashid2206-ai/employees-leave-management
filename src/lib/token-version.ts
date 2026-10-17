import type { PoolClient } from 'pg'
import pool from '@/lib/db'
import { logger } from '@/lib/log'

// Session revocation for stateless JWTs.
//
// The tokens are self-contained and valid for 12–24h, so without this a logout, a password
// reset, or deactivating an employee did nothing to sessions already issued — an offboarded
// person kept access to HR data until their token happened to expire.
//
// Each identity carries a `token_version`, stamped into the token at login and checked on
// every authenticated request. Bumping the column invalidates every token issued before it.

export type Identity = 'employee' | 'admin'

// Employee tokens carry a numeric id; admin tokens only carry a username (see
// signAdminToken), so each identity is looked up by the key its token actually has.
const SOURCE: Record<Identity, { table: string; key: string }> = {
  employee: { table: 'employees', key: 'id' },
  admin: { table: 'admin_users', key: 'username' },
}

/**
 * May the bootstrap admin (username 'admin' + the ADMIN_PASSWORD env var) be used?
 *
 * Only while there is no active admin account at all, i.e. a fresh database or one where
 * every admin has been deactivated. It used to be allowed whenever no row was *named*
 * 'admin', so once the real admins had other usernames, a still-set ADMIN_PASSWORD stayed
 * a permanent second way in. Throws on a DB error so callers fail closed.
 */
export async function bootstrapAdminAllowed(): Promise<boolean> {
  if (!process.env.ADMIN_PASSWORD) return false
  const { rows } = await pool.query('SELECT EXISTS (SELECT 1 FROM admin_users WHERE is_active = true) AS any')
  return !rows[0].any
}

/** Current token version, used when minting a token. */
export async function currentTokenVersion(kind: Identity, subject: string | number): Promise<number> {
  const { table, key } = SOURCE[kind]
  try {
    const { rows } = await pool.query(`SELECT token_version FROM ${table} WHERE ${key} = $1`, [subject])
    return rows[0]?.token_version ?? 0
  } catch {
    return 0
  }
}

/**
 * Is this token still current?
 *
 * A missing `tv` claim counts as 0 so tokens issued before this shipped keep working until
 * they expire — and stay revocable, since bumping to 1 no longer matches 0.
 *
 * Costs one indexed lookup per authenticated request. That is deliberate: caching it would
 * leave a window where a revoked session still works, which is the exact thing this exists
 * to prevent.
 */
export async function tokenIsCurrent(
  kind: Identity,
  subject: string | number | undefined,
  tv: unknown
): Promise<boolean> {
  if (subject === undefined || subject === null) return false
  const claimed = typeof tv === 'number' ? tv : 0
  const { table, key } = SOURCE[kind]
  try {
    const { rows } = await pool.query(
      `SELECT token_version, is_active FROM ${table} WHERE ${key} = $1`,
      [subject]
    )
    if (rows.length === 0) {
      // No row: normally a deleted identity, so reject. The one exception is the
      // BOOTSTRAP admin, which has no row by design. Its token stays valid only while
      // bootstrap is still allowed, so it dies the moment a real admin is created.
      return kind === 'admin' && subject === 'admin' && (await bootstrapAdminAllowed())
    }
    if (rows[0].is_active === false) return false // deactivated — reject immediately
    return (rows[0].token_version ?? 0) === claimed
  } catch (err) {
    // Fail CLOSED: if the identity cannot be confirmed the request is not authenticated.
    // A transient DB error must never widen access.
    logger.error('token version check failed', err, { kind, subject })
    return false
  }
}

/**
 * Invalidate every existing session for an identity.
 *
 * THROWS if the bump fails. It used to log and return, so a password reset or an
 * offboarding reported success while every session it was meant to end stayed valid,
 * and nobody would ever find out. A revocation that didn't happen has to fail the
 * request that asked for it.
 *
 * Pass the caller's transaction client so the bump commits or rolls back together with
 * the change that called for it (the new password hash, the deactivation): a failed
 * bump then leaves nothing half-done for the admin to retry.
 */
export async function bumpTokenVersion(
  kind: Identity,
  subject: string | number,
  db: Pick<PoolClient, 'query'> = pool
): Promise<void> {
  const { table, key } = SOURCE[kind]
  try {
    await db.query(`UPDATE ${table} SET token_version = token_version + 1 WHERE ${key} = $1`, [subject])
  } catch (err) {
    logger.error('could not bump token version', err, { kind, subject })
    throw err
  }
}
