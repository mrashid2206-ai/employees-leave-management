// Declare a public holiday retroactively and undo the absences it caused.
//
// Holidays in Oman are often announced at short notice — sometimes the day before, or the
// morning of. By the time the holiday is entered, the nightly automation has already run:
// everyone who did not check in that day is marked absent, and each absence charges an
// annual leave day. This puts that right.
//
//   node scripts/declare-holiday.mjs --date=2026-06-18 --name="Eid holiday"
//   node scripts/declare-holiday.mjs --date=2026-06-18 --name="Eid holiday" --apply
//
// It reports by default and changes nothing without --apply. With --apply it:
//   1. adds the date to `holidays` (skipped if already there),
//   2. refunds any leave charged for that date by the absence rule,
//   3. rewrites that day's 'absent' attendance rows to 'holiday'.
//
// Safe to re-run: each step is conditional on the state it is fixing.
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

const arg = (name) => {
  const found = process.argv.find(a => a.startsWith(`--${name}=`))
  return found ? found.split('=').slice(1).join('=') : null
}
const APPLY = process.argv.includes('--apply')
const DATE = arg('date')
const NAME = arg('name') || 'Public Holiday'
const AUTO_NOTE = 'Auto-deducted: absent without leave'

if (!DATE || !/^\d{4}-\d{2}-\d{2}$/.test(DATE)) {
  console.error('Usage: node scripts/declare-holiday.mjs --date=YYYY-MM-DD [--name="..."] [--apply]')
  process.exit(1)
}

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

async function main() {
  const { rows: where } = await pool.query('SELECT current_database() AS db, inet_server_addr()::text AS host')
  console.log(`Database: ${where[0].db} @ ${where[0].host || 'local socket'}`)
  console.log(`Date    : ${DATE}  (${NAME})\n`)

  const { rows: existing } = await pool.query('SELECT name FROM holidays WHERE date = $1', [DATE])
  const { rows: absents } = await pool.query(
    `SELECT e.name FROM attendance a JOIN employees e ON e.id = a.employee_id
      WHERE a.date = $1 AND a.status = 'absent' ORDER BY e.name`,
    [DATE]
  )
  const { rows: charges } = await pool.query(
    `SELECT e.name, lr.days_count::numeric AS days
       FROM leave_requests lr JOIN employees e ON e.id = lr.employee_id
      WHERE lr.start_date = $1 AND lr.end_date = $1
        AND lr.status = 'approved' AND lr.notes = $2
      ORDER BY e.name`,
    [DATE, AUTO_NOTE]
  )

  console.log(`Already a holiday      : ${existing.length ? `yes ("${existing[0].name}")` : 'no'}`)
  console.log(`Absences to convert    : ${absents.length}`)
  console.log(`Leave days to refund   : ${charges.length}`)
  if (absents.length) console.log(`\nMarked absent that day:\n  ${absents.map(a => a.name).join('\n  ')}`)
  if (charges.length) {
    console.log('\nWill refund:')
    console.table(charges)
  }

  if (!APPLY) {
    console.log('\nREPORT ONLY — nothing was changed. Re-run with --apply.')
    return
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      'INSERT INTO holidays (name, date) VALUES ($1, $2) ON CONFLICT (date) DO NOTHING',
      [NAME, DATE]
    )

    // Refund first, while the leave rows are still identifiable.
    const { rows: refunded } = await client.query(
      `UPDATE leave_requests SET status = 'cancelled', updated_at = NOW()
        WHERE start_date = $1 AND end_date = $1 AND status = 'approved' AND notes = $2
        RETURNING employee_id, days_count`,
      [DATE, AUTO_NOTE]
    )
    for (const r of refunded) {
      await client.query(
        'UPDATE employees SET leave_balance = leave_balance + $1, updated_at = NOW() WHERE id = $2',
        [r.days_count, r.employee_id]
      )
    }

    const { rowCount: converted } = await client.query(
      `UPDATE attendance SET status = 'holiday', is_holiday_work = false
        WHERE date = $1 AND status = 'absent'`,
      [DATE]
    )

    await client.query(
      `INSERT INTO audit_log (action, user_id, user_role, details)
       VALUES ('holiday_declared', 'script', 'admin', $1)`,
      [`Declared ${DATE} as "${NAME}": ${converted} absence(s) converted, ${refunded.length} leave day(s) refunded`]
    )

    await client.query('COMMIT')
    console.log(`\nApplied. ${converted} absence(s) converted to 'holiday', ${refunded.length} leave day(s) refunded.`)
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
