import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { seedOmanHolidays, previewOmanHolidays } from '@/server/services/holiday-service'
import { omanHolidaysFor } from '@/lib/oman-holidays'
import { HAS_TEST_DB, resetDb, closePool, ADMIN } from './helpers'

// Seeding is meant to be run repeatedly: once to draft a year, then again after the
// official Islamic dates are announced and an admin has corrected the estimates. It must
// therefore never duplicate a date, and never clobber a correction.
describe.skipIf(!HAS_TEST_DB)('Oman holiday seeding', () => {
  beforeEach(async () => {
    await resetDb()
  })

  afterAll(async () => {
    await closePool()
  })

  const countIn = async (year: number): Promise<number> => {
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS c FROM holidays WHERE date >= $1 AND date <= $2',
      [`${year}-01-01`, `${year}-12-31`]
    )
    return rows[0].c
  }

  it('inserts a full year on first run', async () => {
    const expected = omanHolidaysFor(2026).length
    const r = await seedOmanHolidays(2026, 'en', ADMIN)

    expect(r.ok).toBe(true)
    expect(r.ok && r.data.addedCount).toBe(expected)
    expect(r.ok && r.data.skippedCount).toBe(0)
    expect(await countIn(2026)).toBe(expected)
  })

  it('a second run adds nothing and creates no duplicates', async () => {
    const first = await seedOmanHolidays(2026, 'en', ADMIN)
    const countAfterFirst = await countIn(2026)

    const second = await seedOmanHolidays(2026, 'en', ADMIN)

    expect(second.ok && second.data.addedCount).toBe(0)
    expect(second.ok && second.data.skippedCount).toBe(first.ok ? first.data.addedCount : -1)
    expect(await countIn(2026)).toBe(countAfterFirst)
  })

  it('never overwrites a holiday an admin already corrected', async () => {
    // Admin has already entered their own name for Eid al-Fitr, on a corrected date.
    const eid = omanHolidaysFor(2026).find(h => h.name_en === 'Eid al-Fitr')!
    await pool.query('INSERT INTO holidays (name, date) VALUES ($1, $2)', ['Eid (confirmed)', eid.date])

    await seedOmanHolidays(2026, 'en', ADMIN)

    const { rows } = await pool.query('SELECT name FROM holidays WHERE date = $1', [eid.date])
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('Eid (confirmed)')
  })

  it('seeds each language on request', async () => {
    await seedOmanHolidays(2026, 'ar', ADMIN)
    const { rows } = await pool.query('SELECT name FROM holidays WHERE date = $1', ['2026-11-18'])
    expect(rows[0].name).toBe('العيد الوطني')
  })

  it('keeps years independent', async () => {
    await seedOmanHolidays(2026, 'en', ADMIN)
    expect(await countIn(2027)).toBe(0)

    await seedOmanHolidays(2027, 'en', ADMIN)
    expect(await countIn(2027)).toBe(omanHolidaysFor(2027).length)
    expect(await countIn(2026)).toBe(omanHolidaysFor(2026).length)
  })

  it('rejects an out-of-range year instead of writing anything', async () => {
    const r = await seedOmanHolidays(1899, 'en', ADMIN)
    expect(r.ok).toBe(false)
    expect(!r.ok && r.status).toBe(400)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM holidays')
    expect(rows[0].c).toBe(0)
  })

  it('preview reports what would be added without writing', async () => {
    const before = await previewOmanHolidays(2026)
    expect(before.ok).toBe(true)
    expect(await countIn(2026)).toBe(0)

    await seedOmanHolidays(2026, 'en', ADMIN)

    const after = await previewOmanHolidays(2026)
    const data = after.ok ? (after.data as { newCount: number; existingCount: number }) : null
    expect(data?.newCount).toBe(0)
    expect(data?.existingCount).toBe(omanHolidaysFor(2026).length)
  })

  it('records the seed in the audit log', async () => {
    await seedOmanHolidays(2026, 'en', ADMIN)
    const { rows } = await pool.query("SELECT action, details FROM audit_log WHERE action = 'holidays_seed'")
    expect(rows).toHaveLength(1)
    expect(rows[0].details).toContain('2026')
  })
})
