'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, CheckCircle, LogIn, LogOut, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { QueryError } from '@/components/query-error'
import { useT } from '@/lib/language-context'
import { formatOmanDate, formatOmanTime, omanToday } from '@/lib/oman-date'
import { findMissedCheckout, previousWorkingDay } from '@/lib/portal-summary'
import {
  activePermissionOf,
  apiErrorPayload,
  useAttendanceStatus,
  useCheckAction,
  useEmpInfo,
  useMarkReturn,
  useMyAttendance,
  useMyCorrections,
  useMyPermissions,
  useRequestPermission,
  type CheckActionResult,
} from '../_hooks/use-portal'
import { useNow } from '../_hooks/use-now'
import { CorrectionDialog } from './correction-dialog'

interface AttendanceTabProps {
  empId?: number
}

type CheckAction = 'check-in' | 'check-out'

interface Coords {
  latitude: number | null
  longitude: number | null
}

function getPosition(opts: PositionOptions): Promise<GeolocationPosition> {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, opts)
  })
}

/**
 * Mobile browsers often can't return a high-accuracy fix within a few seconds
 * (indoors / first fix of the day), so we: allow a recent cached fix (maximumAge),
 * give a generous timeout, and fall back to a low-accuracy attempt. Location is
 * record-only — no fix never blocks a check-in, it is recorded as 'unverified' — but a
 * real fix is what lets the record show the employee was at the office.
 */
async function captureCoords(onDenied: () => void): Promise<Coords> {
  try {
    let pos: GeolocationPosition
    try {
      // High accuracy first; accept a fix up to 60s old, wait up to 15s.
      pos = await getPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 })
    } catch {
      // Fallback: coarse network location is faster and usually enough for a geofence.
      pos = await getPosition({ enableHighAccuracy: false, timeout: 10000, maximumAge: 120000 })
    }
    return { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
  } catch {
    // GPS denied or still unavailable — tell the employee, so they can enable it next time.
    onDenied()
    return { latitude: null, longitude: null }
  }
}

