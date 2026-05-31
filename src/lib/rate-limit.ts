import pool from '@/lib/db'
import { ensureRateLimitTable } from '@/lib/ensure-schema'
import { logger } from '@/lib/log'

// Persistent, cross-instance rate limiting backed by Postgres so counters survive
// deploys and are shared across instances. Falls back to a per-process in-memory map
// only if the DB is briefly unavailable (so logins never hard-fail on a DB blip).
const memory = new Map<string, { count: number; resetAt: number }>()

function checkMemory(key: string, maxAttempts: number, windowMs: number): { allowed: boolean; remaining: number } {
  const now = Date.now()
  const entry = memory.get(key)
  if (!entry || entry.resetAt < now) {
    memory.set(key, { count: 1, resetAt: now + windowMs })
    return { allowed: true, remaining: maxAttempts - 1 }
  }
  if (entry.count >= maxAttempts) return { allowed: false, remaining: 0 }
  entry.count++
  return { allowed: true, remaining: maxAttempts - entry.count }
}

export async function checkRateLimit(
  key: string,
  maxAttempts: number = 5,
  windowMs: number = 900000
): Promise<{ allowed: boolean; remaining: number }> {
  try {
    await ensureRateLimitTable()
    const { rows } = await pool.query(
      `INSERT INTO rate_limits (key, count, reset_at)
       VALUES ($1, 1, NOW() + ($2::bigint || ' milliseconds')::interval)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.reset_at < NOW() THEN 1 ELSE rate_limits.count + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at < NOW() THEN NOW() + ($2::bigint || ' milliseconds')::interval ELSE rate_limits.reset_at END
       RETURNING count`,
      [key, windowMs]
    )
    const count: number = rows[0].count
    return { allowed: count <= maxAttempts, remaining: Math.max(0, maxAttempts - count) }
  } catch (e) {
    logger.warn('rate-limit DB unavailable; using in-memory fallback', { error: e instanceof Error ? e.message : String(e) })
    return checkMemory(key, maxAttempts, windowMs)
  }
}

export async function resetRateLimit(key: string): Promise<void> {
  memory.delete(key)
  try {
    await pool.query('DELETE FROM rate_limits WHERE key = $1', [key])
  } catch {
    // best-effort
  }
}
