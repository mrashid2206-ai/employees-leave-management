'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
// The portal's corrections carry the decision (reviewer, date, note) as well.
import type { Holiday, ReviewedCorrection as AttendanceCorrection } from '@/lib/api'
import type { DecisionFields, Employee, LeaveType, Settings } from '@/lib/types'
import { omanToday } from '@/lib/oman-date'
import { leaveYears, inLeaveYear } from '@/lib/leave-year'
import { resolveScheduleFrom, type WorkSchedule } from '@/lib/schedule-core'
import { t as translate, type Lang } from '@/lib/translations'
import { AUTH_CONTEXT_HEADER, EMPLOYEE_CONTEXT } from '@/lib/auth-context'

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

export interface EmpUser {
  id: number
  name: string
  username: string
  must_change_password?: boolean
}

export interface WorkingDaysInfo {
  workingDays: number
  totalDays: number
}

export interface LeaveForecast {
  currentBalance: number
  approvedUpcomingDays: number
  pendingDays: number
  projectedBalance: number
  tardinessDeductedYtd: number
  tardinessProjectedYearEnd: number
  projectedYearEndBalance: number
  expiringDays: number
  daysLeftInYear: number
  yearElapsedFraction: number
  status: 'negative' | 'critical' | 'tight' | 'healthy'
  fiscalYearEnd: string
  annualAllowance: number
}

export interface AttendanceStatus {
  check_in?: string | null
  check_out?: string | null
  work_hours?: number | string | null
  is_holiday_work?: boolean
}

export interface AttendanceRecord {
  id: number
  date: string
  check_in?: string | null
  check_out?: string | null
  work_hours?: number | string | null
  overtime_hours?: number | string | null
  status?: string | null
  notes?: string | null
  is_holiday_work?: boolean
}

export interface TardinessRow {
  id: number
  date: string
  time?: string | null
  minutes_late: number
  leave_deducted?: number
  notes?: string | null
}

export interface MyLeaveRequest extends DecisionFields {
  id: number
  start_date: string
  end_date: string
  days_count: number
  notes?: string | null
  status: string
  leave_type?: LeaveType
}

export interface EmpInfo {
  id: number
  name: string
  username?: string
  leave_balance: number
  department_name?: string
  department?: { name: string }
  annual_leave_balance: number
  used_days: number
  remaining: number
  /** Effective schedule, resolved employee -> department -> settings like the server. */
  schedule: WorkSchedule
}

export interface PermissionRecord {
  id: number
  date: string
  leave_time?: string | null
  return_time?: string | null
  reason?: string | null
  status: string
  reviewed_at?: string | null
  decision_note?: string | null
}

export interface NotificationItem {
  id: number
  message: string
  message_ar: string
  is_read: boolean
  created_at: string
}

export interface CalendarLeave {
  id: number
  start_date: string
  end_date: string
  status: string
  days_count: number
  employee?: { name: string }
  leave_type?: { name_ar: string; name_en: string }
}

export interface CalendarData {
  leaves: CalendarLeave[]
  holidays: Holiday[]
}

/** Mirrors the JSON from POST /api/attendance/check-in. */
export interface CheckActionResult {
  action: 'check-in' | 'check-out'
  time: string
  isOffsite?: boolean
  isHolidayWork?: boolean
  // check-in only: a same-day approved leave was cancelled and its days refunded.
  leaveCancelled?: boolean
  leaveRefundedDays?: number
  // check-out only.
  workHours?: number
  overtime?: number
}

export type { AttendanceCorrection }

/* -------------------------------------------------------------------------- */
/* Errors — the portal shows server-supplied reasons, so the payload must survive */
/* the trip out of a mutation.                                                  */
/* -------------------------------------------------------------------------- */

export interface ApiErrorPayload {
  error?: string
  message?: string
  time?: string
  leave_start?: string
  leave_end?: string
}

export class ApiError extends Error {
  readonly payload: ApiErrorPayload
  readonly status?: number

  constructor(payload: ApiErrorPayload, status?: number) {
    super(payload.error ?? payload.message ?? 'request_failed')
    this.name = 'ApiError'
    this.payload = payload
    this.status = status
  }
}

/* -------------------------------------------------------------------------- */
/* Session expiry                                                              */
/* -------------------------------------------------------------------------- */

let sessionExpiryStarted = false

/**
 * The employee token lasts 12h, and the portal is often left open on a phone for days.
 * Every request then came back 401, each tab swallowed the error into its `= []`
 * default, and the employee saw "No requests" / "No attendance" — indistinguishable
 * from their history being gone. Now the first 401 says so and sends them to sign in.
 *
 * The cookie is cleared first because /employee-login bounces a signed-in employee to
 * /check-in, and a revoked-but-unexpired token would otherwise loop between the two.
 */
