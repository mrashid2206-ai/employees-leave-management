import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { parseBody } from '@/server/validation'
import { settingsUpdateSchema } from '@/server/schemas'

const SELECT_COLS = `id, year_start::text as year_start, year_end::text as year_end, annual_leave_balance, work_hours_per_day, max_absent_same_dept, work_start_time::text as work_start_time, work_days, office_lat, office_lng, office_radius, office_ip, block_offsite_checkin, deduct_permission_hours, max_permissions_per_month, max_permission_minutes`

// Fields that must be positive numbers (guards report math against 0/NaN/divide-by-zero).
const POSITIVE_INT_FIELDS = ['annual_leave_balance', 'work_hours_per_day', 'max_absent_same_dept']
const NON_NEGATIVE_FIELDS = ['office_radius']

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()


  const { rows } = await pool.query(`SELECT ${SELECT_COLS} FROM settings ORDER BY id LIMIT 1`)
  if (!rows[0]) {
    // Create the default singleton row (id forced to 1).
    const { rows: newSettings } = await pool.query(`
      INSERT INTO settings (id, year_start, year_end, annual_leave_balance, work_hours_per_day, max_absent_same_dept, work_start_time, work_days)
      VALUES (1, '2026-03-01', '2027-02-28', 30, 8, 2, '07:30', '0,1,2,3,4')
      ON CONFLICT (id) DO NOTHING
      RETURNING ${SELECT_COLS}
    `)
    if (newSettings[0]) return NextResponse.json(newSettings[0])
    // Race: another request created it first — read it back.
    const { rows: again } = await pool.query(`SELECT ${SELECT_COLS} FROM settings ORDER BY id LIMIT 1`)
    return NextResponse.json(again[0])
  }
  return NextResponse.json(rows[0])
}

export async function PUT(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const valid = parseBody(settingsUpdateSchema, await request.json())
  if (!valid.ok) return valid.response
  const body = valid.data as Record<string, unknown>
  const fields = Object.keys(body).filter(k => k !== 'id')
  const allowedFields = ['year_start', 'year_end', 'annual_leave_balance', 'work_hours_per_day', 'max_absent_same_dept', 'work_start_time', 'work_days', 'office_lat', 'office_lng', 'office_radius', 'office_ip', 'block_offsite_checkin', 'deduct_permission_hours', 'max_permissions_per_month', 'max_permission_minutes']
  const safeFields = fields.filter(f => allowedFields.includes(f))
  if (safeFields.length === 0) return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  if (body.year_start && body.year_end) {
    // Both are validated as YYYY-MM-DD strings by the schema, so a plain string compare
    // orders them correctly without constructing Dates.
    if (String(body.year_end) <= String(body.year_start)) {
      return NextResponse.json({ error: 'Year end must be after year start' }, { status: 400 })
    }
  }
  for (const f of POSITIVE_INT_FIELDS) {
    if (f in body && (!(Number(body[f]) > 0))) {
      return NextResponse.json({ error: `${f} must be a positive number` }, { status: 400 })
    }
  }
  for (const f of NON_NEGATIVE_FIELDS) {
    if (f in body && Number(body[f]) < 0) {
      return NextResponse.json({ error: `${f} cannot be negative` }, { status: 400 })
    }
  }

  const sets = safeFields.map((f, i) => `${f} = $${i + 1}`).join(', ')
  const values = safeFields.map(f => body[f])

  // Target the actual singleton row (lowest id) rather than a hardcoded id = 1, and
  // fail loudly if nothing was updated instead of silently returning null.
  const { rows } = await pool.query(
    `UPDATE settings SET ${sets} WHERE id = (SELECT id FROM settings ORDER BY id LIMIT 1) RETURNING ${SELECT_COLS}`,
    values
  )
  if (!rows[0]) {
    return NextResponse.json({ error: 'Settings row not found' }, { status: 500 })
  }
  return NextResponse.json(rows[0])
}
