'use client'

import { Component, type ReactNode } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useLanguage, useT } from '@/lib/language-context'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

// Class components can't use hooks, so the fallback is its own function component —
// that's what lets the crash UI be translated and RTL-aware like the rest of the app.
function ErrorFallback({ message, onReload }: { message?: string; onReload: () => void }) {
  const t = useT()
  const { dir } = useLanguage()
  return (
    <Card className="border-0 shadow-lg m-6" dir={dir}>
      <CardContent className="p-8 text-center">
        <AlertTriangle className="h-12 w-12 text-amber-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold mb-2">{t('somethingWentWrong')}</h2>
        {message && <p className="text-muted-foreground mb-4 text-sm">{message}</p>}
        <Button onClick={onReload}>
          <RefreshCw className="h-4 w-4 me-2" />
          {t('reload')}
        </Button>
      </CardContent>
    </Card>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <ErrorFallback
          message={this.state.error?.message}
          onReload={() => { this.setState({ hasError: false }); window.location.reload() }}
        />
      )
    }

    return this.props.children
  }
}
