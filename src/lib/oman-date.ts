// Oman-timezone date helpers, safe to import from CLIENT components.
//
// These live apart from db.ts because that module opens a pg Pool and cannot be bundled
// into the browser. The client previously reached for
// `new Date().toISOString().split('T')[0]`, which is UTC — so between midnight and 04:00
// Oman time it returned YESTERDAY. The same mistake in reviewCorrection was rewriting
// attendance a day early, so this is a proven failure mode here, not a hypothetical.
//
// Everything is computed in Asia/Muscat regardless of the device's own timezone, so an
// employee travelling abroad still sees the company's working day.

const OMAN_TZ = 'Asia/Muscat'

// 'en-CA' formats as YYYY-MM-DD, which is exactly the shape the API and DATE columns use.
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: OMAN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const timeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: OMAN_TZ,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** Today in Oman, as YYYY-MM-DD. */
export function omanToday(date: Date = new Date()): string {
  return dateFormatter.format(date)
}

/** The previous calendar day in Oman, as YYYY-MM-DD. */
export function omanYesterday(date: Date = new Date()): string {
  return addDays(omanToday(date), -1)
}

/** Current Oman wall-clock time, as HH:MM:SS. */
export function omanTime(date: Date = new Date()): string {
  return timeFormatter.format(date)
}

/** The current month in Oman, as YYYY-MM (the shape /api/attendance?month= takes). */
export function omanMonth(date: Date = new Date()): string {
  return omanToday(date).slice(0, 7)
}

/** Shift a YYYY-MM month by whole months. */
export function addMonths(month: string, months: number): string {
  const [y, m] = month.split('-').map(Number)
  const total = y * 12 + (m - 1) + months
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`
}

/** Last calendar day of a YYYY-MM month, as YYYY-MM-DD. */
export function monthEnd(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1)
}

// Display formatters, cached per locale: the portal clock re-formats every second.
const displayFormatters = new Map<string, Intl.DateTimeFormat>()
function displayFormatter(key: string, locale: string, opts: Intl.DateTimeFormatOptions) {
  const cacheKey = `${key}|${locale}`
  let f = displayFormatters.get(cacheKey)
  if (!f) {
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: OMAN_TZ })
    displayFormatters.set(cacheKey, f)
  }
  return f
}

/**
 * Oman wall-clock time for display, in the UI's locale ("07:42 AM" / "٠٧:٤٢ ص").
 * toLocaleTimeString() without a timeZone uses the PHONE's zone, so an employee whose
 * device was set to another country saw a clock that disagreed with the time the
 * server then recorded.
 */
export function formatOmanTime(date: Date, locale: string, withSeconds = false): string {
  return displayFormatter(withSeconds ? 'time-s' : 'time', locale, {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' as const } : {}),
    hour12: true,
  }).format(date)
}

/** Oman calendar date for display, e.g. "Saturday, October 17, 2026". */
export function formatOmanDate(date: Date, locale: string): string {
  return displayFormatter('date', locale, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date)
}

/** A YYYY-MM month for display, e.g. "October 2026". */
export function formatMonthLabel(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number)
  // Noon UTC on the 15th is the same month in every zone, Oman included.
  return displayFormatter('month', locale, { year: 'numeric', month: 'long' }).format(
    new Date(Date.UTC(y, m - 1, 15, 12))
  )
}

/**
 * Shift a YYYY-MM-DD string by whole days.
 *
 * Done in UTC on purpose: the input is a calendar date with no time or zone attached, so
 * anchoring it to UTC midnight keeps the arithmetic free of local-timezone drift.
 */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}
