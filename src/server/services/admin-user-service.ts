import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { MIN_PASSWORD_LENGTH } from '@/lib/constants'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'

// Admin accounts. Every admin has the same powers (a deliberate choice: no roles), which is
// exactly why the guards here matter: any admin can remove any other, so nothing but these
// checks stops the system ending up with nobody able to administer it.

export interface AdminUserRow {
  id: number
  username: string
  name: string
  role: string
  is_active: boolean
  created_at: string
}

const COLS = 'id, username, name, role, is_active, created_at'

export async function createAdminUser(
  input: { username?: unknown; password?: unknown; name?: unknown },
  actor: Actor
): Promise<ServiceResult<AdminUserRow>> {
  const { username, password, name } = input
  if (typeof username !== 'string' || typeof password !== 'string' || typeof name !== 'string' || !username.trim() || !password || !name.trim()) {
    return fail(400, 'Username, password, and name are required')
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return fail(400, `Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }

  const hash = await bcrypt.hash(password, 10)
  const cleanUsername = username.trim().toLowerCase()

  // Admin deletion removes the row, which is what ends that admin's sessions (a token
  // whose identity row is gone is rejected). Re-creating the same username would start
  // again at token_version 0 and so match tokens issued to the deleted account (or to the
  // bootstrap 'admin'), reviving them. A random starting version means a new account
  // never shares one with an earlier holder of the name.
  const startVersion = randomInt(1, 2 ** 30)

  try {
    const { rows } = await pool.query(
      `INSERT INTO admin_users (username, password_hash, name, token_version) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
      [cleanUsername, hash, name.trim(), startVersion]
    )
    await logAudit('admin_user_created', actorLabel(actor), actor.role, `Created admin user @${cleanUsername} (${name.trim()})`)
    return ok(rows[0])
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return fail(409, 'Username already exists / اسم المستخدم مستخدم بالفعل')
    }
    throw err
  }
}

export async function deleteAdminUser(rawId: string, actor: Actor): Promise<ServiceResult<{ success: true }>> {
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) return fail(404, 'Not found')

  const client = await pool.connect()
  let target: AdminUserRow
  try {
    await client.query('BEGIN')
    // Lock every active admin, not just the target: two admins deleting each other at the
    // same moment would otherwise each still see the other as active, both succeed, and
    // leave no active admin at all.
    const { rows: active } = await client.query('SELECT id FROM admin_users WHERE is_active = true ORDER BY id FOR UPDATE')
    const { rows } = await client.query(`SELECT ${COLS} FROM admin_users WHERE id = $1 FOR UPDATE`, [id])
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found')
    }
    target = rows[0]

    if (actor.username && target.username === actor.username) {
      await client.query('ROLLBACK')
      return fail(409, 'You cannot delete your own account / لا يمكنك حذف حسابك')
    }
    // With no active admin left, the only way back in would be the ADMIN_PASSWORD
    // bootstrap login, which most deployments have (rightly) unset.
    if (target.is_active && !active.some(a => a.id !== target.id)) {
      await client.query('ROLLBACK')
      return fail(409, 'Cannot delete the last active admin / لا يمكن حذف آخر مدير نشط')
    }

    await client.query('DELETE FROM admin_users WHERE id = $1', [id])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // No bumpTokenVersion here: it would update nothing, the row is gone. Removing the row is
  // what revokes: tokenIsCurrent rejects any token whose admin no longer exists, on the
  // very next request (see createAdminUser for why the name can't bring them back).
  await logAudit('admin_user_deleted', actorLabel(actor), actor.role, `Deleted admin user @${target.username} (${target.name}, #${id})`)
  return ok({ success: true as const })
}
