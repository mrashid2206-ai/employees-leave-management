import { NextResponse } from 'next/server'
import pool, { omanToday } from '@/lib/db'
import { verifyAdmin, verifyAnyAuth, unauthorized } from '@/lib/api-auth'

// Count all calendar days (weekends included — company policy), minus public holidays
async function countLeaveDays(startDate: string, endDate: string): Promise<number> {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const totalCalendarDays = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1

  // Subtract holidays in range
  const { rows: holidays } = await pool.query(
    'SELECT COUNT(*) as cnt FROM holidays WHERE date >= $1 AND date <= $2',
    [startDate, endDate]
  )
  const holidayCount = parseInt(holidays[0]?.cnt || '0')

  return Math.max(1, totalCalendarDays - holidayCount)
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

  // Block leave requests in the past
  const today = omanToday()
  if (end_date < today && user.role !== 'admin') {
    return NextResponse.json({ error: 'Cannot create leave for past dates' }, { status: 400 })
  }

  // Block leave outside fiscal year
  const { rows: settingsRows } = await pool.query('SELECT year_start::text as year_start, year_end::text as year_end FROM settings LIMIT 1')
  if (settingsRows[0]) {
    const { year_start, year_end } = settingsRows[0]
    if (start_date < year_start || end_date > year_end) {
      return NextResponse.json({ error: 'Leave dates must be within the fiscal year (' + year_start + ' to ' + year_end + ')' }, { status: 400 })
    }
  }

  // Check department max absent — block employees, warn admin (admin can override with force flag)
  const { rows: empInfo } = await pool.query('SELECT department_id FROM employees WHERE id = $1', [employee_id])
  if (empInfo[0]) {
    const { rows: maxAbsentSettings } = await pool.query('SELECT max_absent_same_dept FROM settings LIMIT 1')
    const maxAbsent = maxAbsentSettings[0]?.max_absent_same_dept || 2

    const { rows: deptAbsent } = await pool.query(
      "SELECT COUNT(DISTINCT employee_id) as cnt FROM leave_requests WHERE employee_id != $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $3 AND employee_id IN (SELECT id FROM employees WHERE department_id = $4 AND is_active = true)",
      [employee_id, end_date, start_date, empInfo[0].department_id]
    )
    if (parseInt(deptAbsent[0].cnt) >= maxAbsent) {
      // Employees are blocked, admins can override with force flag
      if (user.role === 'employee') {
        return NextResponse.json({ error: 'Maximum department absence limit reached for these dates' }, { status: 409 })
      }
      // Admin gets warning unless they explicitly force
      if (!body.force) {
        return NextResponse.json({
          error: `Warning: ${deptAbsent[0].cnt}/${maxAbsent} employees from this department already on leave. Submit again to override.`,
          warning: true,
          absentCount: parseInt(deptAbsent[0].cnt),
          maxAbsent,
        }, { status: 409 })
      }
    }
  }

  // Server-side: calculate actual working days (excludes weekends + holidays)
  const actualDays = await countLeaveDays(start_date, end_date)
  if (actualDays <= 0) {
    return NextResponse.json({ error: 'No working days in selected range' }, { status: 400 })
  }

  // Half-day support: if half-day selected and single day, use 0.5
  const finalDays = is_half_day && start_date === end_date ? 0.5 : actualDays

  // Leave type limits
  if (settingsRows[0]) {
    const { year_start, year_end } = settingsRows[0]

    // Emergency leave: max 5 per fiscal year (leave_type_id 3)
    if (leave_type_id === 3) {
      const { rows: emergencyCount } = await pool.query(
        "SELECT COUNT(*) as cnt FROM leave_requests WHERE employee_id = $1 AND leave_type_id = 3 AND status IN ('approved', 'pending') AND start_date >= $2 AND end_date <= $3",
        [employee_id, year_start, year_end]
      )
      if (parseInt(emergencyCount[0].cnt) >= 5) {
        return NextResponse.json({ error: 'Emergency leave limit reached (maximum 5 per year)' }, { status: 400 })
      }
    }

    // Sick leave > 3 days requires notes
    if (leave_type_id === 2 && actualDays > 3 && !notes) {
      return NextResponse.json({ error: 'Sick leave over 3 days requires notes (e.g. medical certificate reference)' }, { status: 400 })
    }
  }

  // Max consecutive leave days (30 days max)
  const maxConsecutive = 30
  if (actualDays > maxConsecutive) {
    return NextResponse.json({ error: `Maximum consecutive leave is ${maxConsecutive} working days` }, { status: 400 })
  }

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
