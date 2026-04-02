'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { LogIn, LogOut, Clock, CheckCircle, CalendarDays, ClipboardList, User, Send, Info, FileText, AlertTriangle, Bell } from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import type { Employee, LeaveType } from '@/lib/types'

function calculateDaysCount(start: string, end: string): number {
  if (!start || !end) return 0
  const diff = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
  return diff > 0 ? diff : 0
}

function useWorkingDays(start: string, end: string) {
  const [days, setDays] = useState<{ workingDays: number; totalDays: number } | null>(null)
  useEffect(() => {
    if (!start || !end || new Date(end) < new Date(start)) { setDays(null); return }
    fetch(`/api/working-days?start=${start}&end=${end}`)
      .then(r => r.json())
      .then(setDays)
      .catch(() => setDays(null))
  }, [start, end])
  return days
}

export default function EmployeePortalPage() {
  const t = useT()
  const { lang, dir } = useLanguage()
  const router = useRouter()

  const [activeTab, setActiveTab] = useState<'attendance' | 'leave' | 'requests' | 'info' | 'records' | 'calendar'>('attendance')
  const [empUser, setEmpUser] = useState<{ id: number; name: string; username: string } | null>(null)
  const [loading, setLoading] = useState(false)

  // Attendance state
  const [todayStatus, setTodayStatus] = useState<any>(null)
  const [lastAction, setLastAction] = useState<{ action: string; time: string; workHours?: number } | null>(null)

  // Leave form state
  const [leaveTypes, setLeaveTypes] = useState<LeaveType[]>([])
  const [leaveSubmitted, setLeaveSubmitted] = useState(false)
  const [leaveForm, setLeaveForm] = useState({ leave_type_id: '', start_date: '', end_date: '', notes: '', is_half_day: false })

  // My requests
  const [myRequests, setMyRequests] = useState<any[]>([])

  // My info
  const [empInfo, setEmpInfo] = useState<any>(null)

  // My records
  const [attendanceRecords, setAttendanceRecords] = useState<any[]>([])
  const [tardinessRecords, setTardinessRecords] = useState<any[]>([])
  const [recordsSubTab, setRecordsSubTab] = useState<'attendance' | 'tardiness' | 'permissions'>('attendance')

  // Permission request
  const [permissionForm, setPermissionForm] = useState({ reason: '' })
  const [showPermission, setShowPermission] = useState(false)
  const [permitting, setPermitting] = useState(false)
  const [activePermission, setActivePermission] = useState<any>(null)
  const [myPermissions, setMyPermissions] = useState<any[]>([])

  // Notifications
  const [notifications, setNotifications] = useState<any[]>([])
  const [showNotifs, setShowNotifs] = useState(false)

  // Calendar
  const [calendarLeaves, setCalendarLeaves] = useState<any[]>([])

  // Password change
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [pwLoading, setPwLoading] = useState(false)

  useEffect(() => {
    // Try sessionStorage first (fast)
    const stored = sessionStorage.getItem('emp-user')
    if (stored) {
      setEmpUser(JSON.parse(stored))
      return
    }
    // Fallback: fetch from JWT cookie via API (works even if sessionStorage was cleared)
    fetch('/api/auth/employee-me')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.user) {
          const user = { id: data.user.id, name: data.user.name, username: data.user.username }
          setEmpUser(user)
          try { sessionStorage.setItem('emp-user', JSON.stringify(user)) } catch {}
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/leave-types').then(r => r.json()).then(setLeaveTypes)
  }, [])

  // Load attendance status
  useEffect(() => {
    if (empUser) {
      fetch(`/api/attendance/status?employee_id=${empUser.id}`)
        .then(r => r.json())
        .then(setTodayStatus)
    }
  }, [empUser])

  // Load active permission for today
  useEffect(() => {
    if (empUser) {
      fetch(`/api/permissions?employee_id=${empUser.id}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => {
          const today = new Date().toISOString().split('T')[0]
          const active = data.find((p: any) => p.date === today && !p.return_time && p.status !== 'rejected')
          setActivePermission(active || null)
        })
        .catch(() => {})
    }
  }, [empUser])

  // Load requests when tab changes
  useEffect(() => {
    if (activeTab === 'requests' && empUser) {
      fetch(`/api/leaves/my-requests?employee_id=${empUser.id}`)
        .then(r => r.json())
        .then(setMyRequests)
    }
  }, [activeTab, empUser])

  // Load employee info + settings + approved leaves
  useEffect(() => {
    if (activeTab === 'info' && empUser) {
      Promise.all([
        fetch(`/api/employees/${empUser.id}`).then(r => r.json()),
        fetch('/api/settings').then(r => r.json()),
        fetch(`/api/leaves/my-requests?employee_id=${empUser.id}`).then(r => r.json()),
      ]).then(([emp, settings, leaves]) => {
        const totalBalance = settings.annual_leave_balance ?? 30
        const usedDays = (leaves as any[])
          .filter((l: any) => l.status === 'approved')
          .reduce((sum: number, l: any) => sum + (l.days_count || 0), 0)
        setEmpInfo({ ...emp, annual_leave_balance: totalBalance, used_days: usedDays, remaining: emp.leave_balance })
      })
    }
  }, [activeTab, empUser])

  // Load records
  useEffect(() => {
    if (activeTab === 'records' && empUser) {
      fetch(`/api/attendance?employee_id=${empUser.id}`)
        .then(r => r.json())
        .then(setAttendanceRecords)
      fetch(`/api/tardiness/by-employee/${empUser.id}`)
        .then(r => r.json())
        .then(setTardinessRecords)
      fetch(`/api/permissions?employee_id=${empUser.id}`)
        .then(r => r.ok ? r.json() : [])
        .then(setMyPermissions)
        .catch(() => {})
    }
  }, [activeTab, empUser])

  // Load notifications
  useEffect(() => {
    if (empUser) {
      fetch('/api/employee-notifications')
        .then(r => r.ok ? r.json() : [])
        .then(setNotifications)
        .catch(() => {})
    }
  }, [empUser, activeTab]) // refetch when tab changes

  // Load calendar leaves
  useEffect(() => {
    if (activeTab === 'calendar') {
      fetch('/api/leaves')
        .then(r => r.ok ? r.json() : [])
        .then(data => setCalendarLeaves(data.filter((l: any) => l.status === 'approved')))
        .catch(() => {})
    }
  }, [activeTab])

  async function handleLogout() {
    await fetch('/api/auth/employee-logout', { method: 'POST' })
    sessionStorage.removeItem('emp-user')
    window.location.href = '/employee-login'
  }

  async function handleCheckAction(action: 'check-in' | 'check-out') {
    if (!empUser) return
    setLoading(true)
    try {
      const res = await fetch('/api/attendance/check-in', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: empUser.id, action }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'already_checked_in') toast.error(`${t('alreadyCheckedIn')} (${data.time})`)
        else if (data.error === 'already_checked_out') toast.error(`${t('alreadyCheckedOut')} (${data.time})`)
        else if (data.error === 'not_checked_in') toast.error(t('notCheckedIn'))
        else toast.error(t('error'))
      } else {
        setLastAction({ action: data.action, time: data.time, workHours: data.workHours })
        const statusRes = await fetch(`/api/attendance/status?employee_id=${empUser.id}`)
        setTodayStatus(await statusRes.json())
        toast.success(action === 'check-in' ? `${t('checkedInAt')} ${data.time}` : `${t('checkedOutAt')} ${data.time}`)
      }
    } catch { toast.error(t('error')) }
    setLoading(false)
  }

  async function handleLeaveSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empUser || !leaveForm.leave_type_id || !leaveForm.start_date || !leaveForm.end_date) {
      toast.error(t('fillRequired'))
      return
    }
    const days = calculateDaysCount(leaveForm.start_date, leaveForm.end_date)
    if (days <= 0) { toast.error(t('endDateAfterStart')); return }

    setLoading(true)
    try {
      const res = await fetch('/api/leaves', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: empUser.id,
          leave_type_id: parseInt(leaveForm.leave_type_id),
          start_date: leaveForm.start_date,
          end_date: leaveForm.end_date,
          days_count: leaveForm.is_half_day && leaveForm.start_date === leaveForm.end_date ? 0.5 : days,
          notes: leaveForm.notes || undefined,
          status: 'pending',
          is_half_day: leaveForm.is_half_day,
        }),
      })
      if (!res.ok) throw new Error()
      setLeaveSubmitted(true)
      setLeaveForm({ leave_type_id: '', start_date: '', end_date: '', notes: '', is_half_day: false })
    } catch { toast.error(t('error')) }
    setLoading(false)
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'approved': return <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[11px]">{t('approved')}</Badge>
      case 'rejected': return <Badge className="bg-rose-500/10 text-rose-500 border-0 text-[11px]">{t('rejected')}</Badge>
      case 'cancelled': return <Badge className="bg-gray-500/10 text-gray-500 border-0 text-[11px]">{t('cancelled')}</Badge>
      default: return <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[11px]">{t('pending')}</Badge>
    }
  }

  const currentTime = new Date().toLocaleTimeString(lang === 'ar' ? 'ar-OM' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  const currentDate = new Date().toLocaleDateString(lang === 'ar' ? 'ar-OM' : 'en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const leaveDays = calculateDaysCount(leaveForm.start_date, leaveForm.end_date)
  const workingDaysInfo = useWorkingDays(leaveForm.start_date, leaveForm.end_date)

  return (
    <div className="min-h-screen bg-background flex flex-col" dir={dir}>
      {/* Top Header */}
      <div className="bg-card border-b px-4 py-3 flex items-center justify-between sticky top-0 z-40">
        <div className="flex items-center gap-3">
          {empUser && (
            <>
              <div className="w-9 h-9 rounded-full bg-[#1976D2]/15 flex items-center justify-center text-[#1976D2] font-bold text-sm">
                {empUser.name.charAt(0)}
              </div>
              <div>
                <p className="font-semibold text-sm">{empUser.name}</p>
                <p className="text-[11px] text-muted-foreground">@{empUser.username}</p>
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Button variant="ghost" size="icon" className="h-8 w-8 relative" onClick={() => setShowNotifs(!showNotifs)}>
              <Bell className="h-4 w-4" />
              {notifications.filter(n => !n.is_read).length > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full text-[9px] text-white flex items-center justify-center">
                  {notifications.filter(n => !n.is_read).length}
                </span>
              )}
            </Button>
            {showNotifs && (
              <div className="absolute top-10 end-0 w-72 bg-card border rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto">
                <div className="p-3 border-b">
                  <p className="text-sm font-semibold">{lang === 'ar' ? 'الإشعارات' : 'Notifications'}</p>
                </div>
                {notifications.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground text-center">{lang === 'ar' ? 'لا توجد إشعارات' : 'No notifications'}</p>
                ) : (
                  notifications.map(n => (
                    <div
                      key={n.id}
                      className={`p-3 border-b text-sm cursor-pointer hover:bg-accent/50 ${!n.is_read ? 'bg-blue-500/5' : ''}`}
                      onClick={() => {
                        if (!n.is_read) {
                          fetch('/api/employee-notifications', {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id: n.id }),
                          })
                          setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
                        }
                      }}
                    >
                      <p className="text-xs">{lang === 'ar' ? n.message_ar : n.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
          <ThemeToggle />
          <LanguageToggle />
          <Button variant="ghost" size="sm" className="text-rose-500 text-xs" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5 ml-1" />
            {t('logout')}
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-4 pb-24 max-w-lg mx-auto w-full">

        {/* Attendance Tab */}
        {activeTab === 'attendance' && (
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
                        ⭐ {lang === 'ar' ? 'عمل في يوم عطلة' : 'Holiday Work'}
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
                      <p className="text-[10px] text-muted-foreground">{todayStatus.is_holiday_work ? (lang === 'ar' ? 'إضافي' : 'OT') : t('workHours')}</p>
                      <p className={`text-sm font-bold font-mono ${todayStatus.is_holiday_work ? 'text-purple-500' : 'text-blue-500'}`}>{todayStatus.work_hours || 0}h</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Check In / Out Buttons */}
            <div className="grid grid-cols-2 gap-3">
              <Button
                size="lg"
                className="h-20 text-lg bg-emerald-600 hover:bg-emerald-700 flex-col gap-1"
                onClick={() => handleCheckAction('check-in')}
                disabled={loading || !!todayStatus?.check_in}
              >
                <LogIn className="h-6 w-6" />
                <span className="text-sm">{t('checkInBtn')}</span>
              </Button>
              <Button
                size="lg"
                className="h-20 text-lg bg-amber-600 hover:bg-amber-700 flex-col gap-1"
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
                        {lang === 'ar' ? '🎫 إذن خروج نشط' : '🎫 Active Permission'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {lang === 'ar' ? 'غادرت الساعة' : 'Left at'} {activePermission.leave_time?.slice(0, 5)}
                        {activePermission.reason && ` — ${activePermission.reason}`}
                      </p>
                    </div>
                    <Badge className={activePermission.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500 border-0' : 'bg-amber-500/10 text-amber-500 border-0'}>
                      {activePermission.status === 'approved' ? (lang === 'ar' ? 'موافق' : 'Approved') : (lang === 'ar' ? 'معلق' : 'Pending')}
                    </Badge>
                  </div>
                  {activePermission.status === 'approved' && !activePermission.return_time && (
                    <Button
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      onClick={async () => {
                        const now = new Date()
                        const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
                        try {
                          await fetch(`/api/permissions/${activePermission.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ return_time: time }),
                          })
                          toast.success(lang === 'ar' ? 'تم تسجيل العودة' : 'Return logged')
                          setActivePermission(null)
                        } catch { toast.error(t('error')) }
                      }}
                    >
                      {lang === 'ar' ? '✅ أنا عدت' : '✅ I\'m Back'}
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
                  {lang === 'ar' ? '🎫 طلب إذن خروج مؤقت' : '🎫 Request Permission to Leave'}
                </Button>

                {showPermission && (
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-4 space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {lang === 'ar' ? 'طلب إذن للخروج مؤقتاً والعودة لاحقاً' : 'Request permission to leave temporarily and return later'}
                      </p>
                      <Textarea
                        placeholder={lang === 'ar' ? 'سبب الخروج (مثل: موعد بنك، مراجعة مستشفى)' : 'Reason (e.g., bank appointment, hospital visit)'}
                        value={permissionForm.reason}
                        onChange={e => setPermissionForm({ reason: e.target.value })}
                        rows={2}
                      />
                      <Button
                        className="w-full"
                        disabled={permitting}
                        onClick={async () => {
                          if (!empUser) return
                          if (!permissionForm.reason.trim()) {
                            toast.error(lang === 'ar' ? 'يرجى إدخال السبب' : 'Please enter a reason')
                            return
                          }
                          setPermitting(true)
                          try {
                            const now = new Date()
                            const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
                            const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                            const res = await fetch('/api/permissions', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ employee_id: empUser.id, date, leave_time: time, reason: permissionForm.reason }),
                            })
                            if (res.ok) {
                              const data = await res.json()
                              setActivePermission(data)
                              toast.success(lang === 'ar' ? 'تم تقديم الطلب — انتظر موافقة المدير' : 'Request submitted — waiting for admin approval')
                              setShowPermission(false)
                              setPermissionForm({ reason: '' })
                            } else { toast.error(t('error')) }
                          } catch { toast.error(t('error')) }
                          setPermitting(false)
                        }}
                      >
                        {permitting ? '...' : (lang === 'ar' ? 'تقديم الطلب' : 'Submit Request')}
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
        )}

        {/* Leave Request Tab */}
        {activeTab === 'leave' && (
          <div className="space-y-4 animate-in">
            {leaveSubmitted ? (
              <Card className="border-0 shadow-md text-center">
                <CardContent className="p-8">
                  <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
                  <h2 className="text-xl font-bold mb-1">{t('requestSubmitted')}</h2>
                  <p className="text-sm text-muted-foreground mb-4">{t('requestReview')}</p>
                  <div className="flex gap-2 justify-center">
                    <Button size="sm" onClick={() => setLeaveSubmitted(false)}>{t('newRequest')}</Button>
                    <Button size="sm" variant="outline" onClick={() => { setLeaveSubmitted(false); setActiveTab('requests') }}>{t('checkMyRequests')}</Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-0 shadow-md">
                <CardContent className="p-5">
                  <h2 className="font-bold text-lg mb-4">{t('applyLeave')}</h2>
                  <form onSubmit={handleLeaveSubmit} className="space-y-4">
                    <div>
                      <Label className="text-xs">{t('leaveType')} *</Label>
                      <Select value={leaveForm.leave_type_id} onValueChange={v => setLeaveForm(f => ({ ...f, leave_type_id: v ?? '' }))}>
                        <SelectTrigger><SelectValue placeholder={t('selectType')} /></SelectTrigger>
                        <SelectContent>
                          {leaveTypes.map(lt => (
                            <SelectItem key={lt.id} value={String(lt.id)}>
                              <div className="flex items-center gap-2">
                                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lt.color }} />
                                {lang === 'ar' ? lt.name_ar : lt.name_en}
                              </div>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">{t('fromDate')} *</Label>
                        <Input type="date" value={leaveForm.start_date} onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))} />
                      </div>
                      <div>
                        <Label className="text-xs">{t('toDate')} *</Label>
                        <Input type="date" value={leaveForm.end_date} onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))} />
                      </div>
                    </div>
                    {leaveForm.start_date && leaveForm.end_date && leaveForm.start_date === leaveForm.end_date && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="half-day-emp"
                          checked={leaveForm.is_half_day || false}
                          onCheckedChange={(checked) => setLeaveForm(f => ({ ...f, is_half_day: !!checked }))}
                        />
                        <Label htmlFor="half-day-emp" className="text-sm">
                          {lang === 'ar' ? 'نصف يوم' : 'Half Day'}
                        </Label>
                      </div>
                    )}
                    {leaveDays > 0 && (
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 text-[#1976D2]" />
                        <span className="text-sm font-medium">
                          {leaveForm.is_half_day && leaveForm.start_date === leaveForm.end_date ? 0.5 : (workingDaysInfo ? workingDaysInfo.workingDays : leaveDays)} {t('days')}
                          {workingDaysInfo && workingDaysInfo.workingDays < leaveDays && (
                            <span className="text-xs text-muted-foreground ml-1">
                              ({lang === 'ar' ? 'أيام عمل فقط' : 'working days only'})
                            </span>
                          )}
                        </span>
                      </div>
                    )}
                    <div>
                      <Label className="text-xs">{t('notes')}</Label>
                      <Textarea
                        value={leaveForm.notes}
                        onChange={e => setLeaveForm(f => ({ ...f, notes: e.target.value }))}
                        placeholder={t('addNotes')}
                        rows={2}
                      />
                    </div>
                    <Button type="submit" className="w-full" disabled={loading}>
                      <Send className="h-4 w-4 ml-2" />
                      {loading ? '...' : t('submitRequest')}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* My Info Tab */}
        {activeTab === 'info' && (
          <div className="space-y-4 animate-in">
            {empInfo ? (
              <>
                {/* Leave Balance Card */}
                <Card className="border-0 shadow-md">
                  <CardContent className="p-5">
                    <h2 className="font-bold text-lg mb-4">{t('leaveBalance')}</h2>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-3 rounded-xl bg-blue-500/10">
                        <p className="text-[10px] text-muted-foreground mb-1">{t('totalBalance')}</p>
                        <p className="text-2xl font-bold text-blue-500">{empInfo.annual_leave_balance}</p>
                        <p className="text-[10px] text-muted-foreground">{t('days')}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-amber-500/10">
                        <p className="text-[10px] text-muted-foreground mb-1">{t('leaveUsed')}</p>
                        <p className="text-2xl font-bold text-amber-500">{empInfo.used_days}</p>
                        <p className="text-[10px] text-muted-foreground">{t('days')}</p>
                      </div>
                      <div className="p-3 rounded-xl bg-emerald-500/10">
                        <p className="text-[10px] text-muted-foreground mb-1">{t('leaveBalanceRemaining')}</p>
                        <p className="text-2xl font-bold text-emerald-500">{empInfo.remaining}</p>
                        <p className="text-[10px] text-muted-foreground">{t('days')}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Personal Info Card */}
                <Card className="border-0 shadow-md">
                  <CardContent className="p-5">
                    <h2 className="font-bold text-lg mb-4">{t('personalInfo')}</h2>
                    <div className="space-y-3">
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-sm text-muted-foreground">{t('name')}</span>
                        <span className="text-sm font-medium">{empInfo.name}</span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b">
                        <span className="text-sm text-muted-foreground">{t('username')}</span>
                        <span className="text-sm font-medium font-mono">@{empInfo.username}</span>
                      </div>
                      <div className="flex justify-between items-center py-2">
                        <span className="text-sm text-muted-foreground">{t('department')}</span>
                        <span className="text-sm font-medium">{empInfo.department_name || empInfo.department?.name || '-'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Change Password Card */}
                <Card className="border-0 shadow-md">
                  <CardContent className="p-5">
                    <h2 className="font-bold text-lg mb-4">{lang === 'ar' ? 'تغيير كلمة المرور' : 'Change Password'}</h2>
                    <div className="space-y-3">
                      <Input
                        type="password"
                        placeholder={lang === 'ar' ? 'كلمة المرور الحالية' : 'Current password'}
                        value={pwForm.current_password}
                        onChange={e => setPwForm(f => ({ ...f, current_password: e.target.value }))}
                      />
                      <Input
                        type="password"
                        placeholder={lang === 'ar' ? 'كلمة المرور الجديدة' : 'New password'}
                        value={pwForm.new_password}
                        onChange={e => setPwForm(f => ({ ...f, new_password: e.target.value }))}
                      />
                      <Input
                        type="password"
                        placeholder={lang === 'ar' ? 'تأكيد كلمة المرور' : 'Confirm password'}
                        value={pwForm.confirm_password}
                        onChange={e => setPwForm(f => ({ ...f, confirm_password: e.target.value }))}
                      />
                      <Button
                        className="w-full"
                        disabled={pwLoading}
                        onClick={async () => {
                          if (!pwForm.current_password || !pwForm.new_password) {
                            toast.error(t('fillRequired')); return
                          }
                          if (pwForm.new_password !== pwForm.confirm_password) {
                            toast.error(lang === 'ar' ? 'كلمة المرور غير متطابقة' : 'Passwords do not match'); return
                          }
                          if (pwForm.new_password.length < 6) {
                            toast.error(lang === 'ar' ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' : 'Password must be at least 6 characters'); return
                          }
                          setPwLoading(true)
                          try {
                            const res = await fetch('/api/employees/change-password', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ current_password: pwForm.current_password, new_password: pwForm.new_password }),
                            })
                            if (!res.ok) {
                              const data = await res.json()
                              toast.error(data.error || t('error'))
                            } else {
                              toast.success(lang === 'ar' ? 'تم تغيير كلمة المرور بنجاح' : 'Password changed successfully')
                              setPwForm({ current_password: '', new_password: '', confirm_password: '' })
                            }
                          } catch { toast.error(t('error')) }
                          setPwLoading(false)
                        }}
                      >
                        {pwLoading ? '...' : (lang === 'ar' ? 'تغيير كلمة المرور' : 'Change Password')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="text-center py-8 text-muted-foreground text-sm">{t('loading')}</div>
            )}
          </div>
        )}

        {/* My Records Tab */}
        {activeTab === 'records' && (
          <div className="space-y-4 animate-in">
            {/* Sub-tab toggle */}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={recordsSubTab === 'attendance' ? 'default' : 'outline'}
                onClick={() => setRecordsSubTab('attendance')}
                className="flex-1"
              >
                <Clock className="h-3.5 w-3.5 mr-1.5" />
                {t('attendanceHistory')}
              </Button>
              <Button
                size="sm"
                variant={recordsSubTab === 'tardiness' ? 'default' : 'outline'}
                onClick={() => setRecordsSubTab('tardiness')}
                className="flex-1"
              >
                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                {t('tardinessHistory')}
              </Button>
              <Button
                size="sm"
                variant={recordsSubTab === 'permissions' ? 'default' : 'outline'}
                onClick={() => setRecordsSubTab('permissions')}
                className="flex-1"
              >
                {lang === 'ar' ? 'الأذونات' : 'Permissions'}
              </Button>
            </div>

            {/* Attendance Records */}
            {recordsSubTab === 'attendance' && (
              <div className="space-y-3">
                <h2 className="font-bold text-lg">{t('attendanceHistory')} ({attendanceRecords.length})</h2>
                {attendanceRecords.length === 0 ? (
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-8 text-center text-muted-foreground text-sm">
                      <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      {t('noAttendance')}
                    </CardContent>
                  </Card>
                ) : (
                  attendanceRecords.slice(0, 30).map(rec => (
                    <Card key={rec.id} className="border-0 shadow-md">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold font-mono">{rec.date}</span>
                          {rec.is_holiday_work && (
                            <Badge className="bg-purple-500/10 text-purple-500 border-0 text-[10px]">
                              {lang === 'ar' ? 'عمل في عطلة' : 'Holiday'}
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="p-1.5 rounded bg-emerald-500/10">
                            <p className="text-[10px] text-muted-foreground">{t('checkIn')}</p>
                            <p className="text-xs font-bold text-emerald-500 font-mono">{rec.check_in?.slice(0, 5) || '--:--'}</p>
                          </div>
                          <div className="p-1.5 rounded bg-amber-500/10">
                            <p className="text-[10px] text-muted-foreground">{t('checkOut')}</p>
                            <p className="text-xs font-bold text-amber-500 font-mono">{rec.check_out?.slice(0, 5) || '--:--'}</p>
                          </div>
                          <div className="p-1.5 rounded bg-blue-500/10">
                            <p className="text-[10px] text-muted-foreground">{t('workHours')}</p>
                            <p className="text-xs font-bold text-blue-500 font-mono">{rec.work_hours || 0}h</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* Tardiness Records */}
            {recordsSubTab === 'tardiness' && (
              <div className="space-y-3">
                <h2 className="font-bold text-lg">{t('tardinessHistory')} ({tardinessRecords.length})</h2>
                {tardinessRecords.length === 0 ? (
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-8 text-center text-muted-foreground text-sm">
                      <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      {t('noTardiness')}
                    </CardContent>
                  </Card>
                ) : (
                  tardinessRecords.slice(0, 30).map(rec => (
                    <Card key={rec.id} className="border-0 shadow-md">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold font-mono">{rec.date}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {t('arrivalTime')}: <span className="font-mono">{rec.time?.slice(0, 5)}</span>
                            </p>
                          </div>
                          <div className="text-right">
                            <Badge className="bg-rose-500/10 text-rose-500 border-0">
                              {rec.minutes_late} {t('minutes')} {t('late')}
                            </Badge>
                          </div>
                        </div>
                        {rec.notes && (
                          <p className="text-xs text-muted-foreground mt-2 bg-accent/30 p-2 rounded">{rec.notes}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}

            {/* Permissions Records */}
            {recordsSubTab === 'permissions' && (
              <div className="space-y-3">
                <h2 className="font-bold text-lg">{lang === 'ar' ? 'أذونات الخروج' : 'My Permissions'} ({myPermissions.length})</h2>
                {myPermissions.length === 0 ? (
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-8 text-center text-muted-foreground text-sm">
                      {lang === 'ar' ? 'لا توجد أذونات' : 'No permissions'}
                    </CardContent>
                  </Card>
                ) : (
                  myPermissions.map((p: any) => (
                    <Card key={p.id} className="border-0 shadow-md">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold font-mono">{p.date}</span>
                          <Badge className={
                            p.status === 'approved' ? 'bg-emerald-500/10 text-emerald-500 border-0' :
                            p.status === 'rejected' ? 'bg-rose-500/10 text-rose-500 border-0' :
                            'bg-amber-500/10 text-amber-500 border-0'
                          }>
                            {p.status === 'approved' ? t('approved') : p.status === 'rejected' ? t('rejected') : t('pending')}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="p-1.5 rounded bg-amber-500/10">
                            <p className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'خروج' : 'Left'}</p>
                            <p className="text-xs font-bold text-amber-500 font-mono">{p.leave_time?.slice(0, 5)}</p>
                          </div>
                          <div className="p-1.5 rounded bg-emerald-500/10">
                            <p className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'عودة' : 'Return'}</p>
                            <p className="text-xs font-bold text-emerald-500 font-mono">{p.return_time?.slice(0, 5) || '--:--'}</p>
                          </div>
                          <div className="p-1.5 rounded bg-blue-500/10">
                            <p className="text-[10px] text-muted-foreground">{lang === 'ar' ? 'المدة' : 'Duration'}</p>
                            <p className="text-xs font-bold text-blue-500 font-mono">
                              {p.return_time ? (() => {
                                const [lh, lm] = p.leave_time.split(':').map(Number)
                                const [rh, rm] = p.return_time.split(':').map(Number)
                                const mins = (rh * 60 + rm) - (lh * 60 + lm)
                                return mins > 0 ? `${Math.floor(mins/60)}h ${mins%60}m` : '-'
                              })() : '-'}
                            </p>
                          </div>
                        </div>
                        {p.reason && (
                          <p className="text-xs text-muted-foreground mt-2 bg-accent/30 p-2 rounded">{p.reason}</p>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {/* Calendar Tab */}
        {activeTab === 'calendar' && (
          <div className="space-y-4 animate-in">
            <h2 className="font-bold text-lg">{lang === 'ar' ? 'من في إجازة؟' : "Who's on Leave?"}</h2>
            {(() => {
              const now = new Date()
              const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
              const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`
              const thisMonthLeaves = calendarLeaves.filter(l => l.end_date >= monthStart && l.start_date <= monthEnd)

              if (thisMonthLeaves.length === 0) {
                return (
                  <Card className="border-0 shadow-md">
                    <CardContent className="p-8 text-center text-muted-foreground text-sm">
                      <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      {lang === 'ar' ? 'لا توجد إجازات هذا الشهر' : 'No leaves this month'}
                    </CardContent>
                  </Card>
                )
              }

              return thisMonthLeaves.map(l => (
                <Card key={l.id} className="border-0 shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold">{l.employee?.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {lang === 'ar' ? l.leave_type?.name_ar : l.leave_type?.name_en}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-mono">{l.start_date} → {l.end_date}</p>
                        <Badge variant="outline" className="text-[10px] mt-1">{l.days_count} {t('days')}</Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            })()}
          </div>
        )}

        {/* My Requests Tab */}
        {activeTab === 'requests' && (
          <div className="space-y-3 animate-in">
            <h2 className="font-bold text-lg">{t('myRequests')} ({myRequests.length})</h2>
            {myRequests.length === 0 ? (
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
                        <span className="font-mono">{req.start_date}</span>
                        <span>→</span>
                        <span className="font-mono">{req.end_date}</span>
                        <Badge variant="outline" className="text-[10px] h-5">{req.days_count} {t('days')}</Badge>
                      </div>
                      {req.notes && (
                        <p className="text-xs text-muted-foreground mt-2 bg-accent/30 p-2 rounded">{req.notes}</p>
                      )}
                      {req.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-500 hover:bg-rose-500/10 text-xs h-6 mt-2"
                          onClick={async () => {
                            try {
                              const res = await fetch(`/api/leaves/${req.id}`, { method: 'DELETE' })
                              if (res.ok) {
                                toast.success(lang === 'ar' ? 'تم إلغاء الطلب' : 'Request cancelled')
                                setMyRequests(prev => prev.filter(r => r.id !== req.id))
                              } else { toast.error(t('error')) }
                            } catch { toast.error(t('error')) }
                          }}
                        >
                          {lang === 'ar' ? 'إلغاء الطلب' : 'Cancel Request'}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                )
              })
            )}
          </div>
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-0 inset-x-0 bg-card border-t z-50">
        <div className="max-w-lg mx-auto flex overflow-x-auto">
          {[
            { id: 'attendance' as const, icon: Clock, label: t('checkInBtn') },
            { id: 'leave' as const, icon: CalendarDays, label: t('applyLeave') },
            { id: 'requests' as const, icon: ClipboardList, label: t('myRequests') },
            { id: 'calendar' as const, icon: CalendarDays, label: lang === 'ar' ? 'التقويم' : 'Calendar' },
            { id: 'info' as const, icon: Info, label: t('myInfo') },
            { id: 'records' as const, icon: FileText, label: t('myRecords') },
          ].map(tab => {
            const Icon = tab.icon
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${
                  isActive ? 'text-[#1976D2]' : 'text-muted-foreground'
                }`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon className={`h-5 w-5 ${isActive ? 'text-[#1976D2]' : ''}`} />
                <span className="text-[10px] font-medium">{tab.label}</span>
                {isActive && <div className="w-6 h-0.5 rounded-full bg-[#1976D2]" />}
              </button>
            )
          })}
        </div>
      </div>

      <Toaster position="top-center" dir={dir} />
    </div>
  )
}
