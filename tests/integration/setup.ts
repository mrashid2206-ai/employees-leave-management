import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'

// Global setup for integration tests: applies every migration to the throwaway test
// database named by TEST_DATABASE_URL. Never touches dev/prod — if TEST_DATABASE_URL is
// unset the suites skip themselves instead.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) {
    console.warn('[itest] TEST_DATABASE_URL not set — integration tests will be skipped')
    return
  }

  const pool = new Pool({ connectionString: url })
  try {
    const dir = path.join(process.cwd(), 'db', 'migrations')
    const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      const sql = await readFile(path.join(dir, file), 'utf8')
      await pool.query(sql)
    }
  } finally {
    await pool.end()
  }
}
