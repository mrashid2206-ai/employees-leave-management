import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'

export async function GET() {
  const { rows } = await pool.query(`
    SELECT e.id, e.name, e.department_id, e.leave_balance, e.is_active, e.username, e.created_at, e.updated_at, json_build_object('id', d.id, 'name', d.name) as department
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    ORDER BY e.id
  `)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const body = await request.json()
  const { name, department_id, leave_balance } = body

  if (!name || !department_id) {
    return NextResponse.json({ error: 'Name and department are required' }, { status: 400 })
  }

  const username = name.toLowerCase().replace(/\s+/g, '.').replace(/'/g, '')

  const hashedPassword = await bcrypt.hash('123456', 10)

  const { rows } = await pool.query(`
    INSERT INTO employees (name, department_id, leave_balance, username, password_hash)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [name, department_id, leave_balance || 30, username, hashedPassword])

  return NextResponse.json(rows[0])
}
