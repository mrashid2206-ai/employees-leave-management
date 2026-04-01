import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const body = await request.json()
  const allowedFields = ['check_in', 'check_out', 'work_hours', 'overtime_hours', 'status', 'notes', 'is_holiday_work', 'excused_tardiness']
  const fields = Object.keys(body).filter(k => allowedFields.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  const values = [id, ...fields.map(f => body[f])]

  const { rows } = await pool.query(
    `UPDATE attendance SET ${sets} WHERE id = $1 RETURNING *`,
    values
  )
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  await pool.query('DELETE FROM attendance WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
