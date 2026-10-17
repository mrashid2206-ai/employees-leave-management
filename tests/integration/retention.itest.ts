import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import { pruneExpired, ERROR_LOG_RETENTION_DAYS, AUTOMATION_RUN_RETENTION_DAYS } from '@/lib/retention'
import { HAS_TEST_DB, resetDb, closePool } from './helpers'

// rate_limits, error_log and the automation journal only ever grew. These cover what the
// nightly pruning deletes, what it must keep (a year+ of undo history, live rate-limit
// windows), and that the cron route runs it without letting a pruning failure fail the
// night's automation.

const BASE = 'http://localhost'
const SECRET = 'cron-test-secret-0123456789'

async function count(sql: string): Promise<number> {
  const { rows } = await pool.query(sql)
  return rows[0].n
}

async function errorAt(daysAgo: number, message: string) {
  await pool.query(
    `INSERT INTO error_log (message, created_at) VALUES ($1, NOW() - make_interval(days => $2))`,
    [message, daysAgo]
  )
}

/** A journalled run `daysAgo` old with one effect, as the automation would leave it. */
async function runAt(daysAgo: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO automation_runs (kind, target_date, actor, actor_role, summary, created_at)
     VALUES ('daily', (NOW() - make_interval(days => $1 + 1))::date, 'cron', 'system',
             '{"date":"x"}', NOW() - make_interval(days => $1))
     RETURNING id`,
    [daysAgo]
  )
  await pool.query(
    `INSERT INTO automation_effects (run_id, kind, payload) VALUES ($1, 'absence_marked', '{}')`,
    [rows[0].id]
  )
  return rows[0].id
}

describe.skipIf(!HAS_TEST_DB)('retention pruning', () => {
  beforeEach(async () => {
    await resetDb()
    await pool.query('DELETE FROM rate_limits')
  })

  afterAll(async () => {
    await closePool()
  })

  it('deletes expired rate-limit rows and keeps live windows', async () => {
    await pool.query(`
      INSERT INTO rate_limits (key, count, reset_at) VALUES
        ('expired', 5, NOW() - interval '1 minute'),
        ('live', 5, NOW() + interval '10 minutes')
    `)
    const result = await pruneExpired()
    expect(result.rateLimits).toBe(1)
    const { rows } = await pool.query('SELECT key FROM rate_limits')
    expect(rows.map(r => r.key)).toEqual(['live'])
  })

  it(`deletes error_log rows older than ${ERROR_LOG_RETENTION_DAYS} days only`, async () => {
    await errorAt(ERROR_LOG_RETENTION_DAYS + 1, 'old')
    await errorAt(ERROR_LOG_RETENTION_DAYS - 1, 'recent')
    await errorAt(0, 'today')
    const result = await pruneExpired()
    expect(result.errorLog).toBe(1)
    const { rows } = await pool.query('SELECT message FROM error_log ORDER BY id')
    expect(rows.map(r => r.message)).toEqual(['recent', 'today'])
  })

  it(`keeps a year of undo history; deletes runs older than ${AUTOMATION_RUN_RETENTION_DAYS} days with their effects`, async () => {
    const old = await runAt(AUTOMATION_RUN_RETENTION_DAYS + 5)
    const yearOld = await runAt(366)
    const recent = await runAt(1)

    const result = await pruneExpired()
    expect(result.automationRuns).toBe(1)

    const { rows } = await pool.query('SELECT id FROM automation_runs ORDER BY id')
    expect(rows.map(r => r.id)).toEqual([yearOld, recent])
    // Effects cascade with their run; the kept runs keep theirs (still undoable).
    expect(await count(`SELECT COUNT(*)::int AS n FROM automation_effects WHERE run_id = ${old}`)).toBe(0)
    expect(await count('SELECT COUNT(*)::int AS n FROM automation_effects')).toBe(2)
  })

  it('is a no-op when there is nothing to prune', async () => {
    expect(await pruneExpired()).toEqual({ rateLimits: 0, errorLog: 0, automationRuns: 0 })
  })

  describe('/api/cron/daily', () => {
    let prevSecret: string | undefined

    beforeEach(() => {
      prevSecret = process.env.CRON_SECRET
      process.env.CRON_SECRET = SECRET
    })

    afterEach(() => {
      if (prevSecret === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = prevSecret
    })

    it('prunes after the catch-up and reports what it deleted', async () => {
      await errorAt(ERROR_LOG_RETENTION_DAYS + 10, 'old')
      const { POST } = await import('@/app/api/cron/daily/route')
      const res = await POST(
        new Request(`${BASE}/api/cron/daily`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } })
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.success).toBe(true)
      expect(body.retention).toEqual({ rateLimits: 0, errorLog: 1, automationRuns: 0 })
      // The catch-up itself still ran: yesterday now has a journalled run.
      expect(await count("SELECT COUNT(*)::int AS n FROM automation_runs WHERE kind = 'daily'")).toBe(1)
    })

    it('a pruning failure is logged, not a failed cron run', async () => {
      // Make the error_log delete fail for real: the table isn't there under its name.
      await pool.query('ALTER TABLE error_log RENAME TO error_log_hidden')
      try {
        const { POST } = await import('@/app/api/cron/daily/route')
        const res = await POST(
          new Request(`${BASE}/api/cron/daily`, { method: 'POST', headers: { authorization: `Bearer ${SECRET}` } })
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body.success).toBe(true)
        expect(body.retention).toEqual({ error: true })
        expect(await count("SELECT COUNT(*)::int AS n FROM automation_runs WHERE kind = 'daily'")).toBe(1)
      } finally {
        await pool.query('ALTER TABLE error_log_hidden RENAME TO error_log')
      }
    })

    it('refuses the secret in a ?key= query string (it would land in access logs)', async () => {
      await errorAt(ERROR_LOG_RETENTION_DAYS + 10, 'old')
      const { POST } = await import('@/app/api/cron/daily/route')
      const res = await POST(new Request(`${BASE}/api/cron/daily?key=${SECRET}`, { method: 'POST' }))
      expect(res.status).toBe(401)
      // Nothing ran: no automation, no pruning.
      expect(await count('SELECT COUNT(*)::int AS n FROM automation_runs')).toBe(0)
      expect(await count('SELECT COUNT(*)::int AS n FROM error_log')).toBe(1)
    })
  })
})
