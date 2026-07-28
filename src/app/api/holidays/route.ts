import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { holidaySchema } from '@/server/schemas'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query('SELECT id, name, date::text as date, created_at FROM holidays ORDER BY date')
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const valid = parseBody(holidaySchema, await request.json())
  if (!valid.ok) return valid.response
  const { name, date } = valid.data

  const { rows } = await pool.query(
    'INSERT INTO holidays (name, date) VALUES ($1, $2) RETURNING *',
    [name, date]
  )
  return NextResponse.json(rows[0])
}
