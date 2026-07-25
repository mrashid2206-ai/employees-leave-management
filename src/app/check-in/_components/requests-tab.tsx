'use client'

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Calendar, CalendarDays, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { useCalendarData, useCancelLeave, useMyRequests } from '../_hooks/use-portal'

interface RequestsTabProps {
  empId?: number
}

export function RequestsTab({ empId }: RequestsTabProps) {
  const t = useT()
  const { lang } = useLanguage()

  const [showCalendar, setShowCalendar] = useState(false)

  const { data: myRequests = [] } = useMyRequests(empId)
  const { data: calendar } = useCalendarData(showCalendar)
  const cancelLeave = useCancelLeave(empId)

  const calendarLeaves = calendar?.leaves ?? []
  const calendarHolidays = calendar?.holidays ?? []

  function getStatusBadge(status: string) {
    switch (status) {
      case 'approved': return <Badge className="bg-emerald-500/10 text-emerald-500 border-0 text-[11px]">{t('approved')}</Badge>
      case 'rejected': return <Badge className="bg-rose-500/10 text-rose-500 border-0 text-[11px]">{t('rejected')}</Badge>
      case 'cancelled': return <Badge className="bg-gray-500/10 text-gray-500 border-0 text-[11px]">{t('cancelled')}</Badge>
      default: return <Badge className="bg-amber-500/10 text-amber-500 border-0 text-[11px]">{t('pending')}</Badge>
    }
  }

  async function handleCancel(id: number) {
    try {
      await cancelLeave.mutateAsync(id)
      toast.success(t('requestCancelled'))
    } catch { toast.error(t('error')) }
  }

  const now = new Date()
  const monthHolidays = calendarHolidays.filter(h => {
    const [hy, hm] = h.date.split('-').map(Number)
    return hy === now.getFullYear() && hm === now.getMonth() + 1
  })
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const monthEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`
  const thisMonthLeaves = calendarLeaves.filter(l => l.end_date >= monthStart && l.start_date <= monthEnd)

  return (
    <div className="space-y-3 animate-in">
      {/* Calendar toggle */}
      <Button variant="outline" size="sm" className="w-full" onClick={() => setShowCalendar(!showCalendar)}>
        <Calendar className="h-3.5 w-3.5 mr-1.5" />
        {t('whoSOnLeave')}
      </Button>

      {showCalendar && (
        <div className="space-y-3">
          {/* Holidays this month */}
          {monthHolidays.length > 0 && (
            <>
              <h3 className="text-sm font-semibold text-purple-500 mt-2">{t('holidays')}</h3>
              {monthHolidays.map(h => (
                <Card key={h.id} className="border-0 shadow-md border-l-4 border-l-purple-500">
                  <CardContent className="p-3 flex items-center justify-between">
                    <span className="text-sm font-medium">{h.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">{h.date}</span>
                  </CardContent>
                </Card>
              ))}
            </>
          )}
          {thisMonthLeaves.length === 0 ? (
            <Card className="border-0 shadow-md">
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                <CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-30" />
                {t('noLeavesThisMonth')}
              </CardContent>
            </Card>
          ) : (
            thisMonthLeaves.map(l => (
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
          )}
        </div>
      )}

      {/* My Requests List */}
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
                    disabled={cancelLeave.isPending}
                    onClick={() => handleCancel(req.id)}
                  >
                    {t('cancelRequest')}
                  </Button>
                )}
              </CardContent>
            </Card>
          )
        })
      )}
    </div>
  )
}
