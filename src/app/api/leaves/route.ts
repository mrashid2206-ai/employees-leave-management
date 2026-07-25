import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { leaveCreateSchema } from '@/server/schemas'
import { respond } from '@/server/result'
import { createLeave } from '@/server/services/leave-service'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query(`
    SELECT lr.id, lr.employee_id, lr.leave_type_id,
      lr.start_date::text as start_date, lr.end_date::text as end_date,
      lr.days_count::float8 as days_count, lr.notes, lr.status, lr.created_at, lr.updated_at,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee,
      json_build_object('id', lt.id, 'name_ar', lt.name_ar, 'name_en', lt.name_en, 'color', lt.color) as leave_type
    FROM leave_requests lr
    LEFT JOIN employees e ON lr.employee_id = e.id
    LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
    ORDER BY lr.created_at DESC
  `)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const valid = parseBody(leaveCreateSchema, await request.json())
  if (!valid.ok) return valid.response

  return respond(await createLeave(valid.data, user))
}
