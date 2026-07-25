import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { createLeave, changeLeaveStatus, editLeaveDates, deleteLeave } from '@/server/services/leave-service'
import { HAS_TEST_DB, resetDb, balanceOf, closePool, ADMIN } from './helpers'

// The balance invariant — "a balance only ever moves by exactly days_count, and
// approve→reject→approve nets a single deduction" — lives in SQL transactions across
// several service functions and cannot be unit-tested. These run against a real Postgres.
describe.skipIf(!HAS_TEST_DB)('leave balance accounting', () => {
  let employeeId: number
  let annualTypeId: number

  beforeEach(async () => {
    const seeded = await resetDb()
    employeeId = seeded.employeeId
    annualTypeId = seeded.annualTypeId
  })

  afterAll(async () => {
    await closePool()
  })

  async function makeLeave(start: string, end: string, halfDay = false) {
    const res = await createLeave(
      {
        employee_id: employeeId,
        leave_type_id: annualTypeId,
        start_date: start,
        end_date: end,
        is_half_day: halfDay,
      },
      ADMIN
    )
    if (!res.ok) throw new Error(`createLeave failed: ${JSON.stringify(res.body)}`)
    return res.data
  }

  it('creating a pending leave does not touch the balance', async () => {
    await makeLeave('2026-04-01', '2026-04-03')
    expect(await balanceOf(employeeId)).toBe(30)
  })

  it('approve deducts exactly days_count, reject restores it', async () => {
    const leave = await makeLeave('2026-04-01', '2026-04-03') // 3 days

    const approved = await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(approved.ok).toBe(true)
    expect(await balanceOf(employeeId)).toBe(27)

    const rejected = await changeLeaveStatus(String(leave.id), 'rejected', ADMIN)
    expect(rejected.ok).toBe(true)
    expect(await balanceOf(employeeId)).toBe(30)
  })

  it('approve → reject → approve nets exactly one deduction', async () => {
    const leave = await makeLeave('2026-04-01', '2026-04-03')
    await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    await changeLeaveStatus(String(leave.id), 'rejected', ADMIN)
    await changeLeaveStatus(String(leave.id), 'pending', ADMIN)
    await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(await balanceOf(employeeId)).toBe(27)
  })

  it('re-applying the same status is rejected', async () => {
    const leave = await makeLeave('2026-04-01', '2026-04-03')
    await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    const again = await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(again.ok).toBe(false)
    expect(await balanceOf(employeeId)).toBe(27)
  })

  it('deleting an approved leave refunds the balance', async () => {
    const leave = await makeLeave('2026-04-01', '2026-04-03')
    await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(await balanceOf(employeeId)).toBe(27)

    const del = await deleteLeave(String(leave.id), ADMIN)
    expect(del.ok).toBe(true)
    expect(await balanceOf(employeeId)).toBe(30)
  })

  it('half-day leave persists 0.5 and deducts 0.5', async () => {
    const leave = await makeLeave('2026-04-10', '2026-04-10', true)
    expect(parseFloat(String(leave.days_count))).toBe(0.5)

    await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(await balanceOf(employeeId)).toBe(29.5)
  })

  it('shortening an approved leave refunds exactly the difference', async () => {
    const leave = await makeLeave('2026-04-01', '2026-04-03') // 3 days
    await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(await balanceOf(employeeId)).toBe(27)

    const edited = await editLeaveDates(String(leave.id), '2026-04-01', '2026-04-01', ADMIN)
    expect(edited.ok).toBe(true)
    expect(await balanceOf(employeeId)).toBe(29) // refunded 2
  })

  it('an employee with no remaining balance cannot submit a request', async () => {
    await pool.query('UPDATE employees SET leave_balance = 0 WHERE id = $1', [employeeId])
    const res = await createLeave(
      {
        employee_id: employeeId,
        leave_type_id: annualTypeId,
        start_date: '2030-04-01',
        end_date: '2030-04-02',
      },
      { role: 'employee', id: employeeId }
    )
    expect(res.ok).toBe(false)
  })

  it('admins may still approve into a negative balance', async () => {
    await pool.query('UPDATE employees SET leave_balance = 1 WHERE id = $1', [employeeId])
    const leave = await makeLeave('2026-04-01', '2026-04-03') // 3 days
    const approved = await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(approved.ok).toBe(true)
    expect(await balanceOf(employeeId)).toBe(-2)
  })

  it('cannot approve a leave overlapping a day the employee actually worked', async () => {
    const leave = await makeLeave('2026-04-01', '2026-04-03')
    await pool.query(
      `INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, '2026-04-02', '08:00', 'present')`,
      [employeeId]
    )
    const res = await changeLeaveStatus(String(leave.id), 'approved', ADMIN)
    expect(res.ok).toBe(false)
    expect(await balanceOf(employeeId)).toBe(30)
  })
})
