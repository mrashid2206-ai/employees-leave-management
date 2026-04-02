import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'

function getSecret() {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is required')
  return new TextEncoder().encode(secret)
}

// Fallback hardcoded admin (used if admin_users table doesn't exist yet)
const FALLBACK_ADMIN = { username: 'admin', password: 'Admin@2026', role: 'admin', name: 'Admin' }

export async function authenticate(username: string, password: string) {
  const trimmedUser = username.trim()
  const trimmedPass = password.trim()

  // Try DB admin first
  try {
    // Ensure admin_users table exists
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
      if (valid) {
        const user = rows[0]
        const token = await new SignJWT({ username: user.username, role: user.role, name: user.name })
          .setProtectedHeader({ alg: 'HS256' })
          .setExpirationTime('24h')
          .setIssuedAt()
          .sign(getSecret())
        return { token, user: { username: user.username, role: user.role, name: user.name } }
      }
      return null // Wrong password for existing DB user
    }
  } catch {
    // Table doesn't exist or DB error — fall through to hardcoded
  }

  // Fallback to hardcoded admin
  if (trimmedUser === FALLBACK_ADMIN.username && trimmedPass === FALLBACK_ADMIN.password) {
    const token = await new SignJWT({ username: FALLBACK_ADMIN.username, role: FALLBACK_ADMIN.role, name: FALLBACK_ADMIN.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('24h')
      .setIssuedAt()
      .sign(getSecret())
    return { token, user: { username: FALLBACK_ADMIN.username, role: FALLBACK_ADMIN.role, name: FALLBACK_ADMIN.name } }
  }

  return null
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecret())
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
