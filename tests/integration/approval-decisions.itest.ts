import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { changeLeaveStatus, bulkChangeLeaveStatus } from '@/server/services/leave-service'
import { createCorrection, reviewCorrection } from '@/server/services/correction-service'
import {
  HAS_TEST_DB, resetDb, addEmployee, balanceOf, closePool, employeeToken, adminToken, authedRequest, routeParams, ADMIN,
} from './helpers'

// Approval decisions on the three kinds of request (leave, permission, attendance
// correction). Before this, a rejection carried no reason, leaves recorded no reviewer at
// all, a permission could be re-decided (rejected → approved) with no audit trail and no
// word to the employee, and the Leaves page's bulk approve fired one request per row and
// reported success whatever happened — skipping the department absence limit on the way.

const BASE = 'http://localhost'

describe.skipIf(!HAS_TEST_DB)('approval decisions', () => {
  let empId: number
  let annualTypeId: number
  let adminCookie: string
  let empCookie: string

  beforeAll(() => {
    // Push must be optional: with no VAPID keys every decision still succeeds.
    delete process.env.VAPID_PUBLIC_KEY
    delete process.env.VAPID_PRIVATE_KEY
  })

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    annualTypeId = seeded.annualTypeId
    adminCookie = await adminToken()
    empCookie = await employeeToken(empId)
  })

  afterAll(async () => {
    await closePool()
  })

  // Pending requests are inserted directly: filing is covered elsewhere, and this keeps
  // the day counts exact (no holiday / weekend arithmetic).
  const pendingLeave = async (employeeId: number, start: string, end: string, days: number) => {
    const { rows } = await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
       VALUES ($1, $2, $3, $4, $5, 'pending') RETURNING id`,
      [employeeId, annualTypeId, start, end, days]
    )
    return rows[0].id as number
  }

  const pendingPermission = async (employeeId = empId) => {
    const { rows } = await pool.query(
      "INSERT INTO permissions (employee_id, date, leave_time, reason, status) VALUES ($1, '2026-06-10', '10:30', 'errand', 'pending') RETURNING id",
      [employeeId]
    )
    return rows[0].id as number
  }

  const pendingCorrection = async () => {
    const res = await createCorrection(
      { employee_id: empId, date: '2026-06-10', requested_check_in: '08:00', requested_check_out: '16:00', reason: 'Forgot' },
      { role: 'employee', id: empId, username: 'test.employee' }
    )
    return String((res as { data: { id: number } }).data.id)
  }

  const leaveRow = async (id: number) =>
    (await pool.query('SELECT status, reviewed_by, reviewed_at, decision_note FROM leave_requests WHERE id = $1', [id])).rows[0]

  const notifications = async (employeeId = empId) =>
    (await pool.query(
      'SELECT message, message_ar FROM employee_notifications WHERE employee_id = $1 ORDER BY id',
      [employeeId]
    )).rows as { message: string; message_ar: string }[]

  const decidePermissionRoute = async (id: number, body: Record<string, unknown>) => {
    const { PUT } = await import('@/app/api/permissions/[id]/route')
    return PUT(
      authedRequest(`${BASE}/api/permissions/${id}`, { admin: adminCookie }, { method: 'PUT', body: JSON.stringify(body) }),
      routeParams({ id: String(id) })
    )
  }

  describe('a rejection must say why', () => {
    it('leave: refused without a note, in both languages, and nothing changes', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)

      const res = await changeLeaveStatus(String(id), 'rejected', ADMIN)
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(400)
      const msg = !res.ok ? String(res.body.error) : ''
      expect(msg).toContain('reason is required')
      expect(msg).toContain('سبب الرفض')
      expect((await leaveRow(id)).status).toBe('pending')

      // A note of only whitespace is no reason either.
      expect((await changeLeaveStatus(String(id), 'rejected', ADMIN, { note: '   ' })).ok).toBe(false)
    })

    it('leave route: 400 without a note, and an over-long note is refused', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      const { PUT } = await import('@/app/api/leaves/[id]/approve/route')
      const call = (body: Record<string, unknown>) =>
        PUT(
          authedRequest(`${BASE}/api/leaves/${id}/approve`, { admin: adminCookie }, { method: 'PUT', body: JSON.stringify(body) }),
          routeParams({ id: String(id) })
        )

      expect((await call({ status: 'rejected' })).status).toBe(400)
      expect((await call({ status: 'rejected', note: 'x'.repeat(501) })).status).toBe(400)
      expect((await call({ status: 'rejected', note: 'Team is short that week' })).status).toBe(200)
    })

    it('correction: refused without a note', async () => {
      const id = await pendingCorrection()
      const res = await reviewCorrection(id, 'rejected', ADMIN)
      expect(!res.ok && res.status).toBe(400)
      const { rows } = await pool.query('SELECT status FROM attendance_corrections WHERE id = $1', [id])
      expect(rows[0].status).toBe('pending')
    })

    it('permission: refused without a note', async () => {
      const id = await pendingPermission()
      const res = await decidePermissionRoute(id, { status: 'rejected' })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('سبب الرفض')
      const { rows } = await pool.query('SELECT status FROM permissions WHERE id = $1', [id])
      expect(rows[0].status).toBe('pending')
    })

    it('approval needs no note', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      expect((await changeLeaveStatus(String(id), 'approved', ADMIN)).ok).toBe(true)
    })
  })

  describe('the decision is recorded', () => {
    it('leave: reviewer, time and note on reject; note optional on approve', async () => {
      const a = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      const b = await pendingLeave(empId, '2026-07-10', '2026-07-10', 1)

      await changeLeaveStatus(String(a), 'rejected', ADMIN, { note: 'Team is short that week' })
      await changeLeaveStatus(String(b), 'approved', ADMIN, { note: 'Enjoy' })

      const ra = await leaveRow(a)
      expect(ra.status).toBe('rejected')
      expect(ra.reviewed_by).toBe(ADMIN.username)
      expect(ra.reviewed_at).toBeTruthy()
      expect(ra.decision_note).toBe('Team is short that week')

      const rb = await leaveRow(b)
      expect(rb.reviewed_by).toBe(ADMIN.username)
      expect(rb.decision_note).toBe('Enjoy')
    })

    it('leave: sending it back to pending clears the old decision', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      await changeLeaveStatus(String(id), 'rejected', ADMIN, { note: 'No' })
      expect((await changeLeaveStatus(String(id), 'pending', ADMIN)).ok).toBe(true)

      const row = await leaveRow(id)
      expect(row.status).toBe('pending')
      expect(row.reviewed_by).toBeNull()
      expect(row.reviewed_at).toBeNull()
      expect(row.decision_note).toBeNull()
    })

    it('leave: the audit entry carries the note', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      await changeLeaveStatus(String(id), 'rejected', ADMIN, { note: 'Team is short that week' })
      const { rows } = await pool.query("SELECT details FROM audit_log WHERE action = 'leave_status_change'")
      expect(rows).toHaveLength(1)
      expect(rows[0].details).toContain('Team is short that week')
    })

    it('correction: reviewer, time and note', async () => {
      const id = await pendingCorrection()
      const res = await reviewCorrection(id, 'rejected', ADMIN, 'Badge log shows otherwise')
      expect(res.ok).toBe(true)
      const { rows } = await pool.query(
        'SELECT reviewed_by, reviewed_at, decision_note FROM attendance_corrections WHERE id = $1', [id]
      )
      expect(rows[0].reviewed_by).toBe(ADMIN.username)
      expect(rows[0].reviewed_at).toBeTruthy()
      expect(rows[0].decision_note).toBe('Badge log shows otherwise')
    })

    it('permission: reviewer, time and note, and an audit entry', async () => {
      const id = await pendingPermission()
      const res = await decidePermissionRoute(id, { status: 'rejected', note: 'Busy day' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('rejected')
      expect(body.approved_by).toBe(ADMIN.username)
      expect(body.reviewed_at).toBeTruthy()
      expect(body.decision_note).toBe('Busy day')

      const { rows } = await pool.query("SELECT details FROM audit_log WHERE action = 'permission_status_change'")
      expect(rows).toHaveLength(1)
      expect(rows[0].details).toContain(`Permission #${id} rejected`)
      expect(rows[0].details).toContain('Busy day')
    })
  })

  describe('a permission is decided once', () => {
    it('refuses to re-decide an approved permission (409, bilingual) and keeps the first decision', async () => {
      const id = await pendingPermission()
      expect((await decidePermissionRoute(id, { status: 'approved' })).status).toBe(200)

      const again = await decidePermissionRoute(id, { status: 'rejected', note: 'Actually no' })
      expect(again.status).toBe(409)
      const msg = (await again.json()).error as string
      expect(msg).toContain('already been approved')
      expect(msg).toContain('بالفعل')

      const { rows } = await pool.query('SELECT status, decision_note FROM permissions WHERE id = $1', [id])
      expect(rows[0].status).toBe('approved')
      expect(rows[0].decision_note).toBeNull()
      const { rows: audit } = await pool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'permission_status_change'")
      expect(audit[0].n).toBe(1)
    })

    it('refuses to approve a rejected one', async () => {
      const id = await pendingPermission()
      await decidePermissionRoute(id, { status: 'rejected', note: 'Busy day' })
      expect((await decidePermissionRoute(id, { status: 'approved' })).status).toBe(409)
    })

    it('a refused decision does not apply the return time sent with it', async () => {
      const id = await pendingPermission()
      await decidePermissionRoute(id, { status: 'approved' })
      expect((await decidePermissionRoute(id, { status: 'approved', return_time: '11:00' })).status).toBe(409)
      const { rows } = await pool.query('SELECT return_time FROM permissions WHERE id = $1', [id])
      expect(rows[0].return_time).toBeNull()
    })

    it('employees cannot decide', async () => {
      const id = await pendingPermission()
      const { PUT } = await import('@/app/api/permissions/[id]/route')
      const res = await PUT(
        authedRequest(`${BASE}/api/permissions/${id}`, { employee: empCookie }, {
          method: 'PUT', body: JSON.stringify({ status: 'approved' }),
        }),
        routeParams({ id: String(id) })
      )
      expect(res.status).toBe(403)
    })

    it('a missing permission is a 404', async () => {
      expect((await decidePermissionRoute(999999, { status: 'approved' })).status).toBe(404)
    })
  })

  describe('bulk decisions', () => {
    it('reports each item, deducts each approved balance exactly once, and does not stop at a failure', async () => {
      const ok1 = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      const conflicted = await pendingLeave(empId, '2026-07-06', '2026-07-06', 1)
      const ok2 = await pendingLeave(empId, '2026-07-13', '2026-07-15', 3)
      const alreadyRejected = await pendingLeave(empId, '2026-07-20', '2026-07-20', 1)
      await changeLeaveStatus(String(alreadyRejected), 'rejected', ADMIN, { note: 'No' })
      // A day actually worked can't also be a leave day.
      await pool.query(
        "INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, '2026-07-06', '08:00', 'present')",
        [empId]
      )

      const res = await bulkChangeLeaveStatus([ok1, conflicted, ok2, alreadyRejected, ok1], 'approved', ADMIN)
      expect(res.ok).toBe(true)
      const data = (res as { data: { results: { id: number; ok: boolean; error?: string }[]; succeeded: number; failed: number } }).data

      // Duplicates are decided once; order is preserved.
      expect(data.results.map(r => r.id)).toEqual([ok1, conflicted, ok2, alreadyRejected])
      expect(data.results.map(r => r.ok)).toEqual([true, false, true, false])
      expect(data.succeeded).toBe(2)
      expect(data.failed).toBe(2)
      expect(data.results[1].error).toContain('attendance on 2026-07-06')
      expect(data.results[3].error).toContain('Cannot change from rejected')

      expect(await balanceOf(empId)).toBe(30 - 2 - 3)

      // Running the same bulk again charges nothing more.
      const again = await bulkChangeLeaveStatus([ok1, ok2], 'approved', ADMIN)
      expect((again as { data: { failed: number } }).data.failed).toBe(2)
      expect(await balanceOf(empId)).toBe(25)
    })

    it('records the shared note on each rejected request, and requires it', async () => {
      const a = await pendingLeave(empId, '2026-07-01', '2026-07-01', 1)
      const b = await pendingLeave(empId, '2026-07-08', '2026-07-08', 1)

      const missing = await bulkChangeLeaveStatus([a, b], 'rejected', ADMIN)
      expect(!missing.ok && missing.status).toBe(400)
      expect((await leaveRow(a)).status).toBe('pending')

      const res = await bulkChangeLeaveStatus([a, b], 'rejected', ADMIN, { note: 'Year-end freeze' })
      expect((res as { data: { succeeded: number } }).data.succeeded).toBe(2)
      for (const id of [a, b]) {
        const row = await leaveRow(id)
        expect(row.status).toBe('rejected')
        expect(row.reviewed_by).toBe(ADMIN.username)
        expect(row.decision_note).toBe('Year-end freeze')
      }
      // One audit entry and one bell entry per request, as if decided one by one.
      const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'leave_status_change'")
      expect(rows[0].n).toBe(2)
      expect((await notifications()).filter(n => n.message.includes('Year-end freeze'))).toHaveLength(2)
    })

    it('the route answers per item and is closed to employees', async () => {
      const a = await pendingLeave(empId, '2026-07-01', '2026-07-01', 1)
      const { POST } = await import('@/app/api/leaves/bulk-status/route')
      const call = (cookie: { admin: string } | { employee: string }, body: Record<string, unknown>) =>
        POST(authedRequest(`${BASE}/api/leaves/bulk-status`, cookie, { method: 'POST', body: JSON.stringify(body) }))

      expect((await call({ employee: empCookie }, { ids: [a], status: 'approved' })).status).toBe(401)
      expect((await call({ admin: adminCookie }, { ids: [], status: 'approved' })).status).toBe(400)

      const res = await call({ admin: adminCookie }, { ids: [a, 999999], status: 'approved' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.succeeded).toBe(1)
      expect(body.results).toEqual([
        expect.objectContaining({ id: a, ok: true }),
        expect.objectContaining({ id: 999999, ok: false, status: 404 }),
      ])
    })
  })

  describe('department absence limit on approval', () => {
    // Seeded max_absent_same_dept = 2, everyone in department 1.
    let b: number, c: number, d: number

    beforeEach(async () => {
      b = await addEmployee('Bea', 'bea')
      c = await addEmployee('Cal', 'cal')
      d = await addEmployee('Dee', 'dee')
    })

    const sameWeek = (who: number) => pendingLeave(who, '2026-08-03', '2026-08-04', 2)

    it('a single approval past the limit is a warning the admin can override', async () => {
      await changeLeaveStatus(String(await sameWeek(b)), 'approved', ADMIN)
      await changeLeaveStatus(String(await sameWeek(c)), 'approved', ADMIN)
      const third = await sameWeek(d)

      const res = await changeLeaveStatus(String(third), 'approved', ADMIN)
      expect(res.ok).toBe(false)
      expect(!res.ok && res.status).toBe(409)
      expect(!res.ok && res.body).toMatchObject({ warning: true, absentCount: 2, maxAbsent: 2 })
      expect(await balanceOf(d)).toBe(30)

      const forced = await changeLeaveStatus(String(third), 'approved', ADMIN, { force: true })
      expect(forced.ok).toBe(true)
      expect(await balanceOf(d)).toBe(28)
      const { rows } = await pool.query("SELECT details FROM audit_log WHERE action = 'leave_status_change' ORDER BY id DESC LIMIT 1")
      expect(rows[0].details).toContain('limit overridden')
    })

    it('bulk applies the same limit, item by item, and the same override', async () => {
      const ids = [await sameWeek(b), await sameWeek(c), await sameWeek(d)]

      const res = await bulkChangeLeaveStatus(ids, 'approved', ADMIN)
      const data = (res as { data: { results: { ok: boolean; warning?: boolean }[] } }).data
      expect(data.results.map(r => r.ok)).toEqual([true, true, false])
      expect(data.results[2].warning).toBe(true)
      expect(await balanceOf(d)).toBe(30)

      const forced = await bulkChangeLeaveStatus([ids[2]], 'approved', ADMIN, { force: true })
      expect((forced as { data: { succeeded: number } }).data.succeeded).toBe(1)
      expect(await balanceOf(d)).toBe(28)
    })

    it('leave outside the busy dates is unaffected', async () => {
      await changeLeaveStatus(String(await sameWeek(b)), 'approved', ADMIN)
      await changeLeaveStatus(String(await sameWeek(c)), 'approved', ADMIN)
      const other = await pendingLeave(d, '2026-08-10', '2026-08-10', 1)
      expect((await changeLeaveStatus(String(other), 'approved', ADMIN)).ok).toBe(true)
    })

    it('rejecting is never blocked by the limit', async () => {
      await changeLeaveStatus(String(await sameWeek(b)), 'approved', ADMIN)
      await changeLeaveStatus(String(await sameWeek(c)), 'approved', ADMIN)
      const third = await sameWeek(d)
      expect((await changeLeaveStatus(String(third), 'rejected', ADMIN, { note: 'Too many away' })).ok).toBe(true)
    })
  })

  describe('the employee sees the outcome', () => {
    it('GET /api/leaves/my-requests returns the reviewer, date and note', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      await changeLeaveStatus(String(id), 'rejected', ADMIN, { note: 'Team is short that week' })

      const { GET } = await import('@/app/api/leaves/my-requests/route')
      const rows = await (await GET(authedRequest(`${BASE}/api/leaves/my-requests?employee_id=${empId}`, { employee: empCookie }))).json()
      expect(rows[0]).toMatchObject({ status: 'rejected', decision_note: 'Team is short that week', reviewed_by: ADMIN.username })
      expect(rows[0].reviewed_at).toBeTruthy()
    })

    it('GET /api/permissions (employee view) returns the note', async () => {
      const id = await pendingPermission()
      await decidePermissionRoute(id, { status: 'rejected', note: 'Busy day' })

      const { GET } = await import('@/app/api/permissions/route')
      const rows = await (await GET(authedRequest(`${BASE}/api/permissions?employee_id=${empId}`, { employee: empCookie }))).json()
      expect(rows[0]).toMatchObject({ status: 'rejected', decision_note: 'Busy day' })
      expect(rows[0].reviewed_at).toBeTruthy()
    })

    it('GET /api/corrections (employee view) returns the note', async () => {
      const id = await pendingCorrection()
      await reviewCorrection(id, 'rejected', ADMIN, 'Badge log shows otherwise')

      const { GET } = await import('@/app/api/corrections/route')
      const rows = await (await GET(authedRequest(`${BASE}/api/corrections`, { employee: empCookie }))).json()
      expect(rows[0]).toMatchObject({ status: 'rejected', decision_note: 'Badge log shows otherwise' })
      expect(rows[0].reviewed_at).toBeTruthy()
    })

    it('the admin leave list carries the decision too', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      await changeLeaveStatus(String(id), 'approved', ADMIN, { note: 'Enjoy' })
      const { GET } = await import('@/app/api/leaves/route')
      const rows = await (await GET(authedRequest(`${BASE}/api/leaves`, { admin: adminCookie }))).json()
      expect(rows[0]).toMatchObject({ reviewed_by: ADMIN.username, decision_note: 'Enjoy' })
    })
  })

  describe('the employee is notified of every decision (push optional)', () => {
    it('leave: a bell entry with the dates and the reason, in both languages', async () => {
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-02', 2)
      expect((await changeLeaveStatus(String(id), 'rejected', ADMIN, { note: 'Team is short that week' })).ok).toBe(true)

      const [n] = await notifications()
      // Dates as written, not a JS Date rendering ("Wed Jul 01 2026 00:00:00 GMT…").
      expect(n.message).toBe('Your leave request (2026-07-01 to 2026-07-02) was rejected. Reason: Team is short that week')
      expect(n.message_ar).toContain('تم رفض طلب إجازتك (2026-07-01 إلى 2026-07-02)')
      expect(n.message_ar).toContain('السبب: Team is short that week')
    })

    it('permission: approve and reject both notify (they used to send nothing)', async () => {
      const a = await pendingPermission()
      const b = await pendingPermission()
      await decidePermissionRoute(a, { status: 'approved' })
      await decidePermissionRoute(b, { status: 'rejected', note: 'Busy day' })

      const ns = await notifications()
      expect(ns).toHaveLength(2)
      expect(ns[0].message).toBe('Your permission request on 2026-06-10 at 10:30 was approved.')
      expect(ns[1].message).toContain('rejected. Reason: Busy day')
      expect(ns[1].message_ar).toContain('تم رفض طلب الاستئذان')
    })

    it('correction: the reason reaches the bell', async () => {
      const id = await pendingCorrection()
      await reviewCorrection(id, 'rejected', ADMIN, 'Badge log shows otherwise')
      const [n] = await notifications()
      expect(n.message).toContain('Reason: Badge log shows otherwise')
      expect(n.message_ar).toContain('السبب: Badge log shows otherwise')
    })

    it('a registered device with push unconfigured does not fail the decision', async () => {
      await pool.query(
        "INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth) VALUES ($1, 'https://push.invalid/x', 'k', 'a')",
        [empId]
      )
      const id = await pendingLeave(empId, '2026-07-01', '2026-07-01', 1)
      expect((await changeLeaveStatus(String(id), 'approved', ADMIN)).ok).toBe(true)
      expect(await notifications()).toHaveLength(1)
    })
  })
})
