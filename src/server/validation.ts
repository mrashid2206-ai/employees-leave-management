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
