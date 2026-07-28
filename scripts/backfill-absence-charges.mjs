// Backfill leave deductions for absences that were never charged.
//
// Absences created outside the nightly automation — marked by an admin, or imported in
// bulk — recorded the absence but deducted nothing, because only the automation charged
// the day. (Fixed in src/lib/auto-absence.ts; this repairs the data already recorded.)
//
//   node scripts/backfill-absence-charges.mjs            # REPORT ONLY — changes nothing
//   node scripts/backfill-absence-charges.mjs --apply    # apply the deductions
//
// Safe to re-run: a day is only charged when no non-cancelled leave request already
// covers it, so applying twice cannot double-charge. Reversible: every charge is a normal
// approved leave row noted 'Auto-deducted: absent without leave', so setting the day back
// to present refunds it through the usual path.
import fs from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'

const envPath = path.join(process.cwd(), '.env.local')
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const APPLY = process.argv.includes('--apply')
const AUTO_NOTE = 'Auto-deducted: absent without leave'

// Dates to leave alone entirely, e.g. a company closure that was never entered as a
// public holiday. Without this, a day when the office was shut looks identical to a day
// when everyone individually failed to turn up.
//   --exclude-dates=2026-06-18,2026-07-01
const excludeArg = process.argv.find(a => a.startsWith('--exclude-dates='))
const EXCLUDED = new Set(
  excludeArg ? excludeArg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean) : []
)

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'employees_db',
      }
)

// Absent days with no leave request covering them.
//
// Public holidays and non-working weekdays are excluded outright: the nightly automation
// never marks those absent, so an 'absent' row on one can only have arrived by hand or by
// import, and charging leave for a day nobody was expected to work would be wrong.
// work_days is the settings default ('0,1,2,3,4' = Sun-Thu); a per-employee or
// per-department override is respected via COALESCE, matching src/lib/schedule.ts.
const UNCHARGED = `
  SELECT a.employee_id, e.name, a.date::text AS date, e.leave_balance::numeric AS balance
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    LEFT JOIN departments d ON d.id = e.department_id
    CROSS JOIN LATERAL (SELECT work_days FROM settings ORDER BY id LIMIT 1) s
   WHERE a.status = 'absent'
     AND NOT EXISTS (
       SELECT 1 FROM leave_requests lr
        WHERE lr.employee_id = a.employee_id
          AND lr.start_date = a.date AND lr.end_date = a.date
          AND lr.status <> 'cancelled'
     )
     AND NOT EXISTS (SELECT 1 FROM holidays h WHERE h.date = a.date)
     AND EXTRACT(DOW FROM a.date)::text = ANY (
       string_to_array(COALESCE(e.work_days, d.work_days, s.work_days), ',')
     )
   ORDER BY e.name, a.date`

