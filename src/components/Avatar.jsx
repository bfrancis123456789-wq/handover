import { initials } from '../lib/format'

export default function Avatar({ name, url, size = 'h-10 w-10', textSize = 'text-sm' }) {
  if (url) return <img src={url} alt="" className={`${size} shrink-0 rounded-full object-cover ring-1 ring-slate-200`} />
  return (
    <span className={`${size} ${textSize} inline-flex shrink-0 items-center justify-center rounded-full bg-navy-800 font-semibold text-white`} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
