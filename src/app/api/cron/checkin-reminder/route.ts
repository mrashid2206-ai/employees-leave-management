import { NextResponse } from 'next/server'
import pool, { omanToday } from '@/lib/db'
import { authorizeCron } from '@/lib/cron-auth'
import { isOffDay } from '@/lib/attendance-calc'
import { pushToEmployee } from '@/lib/push'

// Scheduled nudge: push a reminder to active employees who haven't checked in yet
// today and aren't on approved leave. Skips holidays/weekends. Schedule it shortly
// after work start (e.g. 08:15 Asia/Muscat) with the CRON_SECRET bearer token.
async function handle(request: Request) {
  if (!authorizeCron(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = omanToday()
  if (await isOffDay(today)) {
    return NextResponse.json({ success: true, skipped: 'off-day', date: today })
  }

  const { rows } = await pool.query(
    `SELECT e.id, e.name
       FROM employees e
      WHERE e.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM attendance a
           WHERE a.employee_id = e.id AND a.date = $1 AND a.check_in IS NOT NULL
        )
        AND NOT EXISTS (
          SELECT 1 FROM leave_requests lr
           WHERE lr.employee_id = e.id AND lr.status = 'approved'
             AND lr.start_date <= $1 AND lr.end_date >= $1
        )`,
    [today]
  )

  let notified = 0
  for (const emp of rows) {
    const sent = await pushToEmployee(emp.id, {
      title: 'Check-in reminder / تذكير بتسجيل الحضور',
      body: "You haven't checked in yet today. / لم تسجّل حضورك اليوم بعد.",
      url: '/check-in',
      tag: 'checkin-reminder',
    })
    if (sent > 0) notified++
  }

  return NextResponse.json({ success: true, date: today, candidates: rows.length, notified })
}

export const POST = handle
export const GET = handle
