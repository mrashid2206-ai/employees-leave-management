// Next.js 16 boot hook. Runs schema migrations at startup ONLY when explicitly
// enabled (RUN_MIGRATIONS_AT_BOOT=true) so it never surprises an existing deploy.
// Otherwise migrations are applied via `npm run migrate` (CLI / CI). Failures are
// logged but never crash the server (the app's self-heal still covers gaps).
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  if (process.env.RUN_MIGRATIONS_AT_BOOT !== 'true') return
  try {
    const { runMigrations } = await import('@/lib/migrate')
    await runMigrations()
  } catch (e) {
    console.error('[migrate] boot migration run failed:', e instanceof Error ? e.message : e)
  }
}
