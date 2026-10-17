'use client'

import { useState, type ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { AlertTriangle } from 'lucide-react'
import { useLanguage, useT } from '@/lib/language-context'

const NOTE_MAX = 500

interface DecisionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'approve' | 'reject'
  /** What is being decided, e.g. the employee's name and dates. */
  description?: ReactNode
  /** Shown above the note, e.g. the department-limit warning on "approve anyway". */
  warning?: string
  /** When set, offers a checkbox (e.g. "approve even where the department limit is reached"). */
  overrideLabel?: string
  title?: string
  confirmLabel?: string
  loading?: boolean
  onConfirm: (note: string, override: boolean) => void
}

// Approving or rejecting a request with a note. A rejection can't be sent without a
// reason — the employee is shown it — while an approval's note is optional.
//
// Render it conditionally (`{target && <DecisionDialog … />}`) so each request starts
// with an empty note.
export function DecisionDialog({
  open,
  onOpenChange,
  mode,
  description,
  warning,
  overrideLabel,
  title,
  confirmLabel,
  loading,
  onConfirm,
}: DecisionDialogProps) {
  const t = useT()
  const { dir } = useLanguage()
  const [note, setNote] = useState('')
  const [override, setOverride] = useState(false)

  const reject = mode === 'reject'
  const missing = reject && !note.trim()

  function submit() {
    if (missing || loading) return
    onConfirm(note.trim(), override)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir={dir}>
        <DialogHeader>
          <DialogTitle>{title ?? (reject ? t('rejectRequestTitle') : t('approveRequestTitle'))}</DialogTitle>
          {description && <DialogDescription className="text-start">{description}</DialogDescription>}
        </DialogHeader>

        {warning && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 p-3 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{warning}</span>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="decision-note">
            {reject ? `${t('rejectionReason')} *` : t('decisionNoteOptional')}
          </Label>
          <Textarea
            id="decision-note"
            data-testid="decision-note"
            value={note}
            maxLength={NOTE_MAX}
            autoFocus
            required={reject}
            placeholder={reject ? t('rejectionReasonRequired') : undefined}
            onChange={e => setNote(e.target.value)}
            onKeyDown={e => {
              // Ctrl/Cmd+Enter sends, the way a long-form field usually does.
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
            }}
          />
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>{reject ? t('rejectionReasonHint') : ''}</span>
            <span className="tabular-nums" dir="ltr">{note.length}/{NOTE_MAX}</span>
          </div>
        </div>

        {overrideLabel && (
          <div className="flex items-center gap-2">
            <Checkbox
              id="decision-override"
              checked={override}
              onCheckedChange={checked => setOverride(!!checked)}
            />
            <Label htmlFor="decision-override" className="text-sm font-normal">{overrideLabel}</Label>
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            {t('cancel')}
          </Button>
          <Button
            data-testid="decision-confirm"
            variant={reject ? 'destructive' : 'default'}
            className={reject ? '' : 'bg-emerald-600 hover:bg-emerald-700'}
            onClick={submit}
            disabled={loading || missing}
          >
            {loading ? '...' : (confirmLabel ?? (reject ? t('reject') : t('approve')))}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
