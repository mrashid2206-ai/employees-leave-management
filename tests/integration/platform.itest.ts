import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest'
import bcrypt from 'bcryptjs'
import pool from '@/lib/db'
import { bumpTokenVersion, tokenIsCurrent } from '@/lib/token-version'
import { setBootMigrationState, getBootMigrationState } from '@/lib/boot-status'
import {
  HAS_TEST_DB, resetDb, closePool, adminToken, authedRequest, routeParams,
} from './helpers'

// Two failures that used to be invisible:
//  - a session revocation that failed was logged and then reported as success, so a
//    password reset or an offboarding could leave the old sessions working;
//  - a failed boot migration left the app serving a partly migrated schema while
//    /api/health said "ok".

const BASE = 'http://localhost'

// Make any write to employees.token_version fail, the way a real DB error would, while
// leaving every other employees update working.
async function blockTokenVersionWrites() {
  await pool.query(`
    CREATE OR REPLACE FUNCTION itest_block_tv() RETURNS trigger AS $$
    BEGIN
      IF NEW.token_version IS DISTINCT FROM OLD.token_version THEN
        RAISE EXCEPTION 'token_version write blocked (test)';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql
  `)
  await pool.query(`
    CREATE TRIGGER itest_block_tv BEFORE UPDATE ON employees
    FOR EACH ROW EXECUTE FUNCTION itest_block_tv()
  `)
}

async function unblockTokenVersionWrites() {
  await pool.query('DROP TRIGGER IF EXISTS itest_block_tv ON employees')
  await pool.query('DROP FUNCTION IF EXISTS itest_block_tv()')
}

async function employeeRow(id: number) {
  const { rows } = await pool.query(
    'SELECT token_version, is_active, password_hash FROM employees WHERE id = $1',
    [id]
  )
  return rows[0]
}

