'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock, User, Eye, EyeOff, CalendarDays, ClipboardCheck } from 'lucide-react'
import { useLanguage, useT } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'

export default function EmployeeLoginPage() {
  const router = useRouter()
  const t = useT()
  const { dir, lang } = useLanguage()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/employee-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || t('error'))
        setLoading(false)
        return
      }

      // Store employee info in sessionStorage for the client pages
      try {
        sessionStorage.setItem('emp-user', JSON.stringify(data.user))
      } catch {
        // sessionStorage blocked — store in cookie as fallback
        document.cookie = `emp-user=${encodeURIComponent(JSON.stringify(data.user))};path=/;max-age=43200`
      }
      window.location.href = '/check-in'
    } catch (err) {
      setError(t('error'))
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4" dir={dir}>
      <div className="absolute top-4 left-4">
        <LanguageToggle />
      </div>

      <Card className="w-full max-w-md border-0 shadow-2xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-16 h-16 rounded-full bg-[#1976D2]/10 flex items-center justify-center mb-4">
            <User className="h-8 w-8 text-[#1976D2]" />
          </div>
          <CardTitle className="text-xl">
            {lang === 'ar' ? 'بوابة الموظف' : 'Employee Portal'}
          </CardTitle>
          <p className="text-muted-foreground text-sm mt-1">{t('loginSubtitle')}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('username')}</Label>
              <div className="relative">
                <User className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={username}
                  onChange={e => setUsername(e.target.value.trim().toLowerCase())}
                  placeholder={t('enterUsername')}
                  className="ps-10"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('password')}</Label>
              <div className="relative">
                <Lock className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('enterPassword')}
                  className="ps-10 pe-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <div className="text-sm text-rose-500 bg-rose-500/10 p-3 rounded-lg text-center">{error}</div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('loggingIn') : t('login')}
            </Button>
          </form>

          {/* Quick links after login */}
          <div className="mt-6 pt-4 border-t">
            <p className="text-xs text-muted-foreground text-center mb-3">
              {lang === 'ar' ? 'بعد تسجيل الدخول يمكنك:' : 'After login you can:'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/30 text-sm">
                <ClipboardCheck className="h-4 w-4 text-emerald-500" />
                <span>{t('checkInBtn')}</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-accent/30 text-sm">
                <CalendarDays className="h-4 w-4 text-[#1976D2]" />
                <span>{t('applyLeave')}</span>
              </div>
            </div>
          </div>

        </CardContent>
      </Card>
    </div>
  )
}
