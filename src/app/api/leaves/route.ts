import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query(`
    SELECT lr.id, lr.employee_id, lr.leave_type_id,
      lr.start_date::text as start_date, lr.end_date::text as end_date,
      lr.days_count, lr.notes, lr.status, lr.created_at, lr.updated_at,
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
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const body = await request.json()
  const { employee_id, leave_type_id, start_date, end_date, days_count, notes } = body

  if (!employee_id || !leave_type_id || !start_date || !end_date || !days_count) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }
  if (new Date(end_date) < new Date(start_date)) {
    return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
  }
  if (days_count <= 0) {
    return NextResponse.json({ error: 'Days count must be positive' }, { status: 400 })
  }

  try {
    const { rows } = await pool.query(`
      INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [employee_id, leave_type_id, start_date, end_date, days_count, notes || null, body.status || 'pending'])

    return NextResponse.json(rows[0])
  } catch (err: any) {
    if (err.message?.includes('Overlapping')) {
      return NextResponse.json({ error: 'Overlapping leave request exists for this employee' }, { status: 409 })
    }
    throw err
  }
}
