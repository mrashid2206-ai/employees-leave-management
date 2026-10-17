// Next.js 16 boot hook: validate configuration (fail fast in production) and bring the
// schema up to date. Migrations run at boot BY DEFAULT — they are the single source of
// schema truth now that the per-request DDL self-heal is gone, so a deploy that forgets
// `npm run migrate` still ends up with a correct schema. Opt out with
// RUN_MIGRATIONS_AT_BOOT=false (e.g. if you gate migrations behind a release step).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { validateEnv } = await import('@/lib/env')
  validateEnv()

  const { setBootMigrationState } = await import('@/lib/boot-status')
  if (process.env.RUN_MIGRATIONS_AT_BOOT === 'false') {
    setBootMigrationState('skipped')
    return
  }
  try {
    const { runMigrations } = await import('@/lib/migrate')
    await runMigrations()
    setBootMigrationState('ok')
  } catch (e) {
    // Keep serving (so an admin can still reach the app and the logs say why), but
    // remember it: /api/health reports 503 'degraded' for as long as this process runs
    // on a schema it failed to bring up to date. A restart retries the migrations.
    setBootMigrationState('failed')
    const { logger } = await import('@/lib/log')
    logger.error('boot migration run failed', e)
  }
}

// Next's global server-error hook: fires for every error the server captures, in route
// handlers, server components and the proxy alike. Persisting here means a production
// 500 is discoverable afterwards instead of scrolling past in stdout.
//
// Typed loosely rather than with `Instrumentation.onRequestError` so this file stays
// importable from the edge runtime, where `pg` cannot load.
export async function onRequestError(
  err: unknown,
  request: { path?: string; method?: string },
  context: { routeType?: string }
) {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  try {
    const { recordError } = await import('@/lib/error-log')
    const e = err as { message?: string; stack?: string; digest?: string }
    await recordError({
      message: e?.message || String(err),
      stack: e?.stack,
      digest: e?.digest,
      path: request?.path,
      method: request?.method,
      source: context?.routeType || 'server',
    })
  } catch {
    // Reporting must never mask the original error.
  }
}
