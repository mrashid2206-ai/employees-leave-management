import pool from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'
import { checkDecisionNote, normalizeNote, notifyDecision } from '@/server/decision'

// An admin's decision on a permission (leaving the office mid-day). Approved permission
// time can be deducted from worked hours, so the decision is recorded, audited and told
// to the employee like the other two kinds of request.
//
// It used to be a bare UPDATE in the route: no check of the current state, so an already
// rejected permission could be flipped to approved (or decided twice by two admins), no
// audit entry, and no word to the employee either way.

const STATUS_AR: Record<string, string> = { approved: 'تمت الموافقة عليه', rejected: 'تم رفضه' }

export async function decidePermission(
  id: string,
  status: string,
  actor: Actor,
  rawNote?: string | null
): Promise<ServiceResult<Record<string, unknown>>> {
  if (status !== 'approved' && status !== 'rejected') {
    return fail(400, 'Status must be approved or rejected / يجب أن تكون الحالة موافقة أو رفض')
  }
  const note = normalizeNote(rawNote)
  const noteProblem = checkDecisionNote(status, note)
  if (noteProblem) return noteProblem

  const client = await pool.connect()
  let decided: Record<string, unknown>
  let subject: { employeeId: number; date: string; time: string }
  try {
    await client.query('BEGIN')
    const { rows: cur } = await client.query(
      `SELECT id, employee_id, date::text AS date, leave_time::text AS leave_time, status
         FROM permissions WHERE id = $1 FOR UPDATE`,
      [id]
    )
    if (cur.length === 0) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found / غير موجود')
    }
    // Only a pending request is open to a decision. A second admin acting on a stale page
    // gets told it's already been dealt with instead of silently overwriting the first.
    if (cur[0].status !== 'pending') {
      await client.query('ROLLBACK')
      return fail(
        409,
        `This permission has already been ${cur[0].status} / هذا الاستئذان ${STATUS_AR[cur[0].status] ?? 'تمت مراجعته'} بالفعل`,
        { currentStatus: cur[0].status }
      )
    }
    // Text forms, read under the lock: a DATE through a JS Date prints shifted by the
    // server's UTC offset.
    subject = { employeeId: cur[0].employee_id, date: cur[0].date, time: String(cur[0].leave_time).slice(0, 5) }

    const { rows } = await client.query(
      `UPDATE permissions
          SET status = $1, approved_by = $2, reviewed_at = NOW(), decision_note = $3
        WHERE id = $4
        RETURNING *`,
      [status, actorLabel(actor), note, id]
    )
    decided = rows[0]
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const { employeeId, date, time } = subject
  await logAudit(
    'permission_status_change',
    actorLabel(actor),
    actor.role,
    `Permission #${id} ${status} for emp ${employeeId} on ${date} at ${time}` + (note ? ` — note: ${note}` : '')
  )
  await notifyDecision(employeeId, 'permission', status, { date, time }, note, id)

  return ok(decided)
}
