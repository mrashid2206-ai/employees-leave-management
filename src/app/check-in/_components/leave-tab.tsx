'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { CalendarDays, CheckCircle, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import {
  apiErrorPayload,
  useEmpInfo,
  useLeaveTypes,
  useSubmitLeave,
  useWorkingDays,
} from '../_hooks/use-portal'

interface LeaveTabProps {
  empId?: number
  onGoToRequests: () => void
}

interface LeaveForm {
  leave_type_id: string
  start_date: string
  end_date: string
  notes: string
  is_half_day: boolean
}

const EMPTY_FORM: LeaveForm = { leave_type_id: '', start_date: '', end_date: '', notes: '', is_half_day: false }

function calculateDaysCount(start: string, end: string): number {
  if (!start || !end) return 0
  const diff = Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000) + 1
  return diff > 0 ? diff : 0
}

export function LeaveTab({ empId, onGoToRequests }: LeaveTabProps) {
  const t = useT()
  const { lang } = useLanguage()

  const [leaveSubmitted, setLeaveSubmitted] = useState(false)
  const [leaveForm, setLeaveForm] = useState<LeaveForm>(EMPTY_FORM)

  const { data: leaveTypes = [] } = useLeaveTypes()
  const { data: empInfo } = useEmpInfo(empId)
  const submitLeave = useSubmitLeave(empId)

  const leaveDays = calculateDaysCount(leaveForm.start_date, leaveForm.end_date)
  const workingDaysInfo = useWorkingDays(leaveForm.start_date, leaveForm.end_date)
  const isHalfDay = leaveForm.is_half_day && leaveForm.start_date === leaveForm.end_date

  async function handleLeaveSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empId || !leaveForm.leave_type_id || !leaveForm.start_date || !leaveForm.end_date) {
      toast.error(t('fillRequired'))
      return
    }
    const days = calculateDaysCount(leaveForm.start_date, leaveForm.end_date)
    if (days <= 0) { toast.error(t('endDateAfterStart')); return }

    try {
      await submitLeave.mutateAsync({
        leave_type_id: parseInt(leaveForm.leave_type_id),
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        days_count: isHalfDay ? 0.5 : days,
        notes: leaveForm.notes || undefined,
        is_half_day: leaveForm.is_half_day,
      })
      setLeaveSubmitted(true)
      setLeaveForm(EMPTY_FORM)
    } catch (err) {
      // Surface the server's reason (e.g. no remaining balance, overlap, dept limit)
      // instead of a generic failure.
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  return (
    <div className="space-y-4 animate-in">
      {leaveSubmitted ? (
        <Card className="border-0 shadow-md text-center">
          <CardContent className="p-8">
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold mb-1">{t('requestSubmitted')}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t('requestReview')}</p>
            <div className="flex gap-2 justify-center">
              <Button size="sm" onClick={() => setLeaveSubmitted(false)}>{t('newRequest')}</Button>
              <Button size="sm" variant="outline" onClick={() => { setLeaveSubmitted(false); onGoToRequests() }}>{t('checkMyRequests')}</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Leave Balance Indicator */}
          {!!empId && (
            <Card className="border-0 shadow-md bg-primary/5">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-sm">{t('yourBalance')}</span>
                <Badge className="bg-primary/10 text-primary border-0 text-sm font-bold">
                  {empInfo?.remaining ?? '...'} {t('days')}
                </Badge>
              </CardContent>
            </Card>
          )}
          <Card className="border-0 shadow-md">
            <CardContent className="p-5">
              <h2 className="font-bold text-lg mb-4">{t('applyLeave')}</h2>
              <form onSubmit={handleLeaveSubmit} className="space-y-4">
                <div>
                  <Label className="text-xs">{t('leaveType')} *</Label>
                  <Select value={leaveForm.leave_type_id} onValueChange={v => setLeaveForm(f => ({ ...f, leave_type_id: v ?? '' }))}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('selectType')}>
                        {leaveForm.leave_type_id && (() => {
                          const lt = leaveTypes.find(x => String(x.id) === leaveForm.leave_type_id)
                          return lt ? (
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: lt.color }} />
                              {lang === 'ar' ? lt.name_ar : lt.name_en}
                            </div>
                          ) : leaveForm.leave_type_id
                        })()}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {leaveTypes.filter((lt, i, arr) => arr.findIndex(x => x.name_en === lt.name_en) === i).map(lt => (
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
                      {t('halfDay')}
                    </Label>
                  </div>
                )}
                {leaveDays > 0 && (
                  <div className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      {isHalfDay ? 0.5 : (workingDaysInfo ? workingDaysInfo.workingDays : leaveDays)} {t('days')}
                      {workingDaysInfo && workingDaysInfo.workingDays < leaveDays && (
                        <span className="text-xs text-muted-foreground ml-1">
                          ({t('workingDaysOnly')})
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
                <Button type="submit" className="w-full" disabled={submitLeave.isPending}>
                  <Send className="h-4 w-4 ml-2" />
                  {submitLeave.isPending ? '...' : t('submitRequest')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
