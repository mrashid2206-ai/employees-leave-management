import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { verifyEmployee, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { getJwtSecret } from '@/lib/jwt'
import { bumpTokenVersion, currentTokenVersion } from '@/lib/token-version'
import { MIN_PASSWORD_LENGTH } from '@/lib/constants'

export async function POST(request: Request) {
  const user = await verifyEmployee(request)
  if (!user) return unauthorized()

  const { current_password, new_password } = await request.json()

  if (!current_password || !new_password) {
    return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 })
  }

  if (new_password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` }, { status: 400 })
  }

  // Verify current password
  const { rows } = await pool.query('SELECT password_hash FROM employees WHERE id = $1', [user.id])
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const valid = await bcrypt.compare(current_password, rows[0].password_hash)
  if (!valid) {
    return NextResponse.json({ error: 'Current password is incorrect' }, { status: 401 })
  }

  const hash = await bcrypt.hash(new_password, 10)
  await pool.query('UPDATE employees SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE id = $2', [hash, user.id])

  // Changing a password should end every OTHER session — that is half the reason people
  // change one. Bump the version to invalidate them all, then hand this caller a fresh
  // cookie carrying the new version so the session doing the change survives.
  await bumpTokenVersion('employee', user.id!)
  const tv = await currentTokenVersion('employee', user.id!)
  const token = await new SignJWT({
    id: user.id,
    username: user.username,
    name: user.name,
    role: 'employee',
    department_id: user.department_id,
    must_change_password: false,
    tv,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('12h')
    .setIssuedAt()
    .sign(getJwtSecret())

  await logAudit('password_change', user.username, 'employee', `Employee ${user.id} changed password`)

  const response = NextResponse.json({ success: true })
  response.cookies.set('emp-auth-token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 12,
    path: '/',
  })
  return response
}
