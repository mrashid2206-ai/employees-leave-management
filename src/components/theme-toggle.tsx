'use client'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { Moon, Sun } from 'lucide-react'
import { useT } from '@/lib/language-context'

export function ThemeToggle() {
  const t = useT()
  const { theme, setTheme } = useTheme()
  return (
    // Icon-only, so it needs a name. No aria-pressed: the theme is only known after
    // hydration, and a server/client attribute mismatch is worse than no state.
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8"
      aria-label={t('toggleDarkMode')}
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
    >
      <Sun aria-hidden="true" className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon aria-hidden="true" className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}
