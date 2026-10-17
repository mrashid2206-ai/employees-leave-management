'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { omanToday } from '@/lib/oman-date'
import { apiErrorPayload, useCreateCorrection, type AttendanceRecord } from '../_hooks/use-portal'

interface CorrectionDialogProps {
  empId: number
  /** Correcting an existing row: its date is fixed and its current times are shown. */
  record?: AttendanceRecord | null
  /** No row to start from ("I forgot to check in"): the employee picks the day. */
  initialDate?: string
  onClose: () => void
}

/**
 * Lets an employee ask an admin to fix their attendance for a day. Both times are
 * optional (a record may only need one side corrected) but a reason is required.
 *
 * It used to open only from an existing history row, so the most common case — no row
 * at all because the employee never checked in — had no way in. Without a record the
 * dialog asks for the date; the server accepts any day up to today.
 */
export function CorrectionDialog({ empId, record, initialDate, onClose }: CorrectionDialogProps) {
  const t = useT()
  const { dir } = useLanguage()
  const today = omanToday()
  const [date, setDate] = useState(record?.date ?? initialDate ?? '')
  const [checkIn, setCheckIn] = useState('')
  const [checkOut, setCheckOut] = useState('')
  const [reason, setReason] = useState('')
  const createCorrection = useCreateCorrection(empId)

  async function handleSubmit() {
    if (!date) {
      toast.error(t('portalPickCorrectionDate'))
      return
    }
    if (date > today) {
      toast.error(t('portalCorrectionFutureDate'))
      return
    }
    if (!reason.trim()) {
      toast.error(t('pleaseEnterAReasonFor'))
      return
    }
    if (!checkIn && !checkOut) {
      toast.error(t('enterACorrectedCheckIn'))
      return
    }
    try {
      await createCorrection.mutateAsync({
        date,
        requested_check_in: checkIn || null,
        requested_check_out: checkOut || null,
        reason: reason.trim(),
      })
      toast.success(t('correctionRequestSentWaitingFor'))
      onClose()
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent className="max-w-sm" dir={dir}>
        <DialogHeader>
          <DialogTitle>{t('requestAttendanceCorrection')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {record ? (
            <p className="text-xs text-muted-foreground">
              {t('currentlyRecordedOn')}{' '}
              <span className="font-mono">{record.date}</span>:{' '}
              <span className="font-mono" dir="ltr">
                {record.check_in?.slice(0, 5) || '--:--'} → {record.check_out?.slice(0, 5) || '--:--'}
              </span>
            </p>
          ) : (
            <div>
              <Label className="text-xs" htmlFor="correction-date">{t('portalCorrectionDate')} *</Label>
              <Input
                id="correction-date"
                type="date"
                value={date}
                max={today}
                onChange={e => setDate(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground mt-1">{t('portalCorrectionNoRecordHint')}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="correction-in">{t('correctedCheckIn')}</Label>
              <Input id="correction-in" type="time" value={checkIn} onChange={e => setCheckIn(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="correction-out">{t('correctedCheckOut')}</Label>
              <Input id="correction-out" type="time" value={checkOut} onChange={e => setCheckOut(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs" htmlFor="correction-reason">{t('reason')} *</Label>
            <Textarea
              id="correction-reason"
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={t('eGIForgotTo')}
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={handleSubmit} disabled={createCorrection.isPending}>
            {createCorrection.isPending ? '...' : (t('sendRequest'))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
