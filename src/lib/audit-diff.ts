// Describe what an edit changed, for the audit log.
//
// Both rows must come from the same SELECT/RETURNING column list, so each side is in the
// database's own format ('07:30:00', 29.5) rather than whatever the client happened to send
// ('07:30', "29.50"). Comparing a request body against a stored row would report fields as
// changed that are not.

type Row = Record<string, unknown>

export interface FieldChange {
  field: string
  from: unknown
  to: unknown
}

function same(a: unknown, b: unknown): boolean {
  const blank = (v: unknown) => v === null || v === undefined || v === ''
  if (blank(a) && blank(b)) return true
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b)
  return String(a) === String(b)
}

export function changedFields(before: Row, after: Row, fields: readonly string[]): FieldChange[] {
  return fields
    .filter(f => !same(before[f], after[f]))
    .map(f => ({ field: f, from: before[f], to: after[f] }))
}

function show(v: unknown): string {
  return v === null || v === undefined || v === '' ? '(none)' : String(v)
}

/**
 * "name A→B, work_days 0,1,2→0,1,2,3". Fields in `nameOnly` are listed without their
 * values: contact details are personal data, and the audit log is readable by every admin
 * and exported to CSV, so "phone changed" is recorded but not the numbers themselves.
 */
export function formatChanges(changes: FieldChange[], nameOnly: readonly string[] = []): string {
  return changes
    .map(c => (nameOnly.includes(c.field) ? c.field : `${c.field} ${show(c.from)}→${show(c.to)}`))
    .join(', ')
}
