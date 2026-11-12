import Logo from './Logo'

// Shown if something in the app breaks badly. The error has already been reported.
export default function CrashScreen() {
  return (
    <div className="flex min-h-full items-center justify-center bg-navy-900 px-4 py-10">
      <div className="card w-full max-w-sm p-6 text-center">
        <Logo className="mx-auto h-12 w-12" />
        <h1 className="mt-4 text-lg font-semibold text-navy-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-slate-600">Handover hit a problem and needs to reload. Your messages are safe.</p>
        <button className="btn-primary mt-5 w-full" onClick={() => window.location.reload()}>Reload Handover</button>
      </div>
    </div>
  )
}
