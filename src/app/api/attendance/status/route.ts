import { NextResponse } from 'next/server'
import pool, { omanToday } from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { searchParams } = new URL(request.url)
  const employeeId = searchParams.get('employee_id')

  if (user.role === 'employee' && String(user.id) !== employeeId) return forbidden()

  if (!employeeId) return NextResponse.json({ error: 'Missing employee_id' }, { status: 400 })

  const today = omanToday()
  const { rows } = await pool.query(
    'SELECT id, date::text as date, check_in::text as check_in, check_out::text as check_out, work_hours, overtime_hours, status, is_holiday_work FROM attendance WHERE employee_id = $1 AND date = $2',
    [employeeId, today]
  )

  return NextResponse.json(rows[0] || null)
}