describe.skipIf(!HAS_TEST_DB)('platform hardening', () => {
  let employeeId: number
  let adminCookie: string

  beforeEach(async () => {
    employeeId = (await resetDb()).employeeId
    adminCookie = await adminToken()
    await pool.query("UPDATE employees SET password_hash = $1 WHERE id = $2", [await bcrypt.hash('original-pass', 4), employeeId])
  })

  afterEach(async () => {
    await unblockTokenVersionWrites()
  })

  afterAll(async () => {
    await closePool()
  })

  describe('bumpTokenVersion', () => {
    it('revokes existing sessions', async () => {
      await bumpTokenVersion('employee', employeeId)
      expect((await employeeRow(employeeId)).token_version).toBe(1)
      expect(await tokenIsCurrent('employee', employeeId, 0)).toBe(false)
      expect(await tokenIsCurrent('employee', employeeId, 1)).toBe(true)
    })

    it('throws when the revocation fails, instead of reporting success', async () => {
      await blockTokenVersionWrites()
      await expect(bumpTokenVersion('employee', employeeId)).rejects.toThrow(/blocked/)
    })
  })

  describe('a failed revocation fails the request that asked for it', () => {
    it('reset-password: 500, and the password is left unchanged', async () => {
      const before = await employeeRow(employeeId)
      await blockTokenVersionWrites()
      const { PUT } = await import('@/app/api/employees/[id]/reset-password/route')
      const res = await PUT(
        authedRequest(`${BASE}/api/employees/${employeeId}/reset-password`, { admin: adminCookie }, {
          method: 'PUT',
          body: JSON.stringify({ password: 'brand-new-password' }),
        }),
        routeParams({ id: String(employeeId) })
      )
      expect(res.status).toBe(500)
      const after = await employeeRow(employeeId)
      expect(after.password_hash).toBe(before.password_hash)
      expect(after.token_version).toBe(0)
    })

    it('reset-password succeeds and ends old sessions when the bump works', async () => {
      const { PUT } = await import('@/app/api/employees/[id]/reset-password/route')
      const res = await PUT(
        authedRequest(`${BASE}/api/employees/${employeeId}/reset-password`, { admin: adminCookie }, {
          method: 'PUT',
          body: JSON.stringify({ password: 'brand-new-password' }),
        }),
        routeParams({ id: String(employeeId) })
      )
      expect(res.status).toBe(200)
      expect((await employeeRow(employeeId)).token_version).toBe(1)
      expect(await tokenIsCurrent('employee', employeeId, 0)).toBe(false)
    })

    it('deactivation (DELETE): the request fails and the employee stays active', async () => {
      await pool.query(
        `INSERT INTO leave_requests (employee_id, leave_type_id, start_date, end_date, days_count, status)
         VALUES ($1, 1, '2029-01-06', '2029-01-06', 1, 'pending')`,
        [employeeId]
      )
      await blockTokenVersionWrites()
      const { DELETE } = await import('@/app/api/employees/[id]/route')
      await expect(
        DELETE(
          authedRequest(`${BASE}/api/employees/${employeeId}`, { admin: adminCookie }, { method: 'DELETE' }),
          routeParams({ id: String(employeeId) })
        )
      ).rejects.toThrow(/blocked/)
      expect((await employeeRow(employeeId)).is_active).toBe(true)
      // The whole offboarding rolled back, not just the bump.
      const { rows } = await pool.query('SELECT status FROM leave_requests WHERE employee_id = $1', [employeeId])
      expect(rows[0].status).toBe('pending')
    })

    it('deactivation from the edit form (PUT is_active=false): fails and rolls back', async () => {
      await blockTokenVersionWrites()
      const { PUT } = await import('@/app/api/employees/[id]/route')
      await expect(
        PUT(
          authedRequest(`${BASE}/api/employees/${employeeId}`, { admin: adminCookie }, {
            method: 'PUT',
            body: JSON.stringify({ is_active: false }),
          }),
          routeParams({ id: String(employeeId) })
        )
      ).rejects.toThrow(/blocked/)
      expect((await employeeRow(employeeId)).is_active).toBe(true)
    })

    it('an ordinary edit (no deactivation) never touches the token version', async () => {
      await blockTokenVersionWrites()
      const { PUT } = await import('@/app/api/employees/[id]/route')
      const res = await PUT(
        authedRequest(`${BASE}/api/employees/${employeeId}`, { admin: adminCookie }, {
          method: 'PUT',
          body: JSON.stringify({ position: 'Clerk' }),
        }),
        routeParams({ id: String(employeeId) })
      )
      expect(res.status).toBe(200)
    })
  })

  describe('/api/health and the boot migration', () => {
    let prev: ReturnType<typeof getBootMigrationState>

    beforeEach(async () => {
      prev = getBootMigrationState()
      // The test setup applies the SQL files directly rather than through the runner,
      // so the runner's bookkeeping table (which /api/health reads) may not exist yet.
      await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())`)
      await pool.query("INSERT INTO schema_migrations (version) VALUES ('itest') ON CONFLICT DO NOTHING")
    })

    afterEach(() => {
      setBootMigrationState(prev)
    })

    it('is ok when the boot migrations succeeded', async () => {
      setBootMigrationState('ok')
      const { GET } = await import('@/app/api/health/route')
      const res = await GET()
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.status).toBe('ok')
      expect(body.db).toBe('up')
      expect(body.migrations).toBeUndefined()
    })

    it('is 503 degraded when the boot migrations failed, even with the DB up', async () => {
      setBootMigrationState('failed')
      const { GET } = await import('@/app/api/health/route')
      const res = await GET()
      expect(res.status).toBe(503)
      const body = await res.json()
      expect(body).toMatchObject({ status: 'degraded', db: 'up', migrations: 'failed' })
    })

    it('treats migrations skipped at boot (RUN_MIGRATIONS_AT_BOOT=false) as ok', async () => {
      setBootMigrationState('skipped')
      const { GET } = await import('@/app/api/health/route')
      expect((await GET()).status).toBe(200)
    })
  })
})
