import { NextResponse } from 'next/server'
import pool, { omanTime } from '@/lib/db'
import { verifyAnyAuth, verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { parseBody } from '@/server/validation'
import { permissionUpdateSchema } from '@/server/schemas'

// Update permission (mark return time, or approve)
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { id } = await params
  const valid = parseBody(permissionUpdateSchema, await request.json())
  if (!valid.ok) return valid.response
  const body = valid.data

  if (body.return_time || body.returned) {
    if (user.role === 'employee') {
      // Employee marking their return — must own the permission record.
      const { rows: owner } = await pool.query('SELECT employee_id FROM permissions WHERE id = $1', [id])
      if (owner.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (owner[0].employee_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      // "I'm back" is stamped with Oman's clock, whatever time the client sent: the
      // phone's clock was being stored verbatim, and an employee could also type any
      // return time they liked. Only the first return counts, so a second tap (or a
      // replayed request) can't move it.
      await pool.query(
        'UPDATE permissions SET return_time = $1 WHERE id = $2 AND return_time IS NULL',
        [omanTime(), id]
      )
    } else {
      // Admins may set (or correct) a return time explicitly; `returned` means "now".
      await pool.query('UPDATE permissions SET return_time = $1 WHERE id = $2', [body.return_time || omanTime(), id])
    }
  }
  if (body.status) {
    // Admin approving/rejecting
    const admin = await verifyAdmin(request)
    if (!admin) return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    await pool.query('UPDATE permissions SET status = $1, approved_by = $2 WHERE id = $3', [body.status, admin.username, id])
  }

  const { rows } = await pool.query('SELECT * FROM permissions WHERE id = $1', [id])
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  // Approved permission time can be deducted from worked hours, so removing one changes
  // what an employee is credited with: keep a trace of whose, which day, and its state.
  const { rows } = await pool.query(
    'DELETE FROM permissions WHERE id = $1 RETURNING employee_id, date::text AS date, leave_time::text AS leave_time, status',
    [id]
  )
  if (rows.length > 0) {
    const p = rows[0]
    await logAudit('permission_deleted', admin.username, 'admin',
      `Deleted permission #${id} for emp ${p.employee_id} on ${p.date} at ${String(p.leave_time).slice(0, 5)} (${p.status})`)
  }
  return NextResponse.json({ success: true })
}
