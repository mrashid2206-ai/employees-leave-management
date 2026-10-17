import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { runDailyCatchUp } from '@/lib/automation'
import { pruneExpired, type PruneResult } from '@/lib/retention'
import { logger } from '@/lib/log'

// Scheduled daily automation. Trigger from Railway cron / GitHub Actions / any external
// scheduler with `Authorization: Bearer $CRON_SECRET`. POST and GET both supported.
//
// Processes every day still owed, not just yesterday, so a missed night is caught up on
// the next one (see runDailyCatchUp). Safe to trigger more than once: a second call finds
// nothing owed, or the lock already held. A day that fails returns a 500, so the
// scheduler's run fails visibly instead of passing quietly.
//
// Then prunes expired rows from the ever-growing tables (src/lib/retention.ts).
async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runDailyCatchUp({ username: 'cron', role: 'system' })

  // Housekeeping rides on the nightly trigger rather than a schedule of its own. It runs
  // AFTER the catch-up so it can never delay or block the work that matters, and its
  // failure is only logged: a table that didn't get pruned tonight is not a reason to
  // fail the run and page someone about absences that were in fact processed.
  let retention: PruneResult | { error: true }
  try {
    retention = await pruneExpired()
  } catch (err) {
    logger.error('retention pruning failed', err)
    retention = { error: true }
  }

  return NextResponse.json({ ...result, retention })
}

export const POST = handle
export const GET = handle
