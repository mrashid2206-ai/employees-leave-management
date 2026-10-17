import { Pool } from 'pg'
import { logger } from '@/lib/log'

const dbUrl = process.env.DATABASE_URL || ''

const common = {
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  max: 10,
  // With only 10 connections, one runaway query or a transaction left open by a bug can
  // starve every request. And because each authenticated request checks its token
  // against the DB, a starved pool turns into everyone being logged out. Migrations lift
  // the statement limit for their own session (src/lib/migrate.ts).
  statement_timeout: 30000,
  idle_in_transaction_session_timeout: 60000,
}

const pool = new Pool(
  dbUrl
    ? { connectionString: dbUrl, ...common }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'employees_db',
        ...common,
      }
)

// An idle client that loses its connection (a Postgres restart or failover on Railway)
// emits 'error' on the pool. With no listener, Node treats that as an unhandled error and
// the whole process exits. The pool already drops the broken client and opens a new one
// on the next query, so logging the error is all that's needed.
pool.on('error', err => {
  logger.error('idle database client error', err)
})

export default pool

// Oman timezone (GMT+4).
//
// The implementations live in src/lib/oman-date.ts so CLIENT components can use the same
// ones — this module opens a pg Pool and cannot be bundled for the browser. Re-exported
// here so every existing server import keeps working.
export { omanToday, omanYesterday, omanTime, addDays } from '@/lib/oman-date'

export function omanNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Muscat' }))
}
