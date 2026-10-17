import type { Settings, Employee, LeaveRequest, TardinessRecord, LeaveType, Department, DepartmentUpdate } from '@/lib/types'
import type { DateSpan } from '@/lib/query-keys'

// Every helper here throws on a non-2xx response, with the server's own message when it
// sent one. Several used to call fetch() and return regardless, so a refused delete (a
// holiday, a leave request, a tardiness row) reported success and the row came back on
// the next refresh. Pages call these rather than fetch() so that can't recur.

async function request(url: string, options?: RequestInit): Promise<Response> {
  const res = await fetch(url, options)
  if (!res.ok) {
    // Prefer the server's own message (often bilingual, e.g. why a balance edit or an
    // admin deletion was refused) so the UI can show it rather than a bare status code.
    // The yearly reset reports a refusal as `message` rather than `error`.
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || data?.message || `API error: ${res.status}`)
  }
  return res
}

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  return (await request(url, options)).json()
}

function jsonBody(method: string, body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
}

/** `from=&to=` for the list endpoints that take an inclusive date range. */
function spanQuery(span: DateSpan): string {
  return new URLSearchParams({ from: span.start, to: span.end }).toString()
}

// Settings
export async function getSettings(): Promise<Settings> {
  return fetchJSON('/api/settings')
}

export async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  return fetchJSON('/api/settings', jsonBody('PUT', settings))
}

// Departments
export async function getDepartments(): Promise<Department[]> {
  return fetchJSON('/api/departments')
}

export async function createDepartment(name: string): Promise<Department> {
  return fetchJSON('/api/departments', jsonBody('POST', { name }))
}

export async function updateDepartment(id: number, data: string | DepartmentUpdate): Promise<Department> {
  // Accepts a bare name (rename) or a partial update including the work schedule.
  const body = typeof data === 'string' ? { name: data } : data
  return fetchJSON(`/api/departments/${id}`, jsonBody('PUT', body))
}

export async function deleteDepartment(id: number): Promise<void> {
  await request(`/api/departments/${id}`, { method: 'DELETE' })
}

// Holidays
export interface Holiday {
  id: number
  name: string
  date: string
}

export async function getHolidays(): Promise<Holiday[]> {
  return fetchJSON('/api/holidays')
}

export async function createHoliday(holiday: { name: string; date: string }): Promise<Holiday> {
  return fetchJSON('/api/holidays', jsonBody('POST', holiday))
}

export async function updateHoliday(id: number, holiday: { name: string; date: string }): Promise<Holiday> {
  return fetchJSON(`/api/holidays/${id}`, jsonBody('PUT', holiday))
}

export async function deleteHoliday(id: number): Promise<void> {
  await request(`/api/holidays/${id}`, { method: 'DELETE' })
}

export interface HolidaySeedResult {
  year: number
  addedCount: number
  skippedCount: number
  estimatedCount: number
}

export async function seedHolidays(year: number, lang: string): Promise<HolidaySeedResult> {
  return fetchJSON('/api/holidays/seed', jsonBody('POST', { year, lang }))
}

// Leave Types
export async function getLeaveTypes(): Promise<LeaveType[]> {
  return fetchJSON('/api/leave-types')
}

export async function createLeaveType(leaveType: { name_ar: string; name_en: string; color: string }): Promise<LeaveType> {
  return fetchJSON('/api/leave-types', jsonBody('POST', leaveType))
}

export async function updateLeaveType(id: number, leaveType: { name_ar: string; name_en: string; color: string }): Promise<LeaveType> {
  return fetchJSON(`/api/leave-types/${id}`, jsonBody('PUT', leaveType))
}

export async function deleteLeaveType(id: number): Promise<void> {
  await request(`/api/leave-types/${id}`, { method: 'DELETE' })
}

// Employees
export async function getEmployees(): Promise<Employee[]> {
  return fetchJSON('/api/employees')
}

export async function getEmployee(id: number): Promise<Employee> {
  return fetchJSON(`/api/employees/${id}`)
}

