import { describe, it, expect } from 'vitest'
import { omanHolidaysFor } from '@/lib/oman-holidays'

describe('omanHolidaysFor', () => {
  const y2026 = omanHolidaysFor(2026)

  it('includes the fixed Gregorian holidays exactly, not as estimates', () => {
    const fixed = y2026.filter(h => !h.estimated).map(h => h.date)
    expect(fixed).toContain('2026-01-11') // Accession Day
    expect(fixed).toContain('2026-07-23') // Renaissance Day
    expect(fixed).toContain('2026-11-18') // National Day
    expect(fixed).toContain('2026-11-19')
  })

  it('marks every lunar holiday as an estimate', () => {
    // Real dates come from official moon sighting, so nothing computed may claim to be exact.
    const eid = y2026.filter(h => h.name_en.startsWith('Eid'))
    expect(eid.length).toBeGreaterThan(0)
    expect(eid.every(h => h.estimated)).toBe(true)
  })

  it('places Eid al-Fitr 2026 on 20 March (1 Shawwal 1447)', () => {
    expect(y2026.find(h => h.name_en === 'Eid al-Fitr')?.date).toBe('2026-03-20')
  })

  it('places Eid al-Adha 2026 on 27 May (10 Dhu al-Hijjah 1447)', () => {
    expect(y2026.find(h => h.name_en === 'Eid al-Adha')?.date).toBe('2026-05-27')
  })

  it('gives Eid al-Fitr three consecutive days and Eid al-Adha its Arafah eve', () => {
    const fitr = y2026.filter(h => h.name_en.startsWith('Eid al-Fitr')).map(h => h.date).sort()
    expect(fitr).toEqual(['2026-03-20', '2026-03-21', '2026-03-22'])
    // Arafah is the day before Eid al-Adha.
    const arafah = y2026.find(h => h.name_en === 'Day of Arafah')?.date
    expect(arafah).toBe('2026-05-26')
  })

  it('returns dates only inside the requested year, sorted', () => {
    for (const h of y2026) expect(h.date.startsWith('2026-')).toBe(true)
    const dates = y2026.map(h => h.date)
    expect([...dates].sort()).toEqual(dates)
  })

  it('every date is a real calendar date in YYYY-MM-DD form', () => {
    for (const h of y2026) {
      expect(h.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      const d = new Date(h.date + 'T00:00:00Z')
      expect(Number.isNaN(d.getTime())).toBe(false)
      expect(d.toISOString().slice(0, 10)).toBe(h.date)
    }
  })

  it('tracks the ~11-day lunar drift into the next year', () => {
    const fitr2026 = omanHolidaysFor(2026).find(h => h.name_en === 'Eid al-Fitr')!.date
    const fitr2027 = omanHolidaysFor(2027).find(h => h.name_en === 'Eid al-Fitr')!.date
    const days = (Date.parse(fitr2027 + 'T00:00:00Z') - Date.parse(fitr2026 + 'T00:00:00Z')) / 86400000
    // A Hijri year is ~354 days, so next year's Eid lands ~11 days earlier in the
    // Gregorian year than this one.
    expect(days).toBeGreaterThanOrEqual(353)
    expect(days).toBeLessThanOrEqual(355)
  })

  it('names every holiday in both languages', () => {
    for (const h of y2026) {
      expect(h.name_en.length).toBeGreaterThan(0)
      expect(h.name_ar.length).toBeGreaterThan(0)
      expect(h.name_ar).toMatch(/[؀-ۿ]/) // actually Arabic script
    }
  })
})
