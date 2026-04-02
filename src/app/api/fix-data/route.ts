import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'

function formatDate(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function countWorkingDays(startDate: string, endDate: string, workDays: number[], holidaySet: Set<string>): number {
  const [sy, sm, sd] = startDate.split('-').map(Number)
  const [ey, em, ed] = endDate.split('-').map(Number)
  const start = new Date(sy, sm - 1, sd)
  const end = new Date(ey, em - 1, ed)
  let count = 0
  const cur = new Date(start)
  while (cur <= end) {
    const dayOfWeek = cur.getDay()
    const dateStr = formatDate(cur.getFullYear(), cur.getMonth(), cur.getDate())
    if (workDays.includes(dayOfWeek) && !holidaySet.has(dateStr)) {
      count++
    }
    cur.setDate(cur.getDate() + 1)
  }
  return count
}

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  const results: string[] = []

  try {
    // 1. Fix March 31 UTC check-in times (add 4 hours if before 07:00)
    const { rows: march31 } = await pool.query(
      "SELECT id, employee_id, check_in::text as check_in, check_out::text as check_out FROM attendance WHERE date = '2026-03-31' AND status = 'present'"
    )
    for (const rec of march31) {
      let checkIn = rec.check_in
      const checkOut = rec.check_out
      let changed = false

      if (checkIn) {
        const [h, m] = checkIn.split(':').map(Number)
        if (h < 7) {
          checkIn = `${String(h + 4).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
          changed = true
        }
      }

      if (changed) {
        if (checkIn && checkOut) {
          const [inH, inM] = checkIn.split(':').map(Number)
          const [outH, outM] = checkOut.split(':').map(Number)
          const mins = (outH * 60 + outM) - (inH * 60 + inM)
          const workHours = mins > 0 ? Math.round(mins / 60 * 100) / 100 : 0
          const overtime = Math.max(0, Math.round((workHours - 8) * 100) / 100)
          await pool.query('UPDATE attendance SET check_in = $1, work_hours = $2, overtime_hours = $3 WHERE id = $4', [checkIn, workHours, overtime, rec.id])
          results.push(`March31: emp ${rec.employee_id} ${rec.check_in}→${checkIn} work=${workHours}h OT=${overtime}h`)
        } else {
          await pool.query('UPDATE attendance SET check_in = $1 WHERE id = $2', [checkIn, rec.id])
          results.push(`March31: emp ${rec.employee_id} ${rec.check_in}→${checkIn}`)
        }
      }
    }

    // 2. Fix tardiness hours_late_decimal
    const { rows: tardiness } = await pool.query('SELECT id, minutes_late, hours_late_decimal FROM tardiness_log')
    let tardinessFixed = 0
    for (const t of tardiness) {
      const correct = Math.round((t.minutes_late / 60) * 100000) / 100000
      const current = parseFloat(t.hours_late_decimal)
      if (Math.abs(correct - current) > 0.001) {
        await pool.query('UPDATE tardiness_log SET hours_late_decimal = $1 WHERE id = $2', [correct, t.id])
        tardinessFixed++
      }
    }
    results.push(`Tardiness hours fixed: ${tardinessFixed}`)

    // 3. Recalculate leave days_count (working days only)
    const { rows: settingsRows } = await pool.query('SELECT work_days FROM settings LIMIT 1')
    const workDays = settingsRows[0]?.work_days?.split(',').map(Number) || [0,1,2,3,4]

    const { rows: allHolidays } = await pool.query('SELECT date::text as date FROM holidays')
    const holidaySet = new Set(allHolidays.map((h: any) => h.date))

    const { rows: allLeaves } = await pool.query("SELECT id, start_date::text as start_date, end_date::text as end_date, days_count FROM leave_requests WHERE status IN ('approved', 'pending')")
    let leavesFixed = 0
    for (const leave of allLeaves) {
      const count = countWorkingDays(leave.start_date, leave.end_date, workDays, holidaySet)
      if (count !== leave.days_count) {
        await pool.query('UPDATE leave_requests SET days_count = $1 WHERE id = $2', [count, leave.id])
        results.push(`Leave #${leave.id}: ${leave.days_count}→${count} (${leave.start_date} to ${leave.end_date})`)
        leavesFixed++
      }
    }
    results.push(`Leaves fixed: ${leavesFixed}`)

    // 4. Recalculate employee balances
    const { rows: employees } = await pool.query('SELECT id FROM employees')
    const { rows: settings } = await pool.query('SELECT annual_leave_balance FROM settings LIMIT 1')
    const annualBalance = settings[0]?.annual_leave_balance || 30

    let balancesFixed = 0
    for (const emp of employees) {
      const { rows: approvedLeaves } = await pool.query(
        "SELECT COALESCE(SUM(days_count), 0) as total_used FROM leave_requests WHERE employee_id = $1 AND status = 'approved'",
        [emp.id]
      )
      const totalUsed = parseInt(approvedLeaves[0].total_used)
      const correctBalance = annualBalance - totalUsed

      const { rows: current } = await pool.query('SELECT leave_balance FROM employees WHERE id = $1', [emp.id])
      if (current[0].leave_balance !== correctBalance) {
        await pool.query('UPDATE employees SET leave_balance = $1 WHERE id = $2', [correctBalance, emp.id])
        results.push(`Balance: emp ${emp.id} ${current[0].leave_balance}→${correctBalance} (used:${totalUsed})`)
        balancesFixed++
      }
    }
    results.push(`Balances fixed: ${balancesFixed}`)

    return NextResponse.json({ success: true, fixes: results })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message, completedSteps: results }, { status: 500 })
  }
}
