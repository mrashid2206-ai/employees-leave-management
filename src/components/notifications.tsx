'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Bell, AlertTriangle, Clock, CalendarOff } from 'lucide-react'
import { getEmployees, getLeaveRequests, getTardinessRecords, getSettings } from '@/lib/api'
import { useLanguage, useT } from '@/lib/language-context'
import { omanToday } from '@/lib/oman-date'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface Notification {
  id: string
  type: 'warning' | 'danger' | 'info'
  icon: typeof AlertTriangle
  message: string
}

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const t = useT()
  const { dir } = useLanguage()
  const { data: employees = [] } = useQuery({ queryKey: ['employees'], queryFn: getEmployees })
  const { data: leaves = [] } = useQuery({ queryKey: ['leaves'], queryFn: getLeaveRequests })
  const { data: tardiness = [] } = useQuery({ queryKey: ['tardiness'], queryFn: getTardinessRecords })
  const { data: settings } = useQuery({ queryKey: ['settings'], queryFn: getSettings })

  const notifications: Notification[] = []
  const today = omanToday()

  if (settings) {
    // Low balance warnings
    employees.filter(e => e.is_active).forEach(emp => {
      const remaining = emp.leave_balance

      if (remaining <= 3) {
        notifications.push({
          id: `low-${emp.id}`,
          type: 'danger',
          icon: AlertTriangle,
          message: t('balanceCriticallyLow', { name: emp.name, days: Math.round(remaining * 10) / 10 }),
        })
      } else if (remaining <= 7) {
        notifications.push({
          id: `warn-${emp.id}`,
          type: 'warning',
          icon: AlertTriangle,
          message: t('balanceLow', { name: emp.name, days: Math.round(remaining * 10) / 10 }),
        })
      }
    })

    // High tardiness warnings (>60 minutes total)
    employees.filter(e => e.is_active).forEach(emp => {
      const empTard = tardiness.filter(t => t.employee_id === emp.id)
      const totalMinutes = empTard.reduce((sum, t) => sum + t.minutes_late, 0)
      if (totalMinutes >= 60) {
        notifications.push({
          id: `tard-${emp.id}`,
          type: 'warning',
          icon: Clock,
          message: t('tardinessExceedsHour', { name: emp.name, minutes: totalMinutes }),
        })
      }
    })

    // Too many on leave today
    const onLeaveToday = leaves.filter(l => l.status === 'approved' && l.start_date <= today && l.end_date >= today)
    if (onLeaveToday.length >= 3) {
      notifications.push({
        id: 'many-leave',
        type: 'info',
        icon: CalendarOff,
        message: t('employeesOnLeaveToday', { count: onLeaveToday.length }),
      })
    }

    // Pending leave requests
    const pendingLeaves = leaves.filter(l => l.status === 'pending')
    if (pendingLeaves.length > 0) {
      notifications.push({
        id: 'pending',
        type: 'warning',
        icon: CalendarOff,
        message: t('leaveRequestsPending', { count: pendingLeaves.length }),
      })
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="relative" />}>
        <Bell className="h-5 w-5" />
        {notifications.length > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-[#F44336] text-white text-[10px] flex items-center justify-center font-bold">
            {notifications.length}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end" dir={dir}>
        <div className="p-3 border-b">
          <h3 className="font-bold text-sm">{t('notifications')} ({notifications.length})</h3>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {t('noNotifications')}
            </div>
          ) : (
            notifications.map(n => {
              const Icon = n.icon
              const colors = {
                danger: 'bg-[#F44336]/10 text-[#F44336]',
                warning: 'bg-[#FF9800]/10 text-[#FF9800]',
                info: 'bg-[#1976D2]/10 text-[#1976D2]',
              }
              return (
                <div key={n.id} className="flex items-start gap-3 p-3 border-b last:border-0 hover:bg-accent/50">
                  <div className={`rounded-full p-1.5 shrink-0 ${colors[n.type]}`}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <p className="text-sm leading-relaxed">{n.message}</p>
                </div>
              )
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
