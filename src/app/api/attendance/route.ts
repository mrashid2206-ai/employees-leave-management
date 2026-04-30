import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { searchParams } = new URL(request.url)
  const month = searchParams.get('month') // YYYY-MM format
  const employeeId = searchParams.get('employee_id')

  // Ensure location columns exist
  await pool.query(`
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_offsite BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS check_in_ip VARCHAR(100),
    ADD COLUMN IF NOT EXISTS check_in_lat DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS check_in_lng DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS excused_tardiness BOOLEAN DEFAULT FALSE
  `).catch(() => {})

  let query = `
    SELECT a.id, a.employee_id, a.date::text as date, a.check_in::text as check_in,
      a.check_out::text as check_out, a.work_hours, a.overtime_hours, a.status, a.notes, a.is_holiday_work, a.excused_tardiness, a.is_offsite, a.check_in_ip,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee
    FROM attendance a
    LEFT JOIN employees e ON a.employee_id = e.id
  `
  const conditions: string[] = []
  const params: any[] = []

  if (month) {
    const [y, m] = month.split('-').map(Number)
    const lastDay = new Date(y, m, 0).getDate()
    params.push(`${month}-01`)
    params.push(`${month}-${lastDay}`)
    conditions.push(`a.date >= $${params.length - 1} AND a.date <= $${params.length}`)
  }
  if (employeeId) {
    params.push(employeeId)
    conditions.push(`a.employee_id = $${params.length}`)
  }

  if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ')
  query += ' ORDER BY a.date DESC, a.employee_id'

  const { rows } = await pool.query(query, params)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const body = await request.json()
  const records = Array.isArray(body) ? body : [body]

  const { rows: settingsRows } = await pool.query('SELECT work_hours_per_day FROM settings LIMIT 1')
  const normalHours = settingsRows[0]?.work_hours_per_day || 8

  const results = []
  for (const r of records) {
    const workHours = r.check_in && r.check_out ? calculateWorkHours(r.check_in, r.check_out) : 0
    const overtime = Math.max(0, workHours - normalHours)

    const { rows } = await pool.query(`
      INSERT INTO attendance (employee_id, date, check_in, check_out, work_hours, overtime_hours, status, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (employee_id, date) DO UPDATE SET
        check_in = COALESCE($3, attendance.check_in),
        check_out = COALESCE($4, attendance.check_out),
        work_hours = $5,
        overtime_hours = $6,
        status = $7,
        notes = $8
      RETURNING *
    `, [r.employee_id, r.date, r.check_in || null, r.check_out || null, workHours, overtime, r.status || 'present', r.notes || null])
    results.push(rows[0])
  }

  return NextResponse.json(results)
}

function calculateWorkHours(checkIn: string, checkOut: string): number {
  const [inH, inM] = checkIn.split(':').map(Number)
  const [outH, outM] = checkOut.split(':').map(Number)
  const totalMinutes = (outH * 60 + outM) - (inH * 60 + inM)
  if (totalMinutes <= 0) return 0
  return Math.round(totalMinutes / 60 * 100) / 100
}
