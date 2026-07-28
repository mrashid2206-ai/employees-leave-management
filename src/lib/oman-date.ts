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
