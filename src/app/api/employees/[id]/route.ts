import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { rows } = await pool.query(`
    SELECT e.id, e.name, e.department_id, e.leave_balance, e.is_active, e.username, e.created_at, e.updated_at, json_build_object('id', d.id, 'name', d.name) as department
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    WHERE e.id = $1
  `, [id])
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await request.json()
  const allowedFields = ['name', 'department_id', 'leave_balance', 'is_active', 'username', 'password_hash']
  const fields = Object.keys(body).filter(k => allowedFields.includes(k))
  if (fields.length === 0) return NextResponse.json({ error: 'No fields' }, { status: 400 })

  const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
  const values = [id, ...fields.map(f => body[f])]

  const { rows } = await pool.query(
    `UPDATE employees SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING *`,
    values
  )
  return NextResponse.json(rows[0])
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Soft delete - set is_active to false
  const { rows } = await pool.query(
    'UPDATE employees SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *',
    [id]
  )
  if (rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ success: true })
}
