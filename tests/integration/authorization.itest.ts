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
  let annualTypeId: number
  let empCookie: string
  let adminCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    me = seeded.employeeId
    annualTypeId = seeded.annualTypeId
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

    it('GET /api/leaves — an employee sees colleagues’ approved leave only, without notes', async () => {
      await pool.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status, notes) VALUES
           ($1, $2, '2026-01-05', '2026-01-06', 2, 'approved', 'medical certificate #123'),
           ($1, $2, '2026-02-05', '2026-02-05', 1, 'pending',  'private reason'),
           ($1, $2, '2026-03-05', '2026-03-05', 1, 'rejected', 'private reason')`,
        [other, annualTypeId]
      )
      const { GET } = await import('@/app/api/leaves/route')

      // The "who's on leave?" panel: who and when, nothing more.
      const res = await GET(authedRequest(`${BASE}/api/leaves`, { employee: empCookie }))
      expect(res.status).toBe(200)
      const rows = await res.json()
      expect(rows).toHaveLength(1)
      expect(rows[0].status).toBe('approved')
      expect(rows[0].employee).toEqual({ name: 'Other Employee' })
      expect(rows[0]).not.toHaveProperty('notes')
      expect(rows[0]).not.toHaveProperty('employee_id')
      expect(JSON.stringify(rows)).not.toContain('medical')

      // Admins still get every request, notes included.
      const all = await (await GET(authedRequest(`${BASE}/api/leaves`, { admin: adminCookie }))).json()
      expect(all).toHaveLength(3)
      expect(all.some((r: { notes: string }) => r.notes === 'medical certificate #123')).toBe(true)
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

  describe('secrets never leave the server', () => {
    // These responses used `RETURNING *`, which carried the employee's password_hash and
    // token_version to the admin's browser.
    const SECRETS = ['password_hash', 'token_version']

    it('POST /api/employees', async () => {
      const { POST } = await import('@/app/api/employees/route')
      const res = await POST(authedRequest(`${BASE}/api/employees`, { admin: adminCookie }, {
        method: 'POST',
        body: JSON.stringify({ name: 'New Hire', department_id: 1 }),
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.name).toBe('New Hire')
      expect(body.username).toBe('new.hire')
      for (const k of SECRETS) expect(body).not.toHaveProperty(k)
    })

    it('PUT /api/employees/[id]', async () => {
      const { PUT } = await import('@/app/api/employees/[id]/route')
      const res = await PUT(
        authedRequest(`${BASE}/api/employees/${me}`, { admin: adminCookie }, {
          method: 'PUT',
          body: JSON.stringify({ position: 'Clerk' }),
        }),
        routeParams({ id: String(me) })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.position).toBe('Clerk')
      for (const k of SECRETS) expect(body).not.toHaveProperty(k)
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

    // It used to stay open whenever no row was NAMED 'admin', so with real admins under
    // other usernames, a still-set ADMIN_PASSWORD was a permanent second way in.
    it('a bootstrap token is rejected once a real admin exists', async () => {
      // resetDb seeded an active 'admin-test', so bootstrap is over.
      const prev = process.env.ADMIN_PASSWORD
      process.env.ADMIN_PASSWORD = 'bootstrap-secret'
      try {
        const bootstrap = await adminToken({ username: 'admin' })
        const { GET } = await import('@/app/api/audit/route')
        expect((await GET(authedRequest(`${BASE}/api/audit`, { admin: bootstrap }))).status).toBe(401)
      } finally {
        process.env.ADMIN_PASSWORD = prev
      }
    })

    it('the bootstrap password only logs in while there is no active admin', async () => {
      const { authenticate } = await import('@/lib/auth')
      const prev = process.env.ADMIN_PASSWORD
      process.env.ADMIN_PASSWORD = 'bootstrap-secret'
      try {
        expect(await authenticate('admin', 'bootstrap-secret')).toBeNull()

        // Every admin deactivated counts as none, so the install can be recovered.
        await pool.query('UPDATE admin_users SET is_active = false')
        expect(await authenticate('admin', 'bootstrap-secret')).not.toBeNull()
        expect(await authenticate('admin', 'wrong')).toBeNull()
      } finally {
        process.env.ADMIN_PASSWORD = prev
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

  describe('a browser holding both an admin and an employee session', () => {
    // An admin who is also an employee can be signed into both in one browser. The
    // portal's "my" requests used to be answered as the admin: the bell came back empty
    // and "my" lists came back as everyone's. The portal now marks its requests.
    const both = (url: string, portal: boolean) => new Request(url, {
      headers: {
        cookie: `auth-token=${adminCookie}; emp-auth-token=${empCookie}`,
        ...(portal ? { 'x-auth-context': 'employee' } : {}),
      },
    })

    beforeEach(async () => {
      await pool.query(
        `INSERT INTO tardiness_log (employee_id, date, time, minutes_late)
         VALUES ($1, '2026-01-05', '08:30', 30), ($2, '2026-01-05', '08:30', 30)`,
        [me, other]
      )
      await pool.query(
        `INSERT INTO employee_notifications (employee_id, message) VALUES ($1, 'mine'), ($2, 'theirs')`,
        [me, other]
      )
    })

    it('portal requests are answered as the employee', async () => {
      const { GET: tardiness } = await import('@/app/api/tardiness/route')
      const rows = await (await tardiness(both(`${BASE}/api/tardiness`, true))).json()
      expect(rows.map((r: { employee_id: number }) => r.employee_id)).toEqual([me])

      const { GET: notifications } = await import('@/app/api/employee-notifications/route')
      const mine = await (await notifications(both(`${BASE}/api/employee-notifications`, true))).json()
      expect(mine.map((n: { message: string }) => n.message)).toEqual(['mine'])
    })

    it('dashboard requests are still answered as the admin', async () => {
      const { GET } = await import('@/app/api/tardiness/route')
      const rows = await (await GET(both(`${BASE}/api/tardiness`, false))).json()
      expect(rows).toHaveLength(2)
    })

    it('the header narrows access but never grants it', async () => {
      // An admin session alone, asking to be treated as an employee, gets nothing.
      const { GET } = await import('@/app/api/tardiness/route')
      const res = await GET(new Request(`${BASE}/api/tardiness`, {
        headers: { cookie: `auth-token=${adminCookie}`, 'x-auth-context': 'employee' },
      }))
      expect(res.status).toBe(401)
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
