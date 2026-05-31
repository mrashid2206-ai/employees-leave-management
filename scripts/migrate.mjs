// Standalone migration runner: `node scripts/migrate.mjs`
// Applies db/migrations/*.sql once each, tracked in schema_migrations, under an
// advisory lock. Reads DB config from env (loading .env.local if present), the same
// way src/lib/db.ts does. Use this locally and in CI; the app can also run it at boot.
import { readdir, readFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { Pool } from 'pg'

// Load .env.local (Next loads this automatically; a plain node script does not).
const envPath = path.join(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}

const dbUrl = process.env.DATABASE_URL || ''
const pool = new Pool(
  dbUrl
    ? { connectionString: dbUrl }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'employees_db',
      }
)

const LOCK_KEY = 8273641

async function main() {
  const dir = path.join(process.cwd(), 'db', 'migrations')
  const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY])
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW()
    )`)
    const { rows } = await client.query('SELECT version FROM schema_migrations')
    const done = new Set(rows.map(r => r.version))
    let count = 0
    for (const file of files) {
      const version = file.replace(/\.sql$/, '')
      if (done.has(version)) { console.log(`[migrate] skip ${version} (already applied)`); continue }
      const sql = await readFile(path.join(dir, file), 'utf8')
      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        await client.query('COMMIT')
        console.log(`[migrate] applied ${version}`)
        count++
      } catch (e) {
        await client.query('ROLLBACK')
        throw new Error(`migration ${version} failed: ${e instanceof Error ? e.message : e}`)
      }
    }
    console.log(`[migrate] done — ${count} applied, ${files.length - count} already current`)
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    client.release()
    await pool.end()
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1) })
