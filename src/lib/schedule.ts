import pool from '@/lib/db'

// A single employee's effective work schedule. Resolved employee -> department ->
// global settings, so an unset level simply inherits the one above it.
export interface WorkSchedule {
  workStartTime: string // 'HH:MM:SS'
  workStartMinutes: number
  workDays: number[]
  workHoursPerDay: number
}

const DEFAULTS = { start: '08:00:00', days: '0,1,2,3,4', hours: 8 }

interface RawSchedule {
  work_start_time: string | null
  work_days: string | null
  work_hours_per_day: number | null
}

function build(raw: RawSchedule | undefined): WorkSchedule {
  const workStartTime = raw?.work_start_time || DEFAULTS.start
  const [h, m] = workStartTime.split(':').map(Number)
  return {
    workStartTime,
    workStartMinutes: h * 60 + m,
    workDays: (raw?.work_days || DEFAULTS.days).split(',').map(Number).filter(n => !Number.isNaN(n)),
    workHoursPerDay: raw?.work_hours_per_day || DEFAULTS.hours,
  }
}

// COALESCE gives the inheritance chain; the LATERAL join keeps employees even when the
// settings row is missing (rather than silently returning nothing, as CROSS JOIN would).
const SELECT_RESOLVED = `
  SELECT e.id AS employee_id,
         COALESCE(e.work_start_time, d.work_start_time, s.work_start_time)::text AS work_start_time,
         COALESCE(e.work_days, d.work_days, s.work_days) AS work_days,
         COALESCE(e.work_hours_per_day, d.work_hours_per_day, s.work_hours_per_day) AS work_hours_per_day
    FROM employees e
    LEFT JOIN departments d ON e.department_id = d.id
    LEFT JOIN LATERAL (
      SELECT work_start_time, work_days, work_hours_per_day FROM settings ORDER BY id LIMIT 1
    ) s ON true
`

export async function resolveSchedule(employeeId: number): Promise<WorkSchedule> {
  try {
    const { rows } = await pool.query(`${SELECT_RESOLVED} WHERE e.id = $1`, [employeeId])
    return build(rows[0])
  } catch {
    return build(undefined)
  }
}

// Bulk variant for the nightly automation, which needs every active employee's schedule
// and must not issue one query per person.
export async function resolveScheduleMap(): Promise<Map<number, WorkSchedule>> {
  const map = new Map<number, WorkSchedule>()
  try {
    const { rows } = await pool.query(`${SELECT_RESOLVED} WHERE e.is_active = true`)
    for (const r of rows) map.set(r.employee_id, build(r))
  } catch {
    // fall through — callers use globalSchedule() as a backstop
  }
  return map
}

// The organisation-wide default (used where there is no employee context).
export async function globalSchedule(): Promise<WorkSchedule> {
  try {
    const { rows } = await pool.query(
      'SELECT work_start_time::text AS work_start_time, work_days, work_hours_per_day FROM settings ORDER BY id LIMIT 1'
    )
    return build(rows[0])
  } catch {
    return build(undefined)
  }
}

// End of the working day for a schedule, as 'HH:MM:SS'.
export function scheduleEndTime(schedule: WorkSchedule): string {
  const total = schedule.workStartMinutes + schedule.workHoursPerDay * 60
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}:00`
}
