import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { verifyAdmin, unauthorized } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import { ensureSettingsColumns } from '@/lib/ensure-schema'

export async function POST(request: Request) {
  const admin = await verifyAdmin(request)
  if (!admin) return unauthorized()

  await ensureSettingsColumns().catch(() => {})

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: settings } = await client.query(
      'SELECT id, year_start::text as year_start, year_end::text as year_end, annual_leave_balance, last_reset_year FROM settings ORDER BY id LIMIT 1 FOR UPDATE'
    )
    if (settings.length === 0) {
      await client.query('ROLLBACK')
      return NextResponse.json({ error: 'No settings' }, { status: 400 })
    }
    const s = settings[0]
    const fromYear = new Date(`${s.year_start}T00:00:00Z`).getUTCFullYear()

    // Idempotency: refuse to re-run for a fiscal year already reset, so a duplicate
    // click / retry / cron overlap cannot wipe balances again or double-advance the year.
    if (s.last_reset_year === fromYear) {
      await client.query('ROLLBACK')
      return NextResponse.json(
        { success: false, alreadyReset: true, message: `Fiscal year starting ${s.year_start} has already been reset.` },
        { status: 409 }
      )
    }

    const { rowCount } = await client.query(
      'UPDATE employees SET leave_balance = $1, updated_at = NOW() WHERE is_active = true',
      [s.annual_leave_balance]
    )

    // Advance the fiscal year by one (UTC date math, consistent with stored DATE values).
    const ys = new Date(`${s.year_start}T00:00:00Z`)
    const ye = new Date(`${s.year_end}T00:00:00Z`)
    ys.setUTCFullYear(ys.getUTCFullYear() + 1)
    ye.setUTCFullYear(ye.getUTCFullYear() + 1)
    const newYearStart = ys.toISOString().split('T')[0]
    const newYearEnd = ye.toISOString().split('T')[0]

    await client.query(
      'UPDATE settings SET year_start = $1, year_end = $2, last_reset_year = $3 WHERE id = $4',
      [newYearStart, newYearEnd, fromYear, s.id]
    )

    await client.query('COMMIT')

    await logAudit('yearly_reset', admin.username, 'admin', `Yearly reset: ${rowCount} employees, fiscal year ${s.year_start} → ${newYearStart}`)

    return NextResponse.json({
      success: true,
      employeesReset: rowCount,
      newBalance: s.annual_leave_balance,
      newYearStart,
      newYearEnd,
    })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
