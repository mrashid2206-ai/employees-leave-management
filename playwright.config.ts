import { defineConfig, devices } from '@playwright/test'

// End-to-end specs for the few flows that only break across the full stack (proxy
// cookie redirects + react-query + two JWT identities + Postgres). They need a real
// browser and a throwaway database, so they are NOT part of the per-PR CI — run them
// on demand / pre-deploy:
//   createdb employees_e2e
//   npx playwright install --with-deps chromium
//   TEST_DATABASE_URL=postgres://user:pass@localhost:5432/employees_e2e npm run test:e2e
const PORT = process.env.E2E_PORT || '3123'
const TEST_DB = process.env.TEST_DATABASE_URL || ''

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    locale: 'en-US',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next build && npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: TEST_DB,
      JWT_SECRET: 'e2e-test-secret-at-least-32-characters-long',
      ADMIN_PASSWORD: 'e2e-admin-pass',
      NODE_ENV: 'production',
    },
  },
})
