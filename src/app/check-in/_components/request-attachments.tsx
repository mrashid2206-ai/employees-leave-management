'use client'

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Paperclip, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useT } from '@/lib/language-context'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_LEAVE,
  formatBytes,
  looksLikeAllowedFile,
} from '@/lib/attachments'
import {
  apiErrorPayload,
  useDeleteAttachment,
  useLeaveAttachments,
  useUploadAttachment,
  type LeaveAttachment,
} from '../_hooks/use-portal'

interface RequestAttachmentsProps {
  empId?: number
  leaveId: number
  count: number
  /** Employees may add/remove only while the request is pending (server rule). */
  editable: boolean
}

// The certificates on one of the employee's own requests. Also where a file that failed
// to upload with the leave form is attached again.
export function RequestAttachments({ empId, leaveId, count, editable }: RequestAttachmentsProps) {
  const t = useT()
  const fileInput = useRef<HTMLInputElement>(null)
  const [removing, setRemoving] = useState<LeaveAttachment | null>(null)

  // No request for the (common) case of nothing attached.
  const { data: attachments = [] } = useLeaveAttachments(leaveId, count > 0)
  const upload = useUploadAttachment(empId)
  const remove = useDeleteAttachment(empId)

  if (count === 0 && !editable) return null

  async function addFiles(list: FileList | null) {
    if (!list) return
    let room = MAX_ATTACHMENTS_PER_LEAVE - count
    for (const file of Array.from(list)) {
      if (!looksLikeAllowedFile(file)) { toast.error(t('attachmentWrongType', { name: file.name })); continue }
      if (file.size > MAX_ATTACHMENT_BYTES) { toast.error(t('attachmentTooLarge', { name: file.name })); continue }
      if (room <= 0) { toast.error(t('attachmentTooMany', { max: MAX_ATTACHMENTS_PER_LEAVE })); break }
      try {
        await upload.mutateAsync({ leaveId, file })
        room--
        toast.success(t('attachmentUploaded'))
      } catch (err) {
        toast.error(`${file.name}: ${apiErrorPayload(err).error || t('error')}`)
      }
    }
  }

  async function confirmRemove() {
    if (!removing) return
    try {
      await remove.mutateAsync({ id: removing.id, leaveId })
      toast.success(t('attachmentDeleted'))
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <div className="mt-2 space-y-1.5" data-testid="request-attachments">
      {attachments.length > 0 && (
        <ul className="space-y-1">
          {attachments.map(a => (
            <li key={a.id} className="flex items-center gap-1.5 text-xs">
              <Paperclip className="h-3 w-3 shrink-0 text-muted-foreground" />
              {/* A plain link: the server answers with Content-Disposition: attachment. */}
              <a href={`/api/attachments/${a.id}`} className="truncate text-primary hover:underline" dir="auto">
                {a.filename}
              </a>
              <span className="shrink-0 text-muted-foreground">({formatBytes(a.size_bytes)})</span>
              {editable && (
                <button
                  type="button"
                  className="rounded-full p-0.5 text-rose-500 hover:bg-rose-500/10"
                  aria-label={`${t('attachmentRemove')}: ${a.filename}`}
                  onClick={() => setRemoving(a)}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && count < MAX_ATTACHMENTS_PER_LEAVE && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept={ATTACHMENT_ACCEPT}
            multiple
            hidden
            onChange={e => { void addFiles(e.target.files); e.target.value = '' }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            disabled={upload.isPending}
            onClick={() => fileInput.current?.click()}
          >
            <Plus className="h-3 w-3 me-1" />
            {upload.isPending ? t('attachmentUploading') : t('attachCertificate')}
          </Button>
        </>
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={open => { if (!open) setRemoving(null) }}
        title={t('attachmentRemove')}
        description={removing ? t('attachmentDeleteConfirm', { name: removing.filename }) : ''}
        confirmLabel={t('attachmentRemove')}
        loading={remove.isPending}
        onConfirm={() => { void confirmRemove() }}
      />
    </div>
  )
}
