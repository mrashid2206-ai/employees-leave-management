import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { runYearlyReset } from '@/lib/automation'

// Scheduled yearly reset. Safe to call DAILY: it no-ops until the fiscal year ends,
// then fires exactly once (idempotency-guarded). Trigger with `Authorization: Bearer $CRON_SECRET`.
async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runYearlyReset({ id: 'cron', role: 'system' }, { force: false })
  return NextResponse.json(result)
}

export const POST = handle
export const GET = handle
