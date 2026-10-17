// Service worker: makes the employee portal installable (PWA), shows an offline page
// instead of the browser's error screen, and receives push reminders.
//
// Deliberately network-first with NO asset or API caching — stale Next.js build assets
// and stale attendance/leave data cause harder bugs than the offline benefit is worth.
// The only thing served without the network is the small inline page below.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Inline rather than cached: nothing to precache, nothing to go stale between deploys,
// and it works even if the very first visit was the one that dropped offline. Bilingual
// because the worker can't know the employee's language choice.
const OFFLINE_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#1976D2">
<title>غير متصل · Offline</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
         font-family: system-ui, -apple-system, "Segoe UI", Tahoma, sans-serif;
         background: Canvas; color: CanvasText; padding: 1.5rem; box-sizing: border-box; }
  main { max-width: 22rem; text-align: center; }
  h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
  p { font-size: 1rem; line-height: 1.6; margin: 0 0 1rem; opacity: .8; }
  [lang="en"] { direction: ltr; }
  button { font: inherit; font-size: 1rem; padding: .6rem 1.4rem; border-radius: .6rem; border: 0;
           background: #1976D2; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<main>
  <h1>لا يوجد اتصال بالإنترنت</h1>
  <p>تحقق من اتصالك ثم أعد المحاولة. لا يمكن تسجيل الحضور أو الانصراف دون اتصال.</p>
  <h1 lang="en">You're offline</h1>
  <p lang="en">Check your connection and try again. Check-in and check-out need a connection.</p>
  <button type="button" onclick="location.reload()">إعادة المحاولة · Retry</button>
</main>
</body>
</html>`

// Only page navigations get a fallback. Every other request (API calls, scripts, images)
// is left to the browser untouched, so a failed API call still fails loudly in the app
// instead of being answered with HTML.
self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || request.mode !== 'navigate') return
  event.respondWith(
    fetch(request).catch(
      () => new Response(OFFLINE_HTML, {
        status: 503,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      })
    )
  )
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { title: 'Notification', body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'Employee Portal'
  const options = {
    body: payload.body || '',
    // PNG: several Android versions render nothing for an SVG notification icon.
    icon: '/icon-192.png',
    dir: 'auto',
    data: { url: payload.url || '/check-in' },
    tag: payload.tag || 'employee-portal',
    renotify: true,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/check-in'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(url) && 'focus' in client) return client.focus()
      }
      return self.clients.openWindow(url)
    })
  )
})
