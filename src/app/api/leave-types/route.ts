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
  const { rows } = await pool.query(
    'INSERT INTO leave_types (name_ar, name_en, color) VALUES ($1, $2, $3) RETURNING *',
    [name_ar, name_en, color]
  )
  return NextResponse.json(rows[0])
}
