// Handover service worker: shows push notifications and opens the right channel
// when one is tapped. It does not cache anything, so the app always loads fresh.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { title: 'Handover', body: event.data ? event.data.text() : '' }
  }
  const url = data.url || '/'

  event.waitUntil((async () => {
    // If someone already has that channel open and in front of them, don't buzz their phone.
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const watching = windows.some((w) => w.focused && w.visibilityState === 'visible' && new URL(w.url).pathname === url)
    if (watching) return

    await self.registration.showNotification(data.title || 'Handover', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/favicon.png',
      tag: data.tag,
      renotify: Boolean(data.tag),
      data: { url },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of windows) {
      if (new URL(w.url).origin === self.location.origin) {
        await w.focus()
        if ('navigate' in w) return w.navigate(target)
        return
      }
    }
    return self.clients.openWindow(target)
  })())
})
