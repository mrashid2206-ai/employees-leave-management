// Next.js 16 boot hook: validate configuration (fail fast in production) and bring the
// schema up to date. Migrations run at boot BY DEFAULT — they are the single source of
// schema truth now that the per-request DDL self-heal is gone, so a deploy that forgets
// `npm run migrate` still ends up with a correct schema. Opt out with
// RUN_MIGRATIONS_AT_BOOT=false (e.g. if you gate migrations behind a release step).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { validateEnv } = await import('@/lib/env')
  validateEnv()

  if (process.env.RUN_MIGRATIONS_AT_BOOT === 'false') return
  try {
    const { runMigrations } = await import('@/lib/migrate')
    await runMigrations()
  } catch (e) {
    const { logger } = await import('@/lib/log')
    logger.error('boot migration run failed', e)
  }
}
