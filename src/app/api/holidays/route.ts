import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query('SELECT id, name, date::text as date, created_at FROM holidays ORDER BY date')
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { name, date } = await request.json()
  if (!name || !date) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { rows } = await pool.query(
    'INSERT INTO holidays (name, date) VALUES ($1, $2) RETURNING *',
    [name, date]
  )
  return NextResponse.json(rows[0])
}
