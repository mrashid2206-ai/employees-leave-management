'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { History, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { ConfirmDialog } from '@/components/confirm-dialog'

// History of what the nightly automation actually changed, with a one-click undo.
//
// This exists because of a real incident: a run processed an in-progress day and marked
// every employee absent, deducting a leave day each. The fix was a hand-written UPDATE
// against production. Since the automation mutates balances unattended, the recovery path
// deserves to be a button rather than improvised SQL.

interface AutomationRun {
  id: number
  kind: string
  target_date: string | null
  actor: string | null
  summary: Record<string, number | string>
  created_at: string
  reversed_at: string | null
  reversed_by: string | null
  effect_count: number
}

export function AutomationRuns() {
  const t = useT()
  const { lang } = useLanguage()
  const queryClient = useQueryClient()
  const [confirmId, setConfirmId] = useState<number | null>(null)

  const { data: runs = [], isLoading } = useQuery<AutomationRun[]>({
    queryKey: ['automation-runs'],
    queryFn: () => fetch('/api/automation/runs').then(r => (r.ok ? r.json() : [])),
  })

  const undo = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/automation/runs/${id}/reverse`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'Undo failed')
      return body as { reversed: Record<string, number> }
    },
    onSuccess: (body) => {
      // Every table the undo touched is now stale.
      for (const key of ['automation-runs', 'employees', 'attendance', 'tardiness', 'leaves', 'settings']) {
        queryClient.invalidateQueries({ queryKey: [key] })
      }
      const changed = Object.entries(body.reversed || {})
      toast.success(
        changed.length === 0
          ? (lang === 'ar' ? 'لا توجد تغييرات للتراجع عنها' : 'Nothing left to undo')
          : changed.map(([k, v]) => `${v} ${k}`).join(', ')
      )
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const describe = (run: AutomationRun) => {
    const s = run.summary || {}
    if (run.kind === 'yearly') {
      return t('runSummaryYearly', { count: s.employeesReset ?? 0, year: String(s.newYearStart ?? '') })
    }
    return t('runSummaryDaily', {
      absent: s.absentMarked ?? 0,
      tardiness: s.tardinessCreated ?? 0,
      checkouts: s.missingCheckout ?? 0,
    })
  }

  return (
    <Card className="border-0 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5 text-[#1976D2]" />
          {t('automationHistory')}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t('automationHistoryHint')}</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t('loading')}</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noData')}</p>
        ) : (
          runs.map(run => (
            <div key={run.id} className="p-3 rounded-xl bg-accent/20 flex items-center justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="text-[10px]">
                    {run.kind === 'yearly' ? t('yearlyReset') : t('dailyProcess')}
                  </Badge>
                  <span className="text-sm font-medium">{run.target_date || '—'}</span>
                  {run.reversed_at && (
                    <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[10px]">
                      {t('undone')}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{describe(run)}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {new Date(run.created_at).toLocaleString(t('enUs'), { dateStyle: 'short', timeStyle: 'short' })}
                  {' · '}@{run.actor}
                  {' · '}{run.effect_count} {t('changes')}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={!!run.reversed_at || run.effect_count === 0 || undo.isPending}
                onClick={() => setConfirmId(run.id)}
              >
                <Undo2 className="h-3.5 w-3.5 me-1.5" />
                {t('undo')}
              </Button>
            </div>
          ))
        )}
      </CardContent>

      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(open: boolean) => !open && setConfirmId(null)}
        title={t('undoRunTitle')}
        description={t('undoRunWarning')}
        onConfirm={() => {
          if (confirmId !== null) undo.mutate(confirmId)
          setConfirmId(null)
        }}
      />
    </Card>
  )
}
