'use client'

import { omanToday } from '@/lib/oman-date'
import { useT } from '@/lib/language-context'
import type { DecisionFields } from '@/lib/types'

/** The day a decision was made, in Oman (a late-evening decision is not "tomorrow"). */
export function decisionDate(reviewedAt?: string | null): string {
  if (!reviewedAt) return ''
  const d = new Date(reviewedAt)
  return Number.isNaN(d.getTime()) ? '' : omanToday(d)
}

// Under a request's status in the admin lists: who decided it, on what day, and the note
// they left. Renders nothing for a request nobody has decided yet.
export function DecisionTrace({ reviewed_by, reviewed_at, decision_note, status }: DecisionFields & { status: string }) {
  const t = useT()
  if (!reviewed_by && !decision_note) return null
  const date = decisionDate(reviewed_at)
  return (
    <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-muted-foreground" data-testid="decision-trace">
      {reviewed_by && (
        <p>{date ? t('reviewedByOn', { name: reviewed_by, date }) : `${t('reviewedBy')}: ${reviewed_by}`}</p>
      )}
      {decision_note && (
        <p className="line-clamp-2 max-w-[16rem] mx-auto break-words" title={decision_note}>
          <span className="font-medium">{status === 'rejected' ? t('decisionReasonLabel') : t('decisionNoteLabel')}:</span>{' '}
          {decision_note}
        </p>
      )}
    </div>
  )
}
