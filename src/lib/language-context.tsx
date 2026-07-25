'use client'

import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'
import { translations, interpolate, type Lang, type TranslationKey } from './translations'

interface LanguageContextType {
  lang: Lang
  dir: 'rtl' | 'ltr'
  setLang: (lang: Lang) => void
  toggleLang: () => void
}

const LanguageContext = createContext<LanguageContextType>({
  lang: 'ar',
  dir: 'rtl',
  setLang: () => {},
  toggleLang: () => {},
})

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    if (typeof window === 'undefined') return 'ar'
    const saved = localStorage.getItem('app-lang') as Lang | null
    return saved === 'ar' || saved === 'en' ? saved : 'ar'
  })

  useEffect(() => {
    const dir = lang === 'ar' ? 'rtl' : 'ltr'
    document.documentElement.setAttribute('dir', dir)
    document.documentElement.setAttribute('lang', lang)
    localStorage.setItem('app-lang', lang)
  }, [lang])

  function setLang(newLang: Lang) {
    setLangState(newLang)
  }

  function toggleLang() {
    setLangState(prev => prev === 'ar' ? 'en' : 'ar')
  }

  const dir = lang === 'ar' ? 'rtl' : 'ltr'

  return (
    <LanguageContext.Provider value={{ lang, dir, setLang, toggleLang }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  return useContext(LanguageContext)
}

/**
 * Translate a key, optionally filling `{placeholders}`.
 *
 *   t('greeting')                      -> "مرحباً"
 *   t('balanceLow', { name, days: 3 }) -> "رصيد أحمد منخفض (3 يوم)"
 *
 * Interpolation exists so sentences with values in them can live in translations.ts
 * like every other string, instead of being written twice inline as
 * `lang === 'ar' ? \`...\` : \`...\``. Word ORDER differs between Arabic and English,
 * which is exactly why the placeholder has to sit inside the translated string rather
 * than being concatenated around it.
 *
 * A placeholder with no matching value is left untouched, so a missing argument shows
 * up as a visible `{name}` rather than silently rendering "undefined".
 */
export function useT() {
  const { lang } = useLanguage()
  return (key: TranslationKey, vars?: Record<string, string | number>) =>
    interpolate(translations[key]?.[lang] || key, vars)
}
