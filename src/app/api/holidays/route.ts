import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  const { rows } = await pool.query('SELECT id, name, date::text as date, created_at FROM holidays ORDER BY date')
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const { name, date } = await request.json()
  if (!name || !date) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const { rows } = await pool.query(
    'INSERT INTO holidays (name, date) VALUES ($1, $2) RETURNING *',
    [name, date]
  )
  return NextResponse.json(rows[0])
}
