import pool from '@/lib/db'

// Compare each stored leave balance against what the records say it should be.
//
// The stored balance is a running total mutated by many paths — approve, reject, edit,
// delete, absence charge and refund, tardiness penalty, yearly reset. Two separate bugs
// have already let it drift silently, and both were found by accident. This turns drift
// into a number that can be checked on a schedule instead of noticed by luck.
//
// Reporting only. Nothing here writes: drift can be a deliberate manual adjustment by an
// admin, and overwriting a balance from a formula would destroy that intent.

export interface BalanceDrift {
  id: number
  name: string
  stored: number
  approvedDays: number
  tardinessDays: number
  expected: number
  drift: number
}

const SQL = `
  WITH s AS (SELECT annual_leave_balance, year_start, year_end FROM settings ORDER BY id LIMIT 1)
  SELECT e.id,
         e.name,
         e.leave_balance::float8 AS stored,
         COALESCE(lv.days, 0)::float8 AS approved_days,
         COALESCE(td.days, 0)::float8 AS tardiness_days,
         (s.annual_leave_balance - COALESCE(lv.days, 0) - COALESCE(td.days, 0))::float8 AS expected
    FROM employees e
    CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT SUM(days_count) AS days FROM leave_requests lr
       WHERE lr.employee_id = e.id AND lr.status = 'approved'
         AND lr.start_date >= s.year_start AND lr.end_date <= s.year_end
    ) lv ON true
    LEFT JOIN LATERAL (
      SELECT SUM(leave_deducted) AS days FROM tardiness_log t
       WHERE t.employee_id = e.id AND t.date >= s.year_start AND t.date <= s.year_end
    ) td ON true
   WHERE e.is_active = true
   ORDER BY e.name`

export interface ReconcileReport {
  checked: number
  drifting: BalanceDrift[]
  totalAbsoluteDrift: number
  threshold: number
}

export async function reconcileBalances(threshold = 0.01): Promise<ReconcileReport> {
  const { rows } = await pool.query(SQL)

  const drifting = rows
    .map(r => ({
      id: r.id,
      name: r.name,
      stored: r.stored,
      approvedDays: r.approved_days,
      tardinessDays: r.tardiness_days,
      expected: Math.round(r.expected * 1000) / 1000,
      drift: Math.round((r.stored - r.expected) * 1000) / 1000,
    }))
    .filter(r => Math.abs(r.drift) > threshold)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))

  return {
    checked: rows.length,
    drifting,
    totalAbsoluteDrift: Math.round(drifting.reduce((s, r) => s + Math.abs(r.drift), 0) * 1000) / 1000,
    threshold,
  }
}
