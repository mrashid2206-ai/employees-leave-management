'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { CheckCircle, LogIn, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import {
  activePermissionOf,
  apiErrorPayload,
  useAttendanceStatus,
  useCheckAction,
  useMarkReturn,
  useMyPermissions,
  useRequestPermission,
} from '../_hooks/use-portal'

interface AttendanceTabProps {
  empId?: number
}

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
 * give a generous timeout, and fall back to a low-accuracy attempt. This matters
 * because the server treats "no coordinates" as off-site and can block check-in —
 * so a slow GPS must not look like being away from the office.
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
    // GPS denied or still unavailable — warn so the employee knows to enable location,
    // rather than getting an opaque "you're off-site" block.
    onDenied()
    return { latitude: null, longitude: null }
  }
}

function twoDigits(n: number): string {
  return String(n).padStart(2, '0')
}

function formatHours(value: number | string | null | undefined): string {
  const h = parseFloat(String(value)) || 0
  return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`
}

export function AttendanceTab({ empId }: AttendanceTabProps) {
  const t = useT()
  const { lang } = useLanguage()

  const [busy, setBusy] = useState(false)
  const [lastAction, setLastAction] = useState<{ action: string; time: string; workHours?: number } | null>(null)
  const [showPermission, setShowPermission] = useState(false)
  const [permissionReason, setPermissionReason] = useState('')

  const { data: todayStatus } = useAttendanceStatus(empId)
  const { data: permissions = [] } = useMyPermissions(empId)
  const activePermission = activePermissionOf(permissions)

  const checkAction = useCheckAction(empId)
  const requestPermission = useRequestPermission(empId)
  const markReturn = useMarkReturn(empId)

  const loading = busy || checkAction.isPending

  const currentTime = new Date().toLocaleTimeString(t('enUs'), { hour: '2-digit', minute: '2-digit', hour12: true })
  const currentDate = new Date().toLocaleDateString(t('enUs'), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  async function handleCheckAction(action: 'check-in' | 'check-out') {
    if (!empId) return
    const now = new Date()
    const timeStr = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}`
    const confirmMsg = action === 'check-in'
      ? (lang === 'ar' ? `تسجيل حضورك الآن ${timeStr}؟` : `Check in now at ${timeStr}?`)
      : (lang === 'ar' ? `تسجيل انصرافك الآن ${timeStr}؟` : `Check out now at ${timeStr}?`)
    if (!confirm(confirmMsg)) return

    setBusy(true)
    const { latitude, longitude } = await captureCoords(() => {
      toast.error(lang === 'ar'
        ? 'تعذّر تحديد موقعك. فعّل خدمة الموقع (GPS) واسمح للموقع بالوصول ثم حاول مرة أخرى.'
        : 'Could not get your location. Enable GPS/location access for this site and try again.')
    })

    try {
      const data = await checkAction.mutateAsync({ action, latitude, longitude })
      setLastAction({ action: data.action, time: data.time, workHours: data.workHours })
      toast.success(action === 'check-in' ? `${t('checkedInAt')} ${data.time}` : `${t('checkedOutAt')} ${data.time}`)
      // Location is record-only, but tell the employee immediately when flagged off-site.
      if (data.isOffsite) {
        toast.warning(lang === 'ar'
          ? (action === 'check-in' ? '⚠️ تم تسجيل حضورك خارج موقع المكتب' : '⚠️ تم تسجيل انصرافك خارج موقع المكتب')
          : (action === 'check-in' ? '⚠️ You checked in outside the office location' : '⚠️ You checked out outside the office location'))
      }
    } catch (err) {
      const data = apiErrorPayload(err)
      if (data.error === 'already_checked_in') toast.error(`${t('alreadyCheckedIn')} (${data.time})`)
      else if (data.error === 'already_checked_out') toast.error(`${t('alreadyCheckedOut')} (${data.time})`)
      else if (data.error === 'not_checked_in') toast.error(t('notCheckedIn'))
      else if (data.error === 'on_leave') toast.error(lang === 'ar' ? `لديك إجازة معتمدة (${data.leave_start} إلى ${data.leave_end}). تواصل مع المدير لتعديل الإجازة.` : data.message)
      else if (data.error === 'offsite_blocked') toast.error(lang === 'ar' ? 'تسجيل الحضور متاح فقط من موقع المكتب. تأكد من تفعيل GPS.' : data.message)
      else toast.error(data.message || t('error'))
    }
    setBusy(false)
  }

  async function handleMarkReturn() {
    if (!activePermission) return
    const now = new Date()
    const time = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}:00`
    try {
      await markReturn.mutateAsync({ id: activePermission.id, return_time: time })
      toast.success(t('returnLogged'))
    } catch { toast.error(t('error')) }
  }

  async function handleRequestPermission() {
    if (!empId) return
    if (!permissionReason.trim()) {
      toast.error(t('pleaseEnterAReason'))
      return
    }
    const now = new Date()
    const time = `${twoDigits(now.getHours())}:${twoDigits(now.getMinutes())}:00`
    const date = `${now.getFullYear()}-${twoDigits(now.getMonth() + 1)}-${twoDigits(now.getDate())}`
    try {
      await requestPermission.mutateAsync({ date, leave_time: time, reason: permissionReason })
      toast.success(t('requestSubmittedWaitingForAdmin'))
      setShowPermission(false)
      setPermissionReason('')
    } catch { toast.error(t('error')) }
  }

  return (
    <div className="space-y-4 animate-in">
      {/* Clock */}
      <div className="text-center py-4">
        <p className="text-4xl font-bold tabular-nums">{currentTime}</p>
        <p className="text-xs text-muted-foreground mt-1">{currentDate}</p>
      </div>

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
          onClick={() => handleCheckAction('check-in')}
          disabled={loading || !!todayStatus?.check_in}
        >
          <LogIn className="h-6 w-6" />
          <span className="text-sm">{t('checkInBtn')}</span>
        </Button>
        <Button
          size="lg"
          data-testid="btn-check-out"
          className="h-16 sm:h-20 text-base sm:text-lg bg-gradient-to-br from-amber-500 to-amber-700 hover:from-amber-600 hover:to-amber-800 flex-col gap-1 shadow-lg shadow-amber-500/20"
          onClick={() => handleCheckAction('check-out')}
          disabled={loading || !todayStatus?.check_in || !!todayStatus?.check_out}
        >
          <LogOut className="h-6 w-6" />
          <span className="text-sm">{t('checkOutBtn')}</span>
        </Button>
      </div>

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
            {lastAction.action === 'check-in' ? t('checkedInAt') : t('checkedOutAt')} {lastAction.time}
          </p>
        </div>
      )}
    </div>
  )
}
