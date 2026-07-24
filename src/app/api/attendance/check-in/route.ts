import { NextResponse } from 'next/server'
import pool, { omanToday, omanTime } from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'
import { ensureAttendanceLocationColumns, ensureFractionalLeaveColumns } from '@/lib/ensure-schema'
import { isOffDay, computeWorkHours, computeOvertime, evaluateLocation } from '@/lib/attendance-calc'
import { notifyEmployee } from '@/lib/employee-notify'
import { parseBody } from '@/server/validation'
import { checkInSchema } from '@/server/schemas'

function clientIpOf(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(request: Request) {
  const user = await verifyAnyAuth(request)
  if (!user) return unauthorized()

  await ensureAttendanceLocationColumns().catch(() => {})

  const body = await request.json()
  const valid = parseBody(checkInSchema, body)
  if (!valid.ok) return valid.response
  const { employee_id, action, latitude, longitude } = body

  const clientIp = clientIpOf(request)

  // For employees, verify they can only check in for themselves
  if (user.role === 'employee' && user.id !== employee_id) return forbidden()

  // Check employee is active
  const { rows: empCheck } = await pool.query('SELECT is_active FROM employees WHERE id = $1', [employee_id])
  if (empCheck.length === 0 || !empCheck[0].is_active) {
    return NextResponse.json({ error: 'Employee account is inactive' }, { status: 403 })
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

    // Handle any approved leave covering today
    await ensureFractionalLeaveColumns().catch(() => {})
    let leaveCancelled = false
    const { rows: todayLeaves } = await pool.query(
      "SELECT id, days_count, start_date::text as start_date, end_date::text as end_date, leave_type_id FROM leave_requests WHERE employee_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2",
      [employee_id, today]
    )
    for (const leave of todayLeaves) {
      if (parseFloat(leave.days_count) <= 1) {
        // Single-day leave: auto-cancel and refund balance atomically + idempotently
        // (the UPDATE ... WHERE status='approved' RETURNING guards against double refund).
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const upd = await client.query(
            "UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND status = 'approved' RETURNING days_count",
            [leave.id]
          )
          if ((upd.rowCount || 0) === 1) {
            await client.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [upd.rows[0].days_count, employee_id])
            leaveCancelled = true
          }
          await client.query('COMMIT')
        } catch {
          await client.query('ROLLBACK')
        } finally {
          client.release()
        }
      } else {
        // Multi-day leave: block check-in, employee must ask admin to modify leave first
        return NextResponse.json({
          error: 'on_leave',
          message: `You have an approved leave (${leave.start_date} to ${leave.end_date}). Contact admin to modify your leave before checking in.`,
          leave_start: leave.start_date,
          leave_end: leave.end_date,
        }, { status: 409 })
      }
    }

    // Location verification
    const { rows: locSettings } = await pool.query('SELECT office_lat, office_lng, office_radius, office_ip FROM settings ORDER BY id LIMIT 1')
    const officeLoc = locSettings[0]
    const { configured, onsite } = officeLoc
      ? evaluateLocation(officeLoc, latitude ?? null, longitude ?? null, clientIp)
      : { configured: false, onsite: true }
    // Record-only policy: capture location and flag off-site for admin review, but never
    // block check-in (laptops have no GPS and mobile fixes can fail at the office).
    const isOffsite = configured ? !onsite : false

    const { rows } = await pool.query(`
      INSERT INTO attendance (employee_id, date, check_in, status, is_holiday_work, check_in_lat, check_in_lng, check_in_ip, is_offsite)
      VALUES ($1, $2, $3, 'present', $4, $5, $6, $7, $8)
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in = $3, status = 'present', is_holiday_work = $4, check_in_lat = $5, check_in_lng = $6, check_in_ip = $7, is_offsite = $8
      RETURNING id, date::text as date, check_in::text as check_in, check_out::text as check_out, is_holiday_work, is_offsite
    `, [employee_id, today, currentTime, holidayWork, latitude || null, longitude || null, clientIp, isOffsite])

    // Record-only policy: not blocked, but the employee is told it was flagged off-site.
    if (isOffsite) {
      await notifyEmployee(
        employee_id,
        `Your check-in on ${today} at ${currentTime.slice(0, 5)} was recorded OUTSIDE the office location.`,
        `تم تسجيل حضورك بتاريخ ${today} الساعة ${currentTime.slice(0, 5)} خارج موقع المكتب.`
      )
    }

    return NextResponse.json({
      success: true, action: 'check-in', time: currentTime,
      isHolidayWork: holidayWork, leaveCancelled, isOffsite, record: rows[0]
    })

  } else if (action === 'check-out') {
    // Record-only: capture checkout location + off-site flag, never block.
    const { rows: coLocSettings } = await pool.query('SELECT office_lat, office_lng, office_radius, office_ip FROM settings ORDER BY id LIMIT 1')
    const coOfficeLoc = coLocSettings[0]
    const co = coOfficeLoc
      ? evaluateLocation(coOfficeLoc, latitude ?? null, longitude ?? null, clientIp)
      : { configured: false, onsite: true }
    const coOffsite = co.configured ? !co.onsite : false

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

    const workHours = computeWorkHours(existing[0].check_in, currentTime)
    if (workHours === null) {
      // Non-positive or implausibly long (>16h) duration — reject rather than inflate hours.
      return NextResponse.json({ error: 'check_out_before_check_in' }, { status: 400 })
    }

    // If holiday work, ALL hours are overtime. Otherwise, overtime = hours above work_hours_per_day
    let normalHours = 8
    if (!holidayWork) {
      const { rows: settings } = await pool.query('SELECT work_hours_per_day FROM settings ORDER BY id LIMIT 1')
      normalHours = settings[0]?.work_hours_per_day || 8
    }
    const overtime = computeOvertime(workHours, normalHours, holidayWork)

    const { rows } = await pool.query(`
      UPDATE attendance SET check_out = $1, work_hours = $2, overtime_hours = $3, check_out_lat = $6, check_out_lng = $7, check_out_ip = $8, is_offsite_checkout = $9
      WHERE employee_id = $4 AND date = $5
      RETURNING id, date::text as date, check_in::text as check_in, check_out::text as check_out, work_hours, overtime_hours, is_holiday_work
    `, [currentTime, workHours, overtime, employee_id, today, latitude || null, longitude || null, clientIp, coOffsite])

    // Auto-close any open permission (employee forgot to click "I'm Back")
    await pool.query(
      "UPDATE permissions SET return_time = $1 WHERE employee_id = $2 AND date = $3 AND return_time IS NULL AND status = 'approved'",
      [currentTime, employee_id, today]
    ).catch(() => {}) // Table might not exist yet

    // Record-only policy: not blocked, but the employee is told it was flagged off-site.
    if (coOffsite) {
      await notifyEmployee(
        employee_id,
        `Your check-out on ${today} at ${currentTime.slice(0, 5)} was recorded OUTSIDE the office location.`,
        `تم تسجيل انصرافك بتاريخ ${today} الساعة ${currentTime.slice(0, 5)} خارج موقع المكتب.`
      )
    }

    return NextResponse.json({
      success: true, action: 'check-out', time: currentTime,
      workHours, overtime, isHolidayWork: holidayWork, isOffsite: coOffsite, record: rows[0]
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
