import pool from '@/lib/db'
import { ensureEmployeeNotificationsTable } from '@/lib/ensure-schema'
import { logger } from '@/lib/log'

// Best-effort in-app notification to an employee (shown in the portal bell). Never
// throws — a notification failure must not break the operation that triggered it.
export async function notifyEmployee(employeeId: number, message: string, messageAr: string): Promise<void> {
  try {
    await ensureEmployeeNotificationsTable()
    await pool.query(
      'INSERT INTO employee_notifications (employee_id, message, message_ar) VALUES ($1, $2, $3)',
      [employeeId, message, messageAr]
    )
  } catch (e) {
    logger.warn('employee notification failed', { employeeId, error: e instanceof Error ? e.message : String(e) })
  }
}
