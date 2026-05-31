// Next.js 16 boot hook. Validates configuration (fail fast in production) and, when
// explicitly enabled, applies pending schema migrations. Migration failures are logged
// but never crash the server (the app's self-heal still covers gaps).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { validateEnv } = await import('@/lib/env')
  validateEnv()

  if (process.env.RUN_MIGRATIONS_AT_BOOT !== 'true') return
  try {
    const { runMigrations } = await import('@/lib/migrate')
    await runMigrations()
  } catch (e) {
    const { logger } = await import('@/lib/log')
    logger.error('boot migration run failed', e)
  }
}
