'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Bell, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { useLanguage, useT } from '@/lib/language-context'
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  type EmpUser,
} from '../_hooks/use-portal'

interface PortalHeaderProps {
  empUser: EmpUser | null
  onLogout: () => void
}

/** Sticky top bar: avatar, notifications bell, theme/language toggles and logout. */
export function PortalHeader({ empUser, onLogout }: PortalHeaderProps) {
  const t = useT()
  const { lang } = useLanguage()
  const [showNotifs, setShowNotifs] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  const { data: notifications = [], refetch } = useNotifications()
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()

  const unreadCount = notifications.filter(n => !n.is_read).length

  function toggleNotifs() {
    // Refresh on open so the list is current without waiting for the next poll.
    if (!showNotifs) refetch()
    setShowNotifs(!showNotifs)
  }

  // Behave like any other popover: a tap elsewhere or Escape dismisses it. Escape hands
  // focus back to the bell so keyboard users aren't dropped at the top of the page.
  useEffect(() => {
    if (!showNotifs) return
    function onPointerDown(e: PointerEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setShowNotifs(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      setShowNotifs(false)
      bellRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [showNotifs])

  // Dates follow the chosen language and the company's clock, not the device's locale.
  const formatWhen = (iso: string) =>
    new Date(iso).toLocaleString(t('enUs'), { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' })

  return (
    <div className="bg-card/80 backdrop-blur-md border-b px-4 py-3 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-3">
        {empUser && (
          <>
            <div
              aria-hidden="true"
              className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center text-primary font-bold text-sm"
            >
              {empUser.name.charAt(0)}
            </div>
            <div>
              <p className="font-semibold text-sm">{empUser.name}</p>
              <p className="text-xs text-muted-foreground">@{empUser.username}</p>
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        <div className="relative" ref={containerRef}>
          <Button
            ref={bellRef}
            variant="ghost"
            size="icon"
            className="h-8 w-8 relative"
            onClick={toggleNotifs}
            aria-label={unreadCount > 0 ? t('notificationsWithUnread', { count: unreadCount }) : t('notifications2')}
            aria-expanded={showNotifs}
            aria-controls={panelId}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
            {unreadCount > 0 && (
              // The count is already in the button's label; this is the visual copy.
              <span
                aria-hidden="true"
                className="absolute -top-1 -end-1 min-w-4 h-4 px-1 bg-rose-500 rounded-full text-[10px] font-semibold text-white flex items-center justify-center"
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Button>
          {showNotifs && (
            <div
              id={panelId}
              role="region"
              aria-labelledby={`${panelId}-title`}
              className="absolute top-10 end-0 w-72 max-w-[calc(100vw-2rem)] bg-card border rounded-xl shadow-xl z-50 max-h-80 overflow-y-auto"
            >
              <div className="p-3 border-b flex items-center justify-between gap-2">
                <h2 id={`${panelId}-title`} className="text-sm font-semibold">{t('notifications2')}</h2>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline disabled:opacity-50"
                    disabled={markAllRead.isPending}
                    onClick={() => markAllRead.mutate()}
                  >
                    {t('markAllRead')}
                  </button>
                )}
              </div>
              {notifications.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground text-center">{t('noNotifications2')}</p>
              ) : (
                <ul>
                  {notifications.map(n => {
                    const body = (
                      <>
                        {!n.is_read && <span className="sr-only">{t('unreadNotification')}: </span>}
                        <span className="block text-sm">{lang === 'ar' ? (n.message_ar || n.message) : n.message}</span>
                        <span className="block text-xs text-muted-foreground mt-1">{formatWhen(n.created_at)}</span>
                      </>
                    )
                    return (
                      <li key={n.id} className="border-b last:border-b-0">
                        {n.is_read ? (
                          <div className="p-3">{body}</div>
                        ) : (
                          // Unread rows are the only actionable ones: activating marks it read.
                          <button
                            type="button"
                            className="w-full text-start p-3 bg-blue-500/5 hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring focus-visible:-outline-offset-2"
                            onClick={() => markRead.mutate(n.id)}
                          >
                            {body}
                          </button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
        <ThemeToggle />
        <LanguageToggle />
        <Button variant="ghost" size="sm" className="text-rose-500 text-xs" onClick={onLogout}>
          <LogOut className="h-3.5 w-3.5 me-1" aria-hidden="true" />
          {t('logout')}
        </Button>
      </div>
    </div>
  )
}
