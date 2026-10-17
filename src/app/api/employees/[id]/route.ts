import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, verifyAdmin, unauthorized, forbidden } from '@/lib/api-auth'
import { respond } from '@/server/result'
import { updateEmployee, setEmployeeActive } from '@/server/services/employee-service'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params
  if (user.role === 'employee' && String(user.id) !== id) return forbidden()


  const { rows } = await pool.query(`
    SELECT e.id, e.name, e.department_id, e.leave_balance::float8 as leave_balance, e.is_active, e.username, e.join_date::text as join_date, e.email, e.phone, e.position, e.created_at, e.updated_at,
      e.work_start_time::text as work_start_time, e.work_days, e.work_hours_per_day,
      json_build_object('id', d.id, 'name', d.name,
        'work_start_time', d.work_start_time::text, 'work_days', d.work_days, 'work_hours_per_day', d.work_hours_per_day) as department
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE e.id = $1
  `, [id])
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const body = await request.json()
  // Field whitelist, the balance-reason rule and deactivation all live in the service, so
  // the list's on/off toggle and DELETE can't drift apart again.
  return respond(await updateEmployee(id, body, admin))
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  // Soft delete: the row stays for history; see setEmployeeActive for what deactivation does.
  return respond(await setEmployeeActive(id, false, admin))
}