async function main() {
  // Always say WHICH database this is and what is in it. Without this the script can
  // report "nothing to do" simply because it was pointed at an empty or stale database,
  // which reads exactly like "your data is fine" — the most dangerous possible output
  // for a repair tool.
  const { rows: where } = await pool.query(
    'SELECT current_database() AS db, inet_server_addr()::text AS host'
  )
  const { rows: counts } = await pool.query(`
    SELECT (SELECT COUNT(*)::int FROM attendance) AS attendance_rows,
           (SELECT COUNT(*)::int FROM attendance WHERE status = 'absent') AS absent_rows,
           (SELECT COUNT(*)::int FROM employees) AS employees`)
  const c = counts[0]
  console.log(
    `Database: ${where[0].db} @ ${where[0].host || 'local socket'}\n` +
    `Contents: ${c.employees} employees, ${c.attendance_rows} attendance rows, ${c.absent_rows} marked absent\n`
  )

  if (c.attendance_rows === 0) {
    console.log('WARNING: this database has NO attendance records at all.')
    console.log('If you expected absences here, you are pointed at the wrong database.')
    console.log('Set DATABASE_URL to the production connection string and re-run.\n')
  }

  const all = await pool.query(UNCHARGED)
  const rows = all.rows.filter(r => !EXCLUDED.has(r.date))
  const excludedCount = all.rows.length - rows.length
  if (EXCLUDED.size > 0) {
    console.log(`Excluding ${[...EXCLUDED].join(', ')} — ${excludedCount} day(s) skipped by request.\n`)
  }

  if (rows.length === 0) {
    console.log(
      c.absent_rows === 0
        ? 'No absences recorded in this database, so nothing can be uncharged here.'
        : `All ${c.absent_rows} absence(s) already have a matching leave deduction. Nothing to do.`
    )
    return
  }

  // Group per employee so the report reads the way a person thinks about it.
  const byEmp = new Map()
  for (const r of rows) {
    if (!byEmp.has(r.employee_id)) {
      byEmp.set(r.employee_id, { name: r.name, balance: parseFloat(r.balance), dates: [] })
    }
    byEmp.get(r.employee_id).dates.push(r.date)
  }

  console.log(`${APPLY ? 'APPLYING' : 'REPORT ONLY (re-run with --apply to change data)'}\n`)
  const summary = []
  for (const e of byEmp.values()) {
    // An absence never pushes the balance negative, matching the live rule — so an
    // employee with fewer days left than uncharged absences is only charged what they have.
    const chargeable = Math.min(e.dates.length, Math.max(0, Math.floor(e.balance)))
    summary.push({
      employee: e.name,
      uncharged_days: e.dates.length,
      balance_now: e.balance,
      will_charge: chargeable,
      balance_after: e.balance - chargeable,
      capped: chargeable < e.dates.length ? 'YES — balance runs out' : '',
      first: e.dates[0],
      last: e.dates[e.dates.length - 1],
    })
  }
  console.table(summary)

  const total = summary.reduce((s, r) => s + r.will_charge, 0)
  const skipped = summary.reduce((s, r) => s + (r.uncharged_days - r.will_charge), 0)
  console.log(`\nTotal days to charge: ${total}${skipped ? `  (skipped, insufficient balance: ${skipped})` : ''}`)

  if (!APPLY) {
    console.log('\nNothing was changed. Re-run with --apply to perform the deductions.')
    return
  }

  const client = await pool.connect()
  let charged = 0
  try {
    await client.query('BEGIN')
    const { rows: typeRows } = await client.query(
      "SELECT id FROM leave_types WHERE name_en = 'Annual' ORDER BY id LIMIT 1"
    )
    const annualTypeId = typeRows[0]?.id
    if (!annualTypeId) throw new Error("No 'Annual' leave type found — cannot attribute the deduction")

    for (const [id, e] of byEmp) {
      for (const date of e.dates) {
        // Re-check inside the transaction: same guards as the live code path.
        const { rows: locked } = await client.query(
          'SELECT leave_balance FROM employees WHERE id = $1 FOR UPDATE',
          [id]
        )
        const balance = parseFloat(locked[0]?.leave_balance ?? '0')
        const { rows: ins } = await client.query(
          `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, notes, status)
           SELECT $1, $2, $3, $3, 1, $5, 'approved'
           WHERE $4 > 0
             AND NOT EXISTS (
               SELECT 1 FROM leave_requests
                WHERE employee_id = $1 AND start_date = $3 AND end_date = $3 AND status <> 'cancelled'
             )
           RETURNING id`,
          [id, annualTypeId, date, balance, AUTO_NOTE]
        )
        if (ins.length > 0) {
          await client.query(
            'UPDATE employees SET leave_balance = leave_balance - 1, updated_at = NOW() WHERE id = $1',
            [id]
          )
          charged++
        }
      }
    }

    await client.query(
      `INSERT INTO audit_log (action, user_id, user_role, details)
       VALUES ('absence_backfill', 'script', 'admin', $1)`,
      [`Backfilled ${charged} uncharged absence day(s) across ${byEmp.size} employee(s)`]
    )

    await client.query('COMMIT')
    console.log(`\nApplied. ${charged} day(s) charged.`)
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('\nFAILED — rolled back, no changes made:', err.message)
    process.exitCode = 1
  } finally {
    client.release()
  }
}

main()
  .catch(e => { console.error(e.message || e); process.exitCode = 1 })
  .finally(() => pool.end())
