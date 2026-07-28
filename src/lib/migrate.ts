import { promises as fs } from 'fs'
import path from 'path'
import pool from '@/lib/db'

// Arbitrary key so concurrent instances don't apply migrations at the same time.
const LOCK_KEY = 8273641

// Apply pending SQL migrations from db/migrations/ exactly once each, tracked in a
// schema_migrations table, under an advisory lock. Each file runs in its own
// transaction. This is the single source of schema truth (replacing scattered
// runtime DDL); files must be idempotent so re-applying a baseline is harmless.
export async function runMigrations(): Promise<{ applied: string[] }> {
  const dir = path.join(process.cwd(), 'db', 'migrations')
  let files: string[]
  try {
    files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort()
  } catch {
    console.warn('[migrate] no db/migrations directory found — skipping')
    return { applied: [] }
  }

  const client = await pool.connect()
  const applied: string[] = []
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )`)
    const { rows } = await client.query('SELECT version FROM schema_migrations')
    const done = new Set(rows.map(r => r.version))

    for (const file of files) {
      const version = file.replace(/\.sql$/, '')
      if (done.has(version)) continue
      const sql = await fs.readFile(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        await client.query('COMMIT')
        applied.push(version)
        console.log(`[migrate] applied ${version}`)
      } catch (e) {
        await client.query('ROLLBACK')
        console.error(`[migrate] FAILED ${version}:`, e instanceof Error ? e.message : e)
        throw e
      }
    }
    return { applied }
  } finally {
    // Safe to ignore: releasing the connection below drops the session and with it any
    // session-scoped advisory lock, so a failed explicit unlock cannot strand it.
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    client.release()
  }
}