export function handleSessionExpired(): void {
  if (sessionExpiryStarted || typeof window === 'undefined') return
  sessionExpiryStarted = true
  try { sessionStorage.removeItem('emp-user') } catch {}
  const lang: Lang = document.documentElement.lang === 'en' ? 'en' : 'ar'
  toast.error(translate('portalSessionExpired', lang))
  // A moment to read the toast before the page changes.
  const leave = () => setTimeout(() => window.location.replace('/employee-login'), 1500)
  fetch('/api/auth/employee-logout', { method: 'POST' }).then(leave, leave)
}

/**
 * Only the auth guard's own 401 means "signed out". change-password also answers 401
 * for a wrong CURRENT password, which must stay an inline error, not a logout. Both
 * bodies come from one helper (unauthorized() in src/lib/api-auth.ts).
 */
function isSessionExpiry(res: Response, payload: ApiErrorPayload): boolean {
  return res.status === 401 && payload.error === 'Unauthorized'
}

async function failWith(res: Response): Promise<never> {
  const payload = await readErrorPayload(res)
  if (isSessionExpiry(res, payload)) handleSessionExpired()
  throw new ApiError(payload, res.status)
}

/** Expired sessions and other client errors won't fix themselves; don't hammer them. */
function retryTransient(failureCount: number, err: unknown): boolean {
  if (err instanceof ApiError && err.status !== undefined && err.status < 500) return false
  return failureCount < 2
}

/** Safely unwraps whatever a mutation rejected with into a server payload. */
export function apiErrorPayload(err: unknown): ApiErrorPayload {
  return err instanceof ApiError ? err.payload : {}
}

/**
 * Non-JSON error bodies yield an empty payload on purpose: callers render
 * `payload.error || t('error')`, so an opaque failure must stay generic rather
 * than leaking a status code into the UI.
 */
async function readErrorPayload(res: Response): Promise<ApiErrorPayload> {
  try {
    const data: unknown = await res.json()
    if (data && typeof data === 'object') return data as ApiErrorPayload
  } catch {
    /* body wasn't JSON */
  }
  return {}
}

// Every portal request goes through these three, so the session-expiry handling above
// covers all of them (queries and mutations alike), and every one is made as the
// employee even if this browser also holds an admin session (see src/lib/auth-context.ts).
const AS_EMPLOYEE = { [AUTH_CONTEXT_HEADER]: EMPLOYEE_CONTEXT }

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: AS_EMPLOYEE })
  if (!res.ok) return failWith(res)
  return res.json() as Promise<T>
}

async function sendJSON<T>(url: string, method: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { ...AS_EMPLOYEE, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) return failWith(res)
  return res.json() as Promise<T>
}

