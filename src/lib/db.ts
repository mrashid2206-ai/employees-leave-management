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

// Oman timezone (GMT+4)
export function omanNow(): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Muscat' }))
}

export function omanToday(): string {
  const d = omanNow()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function omanTime(): string {
  const d = omanNow()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`
}
