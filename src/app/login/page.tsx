'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock, User, Eye, EyeOff } from 'lucide-react'
import { useLanguage, useT } from '@/lib/language-context'
import { LanguageToggle } from '@/components/language-toggle'

export default function LoginPage() {
  const t = useT()
  const { dir } = useLanguage()
  const router = useRouter()
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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'حدث خطأ')
        setLoading(false)
        return
      }

      window.location.href = '/'
    } catch {
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
            <Lock className="h-8 w-8 text-[#1976D2]" />
          </div>
          <CardTitle className="text-2xl">{t('appTitle')}</CardTitle>
          <p className="text-muted-foreground text-sm mt-1">{t('loginSubtitle')}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('username')}</Label>
              <div className="relative">
                <User className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder={t('enterUsername')}
                  className="pr-10"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('password')}</Label>
              <div className="relative">
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={t('enterPassword')}
                  className="pr-10 pl-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {error && (
              <div className="text-sm text-[#F44336] bg-[#F44336]/10 p-3 rounded-lg text-center">
                {error}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? t('loggingIn') : t('login')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