/** balance_reason is required by the server whenever leave_balance actually changes. */
export type EmployeeUpdate = Partial<Employee> & { balance_reason?: string }

export async function updateEmployee(id: number, employee: EmployeeUpdate): Promise<Employee> {
  return fetchJSON(`/api/employees/${id}`, jsonBody('PUT', employee))
}

export interface EmployeeCreate {
  name: string
  department_id: number
  leave_balance?: number
  join_date?: string
  email?: string
  phone?: string
  position?: string
}

export async function createEmployee(employee: EmployeeCreate): Promise<Employee> {
  return fetchJSON('/api/employees', jsonBody('POST', employee))
}

export async function deleteEmployee(id: number): Promise<void> {
  await request(`/api/employees/${id}`, { method: 'DELETE' })
}

/**
 * Set an employee's password. Leaving `password` out resets it to the shared default AND
 * makes them change it at their next login; passing one (even the default) does not.
 */
export async function resetEmployeePassword(id: number, password?: string): Promise<void> {
  await request(`/api/employees/${id}/reset-password`, jsonBody('PUT', password ? { password } : {}))
}

// Leave Requests

// Takes no arguments on purpose: pages hand it straight to useQuery as `queryFn`, which
// calls it with react-query's context object. The ranged variant is separate for that reason.
export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  return fetchJSON('/api/leaves')
}

/** Requests whose start_date falls in the span, e.g. one leave year. */
export async function getLeaveRequestsInSpan(span: DateSpan): Promise<LeaveRequest[]> {
  return fetchJSON(`/api/leaves?${spanQuery(span)}`)
}

export async function getLeaveRequestsByEmployee(employeeId: number): Promise<LeaveRequest[]> {
  return fetchJSON(`/api/leaves/by-employee/${employeeId}`)
}

export async function createLeaveRequest(input: {
  employee_id: number
  leave_type_id: number
  start_date: string
  end_date: string
  days_count: number
  notes?: string
  is_half_day?: boolean
}): Promise<LeaveRequest> {
  return fetchJSON('/api/leaves', jsonBody('POST', input))
}

export async function deleteLeaveRequest(id: number): Promise<void> {
  await request(`/api/leaves/${id}`, { method: 'DELETE' })
}

// Tardiness

// No arguments, for the same reason as getLeaveRequests.
export async function getTardinessRecords(): Promise<TardinessRecord[]> {
  return fetchJSON('/api/tardiness')
}

export async function getTardinessInSpan(span: DateSpan): Promise<TardinessRecord[]> {
  return fetchJSON(`/api/tardiness?${spanQuery(span)}`)
}

export async function getTardinessByEmployee(employeeId: number): Promise<TardinessRecord[]> {
  return fetchJSON(`/api/tardiness/by-employee/${employeeId}`)
}

export async function createTardinessRecord(record: {
  employee_id: number
  date: string
  time: string
  minutes_late: number
  notes?: string
}): Promise<TardinessRecord> {
  const result = await fetchJSON<TardinessRecord[]>('/api/tardiness', jsonBody('POST', record))
  return Array.isArray(result) ? result[0] : result
}

export async function createBulkTardiness(records: {
  employee_id: number
  date: string
  time: string
  minutes_late: number
  notes?: string
}[]): Promise<TardinessRecord[]> {
  return fetchJSON('/api/tardiness', jsonBody('POST', records))
}

export async function deleteTardinessRecord(id: number): Promise<void> {
  await request(`/api/tardiness/${id}`, { method: 'DELETE' })
}

// Attendance
export interface AttendanceFilter {
  month?: string // YYYY-MM
  date?: string // YYYY-MM-DD
}

/** Rows carry more than any one page reads, so each page names the fields it uses. */
export async function getAttendance<T>(filter: AttendanceFilter): Promise<T[]> {
  const sp = new URLSearchParams()
  if (filter.month) sp.set('month', filter.month)
  if (filter.date) sp.set('date', filter.date)
  return fetchJSON(`/api/attendance?${sp}`)
}

