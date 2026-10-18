import pool, { omanToday } from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { sendMail } from '@/lib/email'
import { notifyEmployee } from '@/lib/employee-notify'
import { countLeaveDays } from '@/lib/leave-days'
import {
  LEAVE_TYPE_EMERGENCY,
  LEAVE_TYPE_SICK,
  EMERGENCY_LEAVE_MAX_DAYS,
  SICK_LEAVE_NOTES_THRESHOLD,
  MAX_CONSECUTIVE_LEAVE_DAYS,
} from '@/lib/constants'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'
import { checkDecisionNote, normalizeNote, notifyDecision } from '@/server/decision'
import { logger } from '@/lib/log'
import type { PoolClient } from 'pg'

// All leave business rules live here: creation validation, the approve/reject state
// machine, admin edits and deletion — every path that can move an employee's balance.
// Routes are thin (auth -> parse -> service -> respond).

export interface LeaveRecord {
  id: number
  employee_id: number
  leave_type_id: number
  start_date: string
  end_date: string
  days_count: string | number
  status: string
  is_half_day?: boolean
}

export interface LeaveCreateInput {
  employee_id: number
  leave_type_id: number
  start_date: string
  end_date: string
  notes?: string | null
  is_half_day?: boolean
  status?: string
  force?: boolean
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  pending: ['approved', 'rejected'],
  approved: ['rejected', 'pending'],
  rejected: ['pending'],
  cancelled: [], // terminal
}

