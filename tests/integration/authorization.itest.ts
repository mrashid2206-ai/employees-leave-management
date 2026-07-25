import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import {
  HAS_TEST_DB, resetDb, addEmployee, closePool, employeeToken, adminToken, authedRequest, routeParams,
} from './helpers'

// Authorization regression net.
//
// Earlier work in this project fixed real IDOR leaks — employees able to read other
// employees' records — and nothing was stopping them coming back. These call the route
// handlers directly with genuinely signed cookies, so they exercise the same auth path a
// browser does.
//
// The rule under test is simple: an employee sees themselves and nothing else; admin-only
// routes are closed to employees; no cookie means no access.

const BASE = 'http://localhost'

describe.skipIf(!HAS_TEST_DB)('authorization', () => {
  let me: number
  let other: number
  let empCookie: string
  let adminCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    me = seeded.employeeId
    other = await addEmployee()
    empCookie = await employeeToken(me)
    adminCookie = await adminToken()
  })

  afterAll(async () => {
    await closePool()
  })

  describe('admin-only routes reject employees and anonymous callers', () => {
    it('GET /api/audit', async () => {
      const { GET } = await import('@/app/api/audit/route')
      expect((await GET(authedRequest(`${BASE}/api/audit`, { employee: empCookie }))).status).toBe(401)
      expect((await GET(authedRequest(`${BASE}/api/audit`, {}))).status).toBe(401)
      expect((await GET(authedRequest(`${BASE}/api/audit`, { admin: adminCookie }))).status).toBe(200)
    })

    it('GET /api/errors', async () => {
      const { GET } = await import('@/app/api/errors/route')
      expect((await GET(authedRequest(`${BASE}/api/errors`, { employee: empCookie }))).status).toBe(401)
      expect((await GET(authedRequest(`${BASE}/api/errors`, {}))).status).toBe(401)
      expect((await GET(authedRequest(`${BASE}/api/errors`, { admin: adminCookie }))).status).toBe(200)
    })

    it('GET /api/automation/runs', async () => {
      const { GET } = await import('@/app/api/automation/runs/route')
      expect((await GET(authedRequest(`${BASE}/api/automation/runs`, { employee: empCookie }))).status).toBe(401)
      expect((await GET(authedRequest(`${BASE}/api/automation/runs`, { admin: adminCookie }))).status).toBe(200)
    })

    it('POST /api/holidays/seed', async () => {
      const { POST } = await import('@/app/api/holidays/seed/route')
      const body = JSON.stringify({ year: 2026 })
      expect((await POST(authedRequest(`${BASE}/api/holidays/seed`, { employee: empCookie }, { method: 'POST', body }))).status).toBe(401)

      // And nothing was written by the rejected call.
      const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM holidays')
      expect(rows[0].c).toBe(0)
    })

    it('PUT /api/employees/[id] — an employee cannot edit anyone, including themselves', async () => {
      const { PUT } = await import('@/app/api/employees/[id]/route')
      const body = JSON.stringify({ leave_balance: 999 })
      const res = await PUT(
        authedRequest(`${BASE}/api/employees/${me}`, { employee: empCookie }, { method: 'PUT', body }),
        routeParams({ id: String(me) })
      )
      expect(res.status).toBe(401)

      // Critically: an employee must not be able to award themselves leave.
      const { rows } = await pool.query('SELECT leave_balance FROM employees WHERE id = $1', [me])
      expect(parseFloat(rows[0].leave_balance)).toBe(30)
    })

    it('PUT /api/employees/[id]/reset-password', async () => {
      const { PUT } = await import('@/app/api/employees/[id]/reset-password/route')
      const res = await PUT(
        authedRequest(`${BASE}/api/employees/${other}/reset-password`, { employee: empCookie }, {
          method: 'PUT',
          body: JSON.stringify({ password: 'hijacked-password' }),
        }),
        routeParams({ id: String(other) })
      )
      expect(res.status).toBe(401)
    })
  })

  describe('employees are scoped to their own records', () => {
    it('GET /api/employees/[id] — cannot read another employee', async () => {
      const { GET } = await import('@/app/api/employees/[id]/route')

      const mine = await GET(
        authedRequest(`${BASE}/api/employees/${me}`, { employee: empCookie }),
        routeParams({ id: String(me) })
      )
      expect(mine.status).toBe(200)

      const theirs = await GET(
        authedRequest(`${BASE}/api/employees/${other}`, { employee: empCookie }),
        routeParams({ id: String(other) })
      )
      expect(theirs.status).toBe(403)
    })

    it('GET /api/leave-forecast — cannot read another employee’s forecast', async () => {
      const { GET } = await import('@/app/api/leave-forecast/route')

      const theirs = await GET(
        authedRequest(`${BASE}/api/leave-forecast?employee_id=${other}`, { employee: empCookie })
      )
      expect(theirs.status).toBe(403)

      const mine = await GET(authedRequest(`${BASE}/api/leave-forecast?employee_id=${me}`, { employee: empCookie }))
      expect(mine.status).toBe(200)
    })

    it('GET /api/attendance — an employee_id filter cannot widen the scope', async () => {
      await pool.query(
        "INSERT INTO attendance (employee_id, date, status) VALUES ($1, '2026-01-05', 'present'), ($2, '2026-01-05', 'present')",
        [me, other]
      )
      const { GET } = await import('@/app/api/attendance/route')

      // Asking for someone else's records must still only return your own.
      const res = await GET(authedRequest(`${BASE}/api/attendance?employee_id=${other}`, { employee: empCookie }))
      expect(res.status).toBe(200)
      const rows = await res.json()
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((r: { employee_id: number }) => r.employee_id === me)).toBe(true)
    })

    it('GET /api/tardiness — an employee only sees their own rows', async () => {
      await pool.query(
        "INSERT INTO tardiness_log (employee_id, date, time, minutes_late) VALUES ($1, '2026-01-05', '08:30', 30), ($2, '2026-01-05', '08:30', 30)",
        [me, other]
      )
      const { GET } = await import('@/app/api/tardiness/route')

      const res = await GET(authedRequest(`${BASE}/api/tardiness`, { employee: empCookie }))
      const rows = await res.json()
      expect(rows.every((r: { employee_id: number }) => r.employee_id === me)).toBe(true)
      expect(rows).toHaveLength(1)
    })

    it('POST /api/corrections — cannot file a correction as someone else', async () => {
      const { POST } = await import('@/app/api/corrections/route')
      const res = await POST(
        authedRequest(`${BASE}/api/corrections`, { employee: empCookie }, {
          method: 'POST',
          body: JSON.stringify({
            employee_id: other,
            date: '2026-01-05',
            requested_check_in: '08:00',
            reason: 'not mine to file',
          }),
        })
      )
      expect(res.status).toBe(403)
    })
  })

  describe('session revocation', () => {
    it('a token is rejected once its version is bumped', async () => {
      const { GET } = await import('@/app/api/employees/[id]/route')
      const req = () => GET(
        authedRequest(`${BASE}/api/employees/${me}`, { employee: empCookie }),
        routeParams({ id: String(me) })
      )

      expect((await req()).status).toBe(200)

      // e.g. an admin resets the password, or the employee changes it elsewhere.
      await pool.query('UPDATE employees SET token_version = token_version + 1 WHERE id = $1', [me])

      expect((await req()).status).toBe(401)
    })

    it('deactivating an employee ends their session immediately', async () => {
      const { GET } = await import('@/app/api/employees/[id]/route')
      const req = () => GET(
        authedRequest(`${BASE}/api/employees/${me}`, { employee: empCookie }),
        routeParams({ id: String(me) })
      )

      expect((await req()).status).toBe(200)

      await pool.query('UPDATE employees SET is_active = false WHERE id = $1', [me])

      // Not "when the 12h JWT expires" — now.
      expect((await req()).status).toBe(401)
    })

    it('a token for a deleted identity is rejected', async () => {
      const ghost = await employeeToken(999999)
      const { GET } = await import('@/app/api/employees/[id]/route')
      const res = await GET(
        authedRequest(`${BASE}/api/employees/999999`, { employee: ghost }),
        routeParams({ id: '999999' })
      )
      expect(res.status).toBe(401)
    })

    it('a validly-signed token with a stale version cannot be replayed', async () => {
      await pool.query('UPDATE employees SET token_version = 5 WHERE id = $1', [me])
      const stale = await employeeToken(me, { tv: 4 })
      const current = await employeeToken(me, { tv: 5 })
      const { GET } = await import('@/app/api/employees/[id]/route')

      const call = (cookie: string) => GET(
        authedRequest(`${BASE}/api/employees/${me}`, { employee: cookie }),
        routeParams({ id: String(me) })
      )
      expect((await call(stale)).status).toBe(401)
      expect((await call(current)).status).toBe(200)
    })

    it('an admin token is rejected once the admin is deactivated', async () => {
      const { GET } = await import('@/app/api/audit/route')
      expect((await GET(authedRequest(`${BASE}/api/audit`, { admin: adminCookie }))).status).toBe(200)

      await pool.query('UPDATE admin_users SET is_active = false WHERE username = $1', ['admin-test'])

      expect((await GET(authedRequest(`${BASE}/api/audit`, { admin: adminCookie }))).status).toBe(401)
    })
  })

  describe('bootstrap admin', () => {
    // authenticate() issues a token for username 'admin' backed by ADMIN_PASSWORD when
    // admin_users is still empty — a fresh deployment. There is no row to version-check,
    // so a naive "no row means revoked" rule locks the admin out of their own new install.
    it('is accepted when there is no admin_users row and ADMIN_PASSWORD is set', async () => {
      await pool.query('DELETE FROM admin_users')
      const prev = process.env.ADMIN_PASSWORD
      process.env.ADMIN_PASSWORD = 'bootstrap-secret'
      try {
        const bootstrap = await adminToken({ username: 'admin' })
        const { GET } = await import('@/app/api/audit/route')
        const res = await GET(authedRequest(`${BASE}/api/audit`, { admin: bootstrap }))
        expect(res.status).toBe(200)
      } finally {
        process.env.ADMIN_PASSWORD = prev
      }
    })

    it('is rejected when bootstrap is disabled (no ADMIN_PASSWORD)', async () => {
      await pool.query('DELETE FROM admin_users')
      const prev = process.env.ADMIN_PASSWORD
      delete process.env.ADMIN_PASSWORD
      try {
        const bootstrap = await adminToken({ username: 'admin' })
        const { GET } = await import('@/app/api/audit/route')
        const res = await GET(authedRequest(`${BASE}/api/audit`, { admin: bootstrap }))
        expect(res.status).toBe(401)
      } finally {
        if (prev !== undefined) process.env.ADMIN_PASSWORD = prev
      }
    })

    it('does not extend to any other username', async () => {
      await pool.query('DELETE FROM admin_users')
      const prev = process.env.ADMIN_PASSWORD
      process.env.ADMIN_PASSWORD = 'bootstrap-secret'
      try {
        const impostor = await adminToken({ username: 'not-admin' })
        const { GET } = await import('@/app/api/audit/route')
        const res = await GET(authedRequest(`${BASE}/api/audit`, { admin: impostor }))
        expect(res.status).toBe(401)
      } finally {
        process.env.ADMIN_PASSWORD = prev
      }
    })
  })

  describe('token shape', () => {
    it('an employee token cannot be used as an admin token', async () => {
      // Same secret, different role claim — the role must actually be checked.
      const { GET } = await import('@/app/api/audit/route')
      const res = await GET(
        new Request(`${BASE}/api/audit`, { headers: { cookie: `auth-token=${empCookie}` } })
      )
      expect(res.status).toBe(401)
    })

    it('an admin token in the employee cookie is not accepted as an employee', async () => {
      const { GET } = await import('@/app/api/leave-forecast/route')
      const res = await GET(
        new Request(`${BASE}/api/leave-forecast`, { headers: { cookie: `emp-auth-token=${adminCookie}` } })
      )
      // Admin token has no numeric `id`, so it cannot masquerade as an employee.
      expect([401, 400]).toContain(res.status)
    })
  })
})
