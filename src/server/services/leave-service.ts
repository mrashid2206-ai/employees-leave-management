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

  const { rows: existingLeaves } = await pool.query(
    "SELECT id FROM leave_requests WHERE employee_id = $1 AND status IN ('pending', 'approved') AND start_date <= $2 AND end_date >= $3",
    [employee_id, end_date, start_date]
  )
  if (existingLeaves.length > 0) {
    return fail(409, 'Employee already has a pending or approved leave for these dates')
  }


  try {
    const { rows } = await pool.query(
      `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status, is_half_day)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [employee_id, leave_type_id, start_date, end_date, finalDays, notes || null, status || 'pending', isHalfDay]
    )

    // Alert the admin when a request lands PENDING so approvals aren't discovered by
    // chance. Fire-and-forget: email failure never blocks the request.
    if (rows[0]?.status === 'pending') {
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

    return ok(rows[0])
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (msg.includes('Overlapping')) {
      return fail(409, 'Overlapping leave request exists for this employee')
    }
    return fail(500, 'Failed to create leave request')
  }
}

export async function changeLeaveStatus(
  id: string,
  status: string,
  actor: Actor
): Promise<ServiceResult<Record<string, unknown>>> {
  if (!['approved', 'rejected', 'pending'].includes(status)) {
    return fail(400, 'Invalid status')
  }


  const client = await pool.connect()
  let rows: LeaveRecord[]
  let currentLeave: LeaveRecord
  let previousStatus: string
  let balanceAfter: number | null = null
  try {
    await client.query('BEGIN')

    const { rows: lockedLeave } = await client.query('SELECT * FROM leave_requests WHERE id = $1 FOR UPDATE', [id])
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
    }

    // Lock the employee row so the balance mutation is race-free. By owner policy an
    // insufficient/negative balance does NOT block approval.
    await client.query('SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE', [currentLeave.employee_id])

    const result = await client.query(
      'UPDATE leave_requests SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
      [status, id]
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

  await logAudit('leave_status_change', actorLabel(actor), actor.role, `Leave #${id} changed to ${status} for emp ${currentLeave.employee_id}`)

  const statusEn = status === 'approved' ? 'approved' : status === 'rejected' ? 'rejected' : 'updated'
  const statusAr = status === 'approved' ? 'تمت الموافقة' : status === 'rejected' ? 'تم الرفض' : 'تم التحديث'
  await notifyEmployee(
    currentLeave.employee_id,
    `Your leave request (${currentLeave.start_date} to ${currentLeave.end_date}) has been ${statusEn}`,
    `طلب إجازتك (${currentLeave.start_date} إلى ${currentLeave.end_date}) ${statusAr}`
  )

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
