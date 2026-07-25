import { SignJWT } from 'jose'
import pool from '@/lib/db'
import { getJwtSecret } from '@/lib/jwt'

export const HAS_TEST_DB = !!process.env.TEST_DATABASE_URL

export const ADMIN = { role: 'admin', username: 'admin-test' }

export interface SeededDb {
  employeeId: number
  annualTypeId: number
}

// Wipe transactional data and re-seed the reference rows every test needs, so each test
// starts from a known state. Only ever runs against the test database.
export async function resetDb(): Promise<SeededDb> {
  await pool.query(`
    TRUNCATE attendance_corrections, push_subscriptions, employee_notifications,
             audit_log, permissions, tardiness_log, attendance, leave_requests,
             employees, leave_types, departments, settings, holidays,
             automation_effects, automation_runs, error_log, admin_users
    RESTART IDENTITY CASCADE
  `)

  // verifyAdmin now confirms the identity still exists and that its token version
  // matches, so admin-authenticated route tests need a real admin row.
  await pool.query(
    `INSERT INTO admin_users (username, password_hash, name, role, is_active)
     VALUES ($1, 'x', 'Test Admin', 'admin', true)`,
    [ADMIN.username]
  )

  await pool.query(`
    INSERT INTO settings (id, year_start, year_end, annual_leave_balance, work_hours_per_day,
                          max_absent_same_dept, work_start_time, work_days)
    VALUES (1, '2020-01-01', '2030-12-31', 30, 8, 2, '08:00', '0,1,2,3,4')
  `)
  await pool.query("INSERT INTO departments (name) VALUES ('TestDept')")
  const { rows: types } = await pool.query(`
    INSERT INTO leave_types (name_ar, name_en, color) VALUES
      ('سنوية', 'Annual', '#4CAF50'),
      ('مرضية', 'Sick', '#FF9800'),
      ('طارئة', 'Emergency', '#F44336')
    RETURNING id, name_en
  `)
  const { rows: emp } = await pool.query(
    `INSERT INTO employees (name, department_id, leave_balance, is_active, username)
     VALUES ('Test Employee', 1, 30, true, 'test.employee') RETURNING id`
  )

  return {
    employeeId: emp[0].id,
    annualTypeId: types.find((t: { name_en: string }) => t.name_en === 'Annual').id,
  }
}

/**
 * Add another employee. Deliberately NOT part of resetDb: the automation suites assert
 * exact counts ("1 absence marked"), so a second person in the shared fixture silently
 * changes what those tests mean.
 */
export async function addEmployee(name = 'Other Employee', username = 'other.employee'): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO employees (name, department_id, leave_balance, is_active, username)
     VALUES ($1, 1, 30, true, $2) RETURNING id`,
    [name, username]
  )
  return rows[0].id
}

export async function balanceOf(employeeId: number): Promise<number> {
  const { rows } = await pool.query('SELECT leave_balance FROM employees WHERE id = $1', [employeeId])
  return parseFloat(rows[0].leave_balance)
}

export async function closePool(): Promise<void> {
  await pool.end()
}

/* -------------------------------------------------------------------------- */
/* Auth helpers — mint real tokens so route handlers can be called directly.   */
/* -------------------------------------------------------------------------- */

/** `tv` defaults to 0, matching the token_version a freshly seeded row has. */
export async function employeeToken(id: number, opts: { tv?: number; username?: string } = {}) {
  return new SignJWT({
    id,
    username: opts.username ?? 'test.employee',
    name: 'Test Employee',
    role: 'employee',
    department_id: 1,
    tv: opts.tv ?? 0,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(getJwtSecret())
}

export async function adminToken(opts: { tv?: number; username?: string } = {}) {
  return new SignJWT({
    username: opts.username ?? ADMIN.username,
    name: 'Test Admin',
    role: 'admin',
    tv: opts.tv ?? 0,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1h')
    .setIssuedAt()
    .sign(getJwtSecret())
}

type Auth = { employee: string } | { admin: string } | Record<string, never>

/** Build a Request carrying the right auth cookie for a route handler under test. */
export function authedRequest(url: string, auth: Auth, init: RequestInit = {}): Request {
  const cookie =
    'employee' in auth && auth.employee
      ? `emp-auth-token=${auth.employee}`
      : 'admin' in auth && auth.admin
        ? `auth-token=${auth.admin}`
        : ''
  const headers = new Headers(init.headers)
  if (cookie) headers.set('cookie', cookie)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return new Request(url, { ...init, headers })
}

/** Next 15+ passes route params as a promise. */
export const routeParams = <T extends Record<string, string>>(p: T) => ({ params: Promise.resolve(p) })
