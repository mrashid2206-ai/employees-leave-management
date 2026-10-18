import pool, { omanToday, omanTime } from '@/lib/db'
import { isHoliday, isNonWorkingWeekday, isOffDayFor } from '@/lib/attendance-calc'
import { resolveSchedule, resolveScheduleMap, scheduleEndTime } from '@/lib/schedule'
import { pushToEmployee, type PushPayload } from '@/lib/push'

// Scheduled push reminders ("you haven't checked in", "you haven't checked out").
//
// Selection lives here rather than in the cron routes so it can be exercised against a
// real database with a stand-in sender: who gets nudged is the whole behaviour, and a
// wrong answer either nags people on their day off or stays silent when it matters.
//
// Every reminder is claimed in push_reminder_log BEFORE it is sent. The check-out cron
// runs several times an evening and curl retries on transient failures, so without the
// claim the same person would be pushed on every run.

/** Delivers a payload to an employee's devices and returns how many accepted it. */
export type ReminderSender = (employeeId: number, payload: PushPayload) => Promise<number>

type ReminderKind = 'checkin' | 'checkout'

export interface ReminderRunResult {
  date: string
  /** Set when the whole run was skipped (e.g. a public holiday). */
  skipped?: string
  /** People still in scope after the attendance query, before per-person rules. */
  candidates: number
  /** Excluded because today is not one of their own work days. */
  offDay: number
  /** Claimed and handed to the sender. */
  due: number
  /** Reached at least one device. */
  notified: number
}

const CHECKIN_PAYLOAD: PushPayload = {
  title: 'Check-in reminder / تذكير بتسجيل الحضور',
  body: "You haven't checked in yet today. / لم تسجّل حضورك اليوم بعد.",
  url: '/check-in',
  tag: 'checkin-reminder',
}

const CHECKOUT_PAYLOAD: PushPayload = {
  title: 'Check-out reminder / تذكير بتسجيل الانصراف',
  body: "Your working day has ended and you haven't checked out. / انتهى دوامك ولم تسجّل انصرافك بعد.",
  url: '/check-in',
  tag: 'checkout-reminder',
}

const MINUTES_PER_DAY = 24 * 60

// Claim, send, and give the claim back if no device took it — an employee with no
// subscription yet should still be reminded if they turn reminders on later today.
async function deliver(
  employeeId: number,
  date: string,
  kind: ReminderKind,
  payload: PushPayload,
  send: ReminderSender
): Promise<'skipped' | 'sent' | 'unreached'> {
  const claim = await pool.query(
    `INSERT INTO push_reminder_log (employee_id, date, kind) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING RETURNING employee_id`,
    [employeeId, date, kind]
  )
  if (claim.rowCount === 0) return 'skipped' // another run got there first

  const sent = await send(employeeId, payload).catch(() => 0)
  if (sent > 0) return 'sent'
  await pool.query(
    'DELETE FROM push_reminder_log WHERE employee_id = $1 AND date = $2 AND kind = $3',
    [employeeId, date, kind]
  )
  return 'unreached'
}

/**
 * Nudge active employees who haven't checked in today and aren't on approved leave.
 *
 * Off days are judged per person (isOffDayFor, the same rule check-in itself uses): a
 * department that works Sunday-Thursday and an employee on a Saturday rota must not share
 * one organisation-wide weekend.
 */
export async function sendCheckinReminders(
  now: Date = new Date(),
  send: ReminderSender = pushToEmployee
): Promise<ReminderRunResult> {
  const today = omanToday(now)
  const result: ReminderRunResult = { date: today, candidates: 0, offDay: 0, due: 0, notified: 0 }

  // A public holiday is off for everyone, so skip the per-person work entirely.
  if (await isHoliday(today)) return { ...result, skipped: 'holiday' }

  const { rows } = await pool.query<{ id: number }>(
    `SELECT e.id
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
        )
        AND NOT EXISTS (
          SELECT 1 FROM push_reminder_log r
           WHERE r.employee_id = e.id AND r.date = $1 AND r.kind = 'checkin'
        )
      ORDER BY e.id`,
    [today]
  )
  result.candidates = rows.length

  for (const { id } of rows) {
    if (await isOffDayFor(id, today)) { result.offDay++; continue }
    const outcome = await deliver(id, today, 'checkin', CHECKIN_PAYLOAD, send)
    if (outcome === 'skipped') continue
    result.due++
    if (outcome === 'sent') result.notified++
  }
  return result
}

/**
 * Nudge employees who checked in today and are still checked in after the end of their
 * OWN working day (start + hours, from the employee -> department -> global schedule).
 *
 * Deliberately left out:
 *  - off days for that person: there is no scheduled end to measure against, and someone
 *    doing holiday work sets their own hours;
 *  - schedules that end after midnight: "today" cannot express that end time, and a
 *    night-shift worker would otherwise be told to check out minutes after arriving;
 *  - check-ins at or after the scheduled end (overtime started late): the day they are
 *    being reminded about was already over when they arrived.
 */
export async function sendCheckoutReminders(
  now: Date = new Date(),
  send: ReminderSender = pushToEmployee
): Promise<ReminderRunResult> {
  const today = omanToday(now)
  const nowTime = omanTime(now)
  const result: ReminderRunResult = { date: today, candidates: 0, offDay: 0, due: 0, notified: 0 }

  if (await isHoliday(today)) return { ...result, skipped: 'holiday' }

  const { rows } = await pool.query<{ id: number; check_in: string }>(
    `SELECT a.employee_id AS id, a.check_in::text AS check_in
       FROM attendance a
       JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1
        AND a.check_in IS NOT NULL
        AND a.check_out IS NULL
        AND e.is_active = true
        AND NOT EXISTS (
          SELECT 1 FROM push_reminder_log r
           WHERE r.employee_id = a.employee_id AND r.date = $1 AND r.kind = 'checkout'
        )
      ORDER BY a.employee_id`,
    [today]
  )
  result.candidates = rows.length
  if (rows.length === 0) return result

  const schedules = await resolveScheduleMap()
  for (const row of rows) {
    const schedule = schedules.get(row.id) ?? (await resolveSchedule(row.id))
    if (isNonWorkingWeekday(schedule.workDays, today)) { result.offDay++; continue }
    if (schedule.workStartMinutes + schedule.workHoursPerDay * 60 >= MINUTES_PER_DAY) continue

    // Both sides are zero-padded 'HH:MM:SS', so string order is time order.
    const end = scheduleEndTime(schedule)
    if (nowTime < end) continue
    if (row.check_in.slice(0, 8) >= end) continue

    const outcome = await deliver(row.id, today, 'checkout', CHECKOUT_PAYLOAD, send)
    if (outcome === 'skipped') continue
    result.due++
    if (outcome === 'sent') result.notified++
  }
  return result
}
