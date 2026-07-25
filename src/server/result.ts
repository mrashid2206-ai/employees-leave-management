import { NextResponse } from 'next/server'

// Services return this instead of NextResponse so business logic stays free of HTTP
// concerns (and is directly unit/integration testable). Routes call respond() at the edge.
export type ServiceResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; body: Record<string, unknown> }

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data }
}

export function fail(status: number, error: string, extra?: Record<string, unknown>): ServiceResult<never> {
  return { ok: false, status, body: { error, ...(extra || {}) } }
}

export function respond<T>(result: ServiceResult<T>): NextResponse {
  if (result.ok) return NextResponse.json(result.data)
  return NextResponse.json(result.body, { status: result.status })
}

// The authenticated caller, as services need it (role decides policy; id scopes ownership).
export interface Actor {
  role: string
  id?: number
  username?: string
}

export function actorLabel(actor: Actor): string {
  return actor.username || (actor.id != null ? String(actor.id) : 'unknown')
}
