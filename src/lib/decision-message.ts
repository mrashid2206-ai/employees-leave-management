// What an employee is told when an admin decides one of their requests: the same words
// go to the portal bell and to the push notification, in both languages (most employees
// read Arabic; the app shows both wherever the language can't be chosen per viewer).
//
// Pure, so the wording — and above all that a rejection carries its reason — is unit
// tested without a database.

export type DecisionKind = 'leave' | 'permission' | 'correction'
export type Decision = 'approved' | 'rejected'

export interface DecisionSubject {
  /** Leave: first and last day. */
  start?: string
  end?: string
  /** Permission / correction: the day it concerns. */
  date?: string
  /** Permission: the time the employee left, HH:MM. */
  time?: string
}

export interface DecisionMessage {
  /** Push title. */
  title: string
  /** Bell entry, English. */
  en: string
  /** Bell entry, Arabic. */
  ar: string
}

const TITLES: Record<DecisionKind, Record<Decision, string>> = {
  leave: {
    approved: 'Leave approved / تمت الموافقة على الإجازة',
    rejected: 'Leave rejected / تم رفض الإجازة',
  },
  permission: {
    approved: 'Permission approved / تمت الموافقة على الاستئذان',
    rejected: 'Permission rejected / تم رفض الاستئذان',
  },
  correction: {
    approved: 'Correction approved / تمت الموافقة على التصحيح',
    rejected: 'Correction rejected / تم رفض التصحيح',
  },
}

function sentences(kind: DecisionKind, decision: Decision, s: DecisionSubject): { en: string; ar: string } {
  const approved = decision === 'approved'
  switch (kind) {
    case 'leave':
      return {
        en: `Your leave request (${s.start} to ${s.end}) was ${decision}.`,
        ar: approved
          ? `تمت الموافقة على طلب إجازتك (${s.start} إلى ${s.end}).`
          : `تم رفض طلب إجازتك (${s.start} إلى ${s.end}).`,
      }
    case 'permission': {
      const at = s.time ? ` at ${s.time}` : ''
      const atAr = s.time ? ` الساعة ${s.time}` : ''
      return {
        en: `Your permission request on ${s.date}${at} was ${decision}.`,
        ar: approved
          ? `تمت الموافقة على طلب الاستئذان بتاريخ ${s.date}${atAr}.`
          : `تم رفض طلب الاستئذان بتاريخ ${s.date}${atAr}.`,
      }
    }
    case 'correction':
      return {
        en: `Your attendance correction request for ${s.date} was ${decision}.`,
        ar: approved
          ? `تمت الموافقة على طلب تصحيح الحضور بتاريخ ${s.date}.`
          : `تم رفض طلب تصحيح الحضور بتاريخ ${s.date}.`,
      }
  }
}

export function decisionMessage(
  kind: DecisionKind,
  decision: Decision,
  subject: DecisionSubject,
  note?: string | null
): DecisionMessage {
  const base = sentences(kind, decision, subject)
  const n = note?.trim()
  // A rejection's note is the reason, and the reason is the point of telling them; an
  // approval's note is just a remark ("take the afternoon too").
  const en = n ? `${base.en} ${decision === 'rejected' ? 'Reason' : 'Note'}: ${n}` : base.en
  const ar = n ? `${base.ar} ${decision === 'rejected' ? 'السبب' : 'ملاحظة'}: ${n}` : base.ar
  return { title: TITLES[kind][decision], en, ar }
}
