import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { runDailyCatchUp } from '@/lib/automation'

// Scheduled daily automation. Trigger from Railway cron / GitHub Actions / any external
// scheduler with `Authorization: Bearer $CRON_SECRET`. POST and GET both supported.
//
// Processes every day still owed, not just yesterday, so a missed night is caught up on
// the next one (see runDailyCatchUp). Safe to trigger more than once: a second call finds
// nothing owed, or the lock already held. A day that fails returns a 500, so the
// scheduler's run fails visibly instead of passing quietly.
async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runDailyCatchUp({ username: 'cron', role: 'system' })
  return NextResponse.json(result)
}

export const POST = handle
export const GET = handle
