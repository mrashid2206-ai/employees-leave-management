'use client'

import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Check, X, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { decideCorrection, getCorrections, type ReviewedCorrection } from '@/lib/api'
import { exportToExcel } from '@/lib/excel'
import { omanToday } from '@/lib/oman-date'
import { useLanguage, useT } from '@/lib/language-context'
import { qk } from '@/lib/query-keys'
import { QueryError } from '@/components/query-error'
import { DecisionDialog } from '@/components/decision-dialog'
import { DecisionTrace } from '@/components/decision-trace'

// Admin queue for employee-submitted attendance corrections. Approving applies the
// requested times to the attendance record (hours/overtime recomputed server-side);
// rejecting asks for the reason, which the employee is shown.
export default function CorrectionsPage() {
  const t = useT()
  const { dir } = useLanguage()
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [rejectTarget, setRejectTarget] = useState<ReviewedCorrection | null>(null)

  const { data = [], isError, refetch } = useQuery({ queryKey: qk.corrections(), queryFn: () => getCorrections() })
  // The list carries the decision fields as well (see ReviewedCorrection).
  const corrections = data as ReviewedCorrection[]

  const reviewMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: number; status: 'approved' | 'rejected'; note?: string }) =>
      decideCorrection(id, status, note || null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.corrections() })
      // The root: the attendance page, the monthly/overtime/off-site reports and the
      // dashboard each cache attendance under it, and all of them change.
      queryClient.invalidateQueries({ queryKey: qk.attendance() })
      setRejectTarget(null)
      toast.success(t('updatedSuccess'))
    },
    onError: (err: Error) => {
      queryClient.invalidateQueries({ queryKey: qk.corrections() })
      toast.error(err.message || t('error'))
    },
  })

  const pending = corrections.filter(c => c.status === 'pending')
  const filtered = useMemo(
    () => (statusFilter === 'all' ? corrections : corrections.filter(c => c.status === statusFilter)),
    [corrections, statusFilter]
  )

  const statusLabel = (status: string) =>
    status === 'approved' ? t('approved') : status === 'rejected' ? t('rejected') : t('pending')

  function statusBadge(status: string) {
    if (status === 'approved') return <Badge className="bg-emerald-500/10 text-emerald-500 border-0">{t('approved')}</Badge>
    if (status === 'rejected') return <Badge className="bg-rose-500/10 text-rose-500 border-0">{t('rejected')}</Badge>
    return <Badge className="bg-amber-500/10 text-amber-500 border-0">{t('pending')}</Badge>
  }

  // The list as filtered on screen.
  function handleExport() {
    const data = filtered.map(c => ({
      [t('name')]: c.employee?.name || '',
      [t('date')]: c.date,
      [t('checkIn')]: c.requested_check_in?.slice(0, 5) || '',
      [t('checkOut')]: c.requested_check_out?.slice(0, 5) || '',
      [t('reason')]: c.reason || '',
      [t('status')]: statusLabel(c.status),
      [t('reviewedBy')]: c.reviewed_by || '',
    }))
    exportToExcel(data, `corrections-${omanToday()}`, t('corrections'))
  }

  return (
    <div className="space-y-6" dir={dir}>
      {isError && <QueryError onRetry={() => refetch()} />}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">{t('corrections')}</h1>
          {pending.length > 0 && (
            <Badge className="bg-amber-500 text-white border-0">
              {pending.length} {t('pending')}
            </Badge>
          )}
        </div>
        <div className="flex gap-3 flex-wrap">
          <Button variant="outline" onClick={handleExport} disabled={filtered.length === 0}>
            <FileSpreadsheet className="h-4 w-4 me-2" />
            {t('exportExcel')}
          </Button>
          <Select value={statusFilter} onValueChange={v => setStatusFilter(v ?? 'all')}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('allStatus')}</SelectItem>
              <SelectItem value="pending">{t('pending')}</SelectItem>
              <SelectItem value="approved">{t('approved')}</SelectItem>
              <SelectItem value="rejected">{t('rejected')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('date')}</TableHead>
                  <TableHead className="text-center">{t('checkIn')}</TableHead>
                  <TableHead className="text-center">{t('checkOut')}</TableHead>
                  <TableHead className="text-start">{t('reason')}</TableHead>
                  <TableHead className="text-center">{t('status')}</TableHead>
                  <TableHead className="text-center w-32">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                  </TableRow>
                ) : filtered.map(c => (
                  <TableRow key={c.id} className={c.status === 'pending' ? '' : 'opacity-60'}>
                    <TableCell className="font-medium">{c.employee?.name}</TableCell>
                    <TableCell className="text-center font-mono">{c.date}</TableCell>
                    <TableCell className="text-center font-mono">{c.requested_check_in?.slice(0, 5) || '-'}</TableCell>
                    <TableCell className="text-center font-mono">{c.requested_check_out?.slice(0, 5) || '-'}</TableCell>
                    <TableCell className="max-w-xs truncate">{c.reason}</TableCell>
                    <TableCell className="text-center">
                      {statusBadge(c.status)}
                      <DecisionTrace {...c} />
                    </TableCell>
                    <TableCell className="text-center">
                      {c.status === 'pending' ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            className="h-7 bg-emerald-600 hover:bg-emerald-700"
                            aria-label={t('approve')}
                            disabled={reviewMutation.isPending}
                            onClick={() => reviewMutation.mutate({ id: c.id, status: 'approved' })}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-rose-500 hover:bg-rose-500/10"
                            aria-label={t('reject')}
                            disabled={reviewMutation.isPending}
                            onClick={() => setRejectTarget(c)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {rejectTarget && (
        <DecisionDialog
          key={rejectTarget.id}
          open
          onOpenChange={open => { if (!open) setRejectTarget(null) }}
          mode="reject"
          description={
            <span dir="auto">
              {rejectTarget.employee?.name} · <span className="font-mono" dir="ltr">{rejectTarget.date}</span>
            </span>
          }
          loading={reviewMutation.isPending}
          onConfirm={note => reviewMutation.mutate({ id: rejectTarget.id, status: 'rejected', note })}
        />
      )}
    </div>
  )
}
