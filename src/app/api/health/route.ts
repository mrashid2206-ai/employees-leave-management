import { NextResponse } from 'next/server'
import pool from '@/lib/db'
import { getBootMigrationState } from '@/lib/boot-status'

// Liveness + readiness for uptime monitors and Railway health checks.
//
// Deliberately checks the DATABASE, not just that Node is answering: this app is useless
// without Postgres, and "the process is up" is the least interesting kind of healthy.
//
// Also reports a failed boot migration (see src/lib/boot-status.ts). The app keeps
// serving after one, on a schema that may be missing whatever the failed file added, and
// this used to say "ok" regardless. Now it's a 503, so Railway won't promote a deploy
// whose migrations failed and a monitor pages someone about a running one.
//
// Unauthenticated on purpose (a health check that needs a credential is not a health
// check), so it reports nothing sensitive: no versions, no config, no error details. The
// applied schema version is included because it is exactly what you want when verifying a
// deploy actually migrated — it names a migration file, which is public in the repo.

export const dynamic = 'force-dynamic'

export async function GET() {
  const started = Date.now()
  const migrationsFailed = getBootMigrationState() === 'failed'
  const migrations = migrationsFailed ? { migrations: 'failed' as const } : {}
  try {
    const { rows } = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    )
    return NextResponse.json(
      {
        status: migrationsFailed ? 'degraded' : 'ok',
        db: 'up',
        ...migrations,
        schemaVersion: rows[0]?.version ?? null,
        latencyMs: Date.now() - started,
      },
      { status: migrationsFailed ? 503 : 200, headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    // 503 so monitors and orchestrators treat it as down, rather than a 200 with a sad
    // message in the body that nothing will ever alert on.
    return NextResponse.json(
      { status: 'degraded', db: 'down', ...migrations, latencyMs: Date.now() - started },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
