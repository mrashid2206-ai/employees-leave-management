import { Pool } from 'pg'

const dbUrl = process.env.DATABASE_URL || ''

const pool = new Pool(
  dbUrl
    ? {
        connectionString: dbUrl,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        max: 10,
      }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'employees_db',
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        max: 10,
      }
)

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
