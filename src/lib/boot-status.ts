// What happened to the boot-time migration run (src/instrumentation.ts), for /api/health.
//
// A failed boot migration used to be one log line, after which the app carried on
// serving a partly migrated schema while /api/health reported "ok". Railway's health
// check and any uptime monitor were told everything was fine; the first sign of trouble
// was a user hitting a missing column.
//
// Kept on globalThis rather than in a module-level variable: Next bundles
// instrumentation.ts and the route handlers separately, so each can end up with its own
// copy of this module, and a plain `let` set by one is never seen by the other. The
// process is the one thing they share.

export type BootMigrationState = 'ok' | 'failed' | 'skipped' | 'pending'

const KEY = Symbol.for('employees.bootMigrationState')

type Holder = { [KEY]?: BootMigrationState }

export function setBootMigrationState(state: BootMigrationState): void {
  ;(globalThis as Holder)[KEY] = state
}

/**
 * 'pending' until register() has finished (or in a process that never ran it, such as a
 * test runner), 'skipped' when RUN_MIGRATIONS_AT_BOOT=false.
 */
export function getBootMigrationState(): BootMigrationState {
  return (globalThis as Holder)[KEY] ?? 'pending'
}
