// Compare each employee's STORED leave balance against what the records say it should be.
//
//   node scripts/reconcile-balances.mjs
//   node scripts/reconcile-balances.mjs --threshold=0.5   # only report drift above 0.5 day
//
// Why this exists: the stored balance is a running total mutated by many code paths —
// approve, reject, edit, delete, absence charge, absence refund, tardiness penalty, yearly
// reset. Two separate bugs have already let it drift silently (a leave created
// already-approved that never deducted, and an absence charge that threw on fractional
// balances). Drift is invisible until someone happens to notice a wrong number, which is
// a bad way to run leave accounting.
//
// Expected = annual allowance
//            - approved leave days inside the fiscal year
//            - leave charged by tardiness inside the fiscal year
//
// DELIBERATELY REPORT-ONLY. There is no --apply, because drift has causes this script
// cannot see: an admin may have adjusted a balance by hand for a legitimate reason, or an
// employee may have carried something over. Overwriting a balance from a formula would
// destroy that intent. Investigate what the drift is, then correct it deliberately.
//
// Exit code is 1 when drift is found, so this can run as a scheduled check.
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

const thresholdArg = process.argv.find(a => a.startsWith('--threshold='))
const THRESHOLD = thresholdArg ? parseFloat(thresholdArg.split('=')[1]) : 0.01

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

const SQL = `
  WITH s AS (SELECT annual_leave_balance, year_start, year_end FROM settings ORDER BY id LIMIT 1)
  SELECT e.id,
         e.name,
         e.leave_balance::numeric AS stored,
         COALESCE(lv.days, 0)::numeric  AS approved_days,
         COALESCE(td.days, 0)::numeric  AS tardiness_days,
         (s.annual_leave_balance - COALESCE(lv.days, 0) - COALESCE(td.days, 0))::numeric AS expected
    FROM employees e
    CROSS JOIN s
    LEFT JOIN LATERAL (
      SELECT SUM(days_count) AS days FROM leave_requests lr
       WHERE lr.employee_id = e.id AND lr.status = 'approved'
         AND lr.start_date >= s.year_start AND lr.end_date <= s.year_end
    ) lv ON true
    LEFT JOIN LATERAL (
      SELECT SUM(leave_deducted) AS days FROM tardiness_log t
       WHERE t.employee_id = e.id
         AND t.date >= s.year_start AND t.date <= s.year_end
    ) td ON true
   WHERE e.is_active = true
   ORDER BY e.name`

async function main() {
  const { rows: where } = await pool.query('SELECT current_database() AS db, inet_server_addr()::text AS host')
  const { rows: fy } = await pool.query(
    'SELECT annual_leave_balance, year_start::text AS ys, year_end::text AS ye FROM settings ORDER BY id LIMIT 1'
  )
  console.log(`Database    : ${where[0].db} @ ${where[0].host || 'local socket'}`)
  console.log(`Fiscal year : ${fy[0]?.ys} → ${fy[0]?.ye}   (allowance ${fy[0]?.annual_leave_balance} days)`)
  console.log(`Threshold   : drift > ${THRESHOLD} day\n`)

  const { rows } = await pool.query(SQL)
  const withDrift = rows
    .map(r => ({ ...r, drift: Math.round((parseFloat(r.stored) - parseFloat(r.expected)) * 1000) / 1000 }))
    .filter(r => Math.abs(r.drift) > THRESHOLD)
    .sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))

  if (withDrift.length === 0) {
    console.log(`All ${rows.length} active employees reconcile within ${THRESHOLD} day. Nothing to investigate.`)
    return
  }

  console.table(
    withDrift.map(r => ({
      employee: r.name,
      stored: parseFloat(r.stored),
      approved_days: parseFloat(r.approved_days),
      tardiness_days: parseFloat(r.tardiness_days),
      expected: parseFloat(r.expected),
      drift: r.drift,
      reading: r.drift > 0 ? 'has MORE than records justify' : 'has LESS than records justify',
    }))
  )

  const total = withDrift.reduce((sum, r) => sum + Math.abs(r.drift), 0)
  console.log(`\n${withDrift.length} of ${rows.length} employees drift. Total absolute drift: ${Math.round(total * 1000) / 1000} days.`)
  console.log('\nThis script does not correct anything — drift can be a deliberate manual')
  console.log('adjustment. To investigate one employee, list their leave and tardiness rows')
  console.log('and compare against the audit log before changing a balance.')
  process.exitCode = 1
}

main()
  .catch(e => { console.error(e.message || e); process.exitCode = 1 })
  .finally(() => pool.end())
