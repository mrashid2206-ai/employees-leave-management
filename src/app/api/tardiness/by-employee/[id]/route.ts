import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { id } = await params

  if (user.role === 'employee' && String(user.id) !== id) return forbidden()
  const { rows } = await pool.query(`
    SELECT id, employee_id, date::text as date, time::text as time,
      minutes_late, hours_late_decimal, notes, created_at, updated_at
    FROM tardiness_log WHERE employee_id = $1 ORDER BY date DESC
  `, [id])
  return NextResponse.json(rows)
}
