import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'

type ParseOk<T> = { ok: true; data: T }
type ParseErr = { ok: false; response: NextResponse }

// Validate a request body against a zod schema at the route boundary. On failure
// returns a ready-to-return 400 with a readable field message; on success returns the
// typed, parsed data. Schemas are intentionally permissive (passthrough) so adding
// validation never rejects a previously-accepted request shape — it only catches
// genuinely missing/invalid required fields with a clear error instead of a 500.
export function parseBody<T>(schema: ZodType<T>, body: unknown): ParseOk<T> | ParseErr {
  const result = schema.safeParse(body)
  if (!result.success) {
    const msg = result.error.issues
      .map(i => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ')
    return { ok: false, response: NextResponse.json({ error: msg || 'Invalid request body' }, { status: 400 }) }
  }
  return { ok: true, data: result.data }
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * A real calendar date written YYYY-MM-DD. The shape alone isn't enough: Postgres refuses
 * '2026-02-30' too, but as a 500 from deep inside the query rather than a 400 here.
 */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false
  const [y, m, d] = value.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

function badParam(message: string): ParseErr {
  return { ok: false, response: NextResponse.json({ error: message }, { status: 400 }) }
}

/** An optional single-date query param (`?date=`). Absent → null; malformed → a 400. */
export function parseDateParam(searchParams: URLSearchParams, name: string): ParseOk<string | null> | ParseErr {
  const value = searchParams.get(name)
  if (value === null || value === '') return { ok: true, data: null }
  return isIsoDate(value) ? { ok: true, data: value } : badParam(`${name}: must be a YYYY-MM-DD date`)
}

export interface DateRange {
  from: string | null
  to: string | null
}

/**
 * The optional `from`/`to` (inclusive) of a list endpoint. Either may be left out; a
 * reversed range is refused rather than silently answering "nothing".
 */
export function parseDateRange(searchParams: URLSearchParams): ParseOk<DateRange> | ParseErr {
  const from = parseDateParam(searchParams, 'from')
  if (!from.ok) return from
  const to = parseDateParam(searchParams, 'to')
  if (!to.ok) return to
  if (from.data && to.data && from.data > to.data) return badParam('from: must not be after to')
  return { ok: true, data: { from: from.data, to: to.data } }
}

/**
 * SQL conditions restricting `column` to a parsed range, binding values onto `params`.
 * Returns zero, one or two conditions for the caller to AND with its own.
 */
export function rangeConditions(column: string, range: DateRange, params: unknown[]): string[] {
  const conditions: string[] = []
  if (range.from) {
    params.push(range.from)
    conditions.push(`${column} >= $${params.length}`)
  }
  if (range.to) {
    params.push(range.to)
    conditions.push(`${column} <= $${params.length}`)
  }
  return conditions
}
