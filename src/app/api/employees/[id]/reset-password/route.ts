import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { bumpTokenVersion } from '@/lib/token-version'
import { DEFAULT_EMPLOYEE_PASSWORD, MIN_PASSWORD_LENGTH } from '@/lib/constants'
import { logger } from '@/lib/log'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const { password } = await request.json()
  // If no explicit password is given, reset to the shared default and force a change.
  const usingDefault = !password
  const pwd = password || DEFAULT_EMPLOYEE_PASSWORD

  if (pwd.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 })
  }

  const newPassword = await bcrypt.hash(pwd, 10)

  // End any session the employee (or anyone holding their cookie) still has. A password
  // reset that leaves the old session alive is not a reset, so both happen in one
  // transaction: if the revocation fails, the password stays as it was and the admin
  // gets an error to retry, rather than a "success" with the old session still live.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      'UPDATE employees SET password_hash = $1, must_change_password = $2, updated_at = NOW() WHERE id = $3',
      [newPassword, usingDefault, id]
    )
    await bumpTokenVersion('employee', Number(id), client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    logger.error('password reset failed', err, { employeeId: id })
    return NextResponse.json({ error: 'Could not reset password' }, { status: 500 })
  } finally {
    client.release()
  }

  await logAudit('password_reset', admin.username, 'admin', `Reset password for emp ${id}`)

  return NextResponse.json({ success: true })
}
