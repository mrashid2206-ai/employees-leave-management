import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { HAS_TEST_DB, resetDb, addEmployee, closePool, employeeToken, adminToken, authedRequest } from './helpers'

// The list endpoints' date filters.
//
// GET /api/leaves, /api/tardiness, /api/permissions and /api/corrections used to return
// whole tables, so every report downloaded every row ever recorded to show one leave
// year. They now take an inclusive ?from=&to=. What must not change while doing that:
// the response shape, and what an employee may see (a range narrows a list; it must never
// widen one). GET /api/attendance gained ?date= so the dashboard can ask for today alone.

const BASE = 'http://localhost'

type Auth = { admin: string } | { employee: string }

describe.skipIf(!HAS_TEST_DB)('list date filters', () => {
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

  async function get(path: string, auth: Auth) {
    const routes = {
      '/api/leaves': () => import('@/app/api/leaves/route'),
      '/api/tardiness': () => import('@/app/api/tardiness/route'),
      '/api/permissions': () => import('@/app/api/permissions/route'),
      '/api/corrections': () => import('@/app/api/corrections/route'),
      '/api/attendance': () => import('@/app/api/attendance/route'),
    } as const
    const route = path.split('?')[0] as keyof typeof routes
    const { GET } = await routes[route]()
    const res = await GET(authedRequest(`${BASE}${path}`, auth))
    return { status: res.status, body: await res.json() }
  }

  describe('GET /api/leaves', () => {
    beforeEach(async () => {
      // Two in one year, one in the next; mine and someone else's; one pending.
      await pool.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status, notes) VALUES
           ($1, $3, '2025-12-30', '2025-12-31', 2, 'approved', 'last year'),
           ($1, $3, '2026-01-01', '2026-01-02', 2, 'approved', 'new year'),
           ($2, $3, '2026-12-31', '2026-12-31', 1, 'approved', 'medical detail'),
           ($2, $3, '2026-06-01', '2026-06-01', 1, 'pending', 'pending one')`,
        [me, other, annualTypeId]
      )
    })

    it('filters an admin list by start_date, both bounds inclusive', async () => {
      const all = await get('/api/leaves', { admin: adminCookie })
      expect(all.body).toHaveLength(4)

      const year = await get('/api/leaves?from=2026-01-01&to=2026-12-31', { admin: adminCookie })
      expect(year.status).toBe(200)
      expect(year.body.map((l: { start_date: string }) => l.start_date).sort())
        .toEqual(['2026-01-01', '2026-06-01', '2026-12-31'])
      // Same shape as the unfiltered list.
      expect(Object.keys(year.body[0]).sort()).toEqual(Object.keys(all.body[0]).sort())

      const fromOnly = await get('/api/leaves?from=2026-06-01', { admin: adminCookie })
      expect(fromOnly.body).toHaveLength(2)
      const toOnly = await get('/api/leaves?to=2025-12-31', { admin: adminCookie })
      expect(toOnly.body).toHaveLength(1)
    })

    it("keeps an employee's view to approved leave without notes, range or not", async () => {
      for (const path of ['/api/leaves', '/api/leaves?from=2026-01-01&to=2026-12-31']) {
        const { status, body } = await get(path, { employee: empCookie })
        expect(status).toBe(200)
        expect(body.every((l: { status: string }) => l.status === 'approved')).toBe(true)
        for (const l of body) expect(l).not.toHaveProperty('notes')
      }
      const year = await get('/api/leaves?from=2026-01-01&to=2026-12-31', { employee: empCookie })
      expect(year.body.map((l: { start_date: string }) => l.start_date).sort()).toEqual(['2026-01-01', '2026-12-31'])
    })

    it('refuses a malformed or reversed range', async () => {
      for (const q of ['from=2026-02-30', 'to=soon', 'from=2026-12-31&to=2026-01-01']) {
        expect((await get(`/api/leaves?${q}`, { admin: adminCookie })).status).toBe(400)
        expect((await get(`/api/leaves?${q}`, { employee: empCookie })).status).toBe(400)
      }
    })
  })

  describe('GET /api/tardiness', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO tardiness_log (employee_id, date, time, minutes_late) VALUES
           ($1, '2025-12-31', '08:10', 10),
           ($1, '2026-03-01', '08:20', 20),
           ($2, '2026-03-01', '08:30', 30)`,
        [me, other]
      )
    })

    it('filters by date for an admin', async () => {
      const { status, body } = await get('/api/tardiness?from=2026-01-01&to=2026-12-31', { admin: adminCookie })
      expect(status).toBe(200)
      expect(body).toHaveLength(2)
      expect(body.every((r: { date: string }) => r.date === '2026-03-01')).toBe(true)
    })

    it('still shows an employee only their own rows', async () => {
      const all = await get('/api/tardiness', { employee: empCookie })
      expect(all.body.map((r: { employee_id: number }) => r.employee_id)).toEqual([me, me])
      const year = await get('/api/tardiness?from=2026-01-01&to=2026-12-31', { employee: empCookie })
      expect(year.body).toHaveLength(1)
      expect(year.body[0]).toMatchObject({ employee_id: me, date: '2026-03-01', minutes_late: 20 })
    })

    it('refuses a malformed range', async () => {
      expect((await get('/api/tardiness?from=2026-1-1', { admin: adminCookie })).status).toBe(400)
      expect((await get('/api/tardiness?to=2026-02-29', { employee: empCookie })).status).toBe(400)
    })
  })

  describe('GET /api/permissions', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO permissions (employee_id, date, leave_time, status) VALUES
           ($1, '2026-05-31', '10:00', 'approved'),
           ($1, '2026-06-01', '11:00', 'pending'),
           ($2, '2026-06-01', '12:00', 'approved')`,
        [me, other]
      )
    })

    it('filters by date and returns the date as YYYY-MM-DD', async () => {
      const { status, body } = await get('/api/permissions?from=2026-06-01&to=2026-06-30', { admin: adminCookie })
      expect(status).toBe(200)
      expect(body).toHaveLength(2)
      // It used to come back as a timestamp ("2026-05-31T20:00:00.000Z" on a server in
      // Oman), so nothing comparing it with today's date ever matched.
      expect(body.map((p: { date: string }) => p.date)).toEqual(['2026-06-01', '2026-06-01'])
      expect(body[0]).toHaveProperty('employee.name')
    })

    it('still shows an employee only their own, whatever employee_id they ask for', async () => {
      const own = await get(`/api/permissions?employee_id=${other}&from=2026-01-01&to=2026-12-31`, { employee: empCookie })
      expect(own.body.every((p: { employee_id: number }) => p.employee_id === me)).toBe(true)
      const day = await get('/api/permissions?from=2026-06-01', { employee: empCookie })
      expect(day.body).toHaveLength(1)
      expect(day.body[0]).toMatchObject({ employee_id: me, date: '2026-06-01' })
    })

    it('refuses a malformed range or date', async () => {
      expect((await get('/api/permissions?from=junk', { admin: adminCookie })).status).toBe(400)
      expect((await get('/api/permissions?date=2026-06-31', { employee: empCookie })).status).toBe(400)
    })
  })

  describe('GET /api/corrections', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO attendance_corrections (employee_id, date, requested_check_in, reason, status) VALUES
           ($1, '2026-02-01', '08:00', 'forgot', 'pending'),
           ($1, '2026-04-01', '08:00', 'forgot', 'approved'),
           ($2, '2026-04-02', '08:00', 'forgot', 'pending')`,
        [me, other]
      )
    })

    it('filters by date for an admin', async () => {
      const { status, body } = await get('/api/corrections?from=2026-03-01&to=2026-04-30', { admin: adminCookie })
      expect(status).toBe(200)
      expect(body.map((c: { date: string }) => c.date).sort()).toEqual(['2026-04-01', '2026-04-02'])
    })

    it('still shows an employee only their own', async () => {
      const { body } = await get('/api/corrections?from=2026-03-01&to=2026-04-30', { employee: empCookie })
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({ employee_id: me, date: '2026-04-01' })
    })

    it('refuses a malformed range', async () => {
      expect((await get('/api/corrections?to=04/01/2026', { admin: adminCookie })).status).toBe(400)
    })
  })

  describe('GET /api/attendance?date=', () => {
    beforeEach(async () => {
      await pool.query(
        `INSERT INTO attendance (employee_id, date, check_in, status) VALUES
           ($1, '2026-06-01', '08:00', 'present'),
           ($1, '2026-06-02', '08:00', 'present'),
           ($2, '2026-06-02', '08:05', 'present')`,
        [me, other]
      )
    })

    it('returns just that day', async () => {
      const { status, body } = await get('/api/attendance?date=2026-06-02', { admin: adminCookie })
      expect(status).toBe(200)
      expect(body).toHaveLength(2)
      expect(body.every((r: { date: string }) => r.date === '2026-06-02')).toBe(true)
    })

    it("gives an employee only their own day", async () => {
      const { body } = await get(`/api/attendance?date=2026-06-02&employee_id=${other}`, { employee: empCookie })
      expect(body).toHaveLength(1)
      expect(body[0]).toMatchObject({ employee_id: me, date: '2026-06-02' })
    })

    it('refuses a malformed date or month', async () => {
      expect((await get('/api/attendance?date=2026-06-31', { admin: adminCookie })).status).toBe(400)
      expect((await get('/api/attendance?month=2026-13', { admin: adminCookie })).status).toBe(400)
      expect((await get('/api/attendance?month=2026-06', { admin: adminCookie })).body).toHaveLength(3)
    })
  })

  describe('POST /api/employees', () => {
    it('keeps an opening balance of 0 instead of turning it into 30', async () => {
      const { POST } = await import('@/app/api/employees/route')
      const res = await POST(authedRequest(`${BASE}/api/employees`, { admin: adminCookie }, {
        method: 'POST',
        body: JSON.stringify({ name: 'Zero Balance', department_id: 1, leave_balance: 0 }),
      }))
      expect(res.status).toBe(200)
      const created = await res.json()
      expect(created.leave_balance).toBe(0)
      expect(created.username).toBe('zero.balance')
    })
  })
})
