import pool from '@/lib/db'
import { MAX_SHIFT_HOURS, DEFAULT_OFFICE_RADIUS_M } from '@/lib/constants'

export function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000 // Earth's radius in metres
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export interface OfficeSettings {
  office_lat: number | string | null
  office_lng: number | string | null
  office_radius: number | null
  office_ip: string | null
}

// Decide whether a check-in/out is on-site. Single shared implementation for both
// actions (previously duplicated and divergent). GPS is authoritative when coordinates
// are supplied, so a spoofed X-Forwarded-For cannot override a failing GPS check; IP is
// only a fallback when GPS is unavailable.
export function evaluateLocation(
  loc: OfficeSettings,
  lat: number | null,
  lng: number | null,
  clientIp: string
): { configured: boolean; onsite: boolean } {
  const hasGps = loc.office_lat != null && loc.office_lng != null
  const hasIp = !!loc.office_ip
  if (!hasGps && !hasIp) return { configured: false, onsite: true }

  if (hasGps && lat != null && lng != null) {
    const dist = getDistanceMeters(lat, lng, Number(loc.office_lat), Number(loc.office_lng))
    return { configured: true, onsite: dist <= (loc.office_radius || DEFAULT_OFFICE_RADIUS_M) }
  }
  if (hasIp && clientIp !== 'unknown') {
    return { configured: true, onsite: clientIp === loc.office_ip }
  }
  // GPS configured but not provided and no usable IP — cannot verify → treat as off-site.
  return { configured: true, onsite: false }
}

// True if the given YYYY-MM-DD is a public holiday or falls outside configured work days.
export async function isOffDay(dateStr: string): Promise<boolean> {
  const { rows: holidays } = await pool.query('SELECT id FROM holidays WHERE date = $1', [dateStr])
  if (holidays.length > 0) return true

  const { rows: settings } = await pool.query('SELECT work_days FROM settings ORDER BY id LIMIT 1')
  const workDays: number[] = settings[0]?.work_days?.split(',').map(Number) || [0, 1, 2, 3, 4]
  // Parse at UTC midnight and read the UTC weekday so the result is server-tz independent.
  const dayOfWeek = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  return !workDays.includes(dayOfWeek)
}

// Work hours between two HH:MM(:SS) wall-clock times. Adds 24h for a genuine
// overnight wrap, then rejects implausible durations (<=0 or beyond MAX_SHIFT_HOURS)
// by returning null so callers fail loudly instead of silently inflating payroll.
export function computeWorkHours(checkIn: string, checkOut: string): number | null {
  const [inH, inM] = checkIn.split(':').map(Number)
  const [outH, outM] = checkOut.split(':').map(Number)
  let minutes = outH * 60 + outM - (inH * 60 + inM)
  if (minutes < 0) minutes += 24 * 60
  if (minutes <= 0) return null
  const hours = Math.round((minutes / 60) * 100) / 100
  if (hours > MAX_SHIFT_HOURS) return null
  return hours
}

// Total minutes an employee was away on APPROVED, closed permissions for a date. Used
// (opt-in via settings.deduct_permission_hours) to subtract personal mid-day absences
// from the day's paid work hours. Returns 0 if the table is missing or times are open.
export async function permissionMinutesFor(employeeId: number, date: string): Promise<number> {
  try {
    const { rows } = await pool.query(
      `SELECT leave_time::text as leave_time, return_time::text as return_time
         FROM permissions
        WHERE employee_id = $1 AND date = $2 AND status = 'approved' AND return_time IS NOT NULL`,
      [employeeId, date]
    )
    let total = 0
    for (const r of rows) {
      const [lh, lm] = String(r.leave_time).split(':').map(Number)
      const [rh, rm] = String(r.return_time).split(':').map(Number)
      const diff = rh * 60 + rm - (lh * 60 + lm)
      if (diff > 0) total += diff
    }
    return total
  } catch {
    return 0
  }
}

// On a holiday/off-day all hours are overtime; otherwise overtime is hours beyond normal.
export function computeOvertime(workHours: number, normalHours: number, isHolidayWork: boolean): number {
  if (isHolidayWork) return workHours
  return Math.max(0, Math.round((workHours - normalHours) * 100) / 100)
}
