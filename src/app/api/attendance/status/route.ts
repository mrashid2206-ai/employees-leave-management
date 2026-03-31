import { NextResponse } from 'next/server'
import pool, { omanToday } from '@/lib/db'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const employeeId = searchParams.get('employee_id')

  if (!employeeId) return NextResponse.json({ error: 'Missing employee_id' }, { status: 400 })

  const today = omanToday()
  const { rows } = await pool.query(
    'SELECT id, date::text as date, check_in::text as check_in, check_out::text as check_out, work_hours, overtime_hours, status, is_holiday_work FROM attendance WHERE employee_id = $1 AND date = $2',
    [employeeId, today]
  )

  return NextResponse.json(rows[0] || null)
}
