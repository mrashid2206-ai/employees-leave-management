import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query(`
    SELECT e.id, e.name, e.department_id, e.leave_balance, e.is_active, e.username, e.created_at, e.updated_at, json_build_object('id', d.id, 'name', d.name) as department
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    ORDER BY e.id
  `)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const body = await request.json()
  const { name, department_id, leave_balance, join_date } = body

  if (!name || !department_id) {
    return NextResponse.json({ error: 'Name and department are required' }, { status: 400 })
  }

  let username = name.toLowerCase().replace(/\s+/g, '.').replace(/'/g, '')

  // Ensure unique username
  const { rows: existing } = await pool.query('SELECT id FROM employees WHERE username = $1', [username])
  if (existing.length > 0) {
    username = `${username}.${Date.now().toString(36).slice(-4)}`
  }

  // Calculate pro-rated leave balance if join_date is provided
  let finalBalance = leave_balance || 30
  if (join_date) {
    const { rows: settings } = await pool.query('SELECT annual_leave_balance, year_end::text as year_end FROM settings LIMIT 1')
    if (settings[0]) {
      const joinDate = new Date(join_date)
      const yearEnd = new Date(settings[0].year_end)
      const remainingMonths = Math.max(0, Math.ceil((yearEnd.getTime() - joinDate.getTime()) / (30 * 24 * 60 * 60 * 1000)))
      finalBalance = Math.round((settings[0].annual_leave_balance / 12) * remainingMonths)
    }
  }

  const hashedPassword = await bcrypt.hash('123456', 10)

  // Ensure join_date column exists
  await pool.query('ALTER TABLE employees ADD COLUMN IF NOT EXISTS join_date DATE').catch(() => {})

  if (join_date) {
    const { rows } = await pool.query(`
      INSERT INTO employees (name, department_id, leave_balance, username, password_hash, join_date)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, department_id, finalBalance, username, hashedPassword, join_date])
    return NextResponse.json(rows[0])
  }

  const { rows } = await pool.query(`
    INSERT INTO employees (name, department_id, leave_balance, username, password_hash)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [name, department_id, finalBalance, username, hashedPassword])

  return NextResponse.json(rows[0])
}
