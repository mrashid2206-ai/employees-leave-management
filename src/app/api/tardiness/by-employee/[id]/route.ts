import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { rows } = await pool.query(`
    SELECT id, employee_id, date::text as date, time::text as time,
      minutes_late, hours_late_decimal, notes, created_at, updated_at
    FROM tardiness_log WHERE employee_id = $1 ORDER BY date DESC
  `, [id])
  return NextResponse.json(rows)
}
