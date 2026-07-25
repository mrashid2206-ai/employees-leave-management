// Oman public holidays for a given Gregorian year.
//
// Two kinds, and the difference matters:
//
//  - FIXED holidays fall on the same Gregorian date every year. These are exact.
//  - ISLAMIC holidays follow the Hijri (lunar) calendar, which drifts ~11 days earlier
//    each Gregorian year. Their real dates are set by official moon sighting and are
//    announced shortly before, so anything computed in advance is an ESTIMATE. We compute
//    them from the Umm al-Qura calendar (the tabular calendar used across the Gulf), which
//    is typically within a day of the announcement.
//
// Everything is therefore seeded as a DRAFT: `estimated` is exposed so the UI can tell an
// admin which rows to confirm against the official announcement and adjust.

export interface OmanHoliday {
  name_en: string
  name_ar: string
  date: string // YYYY-MM-DD
  estimated: boolean
}

const FIXED: { month: number; day: number; name_en: string; name_ar: string }[] = [
  { month: 1, day: 11, name_en: 'Accession Day', name_ar: 'يوم تولي السلطان مقاليد الحكم' },
  { month: 7, day: 23, name_en: 'Renaissance Day', name_ar: 'يوم النهضة' },
  { month: 11, day: 18, name_en: 'National Day', name_ar: 'العيد الوطني' },
  { month: 11, day: 19, name_en: 'National Day Holiday', name_ar: 'عطلة العيد الوطني' },
]

// Hijri month/day -> holiday. Multi-day feasts are listed one entry per day so each
// becomes its own holiday row (the app treats holidays as individual dates).
const ISLAMIC: { hMonth: number; hDay: number; name_en: string; name_ar: string }[] = [
  { hMonth: 1, hDay: 1, name_en: 'Islamic New Year', name_ar: 'رأس السنة الهجرية' },
  { hMonth: 3, hDay: 12, name_en: "Prophet's Birthday", name_ar: 'المولد النبوي الشريف' },
  { hMonth: 7, hDay: 27, name_en: 'Isra and Miraj', name_ar: 'الإسراء والمعراج' },
  { hMonth: 10, hDay: 1, name_en: 'Eid al-Fitr', name_ar: 'عيد الفطر' },
  { hMonth: 10, hDay: 2, name_en: 'Eid al-Fitr Holiday', name_ar: 'عطلة عيد الفطر' },
  { hMonth: 10, hDay: 3, name_en: 'Eid al-Fitr Holiday', name_ar: 'عطلة عيد الفطر' },
  { hMonth: 12, hDay: 9, name_en: 'Day of Arafah', name_ar: 'يوم عرفة' },
  { hMonth: 12, hDay: 10, name_en: 'Eid al-Adha', name_ar: 'عيد الأضحى' },
  { hMonth: 12, hDay: 11, name_en: 'Eid al-Adha Holiday', name_ar: 'عطلة عيد الأضحى' },
  { hMonth: 12, hDay: 12, name_en: 'Eid al-Adha Holiday', name_ar: 'عطلة عيد الأضحى' },
]

const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`

let hijriFormatter: Intl.DateTimeFormat | null = null
function getHijriFormatter(): Intl.DateTimeFormat {
  if (!hijriFormatter) {
    hijriFormatter = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura-nu-latn', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  }
  return hijriFormatter
}

/** Hijri month/day for a UTC date, via the Umm al-Qura calendar. */
function hijriMonthDay(d: Date): { month: number; day: number } | null {
  const parts = getHijriFormatter().formatToParts(d)
  const month = Number(parts.find(p => p.type === 'month')?.value)
  const day = Number(parts.find(p => p.type === 'day')?.value)
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null
  return { month, day }
}

/**
 * All Oman public holidays falling within `year`, sorted by date.
 *
 * Islamic holidays are matched by scanning the year's days rather than converting
 * Hijri->Gregorian directly. That handles the awkward cases for free: a Gregorian year can
 * contain the same Islamic holiday twice (the Hijri year is ~11 days shorter) or not at
 * all, and scanning simply reports whatever actually lands inside the year.
 */
export function omanHolidaysFor(year: number): OmanHoliday[] {
  const out: OmanHoliday[] = []

  for (const f of FIXED) {
    out.push({
      name_en: f.name_en,
      name_ar: f.name_ar,
      date: `${year}-${pad(f.month)}-${pad(f.day)}`,
      estimated: false,
    })
  }

  const cursor = new Date(Date.UTC(year, 0, 1))
  while (cursor.getUTCFullYear() === year) {
    const h = hijriMonthDay(cursor)
    if (h) {
      for (const i of ISLAMIC) {
        if (i.hMonth === h.month && i.hDay === h.day) {
          out.push({ name_en: i.name_en, name_ar: i.name_ar, date: iso(cursor), estimated: true })
        }
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  return out.sort((a, b) => a.date.localeCompare(b.date))
}
