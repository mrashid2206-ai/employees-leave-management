import type { Settings, Employee, LeaveRequest, TardinessRecord, LeaveType, Department, DepartmentUpdate } from '@/lib/types'

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) {
    // Prefer the server's own message (often bilingual, e.g. why a balance edit or an
    // admin deletion was refused) so the UI can show it rather than a bare status code.
    const data = await res.json().catch(() => null)
    throw new Error(data?.error || `API error: ${res.status}`)
  }
  return res.json()
}

// Settings
export async function getSettings(): Promise<Settings> {
  return fetchJSON('/api/settings')
}

export async function updateSettings(settings: Partial<Settings>): Promise<Settings> {
  return fetchJSON('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
}

// Departments
export async function getDepartments(): Promise<Department[]> {
  return fetchJSON('/api/departments')
}

export async function createDepartment(name: string): Promise<Department> {
  return fetchJSON('/api/departments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
}

export async function updateDepartment(id: number, data: string | DepartmentUpdate): Promise<Department> {
  // Accepts a bare name (rename) or a partial update including the work schedule.
  const body = typeof data === 'string' ? { name: data } : data
  return fetchJSON(`/api/departments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteDepartment(id: number): Promise<void> {
  const res = await fetch(`/api/departments/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Error')
  }
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
  return fetchJSON('/api/holidays', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(holiday),
  })
}

export async function updateHoliday(id: number, holiday: { name: string; date: string }): Promise<Holiday> {
  return fetchJSON(`/api/holidays/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(holiday),
  })
}

export async function deleteHoliday(id: number): Promise<void> {
  await fetch(`/api/holidays/${id}`, { method: 'DELETE' })
}

// Leave Types
export async function getLeaveTypes(): Promise<LeaveType[]> {
  return fetchJSON('/api/leave-types')
}

export async function createLeaveType(leaveType: { name_ar: string; name_en: string; color: string }): Promise<LeaveType> {
  return fetchJSON('/api/leave-types', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leaveType),
  })
}

export async function updateLeaveType(id: number, leaveType: { name_ar: string; name_en: string; color: string }): Promise<LeaveType> {
  return fetchJSON(`/api/leave-types/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(leaveType),
  })
}

export async function deleteLeaveType(id: number): Promise<void> {
  const res = await fetch(`/api/leave-types/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const data = await res.json()
    throw new Error(data.error || 'Error')
  }
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
  return fetchJSON(`/api/employees/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(employee),
  })
}

export async function createEmployee(employee: {
  name: string
  department_id: number
  leave_balance?: number
  join_date?: string
  email?: string
  phone?: string
  position?: string
}): Promise<Employee> {
  return fetchJSON('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(employee),
  })
}

export async function deleteEmployee(id: number): Promise<void> {
  await fetchJSON(`/api/employees/${id}`, { method: 'DELETE' })
}

// Leave Requests
export async function getLeaveRequests(): Promise<LeaveRequest[]> {
  return fetchJSON('/api/leaves')
}

export async function getLeaveRequestsByEmployee(employeeId: number): Promise<LeaveRequest[]> {
  return fetchJSON(`/api/leaves/by-employee/${employeeId}`)
}

export async function createLeaveRequest(request: {
  employee_id: number
  leave_type_id: number
  start_date: string
  end_date: string
  days_count: number
  notes?: string
  is_half_day?: boolean
}): Promise<LeaveRequest> {
  return fetchJSON('/api/leaves', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
}

export async function deleteLeaveRequest(id: number): Promise<void> {
  await fetch(`/api/leaves/${id}`, { method: 'DELETE' })
}

export async function updateLeaveStatus(id: number, status: string): Promise<LeaveRequest & { balance_after?: number | null }> {
  return fetchJSON(`/api/leaves/${id}/approve`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

// Tardiness
export async function getTardinessRecords(): Promise<TardinessRecord[]> {
  return fetchJSON('/api/tardiness')
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
  const result = await fetchJSON<TardinessRecord[]>('/api/tardiness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
  return Array.isArray(result) ? result[0] : result
}

export async function createBulkTardiness(records: {
  employee_id: number
  date: string
  time: string
  minutes_late: number
  notes?: string
}[]): Promise<TardinessRecord[]> {
  return fetchJSON('/api/tardiness', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(records),
  })
}

export async function deleteTardinessRecord(id: number): Promise<void> {
  await fetch(`/api/tardiness/${id}`, { method: 'DELETE' })
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

export async function getCorrections(): Promise<AttendanceCorrection[]> {
  return fetchJSON('/api/corrections')
}

export async function createCorrectionRequest(input: {
  employee_id: number
  date: string
  requested_check_in?: string | null
  requested_check_out?: string | null
  reason: string
}): Promise<AttendanceCorrection> {
  return fetchJSON('/api/corrections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
}

export async function reviewCorrectionRequest(id: number, status: 'approved' | 'rejected'): Promise<AttendanceCorrection> {
  return fetchJSON(`/api/corrections/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

// Conflict Detection
export async function checkLeaveConflict(
  employeeId: number,
  startDate: string,
  endDate: string,
  excludeRequestId?: number
): Promise<{ conflict: boolean; message: string; absentCount: number }> {
  return fetchJSON('/api/conflict-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      employee_id: employeeId,
      start_date: startDate,
      end_date: endDate,
      exclude_request_id: excludeRequestId,
    }),
  })
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
  return fetchJSON('/api/admin-users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function deleteAdminUser(id: number): Promise<void> {
  await fetchJSON(`/api/admin-users/${id}`, { method: 'DELETE' })
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
