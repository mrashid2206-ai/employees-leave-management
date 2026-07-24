import { NextResponse } from 'next/server'
import pool, { omanToday } from '@/lib/db'
import { verifyAnyAuth, unauthorized } from '@/lib/api-auth'
import { ensureFractionalLeaveColumns } from '@/lib/ensure-schema'
import { countLeaveDays } from '@/lib/leave-days'
import { sendMail } from '@/lib/email'
import { parseBody } from '@/server/validation'
import { leaveCreateSchema } from '@/server/schemas'
import {
  LEAVE_TYPE_EMERGENCY,
  LEAVE_TYPE_SICK,
  EMERGENCY_LEAVE_MAX_DAYS,
  SICK_LEAVE_NOTES_THRESHOLD,
  MAX_CONSECUTIVE_LEAVE_DAYS,
} from '@/lib/constants'

export async function GET(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()
  const { rows } = await pool.query(`
    SELECT lr.id, lr.employee_id, lr.leave_type_id,
      lr.start_date::text as start_date, lr.end_date::text as end_date,
      lr.days_count::float8 as days_count, lr.notes, lr.status, lr.created_at, lr.updated_at,
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
  const valid = parseBody(leaveCreateSchema, body)
  if (!valid.ok) return valid.response
  const { employee_id, leave_type_id, start_date, end_date, notes, is_half_day } = body

  // Employees can only create leaves for themselves, always as pending
  if (user.role === 'employee') {
    if (user.id !== employee_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    body.status = 'pending'
  }
  if (new Date(end_date) < new Date(start_date)) {
    return NextResponse.json({ error: 'End date must be after start date' }, { status: 400 })
  }

  // Block leave requests in the past (non-admins): neither the start nor end may be before today.
  const today = omanToday()
  if (user.role !== 'admin' && (start_date < today || end_date < today)) {
    return NextResponse.json({ error: 'Cannot create leave for past dates' }, { status: 400 })
  }

  // Settings drive fiscal-year and limit enforcement — treat a missing row as a hard
  // error rather than silently disabling all those checks.
  const { rows: settingsRows } = await pool.query(
    'SELECT year_start::text as year_start, year_end::text as year_end, max_absent_same_dept FROM settings ORDER BY id LIMIT 1'
  )
  if (!settingsRows[0]) {
    return NextResponse.json({ error: 'System settings are not configured' }, { status: 500 })
  }
  const { year_start, year_end } = settingsRows[0]
  if (start_date < year_start || end_date > year_end) {
    return NextResponse.json({ error: 'Leave dates must be within the fiscal year (' + year_start + ' to ' + year_end + ')' }, { status: 400 })
  }

  // Check department max absent — block employees, warn admin (admin can override with force flag)
  const { rows: empInfo } = await pool.query('SELECT department_id, name FROM employees WHERE id = $1', [employee_id])
  if (empInfo[0]) {
    const maxAbsent = settingsRows[0].max_absent_same_dept || 2

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

  // Server-side: calculate actual leave days (calendar days minus holidays)
  const actualDays = await countLeaveDays(start_date, end_date)
  if (actualDays <= 0) {
    return NextResponse.json({ error: 'No working days in selected range' }, { status: 400 })
  }

  // Half-day support: if half-day selected and single day, use 0.5
  const finalDays = is_half_day && start_date === end_date ? 0.5 : actualDays

  // Leave-type limits — resolve the type by its actual id (never hardcode the SERIAL).
  const { rows: ltCheck } = await pool.query('SELECT name_en FROM leave_types WHERE id = $1', [leave_type_id])
  const leaveTypeName = ltCheck[0]?.name_en || ''

  // Emergency leave: max N DAYS per fiscal year (consistent with the edit path).
  if (leaveTypeName === LEAVE_TYPE_EMERGENCY) {
    const { rows: emergencyDays } = await pool.query(
      "SELECT COALESCE(SUM(days_count), 0)::numeric as total FROM leave_requests WHERE employee_id = $1 AND leave_type_id = $2 AND status IN ('approved', 'pending') AND start_date >= $3 AND end_date <= $4",
      [employee_id, leave_type_id, year_start, year_end]
    )
    if (parseFloat(emergencyDays[0].total) + finalDays > EMERGENCY_LEAVE_MAX_DAYS) {
      return NextResponse.json({ error: `Emergency leave limit reached (maximum ${EMERGENCY_LEAVE_MAX_DAYS} days per year)` }, { status: 400 })
    }
  }

  // Sick leave over the threshold requires notes
  if (leaveTypeName === LEAVE_TYPE_SICK && actualDays > SICK_LEAVE_NOTES_THRESHOLD && !notes) {
    return NextResponse.json({ error: `Sick leave over ${SICK_LEAVE_NOTES_THRESHOLD} days requires notes (e.g. medical certificate reference)` }, { status: 400 })
  }

  // Max consecutive leave days
  if (actualDays > MAX_CONSECUTIVE_LEAVE_DAYS) {
    return NextResponse.json({ error: `Maximum consecutive leave is ${MAX_CONSECUTIVE_LEAVE_DAYS} days` }, { status: 400 })
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

  await ensureFractionalLeaveColumns().catch(() => {})

  const isHalfDay = !!is_half_day && start_date === end_date
  try {
    const { rows } = await pool.query(`
      INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status, is_half_day)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [employee_id, leave_type_id, start_date, end_date, finalDays, notes || null, body.status || 'pending', isHalfDay])

    // Alert the admin when a request lands PENDING so approvals aren't discovered by
    // chance. Fire-and-forget: email failure never blocks the request.
    if (rows[0]?.status === 'pending') {
      const empName = empInfo[0]?.name || `Employee #${employee_id}`
      void sendMail({
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject: `New Leave Request (pending) - ${empName}`,
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1976D2;">طلب إجازة جديد / New Leave Request</h2>
            <p><strong>${empName}</strong></p>
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <tr><td style="padding: 8px; border: 1px solid #ddd;">From / من</td><td style="padding: 8px; border: 1px solid #ddd;">${start_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">To / إلى</td><td style="padding: 8px; border: 1px solid #ddd;">${end_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">Days / أيام</td><td style="padding: 8px; border: 1px solid #ddd;">${finalDays}</td></tr>
            </table>
            <p style="color: #666; font-size: 12px;">Waiting for approval — open the dashboard to approve/reject.</p>
          </div>
        `,
      })
    }

    return NextResponse.json(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('Overlapping')) {
      return NextResponse.json({ error: 'Overlapping leave request exists for this employee' }, { status: 409 })
    }
    return NextResponse.json({ error: 'Failed to create leave request' }, { status: 500 })
  }
}
