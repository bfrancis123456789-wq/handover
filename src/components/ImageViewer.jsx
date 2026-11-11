import { useEffect, useState } from 'react'
import { DownloadIcon, XIcon } from './Icons'

export default function ImageViewer({ src, onClose }) {
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch(src)
      const blob = await res.blob()
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `handover-photo-${Date.now()}.${ext}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch {
      window.open(src, '_blank', 'noopener')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95" role="dialog" aria-modal="true" aria-label="Photo">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onClose} className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white hover:bg-white/10" autoFocus>
          <XIcon /> Close
        </button>
        <button onClick={save} disabled={saving} className="btn-primary">
          <DownloadIcon className="h-4 w-4" /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" onClick={onClose}>
        <img src={src} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
      </div>
    </div>
  )
}
