'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useLanguage, useT } from '@/lib/language-context'

export default function NotFound() {
  const t = useT()
  const { dir } = useLanguage()
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" dir={dir}>
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <p className="text-lg text-muted-foreground">{t('pageNotFound')}</p>
        <div className="flex gap-3 justify-center">
          <Link href="/"><Button>{t('dashboard')}</Button></Link>
          <Link href="/employee-login"><Button variant="outline">{t('employeePortal')}</Button></Link>
        </div>
      </div>
    </div>
  )
}
