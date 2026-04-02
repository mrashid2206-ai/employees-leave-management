import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  // Ensure table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employee_notifications (
      id SERIAL PRIMARY KEY,
      employee_id INT NOT NULL,
      message TEXT NOT NULL,
      message_ar TEXT,
      is_read BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {})

  const empId = user.role === 'employee' ? user.id : new URL(request.url).searchParams.get('employee_id')
  if (user.role === 'employee' && String(user.id) !== String(empId)) return forbidden()

  const { rows } = await pool.query(
    'SELECT * FROM employee_notifications WHERE employee_id = $1 ORDER BY created_at DESC LIMIT 20',
    [empId]
  )
  return NextResponse.json(rows)
}

// Mark as read
export async function PUT(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { id } = await request.json()
  await pool.query(
    'UPDATE employee_notifications SET is_read = true WHERE id = $1 AND employee_id = $2',
    [id, user.id]
  )
  return NextResponse.json({ success: true })
}
