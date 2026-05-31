import { AUTO_ABSENCE_LEAVE_NOTE } from '@/lib/constants'

interface TxClient {
  query: (text: string, params?: unknown[]) => Promise<{ rows: { days_count: string | number }[]; rowCount: number | null }>
}

// Cancel the auto-deducted "absent without leave" leave for (employee, date) and refund
// the balance. Idempotent: only acts on a still-approved auto-leave, so calling it after
// the leave was already cancelled (or when none exists) is a no-op. Returns days refunded.
// Must be called inside a transaction (pass the same client running BEGIN/COMMIT).
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
