'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { getCorrections, reviewCorrectionRequest } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import { QueryError } from '@/components/query-error'

// Admin queue for employee-submitted attendance corrections. Approving applies the
// requested times to the attendance record (hours/overtime recomputed server-side).
export default function CorrectionsPage() {
  const t = useT()
  const { dir } = useLanguage()
  const queryClient = useQueryClient()

  const { data: corrections = [], isError, refetch } = useQuery({ queryKey: ['corrections'], queryFn: getCorrections })

  const reviewMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: 'approved' | 'rejected' }) => reviewCorrectionRequest(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['corrections'] })
      queryClient.invalidateQueries({ queryKey: ['attendance'] })
      toast.success(t('updatedSuccess'))
    },
    onError: () => toast.error(t('error')),
  })

  const pending = corrections.filter(c => c.status === 'pending')

  function statusBadge(status: string) {
    if (status === 'approved') return <Badge className="bg-emerald-500/10 text-emerald-500 border-0">{t('approved')}</Badge>
    if (status === 'rejected') return <Badge className="bg-rose-500/10 text-rose-500 border-0">{t('rejected')}</Badge>
    return <Badge className="bg-amber-500/10 text-amber-500 border-0">{t('pending')}</Badge>
  }

  return (
    <div className="space-y-6" dir={dir}>
      {isError && <QueryError onRetry={() => refetch()} />}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">{t('corrections')}</h1>
        {pending.length > 0 && (
          <Badge className="bg-amber-500 text-white border-0">
            {pending.length} {t('pending')}
          </Badge>
        )}
      </div>

      <Card className="border-0 shadow-lg">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-start">{t('name')}</TableHead>
                  <TableHead className="text-center">{t('date')}</TableHead>
                  <TableHead className="text-center">{t('checkIn')}</TableHead>
                  <TableHead className="text-center">{t('checkOut')}</TableHead>
                  <TableHead className="text-start">{t('reason')}</TableHead>
                  <TableHead className="text-center">{t('status')}</TableHead>
                  <TableHead className="text-center w-32">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {corrections.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">{t('noData')}</TableCell>
                  </TableRow>
                ) : corrections.map(c => (
                  <TableRow key={c.id} className={c.status === 'pending' ? '' : 'opacity-60'}>
                    <TableCell className="font-medium">{c.employee?.name}</TableCell>
                    <TableCell className="text-center font-mono">{c.date}</TableCell>
                    <TableCell className="text-center font-mono">{c.requested_check_in?.slice(0, 5) || '-'}</TableCell>
                    <TableCell className="text-center font-mono">{c.requested_check_out?.slice(0, 5) || '-'}</TableCell>
                    <TableCell className="max-w-xs truncate">{c.reason}</TableCell>
                    <TableCell className="text-center">{statusBadge(c.status)}</TableCell>
                    <TableCell className="text-center">
                      {c.status === 'pending' ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            size="sm"
                            className="h-7 bg-emerald-600 hover:bg-emerald-700"
                            disabled={reviewMutation.isPending}
                            onClick={() => reviewMutation.mutate({ id: c.id, status: 'approved' })}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-rose-500 hover:bg-rose-500/10"
                            disabled={reviewMutation.isPending}
                            onClick={() => reviewMutation.mutate({ id: c.id, status: 'rejected' })}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">{c.reviewed_by || '-'}</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
