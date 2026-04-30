import { NextResponse } from 'next/server'
import pool, { omanToday, omanTime } from '@/lib/db'
import { verifyAnyAuth, unauthorized, forbidden } from '@/lib/api-auth'

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng/2) * Math.sin(dLng/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
  return R * c
}

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

  // Ensure location columns exist
  await pool.query(`
    ALTER TABLE attendance ADD COLUMN IF NOT EXISTS check_in_lat DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS check_in_lng DECIMAL(10,7),
    ADD COLUMN IF NOT EXISTS check_in_ip VARCHAR(100),
    ADD COLUMN IF NOT EXISTS is_offsite BOOLEAN DEFAULT FALSE
  `).catch(() => {})

  const { employee_id, action, latitude, longitude } = await request.json()

  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
                   request.headers.get('x-real-ip') ||
                   'unknown'

  // For employees, verify they can only check in for themselves
  if (user.role === 'employee' && user.id !== employee_id) return forbidden()

  if (!employee_id || !action) {
    return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
  }

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

    // Check for approved leave today
    let leaveCancelled = false
    const { rows: todayLeaves } = await pool.query(
      "SELECT id, days_count, start_date::text as start_date, end_date::text as end_date, leave_type_id FROM leave_requests WHERE employee_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $2",
      [employee_id, today]
    )
    for (const leave of todayLeaves) {
      if (parseFloat(leave.days_count) <= 1) {
        // Single-day leave: auto-cancel (employee showed up)
        await pool.query("UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1", [leave.id])
        await pool.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [leave.days_count, employee_id])
        leaveCancelled = true
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
    let isOffsite = false
    const { rows: locSettings } = await pool.query('SELECT office_lat, office_lng, office_radius, office_ip FROM settings LIMIT 1')
    const officeLoc = locSettings[0]

    if (officeLoc && (officeLoc.office_lat || officeLoc.office_ip)) {
      let locationMatch = false
      let ipMatch = false

      // Check GPS if coordinates provided
      if (latitude && longitude && officeLoc.office_lat && officeLoc.office_lng) {
        const distance = getDistanceMeters(latitude, longitude, parseFloat(officeLoc.office_lat), parseFloat(officeLoc.office_lng))
        locationMatch = distance <= (officeLoc.office_radius || 200)
      }

      // Check IP if configured
      if (officeLoc.office_ip && clientIp !== 'unknown') {
        ipMatch = clientIp === officeLoc.office_ip
      }

      // On-site if either matches. If neither configured, assume on-site.
      isOffsite = !locationMatch && !ipMatch
      // If only IP is configured and no GPS, check IP only
      if (!officeLoc.office_lat && officeLoc.office_ip) {
        isOffsite = !ipMatch
      }
      // If only GPS is configured and no IP, check GPS only
      if (officeLoc.office_lat && !officeLoc.office_ip) {
        isOffsite = !locationMatch
      }
    }

    const { rows } = await pool.query(`
      INSERT INTO attendance (employee_id, date, check_in, status, is_holiday_work, check_in_lat, check_in_lng, check_in_ip, is_offsite)
      VALUES ($1, $2, $3, 'present', $4, $5, $6, $7, $8)
      ON CONFLICT (employee_id, date) DO UPDATE SET check_in = $3, status = 'present', is_holiday_work = $4, check_in_lat = $5, check_in_lng = $6, check_in_ip = $7, is_offsite = $8
      RETURNING id, date::text as date, check_in::text as check_in, check_out::text as check_out, is_holiday_work, is_offsite
    `, [employee_id, today, currentTime, holidayWork, latitude || null, longitude || null, clientIp, isOffsite])

    return NextResponse.json({
      success: true, action: 'check-in', time: currentTime,
      isHolidayWork: holidayWork, leaveCancelled, isOffsite, record: rows[0]
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

    // Auto-close any open permission (employee forgot to click "I'm Back")
    await pool.query(
      "UPDATE permissions SET return_time = $1 WHERE employee_id = $2 AND date = $3 AND return_time IS NULL AND status = 'approved'",
      [currentTime, employee_id, today]
    ).catch(() => {}) // Table might not exist yet

    return NextResponse.json({
      success: true, action: 'check-out', time: currentTime,
      workHours, overtime, isHolidayWork: holidayWork, record: rows[0]
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
