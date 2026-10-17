import pool, { omanToday } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { checkDecisionNote, normalizeNote, notifyDecision } from '@/server/decision'
import { isOffDayFor, computeWorkHours, computeOvertime } from '@/lib/attendance-calc'
import { reverseAutoAbsenceLeave } from '@/lib/auto-absence'
import { resolveSchedule } from '@/lib/schedule'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'

// Employees formally request a fix to a wrong attendance record; admins review a queue.
// Approving APPLIES the requested times to the attendance row (recomputing hours and
// overtime with the same rules as a live check-out) so there's no manual double-entry.

export interface CorrectionInput {
  employee_id: number
  date: string
  requested_check_in?: string | null
  requested_check_out?: string | null
  reason: string
}

export async function createCorrection(input: CorrectionInput, actor: Actor): Promise<ServiceResult<unknown>> {
  // Employees may only file corrections for themselves.
  if (actor.role === 'employee' && actor.id !== input.employee_id) return fail(403, 'Forbidden')
  // The portal shows these messages verbatim, and most employees read Arabic, so each one
  // carries both languages (the same convention as the balance message in leave-service).
  if (!input.requested_check_in && !input.requested_check_out) {
    return fail(400, 'Provide a corrected check-in and/or check-out time / أدخل وقت الحضور أو الانصراف المصحّح')
  }
  // The portal now lets an employee pick ANY day (the "I forgot to check in" case has no
  // attendance row to start from), so the date is no longer implied by an existing record.
  // A day that hasn't happened yet has nothing to correct. Oman's today, never UTC's.
  if (input.date > omanToday()) {
    return fail(400, 'You cannot request a correction for a future date / لا يمكن طلب تصحيح لتاريخ مستقبلي')
  }

  // One open request per employee/day keeps the queue unambiguous.
  const { rows: dup } = await pool.query(
    "SELECT id FROM attendance_corrections WHERE employee_id = $1 AND date = $2 AND status = 'pending'",
    [input.employee_id, input.date]
  )
  if (dup.length > 0) {
    return fail(409, 'You already have a pending correction request for this date / لديك طلب تصحيح معلّق لهذا التاريخ بالفعل')
  }

  const { rows } = await pool.query(
    `INSERT INTO attendance_corrections (employee_id, date, requested_check_in, requested_check_out, reason)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [input.employee_id, input.date, input.requested_check_in || null, input.requested_check_out || null, input.reason]
  )
  return ok(rows[0])
}

export async function reviewCorrection(
  id: string,
  status: 'approved' | 'rejected',
  actor: Actor,
  rawNote?: string | null
): Promise<ServiceResult<unknown>> {
  const note = normalizeNote(rawNote)
  const noteProblem = checkDecisionNote(status, note)
  if (noteProblem) return noteProblem

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // date::text — never let a DATE round-trip through a JS Date. Postgres returns it as
    // local midnight, and toISOString() then converts to UTC, which rolls back a day in
    // any timezone ahead of UTC. Oman is UTC+4, so approving a correction for the 10th
    // was rewriting attendance for the 9th.
    const { rows: cur } = await client.query(
      'SELECT id, employee_id, date::text AS date, requested_check_in::text AS requested_check_in, requested_check_out::text AS requested_check_out, status FROM attendance_corrections WHERE id = $1 FOR UPDATE',
      [id]
    )
    if (cur.length === 0) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found')
    }
    const req = cur[0]
    if (req.status !== 'pending') {
      await client.query('ROLLBACK')
      return fail(400, `Request is already ${req.status}`)
    }

    // Already a 'YYYY-MM-DD' string thanks to the date::text cast above.
    const dateStr: string = req.date

    let refundedDays = 0
    if (status === 'approved') {
      // Apply the requested times to the attendance row, recomputing hours/overtime.
      const { rows: existing } = await client.query(
        'SELECT check_in::text as check_in, check_out::text as check_out, status FROM attendance WHERE employee_id = $1 AND date = $2',
        [req.employee_id, dateStr]
      )
      const checkIn = req.requested_check_in || existing[0]?.check_in || null
      const checkOut = req.requested_check_out || existing[0]?.check_out || null

      const holidayWork = await isOffDayFor(req.employee_id, dateStr)
      const normalHours = (await resolveSchedule(req.employee_id)).workHoursPerDay

      let workHours = 0
      if (checkIn && checkOut) workHours = computeWorkHours(String(checkIn), String(checkOut)) ?? 0
      const overtime = computeOvertime(workHours, normalHours, holidayWork)

      await client.query(
        `INSERT INTO attendance (employee_id, date, check_in, check_out, work_hours, overtime_hours, status, is_holiday_work, notes)
         VALUES ($1, $2, $3, $4, $5, $6, 'present', $7, '[Corrected]')
         ON CONFLICT (employee_id, date) DO UPDATE SET
           check_in = $3, check_out = $4, work_hours = $5, overtime_hours = $6,
           status = 'present', is_holiday_work = $7,
           notes = COALESCE(attendance.notes, '') || ' [Corrected]'`,
        [req.employee_id, dateStr, checkIn, checkOut, workHours, overtime, holidayWork]
      )

      // The most common correction is "I was here, the system marked me absent". That
      // absence charged a leave day (src/lib/auto-absence.ts), and approving the correction
      // turned the day 'present' without giving it back, so the employee lost a day of
      // leave for a day the admin had just agreed they worked. Refund it here, in the same
      // transaction, exactly as the admin attendance edits do.
      if (existing[0]?.status === 'absent') {
        refundedDays = await reverseAutoAbsenceLeave(client, req.employee_id, dateStr)
      }
    }

    const { rows } = await client.query(
      `UPDATE attendance_corrections
          SET status = $1, reviewed_by = $2, reviewed_at = NOW(), decision_note = $4
        WHERE id = $3
        RETURNING id, employee_id, date::text AS date, requested_check_in::text AS requested_check_in,
                  requested_check_out::text AS requested_check_out, reason, status,
                  reviewed_by, reviewed_at, decision_note, created_at`,
      [status, actorLabel(actor), id, note]
    )

    await client.query('COMMIT')

    await logAudit(
      'attendance_correction',
      actorLabel(actor),
      actor.role,
      `Correction #${id} ${status} for emp ${req.employee_id} on ${dateStr}` +
        (refundedDays > 0 ? `; refunded ${refundedDays} absence leave day(s)` : '') +
        (note ? ` — note: ${note}` : '')
    )
    await notifyDecision(req.employee_id, 'correction', status, { date: dateStr }, note, id)

    return ok(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