function formatHours(value: number | string | null | undefined): string {
  const h = parseFloat(String(value)) || 0
  return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`
}

// Dismissed "you didn't check out" prompts, per device. Storage can be unavailable
// (private mode); the prompt then simply comes back next visit.
const DISMISSED_KEY = 'portal-missed-checkout-dismissed'
function readDismissed(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(DISMISSED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : []
  } catch {
    return []
  }
}

export function AttendanceTab({ empId }: AttendanceTabProps) {
  const t = useT()
  const locale = t('enUs')
  const now = useNow()

  const [busy, setBusy] = useState(false)
  const [lastAction, setLastAction] = useState<CheckActionResult | null>(null)
  const [confirmAction, setConfirmAction] = useState<CheckAction | null>(null)
  const [showPermission, setShowPermission] = useState(false)
  const [permissionReason, setPermissionReason] = useState('')
  const [correctionDate, setCorrectionDate] = useState<string | null>(null)
  const [dismissed, setDismissed] = useState<string[]>(readDismissed)

  const statusQuery = useAttendanceStatus(empId)
  const permissionsQuery = useMyPermissions(empId)
  const todayStatus = statusQuery.data
  const permissions = permissionsQuery.data ?? []
  const activePermission = activePermissionOf(permissions)

  // Did the employee leave the previous working day without checking out? Check-out
  // only ever looks at TODAY's row, so a forgotten one could only be fixed by asking an
  // admin — or, now, by a correction request straight from here.
  const today = omanToday()
  const { data: empInfo } = useEmpInfo(empId)
  const workDays = empInfo?.schedule.workDays ?? []
  const prevDay = previousWorkingDay(today, workDays)
  const thisMonth = today.slice(0, 7)
  const prevMonth = prevDay.slice(0, 7)
  const { data: thisMonthRows } = useMyAttendance(empId, thisMonth)
  const { data: prevMonthRows } = useMyAttendance(empId, prevMonth, prevMonth !== thisMonth)
  const { data: corrections } = useMyCorrections(empId)
  const missed = empInfo && thisMonthRows && corrections
    ? findMissedCheckout(
        [...thisMonthRows, ...(prevMonth !== thisMonth ? prevMonthRows ?? [] : [])],
        today,
        workDays,
        corrections.map(c => c.date)
      )
    : null
  const showMissed = !!missed && !dismissed.includes(missed.date)
  const missedRecord = missed
    ? [...(thisMonthRows ?? []), ...(prevMonthRows ?? [])].find(r => r.date === missed.date) ?? null
    : null

  const checkAction = useCheckAction(empId)
  const requestPermission = useRequestPermission(empId)
  const markReturn = useMarkReturn(empId)

  const loading = busy || checkAction.isPending

  const clockTime = now ? formatOmanTime(now, locale, true) : '--:--'
  const clockDate = now ? formatOmanDate(now, locale) : ' '
  const confirmTime = now ? formatOmanTime(now, locale) : ''

  function dismissMissed(date: string) {
    const next = [...dismissed.filter(d => d >= prevDay), date]
    setDismissed(next)
    try { localStorage.setItem(DISMISSED_KEY, JSON.stringify(next)) } catch {}
  }

  /** Everything the server reports about the action, not just "done". */
  function announce(data: CheckActionResult) {
    const time = data.time.slice(0, 5)
    toast.success(data.action === 'check-in' ? `${t('checkedInAt')} ${time}` : `${t('checkedOutAt')} ${time}`)
    if (data.leaveCancelled) {
      toast.info(t('portalLeaveCancelledRefunded', { days: data.leaveRefundedDays || 1 }))
    }
    if (data.action === 'check-in' && data.isHolidayWork) {
      toast.info(t('portalHolidayWorkRecorded'))
    }
    if (data.action === 'check-out' && (data.overtime ?? 0) > 0) {
      toast.info(t('portalOvertimeRecorded', { hours: formatHours(data.overtime) }))
    }
    // Location is record-only, but tell the employee immediately when flagged off-site.
    if (data.isOffsite) {
      toast.warning(t(data.action === 'check-in' ? 'portalOffsiteCheckIn' : 'portalOffsiteCheckOut'))
    }
  }

  async function handleCheckAction(action: CheckAction) {
    if (!empId) return
    setBusy(true)
    const { latitude, longitude } = await captureCoords(() => {
      toast.error(t('portalLocationUnavailable'))
    })

    try {
      const data = await checkAction.mutateAsync({ action, latitude, longitude })
      setLastAction(data)
      announce(data)
    } catch (err) {
      const data = apiErrorPayload(err)
      if (data.error === 'already_checked_in') toast.error(`${t('alreadyCheckedIn')} (${data.time?.slice(0, 5)})`)
      else if (data.error === 'already_checked_out') toast.error(`${t('alreadyCheckedOut')} (${data.time?.slice(0, 5)})`)
      else if (data.error === 'not_checked_in') toast.error(t('notCheckedIn'))
      else if (data.error === 'on_leave') toast.error(t('portalOnLeaveBlocked', { start: data.leave_start ?? '', end: data.leave_end ?? '' }))
      else toast.error(data.message || data.error || t('error'))
    }
    setBusy(false)
  }

  async function handleMarkReturn() {
    if (!activePermission) return
    try {
      await markReturn.mutateAsync(activePermission.id)
      toast.success(t('returnLogged'))
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  async function handleRequestPermission() {
    if (!empId) return
    if (!permissionReason.trim()) {
      toast.error(t('pleaseEnterAReason'))
      return
    }
    try {
      await requestPermission.mutateAsync({ reason: permissionReason })
      toast.success(t('requestSubmittedWaitingForAdmin'))
      setShowPermission(false)
      setPermissionReason('')
    } catch (err) {
      // e.g. the monthly permission cap — the server's message is bilingual.
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  return (
    <div className="space-y-4 animate-in">
      {/* Clock — Oman time, whatever zone the phone is set to */}
      <div className="text-center py-4">
        <p className="text-4xl font-bold tabular-nums">{clockTime}</p>
        <p className="text-xs text-muted-foreground mt-1">{clockDate}</p>
      </div>

      {statusQuery.isError && <QueryError onRetry={() => statusQuery.refetch()} />}

      {/* Forgot to check out on the previous working day */}
      {showMissed && missed && (
        <Card className="border-0 shadow-md ring-1 ring-amber-500/40" data-testid="missed-checkout">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-sm">
                {missed.autoCheckout
                  ? t('portalMissedCheckoutAuto', { date: missed.date, time: missed.checkIn, auto: missed.autoCheckout })
                  : t('portalMissedCheckoutOpen', { date: missed.date, time: missed.checkIn })}
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" className="flex-1" onClick={() => setCorrectionDate(missed.date)}>
                <PencilLine className="h-3.5 w-3.5 me-1.5" />
                {t('requestCorrection')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismissMissed(missed.date)}>
                {t('portalDismiss')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Today's Status */}
      {todayStatus && (todayStatus.check_in || todayStatus.check_out) && (
        <Card className={`border-0 shadow-md ${todayStatus.is_holiday_work ? 'ring-1 ring-purple-500/30' : ''}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('todayStatus')}</p>
              {todayStatus.is_holiday_work && (
                <Badge className="bg-purple-500/10 text-purple-500 border-0 text-[10px]">
                  ⭐ {t('holidayWork2')}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="p-2 rounded-lg bg-emerald-500/10">
                <p className="text-[10px] text-muted-foreground">{t('checkIn')}</p>
                <p className="text-sm font-bold text-emerald-500 font-mono">{todayStatus.check_in?.slice(0, 5) || '--:--'}</p>
              </div>
              <div className="p-2 rounded-lg bg-amber-500/10">
                <p className="text-[10px] text-muted-foreground">{t('checkOut')}</p>
                <p className="text-sm font-bold text-amber-500 font-mono">{todayStatus.check_out?.slice(0, 5) || '--:--'}</p>
              </div>
              <div className={`p-2 rounded-lg ${todayStatus.is_holiday_work ? 'bg-purple-500/10' : 'bg-blue-500/10'}`}>
                <p className="text-[10px] text-muted-foreground">{todayStatus.is_holiday_work ? (t('ot')) : t('workHours')}</p>
                <p className={`text-sm font-bold font-mono ${todayStatus.is_holiday_work ? 'text-purple-500' : 'text-blue-500'}`}>{formatHours(todayStatus.work_hours)}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Check In / Out Buttons */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          size="lg"
          // Stable hook for e2e: the bottom nav tab carries the same visible label, so
          // selecting this button by its text is ambiguous.
          data-testid="btn-check-in"
          className="h-16 sm:h-20 text-base sm:text-lg bg-gradient-to-br from-emerald-500 to-emerald-700 hover:from-emerald-600 hover:to-emerald-800 flex-col gap-1 shadow-lg shadow-emerald-500/20"
          onClick={() => setConfirmAction('check-in')}
          disabled={loading || !!todayStatus?.check_in}
        >
          <LogIn className="h-6 w-6" />
          <span className="text-sm">{t('checkInBtn')}</span>
        </Button>
        <Button
          size="lg"
          data-testid="btn-check-out"
          className="h-16 sm:h-20 text-base sm:text-lg bg-gradient-to-br from-amber-500 to-amber-700 hover:from-amber-600 hover:to-amber-800 flex-col gap-1 shadow-lg shadow-amber-500/20"
          onClick={() => setConfirmAction('check-out')}
          disabled={loading || !todayStatus?.check_in || !!todayStatus?.check_out}
        >
          <LogOut className="h-6 w-6" />
          <span className="text-sm">{t('checkOutBtn')}</span>
        </Button>
      </div>

      {permissionsQuery.isError && <QueryError onRetry={() => permissionsQuery.refetch()} />}

      {/* Active Permission Banner */}
      {activePermission && (
        <Card className="border-0 shadow-md ring-1 ring-amber-500/30">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-amber-500">
                  {t('activePermission')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('leftAt2')} {activePermission.leave_time?.slice(0, 5)}
                  {activePermission.reason && ` — ${activePermission.reason}`}
                </p>
              </div>
              <Badge className={activePermission.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500 border-0' : 'bg-amber-500/10 text-amber-500 border-0'}>
                {activePermission.status === 'approved' ? (t('approved2')) : (t('pending3'))}
              </Badge>
            </div>
            {activePermission.status === 'approved' && !activePermission.return_time && (
              <Button
                className="w-full bg-emerald-600 hover:bg-emerald-700"
                disabled={markReturn.isPending}
                onClick={handleMarkReturn}
              >
                {t('iMBack')}
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Request Permission Button */}
      {!activePermission && todayStatus?.check_in && !todayStatus?.check_out && (
        <>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setShowPermission(!showPermission)}
          >
            {t('requestPermissionToLeave')}
          </Button>

          {showPermission && (
            <Card className="border-0 shadow-md">
              <CardContent className="p-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {t('requestPermissionToLeaveTemporarily')}
                </p>
                <Textarea
                  placeholder={t('reasonEGBankAppointment')}
                  value={permissionReason}
                  onChange={e => setPermissionReason(e.target.value)}
                  rows={2}
                />
                <Button
                  className="w-full"
                  disabled={requestPermission.isPending}
                  onClick={handleRequestPermission}
                >
                  {requestPermission.isPending ? '...' : (t('submitRequest'))}
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Last Action Feedback */}
      {lastAction && (
        <div className={`p-4 rounded-xl text-center ${lastAction.action === 'check-in' ? 'bg-emerald-500/10' : 'bg-amber-500/10'}`}>
          <CheckCircle className={`h-6 w-6 mx-auto mb-1 ${lastAction.action === 'check-in' ? 'text-emerald-500' : 'text-amber-500'}`} />
          <p className="text-sm font-semibold">
            {lastAction.action === 'check-in' ? t('checkedInAt') : t('checkedOutAt')} {lastAction.time.slice(0, 5)}
          </p>
          {lastAction.action === 'check-out' && lastAction.workHours !== undefined && (
            <p className="text-xs text-muted-foreground mt-1">
              {t('workHours')}: <span className="font-mono">{formatHours(lastAction.workHours)}</span>
              {(lastAction.overtime ?? 0) > 0 && (
                <> · {t('overtime')}: <span className="font-mono">{formatHours(lastAction.overtime)}</span></>
              )}
            </p>
          )}
        </div>
      )}

      {/* Replaces a blocking confirm() that ignored the page's language and direction. */}
      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={open => { if (!open) setConfirmAction(null) }}
        variant="warning"
        confirmVariant="default"
        title={confirmAction === 'check-out' ? t('checkOutBtn') : t('checkInBtn')}
        description={t(confirmAction === 'check-out' ? 'portalConfirmCheckOut' : 'portalConfirmCheckIn', { time: confirmTime })}
        confirmLabel={t('portalConfirmYes')}
        onConfirm={() => { if (confirmAction) void handleCheckAction(confirmAction) }}
      />

      {empId && correctionDate && (
        <CorrectionDialog
          key={correctionDate}
          empId={empId}
          record={missedRecord && missedRecord.date === correctionDate ? missedRecord : null}
          initialDate={correctionDate}
          onClose={() => setCorrectionDate(null)}
        />
      )}
    </div>
  )
}
