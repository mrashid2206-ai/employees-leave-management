import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { isPushConfigured } from '@/lib/push'
import { sendCheckinReminders } from '@/server/services/reminder-service'

// Scheduled nudge: push a reminder to active employees who haven't checked in yet today
// and aren't on approved leave. Holidays and each person's own non-working days are
// skipped. Schedule it shortly after work start (e.g. 08:15 Asia/Muscat) with the
// CRON_SECRET bearer token; a repeat run the same day reminds nobody twice.
async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Push is optional: without VAPID keys there is nothing to deliver, so don't select.
  if (!isPushConfigured()) {
    return NextResponse.json({ success: true, skipped: 'push-not-configured' })
  }

  const result = await sendCheckinReminders()
  return NextResponse.json({ success: true, ...result })
}

export const POST = handle
export const GET = handle
