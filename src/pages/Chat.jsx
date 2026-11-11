import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useUnread } from '../context/UnreadContext'
import { supabase } from '../lib/supabase'
import { canAccess, channelById } from '../lib/constants'
import { compressImage, fileExtension } from '../lib/images'
import { dayLabel, messageTime } from '../lib/format'
import Avatar from '../components/Avatar'
import RoleBadge from '../components/RoleBadge'
import ImageViewer from '../components/ImageViewer'
import Notice from '../components/Notice'
import Spinner from '../components/Spinner'
import { ArrowDownIcon, ChatIcon, HashIcon, HeartIcon, ImageIcon, LockIcon, SendIcon, TrashIcon, XIcon } from '../components/Icons'

const MESSAGE_SELECT = 'id, channel, content, image_url, created_at, author_id, author:profiles!messages_author_id_fkey(id, display_name, avatar_url, role), likes(user_id)'
const PAGE_SIZE = 50
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// Signed URLs for private message photos, cached for the session.
const urlCache = new Map()
async function signPaths(paths) {
  const missing = [...new Set(paths.filter((p) => p && !urlCache.has(p)))]
  if (missing.length) {
    const { data } = await supabase.storage.from('message-images').createSignedUrls(missing, 60 * 60 * 6)
    data?.forEach((d) => d.signedUrl && urlCache.set(d.path, d.signedUrl))
  }
  return Object.fromEntries(paths.filter(Boolean).map((p) => [p, urlCache.get(p)]))
}

const byTime = (a, b) => a.created_at.localeCompare(b.created_at)

