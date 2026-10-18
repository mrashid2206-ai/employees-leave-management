'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar, CalendarDays, ClipboardList, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { QueryError } from '@/components/query-error'
import { useLanguage, useT } from '@/lib/language-context'
import { monthEnd, omanMonth, omanYesterday } from '@/lib/oman-date'
import { apiErrorPayload, useCalendarData, useCancelLeave, useMyCorrections, useMyPermissions, useMyRequests } from '../_hooks/use-portal'
import { CorrectionDialog } from './correction-dialog'
import { RequestAttachments } from './request-attachments'
import { DecisionNote } from './decision-note'

// The full permission history lives under Profile → records; here, next to the other
// requests, the latest few are enough to see what was decided and why.
const RECENT_PERMISSIONS = 5

interface RequestsTabProps {
  empId?: number
}

export function RequestsTab({ empId }: RequestsTabProps) {
  const t = useT()
  const { lang } = useLanguage()

  const [showCalendar, setShowCalendar] = useState(false)
  const [cancelId, setCancelId] = useState<number | null>(null)
  const [newCorrection, setNewCorrection] = useState(false)

  const requestsQuery = useMyRequests(empId)
  const correctionsQuery = useMyCorrections(empId)
  const permissionsQuery = useMyPermissions(empId)
  const myRequests = requestsQuery.data ?? []
  const corrections = correctionsQuery.data ?? []
  const recentPermissions = (permissionsQuery.data ?? []).slice(0, RECENT_PERMISSIONS)
  const calendarQuery = useCalendarData(showCalendar)
  const cancelLeave = useCancelLeave(empId)

  const calendarLeaves = calendarQuery.data?.leaves ?? []
  const calendarHolidays = calendarQuery.data?.holidays ?? []

  function getStatusBadge(status: string) {
    switch (status) {
      case 'approved': return <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[11px]">{t('approved')}</Badge>
      case 'rejected': return <Badge className="bg-rose-500/10 text-rose-500 border-0 text-[11px]">{t('rejected')}</Badge>
      case 'cancelled': return <Badge className="bg-gray-500/10 text-gray-500 border-0 text-[11px]">{t('cancelled')}</Badge>
      default: return <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[11px]">{t('pending')}</Badge>
    }
  }

  async function handleCancel(id: number) {
    try {
      await cancelLeave.mutateAsync(id)
      toast.success(t('requestCancelled'))
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  // "This month" is Oman's month — the device's local month differs for a day either
  // side of a month boundary when the phone is set to another zone.
  const month = omanMonth()
  const monthStart = `${month}-01`
  const monthLast = monthEnd(month)
  const monthHolidays = calendarHolidays.filter(h => h.date.slice(0, 7) === month)
  const thisMonthLeaves = calendarLeaves.filter(l => l.end_date >= monthStart && l.start_date <= monthLast)
  const cancelTarget = myRequests.find(r => r.id === cancelId)

  return (
    <div className="space-y-3 animate-in">
      {/* Calendar toggle */}
      <Button variant="outline" size="sm" className="w-full" onClick={() => setShowCalendar(!showCalendar)}>
        <Calendar className="h-3.5 w-3.5 me-1.5" />
        {t('whoSOnLeave')}
      </Button>

      {showCalendar && (
        <div className="space-y-3">
          {calendarQuery.isError && <QueryError onRetry={() => calendarQuery.refetch()} />}
          {/* Holidays this month */}
          {monthHolidays.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-purple-500 mt-2">{t('holidays')}</h3>
              {monthHolidays.map(h => (
                <Card key={h.id} className="border-0 shadow-md border-s-4 border-s-purple-500">
                  <CardContent className="p-3 flex items-center justify-between">
                    <span className="text-sm font-medium">{h.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{h.date}</span>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
          {calendarQuery.isSuccess && thisMonthLeaves.length === 0 ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-30" />
                {t('noLeavesThisMonth')}
              </CardContent>
            </Card>
          ) : (
            thisMonthLeaves.map(l => (
              <Card key={l.id} className="border-0 shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">{l.employee?.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {lang === 'ar' ? l.leave_type?.name_ar : l.leave_type?.name_en}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="text-xs font-mono" dir="ltr">{l.start_date} → {l.end_date}</p>
                      <Badge variant="outline" className="text-[10px] mt-1">{l.days_count} {t('days')}</Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* My Requests List */}
      <h2 className="font-bold text-lg">{t('myRequests')} ({myRequests.length})</h2>
      {requestsQuery.isError ? (
        <QueryError onRetry={() => requestsQuery.refetch()} />
      ) : requestsQuery.isPending ? (
        <div className="text-center py-6 text-muted-foreground text-sm">{t('loading')}</div>
      ) : myRequests.length === 0 ? (
        <Card className="border-0 shadow-md">
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            <ClipboardList className="h-10 w-10 mx-auto mb-2 opacity-30" />
            {t('noRequests')}
          </CardContent>
        </Card>
      ) : (
        myRequests.map(req => {
          const lt = req.leave_type
          return (
            <Card key={req.id} className="border-0 shadow-md">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: lt?.color }} />
                    <span className="text-sm font-semibold">{lang === 'ar' ? lt?.name_ar : lt?.name_en}</span>
                  </div>
                  {getStatusBadge(req.status)}
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="font-mono" dir="ltr">{req.start_date} → {req.end_date}</span>
                  <Badge variant="outline" className="text-[10px] h-5">{req.days_count} {t('days')}</Badge>
                </div>
                {req.notes && (
                  <p className="text-xs text-muted-foreground mt-2 bg-accent/30 p-2 rounded">{req.notes}</p>
                )}
                <RequestAttachments
                  empId={empId}
                  leaveId={req.id}
                  count={req.attachment_count ?? 0}
                  editable={req.status === 'pending'}
                />
                <DecisionNote status={req.status} note={req.decision_note} />
                {req.status === 'pending' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-rose-500 hover:bg-rose-500/10 text-xs h-6 mt-2"
                    disabled={cancelLeave.isPending}
                    onClick={() => setCancelId(req.id)}
                  >
                    {t('cancelRequest')}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })
      )}

      {/* Attendance corrections. These were sent and then never shown again — the
          employee had no way to see whether one was still pending, approved or refused. */}
      <div className="flex items-center justify-between gap-2 pt-2">
        <h2 className="font-bold text-lg">{t('portalMyCorrections')} ({corrections.length})</h2>
        {!!empId && (
          <Button size="sm" variant="outline" onClick={() => setNewCorrection(true)} data-testid="btn-new-correction">
            <PencilLine className="h-3.5 w-3.5 me-1.5" />
            {t('requestCorrection')}
          </Button>
        )}
      </div>
      {correctionsQuery.isError ? (
        <QueryError onRetry={() => correctionsQuery.refetch()} />
      ) : correctionsQuery.isPending ? (
        <div className="text-center py-6 text-muted-foreground text-sm">{t('loading')}</div>
      ) : corrections.length === 0 ? (
        <Card className="border-0 shadow-md">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            {t('portalNoCorrections')}
          </CardContent>
        </Card>
      ) : (
        corrections.map(c => (
          <Card key={c.id} className="border-0 shadow-md" data-testid="correction-row">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold font-mono">{c.date}</span>
                {getStatusBadge(c.status)}
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="p-1.5 rounded bg-emerald-500/10">
                  <p className="text-[10px] text-muted-foreground">{t('correctedCheckIn')}</p>
                  <p className="text-xs font-bold text-emerald-500 font-mono">{c.requested_check_in?.slice(0, 5) || '--:--'}</p>
                </div>
                <div className="p-1.5 rounded bg-amber-500/10">
                  <p className="text-[10px] text-muted-foreground">{t('correctedCheckOut')}</p>
                  <p className="text-xs font-bold text-amber-500 font-mono">{c.requested_check_out?.slice(0, 5) || '--:--'}</p>
                </div>
              </div>
              {c.reason && (
                <p className="text-xs text-muted-foreground mt-2 bg-accent/30 p-2 rounded">{c.reason}</p>
              )}
              <DecisionNote status={c.status} note={c.decision_note} />
            </CardContent>
          </Card>
        ))
      )}

      {/* Permissions (leaving the office mid-day). A refused one used to show only a red
          badge, with no way to learn why. */}
      <h2 className="font-bold text-lg pt-2">{t('myPermissions')} ({permissionsQuery.data?.length ?? 0})</h2>
      {permissionsQuery.isError ? (
        <QueryError onRetry={() => permissionsQuery.refetch()} />
      ) : permissionsQuery.isPending ? (
        <div className="text-center py-6 text-muted-foreground text-sm">{t('loading')}</div>
      ) : recentPermissions.length === 0 ? (
        <Card className="border-0 shadow-md">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            {t('noPermissions')}
          </CardContent>
        </Card>
      ) : (
        recentPermissions.map(p => (
          <Card key={p.id} className="border-0 shadow-md" data-testid="permission-row">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold font-mono" dir="ltr">
                  {p.date} · {p.leave_time?.slice(0, 5)}{p.return_time ? ` → ${p.return_time.slice(0, 5)}` : ''}
                </span>
                {getStatusBadge(p.status)}
              </div>
              {p.reason && (
                <p className="text-xs text-muted-foreground mt-2 bg-accent/30 p-2 rounded">{p.reason}</p>
              )}
              <DecisionNote status={p.status} note={p.decision_note} />
            </CardContent>
          </Card>
        ))
      )}

      <ConfirmDialog
        open={cancelId !== null}
        onOpenChange={open => { if (!open) setCancelId(null) }}
        variant="warning"
        title={t('cancelRequest')}
        description={cancelTarget
          ? t('portalConfirmCancelLeave', { start: cancelTarget.start_date, end: cancelTarget.end_date })
          : ''}
        confirmLabel={t('cancelRequest')}
        loading={cancelLeave.isPending}
        onConfirm={() => { if (cancelId !== null) void handleCancel(cancelId) }}
      />

      {empId && newCorrection && (
        <CorrectionDialog
          empId={empId}
          initialDate={omanYesterday()}
          onClose={() => setNewCorrection(false)}
        />
      )}
    </div>
  )
}
