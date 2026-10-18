import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest'
import pool from '@/lib/db'
import {
  runDailyAutomation, runDailyCatchUp, daysOwed, dailyAutomationHealth, MAX_CATCH_UP_DAYS,
} from '@/lib/automation'
import { omanToday, addDays } from '@/lib/oman-date'
import { HAS_TEST_DB, resetDb, balanceOf, closePool, ADMIN } from './helpers'

// The nightly job used to process only yesterday. When a scheduled run never fired
// (GitHub drops runs under load, and disables schedules after 60 quiet days), that day's
// absences, leave charges and tardiness silently never happened. These cover the
// catch-up that replaced it, and the rules for which runs count as having done a day.

const CRON = { username: 'cron', role: 'system' as const }

describe.skipIf(!HAS_TEST_DB)('daily automation catch-up', () => {
  let employeeId: number
  const today = () => omanToday()
  const daysAgo = (n: number) => addDays(today(), -n)
  // resetDb's schedule is Sun–Thu.
  const isWorkingDay = (day: string) => new Date(`${day}T00:00:00Z`).getUTCDay() <= 4

  // A run as the journal would hold it. By default it completed normally, after its day.
  async function journalRun(day: string, opts: { summary?: object; createdOnTheDay?: boolean; reversed?: boolean } = {}) {
    await pool.query(
      `INSERT INTO automation_runs (kind, target_date, actor, actor_role, summary, created_at, reversed_at)
       VALUES ('daily', $1, 'cron', 'system', $2,
               CASE WHEN $3 THEN ($1::date + time '10:00') AT TIME ZONE 'Asia/Muscat' ELSE NOW() END,
               CASE WHEN $4 THEN NOW() END)`,
      [day, JSON.stringify(opts.summary ?? { date: day }), !!opts.createdOnTheDay, !!opts.reversed]
    )
  }

  beforeEach(async () => {
    const seeded = await resetDb()
    employeeId = seeded.employeeId
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  afterAll(async () => {
    await closePool()
  })

  describe('which days are owed', () => {
    it('with no run ever, only yesterday: earlier days were before the system was in use', async () => {
      expect(await daysOwed()).toEqual([daysAgo(1)])
    })

    it('nothing, once yesterday is done', async () => {
      await journalRun(daysAgo(1))
      expect(await daysOwed()).toEqual([])
    })

    it('every day since the last completed run', async () => {
      await journalRun(daysAgo(4))
      expect(await daysOwed()).toEqual([daysAgo(3), daysAgo(2), daysAgo(1)])
    })

    it('fills a gap in the middle, not just the tail', async () => {
      await journalRun(daysAgo(4))
      await journalRun(daysAgo(2))
      await journalRun(daysAgo(1))
      expect(await daysOwed()).toEqual([daysAgo(3)])
    })

    it(`stops ${MAX_CATCH_UP_DAYS} days back`, async () => {
      await journalRun(daysAgo(40))
      const owed = await daysOwed()
      expect(owed).toHaveLength(MAX_CATCH_UP_DAYS)
      expect(owed[0]).toBe(daysAgo(MAX_CATCH_UP_DAYS))
      expect(owed.at(-1)).toBe(daysAgo(1))
    })

    it('a run that failed does not count', async () => {
      await journalRun(daysAgo(2))
      await journalRun(daysAgo(1), { summary: { failed: true, error: 'boom' } })
      expect(await daysOwed()).toEqual([daysAgo(1)])
    })

    it('a run that never finished does not count', async () => {
      await journalRun(daysAgo(2))
      await journalRun(daysAgo(1), { summary: {} })
      expect(await daysOwed()).toEqual([daysAgo(1)])
    })

    it('a run made while its day was still in progress does not count', async () => {
      // Such a run skips absence marking, so the day still needs the real one.
      await journalRun(daysAgo(2))
      await journalRun(daysAgo(1), { createdOnTheDay: true })
      expect(await daysOwed()).toEqual([daysAgo(1)])
    })

    it('a run an admin undid counts as done, so it is not quietly redone', async () => {
      await journalRun(daysAgo(2))
      await journalRun(daysAgo(1), { reversed: true })
      expect(await daysOwed()).toEqual([])
    })
  })

  describe('runDailyCatchUp', () => {
    it('charges the absences of the missed days, then has nothing left to do', async () => {
      await journalRun(daysAgo(4))
      const missed = [daysAgo(3), daysAgo(2), daysAgo(1)]

      const first = await runDailyCatchUp(CRON)
      expect('skipped' in first).toBe(false)
      expect(first.days.map(d => d.date)).toEqual(missed)

      const workingDays = missed.filter(isWorkingDay).length
      expect(first.days.reduce((n, d) => n + d.absentMarked, 0)).toBe(workingDays)
      expect(await balanceOf(employeeId)).toBe(30 - workingDays)

      // A second trigger (a retry, or a backup scheduler) finds nothing owed.
      const second = await runDailyCatchUp(CRON)
      expect(second.days).toEqual([])
      expect(await balanceOf(employeeId)).toBe(30 - workingDays)
    })

    it('steps aside while another run holds the lock', async () => {
      const other = await pool.connect()
      try {
        await other.query('SELECT pg_advisory_lock(8273642)')
        const res = await runDailyCatchUp(CRON)
        expect(res).toEqual({ success: true, skipped: 'already_running', days: [] })
        expect(await balanceOf(employeeId)).toBe(30)
      } finally {
        await other.query('SELECT pg_advisory_unlock(8273642)')
        other.release()
      }
    })
  })

  describe('a run that crashes', () => {
    it('is marked failed in the journal, and its day stays owed', async () => {
      const day = daysAgo(1)
      const realQuery = pool.query.bind(pool)
      vi.spyOn(pool, 'query').mockImplementation(((text: unknown, ...rest: unknown[]) => {
        if (typeof text === 'string' && text.includes('FROM holidays WHERE date')) {
          return Promise.reject(new Error('connection terminated unexpectedly'))
        }
        return (realQuery as (...a: unknown[]) => unknown)(text, ...rest)
      }) as typeof pool.query)

      await expect(runDailyAutomation(day, ADMIN)).rejects.toThrow('connection terminated')
      vi.restoreAllMocks()

      const { rows } = await pool.query(
        "SELECT summary FROM automation_runs WHERE kind = 'daily' AND target_date = $1",
        [day]
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].summary.failed).toBe(true)
      expect(rows[0].summary.error).toContain('connection terminated')
      expect(await daysOwed()).toContain(day)
    })
  })

  describe('dailyAutomationHealth', () => {
    // 06:00 and 02:00 Oman time (UTC+4) on a fixed day, so the result doesn't depend on
    // when the suite runs.
    const MORNING = new Date('2026-06-10T02:00:00Z')
    const NIGHT = new Date('2026-06-09T22:00:00Z')

    it('no_runs_yet on a fresh install', async () => {
      expect((await dailyAutomationHealth(MORNING)).status).toBe('no_runs_yet')
    })

    it('ok once yesterday is done', async () => {
      await journalRun('2026-06-09')
      const h = await dailyAutomationHealth(MORNING)
      expect(h).toMatchObject({ status: 'ok', lastCompleted: '2026-06-09', expected: '2026-06-09' })
    })

    it('stale in the morning when yesterday was missed', async () => {
      await journalRun('2026-06-08')
      expect((await dailyAutomationHealth(MORNING)).status).toBe('stale')
    })

    it('not stale before the job is due', async () => {
      // 02:00: the 01:00 run may simply be running late, so only the day before is due.
      await journalRun('2026-06-08')
      const h = await dailyAutomationHealth(NIGHT)
      expect(h).toMatchObject({ status: 'ok', expected: '2026-06-08' })
    })

    it('GET /api/health/automation answers 503 when stale', async () => {
      await journalRun(daysAgo(5))
      const { GET } = await import('@/app/api/health/automation/route')
      const res = await GET()
      expect(res.status).toBe(503)
      expect((await res.json()).status).toBe('stale')
    })
  })
})
