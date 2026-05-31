import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { runDailyAutomation } from '@/lib/automation'

// Scheduled daily automation. Trigger from Railway cron / GitHub Actions / any external
// scheduler with `Authorization: Bearer $CRON_SECRET`. POST and GET both supported.
async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const result = await runDailyAutomation(undefined, { id: 'cron', role: 'system' })
  return NextResponse.json(result)
}

export const POST = handle
export const GET = handle
