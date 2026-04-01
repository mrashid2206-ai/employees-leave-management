import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { searchParams } = new URL(request.url)
  const employeeId = searchParams.get('employee_id')

  if (user.role === 'employee' && String(user.id) !== employeeId) return forbidden()

  if (!employeeId) return NextResponse.json({ error: 'Missing employee_id' }, { status: 400 })

  const { rows } = await pool.query(`
    SELECT lr.id, lr.employee_id, lr.leave_type_id,
      lr.start_date::text as start_date, lr.end_date::text as end_date,
      lr.days_count, lr.notes, lr.status, lr.created_at, lr.updated_at,
      json_build_object('id', lt.id, 'name_ar', lt.name_ar, 'name_en', lt.name_en, 'color', lt.color) as leave_type
    FROM leave_requests lr
    LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
    WHERE lr.employee_id = $1
    ORDER BY lr.created_at DESC
  `, [employeeId])

  return NextResponse.json(rows)
}
