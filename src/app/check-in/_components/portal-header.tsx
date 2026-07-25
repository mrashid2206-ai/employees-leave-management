'use client'

import { useState } from 'react'
import { Bell, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { useLanguage, useT } from '@/lib/language-context'
import { useMarkNotificationRead, useNotifications, type EmpUser } from '../_hooks/use-portal'

interface PortalHeaderProps {
  empUser: EmpUser | null
  onLogout: () => void
}

/** Sticky top bar: avatar, notifications bell, theme/language toggles and logout. */
export function PortalHeader({ empUser, onLogout }: PortalHeaderProps) {
  const t = useT()
  const { lang } = useLanguage()
  const [showNotifs, setShowNotifs] = useState(false)

  const { data: notifications = [], refetch } = useNotifications()
  const markRead = useMarkNotificationRead()

  const unreadCount = notifications.filter(n => !n.is_read).length

  function toggleNotifs() {
    // Refresh on open so the list is current without polling in an effect.
    if (!showNotifs) refetch()
    setShowNotifs(!showNotifs)
  }

  return (
    <div className="bg-card/80 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-3">
        {empUser && (
          <>
            <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm">
              {empUser.name.charAt(0)}
            </div>
            <div>
              <p className="font-semibold text-sm">{empUser.name}</p>
              <p className="text-[11px] text-muted-foreground">@{empUser.username}</p>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative">
          <Button variant="ghost" size="icon" className="h-8 w-8 relative" onClick={toggleNotifs}>
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-rose-500 rounded-full text-[9px] text-white flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Button>
          {showNotifs && (
            <div className="absolute top-10 end-0 w-72 bg-card border rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto">
              <div className="p-3 border-b">
                <p className="text-sm font-semibold">{lang === 'ar' ? 'الإشعارات' : 'Notifications'}</p>
              </div>
              {notifications.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">{lang === 'ar' ? 'لا توجد إشعارات' : 'No notifications'}</p>
              ) : (
                notifications.map(n => (
                  <div
                    key={n.id}
                    className={`p-3 border-b text-sm cursor-pointer hover:bg-accent/50 ${!n.is_read ? 'bg-blue-500/5' : ''}`}
                    onClick={() => { if (!n.is_read) markRead.mutate(n.id) }}
                  >
                    <p className="text-xs">{lang === 'ar' ? n.message_ar : n.message}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.created_at).toLocaleDateString()}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        <ThemeToggle />
        <LanguageToggle />
        <Button variant="ghost" size="sm" className="text-rose-500 text-xs" onClick={onLogout}>
          <LogOut className="h-3.5 w-3.5 ml-1" />
          {t('logout')}
        </Button>
      </div>
    </div>
  )
}
