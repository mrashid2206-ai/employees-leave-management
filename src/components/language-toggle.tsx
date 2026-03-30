'use client'

import { useLanguage } from '@/lib/language-context'
import { Button } from '@/components/ui/button'
import { Languages } from 'lucide-react'

export function LanguageToggle() {
  const { lang, toggleLang } = useLanguage()

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLang}
      className="gap-2 text-sm font-medium"
    >
      <Languages className="h-4 w-4" />
      {lang === 'ar' ? 'EN' : 'عربي'}
    </Button>
  )
}
