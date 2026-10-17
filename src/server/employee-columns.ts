// The employee columns an API response may carry. Use this instead of `RETURNING *`:
// the row also holds password_hash and token_version, which must never leave the server.
export const EMPLOYEE_COLUMNS = `id, name, department_id, leave_balance::float8 as leave_balance, is_active, username,
  join_date::text as join_date, email, phone, position, created_at, updated_at,
  work_start_time::text as work_start_time, work_days, work_hours_per_day`
