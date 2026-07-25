import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// Integration tests run against a REAL Postgres named by TEST_DATABASE_URL (a throwaway
// database — migrations are applied and tables are truncated between tests). Without
// that env var the suites skip themselves, so `npm run test:integration` is always safe.
//   createdb employees_test
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/employees_test npm run test:integration
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.itest.ts'],
    globalSetup: ['tests/integration/setup.ts'],
    // The service layer reads DATABASE_URL via src/lib/db.ts — point it at the test DB.
    // JWT_SECRET lets the authorization suite mint real tokens and call route handlers.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL || '',
      JWT_SECRET: process.env.JWT_SECRET || 'integration-test-secret-at-least-32-chars',
    },
    fileParallelism: false, // shared database: run suites sequentially
    testTimeout: 20000,
  },
})
