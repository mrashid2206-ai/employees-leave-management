import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

// Seeds the throwaway e2e database: applies all migrations, then creates the fixed
// users/settings the specs rely on. Fails fast if TEST_DATABASE_URL is unset so we can
// never point the suite at a real database.
export const E2E = {
  employee: { username: 'e2e.employee', password: 'e2e-pass-123' },
  // Separate user so the forced-password spec can't affect the other specs' login.
  newHire: { username: 'e2e.newhire', password: 'e2e-pass-123' },
  admin: { username: 'admin', password: 'e2e-admin-pass' },
}

export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL
  if (!url) throw new Error('TEST_DATABASE_URL must point at a throwaway e2e database')

  const pool = new Pool({ connectionString: url })
  try {
    const dir = path.join(process.cwd(), 'db', 'migrations')
    const files = (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()
    for (const file of files) {
      await pool.query(await readFile(path.join(dir, file), 'utf8'))
    }

    await pool.query(`
      TRUNCATE attendance_corrections, push_subscriptions, employee_notifications,
               audit_log, permissions, tardiness_log, attendance, leave_requests,
               employees, leave_types, departments, settings, admin_users
      RESTART IDENTITY CASCADE
    `)

    await pool.query(`
      INSERT INTO settings (id, year_start, year_end, annual_leave_balance, work_hours_per_day,
                            max_absent_same_dept, work_start_time, work_days)
      VALUES (1, '2020-01-01', '2035-12-31', 30, 8, 2, '08:00', '0,1,2,3,4')
    `)
    await pool.query("INSERT INTO departments (name) VALUES ('E2E Dept')")
    await pool.query(`
      INSERT INTO leave_types (name_ar, name_en, color) VALUES
        ('سنوية', 'Annual', '#4CAF50'), ('مرضية', 'Sick', '#FF9800')
    `)

    const hash = await bcrypt.hash(E2E.employee.password, 10)
    await pool.query(
      `INSERT INTO employees (name, department_id, leave_balance, is_active, username, password_hash, must_change_password)
       VALUES ('E2E Employee', 1, 30, true, $1, $2, false)`,
      [E2E.employee.username, hash]
    )
    await pool.query(
      `INSERT INTO employees (name, department_id, leave_balance, is_active, username, password_hash, must_change_password)
       VALUES ('E2E New Hire', 1, 30, true, $1, $2, true)`,
      [E2E.newHire.username, hash]
    )
  } finally {
    await pool.end()
  }
}
