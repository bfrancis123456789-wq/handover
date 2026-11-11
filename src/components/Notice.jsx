const styles = {
  error: 'bg-red-50 text-red-700 ring-red-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  info: 'bg-teal-soft text-teal-dark ring-teal-brand/30',
}

export default function Notice({ kind = 'info', children }) {
  if (!children) return null
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`rounded-lg px-3 py-2.5 text-sm ring-1 ring-inset ${styles[kind]}`}>
      {children}
    </p>
  )
}
