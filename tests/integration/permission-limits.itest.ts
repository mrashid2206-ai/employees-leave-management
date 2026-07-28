import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { HAS_TEST_DB, resetDb, closePool, employeeToken, adminToken, authedRequest } from './helpers'

// Permissions (leaving mid-day and returning) previously had no limit of any kind, while
// a few minutes of tardiness costs annual leave. These pin the monthly cap — and the fact
// that admins are not held to it, consistent with every other limit in the system.
describe.skipIf(!HAS_TEST_DB)('permission monthly limit', () => {
  const BASE = 'http://localhost'
  let empId: number
  let empCookie: string
  let adminCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    empCookie = await employeeToken(empId)
    adminCookie = await adminToken()
    await pool.query('UPDATE settings SET max_permissions_per_month = 2')
  })

  afterAll(async () => {
    await closePool()
  })

  const ask = (date: string, cookie: string, asAdmin = false) =>
    import('@/app/api/permissions/route').then(({ POST }) =>
      POST(
        authedRequest(`${BASE}/api/permissions`, asAdmin ? { admin: cookie } : { employee: cookie }, {
          method: 'POST',
          body: JSON.stringify({ employee_id: empId, date, leave_time: '10:00', reason: 'errand' }),
        })
      )
    )

  it('allows requests up to the cap', async () => {
    expect((await ask('2026-06-01', empCookie)).status).toBe(200)
    expect((await ask('2026-06-08', empCookie)).status).toBe(200)
  })

  it('refuses the one that exceeds the cap', async () => {
    await ask('2026-06-01', empCookie)
    await ask('2026-06-08', empCookie)

    const third = await ask('2026-06-15', empCookie)
    expect(third.status).toBe(409)
    expect((await third.json()).error).toContain('limit')
  })

  it('counts per calendar month, so the next month starts fresh', async () => {
    await ask('2026-06-01', empCookie)
    await ask('2026-06-08', empCookie)
    expect((await ask('2026-06-15', empCookie)).status).toBe(409)

    expect((await ask('2026-07-01', empCookie)).status).toBe(200)
  })

  it('does not count rejected requests against the cap', async () => {
    await ask('2026-06-01', empCookie)
    await ask('2026-06-08', empCookie)
    await pool.query("UPDATE permissions SET status = 'rejected' WHERE date = '2026-06-01'")

    expect((await ask('2026-06-15', empCookie)).status).toBe(200)
  })

  it('does not hold an admin to the cap', async () => {
    await ask('2026-06-01', empCookie)
    await ask('2026-06-08', empCookie)

    expect((await ask('2026-06-15', adminCookie, true)).status).toBe(200)
  })

  it('treats 0 as unlimited', async () => {
    await pool.query('UPDATE settings SET max_permissions_per_month = 0')

    for (const d of ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05']) {
      expect((await ask(d, empCookie)).status).toBe(200)
    }
  })
})
