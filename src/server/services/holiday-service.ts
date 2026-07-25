import pool from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { omanHolidaysFor } from '@/lib/oman-holidays'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'

// Seed a year of Oman public holidays as a DRAFT for an admin to confirm.
//
// Existing dates are never overwritten: if an admin already entered (or corrected) a
// holiday, that entry wins. Re-running is therefore safe and only fills gaps -- which is
// what makes this usable again after the official Islamic dates are announced and the
// estimated rows have been corrected by hand.

export interface SeedResult {
  year: number
  added: { name: string; date: string; estimated: boolean }[]
  addedCount: number
  skippedCount: number
  estimatedCount: number
}

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= 2100
}

export async function previewOmanHolidays(year: number): Promise<ServiceResult<unknown>> {
  if (!validYear(year)) return fail(400, 'year must be an integer between 2000 and 2100')

  const proposed = omanHolidaysFor(year)
  const { rows: existing } = await pool.query(
    'SELECT date::text as date FROM holidays WHERE date >= $1 AND date <= $2',
    [`${year}-01-01`, `${year}-12-31`]
  )
  const taken = new Set(existing.map(r => r.date))

  return ok({
    year,
    holidays: proposed.map(h => ({ ...h, alreadyExists: taken.has(h.date) })),
    newCount: proposed.filter(h => !taken.has(h.date)).length,
    existingCount: proposed.filter(h => taken.has(h.date)).length,
  })
}

export async function seedOmanHolidays(
  year: number,
  lang: 'ar' | 'en',
  actor: Actor
): Promise<ServiceResult<SeedResult>> {
  if (!validYear(year)) return fail(400, 'year must be an integer between 2000 and 2100')

  const proposed = omanHolidaysFor(year)
  const added: SeedResult['added'] = []
  let skippedCount = 0

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const h of proposed) {
      const name = lang === 'en' ? h.name_en : h.name_ar
      // uq_holidays_date (migration 0009) is what makes this ON CONFLICT possible, and
      // guarantees one holiday per date even if two admins seed at the same time.
      const { rows } = await client.query(
        `INSERT INTO holidays (name, date) VALUES ($1, $2)
         ON CONFLICT (date) DO NOTHING
         RETURNING id`,
        [name, h.date]
      )
      if (rows.length > 0) added.push({ name, date: h.date, estimated: h.estimated })
      else skippedCount++
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  if (added.length > 0) {
    await logAudit(
      'holidays_seed',
      actorLabel(actor),
      actor.role,
      `Seeded ${added.length} Oman holidays for ${year} (${skippedCount} already present)`
    )
  }

  return ok({
    year,
    added,
    addedCount: added.length,
    skippedCount,
    estimatedCount: added.filter(a => a.estimated).length,
  })
}
