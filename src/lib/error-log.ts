import pool from '@/lib/db'
import { logger } from '@/lib/log'

// Persist server errors so a production 500 is discoverable after the fact.
//
// Until now errors only reached stdout, which means a failure was invisible unless
// somebody happened to be watching Railway logs at that moment. This is deliberately
// dependency-free (no external APM account required); if you later add Sentry, this
// keeps working alongside it.

export interface ErrorRecord {
  message: string
  stack?: string | null
  digest?: string | null
  path?: string | null
  method?: string | null
  source?: string | null
}

// Bound what a single error can write. Stack traces are unbounded in principle and this
// table is written from an error path — the last place that should cause more errors.
const MAX_MESSAGE = 2000
const MAX_STACK = 8000

const clip = (v: string | null | undefined, max: number): string | null =>
  v == null ? null : String(v).slice(0, max)

export async function recordError(e: ErrorRecord): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO error_log (message, stack, digest, path, method, source)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        clip(e.message, MAX_MESSAGE) || 'Unknown error',
        clip(e.stack, MAX_STACK),
        clip(e.digest, 100),
        clip(e.path, 500),
        clip(e.method, 10),
        clip(e.source, 40),
      ]
    )
  } catch (err) {
    // Never let error reporting throw: it runs inside the failure path already.
    logger.error('error-log: could not persist error', err, { path: e.path })
  }
}

export interface ErrorLogRow {
  id: number
  message: string
  stack: string | null
  digest: string | null
  path: string | null
  method: string | null
  source: string | null
  created_at: string
}

export async function listErrors(limit = 100, offset = 0): Promise<{ rows: ErrorLogRow[]; total: number }> {
  const { rows: countRows } = await pool.query('SELECT COUNT(*)::int AS total FROM error_log')
  const { rows } = await pool.query(
    `SELECT id, message, stack, digest, path, method, source, created_at
       FROM error_log ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`,
    [Math.min(200, Math.max(1, limit)), Math.max(0, offset)]
  )
  return { rows, total: countRows[0].total }
}
