// Brand icon: public/logo.png (made from public/brand/handover-app-icon.png).
export default function Logo({ className = 'h-9 w-9', withText = false, textClass = 'text-white' }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <img src="/logo.png" alt={withText ? '' : 'Handover'} className={className} />
      {withText && <span className={`text-lg font-bold tracking-tight ${textClass}`}>Handover</span>}
    </span>
  )
}
