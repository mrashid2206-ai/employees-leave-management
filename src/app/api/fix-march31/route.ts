import { NextResponse } from 'next/server'
import pool from '@/lib/db'

// One-time fix: correct UTC times to Oman time (GMT+4) for March 31
// Delete this file after running
export async function GET() {
  const results: string[] = []
  const workHoursPerDay = 8

  // Get all March 31 records
  const { rows } = await pool.query(
    "SELECT id, employee_id, check_in::text as check_in, check_out::text as check_out FROM attendance WHERE date = '2026-03-31' AND status = 'present'"
  )

  for (const rec of rows) {
    let checkIn = rec.check_in
    let checkOut = rec.check_out
    let changed = false

    // Fix check-in: if before 07:00, it's UTC — add 4 hours
    if (checkIn) {
      const [h, m] = checkIn.split(':').map(Number)
      if (h < 7) {
        const newH = h + 4
        checkIn = `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
        changed = true
      }
    }

    // Fix check-out: if after 19:00, it's UTC — add 4 hours would push past midnight, likely wrong
    // If between 15:00-16:30, it's likely already Oman time (3:00-4:30 PM)
    // If before 12:00, it might be UTC
    if (checkOut) {
      const [h, m] = checkOut.split(':').map(Number)
      // Check-outs at 15:xx-16:xx are already Oman time (employees leave 3:30 PM)
      // Only fix if clearly UTC (e.g. 11:xx would be 15:xx Oman)
      if (h < 12 && h >= 8) {
        const newH = h + 4
        checkOut = `${String(newH).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
        changed = true
      }
    }

    if (changed && checkIn && checkOut) {
      const [inH, inM] = checkIn.split(':').map(Number)
      const [outH, outM] = checkOut.split(':').map(Number)
      const workMinutes = (outH * 60 + outM) - (inH * 60 + inM)
      const workHours = workMinutes > 0 ? Math.round(workMinutes / 60 * 100) / 100 : 0
      const overtime = Math.max(0, Math.round((workHours - workHoursPerDay) * 100) / 100)

      await pool.query(
        'UPDATE attendance SET check_in = $1, check_out = $2, work_hours = $3, overtime_hours = $4 WHERE id = $5',
        [checkIn, checkOut, workHours, overtime, rec.id]
      )
      results.push(`Fixed #${rec.id} (emp ${rec.employee_id}): ${rec.check_in}→${checkIn}, ${rec.check_out}→${checkOut}, work=${workHours}h, OT=${overtime}h`)
    } else if (changed && checkIn && !checkOut) {
      await pool.query(
        'UPDATE attendance SET check_in = $1 WHERE id = $2',
        [checkIn, rec.id]
      )
      results.push(`Fixed #${rec.id} (emp ${rec.employee_id}): check_in ${rec.check_in}→${checkIn} (no check-out)`)
    } else {
      results.push(`Skipped #${rec.id} (emp ${rec.employee_id}): ${checkIn}→${checkOut} (already correct)`)
    }
  }

  return NextResponse.json({ success: true, fixed: results })
}
