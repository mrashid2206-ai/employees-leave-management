import type { PoolClient } from 'pg'
import pool from '@/lib/db'
import { logAudit } from '@/lib/audit'
import { changedFields, formatChanges } from '@/lib/audit-diff'
import { bumpTokenVersion } from '@/lib/token-version'
import { EMPLOYEE_COLUMNS } from '@/server/employee-columns'
import { ok, fail, type ServiceResult, type Actor, actorLabel } from '@/server/result'

// Employee edits and (de)activation.
//
// Deactivation used to have two implementations: DELETE cancelled pending leave, ended
// sessions and wrote an audit entry, while the list's on/off toggle (a PUT with
// is_active: false) only ended sessions. The same action had different consequences
// depending on which button was pressed. Both now go through applyActive (the writes,
// session revocation included, in one transaction) and afterActive (the audit entry).

// password_hash is deliberately NOT updatable here. Passwords go through
// /api/employees/[id]/reset-password, which hashes properly, enforces the length policy
// and revokes existing sessions. Allowing a raw write here meant a plaintext value could
// be stored as if it were a hash, silently locking the account out of every future login.
const EDITABLE_FIELDS = ['name', 'department_id', 'leave_balance', 'is_active', 'username', 'email', 'phone', 'position', 'join_date', 'work_start_time', 'work_days', 'work_hours_per_day']

// A cleared schedule field means "inherit the department/global schedule", i.e. NULL.
// An empty string would otherwise blow up on the TIME/INT columns.
const SCHEDULE_FIELDS = new Set(['work_start_time', 'work_days', 'work_hours_per_day'])

// Recorded as "changed" in the audit log without their values (personal data).
const PRIVATE_FIELDS = ['email', 'phone']

export const BALANCE_REASON_MAX = 500

export type EmployeeRow = Record<string, unknown> & { id: number; name: string; is_active: boolean; leave_balance: number }

interface ActiveChange {
  wasActive: boolean
  cancelledLeaves: number
}

/** The writes for (de)activation, on the caller's transaction. */
async function applyActive(client: PoolClient, emp: EmployeeRow, active: boolean): Promise<ActiveChange> {
  await client.query('UPDATE employees SET is_active = $2, updated_at = NOW() WHERE id = $1', [emp.id, active])
  let cancelledLeaves = 0
  if (!active) {
    // Pending requests from someone who has left would otherwise sit in the approval
    // queue, and approving one would still deduct from their balance.
    const { rowCount } = await client.query(
      "UPDATE leave_requests SET status = 'cancelled', updated_at = NOW() WHERE employee_id = $1 AND status = 'pending'",
      [emp.id]
    )
    cancelledLeaves = rowCount ?? 0
    // Offboarding must actually end access, not wait up to 12h for the JWT to expire.
    // In the same transaction, so a revocation that fails rolls the deactivation back and
    // the admin sees an error, instead of a "deactivated" toast for someone whose sessions
    // still work. Bumped even when already inactive: it's free, and a repeated
    // "deactivate" should never leave a session alive.
    await bumpTokenVersion('employee', emp.id, client)
  }
  return { wasActive: emp.is_active, cancelledLeaves }
}

/** The audit entry for a committed (de)activation. */
async function afterActive(emp: EmployeeRow, active: boolean, change: ActiveChange, actor: Actor): Promise<void> {
  if (!active) {
    if (change.wasActive || change.cancelledLeaves > 0) {
      await logAudit('employee_deactivated', actorLabel(actor), actor.role,
        `Deactivated emp ${emp.id} (${emp.name}); cancelled ${change.cancelledLeaves} pending leave request(s)`)
    }
  } else if (!change.wasActive) {
    await logAudit('employee_reactivated', actorLabel(actor), actor.role, `Reactivated emp ${emp.id} (${emp.name})`)
  }
}

async function lockEmployee(client: PoolClient, id: number): Promise<EmployeeRow | null> {
  const { rows } = await client.query(`SELECT ${EMPLOYEE_COLUMNS} FROM employees WHERE id = $1 FOR UPDATE`, [id])
  return rows[0] ?? null
}

function validId(id: string | number): number | null {
  const n = Number(id)
  return Number.isInteger(n) && n > 0 ? n : null
}

export interface ActiveResult {
  success: true
  id: number
  is_active: boolean
  cancelled_leaves: number
}

