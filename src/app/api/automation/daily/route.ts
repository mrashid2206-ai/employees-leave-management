import { NextResponse } from 'next/server'
import pool, { omanToday } from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()
  const { date } = await request.json()
  const processDate = date || omanToday()

  const results = {
    absentMarked: 0,
    leaveDeducted: 0,
    tardinessCreated: 0,
    date: processDate,
  }

  // 1. Get all active employees
  const { rows: employees } = await pool.query(
    'SELECT id FROM employees WHERE is_active = true'
  )

  // 2. Get employees who are on approved leave today
  const { rows: onLeave } = await pool.query(
    `SELECT DISTINCT employee_id FROM leave_requests
     WHERE status = 'approved' AND start_date <= $1 AND end_date >= $1`,
    [processDate]
  )
  const onLeaveIds = new Set(onLeave.map(r => r.employee_id))

  // 3. Get employees who already have attendance for today
  const { rows: attended } = await pool.query(
    'SELECT employee_id, check_in, excused_tardiness FROM attendance WHERE date = $1',
    [processDate]
  )
  const attendedMap = new Map(attended.map(r => [r.employee_id, { check_in: r.check_in, excused: r.excused_tardiness }]))

  // 4. Get holidays
  const { rows: holidays } = await pool.query(
    'SELECT id FROM holidays WHERE date = $1',
    [processDate]
  )
  const isHoliday = holidays.length > 0

  // Get settings for work days and start time
  const { rows: settingsRows } = await pool.query('SELECT work_days, work_start_time::text as work_start_time FROM settings LIMIT 1')
  const workDays = settingsRows[0]?.work_days?.split(',').map(Number) || [0,1,2,3,4]
  const workStartTime = settingsRows[0]?.work_start_time || '08:00'
  const [startH, startM] = workStartTime.split(':').map(Number)
  const workStartMinutes = startH * 60 + startM

  // Skip weekends
  const dayOfWeek = new Date(processDate).getDay()
  const isWeekend = !workDays.includes(dayOfWeek)

  if (!isHoliday && !isWeekend) {
    for (const emp of employees) {
      // If employee has attendance (checked in), they showed up — skip leave check
      if (attendedMap.has(emp.id) && attendedMap.get(emp.id)?.check_in) {
        // Employee is present — only check tardiness below
      } else if (onLeaveIds.has(emp.id)) {
        // On approved leave and didn't check in — skip
        continue
      }

      if (!attendedMap.has(emp.id)) {
        // No attendance record — mark as absent
        await pool.query(`
          INSERT INTO attendance (employee_id, date, status)
          VALUES ($1, $2, 'absent')
          ON CONFLICT (employee_id, date) DO NOTHING
        `, [emp.id, processDate])
        results.absentMarked++

        // Auto-deduct: create an approved annual leave for this day (only if balance > 0)
        const { rows: empBalance } = await pool.query('SELECT leave_balance FROM employees WHERE id = $1', [emp.id])
        const balance = empBalance[0]?.leave_balance || 0
        const { rows: existingLeave } = await pool.query(
          `SELECT id FROM leave_requests WHERE employee_id = $1 AND start_date = $2 AND end_date = $2`,
          [emp.id, processDate]
        )
        if (existingLeave.length === 0 && balance > 0) {
          await pool.query(`
            INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status)
            VALUES ($1, 1, $2, $2, 1, 'Auto-deducted: absent without leave', 'approved')
          `, [emp.id, processDate])
          await pool.query('UPDATE employees SET leave_balance = leave_balance - 1 WHERE id = $1', [emp.id])
          results.leaveDeducted++
        }
      } else {
        // Has attendance — check if late (after work start time)
        const record = attendedMap.get(emp.id)
        if (record?.check_in && !record.excused) {
          const [h, m] = record.check_in.split(':').map(Number)
          const minutesLate = (h * 60 + m) - workStartMinutes
          if (minutesLate > 0) {
            // Check if tardiness record already exists
            const { rows: existing } = await pool.query(
              'SELECT id FROM tardiness_log WHERE employee_id = $1 AND date = $2',
              [emp.id, processDate]
            )
            if (existing.length === 0) {
              const hoursDecimal = Math.round((minutesLate / 60) * 100000) / 100000
              await pool.query(`
                INSERT INTO tardiness_log (employee_id, date, time, minutes_late, hours_late_decimal, notes)
                VALUES ($1, $2, $3, $4, $5, 'Auto-generated from attendance')
              `, [emp.id, processDate, record.check_in, minutesLate, hoursDecimal])
              results.tardinessCreated++
            }
          }
        }
      }
    }
  }

  await logAudit('daily_process', admin.username, 'admin', `Daily process: ${results.absentMarked} absent, ${results.tardinessCreated} tardiness`)

  return NextResponse.json({ success: true, ...results })
}
