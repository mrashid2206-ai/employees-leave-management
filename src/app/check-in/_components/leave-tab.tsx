'use client'

import { useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { AlertTriangle, CalendarDays, CheckCircle, Paperclip, Send, X } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { omanToday } from '@/lib/oman-date'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_LEAVE,
  formatBytes,
  looksLikeAllowedFile,
} from '@/lib/attachments'
import { LEAVE_TYPE_SICK, MAX_CONSECUTIVE_LEAVE_DAYS, SICK_LEAVE_NOTES_THRESHOLD } from '@/lib/constants'
import {
  apiErrorPayload,
  useLeaveForecast,
  useLeaveTypes,
  useSubmitLeave,
  useUploadAttachment,
  useWorkingDays,
} from '../_hooks/use-portal'
import { LeaveForecastCard } from './leave-forecast-card'

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

interface UploadFailure {
  name: string
  error: string
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
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadFailures, setUploadFailures] = useState<UploadFailure[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const { data: leaveTypes = [] } = useLeaveTypes()
  // Same query (and cache entry) as the forecast card above the form.
  const { data: forecast } = useLeaveForecast(empId)
  const submitLeave = useSubmitLeave(empId)
  const uploadAttachment = useUploadAttachment(empId)

  const leaveDays = calculateDaysCount(leaveForm.start_date, leaveForm.end_date)
  const workingDaysInfo = useWorkingDays(leaveForm.start_date, leaveForm.end_date)
  const isHalfDay = leaveForm.is_half_day && leaveForm.start_date === leaveForm.end_date

  // The checks below mirror createLeave (src/server/services/leave-service.ts), so the
  // employee hears about a problem while filling the form instead of after sending it.
  // The server stays the authority; these only say early what it would say anyway.
  const today = omanToday()
  const yearStart = forecast?.fiscalYearStart
  const yearEnd = forecast?.fiscalYearEnd
  const minDate = yearStart && yearStart > today ? yearStart : today

  // The day count the server will charge: calendar days minus public holidays (the
  // working-days endpoint uses the same rule), or half a day.
  const countedDays = workingDaysInfo?.workingDays ?? null
  const requestedDays = isHalfDay ? 0.5 : countedDays

  const selectedType = leaveTypes.find(x => String(x.id) === leaveForm.leave_type_id)

  let dateProblem: string | null = null
  const { start_date: start, end_date: end } = leaveForm
  if (start && end) {
    if (end < start) dateProblem = t('endDateAfterStart')
    else if (start < today || end < today) dateProblem = t('leavePastDates')
    else if (yearStart && yearEnd && (start < yearStart || end > yearEnd)) {
      dateProblem = t('leaveOutsideYear', { start: yearStart, end: yearEnd })
    } else if (countedDays !== null && countedDays > MAX_CONSECUTIVE_LEAVE_DAYS) {
      dateProblem = t('leaveMaxConsecutive', { days: MAX_CONSECUTIVE_LEAVE_DAYS })
    }
  }

  // Server rule: sick leave longer than the threshold needs notes. Counted on the full
  // day count, as the server does.
  const sickNeedsNotes =
    selectedType?.name_en === LEAVE_TYPE_SICK && countedDays !== null && countedDays > SICK_LEAVE_NOTES_THRESHOLD
  const notesMissing = sickNeedsNotes && !leaveForm.notes.trim()

  // A zero-or-negative balance is refused by the server. Asking for more than is left is
  // NOT: approval may take the balance below zero, so that is a warning only.
  const noBalance = !!forecast && forecast.currentBalance <= 0
  const exceedsBalance =
    !!forecast && !noBalance && requestedDays !== null && requestedDays > forecast.projectedBalance

  function addFiles(list: FileList | null) {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (!looksLikeAllowedFile(f)) { toast.error(t('attachmentWrongType', { name: f.name })); continue }
      if (f.size > MAX_ATTACHMENT_BYTES) { toast.error(t('attachmentTooLarge', { name: f.name })); continue }
      if (next.length >= MAX_ATTACHMENTS_PER_LEAVE) {
        toast.error(t('attachmentTooMany', { max: MAX_ATTACHMENTS_PER_LEAVE }))
        break
      }
      next.push(f)
    }
    setFiles(next)
  }

  async function handleLeaveSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!empId || !leaveForm.leave_type_id || !leaveForm.start_date || !leaveForm.end_date) {
      toast.error(t('fillRequired'))
      return
    }
    const days = calculateDaysCount(leaveForm.start_date, leaveForm.end_date)
    if (days <= 0) { toast.error(t('endDateAfterStart')); return }
    if (dateProblem) { toast.error(dateProblem); return }
    if (notesMissing) { toast.error(t('sickNotesRequired', { days: SICK_LEAVE_NOTES_THRESHOLD })); return }

    let leaveId: number
    try {
      const created = await submitLeave.mutateAsync({
        leave_type_id: parseInt(leaveForm.leave_type_id),
        start_date: leaveForm.start_date,
        end_date: leaveForm.end_date,
        days_count: isHalfDay ? 0.5 : days,
        notes: leaveForm.notes || undefined,
        is_half_day: leaveForm.is_half_day,
      })
      leaveId = created.id
    } catch (err) {
      // Surface the server's reason (e.g. no remaining balance, overlap, dept limit)
      // instead of a generic failure.
      toast.error(apiErrorPayload(err).error || t('error'))
      return
    }

    // The request exists from here on, whatever happens to the files. A failed upload is
    // reported by name so it can be attached again from the request in My Requests.
    const failures: UploadFailure[] = []
    if (files.length > 0) {
      setUploading(true)
      for (const file of files) {
        try {
          await uploadAttachment.mutateAsync({ leaveId, file })
        } catch (err) {
          failures.push({ name: file.name, error: apiErrorPayload(err).error || t('error') })
        }
      }
      setUploading(false)
    }

    setUploadFailures(failures)
    setLeaveSubmitted(true)
    setLeaveForm(EMPTY_FORM)
    setFiles([])
  }

  const busy = submitLeave.isPending || uploading

  return (
    <div className="space-y-4 animate-in">
      {leaveSubmitted ? (
        <Card className="border-0 shadow-md text-center">
          <CardContent className="p-8">
            <CheckCircle className="h-12 w-12 text-emerald-500 mx-auto mb-3" />
            <h2 className="text-xl font-bold mb-1">{t('requestSubmitted')}</h2>
            <p className="text-sm text-muted-foreground mb-4">{t('requestReview')}</p>
            {uploadFailures.length > 0 && (
              <div className="mb-4 rounded-md bg-amber-500/10 p-3 text-start text-sm text-amber-700 dark:text-amber-400" role="alert">
                <p className="font-medium">{t('attachmentUploadFailedTitle')}</p>
                <ul className="mt-1 list-disc ps-5 text-xs">
                  {uploadFailures.map((f, i) => (
                    <li key={`${f.name}-${i}`}><span dir="auto" className="font-medium">{f.name}</span>: {f.error}</li>
                  ))}
                </ul>
                <p className="mt-2 text-xs">{t('attachmentRetryHint')}</p>
              </div>
            )}
            <div className="flex gap-2 justify-center">
              <Button size="sm" onClick={() => { setLeaveSubmitted(false); setUploadFailures([]) }}>{t('newRequest')}</Button>
              <Button size="sm" variant="outline" onClick={() => { setLeaveSubmitted(false); setUploadFailures([]); onGoToRequests() }}>{t('checkMyRequests')}</Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Balance in context: what is left, what is committed, and what expires at
              the yearly reset — shown right where leave is requested. */}
          {!!empId && <LeaveForecastCard empId={empId} />}
          <Card className="border-0 shadow-md">
            <CardContent className="p-5">
              <h2 className="font-bold text-lg mb-4">{t('applyLeave')}</h2>
              <form onSubmit={handleLeaveSubmit} className="space-y-4">
                <div>
                  <Label className="text-xs">{t('leaveType')} *</Label>
                  <Select value={leaveForm.leave_type_id} onValueChange={v => setLeaveForm(f => ({ ...f, leave_type_id: v ?? '' }))}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('selectType')}>
                        {leaveForm.leave_type_id && (selectedType ? (
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: selectedType.color }} />
                            {lang === 'ar' ? selectedType.name_ar : selectedType.name_en}
                          </div>
                        ) : leaveForm.leave_type_id)}
                      </SelectValue>
                    </SelectTrigger>
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
                    <Input
                      type="date"
                      min={minDate}
                      max={yearEnd}
                      value={leaveForm.start_date}
                      onChange={e => setLeaveForm(f => ({ ...f, start_date: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">{t('toDate')} *</Label>
                    <Input
                      type="date"
                      min={leaveForm.start_date && leaveForm.start_date > minDate ? leaveForm.start_date : minDate}
                      max={yearEnd}
                      value={leaveForm.end_date}
                      onChange={e => setLeaveForm(f => ({ ...f, end_date: e.target.value }))}
                    />
                  </div>
                </div>
                {dateProblem && (
                  <p className="text-xs text-destructive" role="alert">{dateProblem}</p>
                )}
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
                        <span className="text-xs text-muted-foreground ms-1">
                          ({t('workingDaysOnly')})
                        </span>
                      )}
                    </span>
                  </div>
                )}
                {noBalance && (
                  <p className="flex items-start gap-1.5 text-xs text-destructive" role="alert">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {t('leaveNoBalance')}
                  </p>
                )}
                {exceedsBalance && forecast && requestedDays !== null && (
                  <p className="flex items-start gap-1.5 rounded-md bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400" role="status">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    {t('leaveExceedsBalance', { days: requestedDays, remaining: forecast.projectedBalance })}
                  </p>
                )}
                <div>
                  <Label className="text-xs">{t('notes')}{sickNeedsNotes && ' *'}</Label>
                  <Textarea
                    value={leaveForm.notes}
                    onChange={e => setLeaveForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder={t('addNotes')}
                    rows={2}
                    aria-invalid={notesMissing || undefined}
                  />
                  {sickNeedsNotes && (
                    <p className={`mt-1 text-xs ${notesMissing ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {t('sickNotesRequired', { days: SICK_LEAVE_NOTES_THRESHOLD })}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <input
                    ref={fileInput}
                    type="file"
                    accept={ATTACHMENT_ACCEPT}
                    multiple
                    hidden
                    onChange={e => { addFiles(e.target.files); e.target.value = '' }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy || files.length >= MAX_ATTACHMENTS_PER_LEAVE}
                    onClick={() => fileInput.current?.click()}
                  >
                    <Paperclip className="h-3.5 w-3.5 me-1.5" />
                    {t('attachCertificate')}
                  </Button>
                  <p className="text-[11px] text-muted-foreground">{t('attachmentsHint', { max: MAX_ATTACHMENTS_PER_LEAVE })}</p>
                  {files.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {files.map((f, i) => (
                        <span key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 rounded-full bg-accent px-2.5 py-1 text-xs">
                          <Paperclip className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[11rem]" dir="auto">{f.name}</span>
                          <span className="text-muted-foreground shrink-0">({formatBytes(f.size)})</span>
                          <button
                            type="button"
                            className="rounded-full p-0.5 hover:bg-background disabled:opacity-50"
                            aria-label={`${t('attachmentRemove')}: ${f.name}`}
                            disabled={busy}
                            onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button type="submit" className="w-full" disabled={busy}>
                  <Send className="h-4 w-4 me-2" />
                  {uploading ? t('attachmentUploading') : submitLeave.isPending ? '...' : t('submitRequest')}
                </Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
