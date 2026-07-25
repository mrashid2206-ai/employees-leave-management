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
      // BOOTSTRAP admin — `authenticate()` issues a token for username 'admin' backed by
      // the ADMIN_PASSWORD env var precisely when admin_users is still empty, so there is
      // no row to check. Rejecting it would lock an admin out of a fresh deployment
      // entirely. Such a token can only be obtained by knowing ADMIN_PASSWORD.
      return kind === 'admin' && subject === 'admin' && !!process.env.ADMIN_PASSWORD
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

/** Invalidate every existing session for an identity. */
export async function bumpTokenVersion(kind: Identity, subject: string | number): Promise<void> {
  const { table, key } = SOURCE[kind]
  try {
    await pool.query(`UPDATE ${table} SET token_version = token_version + 1 WHERE ${key} = $1`, [subject])
  } catch (err) {
    logger.error('could not bump token version', err, { kind, subject })
  }
}
