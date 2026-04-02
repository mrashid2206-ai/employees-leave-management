import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const results: string[] = []

  // Step 1: Fix March 31 UTC check-in times
  try {
    const { rows: march31 } = await pool.query(
      "SELECT id, employee_id, check_in::text as check_in, check_out::text as check_out FROM attendance WHERE date = '2026-03-31' AND status = 'present'"
    )
    for (const rec of march31) {
      if (!rec.check_in) continue
      const parts = rec.check_in.split(':')
      const h = parseInt(parts[0])
      const m = parseInt(parts[1])
      if (h < 7) {
        const newCheckIn = `${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
        if (rec.check_out) {
          const outParts = rec.check_out.split(':')
          const outH = parseInt(outParts[0])
          const outM = parseInt(outParts[1])
          const mins = (outH * 60 + outM) - ((h + 4) * 60 + m)
          const workHours = mins > 0 ? Math.round(mins / 60 * 100) / 100 : 0
          const overtime = Math.max(0, Math.round((workHours - 8) * 100) / 100)
          await pool.query('UPDATE attendance SET check_in = $1, work_hours = $2, overtime_hours = $3 WHERE id = $4', [newCheckIn, workHours, overtime, rec.id])
          results.push(`Mar31: emp${rec.employee_id} ${rec.check_in}→${newCheckIn} work=${workHours}h`)
        } else {
          await pool.query('UPDATE attendance SET check_in = $1 WHERE id = $2', [newCheckIn, rec.id])
          results.push(`Mar31: emp${rec.employee_id} ${rec.check_in}→${newCheckIn}`)
        }
      }
    }
    results.push('Step 1 done: March 31 times')
  } catch (e: any) {
    results.push(`Step 1 ERROR: ${e.message}`)
  }

  // Step 2: Fix tardiness hours
  try {
    const { rows: tardiness } = await pool.query('SELECT id, minutes_late, hours_late_decimal FROM tardiness_log')
    let fixed = 0
    for (const t of tardiness) {
      const correct = Math.round((t.minutes_late / 60) * 100000) / 100000
      const current = parseFloat(String(t.hours_late_decimal))
      if (Math.abs(correct - current) > 0.001) {
        await pool.query('UPDATE tardiness_log SET hours_late_decimal = $1 WHERE id = $2', [correct, t.id])
        fixed++
      }
    }
    results.push(`Step 2 done: ${fixed} tardiness records fixed`)
  } catch (e: any) {
    results.push(`Step 2 ERROR: ${e.message}`)
  }

  // Step 3: Recalculate leave days_count
  try {
    const { rows: settingsRows } = await pool.query('SELECT work_days FROM settings LIMIT 1')
    const workDaysStr = settingsRows[0]?.work_days || '0,1,2,3,4'
    const workDays = workDaysStr.split(',').map(Number)

    const { rows: allHolidays } = await pool.query('SELECT date::text as date FROM holidays')
    const holidayDates = allHolidays.map((h: any) => h.date)

    const { rows: allLeaves } = await pool.query(
      "SELECT id, start_date::text as start_date, end_date::text as end_date, days_count FROM leave_requests WHERE status IN ('approved', 'pending')"
    )
    let fixed = 0
    for (const leave of allLeaves) {
      // Count working days manually using simple arithmetic
      const [sy, sm, sd] = leave.start_date.split('-').map(Number)
      const [ey, em, ed] = leave.end_date.split('-').map(Number)
      const startMs = Date.UTC(sy, sm - 1, sd)
      const endMs = Date.UTC(ey, em - 1, ed)
      let count = 0
      for (let ms = startMs; ms <= endMs; ms += 86400000) {
        const d = new Date(ms)
        const dayOfWeek = d.getUTCDay()
        const yr = d.getUTCFullYear()
        const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
        const dy = String(d.getUTCDate()).padStart(2, '0')
        const dateStr = `${yr}-${mo}-${dy}`
        if (workDays.includes(dayOfWeek) && !holidayDates.includes(dateStr)) {
          count++
        }
      }
      if (count !== leave.days_count && count > 0) {
        await pool.query('UPDATE leave_requests SET days_count = $1 WHERE id = $2', [count, leave.id])
        results.push(`Leave#${leave.id}: ${leave.days_count}→${count}`)
        fixed++
      }
    }
    results.push(`Step 3 done: ${fixed} leaves fixed`)
  } catch (e: any) {
    results.push(`Step 3 ERROR: ${e.message}`)
  }

  // Step 4: Recalculate balances
  try {
    const { rows: settings } = await pool.query('SELECT annual_leave_balance FROM settings LIMIT 1')
    const annualBalance = settings[0]?.annual_leave_balance || 30
    const { rows: employees } = await pool.query('SELECT id, leave_balance FROM employees')
    let fixed = 0
    for (const emp of employees) {
      const { rows } = await pool.query(
        "SELECT COALESCE(SUM(days_count), 0)::int as total FROM leave_requests WHERE employee_id = $1 AND status = 'approved'",
        [emp.id]
      )
      const used = rows[0].total
      const correct = annualBalance - used
      if (emp.leave_balance !== correct) {
        await pool.query('UPDATE employees SET leave_balance = $1 WHERE id = $2', [correct, emp.id])
        results.push(`Emp${emp.id}: balance ${emp.leave_balance}→${correct} (used:${used})`)
        fixed++
      }
    }
    results.push(`Step 4 done: ${fixed} balances fixed`)
  } catch (e: any) {
    results.push(`Step 4 ERROR: ${e.message}`)
  }

  return NextResponse.json({ success: true, fixes: results })
}
