import { notifyEmployee } from '@/lib/employee-notify'
import { pushToEmployee } from '@/lib/push'
import { logger } from '@/lib/log'
import { decisionMessage, type Decision, type DecisionKind, type DecisionSubject } from '@/lib/decision-message'
import { fail, type ServiceResult } from '@/server/result'

// Shared by the three things an admin approves or rejects (leave requests, permissions,
// attendance corrections), so they agree on what a decision must carry and on how the
// employee hears about it.

export const DECISION_NOTE_MAX = 500

/** Trimmed note, or null when there is nothing in it. */
export function normalizeNote(note: string | null | undefined): string | null {
  const n = typeof note === 'string' ? note.trim() : ''
  return n ? n : null
}

/**
 * A rejection must say why: the employee is told the reason, and "rejected" alone leaves
 * them guessing (and asking the admin in person, which is what the field replaces).
 * Returns the failure to hand back, or null when the note is acceptable.
 */
export function checkDecisionNote(status: string, note: string | null): ServiceResult<never> | null {
  if (status === 'rejected' && !note) {
    return fail(400, 'A reason is required to reject a request / يجب ذكر سبب الرفض')
  }
  if (note && note.length > DECISION_NOTE_MAX) {
    return fail(400, `The note is too long (maximum ${DECISION_NOTE_MAX} characters) / الملاحظة طويلة جدًا (الحد الأقصى ${DECISION_NOTE_MAX} حرف)`)
  }
  return null
}

/**
 * Tell the employee about a decision: an entry in the portal bell, and a web push to
 * their devices. Never throws — the decision has already been committed, and failing to
 * deliver news of it must not turn into an error for the admin.
 *
 * The push is not awaited. web-push sets no timeout of its own, so a slow push service
 * would otherwise hold the admin's request open (once per item in a bulk approval). It is
 * a no-op when VAPID keys aren't configured.
 */
export async function notifyDecision(
  employeeId: number,
  kind: DecisionKind,
  decision: Decision,
  subject: DecisionSubject,
  note: string | null,
  ref: number | string
): Promise<void> {
  const msg = decisionMessage(kind, decision, subject, note)
  await notifyEmployee(employeeId, msg.en, msg.ar)
  void pushToEmployee(employeeId, {
    title: msg.title,
    body: `${msg.en} / ${msg.ar}`,
    url: '/check-in',
    // One per request: a re-decision replaces the earlier notification on the device
    // rather than stacking a second one beside it.
    tag: `decision-${kind}-${ref}`,
  }).catch(e => logger.warn('decision push failed', { employeeId, error: e instanceof Error ? e.message : String(e) }))
}
