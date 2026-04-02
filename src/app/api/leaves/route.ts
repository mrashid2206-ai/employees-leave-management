import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

async function countWorkingDays(startDate: string, endDate: string): Promise<number> {
  // Get work days from settings
  const { rows: settingsRows } = await pool.query('SELECT work_days FROM settings LIMIT 1')
  const workDays = settingsRows[0]?.work_days?.split(',').map(Number) || [0,1,2,3,4]

  // Get holidays in range
  const { rows: holidays } = await pool.query(
    'SELECT date::text as date FROM holidays WHERE date >= $1 AND date <= $2',
    [startDate, endDate]
  )
  const holidaySet = new Set(holidays.map(h => h.date))

  let count = 0
  const start = new Date(startDate)
  const end = new Date(endDate)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay()
    const dateStr = d.toISOString().split('T')[0]
    if (workDays.includes(dayOfWeek) && !holidaySet.has(dateStr)) {
      count++
    }
  }
  return count
}

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query(`
    SELECT lr.id, lr.employee_id, lr.leave_type_id,
      lr.start_date::text as start_date, lr.end_date::text as end_date,
      lr.days_count, lr.notes, lr.status, lr.created_at, lr.updated_at,
      json_build_object('id', e.id, 'name', e.name, 'department_id', e.department_id) as employee,
      json_build_object('id', lt.id, 'name_ar', lt.name_ar, 'name_en', lt.name_en, 'color', lt.color) as leave_type
    FROM leave_requests lr
    LEFT JOIN employees e ON lr.employee_id = e.id
    LEFT JOIN leave_types lt ON lr.leave_type_id = lt.id
    ORDER BY lr.created_at DESC
  `)
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const body = await request.json()
  const { employee_id, leave_type_id, start_date, end_date, days_count, notes, is_half_day } = body

  if (!employee_id || !leave_type_id || !start_date || !end_date || !days_count) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Employees can only create leaves for themselves, always as pending
  if (user.role === 'employee') {
    if (user.id !== employee_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    body.status = 'pending'
  }
  if (new Date(end_date) < new Date(start_date)) {
    return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
  }

  // Server-side: calculate actual working days (excludes weekends + holidays)
  const actualDays = await countWorkingDays(start_date, end_date)
  if (actualDays <= 0) {
    return NextResponse.json({ error: 'No working days in selected range' }, { status: 400 })
  }

  // Half-day support: if half-day selected and single day, use 0.5
  const finalDays = is_half_day && start_date === end_date ? 0.5 : actualDays

  // Check for attendance conflict
  const { rows: attendanceConflicts } = await pool.query(
    "SELECT date::text as date FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3 AND status = 'present' AND check_in IS NOT NULL",
    [employee_id, start_date, end_date]
  )
  if (attendanceConflicts.length > 0) {
    const dates = attendanceConflicts.map(r => r.date).join(', ')
    return NextResponse.json({
      error: `Employee has attendance records on: ${dates}. Cancel or delete those attendance records first.`
    }, { status: 409 })
  }

  // Check for duplicate/overlapping pending or approved leave
  const { rows: existingLeaves } = await pool.query(
    "SELECT id FROM leave_requests WHERE employee_id = $1 AND status IN ('pending', 'approved') AND start_date <= $2 AND end_date >= $3",
    [employee_id, end_date, start_date]
  )
  if (existingLeaves.length > 0) {
    return NextResponse.json({ error: 'Employee already has a pending or approved leave for these dates' }, { status: 409 })
  }

  try {
    const { rows } = await pool.query(`
      INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `, [employee_id, leave_type_id, start_date, end_date, finalDays, notes || null, body.status || 'pending'])

    return NextResponse.json(rows[0])
  } catch (err: any) {
    if (err.message?.includes('Overlapping')) {
      return NextResponse.json({ error: 'Overlapping leave request exists for this employee' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create leave request' }, { status: 500 })
  }
}
