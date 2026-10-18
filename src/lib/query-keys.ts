// Single source of truth for react-query keys. Use these instead of inline literals so a
// query and its invalidation can never silently drift apart.
//
// Keys are hierarchical: every view of a table starts with that table's root, so
// invalidating the root (qk.attendance(), qk.leaves(), ...) refreshes every view of it.
// react-query matches invalidations by prefix. The reports used to cache attendance under
// 'attendance-monthly', 'attendance-ot' and 'attendance-offsite', and the dashboard under
// 'today-attendance', so an attendance edit or an approved correction refreshed none of
// them; the employee card's 'employee-leaves' was likewise missed by every leave mutation.
//
// The bare roots are also the "everything" lists themselves: ['leaves'] is every leave
// request and ['employees'] the roster. The leaves page still writes those two as
// literals, so they must stay exactly this.

/** An inclusive date range, as a leave year ({ start, end }) already is. */
export interface DateSpan {
  start: string
  end: string
}

export const qk = {
  employees: () => ['employees'] as const,
  employee: (id: number | string) => ['employees', 'detail', Number(id)] as const,

  leaves: () => ['leaves'] as const,
  leavesInSpan: (span: DateSpan) => ['leaves', 'span', span.start, span.end] as const,
  leavesByEmployee: (id: number | string) => ['leaves', 'by-employee', Number(id)] as const,

  tardiness: () => ['tardiness'] as const,
  tardinessInSpan: (span: DateSpan) => ['tardiness', 'span', span.start, span.end] as const,
  tardinessByEmployee: (id: number | string) => ['tardiness', 'by-employee', Number(id)] as const,

  attendance: () => ['attendance'] as const,
  attendanceMonth: (month: string) => ['attendance', 'month', month] as const,
  attendanceDay: (date: string) => ['attendance', 'day', date] as const,

  permissions: () => ['permissions'] as const,
  permissionsInSpan: (span: DateSpan) => ['permissions', 'span', span.start, span.end] as const,
  corrections: () => ['corrections'] as const,

  settings: () => ['settings'] as const,
  departments: () => ['departments'] as const,
  leaveTypes: () => ['leaveTypes'] as const,
  holidays: () => ['holidays'] as const,
  audit: () => ['audit'] as const,
  auditPage: (filters: string, page: number) => ['audit', filters, page] as const,
  employeeActivity: (id: number | string) => ['audit', 'employee', Number(id)] as const,
  adminUsers: () => ['admin-users'] as const,
  automationRuns: () => ['automation-runs'] as const,
  automationHealth: () => ['automation-runs', 'health'] as const,
  errorLog: () => ['error-log'] as const,
}
