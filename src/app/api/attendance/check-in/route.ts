import { NextResponse } from 'next/server'
import pool, { omanToday, omanTime } from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

async function isOffDay(dateStr: string): Promise<boolean> {
  // Check holidays
  const { rows: holidays } = await pool.query('SELECT id FROM holidays WHERE date = $1', [dateStr])
  if (holidays.length > 0) return true

  // Check working days from settings
  const { rows: settings } = await pool.query('SELECT work_days FROM settings LIMIT 1')
  const workDays = settings[0]?.work_days?.split(',').map(Number) || [0,1,2,3,4]
  const dayOfWeek = new Date(dateStr).getDay()
  return !workDays.includes(dayOfWeek)
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  const { employee_id, action } = await request.json()

  // For employees, verify they can only check in for themselves
  if (user.role === 'employee' && user.id !== employee_id) return forbidden()

  if (!employee_id || !action) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

  const today = omanToday()
  const currentTime = omanTime()

  // Check if today is a holiday/weekend
  const holidayWork = await isOffDay(today)

  if (action === 'check-in') {
    const { rows: existing } = await pool.query(
      'SELECT id, check_in FROM attendance WHERE employee_id = $1 AND date = $2',
      [employee_id, today]
    )

    if (existing.length > 0 && existing[0].check_in) {
      return NextResponse.json({ error: 'already_checked_in', time: existing[0].check_in }, { status: 409 })
    }

    // Auto-cancel any approved leave for today (employee showed up)
    let leaveCancelled = false
    const { rows: todayLeaves } = await pool.query(
      "SELECT id, days_count FROM leave_requests WHERE employee_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2",
      [employee_id, today]
    )
    for (const leave of todayLeaves) {
      // Only auto-cancel single-day leaves. Multi-day leaves need admin action.
      if (leave.days_count === 1) {
        await pool.query("UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [leave.id])
        await pool.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [leave.days_count, employee_id])
        leaveCancelled = true
      }
    }

    const { rows } = await pool.query(`
      INSERT INTO attendance (employee_id, date, check_in, status, is_holiday_work)
      VALUES ($1, $2, $3, 'present', $4)
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in = $3, status = 'present', is_holiday_work = $4
      RETURNING id, date::text as date, check_in::text as check_in, check_out::text as check_out, is_holiday_work
    `, [employee_id, today, currentTime, holidayWork])

    return NextResponse.json({
      success: true, action: 'check-in', time: currentTime,
      isHolidayWork: holidayWork, leaveCancelled, record: rows[0]
    })

  } else if (action === 'check-out') {
    const { rows: existing } = await pool.query(
      'SELECT id, check_in, check_out FROM attendance WHERE employee_id = $1 AND date = $2',
      [employee_id, today]
    )

    if (existing.length === 0 || !existing[0].check_in) {
      return NextResponse.json({ error: 'not_checked_in' }, { status: 400 })
    }

    if (existing[0].check_out) {
      return NextResponse.json({ error: 'already_checked_out', time: existing[0].check_out }, { status: 409 })
    }

    const [inH, inM] = existing[0].check_in.split(':').map(Number)
    const [outH, outM] = currentTime.split(':').map(Number)
    const workMinutes = (outH * 60 + outM) - (inH * 60 + inM)
    if (workMinutes <= 0) {
      return NextResponse.json({ error: 'check_out_before_check_in' }, { status: 400 })
    }
    const workHours = Math.round(workMinutes / 60 * 100) / 100

    // If holiday work, ALL hours are overtime. Otherwise, overtime = hours above work_hours_per_day
    let overtime: number
    if (holidayWork) {
      overtime = workHours
    } else {
      const { rows: settings } = await pool.query('SELECT work_hours_per_day FROM settings LIMIT 1')
      const normalHours = settings[0]?.work_hours_per_day || 8
      overtime = Math.max(0, Math.round((workHours - normalHours) * 100) / 100)
    }

    const { rows } = await pool.query(`
      UPDATE attendance SET check_out = $1, work_hours = $2, overtime_hours = $3
      WHERE employee_id = $4 AND date = $5
      RETURNING id, date::text as date, check_in::text as check_in, check_out::text as check_out, work_hours, overtime_hours, is_holiday_work
    `, [currentTime, workHours, overtime, employee_id, today])

    return NextResponse.json({
      success: true, action: 'check-out', time: currentTime,
      workHours, overtime, isHolidayWork: holidayWork, record: rows[0]
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
