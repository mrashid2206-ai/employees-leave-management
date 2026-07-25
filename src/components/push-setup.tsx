'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { useLanguage } from '@/lib/language-context'

// VAPID keys arrive base64url-encoded; the Push API needs raw bytes.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Registers the service worker (making the portal installable) and lets the employee
// opt in to push reminders. Renders nothing when push isn't supported or configured.
export function PushSetup() {
  const { lang } = useLanguage()
  const [supported, setSupported] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    navigator.serviceWorker.register('/sw.js')
      .then(async (reg) => {
        if (cancelled) return
        setSupported(true)
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled) setEnabled(!!sub && Notification.permission === 'granted')
      })
      .catch(() => {})

    return () => { cancelled = true }
  }, [])

  async function enablePush() {
    setBusy(true)
    try {
      const keyRes = await fetch('/api/push/subscribe')
      const { key } = await keyRes.json()
      if (!key) {
        toast.error(lang === 'ar' ? 'الإشعارات غير مفعّلة على الخادم' : 'Push is not configured on the server')
        setBusy(false)
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.error(lang === 'ar' ? 'تم رفض إذن الإشعارات' : 'Notification permission denied')
        setBusy(false)
        return
      }
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      })
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      })
      if (!res.ok) throw new Error()
      setEnabled(true)
      toast.success(lang === 'ar' ? 'تم تفعيل التذكيرات' : 'Reminders enabled')
    } catch {
      toast.error(lang === 'ar' ? 'تعذّر تفعيل التذكيرات' : 'Could not enable reminders')
    }
    setBusy(false)
  }

  async function disablePush() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe()
      }
      setEnabled(false)
      toast.success(lang === 'ar' ? 'تم إيقاف التذكيرات' : 'Reminders disabled')
    } catch {
      toast.error(lang === 'ar' ? 'تعذّر الإيقاف' : 'Could not disable reminders')
    }
    setBusy(false)
  }

  if (!supported) return null

  return (
    <Button
      variant="outline"
      size="sm"
      className="w-full"
      disabled={busy}
      onClick={enabled ? disablePush : enablePush}
    >
      {enabled ? <BellOff className="h-3.5 w-3.5 me-1.5" /> : <Bell className="h-3.5 w-3.5 me-1.5" />}
      {enabled
        ? (lang === 'ar' ? 'إيقاف تذكيرات الحضور' : 'Turn off check-in reminders')
        : (lang === 'ar' ? 'تفعيل تذكيرات الحضور' : 'Enable check-in reminders')}
    </Button>
  )
}
