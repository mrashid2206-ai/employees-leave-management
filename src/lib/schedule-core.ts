// The pure half of src/lib/schedule.ts, safe to import from CLIENT components.
//
// schedule.ts opens a pg Pool, so the portal could not reuse it and would have had to
// re-implement the defaults and the employee -> department -> settings inheritance —
// exactly the kind of copy that drifts. Both sides now build a WorkSchedule here: the
// server after COALESCE-ing in SQL, the portal via resolveScheduleFrom() below.

export interface WorkSchedule {
  workStartTime: string // 'HH:MM:SS'
  workStartMinutes: number
  workDays: number[]
  workHoursPerDay: number
}

export const SCHEDULE_DEFAULTS = { start: '08:00:00', days: '0,1,2,3,4', hours: 8 }

export interface RawSchedule {
  work_start_time: string | null
  work_days: string | null
  work_hours_per_day: number | null
}

export function buildSchedule(raw: RawSchedule | undefined): WorkSchedule {
  const workStartTime = raw?.work_start_time || SCHEDULE_DEFAULTS.start
  const [h, m] = workStartTime.split(':').map(Number)
  return {
    workStartTime,
    workStartMinutes: h * 60 + m,
    workDays: (raw?.work_days || SCHEDULE_DEFAULTS.days).split(',').map(Number).filter(n => !Number.isNaN(n)),
    workHoursPerDay: raw?.work_hours_per_day || SCHEDULE_DEFAULTS.hours,
  }
}

type Level = Partial<RawSchedule> | null | undefined

/** First level that actually sets the field — NULL / '' / undefined mean "inherit". */
function firstSet<T>(levels: Level[], pick: (l: Partial<RawSchedule>) => T | null | undefined): T | null {
  for (const level of levels) {
    if (!level) continue
    const v = pick(level)
    if (v !== null && v !== undefined && v !== '') return v
  }
  return null
}

/**
 * The same inheritance as the server's SQL COALESCE(e.x, d.x, s.x): employee, then
 * department, then global settings, then the built-in defaults.
 */
export function resolveScheduleFrom(employee: Level, department: Level, settings: Level): WorkSchedule {
  const levels = [employee, department, settings]
  const hours = firstSet(levels, l => l.work_hours_per_day)
  return buildSchedule({
    work_start_time: firstSet(levels, l => l.work_start_time),
    work_days: firstSet(levels, l => l.work_days),
    // pg returns INT as a number but a JSON-built department may carry it as a string.
    work_hours_per_day: hours === null ? null : Number(hours),
  })
}

/** ISO weekday (0 = Sunday … 6 = Saturday) of a YYYY-MM-DD date, without timezone drift. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/**
 * Short weekday names for a set of working days: a run that is consecutive (wrapping
 * past Saturday, so Sat–Wed works too) collapses to "first–last", anything else is
 * listed. 2023-01-01 was a Sunday, which anchors day 0 for Intl.
 */
export function formatWorkDays(days: number[], locale: string): string {
  const unique = [...new Set(days)].filter(d => d >= 0 && d <= 6).sort((a, b) => a - b)
  if (unique.length === 0) return ''
  const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' })
  const name = (d: number) => fmt.format(new Date(Date.UTC(2023, 0, 1 + d)))
  if (unique.length === 7) return `${name(0)}–${name(6)}`
  if (unique.length === 1) return name(unique[0])

  // Find the day the run starts on: the one whose predecessor is not a working day.
  const set = new Set(unique)
  const starts = unique.filter(d => !set.has((d + 6) % 7))
  if (starts.length === 1) {
    const first = starts[0]
    const last = (first + unique.length - 1) % 7
    return `${name(first)}–${name(last)}`
  }
  return unique.map(name).join(locale.startsWith('ar') ? '، ' : ', ')
}
