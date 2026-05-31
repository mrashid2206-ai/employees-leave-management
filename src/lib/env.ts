import { logger } from '@/lib/log'

// Validate environment configuration once at boot. Fatal problems (no DB config, no
// JWT secret) abort startup in production (fail fast) instead of surfacing as confusing
// runtime 500s / silent localhost fallbacks; weaker issues are warned about.
export function validateEnv(): void {
  const problems: string[] = []
  const warnings: string[] = []

  const hasDbUrl = !!process.env.DATABASE_URL
  const hasDbParts = !!(process.env.DB_HOST && process.env.DB_NAME)
  if (!hasDbUrl && !hasDbParts) {
    problems.push('No database configuration: set DATABASE_URL (preferred) or DB_HOST + DB_NAME')
  }

  if (!process.env.JWT_SECRET) {
    problems.push('JWT_SECRET is required (sign-in fails without it)')
  } else if (process.env.JWT_SECRET.length < 32) {
    warnings.push('JWT_SECRET is shorter than 32 characters — use a longer random secret')
  }

  if (!process.env.ADMIN_PASSWORD) {
    warnings.push('ADMIN_PASSWORD is unset — the bootstrap "admin" login is disabled')
  }
  if (process.env.SMTP_USER && !process.env.SMTP_PASS) {
    warnings.push('SMTP_USER set without SMTP_PASS — email notifications will not send')
  }
  if (process.env.RUN_MIGRATIONS_AT_BOOT === 'true') {
    logger.info('env: migrations will run at boot (RUN_MIGRATIONS_AT_BOOT=true)')
  }

  for (const w of warnings) logger.warn(`env: ${w}`)

  if (problems.length > 0) {
    const msg = `Invalid environment configuration:\n  - ${problems.join('\n  - ')}`
    if (process.env.NODE_ENV === 'production') {
      throw new Error(msg)
    }
    logger.error('env: ' + msg)
  }
}
