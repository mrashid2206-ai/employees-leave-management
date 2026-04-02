import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  // Ensure location columns exist
  await pool.query(`
    ALTER TABLE settings ADD COLUMN IF NOT EXISTS office_lat DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS office_lng DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS office_radius INT DEFAULT 200,
    ADD COLUMN IF NOT EXISTS office_ip VARCHAR(100)
  `).catch(() => {})

  const { rows } = await pool.query('SELECT id, year_start::text as year_start, year_end::text as year_end, annual_leave_balance, deduction_per_hour, currency, currency_symbol, work_hours_per_day, max_absent_same_dept, work_start_time::text as work_start_time, work_days, office_lat, office_lng, office_radius, office_ip FROM settings LIMIT 1')
  return NextResponse.json(rows[0] || null)
}

export async function PUT(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const body = await request.json()
  const fields = Object.keys(body).filter(k => k !== 'id')
  const allowedFields = ['year_start', 'year_end', 'annual_leave_balance', 'deduction_per_hour', 'currency', 'currency_symbol', 'work_hours_per_day', 'max_absent_same_dept', 'work_start_time', 'work_days', 'office_lat', 'office_lng', 'office_radius', 'office_ip']
  const safeFields = fields.filter(f => allowedFields.includes(f))
  if (safeFields.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const sets = safeFields.map((f, i) => `${f} = $${i + 1}`).join(', ')
  const values = safeFields.map(f => body[f])

  const { rows } = await pool.query(
    `UPDATE settings SET ${sets} WHERE id = 1 RETURNING *`,
    values
  )
  return NextResponse.json(rows[0])
}
