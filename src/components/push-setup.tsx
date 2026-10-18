'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Bell, BellOff } from 'lucide-react'
import { toast } from 'sonner'
import { useT } from '@/lib/language-context'

// VAPID keys arrive base64url-encoded; the Push API needs raw bytes.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

// Detach a subscription from this employee: server row first, while the session cookie
// still exists, then the browser side. If the DELETE fails, unsubscribing still makes the
// push service answer 410 for the endpoint, and pushToEmployee prunes it on the next send.
async function detach(sub: PushSubscription): Promise<void> {
  await fetch('/api/push/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: sub.endpoint }),
  }).catch(() => {})
  await sub.unsubscribe()
}

/**
 * Stop this device receiving the current employee's reminders. Called on logout: phones
 * are shared, and without this the next person to pick it up keeps getting the previous
 * employee's "you haven't checked in" pushes. Best-effort and time-boxed so logout can
 * never hang on a push service or a worker that never activated.
 */
export async function unsubscribeThisDevice(timeoutMs = 3000): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const work = (async () => {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager?.getSubscription()
    if (sub) await detach(sub)
  })().catch(() => {})
  await Promise.race([work, new Promise(resolve => setTimeout(resolve, timeoutMs))])
}

// Lets the employee opt in to push reminders. The service worker itself is registered by
// the portal layout (ServiceWorkerRegistration); this waits for it rather than registering
// again. Renders nothing when push isn't supported.
export function PushSetup() {
  const t = useT()
  const [supported, setSupported] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return

    navigator.serviceWorker.ready
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
        toast.error(t('pushNotConfigured'))
        setBusy(false)
        return
      }
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        toast.error(t('pushDenied'))
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
      toast.success(t('remindersEnabled'))
    } catch {
      toast.error(t('remindersEnableFailed'))
    }
    setBusy(false)
  }

  async function disablePush() {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) await detach(sub)
      setEnabled(false)
      toast.success(t('remindersDisabled'))
    } catch {
      toast.error(t('remindersDisableFailed'))
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
        ? (t('remindersTurnOff'))
        : (t('remindersTurnOn'))}
    </Button>
  )
}
