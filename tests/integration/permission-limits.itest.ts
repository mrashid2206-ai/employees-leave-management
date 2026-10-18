import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { addMonths, omanMonth } from '@/lib/oman-date'
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

  // An employee's permission is always dated today (the server stamps it in Oman time),
  // so earlier months are seeded directly rather than requested.
  const ask = (cookie: string, asAdmin = false) =>
    import('@/app/api/permissions/route').then(({ POST }) =>
      POST(
        authedRequest(`${BASE}/api/permissions`, asAdmin ? { admin: cookie } : { employee: cookie }, {
          method: 'POST',
          body: JSON.stringify({ employee_id: empId, reason: 'errand' }),
        })
      )
    )

  const seed = (date: string, status = 'pending') =>
    pool.query(
      "INSERT INTO permissions (employee_id, date, leave_time, status) VALUES ($1, $2, '10:00', $3)",
      [empId, date, status]
    )

  it('allows requests up to the cap', async () => {
    expect((await ask(empCookie)).status).toBe(200)
    expect((await ask(empCookie)).status).toBe(200)
  })

  it('refuses the one that exceeds the cap', async () => {
    await ask(empCookie)
    await ask(empCookie)

    const third = await ask(empCookie)
    expect(third.status).toBe(409)
    expect((await third.json()).error).toContain('limit')
  })

  it('counts per calendar month, so a previous month does not count', async () => {
    // Two last month: this month is still fresh.
    const lastMonth = `${addMonths(omanMonth(), -1)}-15`
    await seed(lastMonth)
    await seed(lastMonth)
    expect((await ask(empCookie)).status).toBe(200)
    expect((await ask(empCookie)).status).toBe(200)
    expect((await ask(empCookie)).status).toBe(409)
  })

  it('does not count rejected requests against the cap', async () => {
    await ask(empCookie)
    await ask(empCookie)
    await pool.query("UPDATE permissions SET status = 'rejected' WHERE id = (SELECT MIN(id) FROM permissions)")

    expect((await ask(empCookie)).status).toBe(200)
  })

  it('does not hold an admin to the cap', async () => {
    await ask(empCookie)
    await ask(empCookie)

    expect((await ask(adminCookie, true)).status).toBe(200)
  })

  it('treats 0 as unlimited', async () => {
    await pool.query('UPDATE settings SET max_permissions_per_month = 0')

    for (let i = 0; i < 5; i++) {
      expect((await ask(empCookie)).status).toBe(200)
    }
  })
})
