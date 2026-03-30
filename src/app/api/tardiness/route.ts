import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  const { rows } = await pool.query(`
    SELECT t.id, t.employee_id, t.date::text as date, t.time::text as time,
      t.minutes_late, t.hours_late_decimal, t.notes, t.created_at, t.updated_at,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee
    FROM tardiness_log t
    LEFT JOIN employees e ON t.employee_id = e.id
    ORDER BY t.date DESC, t.id DESC
  `)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const body = await request.json()

  // Support bulk insert (array of records)
  const records = Array.isArray(body) ? body : [body]

  for (const r of records) {
    if (!r.employee_id || !r.date || !r.time || !r.minutes_late || r.minutes_late <= 0) {
      return NextResponse.json({ error: 'Invalid tardiness record' }, { status: 400 })
    }
  }

  const values: any[] = []
  const placeholders: string[] = []

  records.forEach((r, i) => {
    const offset = i * 5
    const hours_late_decimal = r.minutes_late / 1440
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
