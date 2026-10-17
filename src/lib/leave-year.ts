import { addDays } from '@/lib/oman-date'

// Leave years, as the reports need them.
//
// Balances reset every leave year (settings.year_start → year_end), but the reports used to
// add up every approved leave and every tardiness row ever recorded. After the first reset,
// "Used" kept growing while "Remaining" started over, and the two stopped matching. Every
// report now totals one leave year at a time.
//
// Plain functions with no DB access, so client components can import them.

export interface LeaveYear {
  start: string
  end: string
  isCurrent: boolean
}

/** Shift a YYYY-MM-DD date by whole years, clamping Feb 29 to Feb 28 where needed. */
function shiftYears(iso: string, years: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const year = y + years
  const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate()
  return `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

/**
 * The current leave year from settings, then the ones before it, newest first.
 *
 * Only the current year is stored, so earlier ones are derived: each starts a year before
 * the next and ends the day before the next one starts. That stays right across leap
 * years and if the year is ever moved to a different start month.
 */
export function leaveYears(settings: { year_start: string; year_end: string }, count = 4): LeaveYear[] {
  const years: LeaveYear[] = [{ start: settings.year_start, end: settings.year_end, isCurrent: true }]
  for (let k = 1; k < count; k++) {
    years.push({
      start: shiftYears(settings.year_start, -k),
      end: addDays(shiftYears(settings.year_start, -k + 1), -1),
      isCurrent: false,
    })
  }
  return years
}

/**
 * Does a date fall in this leave year?
 *
 * For a leave request, pass its start_date. The server refuses requests that run past the
 * end of the leave year, so a request never straddles two of them.
 */
export function inLeaveYear(date: string, year: LeaveYear): boolean {
  return date >= year.start && date <= year.end
}

/** The calendar months a leave year covers, in order. `month` is 0–11. */
export function leaveYearMonths(year: LeaveYear): { year: number; month: number }[] {
  const [sy, sm] = year.start.split('-').map(Number)
  const [ey, em] = year.end.split('-').map(Number)
  const months: { year: number; month: number }[] = []
  for (let y = sy, m = sm - 1; y < ey || (y === ey && m <= em - 1); m === 11 ? (y++, m = 0) : m++) {
    months.push({ year: y, month: m })
  }
  return months
}

// Calendar order (index = month 0–11), so a page can label leaveYearMonths() whatever month
// the leave year starts in. These were hardcoded March-first arrays before.
export const MONTH_NAMES = {
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  enShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
}

/** "2026/27" for a year spanning two calendar years, "2026" for one that doesn't. */
export function leaveYearLabel(year: LeaveYear): string {
  const sy = year.start.slice(0, 4)
  const ey = year.end.slice(0, 4)
  return sy === ey ? sy : `${sy}/${ey.slice(2)}`
}
