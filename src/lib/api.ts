import type { Settings, Employee, LeaveRequest, TardinessRecord, LeaveType, Department } from '@/lib/types'

async function fetchJSON<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options)
  if (!res.ok) throw new Error(`API error: ${res.status}`)
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

export async function updateDepartment(id: number, name: string): Promise<Department> {
  return fetchJSON(`/api/departments/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
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

export async function updateEmployee(id: number, employee: Partial<Employee>): Promise<Employee> {
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
}): Promise<Employee> {
  return fetchJSON('/api/employees', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(employee),
  })
}

export async function deleteEmployee(id: number): Promise<void> {
  await fetch(`/api/employees/${id}`, { method: 'DELETE' })
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

export async function updateLeaveStatus(id: number, status: string): Promise<LeaveRequest> {
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
