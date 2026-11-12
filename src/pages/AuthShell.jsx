import Logo from '../components/Logo'

export default function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-full flex-col bg-navy-900 px-4 py-10 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-8 text-center">
          <Logo className="mx-auto h-14 w-14" />
          <p className="mt-3 text-2xl font-bold tracking-tight text-white">Handover</p>
          <p className="mt-1 text-sm text-slate-400">Keep every shift on the same page</p>
        </div>
        <div className="card p-6">
          <h1 className="text-lg font-semibold text-navy-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        {footer && <div className="mt-6 text-center text-sm text-slate-400">{footer}</div>}
        <p className="mt-6 text-center text-xs text-slate-500">
          <a href="/privacy" className="hover:text-slate-300 hover:underline">Privacy Policy</a>
          <span aria-hidden="true"> · </span>
          <a href="/terms" className="hover:text-slate-300 hover:underline">Terms of Use</a>
        </p>
      </div>
    </div>
  )
}
