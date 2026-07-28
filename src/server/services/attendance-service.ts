import pool from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { isOffDayFor, computeWorkHours, computeOvertime } from '@/lib/attendance-calc'
import { resolveSchedule } from '@/lib/schedule'
import { applyAutoAbsenceLeave, reverseAutoAbsenceLeave } from '@/lib/auto-absence'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'

// Admin-side attendance writes.
//
// These moved out of the route handlers because they MUTATE LEAVE BALANCES: flipping a day
// to 'absent' charges an annual leave day, and flipping it back refunds one. Every other
// balance-moving operation (leave, corrections, absence charging) already lived in a
// service and was directly testable; attendance was the last one buried in a route, where
// it could only be exercised through HTTP.
//
// The rule this file exists to keep: the attendance row and the balance move together, in
// one transaction, or not at all.

const ALLOWED_STATUSES = new Set(['present', 'absent', 'leave', 'holiday'])

// Columns an admin may patch directly. Anything else in the body is ignored rather than
// trusted — the balance-affecting work is driven by `status`, handled explicitly below.
const PATCHABLE = [
  'check_in', 'check_out', 'work_hours', 'overtime_hours',
  'status', 'notes', 'is_holiday_work', 'excused_tardiness',
] as const

export interface AttendanceInput {
  employee_id: number
  date: string
  check_in?: string | null
  check_out?: string | null
  status?: string
  notes?: string | null
}

/**
 * Create or update attendance for one or more employee/date pairs.
 *
 * Hours and overtime are recomputed here rather than trusted from the caller, using the
 * same schedule-aware maths as the self-service check-out, so a bulk import cannot write
 * figures that disagree with how the app calculates them.
 */
export async function upsertAttendance(records: AttendanceInput[]): Promise<ServiceResult<unknown[]>> {
  const results: unknown[] = []

  for (const r of records) {
    const status = r.status && ALLOWED_STATUSES.has(r.status) ? r.status : 'present'

    const holidayWork = await isOffDayFor(r.employee_id, r.date)
    const normalHours = (await resolveSchedule(r.employee_id)).workHoursPerDay
    let workHours = 0
    if (r.check_in && r.check_out) {
      workHours = computeWorkHours(r.check_in, r.check_out) ?? 0
    }
    const overtime = computeOvertime(workHours, normalHours, holidayWork)

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows: prev } = await client.query(
        'SELECT status FROM attendance WHERE employee_id = $1 AND date = $2',
        [r.employee_id, r.date]
      )
      const wasAbsent = prev[0]?.status === 'absent'

      const { rows } = await client.query(
        `INSERT INTO attendance (employee_id, date, check_in, check_out, work_hours, overtime_hours, status, notes, is_holiday_work)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (employee_id, date) DO UPDATE SET
           check_in = COALESCE($3, attendance.check_in),
           check_out = COALESCE($4, attendance.check_out),
           work_hours = $5,
           overtime_hours = $6,
           status = $7,
           notes = $8,
           is_holiday_work = $9
         RETURNING *`,
        [r.employee_id, r.date, r.check_in || null, r.check_out || null, workHours, overtime, status, r.notes || null, holidayWork]
      )

      // The charge and the refund are symmetric and share the row's transaction.
      if (wasAbsent && status !== 'absent') {
        await reverseAutoAbsenceLeave(client, r.employee_id, r.date)
      } else if (!wasAbsent && status === 'absent') {
        await applyAutoAbsenceLeave(client, r.employee_id, r.date)
      }

      await client.query('COMMIT')
      results.push(rows[0])
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  }

  return ok(results)
}

export interface AttendanceUpdateResult {
  record: unknown
  refundedDays: number
  chargedDays: number
}

/** Patch one attendance row, moving the balance if the day crosses into or out of 'absent'. */
export async function updateAttendance(
  id: string,
  patch: Record<string, unknown>,
  actor: Actor
): Promise<ServiceResult<AttendanceUpdateResult>> {
  const fields = PATCHABLE.filter(f => f in patch)
  if (fields.length === 0) return fail(400, 'No fields')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    let refundedDays = 0
    let chargedDays = 0
    if (typeof patch.status === 'string') {
      const { rows: cur } = await client.query(
        'SELECT employee_id, date::text as date, status FROM attendance WHERE id = $1',
        [id]
      )
      if (cur[0]) {
        const wasAbsent = cur[0].status === 'absent'
        if (wasAbsent && patch.status !== 'absent') {
          refundedDays = await reverseAutoAbsenceLeave(client, cur[0].employee_id, cur[0].date)
        } else if (!wasAbsent && patch.status === 'absent') {
          const applied = await applyAutoAbsenceLeave(client, cur[0].employee_id, cur[0].date)
          chargedDays = applied?.days ?? 0
        }
      }
    }

    const sets = fields.map((f, i) => `${f} = $${i + 2}`).join(', ')
    const values: unknown[] = [id, ...fields.map(f => patch[f])]
    const { rows } = await client.query(`UPDATE attendance SET ${sets} WHERE id = $1 RETURNING *`, values)

    await client.query('COMMIT')

    if (refundedDays > 0) {
      await logAudit('absence_corrected', actorLabel(actor), actor.role, `Attendance #${id} set to ${patch.status}; refunded ${refundedDays} auto-deducted leave day(s)`)
    }
    if (chargedDays > 0) {
      await logAudit('absence_charged', actorLabel(actor), actor.role, `Attendance #${id} set to absent; deducted ${chargedDays} leave day(s)`)
    }

    return ok({ record: rows[0], refundedDays, chargedDays })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Delete an attendance row, refunding the leave day if it was an absence. */
export async function deleteAttendance(id: string, actor: Actor): Promise<ServiceResult<{ refundedDays: number }>> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: cur } = await client.query(
      'SELECT employee_id, date::text as date, status FROM attendance WHERE id = $1',
      [id]
    )
    if (cur.length === 0) {
      await client.query('ROLLBACK')
      // Already gone: deleting twice is not an error.
      return ok({ refundedDays: 0 })
    }

    await client.query('DELETE FROM attendance WHERE id = $1', [id])

    let refundedDays = 0
    if (cur[0].status === 'absent') {
      refundedDays = await reverseAutoAbsenceLeave(client, cur[0].employee_id, cur[0].date)
    }

    await client.query('COMMIT')

    if (refundedDays > 0) {
      await logAudit('absence_deleted', actorLabel(actor), actor.role, `Deleted absence #${id}; refunded ${refundedDays} auto-deducted leave day(s)`)
    }
    return ok({ refundedDays })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
