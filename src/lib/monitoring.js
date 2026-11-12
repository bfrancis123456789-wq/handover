// Error monitoring with Sentry. Does nothing unless VITE_SENTRY_DSN is set.
// Privacy: no names, emails, message text or sign-in tokens leave the device.
// Only the error, a stack trace, the page path and the account id are sent.
import * as Sentry from '@sentry/react'

const dsn = import.meta.env.VITE_SENTRY_DSN

// Sign-in links put tokens in the address (after # or ?), so strip both.
const scrubUrl = (url) => (typeof url === 'string' ? url.split(/[?#]/)[0] : url)

export function initMonitoring() {
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE || undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeBreadcrumb(crumb) {
      if (crumb.category === 'console') return null // may contain message text
      if (crumb.data?.url) crumb.data.url = scrubUrl(crumb.data.url)
      if (crumb.data?.from) crumb.data.from = scrubUrl(crumb.data.from)
      if (crumb.data?.to) crumb.data.to = scrubUrl(crumb.data.to)
      return crumb
    },
    beforeSend(event) {
      if (event.request) {
        event.request.url = scrubUrl(event.request.url)
        delete event.request.cookies
        delete event.request.headers
        delete event.request.query_string
      }
      if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined
      return event
    },
  })
  // Lets the end-to-end tests check that reporting works (development builds only).
  if (import.meta.env.DEV) window.__handoverSentry = Sentry
}

export function setMonitoringUser(id) {
  if (dsn) Sentry.setUser(id ? { id } : null)
}

export const ErrorBoundary = Sentry.ErrorBoundary
