'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, X, Inbox } from 'lucide-react'
import { toast } from 'sonner'
import { getLeaveRequests, updateLeaveStatus } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'

// Dashboard inbox: approve/reject waiting leave requests in one click, without
// navigating to the Leaves page and filtering.
export function PendingApprovals() {
  const t = useT()
  const { lang } = useLanguage()
  const queryClient = useQueryClient()

  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const pending = leaves.filter(l => l.status === 'pending')

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => updateLeaveStatus(id, status),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['leaves'] })
      queryClient.invalidateQueries({ queryKey: ['employees'] })
      if (typeof data.balance_after === 'number' && data.balance_after < 0) {
        toast.warning(lang === 'ar'
          ? `تمت الموافقة — رصيد الموظف الآن ${data.balance_after.toFixed(3)} يوم (بالسالب)`
          : `Approved — employee balance is now ${data.balance_after.toFixed(3)} days (negative)`)
      } else {
        toast.success(t('updatedSuccess'))
      }
    },
    onError: () => toast.error(t('error')),
  })

  if (pending.length === 0) return null

  return (
    <Card className="border-0 shadow-lg ring-1 ring-amber-500/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Inbox className="h-4 w-4 text-amber-500" />
          {lang === 'ar' ? 'طلبات بانتظار الموافقة' : 'Requests awaiting approval'}
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
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ id: req.id, status: 'approved' })}
              >
                <Check className="h-3.5 w-3.5 mr-1" />
                {t('approve')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-rose-500 hover:bg-rose-500/10"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ id: req.id, status: 'rejected' })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
        {pending.length > 5 && (
          <p className="text-xs text-muted-foreground text-center pt-1">
            +{pending.length - 5} {lang === 'ar' ? 'طلبات أخرى' : 'more'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
