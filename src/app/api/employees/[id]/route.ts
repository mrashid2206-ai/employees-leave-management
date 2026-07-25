import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, verifyAdmin, unauthorized, forbidden } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { bumpTokenVersion } from '@/lib/token-version'

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
  // password_hash is deliberately NOT updatable here. Passwords go through
  // /api/employees/[id]/reset-password, which hashes properly, enforces the length policy
  // and revokes existing sessions. Allowing a raw write here meant a plaintext value could
  // be stored as if it were a hash, silently locking the account out of every future login.
  const allowedFields = ['name', 'department_id', 'leave_balance', 'is_active', 'username', 'email', 'phone', 'position', 'join_date', 'work_start_time', 'work_days', 'work_hours_per_day']
  const fields = Object.keys(body).filter(k => allowedFields.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })

  // A cleared schedule field means "inherit the department/global schedule", i.e. NULL.
  // An empty string would otherwise blow up on the TIME/INT columns.
  const SCHEDULE_FIELDS = new Set(['work_start_time', 'work_days', 'work_hours_per_day'])
  const normalise = (field: string, value: unknown) =>
    SCHEDULE_FIELDS.has(field) && (value === '' || value === undefined) ? null : value

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  const values = [id, ...fields.map(f => normalise(f, body[f]))]

  const { rows } = await pool.query(
    `UPDATE employees SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values
  )

  // Deactivating from the edit form must end sessions too, exactly like DELETE does.
  if (body.is_active === false) await bumpTokenVersion('employee', Number(id))

  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  // Soft delete - set is_active to false
  const { rows } = await pool.query(
    'UPDATE employees SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Cancel pending leave requests
  await pool.query("UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE employee_id = $1 AND status = 'pending'", [id])

  // Offboarding must actually end access, not wait up to 12h for the JWT to expire.
  await bumpTokenVersion('employee', Number(id))

  await logAudit('employee_deactivated', admin.username, 'admin', `Deactivated employee ${id}`)

  return NextResponse.json({ success: true })
}
