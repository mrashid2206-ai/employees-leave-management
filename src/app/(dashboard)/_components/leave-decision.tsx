'use client'

import { useState } from 'react'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { DecisionDialog } from '@/components/decision-dialog'
import { decideLeave, DecisionError } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import type { LeaveRequest } from '@/lib/types'

// Everything a leave decision changes on screen: the request lists, and the balances on
// the employee list / dashboard / employee page (approval deducts, rejection refunds).
export function invalidateAfterLeaveDecision(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ['leaves'] })
  qc.invalidateQueries({ queryKey: ['employees'] })
  qc.invalidateQueries({ queryKey: ['employee'] })
  qc.invalidateQueries({ queryKey: ['employee-leaves'] })
}

interface DecisionVars {
  leave: LeaveRequest
  status: 'approved' | 'rejected'
  note?: string
  force?: boolean
}

type Target = { leave: LeaveRequest; mode: 'approve' | 'reject'; warning?: string }

/**
 * Approve / reject one leave request, shared by the Leaves page and the dashboard inbox
 * so both behave the same: approve is one click, reject asks for the reason, and an
 * approval refused by the department absence limit turns into an "approve anyway?"
 * prompt (the override createLeave already offers) instead of a bare error.
 */
export function useLeaveDecision() {
  const t = useT()
  const { lang } = useLanguage()
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<Target | null>(null)

  const mutation = useMutation({
    mutationFn: ({ leave, status, note, force }: DecisionVars) =>
      decideLeave(leave.id, status, { note: note || null, force }),
    onSuccess: (data, vars) => {
      invalidateAfterLeaveDecision(queryClient)
      setTarget(null)
      // Negative balance doesn't block approval (owner policy) — but make it visible.
      if (vars.status === 'approved' && typeof data.balance_after === 'number' && data.balance_after < 0) {
        toast.warning(lang === 'ar'
          ? `تمت الموافقة — رصيد الموظف الآن ${data.balance_after.toFixed(3)} يوم (بالسالب)`
          : `Approved — employee balance is now ${data.balance_after.toFixed(3)} days (negative)`)
      } else {
        toast.success(t('updatedSuccess'))
      }
    },
    onError: (err: Error, vars) => {
      if (err instanceof DecisionError && err.body.warning && vars.status === 'approved' && !vars.force) {
        setTarget({
          leave: vars.leave,
          mode: 'approve',
          warning: t('deptLimitReached', {
            count: Number(err.body.absentCount ?? 0),
            max: Number(err.body.maxAbsent ?? 0),
          }),
        })
        return
      }
      toast.error(err.message || t('error'))
    },
  })

  const dialog = target && (
    <DecisionDialog
      key={`${target.leave.id}-${target.mode}-${target.warning ? 'override' : ''}`}
      open
      onOpenChange={open => { if (!open) setTarget(null) }}
      mode={target.mode}
      warning={target.warning}
      confirmLabel={target.warning ? t('approveAnyway') : undefined}
      description={
        <span dir="auto">
          {target.leave.employee?.name} · <span className="font-mono" dir="ltr">{target.leave.start_date} → {target.leave.end_date}</span>
        </span>
      }
      loading={mutation.isPending}
      onConfirm={note =>
        mutation.mutate({
          leave: target.leave,
          status: target.mode === 'reject' ? 'rejected' : 'approved',
          note,
          force: !!target.warning,
        })
      }
    />
  )

  return {
    approve: (leave: LeaveRequest) => mutation.mutate({ leave, status: 'approved' }),
    reject: (leave: LeaveRequest) => setTarget({ leave, mode: 'reject' }),
    dialog,
    isPending: mutation.isPending,
  }
}
