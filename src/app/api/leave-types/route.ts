import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query('SELECT * FROM leave_types ORDER BY id')
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { name_ar, name_en, color } = await request.json()
  if (!name_ar || !name_en || !color) {
    return NextResponse.json({ error: 'All fields required' }, { status: 400 })
  }
  const { rows: existing } = await pool.query(
    'SELECT id FROM leave_types WHERE name_en = $1 OR name_ar = $2',
    [name_en, name_ar]
  )
  if (existing.length > 0) {
    return NextResponse.json({ error: 'Leave type already exists' }, { status: 409 })
  }
  const { rows } = await pool.query(
    'INSERT INTO leave_types (name_ar, name_en, color) VALUES ($1, $2, $3) RETURNING *',
    [name_ar, name_en, color]
  )
  return NextResponse.json(rows[0])
}