function MessageCard({ message, imageUrl, me, canDelete, onLike, onOpenImage, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const author = message.author
  const liked = message.likes.some((l) => l.user_id === me)
  const count = message.likes.length

  async function remove() {
    setDeleting(true)
    const ok = await onDelete(message)
    if (!ok) { setDeleting(false); setConfirming(false) }
  }

  return (
    <article className="card group flex gap-3 p-3.5 sm:p-4">
      <Avatar name={author?.display_name ?? '?'} url={author?.avatar_url} />
      <div className="min-w-0 flex-1">
        <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-navy-900">{author?.display_name ?? 'Former member'}</span>
          {author && <RoleBadge role={author.role} />}
          <time className="text-xs text-slate-400" dateTime={message.created_at}>{messageTime(message.created_at)}</time>
        </header>
        {message.content && (
          <p className="mt-1 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800">{message.content}</p>
        )}
        {message.image_url && (
          <button type="button" onClick={() => imageUrl && onOpenImage(imageUrl)} className="mt-2 block overflow-hidden rounded-xl ring-1 ring-slate-200" aria-label="Open photo full screen">
            {imageUrl ? (
              <img src={imageUrl} alt="" loading="lazy" className="max-h-80 w-auto max-w-full object-cover" />
            ) : (
              <span className="flex h-40 w-56 max-w-full items-center justify-center bg-slate-100"><Spinner className="h-5 w-5 text-slate-400" /></span>
            )}
          </button>
        )}
        {confirming ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-red-50 p-2.5 ring-1 ring-inset ring-red-200">
            <span className="text-sm font-medium text-red-800">Delete this message for everyone?</span>
            <button type="button" className="btn-danger px-3 py-1.5 text-xs" onClick={remove} disabled={deleting}>{deleting ? 'Deleting…' : 'Delete'}</button>
            <button type="button" className="btn-secondary px-3 py-1.5 text-xs" onClick={() => setConfirming(false)} disabled={deleting}>Cancel</button>
          </div>
        ) : (
          <div className="mt-2 flex items-center gap-1">
            <button
              type="button"
              onClick={() => onLike(message, liked)}
              aria-pressed={liked}
              aria-label={liked ? 'Unlike' : 'Like'}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold transition ${
                liked ? 'bg-teal-soft text-teal-dark' : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              <HeartIcon className="h-4 w-4" fill={liked ? 'currentColor' : 'none'} />
              <span className="tabular-nums">{count > 0 ? count : 'Like'}</span>
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => setConfirming(true)}
                aria-label="Delete message"
                title="Delete message"
                className="ml-auto rounded-full p-1.5 text-slate-400 transition hover:bg-red-50 hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}

function EmptyState({ channel }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-16 text-center">
      <span className="rounded-2xl bg-teal-soft p-4 text-teal-dark"><ChatIcon className="h-8 w-8" /></span>
      <p className="mt-4 text-lg font-semibold text-navy-900">No messages in {channel.name} yet</p>
      <p className="mt-1 max-w-xs text-sm text-slate-500">Be the first to post. Share a shift update, a question or a photo.</p>
    </div>
  )
}

export default function Chat() {
  const { channelId } = useParams()
  const { profile } = useAuth()
  const { markRead } = useUnread()
  const channel = channelById(channelId)
  const allowed = channel && canAccess(channelId, profile.role)

  const [messages, setMessages] = useState([])
  const [imageUrls, setImageUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [hasOlder, setHasOlder] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [newBelow, setNewBelow] = useState(0)
  const [viewer, setViewer] = useState(null)

  const [text, setText] = useState('')
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [posting, setPosting] = useState(false)
  const [postError, setPostError] = useState('')

  const feedRef = useRef(null)
  const fileRef = useRef(null)
  const textRef = useRef(null)
  const stickToBottom = useRef(true)
  const keepOffset = useRef(null) // distance from bottom to restore after loading older messages

  const addMessages = useCallback(async (rows, { replace = false } = {}) => {
    const urls = await signPaths(rows.map((r) => r.image_url))
    setImageUrls((prev) => ({ ...prev, ...urls }))
    setMessages((prev) => {
      if (replace) return [...rows].sort(byTime)
      const seen = new Set(prev.map((m) => m.id))
      return [...prev, ...rows.filter((r) => !seen.has(r.id))].sort(byTime)
    })
  }, [])

  const fetchPage = useCallback((before) => {
    let q = supabase
      .from('messages')
      .select(MESSAGE_SELECT)
      .eq('workplace_id', profile.workplace_id)
      .eq('channel', channelId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    if (before) q = q.lt('created_at', before)
    return q
  }, [profile.workplace_id, channelId])

  // Initial load
  useEffect(() => {
    if (!allowed) return
    let active = true
    setLoading(true)
    setLoadError('')
    setMessages([])
    setNewBelow(0)
    stickToBottom.current = true
    fetchPage().then(async ({ data, error }) => {
      if (!active) return
      if (error) setLoadError('Messages could not be loaded. Check your connection and refresh.')
      else {
        setHasOlder((data ?? []).length === PAGE_SIZE)
        await addMessages(data ?? [], { replace: true })
      }
      if (active) setLoading(false)
    })
    markRead(channelId)
    return () => { active = false }
  }, [allowed, channelId, fetchPage, addMessages, markRead])

  async function loadOlder() {
    if (!messages.length) return
    setLoadingOlder(true)
    const el = feedRef.current
    keepOffset.current = el.scrollHeight - el.scrollTop
    const { data } = await fetchPage(messages[0].created_at)
    setHasOlder((data ?? []).length === PAGE_SIZE)
    await addMessages(data ?? [])
    setLoadingOlder(false)
  }

  // Live updates
  useEffect(() => {
    if (!allowed) return
    const sub = supabase
      .channel(`feed-${profile.workplace_id}-${channelId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `workplace_id=eq.${profile.workplace_id}` }, async ({ new: row }) => {
        if (row.channel !== channelId) return
        const { data } = await supabase.from('messages').select(MESSAGE_SELECT).eq('id', row.id).maybeSingle()
        if (!data) return
        if (!stickToBottom.current && data.author_id !== profile.id) setNewBelow((n) => n + 1)
        addMessages([data])
        if (document.visibilityState === 'visible') markRead(channelId)
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages' }, ({ old }) => {
        setMessages((prev) => prev.filter((m) => m.id !== old.id))
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'likes' }, ({ new: like }) => {
        setMessages((prev) => prev.map((m) =>
          m.id === like.message_id && !m.likes.some((l) => l.user_id === like.user_id)
            ? { ...m, likes: [...m.likes, { user_id: like.user_id }] }
            : m))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'likes' }, ({ old: like }) => {
        setMessages((prev) => prev.map((m) =>
          m.id === like.message_id ? { ...m, likes: m.likes.filter((l) => l.user_id !== like.user_id) } : m))
      })
      .subscribe()
    return () => { supabase.removeChannel(sub) }
  }, [allowed, channelId, profile.workplace_id, profile.id, addMessages, markRead])

  // Keep the newest message in view unless the reader has scrolled up;
  // keep the reader's place when older messages are added above.
  useLayoutEffect(() => {
    const el = feedRef.current
    if (!el) return
    if (keepOffset.current != null) {
      el.scrollTop = el.scrollHeight - keepOffset.current
      keepOffset.current = null
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, loading])

  function onScroll() {
    const el = feedRef.current
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (stickToBottom.current && newBelow) setNewBelow(0)
  }

  function jumpToLatest() {
    const el = feedRef.current
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    stickToBottom.current = true
    setNewBelow(0)
  }

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview])

  function pickFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) return setPostError('Choose a photo (JPG, PNG, WebP or GIF).')
    if (f.size > 20 * 1024 * 1024) return setPostError('That photo is too large. Choose one under 20 MB.')
    setPostError('')
    setFile(f)
    setPreview(URL.createObjectURL(f))
  }

  function clearFile() {
    setFile(null)
    setPreview(null)
  }

  async function toggleLike(message, liked) {
    const me = profile.id
    setMessages((prev) => prev.map((m) => m.id !== message.id ? m : {
      ...m,
      likes: liked ? m.likes.filter((l) => l.user_id !== me) : [...m.likes, { user_id: me }],
    }))
    const { error } = liked
      ? await supabase.from('likes').delete().eq('message_id', message.id).eq('user_id', me)
      : await supabase.from('likes').insert({ message_id: message.id, user_id: me })
    if (error && error.code !== '23505') {
      setMessages((prev) => prev.map((m) => m.id !== message.id ? m : { ...m, likes: message.likes }))
    }
  }

  async function deleteMessage(message) {
    const { error, count } = await supabase.from('messages').delete({ count: 'exact' }).eq('id', message.id)
    if (error || count === 0) {
      setPostError('That message could not be deleted. Try again.')
      return false
    }
    if (message.image_url) supabase.storage.from('message-images').remove([message.image_url])
    setMessages((prev) => prev.filter((m) => m.id !== message.id))
    return true
  }

  async function post(e) {
    e?.preventDefault()
    const content = text.trim()
    if (!content && !file) return
    setPosting(true)
    setPostError('')

    let imagePath = null
    if (file) {
      const upload = await compressImage(file)
      if (upload.size > MAX_IMAGE_BYTES) {
        setPosting(false)
        return setPostError('That photo is still over 10 MB after resizing. Choose a smaller one.')
      }
      imagePath = `${profile.workplace_id}/${channelId}/${crypto.randomUUID()}.${fileExtension(upload)}`
      const { error } = await supabase.storage.from('message-images').upload(imagePath, upload, { contentType: upload.type })
      if (error) {
        setPosting(false)
        return setPostError('The photo could not be uploaded. Try again.')
      }
    }

    const { data, error } = await supabase
      .from('messages')
      .insert({ workplace_id: profile.workplace_id, channel: channelId, author_id: profile.id, content, image_url: imagePath })
      .select(MESSAGE_SELECT)
      .single()
    setPosting(false)
    if (error) return setPostError('Your message was not posted. Check your connection and try again.')

    stickToBottom.current = true
    setNewBelow(0)
    await addMessages([data])
    setText('')
    clearFile()
    if (textRef.current) textRef.current.style.height = ''
  }

  function onKeyDown(e) {
    const touch = window.matchMedia('(pointer: coarse)').matches
    if (e.key === 'Enter' && !e.shiftKey && !touch) {
      e.preventDefault()
      post()
    }
  }

  function autoGrow(e) {
    setText(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  if (!allowed) return <Navigate to="/" replace />

  const Icon = channel.roles.length < 3 ? LockIcon : HashIcon
  const isManager = profile.role === 'manager'

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <span className="rounded-lg bg-teal-soft p-2 text-teal-dark"><Icon className="h-4 w-4" /></span>
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-navy-900">{channel.name}</h1>
          <p className="truncate text-xs text-slate-500">{channel.blurb}</p>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div ref={feedRef} onScroll={onScroll} className="h-full overflow-y-auto">
          {loading ? (
            <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6 text-teal-brand" /></div>
          ) : loadError ? (
            <div className="p-4"><Notice kind="error">{loadError}</Notice></div>
          ) : messages.length === 0 ? (
            <EmptyState channel={channel} />
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-3 px-3 py-4 sm:px-6">
              {hasOlder && (
                <button type="button" onClick={loadOlder} disabled={loadingOlder} className="btn-secondary self-center px-3 py-1.5 text-xs">
                  {loadingOlder ? <Spinner className="h-3.5 w-3.5" /> : null}
                  {loadingOlder ? 'Loading…' : 'Show earlier messages'}
                </button>
              )}
              {messages.map((m, i) => {
                const day = dayLabel(m.created_at)
                const showDay = i === 0 || dayLabel(messages[i - 1].created_at) !== day
                return (
                  <Fragment key={m.id}>
                    {showDay && (
                      <div className="flex items-center gap-3 py-1 text-xs font-semibold text-slate-400" role="separator">
                        <span className="h-px flex-1 bg-slate-200" />{day}<span className="h-px flex-1 bg-slate-200" />
                      </div>
                    )}
                    <MessageCard
                      message={m}
                      imageUrl={imageUrls[m.image_url]}
                      me={profile.id}
                      canDelete={m.author_id === profile.id || isManager}
                      onLike={toggleLike}
                      onOpenImage={setViewer}
                      onDelete={deleteMessage}
                    />
                  </Fragment>
                )
              })}
            </div>
          )}
        </div>
        {newBelow > 0 && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="btn-primary absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-xs shadow-lg"
          >
            <ArrowDownIcon className="h-4 w-4" /> {newBelow} new message{newBelow === 1 ? '' : 's'}
          </button>
        )}
      </div>

      <form onSubmit={post} className="border-t border-slate-200 bg-white px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto max-w-3xl">
          {postError && <div className="mb-2"><Notice kind="error">{postError}</Notice></div>}
          {preview && (
            <div className="relative mb-2 inline-block">
              <img src={preview} alt="Attachment preview" className="h-24 w-auto max-w-[60vw] rounded-lg object-cover ring-1 ring-slate-200" />
              <button type="button" onClick={clearFile} className="absolute -right-2 -top-2 rounded-full bg-navy-900 p-1 text-white shadow" aria-label="Remove photo">
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <input ref={fileRef} id="chat-image" type="file" accept="image/*" className="hidden" onChange={pickFile} />
            <button type="button" onClick={() => fileRef.current?.click()} className="shrink-0 rounded-lg p-2.5 text-slate-500 hover:bg-slate-100 hover:text-teal-dark" aria-label="Attach a photo">
              <ImageIcon />
            </button>
            <label htmlFor="chat-text" className="sr-only">Message {channel.name}</label>
            <textarea
              id="chat-text"
              ref={textRef}
              rows={1}
              value={text}
              onChange={autoGrow}
              onKeyDown={onKeyDown}
              placeholder={`Message ${channel.name}`}
              maxLength={4000}
              className="input min-h-[42px] resize-none py-2.5"
            />
            <button type="submit" className="btn-primary shrink-0" disabled={posting || (!text.trim() && !file)}>
              {posting ? <Spinner /> : <SendIcon className="h-4 w-4" />}
              Post
            </button>
          </div>
        </div>
      </form>

      {viewer && <ImageViewer src={viewer} onClose={() => setViewer(null)} />}
    </div>
  )
}
