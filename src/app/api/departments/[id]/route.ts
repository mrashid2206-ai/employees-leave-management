import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const body = await request.json()

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

  const { rows } = await pool.query(
    `UPDATE departments SET ${sets} WHERE id = $1
     RETURNING id, name, created_at, work_start_time::text AS work_start_time, work_days, work_hours_per_day`,
    [id, ...values]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
  try {
    await pool.query('DELETE FROM departments WHERE id = $1', [id])
  } catch {
    // Foreign-key violation (referenced elsewhere) — surface a friendly 409, not a 500.
    return NextResponse.json({ error: 'لا يمكن حذف قسم يحتوي على موظفين' }, { status: 409 })
  }
  return NextResponse.json({ success: true })
}