async function sendVoid(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, {
    method,
    ...(body === undefined
      ? { headers: AS_EMPLOYEE }
      : { headers: { ...AS_EMPLOYEE, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  if (!res.ok) return failWith(res)
}

/* -------------------------------------------------------------------------- */
/* Query keys — portal-scoped so the employee portal can never collide with the */
/* admin dashboard's caches for the same entity under a different shape.        */
/* -------------------------------------------------------------------------- */

type EmpId = number | undefined

export const portalKeys = {
  all: ['portal'] as const,
  status: (id: EmpId) => ['portal', 'attendance-status', id] as const,
  requests: (id: EmpId) => ['portal', 'my-requests', id] as const,
  info: (id: EmpId) => ['portal', 'emp-info', id] as const,
  // Month is last so invalidating attendance(id) refreshes every cached month.
  attendance: (id: EmpId, month?: string) =>
    (month ? ['portal', 'attendance', id, month] : ['portal', 'attendance', id]) as readonly unknown[],
  tardiness: (id: EmpId) => ['portal', 'tardiness', id] as const,
  permissions: (id: EmpId) => ['portal', 'permissions', id] as const,
  corrections: (id: EmpId) => ['portal', 'corrections', id] as const,
  notifications: () => ['portal', 'notifications'] as const,
  leaveTypes: () => ['portal', 'leave-types'] as const,
  calendar: () => ['portal', 'calendar'] as const,
  workingDays: (start: string, end: string) => ['portal', 'working-days', start, end] as const,
  forecast: (id: EmpId) => ['portal', 'leave-forecast', id] as const,
}

/* -------------------------------------------------------------------------- */
/* Queries                                                                     */
/* -------------------------------------------------------------------------- */

const retry = retryTransient

export function useLeaveForecast(empId: EmpId) {
  return useQuery({
    retry,
    queryKey: portalKeys.forecast(empId),
    queryFn: async (): Promise<LeaveForecast> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      return getJSON<LeaveForecast>(`/api/leave-forecast?employee_id=${empId}`)
    },
    enabled: !!empId,
  })
}

export function useAttendanceStatus(empId: EmpId) {
  return useQuery({
    retry,
    queryKey: portalKeys.status(empId),
    queryFn: async (): Promise<AttendanceStatus> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      return getJSON<AttendanceStatus>(`/api/attendance/status?employee_id=${empId}`)
    },
    enabled: !!empId,
  })
}

export function useMyRequests(empId: EmpId) {
  return useQuery({
    retry,
    queryKey: portalKeys.requests(empId),
    queryFn: async (): Promise<MyLeaveRequest[]> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      return getJSON<MyLeaveRequest[]>(`/api/leaves/my-requests?employee_id=${empId}`)
    },
    enabled: !!empId,
  })
}

/**
 * The balance card needs three sources at once (profile, org-wide annual balance,
 * approved days) so they are fetched together and cached as one derived record.
 */
export function useEmpInfo(empId: EmpId) {
  return useQuery({
    retry,
    queryKey: portalKeys.info(empId),
    queryFn: async (): Promise<EmpInfo> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      const [emp, settings, leaves] = await Promise.all([
        getJSON<Employee>(`/api/employees/${empId}`),
        getJSON<Settings>('/api/settings'),
        getJSON<MyLeaveRequest[]>(`/api/leaves/my-requests?employee_id=${empId}`),
      ])
      const totalBalance = settings.annual_leave_balance ?? 30
      // This leave year only, like the balance beside it. Every year's leave used to be
      // counted, so after a reset "used" looked like more than the allowance.
      const [currentYear] = leaveYears(settings, 1)
      const usedDays = leaves
        .filter(l => l.status === 'approved' && inLeaveYear(l.start_date, currentYear))
        .reduce((sum, l) => sum + (l.days_count || 0), 0)
      return {
        ...emp,
        annual_leave_balance: totalBalance,
        used_days: usedDays,
        remaining: emp.leave_balance,
        schedule: resolveScheduleFrom(emp, emp.department, settings),
      }
    },
    enabled: !!empId,
  })
}

/**
 * Attendance rows, optionally for one YYYY-MM month (the API filters server-side).
 * Without a month it is the whole history, which the portal no longer needs to fetch.
 */
export function useMyAttendance(empId: EmpId, month?: string, enabled = true) {
  return useQuery({
    retry,
    queryKey: portalKeys.attendance(empId, month),
    queryFn: async (): Promise<AttendanceRecord[]> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      const monthParam = month ? `&month=${month}` : ''
      return getJSON<AttendanceRecord[]>(`/api/attendance?employee_id=${empId}${monthParam}`)
    },
    enabled: !!empId && enabled,
  })
}

/** The employee's own correction requests (the API scopes an employee to themselves). */
export function useMyCorrections(empId: EmpId) {
  return useQuery({
    retry,
    queryKey: portalKeys.corrections(empId),
    queryFn: async (): Promise<AttendanceCorrection[]> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      return getJSON<AttendanceCorrection[]>('/api/corrections')
    },
    enabled: !!empId,
  })
}

export function useMyTardiness(empId: EmpId) {
  return useQuery({
    retry,
    queryKey: portalKeys.tardiness(empId),
    queryFn: async (): Promise<TardinessRow[]> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      return getJSON<TardinessRow[]>(`/api/tardiness/by-employee/${empId}`)
    },
    enabled: !!empId,
  })
}

export function useMyPermissions(empId: EmpId) {
  return useQuery({
    retry,
    queryKey: portalKeys.permissions(empId),
    queryFn: async (): Promise<PermissionRecord[]> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      return getJSON<PermissionRecord[]>(`/api/permissions?employee_id=${empId}`)
    },
    enabled: !!empId,
  })
}

/** Today's open permission (left the office, hasn't logged a return, not rejected). */
export function activePermissionOf(permissions: PermissionRecord[]): PermissionRecord | null {
  // Oman's today, not the device's UTC date — an employee opening the portal before
  // 04:00 local time would otherwise be shown yesterday's permission.
  const today = omanToday()
  return permissions.find(p => p.date === today && !p.return_time && p.status !== 'rejected') ?? null
}

export function useNotifications() {
  return useQuery({
    retry,
    queryKey: portalKeys.notifications(),
    queryFn: () => getJSON<NotificationItem[]>('/api/employee-notifications'),
    // The bell badge must not go stale while the employee moves between tabs.
    staleTime: 15 * 1000,
    // Approvals arrive while the portal sits open on a desk. react-query pauses interval
    // refetches while the document is hidden (refetchIntervalInBackground defaults to
    // false), so a backgrounded tab or locked phone doesn't poll.
    refetchInterval: 60 * 1000,
  })
}