export interface AttendanceUpsert {
  employee_id: number
  date: string
  check_in: string
  check_out: string
  status: string
}

export async function upsertAttendance(records: AttendanceUpsert[]): Promise<unknown> {
  return fetchJSON('/api/attendance', jsonBody('POST', records))
}

export async function updateAttendance(id: number, patch: Record<string, unknown>): Promise<{ refundedDays?: number; chargedDays?: number }> {
  return fetchJSON(`/api/attendance/${id}`, jsonBody('PUT', patch))
}

export async function deleteAttendance(id: number): Promise<{ refundedDays?: number }> {
  return fetchJSON(`/api/attendance/${id}`, { method: 'DELETE' })
}

// Permissions (stepping out of the office mid-day)
export interface Permission {
  id: number
  employee_id: number
  employee?: { id: number; name: string }
  date: string
  leave_time: string
  return_time: string | null
  reason: string | null
  status: string
  /** The reviewer. The column predates the rejection path and kept its name. */
  approved_by: string | null
  reviewed_at?: string | null
  decision_note?: string | null
  created_at: string
}

export async function getPermissions(span?: DateSpan): Promise<Permission[]> {
  return fetchJSON(span ? `/api/permissions?${spanQuery(span)}` : '/api/permissions')
}

export async function deletePermission(id: number): Promise<void> {
  await request(`/api/permissions/${id}`, { method: 'DELETE' })
}

// Attendance corrections
export interface AttendanceCorrection {
  id: number
  employee_id: number
  date: string
  requested_check_in: string | null
  requested_check_out: string | null
  reason: string
  status: string
  reviewed_by: string | null
  created_at: string
  employee?: { id: number; name: string; department_id: number }
}

export async function getCorrections(span?: DateSpan): Promise<AttendanceCorrection[]> {
  return fetchJSON(span ? `/api/corrections?${spanQuery(span)}` : '/api/corrections')
}

export async function createCorrectionRequest(input: {
  employee_id: number
  date: string
  requested_check_in?: string | null
  requested_check_out?: string | null
  reason: string
}): Promise<AttendanceCorrection> {
  return fetchJSON('/api/corrections', jsonBody('POST', input))
}

// Conflict Detection
export async function checkLeaveConflict(
  employeeId: number,
  startDate: string,
  endDate: string,
  excludeRequestId?: number
): Promise<{ conflict: boolean; message: string; absentCount: number }> {
  return fetchJSON('/api/conflict-check', jsonBody('POST', {
    employee_id: employeeId,
    start_date: startDate,
    end_date: endDate,
    exclude_request_id: excludeRequestId,
  }))
}

// Admin users
export interface AdminUser {
  id: number
  username: string
  name: string
  role: string
  is_active: boolean
  created_at: string
  /** The signed-in admin's own row: the server refuses to delete it. */
  is_self: boolean
}

export async function getAdminUsers(): Promise<AdminUser[]> {
  return fetchJSON('/api/admin-users')
}

export async function createAdminUser(data: { username: string; password: string; name: string }): Promise<AdminUser> {
  return fetchJSON('/api/admin-users', jsonBody('POST', data))
}

export async function deleteAdminUser(id: number): Promise<void> {
  await request(`/api/admin-users/${id}`, { method: 'DELETE' })
}

// Audit log
export interface AuditEntry {
  id: number
  action: string
  user_id: string | null
  user_role: string | null
  details: string | null
  created_at: string
}

export interface AuditPage {
  rows: AuditEntry[]
  total: number
  limit?: number
  offset?: number
  truncated?: boolean
  actions: string[]
  roles: string[]
}

/** Filters, paging and `export=1` go in `params`, exactly as /api/audit reads them. */
export async function getAuditLog(params: URLSearchParams): Promise<AuditPage> {
  return fetchJSON(`/api/audit?${params}`)
}

