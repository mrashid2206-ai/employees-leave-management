'use client'

import { Button } from '@/components/ui/button'
import { useLanguage, useT } from '@/lib/language-context'

// The UI defaults to Arabic/RTL, so the crash screen must be translated and directioned
// too — otherwise an error drops the user into untranslated, mis-directioned English.
export default function Error({ reset }: { error: Error; reset: () => void }) {
  const t = useT()
  const { dir } = useLanguage()
  return (
    <div className="min-h-screen flex items-center justify-center bg-background" dir={dir}>
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold text-rose-500">{t('errorTitle')}</h1>
        <p className="text-muted-foreground">{t('somethingWentWrong')}</p>
        <Button onClick={reset}>{t('tryAgain')}</Button>
      </div>
    </div>
  )
}
