import { useState } from 'react'
import { SUPPORT_EMAIL } from '../../lib/constants'
import PageHeader from '../../components/PageHeader'
import { CopyIcon } from '../../components/Icons'

const FAQ = [
  { q: 'How do I invite my team?', a: 'Managers can find the 6-character join code in Manage Team. Share it with your staff. They sign up, choose Join a workplace and enter the code.' },
  { q: 'Why can\'t I see the Supervisors or Management channel?', a: 'Those channels are limited by role. Supervisors see the Supervisors channel, and only managers see Management. Ask a manager if your role should change.' },
  { q: 'What is the Shift Brief?', a: 'On Home, Refresh Summary reads the last 24 hours of messages in the channels you can access and lists critical issues, ongoing items, what was resolved and the next priorities. It only uses channels you are allowed to see.' },
  { q: 'Why can\'t I post in Announcements?', a: 'Announcements is for important news from managers and supervisors, so it stays easy to read. Everyone can read it. To share something there, ask your supervisor or manager.' },
  { q: 'Why does an issue stay on the brief for days?', a: 'Problems stay on the brief until they are fixed, so nothing gets forgotten between shifts. Each one shows how long it has been open and who owns it. It is marked resolved when someone posts that it is fixed and the brief is refreshed, or when a supervisor or manager taps Mark resolved.' },
  { q: 'Who can see my messages?', a: 'Only people in your workplace who have access to the channel you posted in. Other workplaces can never see your data.' },
  { q: 'How do I save a photo someone posted?', a: 'Tap the photo to open it full screen, then tap Save.' },
  { q: 'How do I leave a workplace?', a: 'Go to Account and tap Leave Workplace. If you are the only manager, make someone else a manager first.' },
  { q: 'Can I delete a message?', a: 'Yes. Tap the bin icon on your own message and confirm. Managers can delete any message, for example if something was posted in the wrong place.' },
  { q: 'Someone has left the team. How do I remove them?', a: 'Managers can open Manage Team and tap the bin icon next to the person. If the join code was shared outside your team, tap Reset code there too.' },
  { q: 'How do I put Handover on my phone\'s home screen?', a: 'On iPhone, open Handover in Safari, tap Share, then Add to Home Screen. On Android, open it in Chrome, tap the menu, then Install app or Add to Home screen.' },
  { q: 'How do I get notifications on my phone?', a: 'Open Notifications in Settings and tap Turn on notifications, then allow them when your phone asks. On iPhone and iPad, add Handover to your Home Screen first and open it from there. You can switch individual channels off on the same page, and you are never notified about your own messages.' },
  { q: 'I forgot my password.', a: 'On the sign-in screen, tap Forgot password? and enter your email. We will send you a link to choose a new one.' },
]

export default function Help() {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* address stays selectable */ }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader title="Help & Support" subtitle="Answers to common questions." />
      <div className="card divide-y divide-slate-100">
        {FAQ.map((f) => (
          <details key={f.q} className="group p-4 sm:px-6">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-navy-900">
              {f.q}
              <span className="text-xl leading-none text-slate-400 transition group-open:rotate-45">+</span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{f.a}</p>
          </details>
        ))}
      </div>
      <div className="card mt-6 p-5 sm:p-6">
        <h2 className="font-semibold text-navy-900">Still stuck?</h2>
        <p className="mt-1 text-sm text-slate-500">Email us and we'll get back to you within one working day. You can also read our <a href="/privacy" className="font-medium text-teal-dark underline">Privacy Policy</a> and <a href="/terms" className="font-medium text-teal-dark underline">Terms of Use</a>.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a href={`mailto:${SUPPORT_EMAIL}`} className="select-all font-medium text-teal-dark hover:underline">{SUPPORT_EMAIL}</a>
          <button onClick={copy} className="btn-secondary px-3 py-1.5 text-xs"><CopyIcon className="h-3.5 w-3.5" />{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>
    </div>
  )
}
