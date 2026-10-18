'use client'

import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paperclip, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { useLanguage, useT } from '@/lib/language-context'
import {
  ATTACHMENT_ACCEPT,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_LEAVE,
  formatBytes,
  looksLikeAllowedFile,
} from '@/lib/attachments'

interface Attachment {
  id: number
  filename: string
  size_bytes: number
  uploaded_by_role: 'admin' | 'employee'
  created_at: string
}

async function readError(res: Response): Promise<string | undefined> {
  const data = await res.json().catch(() => null)
  return data?.error
}

/**
 * Admin view of a leave request's attachments: a paperclip with the count, opening a list
 * with download links. Admins may add or remove files whatever the request's status (an
 * employee only while it is pending; the server enforces both).
 */
export function LeaveAttachments({ leaveId, count = 0 }: { leaveId: number; count?: number }) {
  const t = useT()
  const { dir } = useLanguage()
  const queryClient = useQueryClient()
  const fileInput = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [removing, setRemoving] = useState<Attachment | null>(null)

  const listKey = ['leave-attachments', leaveId]
  const { data: attachments = [], isPending } = useQuery({
    queryKey: listKey,
    queryFn: async (): Promise<Attachment[]> => {
      const res = await fetch(`/api/leaves/${leaveId}/attachments`)
      if (!res.ok) throw new Error((await readError(res)) || t('error'))
      return res.json()
    },
    enabled: open,
  })

  // The count shown on the row comes from the leave lists, so refresh those too.
  function refresh() {
    queryClient.invalidateQueries({ queryKey: listKey })
    queryClient.invalidateQueries({ queryKey: ['leaves'] })
    queryClient.invalidateQueries({ queryKey: ['employee-leaves'] })
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch(`/api/leaves/${leaveId}/attachments`, { method: 'POST', body })
      if (!res.ok) throw new Error(`${file.name}: ${(await readError(res)) || t('error')}`)
    },
    onSettled: refresh,
  })

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/attachments/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await readError(res)) || t('error'))
    },
    onSettled: refresh,
  })

  async function addFiles(list: FileList | null) {
    if (!list) return
    let room = MAX_ATTACHMENTS_PER_LEAVE - attachments.length
    for (const file of Array.from(list)) {
      if (!looksLikeAllowedFile(file)) { toast.error(t('attachmentWrongType', { name: file.name })); continue }
      if (file.size > MAX_ATTACHMENT_BYTES) { toast.error(t('attachmentTooLarge', { name: file.name })); continue }
      if (room <= 0) { toast.error(t('attachmentTooMany', { max: MAX_ATTACHMENTS_PER_LEAVE })); break }
      try {
        await upload.mutateAsync(file)
        room--
        toast.success(t('attachmentUploaded'))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('error'))
      }
    }
  }

  async function confirmRemove() {
    if (!removing) return
    try {
      await remove.mutateAsync(removing.id)
      toast.success(t('attachmentDeleted'))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error'))
    } finally {
      setRemoving(null)
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={`h-7 gap-1 px-1.5 ${count > 0 ? 'text-primary' : 'text-muted-foreground/50'}`}
        aria-label={`${t('attachments')} (${count})`}
        title={t('attachments')}
        onClick={() => setOpen(true)}
      >
        <Paperclip className="h-3.5 w-3.5" />
        {count > 0 && <span className="text-xs">{count}</span>}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" dir={dir}>
          <DialogHeader>
            <DialogTitle>{t('attachments')}</DialogTitle>
          </DialogHeader>
          {isPending ? (
            <p className="text-sm text-muted-foreground">{t('loading')}</p>
          ) : attachments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('attachmentsNone')}</p>
          ) : (
            <ul className="space-y-2">
              {attachments.map(a => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  {/* The server answers with Content-Disposition: attachment, so this downloads. */}
                  <a href={`/api/attachments/${a.id}`} className="min-w-0 flex-1 truncate text-primary hover:underline" dir="auto">
                    {a.filename}
                  </a>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.size_bytes)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0 text-destructive hover:bg-destructive/10"
                    aria-label={`${t('attachmentRemove')}: ${a.filename}`}
                    onClick={() => setRemoving(a)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-1 pt-2">
            <input
              ref={fileInput}
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              hidden
              onChange={e => { void addFiles(e.target.files); e.target.value = '' }}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={upload.isPending || isPending || attachments.length >= MAX_ATTACHMENTS_PER_LEAVE}
              onClick={() => fileInput.current?.click()}
            >
              <Plus className="h-3.5 w-3.5 me-1.5" />
              {upload.isPending ? t('attachmentUploading') : t('attachCertificate')}
            </Button>
            <p className="text-[11px] text-muted-foreground">{t('attachmentsHint', { max: MAX_ATTACHMENTS_PER_LEAVE })}</p>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={o => { if (!o) setRemoving(null) }}
        title={t('attachmentRemove')}
        description={removing ? t('attachmentDeleteConfirm', { name: removing.filename }) : ''}
        confirmLabel={t('attachmentRemove')}
        loading={remove.isPending}
        onConfirm={() => { void confirmRemove() }}
      />
    </>
  )
}
