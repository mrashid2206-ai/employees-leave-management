import { NextResponse } from 'next/server'
import pool, { omanToday, omanTime } from '@/lib/db'
import { logger } from '@/lib/log'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'
import { isOffDayFor, computeWorkHours, computeOvertime, evaluateLocation, permissionMinutesFor } from '@/lib/attendance-calc'
import { resolveSchedule } from '@/lib/schedule'
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

  // Holiday, or a non-working day for THIS employee's schedule.
  const holidayWork = await isOffDayFor(employee_id, today)

  if (action === 'check-in') {
    const { rows: existing } = await pool.query(
      'SELECT id, check_in FROM attendance WHERE employee_id = $1 AND date = $2',
      [employee_id, today]
    )

    if (existing.length > 0 && existing[0].check_in) {
      return NextResponse.json({ error: 'already_checked_in', time: existing[0].check_in }, { status: 409 })
    }

    // Handle any approved leave covering today
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
    const { configured, state } = officeLoc
      ? evaluateLocation(officeLoc, latitude ?? null, longitude ?? null, clientIp)
      : { configured: false, state: 'onsite' as const }
    // Record-only policy: capture location for admin review, but never block check-in
    // (laptops have no GPS and mobile fixes can fail at the office).
    const locationState = configured ? state : 'onsite'
    // is_offsite now means GPS-CONFIRMED off-site only. 'unverified' — no coordinates and
    // not on the office network — is recorded as such rather than asserted as absence.
    const isOffsite = locationState === 'offsite'

    const { rows } = await pool.query(`
      INSERT INTO attendance (employee_id, date, check_in, status, is_holiday_work, check_in_lat, check_in_lng, check_in_ip, is_offsite, check_in_location)
      VALUES ($1, $2, $3, 'present', $4, $5, $6, $7, $8, $9)
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in = $3, status = 'present', is_holiday_work = $4, check_in_lat = $5, check_in_lng = $6, check_in_ip = $7, is_offsite = $8, check_in_location = $9
      RETURNING id, date::text as date, check_in::text as check_in, check_out::text as check_out, is_holiday_work, is_offsite, check_in_location
    `, [employee_id, today, currentTime, holidayWork, latitude || null, longitude || null, clientIp, isOffsite, locationState])

    // Only tell the employee when GPS actually places them elsewhere. Notifying on
    // 'unverified' would accuse people whose phone simply did not report a position.
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
      : { configured: false, state: 'onsite' as const }
    const coLocationState = co.configured ? co.state : 'onsite'
    const coOffsite = coLocationState === 'offsite'

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

    const rawHours = computeWorkHours(existing[0].check_in, currentTime)
    if (rawHours === null) {
      // Non-positive or implausibly long (>16h) duration — reject rather than inflate hours.
      return NextResponse.json({ error: 'check_out_before_check_in' }, { status: 400 })
    }

    const { rows: settings } = await pool.query(
      'SELECT deduct_permission_hours FROM settings ORDER BY id LIMIT 1'
    )
    // Overtime is measured against the employee's own working-day length.
    const normalHours = (await resolveSchedule(employee_id)).workHoursPerDay

    // Optionally subtract approved mid-day permission time from the paid hours.
    let workHours = rawHours
    if (settings[0]?.deduct_permission_hours) {
      const permMinutes = await permissionMinutesFor(employee_id, today)
      if (permMinutes > 0) {
        workHours = Math.max(0, Math.round((rawHours - permMinutes / 60) * 100) / 100)
      }
    }

    // If holiday work, ALL hours are overtime. Otherwise, overtime = hours above work_hours_per_day
    const overtime = computeOvertime(workHours, normalHours, holidayWork)

    const { rows } = await pool.query(`
      UPDATE attendance SET check_out = $1, work_hours = $2, overtime_hours = $3, check_out_lat = $6, check_out_lng = $7, check_out_ip = $8, is_offsite_checkout = $9, check_out_location = $10
      WHERE employee_id = $4 AND date = $5
      RETURNING id, date::text as date, check_in::text as check_in, check_out::text as check_out, work_hours, overtime_hours, is_holiday_work, check_out_location
    `, [currentTime, workHours, overtime, employee_id, today, latitude || null, longitude || null, clientIp, coOffsite, coLocationState])

    // Auto-close any open permission (employee forgot to click "I'm Back").
    // Reported, not swallowed: the check-out above has already been written, so failing
    // the whole request here would be worse — but a silent failure leaves a permission
    // open forever with nothing to show why. (The old comment claimed the table might not
    // exist; it has been in 0001_baseline since the self-heal was removed.)
    try {
      await pool.query(
        "UPDATE permissions SET return_time = $1 WHERE employee_id = $2 AND date = $3 AND return_time IS NULL AND status = 'approved'",
        [currentTime, employee_id, today]
      )
    } catch (err) {
      logger.error('failed to auto-close open permission on check-out', err, { employee_id, date: today })
    }

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
