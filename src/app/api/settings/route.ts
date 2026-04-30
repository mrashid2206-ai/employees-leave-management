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
    ADD COLUMN IF NOT EXISTS office_ip VARCHAR(100),
    ADD COLUMN IF NOT EXISTS block_offsite_checkin BOOLEAN DEFAULT FALSE
  `).catch(() => {})

  const { rows } = await pool.query('SELECT id, year_start::text as year_start, year_end::text as year_end, annual_leave_balance, deduction_per_hour, currency, currency_symbol, work_hours_per_day, max_absent_same_dept, work_start_time::text as work_start_time, work_days, office_lat, office_lng, office_radius, office_ip, block_offsite_checkin FROM settings LIMIT 1')
  if (!rows[0]) {
    // Create default settings
    const { rows: newSettings } = await pool.query(`
      INSERT INTO settings (year_start, year_end, annual_leave_balance, deduction_per_hour, currency, currency_symbol, work_hours_per_day, max_absent_same_dept, work_start_time, work_days)
      VALUES ('2026-03-01', '2027-02-28', 30, 0, 'OMR', 'ر.ع.', 8, 2, '07:30', '0,1,2,3,4')
      RETURNING *
    `)
    return NextResponse.json(newSettings[0])
  }
  return NextResponse.json(rows[0])
}

export async function PUT(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const body = await request.json()
  const fields = Object.keys(body).filter(k => k !== 'id')
  const allowedFields = ['year_start', 'year_end', 'annual_leave_balance', 'deduction_per_hour', 'currency', 'currency_symbol', 'work_hours_per_day', 'max_absent_same_dept', 'work_start_time', 'work_days', 'office_lat', 'office_lng', 'office_radius', 'office_ip', 'block_offsite_checkin']
  const safeFields = fields.filter(f => allowedFields.includes(f))
  if (safeFields.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  if (body.year_start && body.year_end) {
    if (new Date(body.year_end) <= new Date(body.year_start)) {
      return NextResponse.json({ error: 'Year end must be after year start' }, { status: 400 })
    }
  }

  const sets = safeFields.map((f, i) => `${f} = $${i + 1}`).join(', ')
  const values = safeFields.map(f => body[f])

  const { rows } = await pool.query(
    `UPDATE settings SET ${sets} WHERE id = 1 RETURNING *`,
    values
  )
  return NextResponse.json(rows[0])
}
