import { NextResponse } from 'next/server'
import { dailyAutomationHealth } from '@/lib/automation'

// Is the nightly automation keeping up? Point an uptime monitor at this URL: it returns
// 503 once yesterday should have been processed and hasn't been.
//
// A missed scheduled run isn't a failed run, so nothing else notices it. Even with the
// catch-up, a scheduler that has stopped altogether (GitHub disables schedules after 60
// days with no repo activity) only shows up here.
//
// Unauthenticated like /api/health. It reveals two dates and whether a cron secret is
// set, never the secret.
//
// Kept separate from /api/health on purpose: that one is the deploy health check, and a
// stale nightly job is no reason for Railway to restart the app.

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const health = await dailyAutomationHealth()
    return NextResponse.json(health, {
      status: health.status === 'stale' ? 503 : 200,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    return NextResponse.json({ status: 'unknown' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }
}
