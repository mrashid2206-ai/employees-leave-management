import { AUTO_ABSENCE_LEAVE_NOTE, LEAVE_TYPE_ANNUAL } from '@/lib/constants'

interface TxClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
}

// An unexcused absence costs one annual leave day. The charge and the refund are a matched
// pair and BOTH live here, because they were previously split: the nightly automation
// charged inline, while the admin-facing attendance routes only ever refunded. Marking
// someone absent by hand — or importing absences in bulk — therefore recorded the absence
// and deducted nothing, so days taken without a leave request were free.
//
// Both directions must be called inside a transaction (pass the client running
// BEGIN/COMMIT) so the leave row and the balance can never disagree.

export interface AppliedAbsence {
  leaveId: number
  days: number
}

/**
 * Charge one annual leave day for an unexcused absence on `date`.
 *
 * Idempotent and safe to call on every write that sets a day to 'absent':
 *  - does nothing if ANY leave request already covers that single day (including a
 *    previous auto-deduction, or a real request the employee filed);
 *  - does nothing when the balance is already at or below zero, matching the
 *    long-standing automation behaviour. Note this is "don't charge someone with nothing
 *    left", not "never go negative": a balance of 0.5 is still charged a full day and
 *    lands at -0.5, exactly as the automation has always behaved.
 *
 * Returns the created leave and days charged, or null if nothing was charged.
 */
export async function applyAutoAbsenceLeave(
  client: TxClient,
  employeeId: number,
  date: string
): Promise<AppliedAbsence | null> {
  const { rows: typeRows } = await client.query(
    'SELECT id FROM leave_types WHERE name_en = $1 ORDER BY id LIMIT 1',
    [LEAVE_TYPE_ANNUAL]
  )
  const annualTypeId = (typeRows[0]?.id as number) ?? 1

  // Lock the employee row so a concurrent write cannot deduct twice.
  const { rows: balanceRows } = await client.query(
    'SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE',
    [employeeId]
  )
  if (balanceRows.length === 0) return null

  // The balance is tested in SQL against the (already locked) row rather than passed back
  // as a parameter. Passing it bound it into `$n > 0`, where the integer literal made
  // Postgres infer the parameter as an integer — so any fractional balance ("25.4", which
  // is most of them once tardiness has charged part-days) failed with
  // "invalid input syntax for type integer".
  const { rows: inserted } = await client.query(
    `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status)
     SELECT $1, $2, $3, $3, 1, $4, 'approved'
     WHERE EXISTS (SELECT 1 FROM employees WHERE id = $1 AND leave_balance > 0)
       AND NOT EXISTS (
         SELECT 1 FROM leave_requests
          WHERE employee_id = $1 AND start_date = $3 AND end_date = $3
            AND status <> 'cancelled'
       )
     RETURNING id`,
    [employeeId, annualTypeId, date, AUTO_ABSENCE_LEAVE_NOTE]
  )
  if (inserted.length === 0) return null

  await client.query(
    'UPDATE employees SET leave_balance = leave_balance - 1, updated_at = NOW() WHERE id = $1',
    [employeeId]
  )
  return { leaveId: inserted[0].id as number, days: 1 }
}

/**
 * Cancel the auto-deducted absence leave for (employee, date) and refund the balance.
 * Idempotent: only acts on a still-approved auto-leave, so calling it when none exists
 * (or after it was already cancelled) is a no-op. Returns days refunded.
 */
export async function reverseAutoAbsenceLeave(client: TxClient, employeeId: number, date: string): Promise<number> {
  const { rows } = await client.query(
    `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW()
       WHERE employee_id = $1 AND start_date = $2 AND end_date = $2
         AND status = 'approved' AND notes = $3
     RETURNING days_count`,
    [employeeId, date, AUTO_ABSENCE_LEAVE_NOTE]
  )
  let refunded = 0
  for (const r of rows) {
    await client.query('UPDATE employees SET leave_balance = leave_balance + $1 WHERE id = $2', [r.days_count, employeeId])
    refunded += parseFloat(String(r.days_count))
  }
  return refunded
}
