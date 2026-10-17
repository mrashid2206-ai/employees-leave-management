import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { deleteAdminUser } from '@/server/services/admin-user-service'
import {
  HAS_TEST_DB, ADMIN, resetDb, addEmployee, balanceOf, closePool, employeeToken, adminToken, authedRequest, routeParams,
} from './helpers'

// Every action that moves a balance (or the settings balances are computed from) must
// leave an audit entry, and the admin accounts must not be removable into a state where
// nobody can administer the system. These call the real route handlers with signed cookies.

const BASE = 'http://localhost'

async function auditRows(action: string): Promise<{ user_id: string; details: string }[]> {
  const { rows } = await pool.query('SELECT user_id, details FROM audit_log WHERE action = $1 ORDER BY id', [action])
  return rows
}

describe.skipIf(!HAS_TEST_DB)('audit coverage and admin safety', () => {
  let empId: number
  let annualTypeId: number
  let adminCookie: string

  beforeEach(async () => {
    const seeded = await resetDb()
    empId = seeded.employeeId
    annualTypeId = seeded.annualTypeId
    adminCookie = await adminToken()
  })

  afterAll(async () => {
    await closePool()
  })

  const putEmployee = async (id: number, body: Record<string, unknown>) => {
    const { PUT } = await import('@/app/api/employees/[id]/route')
    return PUT(
      authedRequest(`${BASE}/api/employees/${id}`, { admin: adminCookie }, { method: 'PUT', body: JSON.stringify(body) }),
      routeParams({ id: String(id) })
    )
  }

  describe('employees', () => {
    it('creating an employee records the generated username and starting balance', async () => {
      const { POST } = await import('@/app/api/employees/route')
      const res = await POST(authedRequest(`${BASE}/api/employees`, { admin: adminCookie }, {
        method: 'POST',
        body: JSON.stringify({ name: 'Sara Al Harthy', department_id: 1, leave_balance: 22 }),
      }))
      expect(res.status).toBe(200)
      const created = await res.json()

      const [entry] = await auditRows('employee_created')
      expect(entry.user_id).toBe(ADMIN.username)
      expect(entry.details).toContain(`emp ${created.id}`)
      expect(entry.details).toContain('username sara.al.harthy')
      expect(entry.details).toContain('starting balance 22')
    })

    it('an edit records which fields changed, without contact details in clear', async () => {
      const res = await putEmployee(empId, { name: 'Renamed', phone: '+968 9123 4567' })
      expect(res.status).toBe(200)

      const [entry] = await auditRows('employee_updated')
      expect(entry.details).toContain(`emp ${empId}`)
      expect(entry.details).toContain('name Test Employee→Renamed')
      expect(entry.details).toContain('phone')
      expect(entry.details).not.toContain('9123')
    })

    it('saving without changing anything writes no audit entry', async () => {
      const res = await putEmployee(empId, { name: 'Test Employee', leave_balance: 30 })
      expect(res.status).toBe(200)
      expect(await auditRows('employee_updated')).toHaveLength(0)
      expect(await auditRows('leave_balance_adjusted')).toHaveLength(0)
    })

    it('a balance change without a reason is refused and changes nothing', async () => {
      const res = await putEmployee(empId, { leave_balance: 25 })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toContain('reason')
      expect(body.error).toMatch(/[؀-ۿ]/) // bilingual

      // Nothing else in the same request is applied either.
      const both = await putEmployee(empId, { name: 'Should Not Stick', leave_balance: 25, balance_reason: '   ' })
      expect(both.status).toBe(400)

      expect(await balanceOf(empId)).toBe(30)
      const { rows } = await pool.query('SELECT name FROM employees WHERE id = $1', [empId])
      expect(rows[0].name).toBe('Test Employee')
      expect(await auditRows('leave_balance_adjusted')).toHaveLength(0)
    })

    it('a balance change with a reason is applied and the reason is kept', async () => {
      const res = await putEmployee(empId, { leave_balance: 27.5, balance_reason: 'Opening balance was entered wrong' })
      expect(res.status).toBe(200)
      expect(await balanceOf(empId)).toBe(27.5)

      const [entry] = await auditRows('leave_balance_adjusted')
      expect(entry.details).toContain(`emp ${empId}`)
      expect(entry.details).toContain('30→27.5')
      expect(entry.details).toContain('Opening balance was entered wrong')
    })
  })

  describe('deactivation is the same through PUT and DELETE', () => {
    async function withPendingLeave(id: number): Promise<number> {
      const { rows } = await pool.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
         VALUES ($1, $2, '2026-12-01', '2026-12-02', 2, 'pending') RETURNING id`,
        [id, annualTypeId]
      )
      return rows[0].id
    }

    async function statusOf(leaveId: number): Promise<string> {
      const { rows } = await pool.query('SELECT status FROM leave_requests WHERE id = $1', [leaveId])
      return rows[0].status
    }

    async function sessionWorks(id: number, cookie: string): Promise<boolean> {
      const { GET } = await import('@/app/api/employees/[id]/route')
      const res = await GET(authedRequest(`${BASE}/api/employees/${id}`, { employee: cookie }), routeParams({ id: String(id) }))
      return res.status === 200
    }

    it('both cancel pending leave, end sessions and write the same audit entry', async () => {
      const viaPut = empId
      const viaDelete = await addEmployee()
      const putLeave = await withPendingLeave(viaPut)
      const deleteLeave = await withPendingLeave(viaDelete)
      const putCookie = await employeeToken(viaPut)
      const deleteCookie = await employeeToken(viaDelete, { username: 'other.employee' })
      expect(await sessionWorks(viaPut, putCookie)).toBe(true)
      expect(await sessionWorks(viaDelete, deleteCookie)).toBe(true)

      expect((await putEmployee(viaPut, { is_active: false })).status).toBe(200)
      const { DELETE } = await import('@/app/api/employees/[id]/route')
      const del = await DELETE(
        authedRequest(`${BASE}/api/employees/${viaDelete}`, { admin: adminCookie }, { method: 'DELETE' }),
        routeParams({ id: String(viaDelete) })
      )
      expect(del.status).toBe(200)

      for (const [id, leave, cookie] of [[viaPut, putLeave, putCookie], [viaDelete, deleteLeave, deleteCookie]] as const) {
        expect(await statusOf(leave)).toBe('cancelled')
        expect(await sessionWorks(id, cookie)).toBe(false)
        const { rows } = await pool.query('SELECT is_active, token_version FROM employees WHERE id = $1', [id])
        expect(rows[0].is_active).toBe(false)
        expect(rows[0].token_version).toBe(1)
      }

      const entries = await auditRows('employee_deactivated')
      expect(entries).toHaveLength(2)
      expect(entries[0].details).toContain(`emp ${viaPut}`)
      expect(entries[0].details).toContain('cancelled 1 pending leave')
      expect(entries[1].details).toContain(`emp ${viaDelete}`)
      expect(entries[1].details).toContain('cancelled 1 pending leave')
    })

    it('reactivation is audited', async () => {
      await putEmployee(empId, { is_active: false })
      const res = await putEmployee(empId, { is_active: true })
      expect(res.status).toBe(200)
      expect((await res.json()).is_active).toBe(true)

      const [entry] = await auditRows('employee_reactivated')
      expect(entry.details).toContain(`emp ${empId}`)
    })

    it('an unknown employee is a 404, not an empty 200', async () => {
      expect((await putEmployee(99999, { is_active: false })).status).toBe(404)
    })
  })

  describe('tardiness', () => {
    it('a bulk add audits each row with its deduction, and a delete audits the refund', async () => {
      const other = await addEmployee()
      const { POST } = await import('@/app/api/tardiness/route')
      const res = await POST(authedRequest(`${BASE}/api/tardiness`, { admin: adminCookie }, {
        method: 'POST',
        // Work starts 08:00 (seeded settings); 09:00 is 60 min late, 50 beyond the grace.
        body: JSON.stringify([
          { employee_id: empId, date: '2026-05-04', time: '09:00' },
          { employee_id: other, date: '2026-05-04', time: '09:00' },
        ]),
      }))
      expect(res.status).toBe(200)
      const inserted: { id: number; employee_id: number; leave_deducted: string }[] = await res.json()
      expect(inserted).toHaveLength(2)

      const added = await auditRows('tardiness_added')
      expect(added).toHaveLength(2)
      const deducted = parseFloat(inserted[0].leave_deducted)
      expect(deducted).toBeGreaterThan(0)
      expect(added[0].details).toContain(`emp ${empId}`)
      expect(added[0].details).toContain(`deducted ${deducted} leave day`)
      expect(added[1].details).toContain(`emp ${other}`)

      const { DELETE } = await import('@/app/api/tardiness/[id]/route')
      const del = await DELETE(
        authedRequest(`${BASE}/api/tardiness/${inserted[0].id}`, { admin: adminCookie }, { method: 'DELETE' }),
        routeParams({ id: String(inserted[0].id) })
      )
      expect(del.status).toBe(200)
      expect(await balanceOf(empId)).toBe(30)

      const [removed] = await auditRows('tardiness_deleted')
      expect(removed.details).toContain(`tardiness #${inserted[0].id}`)
      expect(removed.details).toContain(`emp ${empId}`)
      expect(removed.details).toContain(`refunded ${deducted} leave day`)
    })
  })

  describe('settings and reference data', () => {
    it('a settings change records old → new for exactly the fields that changed', async () => {
      const { PUT } = await import('@/app/api/settings/route')
      const put = (body: Record<string, unknown>) =>
        PUT(authedRequest(`${BASE}/api/settings`, { admin: adminCookie }, { method: 'PUT', body: JSON.stringify(body) }))

      // Same start time in a different spelling, plus a real change.
      expect((await put({ annual_leave_balance: 35, work_start_time: '08:00' })).status).toBe(200)
      const [entry] = await auditRows('settings_changed')
      expect(entry.details).toContain('annual_leave_balance 30→35')
      expect(entry.details).not.toContain('work_start_time')

      // A save that changes nothing leaves no entry.
      expect((await put({ annual_leave_balance: 35 })).status).toBe(200)
      expect(await auditRows('settings_changed')).toHaveLength(1)
    })

    it('departments: create, edit and delete are audited', async () => {
      const { POST } = await import('@/app/api/departments/route')
      const created = await (await POST(authedRequest(`${BASE}/api/departments`, { admin: adminCookie }, {
        method: 'POST', body: JSON.stringify({ name: 'Finance' }),
      }))).json()

      const { PUT, DELETE } = await import('@/app/api/departments/[id]/route')
      const params = routeParams({ id: String(created.id) })
      expect((await PUT(authedRequest(`${BASE}/api/departments/${created.id}`, { admin: adminCookie }, {
        method: 'PUT', body: JSON.stringify({ name: 'Finance & Admin', work_start_time: '07:30' }),
      }), params)).status).toBe(200)
      expect((await DELETE(authedRequest(`${BASE}/api/departments/${created.id}`, { admin: adminCookie }, { method: 'DELETE' }), params)).status).toBe(200)

      expect((await auditRows('department_created'))[0].details).toContain('"Finance"')
      const [updated] = await auditRows('department_updated')
      expect(updated.details).toContain('name Finance→Finance & Admin')
      expect(updated.details).toContain('work_start_time (none)→07:30')
      expect((await auditRows('department_deleted'))[0].details).toContain('"Finance & Admin"')
    })

    it('leave types: create, edit and delete are audited', async () => {
      const { POST } = await import('@/app/api/leave-types/route')
      const created = await (await POST(authedRequest(`${BASE}/api/leave-types`, { admin: adminCookie }, {
        method: 'POST', body: JSON.stringify({ name_ar: 'دراسية', name_en: 'Study', color: '#123456' }),
      }))).json()

      const { PUT, DELETE } = await import('@/app/api/leave-types/[id]/route')
      const params = routeParams({ id: String(created.id) })
      expect((await PUT(authedRequest(`${BASE}/api/leave-types/${created.id}`, { admin: adminCookie }, {
        method: 'PUT', body: JSON.stringify({ name_ar: 'دراسية', name_en: 'Study', color: '#654321' }),
      }), params)).status).toBe(200)
      expect((await DELETE(authedRequest(`${BASE}/api/leave-types/${created.id}`, { admin: adminCookie }, { method: 'DELETE' }), params)).status).toBe(200)

      expect((await auditRows('leave_type_created'))[0].details).toContain('"Study"')
      const [updated] = await auditRows('leave_type_updated')
      expect(updated.details).toContain('color #123456→#654321')
      expect(updated.details).not.toContain('name_en')
      expect((await auditRows('leave_type_deleted'))[0].details).toContain('"Study"')
    })

    it('deleting a permission is audited', async () => {
      const { rows } = await pool.query(
        "INSERT INTO permissions (employee_id, date, leave_time, status) VALUES ($1, '2026-06-01', '10:15', 'approved') RETURNING id",
        [empId]
      )
      const { DELETE } = await import('@/app/api/permissions/[id]/route')
      const res = await DELETE(
        authedRequest(`${BASE}/api/permissions/${rows[0].id}`, { admin: adminCookie }, { method: 'DELETE' }),
        routeParams({ id: String(rows[0].id) })
      )
      expect(res.status).toBe(200)

      const [entry] = await auditRows('permission_deleted')
      expect(entry.details).toContain(`permission #${rows[0].id}`)
      expect(entry.details).toContain(`emp ${empId} on 2026-06-01 at 10:15 (approved)`)
    })
  })

  describe('admin accounts', () => {
    const adminRow = async (username: string) =>
      (await pool.query('SELECT id, token_version FROM admin_users WHERE username = $1', [username])).rows[0]

    async function createAdmin(username: string): Promise<{ id: number; cookie: string }> {
      const { POST } = await import('@/app/api/admin-users/route')
      const res = await POST(authedRequest(`${BASE}/api/admin-users`, { admin: adminCookie }, {
        method: 'POST', body: JSON.stringify({ username, password: 'a-long-enough-password', name: username }),
      }))
      expect(res.status).toBe(200)
      const row = await adminRow(username)
      return { id: row.id, cookie: await adminToken({ username, tv: row.token_version }) }
    }

    const deleteAdmin = async (id: number, cookie: string) => {
      const { DELETE } = await import('@/app/api/admin-users/[id]/route')
      return DELETE(authedRequest(`${BASE}/api/admin-users/${id}`, { admin: cookie }, { method: 'DELETE' }), routeParams({ id: String(id) }))
    }

    const canList = async (cookie: string) => {
      const { GET } = await import('@/app/api/admin-users/route')
      return (await GET(authedRequest(`${BASE}/api/admin-users`, { admin: cookie }))).status === 200
    }

    it('an admin cannot delete their own account', async () => {
      await createAdmin('second.admin') // so "last admin" isn't what stops it
      const me = await adminRow(ADMIN.username)
      const res = await deleteAdmin(me.id, adminCookie)
      expect(res.status).toBe(409)
      const body = await res.json()
      expect(body.error).toContain('own account')
      expect(body.error).toMatch(/[؀-ۿ]/)
      expect(await adminRow(ADMIN.username)).toBeDefined()
    })

    it('the last active admin cannot be deleted', async () => {
      // Through the API this is only reachable as a race (the only active admin deleting
      // anyone else is deleting themselves), so ask the service directly as another admin.
      const me = await adminRow(ADMIN.username)
      const res = await deleteAdminUser(String(me.id), { role: 'admin', username: 'someone.else' })
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.status).toBe(409)
        expect(String(res.body.error)).toContain('last active admin')
      }
      expect(await adminRow(ADMIN.username)).toBeDefined()
    })

    it('two admins deleting each other at once cannot both succeed', async () => {
      const other = await createAdmin('second.admin')
      const me = await adminRow(ADMIN.username)
      const results = await Promise.all([deleteAdmin(other.id, adminCookie), deleteAdmin(me.id, other.cookie)])
      expect(results.filter(r => r.status === 200)).toHaveLength(1)
      const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM admin_users WHERE is_active')
      expect(rows[0].c).toBe(1)
    })

    it('deleting an admin ends their sessions, and re-creating the name does not revive them', async () => {
      const victim = await createAdmin('leaving.admin')
      expect(await canList(victim.cookie)).toBe(true)

      expect((await deleteAdmin(victim.id, adminCookie)).status).toBe(200)
      expect(await canList(victim.cookie)).toBe(false)

      // Same username again: the old token must stay dead.
      await createAdmin('leaving.admin')
      expect(await canList(victim.cookie)).toBe(false)
    })

    it('creating and deleting an admin are audited', async () => {
      const other = await createAdmin('audited.admin')
      expect((await deleteAdmin(other.id, adminCookie)).status).toBe(200)

      expect((await auditRows('admin_user_created'))[0].details).toContain('@audited.admin')
      const [deleted] = await auditRows('admin_user_deleted')
      expect(deleted.user_id).toBe(ADMIN.username)
      expect(deleted.details).toContain('@audited.admin')
    })
  })
})
