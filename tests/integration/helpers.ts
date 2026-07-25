import pool from '@/lib/db'

export const HAS_TEST_DB = !!process.env.TEST_DATABASE_URL

// Wipe transactional data and re-seed the reference rows every test needs, so each test
// starts from a known state. Only ever runs against the test database.
export async function resetDb(): Promise<{ employeeId: number; annualTypeId: number }> {
  await pool.query(`
    TRUNCATE attendance_corrections, push_subscriptions, employee_notifications,
             audit_log, permissions, tardiness_log, attendance, leave_requests,
             employees, leave_types, departments, settings, holidays
    RESTART IDENTITY CASCADE
  `)

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

export async function balanceOf(employeeId: number): Promise<number> {
  const { rows } = await pool.query('SELECT leave_balance FROM employees WHERE id = $1', [employeeId])
  return parseFloat(rows[0].leave_balance)
}

export async function closePool(): Promise<void> {
  await pool.end()
}

export const ADMIN = { role: 'admin', username: 'admin-test' }