// Automation
export interface AutomationRun {
  id: number
  kind: string
  target_date: string | null
  actor: string | null
  summary: Record<string, number | string>
  created_at: string
  reversed_at: string | null
  reversed_by: string | null
  effect_count: number
}

export interface AutomationHealth {
  status: 'ok' | 'stale' | 'no_runs_yet' | 'unknown'
  lastCompleted: string | null
  scheduled: boolean
}

/** What the daily process / yearly reset report back, as the settings page shows it. */
export interface AutomationResult {
  absentMarked?: number
  leaveDeducted?: number
  tardinessCreated?: number
  employeesReset?: number
  newBalance?: number
  newYearStart?: string
  newYearEnd?: string
}

export async function getAutomationRuns(): Promise<AutomationRun[]> {
  return fetchJSON('/api/automation/runs')
}

/**
 * The one endpoint that answers non-2xx on purpose: 503 means "stale", and the body is
 * still the status to show. So this reads the body whatever the code, and only gives up
 * when there isn't one.
 */
export async function getAutomationHealth(): Promise<AutomationHealth | null> {
  const res = await fetch('/api/health/automation')
  return res.json().catch(() => null)
}

export async function reverseAutomationRun(id: number): Promise<{ reversed: Record<string, number> }> {
  return fetchJSON(`/api/automation/runs/${id}/reverse`, { method: 'POST' })
}

export async function runDailyProcess(date: string): Promise<AutomationResult> {
  return fetchJSON('/api/automation/daily', jsonBody('POST', { date }))
}

export async function runYearlyReset(): Promise<AutomationResult> {
  return fetchJSON('/api/automation/yearly-reset', { method: 'POST' })
}

// Error log
export interface ErrorLogRow {
  id: number
  message: string
  stack: string | null
  path: string | null
  method: string | null
  source: string | null
  created_at: string
}

export async function getErrorLog(limit = 50): Promise<{ rows: ErrorLogRow[]; total: number }> {
  return fetchJSON(`/api/errors?limit=${limit}`)
}

// Approval decisions
//
// Unlike fetchJSON, a refusal keeps the server's whole body: approving a leave can come
// back as a department-limit warning (`warning`, `absentCount`, `maxAbsent`) that the page
// turns into an "approve anyway?" prompt rather than a dead-end error.
export class DecisionError extends Error {
  readonly status: number
  readonly body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === 'string' ? body.error : `API error: ${status}`)
    this.status = status
    this.body = body
  }
}

async function sendDecision<T>(url: string, method: string, payload: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new DecisionError(res.status, data ?? {})
  return data as T
}

// The corrections list carries the decision fields too (reviewed_at, decision_note).
export type ReviewedCorrection = AttendanceCorrection & import('@/lib/types').DecisionFields

export async function decideLeave(
  id: number,
  status: 'approved' | 'rejected' | 'pending',
  opts: { note?: string | null; force?: boolean } = {}
): Promise<LeaveRequest & { balance_after?: number | null }> {
  return sendDecision(`/api/leaves/${id}/approve`, 'PUT', { status, ...opts })
}

export interface BulkDecisionItem {
  id: number
  ok: boolean
  error?: string
  status?: number
  warning?: boolean
  balance_after?: number | null
}

export async function decideLeavesBulk(input: {
  ids: number[]
  status: 'approved' | 'rejected'
  note?: string | null
  force?: boolean
}): Promise<{ results: BulkDecisionItem[]; succeeded: number; failed: number }> {
  return sendDecision('/api/leaves/bulk-status', 'POST', input)
}

export async function decidePermission(
  id: number,
  status: 'approved' | 'rejected',
  note?: string | null
): Promise<Record<string, unknown>> {
  return sendDecision(`/api/permissions/${id}`, 'PUT', { status, note })
}

export async function decideCorrection(
  id: number,
  status: 'approved' | 'rejected',
  note?: string | null
): Promise<ReviewedCorrection> {
  return sendDecision(`/api/corrections/${id}`, 'PUT', { status, note })
}
