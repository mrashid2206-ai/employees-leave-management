import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  // Employees may only read their own tardiness; admins see all.
  const scoped = user.role === 'employee'
  const { rows } = await pool.query(`
    SELECT t.id, t.employee_id, t.date::text as date, t.time::text as time,
      t.minutes_late, t.hours_late_decimal, t.notes, t.created_at, t.updated_at,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee
    FROM tardiness_log t
    LEFT JOIN employees e ON t.employee_id = e.id
    ${scoped ? 'WHERE t.employee_id = $1' : ''}
    ORDER BY t.date DESC, t.id DESC
  `, scoped ? [user.id] : [])
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const body = await request.json()

  // Support bulk insert (array of records)
  const records = Array.isArray(body) ? body : [body]

  for (const r of records) {
    if (!r.employee_id || !r.date || !r.time || !r.minutes_late || r.minutes_late <= 0) {
      return NextResponse.json({ error: 'Invalid tardiness record' }, { status: 400 })
    }
  }

  const values: (string | number)[] = []
  const placeholders: string[] = []

  records.forEach((r, i) => {
    const offset = i * 5
    // hours late = minutes / 60 (matches the automation path; was wrongly /1440 = per-day)
    const hours_late_decimal = Math.round((r.minutes_late / 60) * 100000) / 100000
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5})`)
    values.push(r.employee_id, r.date, r.time, r.minutes_late, hours_late_decimal)
  })

  const { rows } = await pool.query(`
    INSERT INTO tardiness_log (employee_id, date, time, minutes_late, hours_late_decimal)
    VALUES ${placeholders.join(', ')}
    RETURNING *
  `, values)

  return NextResponse.json(rows)
}
