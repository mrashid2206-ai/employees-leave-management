import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { changedFields, formatChanges } from '@/lib/audit-diff'
import { parseBody } from '@/server/validation'
import { departmentUpdateSchema } from '@/server/schemas'

const COLS = 'id, name, created_at, work_start_time::text AS work_start_time, work_days, work_hours_per_day'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const valid = parseBody(departmentUpdateSchema, await request.json())
  if (!valid.ok) return valid.response
  const body = valid.data

  // Name plus the optional per-department work schedule. A NULL schedule field means
  // "inherit the global setting", which is why empty values are stored as NULL.
  const allowed = ['name', 'work_start_time', 'work_days', 'work_hours_per_day']
  const fields = Object.keys(body).filter(k => allowed.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  const values = fields.map(f => {
    const v = body[f]
    if (f === 'name') return v
    return v === '' || v === undefined ? null : v
  })

  // A department's schedule decides who counts as late or absent (and so what is deducted)
  // for everyone in it, hence the old→new values in the audit entry.
  const { rows: old } = await pool.query(`SELECT ${COLS} FROM departments WHERE id = $1`, [id])
  if (old.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { rows } = await pool.query(
    `UPDATE departments SET ${sets} WHERE id = $1 RETURNING ${COLS}`,
    [id, ...values]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const changes = changedFields(old[0], rows[0], fields)
  if (changes.length > 0) {
    await logAudit('department_updated', admin.username, 'admin', `Department #${id} (${old[0].name}): ${formatChanges(changes)}`)
  }
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  // Count ALL employees (including soft-deleted/inactive) — they keep their FK to the
  // department, so an inactive-only department would otherwise hit a raw FK 500.
  const { rows: emps } = await pool.query('SELECT COUNT(*) as cnt FROM employees WHERE department_id = $1', [id])
  if (parseInt(emps[0].cnt) > 0) {
    return NextResponse.json({ error: 'لا يمكن حذف قسم يحتوي على موظفين' }, { status: 400 })
  }
  let deleted: { name: string }[]
  try {
    ({ rows: deleted } = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING name', [id]))
  } catch {
    // Foreign-key violation (referenced elsewhere) — surface a friendly 409, not a 500.
    return NextResponse.json({ error: 'لا يمكن حذف قسم يحتوي على موظفين' }, { status: 409 })
  }
  if (deleted.length > 0) {
    await logAudit('department_deleted', admin.username, 'admin', `Deleted department #${id} "${deleted[0].name}"`)
  }
  return NextResponse.json({ success: true })
}
