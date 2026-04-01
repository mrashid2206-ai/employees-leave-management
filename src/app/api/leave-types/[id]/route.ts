import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const { name_ar, name_en, color } = await request.json()
  const { rows } = await pool.query(
    'UPDATE leave_types SET name_ar = $1, name_en = $2, color = $3 WHERE id = $4 RETURNING *',
    [name_ar, name_en, color, id]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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
  await pool.query('DELETE FROM leave_types WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
