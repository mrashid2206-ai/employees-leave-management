import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'

export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

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
  `).catch(() => {})

  const { rows } = await pool.query(
    'SELECT id, username, name, role, is_active, created_at FROM admin_users ORDER BY id'
  )
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const { username, password, name } = await request.json()

  if (!username || !password || !name) {
    return NextResponse.json({ error: 'Username, password, and name are required' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 400 })
  }

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
  `).catch(() => {})

  const hash = await bcrypt.hash(password, 10)

  try {
    const { rows } = await pool.query(
      'INSERT INTO admin_users (username, password_hash, name) VALUES ($1, $2, $3) RETURNING id, username, name, role, is_active, created_at',
      [username.trim().toLowerCase(), hash, name.trim()]
    )
    await logAudit('admin_user_created', admin.username, 'admin', `Created admin user: ${username}`)
    return NextResponse.json(rows[0])
  } catch (err: any) {
    if (err.message?.includes('duplicate') || err.message?.includes('unique')) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create admin user' }, { status: 500 })
  }
}
