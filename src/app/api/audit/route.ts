import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      action VARCHAR(100) NOT NULL,
      user_id VARCHAR(100),
      user_role VARCHAR(20),
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const { rows } = await pool.query('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100')
  return NextResponse.json(rows)
}
