'use client'

import { MessageSquareText } from 'lucide-react'
import { useT } from '@/lib/language-context'

// The admin's word on a decided request, as the employee sees it: the reason for a
// rejection (always present — the server requires one), or a remark left on an approval.
export function DecisionNote({ status, note }: { status: string; note?: string | null }) {
  const t = useT()
  if (!note || (status !== 'approved' && status !== 'rejected')) return null
  const rejected = status === 'rejected'
  return (
    <div
      data-testid="decision-note"
      className={`mt-2 flex items-start gap-1.5 rounded p-2 text-xs ${
        rejected ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
      }`}
    >
      <MessageSquareText className="h-3.5 w-3.5 shrink-0 mt-px" aria-hidden />
      <p className="min-w-0 break-words" dir="auto">
        <span className="font-semibold">{rejected ? t('rejectionReason') : t('decisionNoteLabel')}:</span> {note}
      </p>
    </div>
  )
}
