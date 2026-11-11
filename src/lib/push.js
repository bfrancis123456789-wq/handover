import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true

export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

async function currentSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

// One of: 'on' | 'off' | 'denied' | 'ios-install' | 'unsupported' | 'not-configured'
export async function pushStatus() {
  if (isIos() && !isStandalone()) return 'ios-install'
  if (!pushSupported()) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'not-configured'
  if (Notification.permission === 'denied') return 'denied'
  const sub = await currentSubscription()
  return sub && Notification.permission === 'granted' ? 'on' : 'off'
}

async function save(sub) {
  const json = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys.p256dh,
    p_auth: json.keys.auth,
    p_user_agent: navigator.userAgent,
  })
  if (error) throw error
}

export async function enablePush() {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'
  const reg = await navigator.serviceWorker.register('/sw.js')
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }))
  await save(sub)
  return 'on'
}

export async function disablePush() {
  const sub = await currentSubscription()
  if (!sub) return 'off'
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe().catch(() => {})
  return 'off'
}

// Re-save this device's subscription after sign-in, in case the browser rotated
// it or the device was last used by someone else.
export async function syncPushSubscription() {
  try {
    if (!VAPID_PUBLIC_KEY || !pushSupported() || Notification.permission !== 'granted') return
    const sub = await currentSubscription()
    if (sub) await save(sub)
  } catch {
    /* not critical */
  }
}

// Stop notifications to this device for the person signing out.
export async function forgetDevice() {
  try {
    const sub = await currentSubscription()
    if (sub) await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  } catch {
    /* not critical */
  }
}
