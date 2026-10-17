import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { parseBody, parseDateRange, rangeConditions } from '@/server/validation'
import { leaveCreateSchema } from '@/server/schemas'
import { respond } from '@/server/result'
import { createLeave } from '@/server/services/leave-service'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  // Optional ?from=&to= on start_date. A request never straddles two leave years (the
  // server refuses those), so a report asks for one year with its start and end.
  const range = parseDateRange(new URL(request.url).searchParams)
  if (!range.ok) return range.response
  const params: unknown[] = []
  const inRange = rangeConditions('lr.start_date', range.data, params)

  // Employees call this for the "who's on leave?" panel, so they get approved leave only,
  // with just enough to show who is away and when. Notes (which carry medical details for
  // sick leave) and pending/rejected requests are other people's business. An employee's
  // own requests, notes included, come from /api/leaves/my-requests.
  if (user.role === 'employee') {
    const where = ["lr.status = 'approved'", 'e.is_active = true', ...inRange].join(' AND ')
    const { rows } = await pool.query(`
      SELECT lr.id, lr.start_date::text as start_date, lr.end_date::text as end_date,
        lr.days_count::float8 as days_count, lr.status,
        json_build_object('name', e.name) as employee,
        json_build_object('name_ar', lt.name_ar, 'name_en', lt.name_en, 'color', lt.color) as leave_type
      FROM leave_requests lr
      JOIN employees e ON lr.employee_id = e.id
      LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
      WHERE ${where}
      ORDER BY lr.start_date DESC
    `, params)
    return NextResponse.json(rows)
  }

  const { rows } = await pool.query(`
    SELECT lr.id, lr.employee_id, lr.leave_type_id,
      lr.start_date::text as start_date, lr.end_date::text as end_date,
      lr.days_count::float8 as days_count, lr.notes, lr.status, lr.created_at, lr.updated_at,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee,
      json_build_object('id', lt.id, 'name_ar', lt.name_ar, 'name_en', lt.name_en, 'color', lt.color) as leave_type
    FROM leave_requests lr
    LEFT JOIN employees e ON lr.employee_id = e.id
    LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
    ${inRange.length > 0 ? `WHERE ${inRange.join(' AND ')}` : ''}
    ORDER BY lr.created_at DESC
  `, params)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const valid = parseBody(leaveCreateSchema, await request.json())
  if (!valid.ok) return valid.response

  return respond(await createLeave(valid.data, user))
}