export function useLeaveTypes() {
  return useQuery({
    retry,
    queryKey: portalKeys.leaveTypes(),
    queryFn: () => getJSON<LeaveType[]>('/api/leave-types'),
    staleTime: 5 * 60 * 1000,
  })
}

/** Approved leaves + public holidays for the "who's on leave?" panel. */
export function useCalendarData(enabled: boolean) {
  return useQuery({
    retry,
    queryKey: portalKeys.calendar(),
    queryFn: async (): Promise<CalendarData> => {
      const [leaves, holidays] = await Promise.all([
        getJSON<CalendarLeave[]>('/api/leaves'),
        getJSON<Holiday[]>('/api/holidays'),
      ])
      return { leaves: leaves.filter(l => l.status === 'approved'), holidays }
    },
    enabled,
  })
}

/** Working-day count for a date range, or null while it is unknown/invalid. */
export function useWorkingDays(start: string, end: string): WorkingDaysInfo | null {
  const valid = !!start && !!end && new Date(end) >= new Date(start)
  const { data } = useQuery({
    retry,
    queryKey: portalKeys.workingDays(start, end),
    queryFn: () => getJSON<WorkingDaysInfo>(`/api/working-days?start=${start}&end=${end}`),
    enabled: valid,
    staleTime: 5 * 60 * 1000,
  })
  return valid ? data ?? null : null
}

/* -------------------------------------------------------------------------- */
/* Mutations                                                                   */
/* -------------------------------------------------------------------------- */

export interface CheckActionInput {
  action: 'check-in' | 'check-out'
  latitude: number | null
  longitude: number | null
}

export function useCheckAction(empId: EmpId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: CheckActionInput) =>
      sendJSON<CheckActionResult>('/api/attendance/check-in', 'POST', { employee_id: empId, ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.status(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.attendance(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.tardiness(empId) })
      // Checking in can cancel a same-day leave and can raise an off-site notice.
      qc.invalidateQueries({ queryKey: portalKeys.requests(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.info(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.notifications() })
    },
  })
}

export interface SubmitLeaveInput {
  leave_type_id: number
  start_date: string
  end_date: string
  days_count: number
  notes?: string
  is_half_day: boolean
}

export function useSubmitLeave(empId: EmpId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: SubmitLeaveInput) =>
      sendJSON<{ id: number }>('/api/leaves', 'POST', { employee_id: empId, status: 'pending', ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.requests(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.info(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.calendar() })
    },
  })
}

export function useCancelLeave(empId: EmpId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => sendVoid(`/api/leaves/${id}`, 'DELETE'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.requests(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.info(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.calendar() })
    },
  })
}

// No date or time: the server stamps both with Oman's clock (the phone's was stored as
// fact before, wrong zone and all).
export interface RequestPermissionInput {
  reason: string
}

export function useRequestPermission(empId: EmpId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: RequestPermissionInput) =>
      sendJSON<PermissionRecord>('/api/permissions', 'POST', { employee_id: empId, ...input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.permissions(empId) })
    },
  })
}

/** "I'm back" — the server records the return at Oman's current time. */
export function useMarkReturn(empId: EmpId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (permissionId: number) =>
      sendVoid(`/api/permissions/${permissionId}`, 'PUT', { returned: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.permissions(empId) })
    },
  })
}

export function useMarkNotificationRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => sendVoid('/api/employee-notifications', 'PUT', { id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.notifications() })
    },
  })
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => sendVoid('/api/employee-notifications', 'PUT', { all: true }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.notifications() })
    },
  })
}

export interface ChangePasswordInput {
  current_password: string
  new_password: string
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: ChangePasswordInput) =>
      sendJSON<{ success?: boolean }>('/api/employees/change-password', 'POST', input),
  })
}

export interface CorrectionInput {
  date: string
  requested_check_in?: string | null
  requested_check_out?: string | null
  reason: string
}

export function useCreateCorrection(empId: EmpId) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CorrectionInput): Promise<AttendanceCorrection> => {
      if (!empId) throw new ApiError({ error: 'no_employee' })
      // Through sendJSON (not lib/api) so the server's bilingual reason reaches the toast
      // and an expired session is handled like everywhere else in the portal.
      return sendJSON<AttendanceCorrection>('/api/corrections', 'POST', { employee_id: empId, ...input })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: portalKeys.corrections(empId) })
      qc.invalidateQueries({ queryKey: portalKeys.attendance(empId) })
    },
  })
}
