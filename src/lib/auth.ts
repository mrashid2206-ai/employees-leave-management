import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt'

async function signAdminToken(user: { username: string; role: string; name: string }) {
  return new SignJWT({ username: user.username, role: user.role, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('24h')
    .setIssuedAt()
    .sign(getJwtSecret())
}

export async function authenticate(username: string, password: string) {
  const trimmedUser = username.trim().toLowerCase()
  const trimmedPass = password.trim()

  // Ensure admin_users table exists. If the DB is unreachable this THROWS and the
  // caller fails closed (401/500) — we never fall through to a bootstrap login on
  // a DB error, which previously re-enabled a backdoor during transient outages.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      name VARCHAR(200) NOT NULL,
      role VARCHAR(20) DEFAULT 'admin',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const { rows } = await pool.query(
    'SELECT id, username, password_hash, name, role FROM admin_users WHERE username = $1 AND is_active = true',
    [trimmedUser]
  )

  if (rows.length > 0) {
    const valid = await bcrypt.compare(trimmedPass, rows[0].password_hash)
    if (!valid) return null
    const user = rows[0]
    const token = await signAdminToken(user)
    return { token, user: { username: user.username, role: user.role, name: user.name } }
  }

  // Bootstrap admin: only the username 'admin', with the password supplied via the
  // ADMIN_PASSWORD env var (never a committed literal). This is reachable only when
  // no matching admin_users row exists (e.g. fresh DB) so a real admin can be created.
  // If ADMIN_PASSWORD is unset, bootstrap is disabled entirely.
  const bootstrapPassword = process.env.ADMIN_PASSWORD
  if (bootstrapPassword && trimmedUser === 'admin' && trimmedPass === bootstrapPassword) {
    const user = { username: 'admin', role: 'admin', name: 'Admin' }
    const token = await signAdminToken(user)
    return { token, user }
  }

  return null
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    return payload as { username: string; role: string; name: string }
  } catch {
    return null
  }
}

export async function getSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get('auth-token')?.value
  if (!token) return null
  return verifyToken(token)
}
