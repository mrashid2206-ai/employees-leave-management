// Single source of truth for react-query keys. Use these instead of inline string
// literals so a query and its invalidation can never silently drift apart.
export const qk = {
  employees: () => ['employees'] as const,
  employee: (id: number | string) => ['employee', id] as const,
  leaves: () => ['leaves'] as const,
  leavesByEmployee: (id: number | string) => ['leaves', 'by-employee', id] as const,
  tardiness: () => ['tardiness'] as const,
  tardinessByEmployee: (id: number | string) => ['tardiness', 'by-employee', id] as const,
  attendance: (month?: string) => (month ? (['attendance', month] as const) : (['attendance'] as const)),
  settings: () => ['settings'] as const,
  departments: () => ['departments'] as const,
  leaveTypes: () => ['leaveTypes'] as const,
  holidays: () => ['holidays'] as const,
  permissions: () => ['permissions'] as const,
  audit: () => ['audit'] as const,
  adminUsers: () => ['adminUsers'] as const,
}
