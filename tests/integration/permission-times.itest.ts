import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { omanToday, omanTime } from '@/lib/oman-date'
import {
  HAS_TEST_DB, resetDb, addEmployee, closePool, employeeToken, adminToken, authedRequest, routeParams,
} from './helpers'

// Permission times used to come from the employee's phone: the portal built date,
// leave_time and return_time from `new Date()` local fields and the server stored them
// verbatim. A phone on another zone, a wrong clock, or a hand-made request recorded
// whatever it liked — and those times feed the paid-hours deduction. The server now
// stamps them in Oman time for employees; admins may still give them explicitly.
describe.skipIf(!HAS_TEST_DB)('permission times are stamped by the server', () => {
  const BASE = 'http://localhost'
  let empId: number
  let otherId: number
  let empCookie: string
  let adminCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    otherId = await addEmployee()
    empCookie = await employeeToken(empId)
    adminCookie = await adminToken()
  })

  afterAll(async () => {
    await closePool()
  })

  type Auth = { employee: string } | { admin: string }

  const create = (auth: Auth, body: Record<string, unknown>) =>
    import('@/app/api/permissions/route').then(({ POST }) =>
      POST(authedRequest(`${BASE}/api/permissions`, auth, {
        method: 'POST',
        body: JSON.stringify({ employee_id: empId, reason: 'bank', ...body }),
      }))
    )

  const update = (auth: Auth, id: number, body: Record<string, unknown>) =>
    import('@/app/api/permissions/[id]/route').then(({ PUT }) =>
      PUT(
        authedRequest(`${BASE}/api/permissions/${id}`, auth, { method: 'PUT', body: JSON.stringify(body) }),
        routeParams({ id: String(id) })
      )
    )

  const row = async (id: number) => {
    const { rows } = await pool.query(
      'SELECT date::text AS date, leave_time::text AS leave_time, return_time::text AS return_time FROM permissions WHERE id = $1',
      [id]
    )
    return rows[0]
  }

  const seedApproved = async (employeeId = empId, returnTime: string | null = null) => {
    const { rows } = await pool.query(
      `INSERT INTO permissions (employee_id, date, leave_time, return_time, status)
       VALUES ($1, $2, '10:00', $3, 'approved') RETURNING id`,
      [employeeId, omanToday(), returnTime]
    )
    return rows[0].id as number
  }

  // Within two minutes of Oman's clock right now (allowing for a run across midnight).
  const isNow = (time: string) => {
    const mins = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const diff = Math.abs(mins(time) - mins(omanTime()))
    return diff <= 2 || diff >= 1438
  }

  describe('requesting a permission', () => {
    it("ignores an employee's own date and leave time", async () => {
      const res = await create({ employee: empCookie }, { date: '2020-01-01', leave_time: '03:00' })
      expect(res.status).toBe(200)
      const created = await row((await res.json()).id)

      expect(created.date).toBe(omanToday())
      expect(created.leave_time).not.toBe('03:00:00')
      expect(isNow(created.leave_time)).toBe(true)
    })

    it('stamps both when the portal sends neither', async () => {
      const res = await create({ employee: empCookie }, {})
      expect(res.status).toBe(200)
      const created = await row((await res.json()).id)
      expect(created.date).toBe(omanToday())
      expect(isNow(created.leave_time)).toBe(true)
    })

    it('lets an admin record a past permission with explicit times', async () => {
      const res = await create({ admin: adminCookie }, { date: '2026-06-01', leave_time: '11:15' })
      expect(res.status).toBe(200)
      const created = await row((await res.json()).id)
      expect(created.date).toBe('2026-06-01')
      expect(created.leave_time).toBe('11:15:00')
    })

    it('stamps an admin request that gives no times', async () => {
      const res = await create({ admin: adminCookie }, {})
      expect(res.status).toBe(200)
      const created = await row((await res.json()).id)
      expect(created.date).toBe(omanToday())
      expect(isNow(created.leave_time)).toBe(true)
    })

    it('still rejects a malformed time from an admin', async () => {
      const res = await create({ admin: adminCookie }, { leave_time: 'soon' })
      expect(res.status).toBe(400)
    })
  })

  describe("marking \"I'm back\"", () => {
    it("records Oman's current time, not the time the employee sent", async () => {
      const id = await seedApproved()
      const res = await update({ employee: empCookie }, id, { return_time: '23:59' })
      expect(res.status).toBe(200)

      const after = await row(id)
      expect(after.return_time).not.toBe('23:59:00')
      expect(isNow(after.return_time)).toBe(true)
    })

    it('accepts the portal\'s { returned: true }', async () => {
      const id = await seedApproved()
      expect((await update({ employee: empCookie }, id, { returned: true })).status).toBe(200)
      expect(isNow((await row(id)).return_time)).toBe(true)
    })

    it('does not move a return that is already recorded', async () => {
      const id = await seedApproved(empId, '11:00')
      await update({ employee: empCookie }, id, { returned: true })
      expect((await row(id)).return_time).toBe('11:00:00')
    })

    it("refuses someone else's permission", async () => {
      const id = await seedApproved(otherId)
      const res = await update({ employee: empCookie }, id, { returned: true })
      expect(res.status).toBe(403)
      expect((await row(id)).return_time).toBeNull()
    })

    it('lets an admin set or correct a return time explicitly', async () => {
      const id = await seedApproved(empId, '11:00')
      expect((await update({ admin: adminCookie }, id, { return_time: '12:30' })).status).toBe(200)
      expect((await row(id)).return_time).toBe('12:30:00')
    })
  })
})
