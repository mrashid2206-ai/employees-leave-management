'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AlertTriangle, Clock, PencilLine } from 'lucide-react'
import { toast } from 'sonner'
import { PushSetup } from '@/components/push-setup'
import { useLanguage, useT } from '@/lib/language-context'
import {
  apiErrorPayload,
  useChangePassword,
  useCreateCorrection,
  useEmpInfo,
  useMyAttendance,
  useMyPermissions,
  useMyTardiness,
  type AttendanceRecord,
} from '../_hooks/use-portal'

interface ProfileTabProps {
  empId?: number
}

type RecordsSubTab = 'attendance' | 'tardiness' | 'permissions'

function formatHours(value: number | string | null | undefined): string {
  const h = parseFloat(String(value)) || 0
  return `${Math.floor(h)}h ${Math.round((h % 1) * 60)}m`
}

/* -------------------------------------------------------------------------- */
/* Correction request dialog                                                   */
/* -------------------------------------------------------------------------- */

interface CorrectionDialogProps {
  empId: number
  record: AttendanceRecord
  onClose: () => void
}

/**
 * Lets an employee ask an admin to fix a wrong attendance record. Both times are
 * optional (a record may only need one side corrected) but a reason is required.
 */
function CorrectionDialog({ empId, record, onClose }: CorrectionDialogProps) {
  const t = useT()
  const { lang, dir } = useLanguage()
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [reason, setReason] = useState('')
  const createCorrection = useCreateCorrection(empId)

  async function handleSubmit() {
    if (!reason.trim()) {
      toast.error(lang === 'ar' ? 'يرجى إدخال سبب التصحيح' : 'Please enter a reason for the correction')
      return
    }
    if (!checkIn && !checkOut) {
      toast.error(lang === 'ar' ? 'أدخل وقت الحضور أو الانصراف المصحّح' : 'Enter a corrected check-in or check-out time')
      return
    }
    try {
      await createCorrection.mutateAsync({
        date: record.date,
        requested_check_in: checkIn || null,
        requested_check_out: checkOut || null,
        reason: reason.trim(),
      })
      toast.success(lang === 'ar' ? 'تم إرسال طلب التصحيح — بانتظار موافقة المدير' : 'Correction request sent — waiting for admin approval')
      onClose()
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm" dir={dir}>
        <DialogHeader>
          <DialogTitle>{lang === 'ar' ? 'طلب تصحيح الحضور' : 'Request Attendance Correction'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {lang === 'ar' ? 'المسجّل حالياً بتاريخ' : 'Currently recorded on'}{' '}
            <span className="font-mono">{record.date}</span>:{' '}
            <span className="font-mono">{record.check_in?.slice(0, 5) || '--:--'}</span>
            {' → '}
            <span className="font-mono">{record.check_out?.slice(0, 5) || '--:--'}</span>
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{lang === 'ar' ? 'الحضور المصحّح' : 'Corrected check-in'}</Label>
              <Input type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{lang === 'ar' ? 'الانصراف المصحّح' : 'Corrected check-out'}</Label>
              <Input type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">{lang === 'ar' ? 'السبب' : 'Reason'} *</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={lang === 'ar' ? 'مثال: نسيت تسجيل الانصراف' : 'e.g. I forgot to check out'}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{lang === 'ar' ? 'إلغاء' : 'Cancel'}</Button>
          <Button onClick={handleSubmit} disabled={createCorrection.isPending}>
            {createCorrection.isPending ? '...' : (lang === 'ar' ? 'إرسال الطلب' : 'Send Request')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* -------------------------------------------------------------------------- */
/* Profile tab                                                                 */
/* -------------------------------------------------------------------------- */

export function ProfileTab({ empId }: ProfileTabProps) {
  const t = useT()
  const { lang } = useLanguage()

  const [recordsSubTab, setRecordsSubTab] = useState<RecordsSubTab>('attendance')
  const [correctionRecord, setCorrectionRecord] = useState<AttendanceRecord | null>(null)
  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '', confirm_password: '' })

  const { data: empInfo } = useEmpInfo(empId)
  const { data: attendanceRecords = [] } = useMyAttendance(empId)
  const { data: tardinessRecords = [] } = useMyTardiness(empId)
  const { data: myPermissions = [] } = useMyPermissions(empId)
  const changePassword = useChangePassword()

  const totalDeducted = tardinessRecords.reduce((s, r) => s + (r.leave_deducted || 0), 0)

  async function handleChangePassword() {
    if (!pwForm.current_password || !pwForm.new_password) {
      toast.error(t('fillRequired')); return
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      toast.error(lang === 'ar' ? 'كلمة المرور غير متطابقة' : 'Passwords do not match'); return
    }
    if (pwForm.new_password.length < 6) {
      toast.error(lang === 'ar' ? 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' : 'Password must be at least 6 characters'); return
    }
    try {
      await changePassword.mutateAsync({ current_password: pwForm.current_password, new_password: pwForm.new_password })
      toast.success(lang === 'ar' ? 'تم تغيير كلمة المرور بنجاح' : 'Password changed successfully')
      setPwForm({ current_password: '', new_password: '', confirm_password: '' })
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  if (!empInfo) {
    return (
      <div className="space-y-4 animate-in">
        <div className="text-center py-8 text-muted-foreground text-sm">{t('loading')}</div>
      </div>
    )
  }

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

      {/* Push reminders (self-hides when the browser can't do push) */}
      <div className="flex flex-col gap-2">
        <PushSetup />
      </div>

      {/* Records Sub-tabs */}
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
                    <div className="flex items-center gap-2">
                      {rec.is_holiday_work && (
                        <Badge className="bg-purple-500/10 text-purple-500 border-0 text-[10px]">
                          {lang === 'ar' ? 'عمل في عطلة' : 'Holiday'}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] text-muted-foreground hover:text-primary"
                        onClick={() => setCorrectionRecord(rec)}
                      >
                        <PencilLine className="h-3 w-3 me-1" />
                        {lang === 'ar' ? 'طلب تصحيح' : 'Request correction'}
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
                <span>{lang === 'ar' ? 'إجمالي المخصوم من رصيد إجازتك بسبب التأخير' : 'Total leave deducted for lateness'}</span>
                <Badge className="bg-amber-500/10 text-amber-600 border-0 font-mono">
                  -{totalDeducted.toFixed(3)} {t('days')}
                </Badge>
              </CardContent>
            </Card>
          )}
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
                    <div className="text-right space-y-1">
                      <Badge className="bg-rose-500/10 text-rose-500 border-0">
                        {rec.minutes_late} {t('minutes')} {t('late')}
                      </Badge>
                      {(rec.leave_deducted || 0) > 0 && (
                        <p className="text-[11px] font-mono text-amber-600">
                          -{(rec.leave_deducted || 0).toFixed(3)} {lang === 'ar' ? 'يوم إجازة' : 'leave day'}
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
          <h2 className="font-bold text-lg">{lang === 'ar' ? 'أذونات الخروج' : 'My Permissions'} ({myPermissions.length})</h2>
          {myPermissions.length === 0 ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                {lang === 'ar' ? 'لا توجد أذونات' : 'No permissions'}
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
                </CardContent>
              </Card>
            ))
          )}
        </div>
      )}

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
            <Button className="w-full" disabled={changePassword.isPending} onClick={handleChangePassword}>
              {changePassword.isPending ? '...' : (lang === 'ar' ? 'تغيير كلمة المرور' : 'Change Password')}
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
