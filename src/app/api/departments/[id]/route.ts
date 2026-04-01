import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  const { name } = await request.json()
  const { rows } = await pool.query(
    'UPDATE departments SET name = $1 WHERE id = $2 RETURNING *',
    [name, id]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { id } = await params
  // Check if department has employees
  const { rows: emps } = await pool.query('SELECT COUNT(*) as cnt FROM employees WHERE department_id = $1 AND is_active = true', [id])
  if (parseInt(emps[0].cnt) > 0) {
    return NextResponse.json({ error: 'لا يمكن حذف قسم يحتوي على موظفين' }, { status: 400 })
  }
  await pool.query('DELETE FROM departments WHERE id = $1', [id])
  return NextResponse.json({ success: true })
}
