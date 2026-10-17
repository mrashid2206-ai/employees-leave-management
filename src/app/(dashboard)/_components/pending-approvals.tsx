'use client'

import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, X, Inbox } from 'lucide-react'
import { getLeaveRequests } from '@/lib/api'
import { qk } from '@/lib/query-keys'
import { useLanguage, useT } from '@/lib/language-context'
import { useLeaveDecision } from './leave-decision'

// Dashboard inbox: approve waiting leave requests in one click (reject asks for the
// reason), without navigating to the Leaves page and filtering.
export function PendingApprovals() {
  const t = useT()
  const { lang } = useLanguage()

  const { data: leaves = [] } = useQuery({ queryKey: qk.leaves(), queryFn: getLeaveRequests })
  const pending = leaves.filter(l => l.status === 'pending')
  const decision = useLeaveDecision()

  if (pending.length === 0) return decision.dialog || null

  return (
    <Card className="border-0 shadow-lg ring-1 ring-amber-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Inbox className="h-4 w-4 text-amber-500" />
          {t('requestsAwaitingApproval')}
          <Badge className="bg-amber-500 text-white border-0">{pending.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.slice(0, 5).map(req => (
          <div key={req.id} className="flex items-center justify-between gap-3 rounded-lg bg-accent/20 p-3">
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{req.employee?.name}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {req.start_date} → {req.end_date} · {req.days_count} {t('days')}
                {req.leave_type && ` · ${lang === 'ar' ? req.leave_type.name_ar : req.leave_type.name_en}`}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                className="h-7 bg-emerald-600 hover:bg-emerald-700"
                disabled={decision.isPending}
                onClick={() => decision.approve(req)}
              >
                <Check className="h-3.5 w-3.5 me-1" />
                {t('approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-rose-500 hover:bg-rose-500/10"
                disabled={decision.isPending}
                aria-label={t('reject')}
                onClick={() => decision.reject(req)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {pending.length > 5 && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            +{pending.length - 5} {t('more')}
          </p>
        )}
      </CardContent>
      {decision.dialog}
    </Card>
  )
}
