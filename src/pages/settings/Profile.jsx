import { useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'
import { compressImage, fileExtension } from '../../lib/images'
import Avatar from '../../components/Avatar'
import RoleBadge from '../../components/RoleBadge'
import PageHeader from '../../components/PageHeader'
import Notice from '../../components/Notice'
import { CameraIcon } from '../../components/Icons'

export default function Profile() {
  const { profile, workplace, user, updateProfileLocal } = useAuth()
  const [name, setName] = useState(profile.display_name)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [msg, setMsg] = useState({ kind: 'success', text: '' })
  const fileRef = useRef(null)

  async function saveName(e) {
    e.preventDefault()
    const display_name = name.trim()
    if (display_name.length < 2) return setMsg({ kind: 'error', text: 'Enter a display name with at least 2 characters.' })
    setSaving(true)
    const { error } = await supabase.from('profiles').update({ display_name }).eq('id', profile.id)
    setSaving(false)
    if (error) return setMsg({ kind: 'error', text: 'Your name was not saved. Try again.' })
    updateProfileLocal({ display_name })
    setMsg({ kind: 'success', text: 'Display name saved.' })
  }

  async function uploadPhoto(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return setMsg({ kind: 'error', text: 'Choose a photo (JPG, PNG, WebP or GIF).' })
    setUploading(true)
    setMsg({ kind: 'success', text: '' })
    const file = await compressImage(f, 512, 0.85)
    if (file.size > 5 * 1024 * 1024) {
      setUploading(false)
      return setMsg({ kind: 'error', text: 'That photo is too large. Choose one under 5 MB.' })
    }
    const path = `${user.id}/avatar-${Date.now()}.${fileExtension(file)}`
    const { error } = await supabase.storage.from('avatars').upload(path, file, { contentType: file.type, upsert: true })
    if (error) {
      setUploading(false)
      return setMsg({ kind: 'error', text: 'The photo could not be uploaded. Try again.' })
    }
    const { data } = supabase.storage.from('avatars').getPublicUrl(path)
    const { error: saveError } = await supabase.from('profiles').update({ avatar_url: data.publicUrl }).eq('id', profile.id)
    setUploading(false)
    if (saveError) return setMsg({ kind: 'error', text: 'The photo was uploaded but not saved to your profile. Try again.' })
    updateProfileLocal({ avatar_url: data.publicUrl })
    setMsg({ kind: 'success', text: 'Profile photo updated.' })
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader title="My Profile" subtitle="How your team sees you in Handover." />
      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-4">
          <div className="relative">
            <Avatar name={profile.display_name} url={profile.avatar_url} size="h-20 w-20" textSize="text-2xl" />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 rounded-full bg-teal-brand p-2 text-white shadow ring-2 ring-white hover:bg-teal-dark disabled:opacity-60"
              aria-label="Upload profile photo"
            >
              <CameraIcon className="h-4 w-4" />
            </button>
            <input ref={fileRef} id="avatar-file" type="file" accept="image/*" className="hidden" onChange={uploadPhoto} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-navy-900">{profile.display_name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
              <RoleBadge role={profile.role} />
              <span>at {workplace?.name}</span>
            </div>
            {uploading && <p className="mt-1 text-xs text-slate-500">Uploading photo…</p>}
          </div>
        </div>

        <form onSubmit={saveName} className="mt-6 space-y-4 border-t border-slate-100 pt-6">
          <div>
            <label htmlFor="profile-name" className="label">Display name</label>
            <input id="profile-name" className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="label">Role</dt>
              <dd><RoleBadge role={profile.role} /> <span className="ml-1 text-xs text-slate-500">Only a manager can change this.</span></dd>
            </div>
            <div>
              <dt className="label">Workplace</dt>
              <dd className="text-sm text-slate-800">{workplace?.name}</dd>
            </div>
          </dl>
          <Notice kind={msg.kind}>{msg.text}</Notice>
          <button className="btn-primary" disabled={saving || name.trim() === profile.display_name}>{saving ? 'Saving…' : 'Save changes'}</button>
        </form>
      </div>
    </div>
  )
}
