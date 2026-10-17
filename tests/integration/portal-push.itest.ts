import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pool from '@/lib/db'
import type { PushPayload } from '@/lib/push'
import { sendCheckinReminders, sendCheckoutReminders } from '@/server/services/reminder-service'
import {
  HAS_TEST_DB,
  resetDb,
  closePool,
  addEmployee,
  employeeToken,
  adminToken,
  authedRequest,
} from './helpers'

// The employee portal's notification and push plumbing. Everything here is about WHO is
// affected: one employee must never mark another's notifications read or detach another's
// device, and a reminder must reach the people it is for — once, and not on their day off.

const SUNDAY = '2026-10-18' // a work day in the seeded schedule (Sun-Thu)
const SATURDAY = '2026-10-17' // the seeded weekend

/** A moment on `date` at Oman wall-clock `time` (Asia/Muscat is UTC+4, no DST). */
const omanAt = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`)

/** A stand-in sender that records who would have been pushed. */
function recordingSender(reached: (id: number) => number = () => 1) {
  const calls: { id: number; payload: PushPayload }[] = []
  const send = async (id: number, payload: PushPayload) => {
    calls.push({ id, payload })
    return reached(id)
  }
  return { send, calls, ids: () => calls.map(c => c.id) }
}

describe.skipIf(!HAS_TEST_DB)('portal notifications and push', () => {
  let me: number

  beforeEach(async () => {
    me = (await resetDb()).employeeId
  })

  afterAll(async () => {
    await closePool()
  })

  /* ------------------------------------------------------------------------ */
  /* Mark all read                                                              */
  /* ------------------------------------------------------------------------ */

  describe('mark all notifications read', () => {
    async function seedNotifications(other: number) {
      await pool.query(
        `INSERT INTO employee_notifications (employee_id, message, message_ar) VALUES
           ($1, 'mine 1', 'لي 1'), ($1, 'mine 2', 'لي 2'), ($2, 'theirs', 'لهم')`,
        [me, other]
      )
    }
    const unreadOf = async (id: number) =>
      Number((await pool.query(
        'SELECT COUNT(*) FROM employee_notifications WHERE employee_id = $1 AND is_read = false', [id]
      )).rows[0].count)

    it('marks every unread notification of the caller, and nobody else\'s', async () => {
      const other = await addEmployee()
      await seedNotifications(other)

      const { PUT } = await import('@/app/api/employee-notifications/route')
      const res = await PUT(authedRequest('http://t/api/employee-notifications', { employee: await employeeToken(me) }, {
        method: 'PUT', body: JSON.stringify({ all: true }),
      }))

      expect(res.status).toBe(200)
      expect((await res.json()).updated).toBe(2)
      expect(await unreadOf(me)).toBe(0)
      expect(await unreadOf(other)).toBe(1)
    })

    it('a single mark-read cannot reach another employee\'s notification', async () => {
      const other = await addEmployee()
      await seedNotifications(other)
      const { rows } = await pool.query('SELECT id FROM employee_notifications WHERE employee_id = $1', [other])

      const { PUT } = await import('@/app/api/employee-notifications/route')
      await PUT(authedRequest('http://t/api/employee-notifications', { employee: await employeeToken(me) }, {
        method: 'PUT', body: JSON.stringify({ id: rows[0].id }),
      }))

      expect(await unreadOf(other)).toBe(1)
    })

    it('is refused without an employee session (an admin token has no employee to scope by)', async () => {
      const other = await addEmployee()
      await seedNotifications(other)
      const { PUT } = await import('@/app/api/employee-notifications/route')

      const asAdmin = await PUT(authedRequest('http://t/api/employee-notifications', { admin: await adminToken() }, {
        method: 'PUT', body: JSON.stringify({ all: true }),
      }))
      const anonymous = await PUT(authedRequest('http://t/api/employee-notifications', {}, {
        method: 'PUT', body: JSON.stringify({ all: true }),
      }))

      expect(asAdmin.status).toBe(401)
      expect(anonymous.status).toBe(401)
      expect(await unreadOf(me)).toBe(2)
      expect(await unreadOf(other)).toBe(1)
    })
  })

  /* ------------------------------------------------------------------------ */
  /* Push unsubscribe                                                            */
  /* ------------------------------------------------------------------------ */

  describe('push unsubscribe', () => {
    const subscribe = (employeeId: number, endpoint: string) =>
      pool.query(
        "INSERT INTO push_subscriptions (employee_id, endpoint, p256dh, auth) VALUES ($1, $2, 'k', 'a')",
        [employeeId, endpoint]
      )
    const endpoints = async () =>
      (await pool.query('SELECT endpoint FROM push_subscriptions ORDER BY endpoint')).rows.map(r => r.endpoint)

    async function unsubscribe(asEmployee: number, endpoint: string) {
      const { DELETE } = await import('@/app/api/push/subscribe/route')
      return DELETE(authedRequest('http://t/api/push/subscribe', { employee: await employeeToken(asEmployee) }, {
        method: 'DELETE', body: JSON.stringify({ endpoint }),
      }))
    }

    it('removes the caller\'s own device', async () => {
      await subscribe(me, 'https://push.example/mine')
      const res = await unsubscribe(me, 'https://push.example/mine')
      expect(res.status).toBe(200)
      expect(await endpoints()).toEqual([])
    })

    it('cannot detach another employee\'s device, even knowing its endpoint', async () => {
      const other = await addEmployee()
      await subscribe(me, 'https://push.example/mine')
      await subscribe(other, 'https://push.example/theirs')

      await unsubscribe(me, 'https://push.example/theirs')

      expect(await endpoints()).toEqual(['https://push.example/mine', 'https://push.example/theirs'])
    })

    it('requires an employee session', async () => {
      await subscribe(me, 'https://push.example/mine')
      const { DELETE } = await import('@/app/api/push/subscribe/route')
      const res = await DELETE(authedRequest('http://t/api/push/subscribe', {}, {
        method: 'DELETE', body: JSON.stringify({ endpoint: 'https://push.example/mine' }),
      }))
      expect(res.status).toBe(401)
      expect(await endpoints()).toEqual(['https://push.example/mine'])
    })
  })

  /* ------------------------------------------------------------------------ */
  /* Check-out reminder                                                          */
  /* ------------------------------------------------------------------------ */

  describe('check-out reminder', () => {
    const checkIn = (employeeId: number, date: string, inAt: string, outAt: string | null = null) =>
      pool.query(
        "INSERT INTO attendance (employee_id, date, check_in, check_out, status) VALUES ($1, $2, $3, $4, 'present')",
        [employeeId, date, inAt, outAt]
      )
    const setSchedule = (employeeId: number, s: { start?: string; days?: string; hours?: number }) =>
      pool.query(
        'UPDATE employees SET work_start_time = $1, work_days = $2, work_hours_per_day = $3 WHERE id = $4',
        [s.start ?? null, s.days ?? null, s.hours ?? null, employeeId]
      )

    it('reminds only people still checked in after their own end of day', async () => {
      // me: default 08:00 + 8h, ends 16:00, still in -> due
      await checkIn(me, SUNDAY, '07:55')
      // already checked out -> not due
      const left = await addEmployee('Left On Time', 'left')
      await checkIn(left, SUNDAY, '08:00', '16:05')
      // personal schedule ends 18:00 -> not yet at 17:00
      const late = await addEmployee('Late Shift', 'late')
      await setSchedule(late, { start: '10:00' })
      await checkIn(late, SUNDAY, '10:00')
      // never checked in -> not this reminder's business
      await addEmployee('Absent', 'absent')
      // inactive -> never reminded
      const gone = await addEmployee('Deactivated', 'gone')
      await checkIn(gone, SUNDAY, '08:00')
      await pool.query('UPDATE employees SET is_active = false WHERE id = $1', [gone])
      // arrived after their day had already ended (overtime) -> nothing to remind about
      const overtime = await addEmployee('Overtime', 'overtime')
      await checkIn(overtime, SUNDAY, '16:30')
      // night shift ending after midnight -> today's date can't express the end, skip
      const night = await addEmployee('Night', 'night')
      await setSchedule(night, { start: '20:00' })
      await checkIn(night, SUNDAY, '01:00')

      const sender = recordingSender()
      const result = await sendCheckoutReminders(omanAt(SUNDAY, '17:00'), sender.send)

      expect(sender.ids()).toEqual([me])
      expect(sender.calls[0].payload.tag).toBe('checkout-reminder')
      expect(result).toMatchObject({ date: SUNDAY, due: 1, notified: 1, offDay: 0 })
    })

    it('reminds nobody twice, and picks up later schedules on a later run', async () => {
      await checkIn(me, SUNDAY, '08:00')
      const late = await addEmployee('Late Shift', 'late')
      await setSchedule(late, { start: '10:00' })
      await checkIn(late, SUNDAY, '10:00')

      const first = recordingSender()
      await sendCheckoutReminders(omanAt(SUNDAY, '17:00'), first.send)
      const second = recordingSender()
      await sendCheckoutReminders(omanAt(SUNDAY, '17:00'), second.send)
      const evening = recordingSender()
      await sendCheckoutReminders(omanAt(SUNDAY, '19:00'), evening.send)

      expect(first.ids()).toEqual([me])
      expect(second.ids()).toEqual([])
      expect(evening.ids()).toEqual([late])
    })

    it('keeps trying someone no device accepted, so turning reminders on later still works', async () => {
      await checkIn(me, SUNDAY, '08:00')

      const unreachable = recordingSender(() => 0)
      const r1 = await sendCheckoutReminders(omanAt(SUNDAY, '17:00'), unreachable.send)
      const reachable = recordingSender()
      const r2 = await sendCheckoutReminders(omanAt(SUNDAY, '18:00'), reachable.send)
      const again = recordingSender()
      await sendCheckoutReminders(omanAt(SUNDAY, '19:00'), again.send)

      expect(r1).toMatchObject({ due: 1, notified: 0 })
      expect(r2).toMatchObject({ due: 1, notified: 1 })
      expect(again.ids()).toEqual([])
    })

    it('skips each person\'s own off days, and public holidays for everyone', async () => {
      // Works Mon-Fri: Sunday is their weekend even though it is the company's work day.
      const monFri = await addEmployee('Mon-Fri', 'monfri')
      await setSchedule(monFri, { days: '1,2,3,4,5' })
      await checkIn(monFri, SUNDAY, '08:00')
      await checkIn(me, SUNDAY, '08:00')

      const sender = recordingSender()
      const result = await sendCheckoutReminders(omanAt(SUNDAY, '17:00'), sender.send)
      expect(sender.ids()).toEqual([me])
      expect(result.offDay).toBe(1)

      await pool.query("INSERT INTO holidays (name, date) VALUES ('National Day', $1)", ['2026-10-19'])
      await checkIn(me, '2026-10-19', '08:00')
      const onHoliday = recordingSender()
      const holiday = await sendCheckoutReminders(omanAt('2026-10-19', '17:00'), onHoliday.send)
      expect(onHoliday.ids()).toEqual([])
      expect(holiday.skipped).toBe('holiday')
    })

    it('the route rejects a secret passed in the query string', async () => {
      process.env.CRON_SECRET = 'test-cron-secret-value'
      try {
        const { POST } = await import('@/app/api/cron/checkout-reminder/route')
        const viaQuery = await POST(new Request('http://t/api/cron/checkout-reminder?key=test-cron-secret-value', { method: 'POST' }))
        const viaHeader = await POST(new Request('http://t/api/cron/checkout-reminder', {
          method: 'POST', headers: { authorization: 'Bearer test-cron-secret-value' },
        }))
        expect(viaQuery.status).toBe(401)
        // No VAPID keys in the test env: authorised, and a clean no-op.
        expect(viaHeader.status).toBe(200)
        expect(await viaHeader.json()).toMatchObject({ success: true, skipped: 'push-not-configured' })
      } finally {
        delete process.env.CRON_SECRET
      }
    })
  })

  /* ------------------------------------------------------------------------ */
  /* Check-in reminder                                                           */
  /* ------------------------------------------------------------------------ */

  describe('check-in reminder', () => {
    const setDays = (employeeId: number, days: string) =>
      pool.query('UPDATE employees SET work_days = $1 WHERE id = $2', [days, employeeId])

    it('uses each person\'s own work days, not the company weekend', async () => {
      // Company works Sun-Thu. This person works Mon-Fri, so Sunday is THEIR day off;
      // the old global check reminded them anyway.
      const monFri = await addEmployee('Mon-Fri', 'monfri')
      await setDays(monFri, '1,2,3,4,5')

      const sunday = recordingSender()
      const r = await sendCheckinReminders(omanAt(SUNDAY, '08:30'), sunday.send)
      expect(sunday.ids()).toEqual([me])
      expect(sunday.calls[0].payload.tag).toBe('checkin-reminder')
      expect(r.offDay).toBe(1)

      // ...and the reverse: a Saturday rota is a work day for them even though the
      // company is off — the old global check skipped the whole run.
      const saturdayRota = await addEmployee('Saturday Rota', 'satrota')
      await setDays(saturdayRota, '6,0,1,2,3')
      const saturday = recordingSender()
      await sendCheckinReminders(omanAt(SATURDAY, '08:30'), saturday.send)
      expect(saturday.ids()).toEqual([saturdayRota])
    })

    it('leaves out people already in, on approved leave, or already reminded today', async () => {
      const arrived = await addEmployee('Arrived', 'arrived')
      await pool.query(
        "INSERT INTO attendance (employee_id, date, check_in, status) VALUES ($1, $2, '07:58', 'present')",
        [arrived, SUNDAY]
      )
      const onLeave = await addEmployee('On Leave', 'onleave')
      await pool.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
         VALUES ($1, 1, $2, $2, 1, 'approved')`,
        [onLeave, SUNDAY]
      )

      const first = recordingSender()
      await sendCheckinReminders(omanAt(SUNDAY, '08:30'), first.send)
      const retry = recordingSender()
      await sendCheckinReminders(omanAt(SUNDAY, '08:45'), retry.send)

      expect(first.ids()).toEqual([me])
      expect(retry.ids()).toEqual([])
    })

    it('skips a public holiday outright', async () => {
      await pool.query("INSERT INTO holidays (name, date) VALUES ('Holiday', $1)", [SUNDAY])
      const sender = recordingSender()
      const r = await sendCheckinReminders(omanAt(SUNDAY, '08:30'), sender.send)
      expect(sender.ids()).toEqual([])
      expect(r.skipped).toBe('holiday')
    })
  })
})