export async function createLeave(input: LeaveCreateInput, actor: Actor): Promise<ServiceResult<LeaveRecord>> {
  const { employee_id, leave_type_id, start_date, end_date, notes, is_half_day } = input

  // Employees can only create leaves for themselves, always as pending.
  let status = input.status
  if (actor.role === 'employee') {
    if (actor.id !== employee_id) return fail(403, 'Forbidden')
    status = 'pending'
  }

  if (new Date(end_date) < new Date(start_date)) {
    return fail(400, 'End date must be after start date')
  }

  // Block leave requests in the past (non-admins): neither start nor end may precede today.
  const today = omanToday()
  if (actor.role !== 'admin' && (start_date < today || end_date < today)) {
    return fail(400, 'Cannot create leave for past dates')
  }

  // Settings drive fiscal-year and limit enforcement — a missing row is a hard error
  // rather than silently disabling all those checks.
  const { rows: settingsRows } = await pool.query(
    'SELECT year_start::text as year_start, year_end::text as year_end, max_absent_same_dept FROM settings ORDER BY id LIMIT 1'
  )
  if (!settingsRows[0]) return fail(500, 'System settings are not configured')
  const { year_start, year_end } = settingsRows[0]
  if (start_date < year_start || end_date > year_end) {
    return fail(400, `Leave dates must be within the fiscal year (${year_start} to ${year_end})`)
  }

  const { rows: empInfo } = await pool.query(
    'SELECT department_id, name, leave_balance FROM employees WHERE id = $1',
    [employee_id]
  )

  // Owner policy: employees with no remaining balance cannot SUBMIT new requests.
  // (Admins can still create/approve into negative — flexibility stays with the admin.)
  if (actor.role === 'employee' && empInfo[0] && parseFloat(empInfo[0].leave_balance) <= 0) {
    return fail(400, 'You have no remaining leave balance / لا يوجد رصيد إجازات متبقٍ لديك')
  }

  if (empInfo[0]) {
    const maxAbsent = settingsRows[0].max_absent_same_dept || 2
    const { rows: deptAbsent } = await pool.query(
      "SELECT COUNT(DISTINCT employee_id) as cnt FROM leave_requests WHERE employee_id != $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $3 AND employee_id IN (SELECT id FROM employees WHERE department_id = $4 AND is_active = true)",
      [employee_id, end_date, start_date, empInfo[0].department_id]
    )
    if (parseInt(deptAbsent[0].cnt) >= maxAbsent) {
      if (actor.role === 'employee') {
        return fail(409, 'Maximum department absence limit reached for these dates')
      }
      // Admin gets a warning unless they explicitly force.
      if (!input.force) {
        return fail(
          409,
          `Warning: ${deptAbsent[0].cnt}/${maxAbsent} employees from this department already on leave. Submit again to override.`,
          { warning: true, absentCount: parseInt(deptAbsent[0].cnt), maxAbsent }
        )
      }
    }
  }

  // Server-side day count: calendar days minus public holidays.
  const actualDays = await countLeaveDays(start_date, end_date)
  if (actualDays <= 0) return fail(400, 'No working days in selected range')

  const isHalfDay = !!is_half_day && start_date === end_date
  const finalDays = isHalfDay ? 0.5 : actualDays

  // Leave-type limits — resolve the type by its actual id (never hardcode the SERIAL).
  const { rows: ltCheck } = await pool.query('SELECT name_en FROM leave_types WHERE id = $1', [leave_type_id])
  const leaveTypeName = ltCheck[0]?.name_en || ''

  if (leaveTypeName === LEAVE_TYPE_EMERGENCY) {
    const { rows: emergencyDays } = await pool.query(
      "SELECT COALESCE(SUM(days_count), 0)::numeric as total FROM leave_requests WHERE employee_id = $1 AND leave_type_id = $2 AND status IN ('approved', 'pending') AND start_date >= $3 AND end_date <= $4",
      [employee_id, leave_type_id, year_start, year_end]
    )
    if (parseFloat(emergencyDays[0].total) + finalDays > EMERGENCY_LEAVE_MAX_DAYS) {
      return fail(400, `Emergency leave limit reached (maximum ${EMERGENCY_LEAVE_MAX_DAYS} days per year)`)
    }
  }

  if (leaveTypeName === LEAVE_TYPE_SICK && actualDays > SICK_LEAVE_NOTES_THRESHOLD && !notes) {
    return fail(400, `Sick leave over ${SICK_LEAVE_NOTES_THRESHOLD} days requires notes (e.g. medical certificate reference)`)
  }

  if (actualDays > MAX_CONSECUTIVE_LEAVE_DAYS) {
    return fail(400, `Maximum consecutive leave is ${MAX_CONSECUTIVE_LEAVE_DAYS} days`)
  }

  const { rows: attendanceConflicts } = await pool.query(
    "SELECT date::text as date FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3 AND status = 'present' AND check_in IS NOT NULL",
    [employee_id, start_date, end_date]
  )
  if (attendanceConflicts.length > 0) {
    const dates = attendanceConflicts.map(r => r.date).join(', ')
    return fail(409, `Employee has attendance records on: ${dates}. Cancel or delete those attendance records first.`)
  }

  // The overlap check, the insert and — when the leave is created ALREADY APPROVED — the
  // balance deduction all run in one transaction with the employee row locked.
  //
  // Two bugs lived in the old version of this block. The check and the insert were
  // separate unlocked statements, so two concurrent submissions (a double-clicked button)
  // could both pass the overlap check and both insert. And a leave created directly as
  // 'approved' never deducted anything, because the deduction lived only in the status
  // TRANSITION in changeLeaveStatus — so an admin recording an already-taken leave, or a
  // bulk import, granted the days for free.
  const finalStatus = status || 'pending'
  const client = await pool.connect()
  let createdLeave: LeaveRecord
  try {
    await client.query('BEGIN')
    await client.query('SELECT id FROM employees WHERE id = $1 FOR UPDATE', [employee_id])

    const { rows: existingLeaves } = await client.query(
      "SELECT id FROM leave_requests WHERE employee_id = $1 AND status IN ('pending', 'approved') AND start_date <= $2 AND end_date >= $3",
      [employee_id, end_date, start_date]
    )
    if (existingLeaves.length > 0) {
      await client.query('ROLLBACK')
      return fail(409, 'Employee already has a pending or approved leave for these dates')
    }

    // An admin creating a leave already decided records themselves as the reviewer, the
    // same trace a decision from the queue leaves.
    const decidedNow = finalStatus === 'approved' || finalStatus === 'rejected'
    const { rows } = await client.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status, is_half_day,
                                   reviewed_by, reviewed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $10::boolean THEN NOW() END) RETURNING *`,
      [employee_id, leave_type_id, start_date, end_date, finalDays, notes || null, finalStatus, isHalfDay,
        decidedNow ? actorLabel(actor) : null, decidedNow]
    )
    createdLeave = rows[0]

    if (finalStatus === 'approved') {
      await client.query(
        'UPDATE employees SET leave_balance = leave_balance - $1, updated_at = NOW() WHERE id = $2',
        [finalDays, employee_id]
      )
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('Overlapping')) {
      return fail(409, 'Overlapping leave request exists for this employee')
    }
    return fail(500, 'Failed to create leave request')
  } finally {
    client.release()
  }

  {
    // Alert the admin when a request lands PENDING so approvals aren't discovered by
    // chance. Fire-and-forget: email failure never blocks the request.
    if (createdLeave?.status === 'pending') {
      const empName = empInfo[0]?.name || `Employee #${employee_id}`
      void sendMail({
        to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
        subject: `New Leave Request (pending) - ${empName}`,
        html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1976D2;">طلب إجازة جديد / New Leave Request</h2>
            <p><strong>${empName}</strong></p>
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <tr><td style="padding: 8px; border: 1px solid #ddd;">From / من</td><td style="padding: 8px; border: 1px solid #ddd;">${start_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">To / إلى</td><td style="padding: 8px; border: 1px solid #ddd;">${end_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">Days / أيام</td><td style="padding: 8px; border: 1px solid #ddd;">${finalDays}</td></tr>
            </table>
            <p style="color: #666; font-size: 12px;">Waiting for approval — open the dashboard to approve/reject.</p>
          </div>
        `,
      })
    }

    return ok(createdLeave)
  }
}

// Advisory-lock namespace for "approving a leave in department N" (paired with the id).
const DEPT_ABSENCE_LOCK = 8273642

// How many OTHER active employees of this leave's department already have approved leave
// overlapping it, against the configured maximum. Null when the employee has no
// department. Must run inside the approving transaction.
async function departmentAbsence(
  client: PoolClient,
  leave: LeaveRecord
): Promise<{ absentCount: number; maxAbsent: number } | null> {
  const { rows: emp } = await client.query('SELECT department_id FROM employees WHERE id = $1', [leave.employee_id])
  const deptId = emp[0]?.department_id
  if (deptId == null) return null

  // Serialise approvals within one department until this transaction ends: two admins
  // approving two colleagues at the same moment would otherwise each count the other as
  // not yet on leave, and both get through a limit that only had room for one.
  await client.query('SELECT pg_advisory_xact_lock($1, $2)', [DEPT_ABSENCE_LOCK, deptId])

  const { rows: settings } = await client.query('SELECT max_absent_same_dept FROM settings ORDER BY id LIMIT 1')
  // Same default as createLeave, so filing and approving agree on the number.
  const maxAbsent = settings[0]?.max_absent_same_dept || 2
  const { rows } = await client.query(
    "SELECT COUNT(DISTINCT employee_id) as cnt FROM leave_requests WHERE employee_id != $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $3 AND employee_id IN (SELECT id FROM employees WHERE department_id = $4 AND is_active = true)",
    [leave.employee_id, leave.end_date, leave.start_date, deptId]
  )
  return { absentCount: parseInt(rows[0].cnt), maxAbsent }
}

export interface LeaveDecisionOptions {
  /** The admin's remark. Required to reject; shown to the employee. */
  note?: string | null
  /** Approve even though the department's absence limit is reached. */
  force?: boolean
}

// Dates come back as text: a DATE read into a JS Date is local midnight, and printing it
// (in the employee's notification) or serialising it (toISOString, in the API response)
// shifts it by the server's offset from UTC.
const LEAVE_COLUMNS = `id, employee_id, leave_type_id, start_date::text AS start_date, end_date::text AS end_date,
  days_count, is_half_day, notes, status, reviewed_by, reviewed_at, decision_note, created_at, updated_at`

export async function changeLeaveStatus(
  id: string,
  status: string,
  actor: Actor,
  opts: LeaveDecisionOptions = {}
): Promise<ServiceResult<Record<string, unknown>>> {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return fail(400, 'Invalid status')
  }
  const note = normalizeNote(opts.note)
  const noteProblem = checkDecisionNote(status, note)
  if (noteProblem) return noteProblem

  const client = await pool.connect()
  let rows: LeaveRecord[]
  let currentLeave: LeaveRecord
  let previousStatus: string
  let balanceAfter: number | null = null
  let limitOverridden = false
  try {
    await client.query('BEGIN')

    const { rows: lockedLeave } = await client.query(`SELECT ${LEAVE_COLUMNS} FROM leave_requests WHERE id = $1 FOR UPDATE`, [id])
    if (lockedLeave.length === 0) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found')
    }
    currentLeave = lockedLeave[0]
    previousStatus = currentLeave.status

    if (currentLeave.status === status) {
      await client.query('ROLLBACK')
      return fail(400, 'Already in this status')
    }
    if (!VALID_TRANSITIONS[previousStatus]?.includes(status)) {
      await client.query('ROLLBACK')
      return fail(400, `Cannot change from ${previousStatus} to ${status}`)
    }

    // Never approve into a day the employee actually worked (both "present" and "on
    // leave" would be true, and they'd be wrongly charged a leave day).
    if (status === 'approved' && previousStatus !== 'approved') {
      const { rows: att } = await client.query(
        `SELECT a.date::text as date FROM attendance a
           WHERE a.employee_id = $1 AND a.status = 'present' AND a.check_in IS NOT NULL
             AND a.date >= (SELECT start_date FROM leave_requests WHERE id = $2)
             AND a.date <= (SELECT end_date FROM leave_requests WHERE id = $2)
           ORDER BY a.date`,
        [currentLeave.employee_id, id]
      )
      if (att.length > 0) {
        await client.query('ROLLBACK')
        return fail(
          409,
          `Cannot approve: employee has attendance on ${att.map(r => r.date).join(', ')}. Delete those attendance records (or shorten the leave) first.`,
          { attendanceConflict: true, dates: att.map(r => r.date) }
        )
      }

      // The department absence limit. createLeave checks it when a request is filed, but
      // a request filed while the department had room can be approved after others have
      // been — approval is the moment the absence becomes real, so it is checked again
      // here, with the same admin override createLeave offers (`force`). Without this a
      // bulk approval of a busy week went straight past the limit.
      const limit = await departmentAbsence(client, currentLeave)
      if (limit && limit.absentCount >= limit.maxAbsent) {
        if (!opts.force) {
          await client.query('ROLLBACK')
          return fail(
            409,
            `Warning: ${limit.absentCount}/${limit.maxAbsent} employees from this department are already on leave for these dates. Approve again with the override to proceed. / تحذير: ${limit.absentCount}/${limit.maxAbsent} من موظفي هذا القسم في إجازة خلال هذه التواريخ. أعد الموافقة مع التجاوز للمتابعة.`,
            { warning: true, deptLimit: true, absentCount: limit.absentCount, maxAbsent: limit.maxAbsent }
          )
        }
        limitOverridden = true
      }
    }

    // Lock the employee row so the balance mutation is race-free. By owner policy an
    // insufficient/negative balance does NOT block approval.
    await client.query('SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE', [currentLeave.employee_id])

    // A decision records who made it, when and why. Sending a request back to pending
    // un-decides it, so the previous decision's trace is cleared (the audit log keeps it).
    const decided = status === 'approved' || status === 'rejected'
    const result = await client.query(
      `UPDATE leave_requests
          SET status = $1, updated_at = NOW(),
              reviewed_by = $3, reviewed_at = CASE WHEN $4::boolean THEN NOW() END, decision_note = $5
        WHERE id = $2 RETURNING ${LEAVE_COLUMNS}`,
      [status, id, decided ? actorLabel(actor) : null, decided, decided ? note : null]
    )
    rows = result.rows

    if (status === 'approved' && previousStatus !== 'approved') {
      const upd = await client.query(
        'UPDATE employees SET leave_balance = leave_balance - $1 WHERE id = $2 RETURNING leave_balance',
        [currentLeave.days_count, currentLeave.employee_id]
      )
      balanceAfter = parseFloat(upd.rows[0]?.leave_balance)
    } else if (previousStatus === 'approved' && status !== 'approved') {
      const upd = await client.query(
        'UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2 RETURNING leave_balance',
        [currentLeave.days_count, currentLeave.employee_id]
      )
      balanceAfter = parseFloat(upd.rows[0]?.leave_balance)
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await logAudit(
    'leave_status_change',
    actorLabel(actor),
    actor.role,
    `Leave #${id} changed to ${status} for emp ${currentLeave.employee_id}` +
      (limitOverridden ? ' (department absence limit overridden)' : '') +
      (note ? ` — note: ${note}` : '')
  )

  if (status === 'approved' || status === 'rejected') {
    await notifyDecision(
      currentLeave.employee_id,
      'leave',
      status,
      { start: currentLeave.start_date, end: currentLeave.end_date },
      note,
      id
    )
  } else {
    // Back to pending isn't a decision; the bell says so, without a push.
    await notifyEmployee(
      currentLeave.employee_id,
      `Your leave request (${currentLeave.start_date} to ${currentLeave.end_date}) is pending review again.`,
      `طلب إجازتك (${currentLeave.start_date} إلى ${currentLeave.end_date}) عاد إلى قيد المراجعة.`
    )
  }

  // Best-effort email; never blocks the decision.
  try {
    const leave = rows[0]
    const { rows: empRows } = await pool.query('SELECT name FROM employees WHERE id = $1', [leave.employee_id])
    const empName = empRows[0]?.name || 'Employee'
    const statusText = status === 'approved' ? 'Approved ✅' : status === 'rejected' ? 'Rejected ❌' : 'Pending ⏳'
    const statusArEmail = status === 'approved' ? 'موافق عليها ✅' : status === 'rejected' ? 'مرفوضة ❌' : 'معلقة ⏳'
    void sendMail({
      to: process.env.NOTIFY_EMAIL || process.env.SMTP_USER,
      subject: `Leave Request ${statusText} - ${empName}`,
      html: `
          <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #1976D2;">Leave Request Update / تحديث طلب إجازة</h2>
            <p><strong>${empName}</strong></p>
            <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
              <tr><td style="padding: 8px; border: 1px solid #ddd;">Status / الحالة</td><td style="padding: 8px; border: 1px solid #ddd;"><strong>${statusArEmail} / ${statusText}</strong></td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">From / من</td><td style="padding: 8px; border: 1px solid #ddd;">${leave.start_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">To / إلى</td><td style="padding: 8px; border: 1px solid #ddd;">${leave.end_date}</td></tr>
              <tr><td style="padding: 8px; border: 1px solid #ddd;">Days / أيام</td><td style="padding: 8px; border: 1px solid #ddd;">${leave.days_count}</td></tr>
            </table>
            <p style="color: #666; font-size: 12px;">Leave & Tardiness Management System</p>
          </div>
        `,
    })
  } catch {
    // Email failure shouldn't block the approval
  }

  return ok({ ...rows[0], balance_after: balanceAfter })
}

export interface BulkDecisionItem {
  id: number
  ok: boolean
  /** Why this one was refused (the same message a single decision would return). */
  error?: string
  status?: number
  /** Refused only because of the department limit — the override would let it through. */
  warning?: boolean
  balance_after?: number | null
}

export interface BulkDecisionResult {
  results: BulkDecisionItem[]
  succeeded: number
  failed: number
}

/**
 * Decide many leave requests at once. Each id goes through changeLeaveStatus, one after
 * another — the same transaction, balance deduction, attendance-conflict check and
 * department limit as deciding it alone — and each gets its own result, so one refusal
 * neither aborts the rest nor hides behind a blanket "updated". Sequential on purpose:
 * the department limit depends on the approvals before it.
 */
export async function bulkChangeLeaveStatus(
  ids: number[],
  status: 'approved' | 'rejected',
  actor: Actor,
  opts: LeaveDecisionOptions = {}
): Promise<ServiceResult<BulkDecisionResult>> {
  const note = normalizeNote(opts.note)
  const noteProblem = checkDecisionNote(status, note)
  if (noteProblem) return noteProblem

  const results: BulkDecisionItem[] = []
  for (const id of [...new Set(ids)]) {
    try {
      const r = await changeLeaveStatus(String(id), status, actor, { note, force: opts.force })
      if (r.ok) {
        results.push({ id, ok: true, balance_after: (r.data.balance_after as number | null) ?? null })
      } else {
        results.push({
          id,
          ok: false,
          status: r.status,
          error: String(r.body.error ?? 'Failed'),
          ...(r.body.warning ? { warning: true } : {}),
        })
      }
    } catch (e) {
      logger.error('bulk leave decision failed', e)
      results.push({ id, ok: false, status: 500, error: 'Unexpected error / خطأ غير متوقع' })
    }
  }
  const succeeded = results.filter(r => r.ok).length
  return ok({ results, succeeded, failed: results.length - succeeded })
}

export async function editLeaveDates(
  id: string,
  start_date: string,
  end_date: string,
  actor: Actor
): Promise<ServiceResult<LeaveRecord>> {
  if (!start_date || !end_date) return fail(400, 'Start and end date required')
  if (new Date(end_date) < new Date(start_date)) return fail(400, 'End date must be after start date')


  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: cur } = await client.query('SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE', [id])
    if (cur.length === 0) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found')
    }
    const oldLeave = cur[0]
    const oldDays = parseFloat(oldLeave.days_count)

    const { rows: settingsRows } = await client.query(
      'SELECT year_start::text as year_start, year_end::text as year_end FROM settings ORDER BY id LIMIT 1'
    )
    if (!settingsRows[0]) {
      await client.query('ROLLBACK')
      return fail(500, 'System settings are not configured')
    }
    const { year_start, year_end } = settingsRows[0]
    if (start_date < year_start || end_date > year_end) {
      await client.query('ROLLBACK')
      return fail(400, `Leave dates must be within the fiscal year (${year_start} to ${year_end})`)
    }

    const newDays = oldLeave.is_half_day && start_date === end_date
      ? 0.5
      : await countLeaveDays(start_date, end_date, client)
    if (newDays <= 0) {
      await client.query('ROLLBACK')
      return fail(400, 'Invalid date range')
    }
    if (newDays > MAX_CONSECUTIVE_LEAVE_DAYS) {
      await client.query('ROLLBACK')
      return fail(400, `Maximum consecutive leave is ${MAX_CONSECUTIVE_LEAVE_DAYS} days`)
    }

    const { rows: overlap } = await client.query(
      "SELECT id FROM leave_requests WHERE employee_id = $1 AND id != $2 AND status IN ('pending', 'approved') AND start_date <= $3 AND end_date >= $4",
      [oldLeave.employee_id, id, end_date, start_date]
    )
    if (overlap.length > 0) {
      await client.query('ROLLBACK')
      return fail(409, 'Overlaps another pending or approved leave for this employee')
    }

    const { rows: att } = await client.query(
      "SELECT date::text as date FROM attendance WHERE employee_id = $1 AND date >= $2 AND date <= $3 AND status = 'present' AND check_in IS NOT NULL",
      [oldLeave.employee_id, start_date, end_date]
    )
    if (att.length > 0) {
      await client.query('ROLLBACK')
      return fail(409, `Employee has attendance records on: ${att.map(r => r.date).join(', ')}`)
    }

    const { rows: typeInfo } = await client.query('SELECT name_en FROM leave_types WHERE id = $1', [oldLeave.leave_type_id])
    if (typeInfo[0]?.name_en === LEAVE_TYPE_EMERGENCY) {
      const { rows: em } = await client.query(
        "SELECT COALESCE(SUM(days_count), 0)::numeric as total FROM leave_requests WHERE employee_id = $1 AND leave_type_id = $2 AND id != $3 AND status IN ('approved', 'pending') AND start_date >= $4 AND end_date <= $5",
        [oldLeave.employee_id, oldLeave.leave_type_id, id, year_start, year_end]
      )
      if (parseFloat(em[0].total) + newDays > EMERGENCY_LEAVE_MAX_DAYS) {
        await client.query('ROLLBACK')
        return fail(400, `Emergency leave limit would be exceeded (max ${EMERGENCY_LEAVE_MAX_DAYS} days/year)`)
      }
    }

    // Adjust balance only for approved leaves. Negative balances are allowed by policy.
    if (oldLeave.status === 'approved' && newDays !== oldDays) {
      const diff = oldDays - newDays
      await client.query('SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE', [oldLeave.employee_id])
      await client.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [diff, oldLeave.employee_id])
    }

    const { rows } = await client.query(
      'UPDATE leave_requests SET start_date = $1, end_date = $2, days_count = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [start_date, end_date, newDays, id]
    )

    await client.query('COMMIT')
    await logAudit('leave_edited', actorLabel(actor), actor.role, `Leave #${id} edited: ${oldLeave.start_date}→${start_date}, ${oldLeave.end_date}→${end_date}, days ${oldDays}→${newDays}`)
    return ok(rows[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function deleteLeave(id: string, actor: Actor): Promise<ServiceResult<{ success: true }>> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query('SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE', [id])
    if (rows.length === 0) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found')
    }
    const leave = rows[0]

    // Employees may only cancel their own, still-pending requests.
    if (actor.role === 'employee') {
      if (leave.employee_id !== actor.id) {
        await client.query('ROLLBACK')
        return fail(403, 'Forbidden')
      }
      if (leave.status !== 'pending') {
        await client.query('ROLLBACK')
        return fail(400, 'Only pending requests can be cancelled')
      }
    }

    // Restore balance for an approved leave before deleting.
    if (leave.status === 'approved') {
      await client.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [leave.days_count, leave.employee_id])
    }

    await client.query('DELETE FROM leave_requests WHERE id = $1', [id])
    await client.query('COMMIT')

    await logAudit('leave_deleted', actorLabel(actor), actor.role, `Leave #${id} (${leave.status}) deleted for emp ${leave.employee_id}`)
    return ok({ success: true as const })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
