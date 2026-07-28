import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { reconcileBalances } from '@/server/services/reconcile-service'

// Scheduled balance reconciliation. Same auth as the other cron endpoints
// (`Authorization: Bearer $CRON_SECRET`), so no database credential has to be handed to
// the scheduler.
//
// Returns 409 when balances disagree with the records, so a plain `curl -f` fails and the
// scheduled workflow goes red — a report nobody is alerted by is a report nobody reads.
async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const threshold = Number(new URL(request.url).searchParams.get('threshold')) || 0.01
  const report = await reconcileBalances(threshold)

  return NextResponse.json(report, { status: report.drifting.length > 0 ? 409 : 200 })
}

export const POST = handle
export const GET = handle
