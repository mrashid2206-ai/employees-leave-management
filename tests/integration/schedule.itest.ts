import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { resolveSchedule, resolveScheduleMap, globalSchedule, scheduleEndTime } from '@/lib/schedule'
import { HAS_TEST_DB, resetDb, closePool } from './helpers'

// The employee -> department -> global chain decides when someone is "late", and lateness
// is charged against annual leave. Resolving it against the wrong level costs a real
// person real days, so each level of the fallback is pinned here.
describe.skipIf(!HAS_TEST_DB)('work schedule resolution', () => {
  let employeeId: number

  beforeEach(async () => {
    const seeded = await resetDb()
    employeeId = seeded.employeeId
    // helpers seed settings at 08:00, 8h, days 0-4 and one department with no override.
  })

  afterAll(async () => {
    await closePool()
  })

  const setDept = (patch: Record<string, unknown>) =>
    pool.query(
      'UPDATE departments SET work_start_time = $1, work_days = $2, work_hours_per_day = $3 WHERE id = 1',
      [patch.start ?? null, patch.days ?? null, patch.hours ?? null]
    )

  const setEmp = (patch: Record<string, unknown>) =>
    pool.query(
      'UPDATE employees SET work_start_time = $1, work_days = $2, work_hours_per_day = $3 WHERE id = $4',
      [patch.start ?? null, patch.days ?? null, patch.hours ?? null, employeeId]
    )

  it('falls back to the global schedule when nothing is overridden', async () => {
    const s = await resolveSchedule(employeeId)
    expect(s.workStartTime).toBe('08:00:00')
    expect(s.workStartMinutes).toBe(480)
    expect(s.workHoursPerDay).toBe(8)
    expect(s.workDays).toEqual([0, 1, 2, 3, 4])
  })

  it('a department override beats the global schedule', async () => {
    await setDept({ start: '09:30', days: '1,2,3,4,5', hours: 7 })

    const s = await resolveSchedule(employeeId)
    expect(s.workStartTime).toBe('09:30:00')
    expect(s.workStartMinutes).toBe(570)
    expect(s.workHoursPerDay).toBe(7)
    expect(s.workDays).toEqual([1, 2, 3, 4, 5])
  })

  it('an employee override beats the department', async () => {
    await setDept({ start: '09:30', days: '1,2,3,4,5', hours: 7 })
    await setEmp({ start: '06:45', days: '0,1,2', hours: 6 })

    const s = await resolveSchedule(employeeId)
    expect(s.workStartTime).toBe('06:45:00')
    expect(s.workStartMinutes).toBe(405)
    expect(s.workHoursPerDay).toBe(6)
    expect(s.workDays).toEqual([0, 1, 2])
  })

  it('inherits field by field, not all or nothing', async () => {
    // Department sets only the hours; employee sets only the start time. Each remaining
    // field must still fall through to the next level that defines it.
    await setDept({ hours: 6 })
    await setEmp({ start: '10:00' })

    const s = await resolveSchedule(employeeId)
    expect(s.workStartTime).toBe('10:00:00') // from the employee
    expect(s.workHoursPerDay).toBe(6) // from the department
    expect(s.workDays).toEqual([0, 1, 2, 3, 4]) // from global settings
  })

  it('clearing an employee override returns them to the department schedule', async () => {
    await setDept({ start: '09:30', hours: 7 })
    await setEmp({ start: '06:45', hours: 6 })
    expect((await resolveSchedule(employeeId)).workStartTime).toBe('06:45:00')

    // This is exactly what the employee editor sends when the fields are cleared.
    await setEmp({})

    const s = await resolveSchedule(employeeId)
    expect(s.workStartTime).toBe('09:30:00')
    expect(s.workHoursPerDay).toBe(7)
  })

  it('the bulk map used by the nightly automation agrees with the single lookup', async () => {
    await setDept({ start: '09:30', hours: 7 })
    await setEmp({ start: '06:45' })

    const map = await resolveScheduleMap()
    expect(map.get(employeeId)).toEqual(await resolveSchedule(employeeId))
  })

  it('globalSchedule ignores department and employee overrides', async () => {
    await setDept({ start: '09:30' })
    await setEmp({ start: '06:45' })

    expect((await globalSchedule()).workStartTime).toBe('08:00:00')
  })

  it('derives end of day from the resolved schedule, wrapping past midnight', async () => {
    await setEmp({ start: '06:45', hours: 6 })
    expect(scheduleEndTime(await resolveSchedule(employeeId))).toBe('12:45:00')

    await setEmp({ start: '20:00', hours: 8 })
    expect(scheduleEndTime(await resolveSchedule(employeeId))).toBe('04:00:00')
  })

  it('falls back safely for an employee id that does not exist', async () => {
    const s = await resolveSchedule(999999)
    expect(s.workStartTime).toBe('08:00:00')
    expect(s.workHoursPerDay).toBe(8)
  })
})
