import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { searchParams } = new URL(request.url)
  const employeeId = searchParams.get('employee_id')
  const date = searchParams.get('date')

  let query = 'SELECT p.*, json_build_object(\'id\', e.id, \'name\', e.name) as employee FROM permissions p LEFT JOIN employees e ON p.employee_id = e.id'
  const conditions: string[] = []
  const params: (string | number)[] = []

  if (employeeId) {
    params.push(employeeId)
    conditions.push(`p.employee_id = $${params.length}`)
  }
  if (date) {
    params.push(date)
    conditions.push(`p.date = $${params.length}`)
  }

  // Employees can only see their own
  if (user.role === 'employee') {
    params.push(user.id as number)
    conditions.push(`p.employee_id = $${params.length}`)
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
  query += ' ORDER BY p.created_at DESC'

  const { rows } = await pool.query(query, params)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { employee_id, date, leave_time, reason } = await request.json()

  if (!employee_id || !date || !leave_time) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Employees can only create for themselves
  if (user.role === 'employee' && user.id !== employee_id) return forbidden()

  const status = user.role === 'admin' ? 'approved' : 'pending'

  const { rows } = await pool.query(
    'INSERT INTO permissions (employee_id, date, leave_time, reason, status, approved_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
    [employee_id, date, leave_time, reason || null, status, user.role === 'admin' ? user.username : null]
  )

  return NextResponse.json(rows[0])
}
