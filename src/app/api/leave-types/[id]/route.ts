import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { changedFields, formatChanges } from '@/lib/audit-diff'
import { parseBody } from '@/server/validation'
import { leaveTypeSchema } from '@/server/schemas'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const valid = parseBody(leaveTypeSchema, await request.json())
  if (!valid.ok) return valid.response
  const { name_ar, name_en, color } = valid.data
  const { rows: old } = await pool.query('SELECT * FROM leave_types WHERE id = $1', [id])
  if (old.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const { rows } = await pool.query(
    'UPDATE leave_types SET name_ar = $1, name_en = $2, color = $3 WHERE id = $4 RETURNING *',
    [name_ar, name_en, color, id]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Sick and emergency rules are keyed on the type's name (see LEAVE_TYPE_SICK), so a
  // rename can change how future requests of that type are charged.
  const changes = changedFields(old[0], rows[0], ['name_en', 'name_ar', 'color'])
  if (changes.length > 0) {
    await logAudit('leave_type_updated', admin.username, 'admin', `Leave type #${id} (${old[0].name_en}): ${formatChanges(changes)}`)
  }
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const { rows: used } = await pool.query('SELECT COUNT(*) as cnt FROM leave_requests WHERE leave_type_id = $1', [id])
  if (parseInt(used[0].cnt) > 0) {
    return NextResponse.json({ error: 'Cannot delete: leave type is in use' }, { status: 400 })
  }
  const { rows: deleted } = await pool.query('DELETE FROM leave_types WHERE id = $1 RETURNING name_en, name_ar', [id])
  if (deleted.length > 0) {
    await logAudit('leave_type_deleted', admin.username, 'admin', `Deleted leave type #${id} "${deleted[0].name_en}" / "${deleted[0].name_ar}"`)
  }
  return NextResponse.json({ success: true })
}
