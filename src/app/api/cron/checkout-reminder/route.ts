import { NextResponse } from 'next/server'
import { authorizeCron } from '@/lib/cron-auth'
import { isPushConfigured } from '@/lib/push'
import { sendCheckoutReminders } from '@/server/services/reminder-service'

// Scheduled nudge: push to employees who checked in today and are still checked in after
// the end of their own working day. Working days end at different times, so this is
// meant to run hourly through the afternoon and evening; push_reminder_log makes sure
// each person is reminded at most once a day however often it runs.
//
// Bearer header only. authorizeCron also accepts ?key=, but a secret in a URL lands in
// access logs and proxies, and this endpoint has no caller that needs it.
export async function POST(request: Request) {
  if (new URL(request.url).searchParams.has('key') || !authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Push is optional: without VAPID keys there is nothing to deliver, so don't select.
  if (!isPushConfigured()) {
    return NextResponse.json({ success: true, skipped: 'push-not-configured' })
  }

  const result = await sendCheckoutReminders()
  return NextResponse.json({ success: true, ...result })
}
