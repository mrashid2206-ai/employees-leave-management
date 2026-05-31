import pool from '@/lib/db'

// Run a piece of idempotent DDL at most once per process. Self-heals legacy
// databases (e.g. provisioned from the older supabase migration) without paying
// the DDL cost on every request like the previous inline ALTERs did. On failure
// the cached promise is cleared so a later call retries.
function once(): (sql: string) => Promise<void> {
  let cached: Promise<void> | null = null
  let lastSql = ''
  return (sql: string) => {
    if (!cached || lastSql !== sql) {
      lastSql = sql
      cached = pool
        .query(sql)
        .then(() => {})
        .catch((e) => {
          cached = null
          throw e
        })
    }
    return cached
  }
}

const employeeAuthCols = once()
export function ensureEmployeeAuthColumns(): Promise<void> {
  return employeeAuthCols(`
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS username VARCHAR(100),
      ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255),
      ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE
  `)
}

const employeeProfileColsRunner = once()
export function ensureEmployeeProfileColumns(): Promise<void> {
  return employeeProfileColsRunner(`
    ALTER TABLE employees
      ADD COLUMN IF NOT EXISTS join_date DATE,
      ADD COLUMN IF NOT EXISTS email VARCHAR(200),
      ADD COLUMN IF NOT EXISTS phone VARCHAR(50),
      ADD COLUMN IF NOT EXISTS position VARCHAR(200)
  `)
}

const attendanceLocationColsRunner = once()
export function ensureAttendanceLocationColumns(): Promise<void> {
  return attendanceLocationColsRunner(`
    ALTER TABLE attendance
      ADD COLUMN IF NOT EXISTS check_in_lat DECIMAL(10,7),
      ADD COLUMN IF NOT EXISTS check_in_lng DECIMAL(10,7),
      ADD COLUMN IF NOT EXISTS check_in_ip VARCHAR(100),
      ADD COLUMN IF NOT EXISTS check_out_lat DECIMAL(10,7),
      ADD COLUMN IF NOT EXISTS check_out_lng DECIMAL(10,7),
      ADD COLUMN IF NOT EXISTS check_out_ip VARCHAR(100),
      ADD COLUMN IF NOT EXISTS is_offsite BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS is_offsite_checkout BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS excused_tardiness BOOLEAN DEFAULT FALSE
  `)
}

const settingsColsRunner = once()
export function ensureSettingsColumns(): Promise<void> {
  return settingsColsRunner(`
    ALTER TABLE settings
      ADD COLUMN IF NOT EXISTS work_start_time TIME DEFAULT '07:30',
      ADD COLUMN IF NOT EXISTS work_days VARCHAR(20) DEFAULT '0,1,2,3,4',
      ADD COLUMN IF NOT EXISTS office_lat DECIMAL(10,7),
      ADD COLUMN IF NOT EXISTS office_lng DECIMAL(10,7),
      ADD COLUMN IF NOT EXISTS office_radius INT DEFAULT 200,
      ADD COLUMN IF NOT EXISTS office_ip VARCHAR(100),
      ADD COLUMN IF NOT EXISTS block_offsite_checkin BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS last_reset_year INT
  `)
}

// Add the UNIQUE indexes the ON CONFLICT seeds rely on. CREATE UNIQUE INDEX fails (and
// is swallowed) if duplicates currently exist — run /api/cleanup first to dedupe, then
// these lock in to prevent future duplicates.
const uniqueConstraintsRunner = once()
export function ensureUniqueConstraints(): Promise<void> {
  return uniqueConstraintsRunner(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_types_name_en ON leave_types(name_en);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_holidays_date ON holidays(date);
  `)
}

const hotIndexesRunner = once()
export function ensureHotIndexes(): Promise<void> {
  return hotIndexesRunner(`
    CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
    CREATE INDEX IF NOT EXISTS idx_leave_emp_status ON leave_requests(employee_id, status);
    CREATE INDEX IF NOT EXISTS idx_attendance_emp_date ON attendance(employee_id, date);
  `)
}

// Widen leave-day/balance columns to NUMERIC so half-day (0.5) leaves persist, and
// track the half-day intent so admin edits don't silently inflate 0.5 back to 1.
const fractionalLeaveColsRunner = once()
export function ensureFractionalLeaveColumns(): Promise<void> {
  return fractionalLeaveColsRunner(`
    ALTER TABLE leave_requests ALTER COLUMN days_count TYPE NUMERIC(5,1);
    ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS is_half_day BOOLEAN DEFAULT FALSE;
    ALTER TABLE employees ALTER COLUMN leave_balance TYPE NUMERIC(5,1);
  `)
}