/** Activate or deactivate an employee: the one implementation behind PUT and DELETE. */
export async function setEmployeeActive(rawId: string | number, active: boolean, actor: Actor): Promise<ServiceResult<ActiveResult>> {
  const id = validId(rawId)
  if (id === null) return fail(404, 'Not found')

  const client = await pool.connect()
  let emp: EmployeeRow | null
  let change: ActiveChange
  try {
    await client.query('BEGIN')
    emp = await lockEmployee(client, id)
    if (!emp) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found')
    }
    change = await applyActive(client, emp, active)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  await afterActive(emp, active, change, actor)
  return ok({ success: true as const, id, is_active: active, cancelled_leaves: change.cancelledLeaves })
}

/**
 * Admin edit of an employee record.
 *
 * Changing leave_balance by hand is the one edit that moves money-equivalent value with
 * no other record behind it (a leave, a tardiness row, an absence), so it requires a
 * reason, which is kept in the audit entry. Re-sending the current balance unchanged is
 * not a change and needs none.
 */
export async function updateEmployee(rawId: string | number, body: Record<string, unknown>, actor: Actor): Promise<ServiceResult<EmployeeRow>> {
  const id = validId(rawId)
  if (id === null) return fail(404, 'Not found')

  const fields = Object.keys(body).filter(k => EDITABLE_FIELDS.includes(k))
  if (fields.length === 0) return fail(400, 'No fields')
  const dataFields = fields.filter(f => f !== 'is_active')

  if ('is_active' in body && typeof body.is_active !== 'boolean') {
    return fail(400, 'is_active must be true or false')
  }
  if ('leave_balance' in body && (body.leave_balance === null || body.leave_balance === '' || !Number.isFinite(Number(body.leave_balance)))) {
    return fail(400, 'leave_balance must be a number / يجب أن يكون رصيد الإجازات رقماً')
  }
  const reason = typeof body.balance_reason === 'string' ? body.balance_reason.trim() : ''
  if (reason.length > BALANCE_REASON_MAX) {
    return fail(400, `Reason must be ${BALANCE_REASON_MAX} characters or fewer / يجب ألا يزيد السبب عن ${BALANCE_REASON_MAX} حرف`)
  }

  const normalise = (field: string, value: unknown) =>
    SCHEDULE_FIELDS.has(field) && (value === '' || value === undefined) ? null : value

  const client = await pool.connect()
  let before: EmployeeRow | null
  let after: EmployeeRow
  let activeChange: ActiveChange | null = null
  try {
    await client.query('BEGIN')
    // Locked so the old→new balance in the audit entry is the one actually replaced.
    before = await lockEmployee(client, id)
    if (!before) {
      await client.query('ROLLBACK')
      return fail(404, 'Not found')
    }

    const balanceChanged = 'leave_balance' in body && Number(body.leave_balance) !== Number(before.leave_balance)
    if (balanceChanged && !reason) {
      await client.query('ROLLBACK')
      return fail(400, 'A reason is required when changing the leave balance / يجب ذكر سبب عند تعديل رصيد الإجازات')
    }

    after = before
    if (dataFields.length > 0) {
      const sets = dataFields.map((f, i) => `${f} = $${i + 2}`).join(', ')
      const values = [id, ...dataFields.map(f => normalise(f, body[f]))]
      try {
        const { rows } = await client.query(
          `UPDATE employees SET ${sets}, updated_at = NOW() WHERE id = $1 RETURNING ${EMPLOYEE_COLUMNS}`,
          values
        )
        after = rows[0]
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          await client.query('ROLLBACK')
          return fail(409, 'Username already exists / اسم المستخدم مستخدم بالفعل')
        }
        throw err
      }
    }

    if (typeof body.is_active === 'boolean') {
      activeChange = await applyActive(client, before, body.is_active)
      after = { ...after, is_active: body.is_active }
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  const who = `emp ${id} (${before.name})`
  const changes = changedFields(before, after, dataFields.filter(f => f !== 'leave_balance'))
  if (changes.length > 0) {
    await logAudit('employee_updated', actorLabel(actor), actor.role, `Edited ${who}: ${formatChanges(changes, PRIVATE_FIELDS)}`)
  }
  if (Number(after.leave_balance) !== Number(before.leave_balance)) {
    await logAudit('leave_balance_adjusted', actorLabel(actor), actor.role,
      `Leave balance for ${who} ${before.leave_balance}→${after.leave_balance}. Reason: ${reason}`)
  }
  if (activeChange) await afterActive(before, Boolean(body.is_active), activeChange, actor)

  return ok(after)
}
