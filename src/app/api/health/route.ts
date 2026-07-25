import { NextResponse } from 'next/server'
import pool from '@/lib/db'

// Liveness + readiness for uptime monitors and Railway health checks.
//
// Deliberately checks the DATABASE, not just that Node is answering: this app is useless
// without Postgres, and "the process is up" is the least interesting kind of healthy.
//
// Unauthenticated on purpose (a health check that needs a credential is not a health
// check), so it reports nothing sensitive: no versions, no config, no error details. The
// applied schema version is included because it is exactly what you want when verifying a
// deploy actually migrated — it names a migration file, which is public in the repo.

export const dynamic = 'force-dynamic'

export async function GET() {
  const started = Date.now()
  try {
    const { rows } = await pool.query(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1'
    )
    return NextResponse.json(
      {
        status: 'ok',
        db: 'up',
        schemaVersion: rows[0]?.version ?? null,
        latencyMs: Date.now() - started,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    // 503 so monitors and orchestrators treat it as down, rather than a 200 with a sad
    // message in the body that nothing will ever alert on.
    return NextResponse.json(
      { status: 'degraded', db: 'down', latencyMs: Date.now() - started },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
