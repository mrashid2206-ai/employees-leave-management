import pool from '@/lib/db'
import { logger } from '@/lib/log'
import type { PoolClient } from 'pg'

// Records what an automation run changed, and knows how to put it back.
//
// The automation mutates leave balances unattended, so "the nightly job did the wrong
// thing" is a permanent risk rather than a one-off. Journalling each mutation with its
// prior state turns the recovery from a hand-written UPDATE against production into a
// button.
//
// Journalling must never break the run it is observing: a failure to record is logged and
// swallowed. The cost of that trade-off is an effect that cannot be reversed, which is
// strictly better than an automation run that dies half-finished.

export type EffectKind =
  | 'absence_marked'
  | 'absence_leave'
  | 'tardiness_created'
  | 'auto_checkout'
  | 'permission_closed'
  | 'yearly_balance'
  | 'yearly_settings'

export interface AutomationRunRow {
  id: number
  kind: string
  target_date: string | null
  actor: string | null
  actor_role: string | null
  summary: Record<string, unknown>
  created_at: string
  reversed_at: string | null
  reversed_by: string | null
  effect_count: number
}

export async function startRun(
  kind: 'daily' | 'yearly',
  targetDate: string | null,
  actor: { username?: string; role: string }
): Promise<number | null> {
  try {
    const { rows } = await pool.query(
      `INSERT INTO automation_runs (kind, target_date, actor, actor_role)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [kind, targetDate, actor.username || 'system', actor.role]
    )
    return rows[0].id as number
  } catch (err) {
    logger.error('automation journal: could not start run', err, { kind, targetDate })
    return null
  }
}

/** Record one reversible change. `client` keeps it inside the caller's transaction. */
export async function recordEffect(
  runId: number | null,
  kind: EffectKind,
  employeeId: number | null,
  payload: Record<string, unknown>,
  client?: PoolClient
): Promise<void> {
  if (runId === null) return
  const q = client ?? pool
  try {
    await q.query(
      'INSERT INTO automation_effects (run_id, kind, employee_id, payload) VALUES ($1, $2, $3, $4)',
      [runId, kind, employeeId, JSON.stringify(payload)]
    )
  } catch (err) {
    logger.error('automation journal: could not record effect', err, { runId, kind, employeeId })
  }
}

export async function finishRun(runId: number | null, summary: Record<string, unknown>): Promise<void> {
  if (runId === null) return
  try {
    await pool.query('UPDATE automation_runs SET summary = $1 WHERE id = $2', [JSON.stringify(summary), runId])
  } catch (err) {
    logger.error('automation journal: could not finish run', err, { runId })
  }
}

export async function listRuns(limit = 30): Promise<AutomationRunRow[]> {
  const { rows } = await pool.query(
    `SELECT r.*, (SELECT COUNT(*)::int FROM automation_effects e WHERE e.run_id = r.id) AS effect_count
       FROM automation_runs r
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT $1`,
    [Math.min(200, Math.max(1, limit))]
  )
  return rows
}

export interface ReverseOutcome {
  ok: boolean
  status: number
  message: string
  reversed?: Record<string, number>
}

/**
 * Undo a run, newest effect first, inside one transaction.
 *
 * Every step is conditional on the row still looking like the automation left it. If an
 * admin has since edited an auto-marked attendance row by hand, that row is skipped
 * rather than clobbered — undoing the robot must not undo a human.
 */
export async function reverseRun(runId: number, actor: { username?: string; role: string }): Promise<ReverseOutcome> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: runRows } = await client.query('SELECT * FROM automation_runs WHERE id = $1 FOR UPDATE', [runId])
    if (runRows.length === 0) {
      await client.query('ROLLBACK')
      return { ok: false, status: 404, message: 'Run not found' }
    }
    if (runRows[0].reversed_at) {
      await client.query('ROLLBACK')
      return { ok: false, status: 409, message: 'This run has already been undone' }
    }

    const { rows: effects } = await client.query(
      'SELECT * FROM automation_effects WHERE run_id = $1 ORDER BY id DESC',
      [runId]
    )

    const reversed: Record<string, number> = {}
    const bump = (k: string, n = 1) => { reversed[k] = (reversed[k] || 0) + n }

    for (const e of effects) {
      const p = e.payload as Record<string, unknown>
      switch (e.kind as EffectKind) {
        case 'absence_marked': {
          // Only remove the row if it is still an untouched 'absent' marker.
          const { rowCount } = await client.query(
            `DELETE FROM attendance
              WHERE employee_id = $1 AND date = $2 AND status = 'absent'
                AND check_in IS NULL AND check_out IS NULL`,
            [e.employee_id, p.date]
          )
          if (rowCount) bump('absencesUnmarked', rowCount)
          break
        }
        case 'absence_leave': {
          const { rowCount } = await client.query('DELETE FROM leave_requests WHERE id = $1', [p.leave_id])
          if (rowCount) {
            await client.query(
              'UPDATE employees SET leave_balance = leave_balance + $1, updated_at = NOW() WHERE id = $2',
              [Number(p.days ?? 1), e.employee_id]
            )
            bump('absenceLeavesRefunded', rowCount)
          }
          break
        }
        case 'tardiness_created': {
          const { rowCount } = await client.query('DELETE FROM tardiness_log WHERE id = $1', [p.tardiness_id])
          if (rowCount) {
            const refund = Number(p.leave_deducted ?? 0)
            if (refund > 0) {
              await client.query(
                'UPDATE employees SET leave_balance = leave_balance + $1, updated_at = NOW() WHERE id = $2',
                [refund, e.employee_id]
              )
            }
            bump('tardinessRemoved', rowCount)
          }
          break
        }
        case 'auto_checkout': {
          // Restore only if the auto-written check-out is still the one on the row.
          const { rowCount } = await client.query(
            `UPDATE attendance
                SET check_out = NULL, work_hours = $1, overtime_hours = $2, notes = $3
              WHERE employee_id = $4 AND date = $5 AND check_out = $6`,
            [p.prev_work_hours ?? null, p.prev_overtime ?? null, p.prev_notes ?? null, e.employee_id, p.date, p.check_out]
          )
          if (rowCount) bump('autoCheckoutsUndone', rowCount)
          break
        }
        case 'permission_closed': {
          const { rowCount } = await client.query(
            'UPDATE permissions SET return_time = $1 WHERE id = $2 AND return_time = $3',
            [p.prev_return_time ?? null, p.permission_id, p.return_time]
          )
          if (rowCount) bump('permissionsReopened', rowCount)
          break
        }
        case 'yearly_balance': {
          const { rowCount } = await client.query(
            'UPDATE employees SET leave_balance = $1, updated_at = NOW() WHERE id = $2',
            [p.prev_balance, e.employee_id]
          )
          if (rowCount) bump('balancesRestored', rowCount)
          break
        }
        case 'yearly_settings': {
          const { rowCount } = await client.query(
            `UPDATE settings SET year_start = $1, year_end = $2, last_reset_year = $3, last_reset_at = $4
              WHERE id = $5`,
            [p.prev_year_start, p.prev_year_end, p.prev_last_reset_year ?? null, p.prev_last_reset_at ?? null, p.settings_id]
          )
          if (rowCount) bump('fiscalYearRestored', rowCount)
          break
        }
      }
    }

    await client.query(
      'UPDATE automation_runs SET reversed_at = NOW(), reversed_by = $1 WHERE id = $2',
      [actor.username || 'admin', runId]
    )

    await client.query('COMMIT')
    return { ok: true, status: 200, message: 'Run undone', reversed }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
