'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AlertTriangle, LogOut } from 'lucide-react'
import { toast } from 'sonner'
import { Toaster } from '@/components/ui/sonner'
import { useLanguage, useT } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'
import { ThemeToggle } from '@/components/theme-toggle'
import { AttendanceTab } from './_components/attendance-tab'
import { LeaveTab } from './_components/leave-tab'
import { PortalHeader } from './_components/portal-header'
import { PortalNav, type PortalTab } from './_components/portal-nav'
import { ProfileTab } from './_components/profile-tab'
import { RequestsTab } from './_components/requests-tab'
import { apiErrorPayload, useChangePassword, type EmpUser } from './_hooks/use-portal'

/**
 * Employee self-service portal shell. Owns only the session, the forced
 * password-change gate and which tab is showing — every tab fetches its own data
 * through the react-query hooks in `_hooks/use-portal`.
 */
export default function EmployeePortalPage() {
  const t = useT()
  const { dir } = useLanguage()

  const [activeTab, setActiveTab] = useState<PortalTab>('attendance')
  const [empUser, setEmpUser] = useState<EmpUser | null>(null)
  const [forcedPw, setForcedPw] = useState({ current_password: '', new_password: '', confirm_password: '' })

  const changePassword = useChangePassword()

  // The gate is derived from the session so clearing the flag (below) closes it.
  const mustChangePw = !!empUser?.must_change_password

  useEffect(() => {
    let cancelled = false
    // Try sessionStorage first (fast). The set is deferred to a microtask so the effect
    // body doesn't call setState synchronously (react-hooks/set-state-in-effect).
    let stored: string | null = null
    try { stored = sessionStorage.getItem('emp-user') } catch {}
    if (stored) {
      const raw = stored
      Promise.resolve().then(() => {
        if (cancelled) return
        try {
          setEmpUser(JSON.parse(raw) as EmpUser)
        } catch {}
      })
    } else {
      // Fallback: fetch from JWT cookie via API (works even if sessionStorage was cleared)
      fetch('/api/auth/employee-me')
        .then(r => r.ok ? r.json() : null)
        .then((data: { user?: EmpUser } | null) => {
          if (cancelled || !data?.user) return
          const user: EmpUser = {
            id: data.user.id,
            name: data.user.name,
            username: data.user.username,
            must_change_password: !!data.user.must_change_password,
          }
          setEmpUser(user)
          try { sessionStorage.setItem('emp-user', JSON.stringify(user)) } catch {}
        })
        .catch(() => {})
    }
    return () => { cancelled = true }
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/employee-logout', { method: 'POST' })
    sessionStorage.removeItem('emp-user')
    window.location.href = '/employee-login'
  }

  async function handleForcedChange() {
    if (!forcedPw.current_password || !forcedPw.new_password) { toast.error(t('fillRequired')); return }
    if (forcedPw.new_password !== forcedPw.confirm_password) {
      toast.error(t('passwordsDoNotMatch')); return
    }
    if (forcedPw.new_password.length < 6) {
      toast.error(t('passwordMustBeAtLeast')); return
    }
    try {
      await changePassword.mutateAsync({ current_password: forcedPw.current_password, new_password: forcedPw.new_password })
      toast.success(t('passwordChangedSuccessfully'))
      setForcedPw({ current_password: '', new_password: '', confirm_password: '' })
      // Clear the stale flag so it isn't re-triggered from cache.
      if (empUser) {
        const updated = { ...empUser, must_change_password: false }
        setEmpUser(updated)
        try { sessionStorage.setItem('emp-user', JSON.stringify(updated)) } catch {}
      }
    } catch (err) {
      toast.error(apiErrorPayload(err).error || t('error'))
    }
  }

  if (mustChangePw) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4" dir={dir}>
        <div className="absolute top-4 end-4 flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
          <Button variant="ghost" size="sm" className="text-rose-500 text-xs" onClick={handleLogout}>
            <LogOut className="h-3.5 w-3.5 ml-1" />
            {t('logout')}
          </Button>
        </div>
        <Card className="w-full max-w-md border-0 shadow-2xl">
          <CardContent className="p-6 space-y-4">
            <div className="text-center">
              <div className="mx-auto w-14 h-14 rounded-full bg-amber-500/10 flex items-center justify-center mb-3">
                <AlertTriangle className="h-7 w-7 text-amber-500" />
              </div>
              <h2 className="text-lg font-bold">{t('passwordChangeRequired')}</h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t('forYourSecuritySetA')}
              </p>
            </div>
            <Input
              type="password"
              placeholder={t('currentPassword')}
              value={forcedPw.current_password}
              onChange={e => setForcedPw(f => ({ ...f, current_password: e.target.value }))}
            />
            <Input
              type="password"
              placeholder={t('newPassword')}
              value={forcedPw.new_password}
              onChange={e => setForcedPw(f => ({ ...f, new_password: e.target.value }))}
            />
            <Input
              type="password"
              placeholder={t('confirmPassword')}
              value={forcedPw.confirm_password}
              onChange={e => setForcedPw(f => ({ ...f, confirm_password: e.target.value }))}
            />
            <Button className="w-full" disabled={changePassword.isPending} onClick={handleForcedChange}>
              {changePassword.isPending ? '...' : (t('changePassword'))}
            </Button>
          </CardContent>
        </Card>
        <Toaster position="top-center" dir={dir} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col" dir={dir}>
      <PortalHeader empUser={empUser} onLogout={handleLogout} />

      <div className="flex-1 overflow-auto p-4 pb-24 max-w-lg mx-auto w-full">
        {activeTab === 'attendance' && <AttendanceTab empId={empUser?.id} />}
        {activeTab === 'leave' && <LeaveTab empId={empUser?.id} onGoToRequests={() => setActiveTab('requests')} />}
        {activeTab === 'requests' && <RequestsTab empId={empUser?.id} />}
        {activeTab === 'profile' && <ProfileTab empId={empUser?.id} />}
      </div>

      <PortalNav activeTab={activeTab} onChange={setActiveTab} />

      <Toaster position="top-center" dir={dir} />
    </div>
  )
}
