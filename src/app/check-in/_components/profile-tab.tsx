'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { PushSetup } from '@/components/push-setup'
import { QueryError } from '@/components/query-error'
import { useT } from '@/lib/language-context'
import { addMonths, formatMonthLabel, omanMonth } from '@/lib/oman-date'
import { formatWorkDays } from '@/lib/schedule-core'
import { summariseMonth } from '@/lib/portal-summary'
import {
  apiErrorPayload,
  useChangePassword,
  useEmpInfo,
  useMyAttendance,
  useMyPermissions,
  useMyRequests,
  useMyTardiness,
  type AttendanceRecord,
} from '../_hooks/use-portal'
import { CorrectionDialog } from './correction-dialog'
import { DecisionNote } from './decision-note'

interface ProfileTabProps {
  empId?: number
}

type RecordsSubTab = 'attendance' | 'tardiness' | 'permissions'

function formatHours(value: number | string | null | undefined): string {
  const h = parseFloat(String(value)) || 0
  return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`
}

/* -------------------------------------------------------------------------- */
/* Profile tab                                                                 */
/* -------------------------------------------------------------------------- */

export function ProfileTab({ empId }: ProfileTabProps) {
  const t = useT()
  const locale = t('enUs')

  const [recordsSubTab, setRecordsSubTab] = useState<RecordsSubTab>('attendance')
  const [correctionRecord, setCorrectionRecord] = useState<AttendanceRecord | null>(null)
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' })
  // History is browsed a month at a time. It used to be the newest 30 rows of everything,
  // so anything older than about six weeks simply could not be seen.
  const currentMonth = omanMonth()
  const [month, setMonth] = useState(currentMonth)

  const infoQuery = useEmpInfo(empId)
  const attendanceQuery = useMyAttendance(empId, month)
  const tardinessQuery = useMyTardiness(empId)
  const permissionsQuery = useMyPermissions(empId)
  const requestsQuery = useMyRequests(empId)
  const changePassword = useChangePassword()

  const empInfo = infoQuery.data
  const attendanceRecords = attendanceQuery.data ?? []
  const allTardiness = tardinessQuery.data ?? []
  const tardinessRecords = allTardiness.filter(r => r.date.slice(0, 7) === month)
  const myPermissions = permissionsQuery.data ?? []

  const totalDeducted = tardinessRecords.reduce((s, r) => s + (r.leave_deducted || 0), 0)
  const summary = empInfo
    ? summariseMonth(month, {
        attendance: attendanceRecords,
        tardiness: allTardiness,
        leaves: requestsQuery.data ?? [],
        workDays: empInfo.schedule.workDays,
      })
    : null
  const summaryReady = attendanceQuery.isSuccess && tardinessQuery.isSuccess && requestsQuery.isSuccess

  async function handleChangePassword() {
    if (!pwForm.current_password || !pwForm.new_password) {
      toast.error(t('fillRequired')); return
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      toast.error(t('passwordsDoNotMatch')); return
    }
    if (pwForm.new_password.length < 6) {
      toast.error(t('passwordMustBeAtLeast')); return
    }
    try {
      await changePassword.mutateAsync({ current_password: pwForm.current_password, new_password: pwForm.new_password })
      toast.success(t('passwordChangedSuccessfully'))
      setPwForm({ current_password: '', new_password: '', confirm_password: '' })
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  if (infoQuery.isError) {
    return (
      <div className="space-y-4 animate-in">
        <QueryError onRetry={() => infoQuery.refetch()} />
      </div>
    )
  }

  if (!empInfo) {
    return (
      <div className="space-y-4 animate-in">
        <div className="text-center py-8 text-muted-foreground text-sm">{t('loading')}</div>
      </div>
    )
  }

  const schedule = empInfo.schedule

  return (
    <div className="space-y-4 animate-in">
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
          {/* Total − used rarely equals remaining, because lateness is also charged to
              this balance; say so rather than leave the numbers looking wrong. */}
          <p className="text-[11px] text-muted-foreground mt-3">{t('portalBalanceTardinessHint')}</p>
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
            <div className="flex justify-between items-center py-2 border-b">
              <span className="text-sm text-muted-foreground">{t('department')}</span>
              <span className="text-sm font-medium">{empInfo.department_name || empInfo.department?.name || '-'}</span>
            </div>
            {/* The schedule lateness and overtime are measured against — resolved
                employee -> department -> company, exactly as the server does. */}
            <div className="flex justify-between items-start gap-3 py-2" data-testid="my-schedule">
              <span className="text-sm text-muted-foreground shrink-0">{t('portalYourSchedule')}</span>
              <span className="text-sm font-medium text-end">
                {t('portalScheduleLine', {
                  start: schedule.workStartTime.slice(0, 5),
                  days: formatWorkDays(schedule.workDays, locale),
                  hours: schedule.workHoursPerDay,
                })}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Push reminders (self-hides when the browser can't do push) */}
      <div className="flex flex-col gap-2">
        <PushSetup />
      </div>

      {/* Month picker — drives the summary and the attendance/tardiness lists below */}
      <div className="flex items-center justify-between gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label={t('portalPreviousMonth')}
          onClick={() => setMonth(m => addMonths(m, -1))}
        >
          <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
        </Button>
        <span className="font-semibold" data-testid="history-month">{formatMonthLabel(month, locale)}</span>
        <Button
          size="icon"
          variant="outline"
          aria-label={t('portalNextMonth')}
          disabled={month >= currentMonth}
          onClick={() => setMonth(m => addMonths(m, 1))}
        >
          <ChevronRight className="h-4 w-4 rtl:rotate-180" />
        </Button>
      </div>

      {/* Monthly summary */}
      <Card className="border-0 shadow-md" data-testid="month-summary">
        <CardContent className="p-4">
          <h2 className="font-bold text-sm mb-3">{t('portalMonthSummary')}</h2>
          {attendanceQuery.isError || tardinessQuery.isError || requestsQuery.isError ? (
            <QueryError onRetry={() => {
              if (attendanceQuery.isError) attendanceQuery.refetch()
              if (tardinessQuery.isError) tardinessQuery.refetch()
              if (requestsQuery.isError) requestsQuery.refetch()
            }} />
          ) : !summaryReady || !summary ? (
            <div className="text-center py-4 text-muted-foreground text-sm">{t('loading')}</div>
          ) : (
            <div className="grid grid-cols-3 gap-2 text-center">
              <SummaryTile label={t('presentDays')} value={String(summary.presentDays)} tone="emerald" />
              <SummaryTile label={t('absentDays2')} value={String(summary.absentDays)} tone="rose" />
              <SummaryTile label={t('leaveDays')} value={String(summary.leaveDays)} tone="blue" />
              <SummaryTile label={t('workHours')} value={formatHours(summary.totalHours)} tone="blue" />
              <SummaryTile label={t('overtime')} value={formatHours(summary.overtimeHours)} tone="purple" />
              <SummaryTile
                label={t('late')}
                value={`${summary.lateCount}`}
                sub={summary.lateMinutes > 0 ? `${summary.lateMinutes} ${t('minutes')}` : undefined}
                tone="amber"
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Records Sub-tabs */}
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={recordsSubTab === 'attendance' ? 'default' : 'outline'}
          onClick={() => setRecordsSubTab('attendance')}
          className="flex-1"
        >
          <Clock className="h-3.5 w-3.5 me-1.5" />
          {t('attendanceHistory')}
        </Button>
        <Button
          size="sm"
          variant={recordsSubTab === 'tardiness' ? 'default' : 'outline'}
          onClick={() => setRecordsSubTab('tardiness')}
          className="flex-1"
        >
          <AlertTriangle className="h-3.5 w-3.5 me-1.5" />
          {t('tardinessHistory')}
        </Button>
        <Button
          size="sm"
          variant={recordsSubTab === 'permissions' ? 'default' : 'outline'}
          onClick={() => setRecordsSubTab('permissions')}
          className="flex-1"
        >
          {t('permissions2')}
        </Button>
      </div>

      {/* Attendance Records */}
      {recordsSubTab === 'attendance' && (
        <div className="space-y-3">
          <h2 className="font-bold text-lg">{t('attendanceHistory')} ({attendanceRecords.length})</h2>
          {attendanceQuery.isError ? (
            <QueryError onRetry={() => attendanceQuery.refetch()} />
          ) : attendanceQuery.isPending ? (
            <div className="text-center py-6 text-muted-foreground text-sm">{t('loading')}</div>
          ) : attendanceRecords.length === 0 ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                <Clock className="h-10 w-10 mx-auto mb-2 opacity-30" />
                {t('noAttendance')}
              </CardContent>
            </Card>
          ) : (
            attendanceRecords.map(rec => (
              <Card key={rec.id} className="border-0 shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold font-mono">{rec.date}</span>
                    <div className="flex items-center gap-2">
                      {rec.is_holiday_work && (
                        <Badge className="bg-purple-500/10 text-purple-500 border-0 text-[10px]">
                          {t('holiday3')}
                        </Badge>
                      )}
                      {rec.status === 'absent' && !rec.check_in && (
                        <Badge className="bg-rose-500/10 text-rose-500 border-0 text-[10px]">
                          {t('absent')}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-primary"
                        onClick={() => setCorrectionRecord(rec)}
                      >
                        <PencilLine className="h-3 w-3 me-1" />
                        {t('requestCorrection')}
                      </Button>
                    </div>
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
                      <p className="text-xs font-bold text-blue-500 font-mono">{formatHours(rec.work_hours)}</p>
                    </div>
                  </div>
                  {parseFloat(String(rec.overtime_hours ?? 0)) > 0 && (
                    <p className="text-[11px] text-purple-500 mt-2">
                      {t('overtime')}: <span className="font-mono">{formatHours(rec.overtime_hours)}</span>
                    </p>
                  )}
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
          {totalDeducted > 0 && (
            <Card className="border-0 shadow-md ring-1 ring-amber-500/30">
              <CardContent className="p-3 flex items-center justify-between text-sm">
                <span>{t('totalLeaveDeductedForLateness')}</span>
                <Badge className="bg-amber-500/10 text-amber-600 border-0 font-mono">
                  -{totalDeducted.toFixed(3)} {t('days')}
                </Badge>
              </CardContent>
            </Card>
          )}
          {tardinessQuery.isError ? (
            <QueryError onRetry={() => tardinessQuery.refetch()} />
          ) : tardinessQuery.isPending ? (
            <div className="text-center py-6 text-muted-foreground text-sm">{t('loading')}</div>
          ) : tardinessRecords.length === 0 ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                <AlertTriangle className="h-10 w-10 mx-auto mb-2 opacity-30" />
                {t('noTardiness')}
              </CardContent>
            </Card>
          ) : (
            tardinessRecords.map(rec => (
              <Card key={rec.id} className="border-0 shadow-md">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold font-mono">{rec.date}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('arrivalTime')}: <span className="font-mono">{rec.time?.slice(0, 5)}</span>
                      </p>
                    </div>
                    <div className="text-end space-y-1">
                      <Badge className="bg-rose-500/10 text-rose-500 border-0">
                        {rec.minutes_late} {t('minutes')} {t('late')}
                      </Badge>
                      {(rec.leave_deducted || 0) > 0 && (
                        <p className="text-[11px] font-mono text-amber-600">
                          -{(rec.leave_deducted || 0).toFixed(3)} {t('leaveDay')}
                        </p>
                      )}
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
          <h2 className="font-bold text-lg">{t('myPermissions')} ({myPermissions.length})</h2>
          {permissionsQuery.isError ? (
            <QueryError onRetry={() => permissionsQuery.refetch()} />
          ) : myPermissions.length === 0 ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                {t('noPermissions')}
              </CardContent>
            </Card>
          ) : (
            myPermissions.map(p => (
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
                      <p className="text-[10px] text-muted-foreground">{t('left')}</p>
                      <p className="text-xs font-bold text-amber-500 font-mono">{p.leave_time?.slice(0, 5)}</p>
                    </div>
                    <div className="p-1.5 rounded bg-emerald-500/10">
                      <p className="text-[10px] text-muted-foreground">{t('return')}</p>
                      <p className="text-xs font-bold text-emerald-500 font-mono">{p.return_time?.slice(0, 5) || '--:--'}</p>
                    </div>
                    <div className="p-1.5 rounded bg-blue-500/10">
                      <p className="text-[10px] text-muted-foreground">{t('duration')}</p>
                      <p className="text-xs font-bold text-blue-500 font-mono">
                        {p.return_time && p.leave_time ? (() => {
                          const [lh, lm] = p.leave_time.split(':').map(Number)
                          const [rh, rm] = p.return_time.split(':').map(Number)
                          const mins = (rh * 60 + rm) - (lh * 60 + lm)
                          return mins > 0 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : '-'
                        })() : '-'}
                      </p>
                    </div>
                  </div>
                  {p.reason && (
                    <p className="text-xs text-muted-foreground mt-2 bg-accent/30 p-2 rounded">{p.reason}</p>
                  )}
                  <DecisionNote status={p.status} note={p.decision_note} />
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

      {/* Change Password Card */}
      <Card className="border-0 shadow-md">
        <CardContent className="p-5">
          <h2 className="font-bold text-lg mb-4">{t('changePassword')}</h2>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder={t('currentPassword')}
              value={pwForm.current_password}
              onChange={e => setPwForm(f => ({ ...f, current_password: e.target.value }))}
            />
            <Input
              type="password"
              placeholder={t('newPassword')}
              value={pwForm.new_password}
              onChange={e => setPwForm(f => ({ ...f, new_password: e.target.value }))}
            />
            <Input
              type="password"
              placeholder={t('confirmPassword')}
              value={pwForm.confirm_password}
              onChange={e => setPwForm(f => ({ ...f, confirm_password: e.target.value }))}
            />
            <Button className="w-full" disabled={changePassword.isPending} onClick={handleChangePassword}>
              {changePassword.isPending ? '...' : (t('changePassword'))}
            </Button>
          </div>
        </CardContent>
      </Card>

      {empId && correctionRecord && (
        <CorrectionDialog
          key={correctionRecord.id}
          empId={empId}
          record={correctionRecord}
          onClose={() => setCorrectionRecord(null)}
        />
      )}
    </div>
  )
}

const TONES = {
  emerald: 'bg-emerald-500/10 text-emerald-500',
  rose: 'bg-rose-500/10 text-rose-500',
  blue: 'bg-blue-500/10 text-blue-500',
  purple: 'bg-purple-500/10 text-purple-500',
  amber: 'bg-amber-500/10 text-amber-600',
} as const

function SummaryTile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: keyof typeof TONES }) {
  const [bg, fg] = TONES[tone].split(' ')
  return (
    <div className={`p-2 rounded-lg ${bg}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold font-mono ${fg}`}>{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground font-mono">{sub}</p>}
    </div>
  )
}
