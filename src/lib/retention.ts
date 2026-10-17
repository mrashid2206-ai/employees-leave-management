import pool from '@/lib/db'

// Pruning for the tables that only ever grow.
//
// Nothing deleted from these: rate_limits gets a row per login key (username + IP, IP,
// username) and never drops one, error_log gets a row per server error, and the
// automation journal gets a run every night plus one effect per change it made. None of
// them is big today, but unbounded tables are the kind of slow problem nobody notices
// until queries over them get slow or the database fills.
//
// Run nightly from /api/cron/daily, after the catch-up.

// Errors older than this are history nobody will act on; the recent ones are what
// Settings → Error log is for.
export const ERROR_LOG_RETENTION_DAYS = 90

// Automation runs are the undo history (Settings → Automation), so keep well over a
// year: a yearly reset that went wrong must still be reversible when someone notices it
// at the next one. Their effects go with them (ON DELETE CASCADE).
//
// Pruning can't make the nightly catch-up think old days are owed: it only looks back
// MAX_CATCH_UP_DAYS (14), and anything recent enough to matter is far inside this window.
export const AUTOMATION_RUN_RETENTION_DAYS = 400

export interface PruneResult {
  rateLimits: number
  errorLog: number
  automationRuns: number
}

/**
 * Delete what's past its retention. Each step is independent and idempotent, so a
 * failure part-way leaves nothing inconsistent; the next night just deletes the rest.
 * Throws on a DB error: the caller decides whether that matters (the cron logs it).
 */
export async function pruneExpired(): Promise<PruneResult> {
  // A row whose window has passed is already treated as fresh by checkRateLimit (it
  // restarts the count), so deleting it changes no one's limit.
  const rateLimits = await pool.query('DELETE FROM rate_limits WHERE reset_at < NOW()')

  const errorLog = await pool.query(
    `DELETE FROM error_log WHERE created_at < NOW() - make_interval(days => $1)`,
    [ERROR_LOG_RETENTION_DAYS]
  )

  const automationRuns = await pool.query(
    `DELETE FROM automation_runs WHERE created_at < NOW() - make_interval(days => $1)`,
    [AUTOMATION_RUN_RETENTION_DAYS]
  )

  return {
    rateLimits: rateLimits.rowCount ?? 0,
    errorLog: errorLog.rowCount ?? 0,
    automationRuns: automationRuns.rowCount ?? 0,
  }
}
