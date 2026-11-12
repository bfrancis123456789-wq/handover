import { Link, useNavigate } from 'react-router-dom'
import Logo from '../components/Logo'
import { LEGAL, TERMS_VERSION } from '../lib/legal'

// Placeholder values (still in [brackets]) are highlighted so none are missed.
function V({ k }) {
  const value = LEGAL[k]
  return value.includes('[') ? <mark className="rounded bg-amber-100 px-1 text-amber-900">{value}</mark> : <>{value}</>
}

function Shell({ title, children }) {
  const navigate = useNavigate()
  return (
    <div className="min-h-full bg-canvas">
      <header className="bg-navy-900 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <Link to="/" aria-label="Handover home"><Logo withText className="h-8 w-8" /></Link>
          <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))} className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-navy-800">Back</button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-8 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-6">
        <article className="card p-5 sm:p-8">
          <h1 className="text-2xl font-bold tracking-tight text-navy-900">{title}</h1>
          <p className="mt-1 text-sm text-slate-500">Effective <V k="effectiveDate" /> · Version {TERMS_VERSION}</p>
          <div className="legal mt-6 space-y-6 text-[15px] leading-relaxed text-slate-700">{children}</div>
        </article>
        <p className="mt-6 text-center text-sm text-slate-500">
          <Link to="/privacy" className="font-medium text-teal-dark hover:underline">Privacy Policy</Link>
          {' · '}
          <Link to="/terms" className="font-medium text-teal-dark hover:underline">Terms of Use</Link>
        </p>
      </main>
    </div>
  )
}

const H = ({ children }) => <h2 className="text-lg font-semibold text-navy-900">{children}</h2>
const Draft = () => (
  <span className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-amber-900">
    Draft: pending legal review
  </span>
)
const UL = ({ children }) => <ul className="list-disc space-y-1.5 pl-5">{children}</ul>

export function Privacy() {
  return (
    <Shell title="Privacy Policy">
      <section className="space-y-2">
        <p>
          Handover is a chat app for shift-based teams, run by <V k="company" /> ("we", "us"). This policy explains how we handle personal
          information under the <em>Privacy Act 1988</em> (Cth) and the Australian Privacy Principles (APPs).
        </p>
        <p>
          Your employer or business (the "workplace") decides to use Handover and controls its workplace in the app. For questions about
          how your workplace uses Handover, ask your manager. For anything about how we handle your information, contact us using the
          details at the end of this policy.
        </p>
      </section>

      <section className="space-y-2">
        <H>What we collect</H>
        <UL>
          <li><strong>Account details:</strong> your name, email address, password (stored only as a secure hash), profile photo and role.</li>
          <li><strong>What you post:</strong> messages, photos, likes, and the issues and shift briefs created from them.</li>
          <li><strong>Settings and devices:</strong> notification choices, and a technical address for each device you turn notifications on for.</li>
          <li><strong>Technical information:</strong> error reports (which page, what went wrong, your account ID, browser type) and basic security logs.</li>
        </UL>
        <p>We collect this from you directly, from people in your workplace (for example, when a colleague mentions you in a message), and automatically when you use the app. You don't have to give us your real name, but your workplace may need it to know who you are.</p>
        <p>Handover is not designed to hold sensitive information such as health information. Please don't post it.</p>
      </section>

      <section className="space-y-2">
        <H>Why we use it</H>
        <UL>
          <li>To run Handover: show messages to the right people, send notifications and keep your account secure.</li>
          <li>To create shift briefs: recent messages and open issues from channels you can see are processed by an AI model to list issues and priorities.</li>
          <li>To fix problems and keep the service reliable.</li>
          <li>To contact you about your account or important changes.</li>
        </UL>
        <p>We do not sell personal information, and we do not use your messages to advertise to you.</p>
      </section>

      <section className="space-y-2 rounded-xl p-4 ring-2 ring-amber-200" data-testid="draft-usage">
        <H>Usage statistics and feedback <Draft /></H>
        <p>To understand how Handover is used during our pilot and improve it, we keep:</p>
        <UL>
          <li><strong>Activity counts:</strong> which days you open Handover and how many times you view the shift brief, stored against your account and workplace. We report these to ourselves only as totals per workplace (for example, "12 of 15 staff were active this week").</li>
          <li><strong>AI usage counts:</strong> how many shift briefs each workplace refreshes and how much AI processing they use, so we can manage costs. These are counts only; they contain no message text.</li>
          <li><strong>Feedback you send:</strong> your message, the screen you sent it from, the app version and your device type, linked to your account and workplace so we can follow up.</li>
        </UL>
        <p>
          We work these out from our own database. We don't use third-party analytics, advertising or tracking tools, and message content is
          never used for statistics. Only authorised Handover staff, signed in with two-factor authentication, can see the totals and feedback.
          Activity counts are kept for <mark className="rounded bg-amber-100 px-1 text-amber-900">[24]</mark> months and feedback for{' '}
          <mark className="rounded bg-amber-100 px-1 text-amber-900">[24]</mark> months, then deleted.
        </p>
        <p>
          Before each update to Handover we take an encrypted backup of the database, which is kept for 30 days by{' '}
          <mark className="rounded bg-amber-100 px-1 text-amber-900">[GitHub (Microsoft), United States: confirm backup location]</mark>.
        </p>
      </section>

      <section className="space-y-2">
        <H>Who we share it with</H>
        <p>Your messages are visible to people in your workplace who can access the channel you post in. We also use these service providers, who handle information for us under contract:</p>
        <UL>
          <li><strong>Supabase</strong>: hosting, database, file storage and sign-in. Data is stored in <V k="hostingRegion" />.</li>
          <li><strong>Anthropic</strong> (United States): AI processing for shift briefs. Message text from your channels is sent when someone refreshes a brief.</li>
          <li><strong>Sentry</strong> (United States): error reports, which exclude message text, names and email addresses.</li>
          <li><strong>Apple, Google and Mozilla push services</strong>: delivering notifications to your devices, if you turn them on.</li>
          <li><strong>[Email provider]</strong>: sending sign-up and password reset emails.</li>
        </UL>
        <p>
          Some of these providers are overseas (APP 8), mainly in the United States. We take reasonable steps to make sure they protect
          personal information in a way consistent with the APPs. We may also disclose information when the law requires it.
        </p>
      </section>

      <section className="space-y-2">
        <H>Keeping it safe</H>
        <p>
          We use encryption in transit, access rules enforced in the database so people only see what their role allows, and limited staff
          access. If a data breach is likely to cause serious harm, we will notify you and the Office of the Australian Information
          Commissioner (OAIC) as required by the Notifiable Data Breaches scheme.
        </p>
      </section>

      <section className="space-y-2">
        <H>How long we keep it</H>
        <p>
          We keep your information while your account is active. When you delete your account, we delete your profile, photo, likes, briefs and
          devices straight away. You can choose to delete the messages and photos you posted as well; otherwise they stay with your workplace,
          shown as from a "Former member". Backups are overwritten within <mark className="rounded bg-amber-100 px-1 text-amber-900">[number]</mark> days.
          When a workplace stops using Handover, its data is deleted within <mark className="rounded bg-amber-100 px-1 text-amber-900">[number]</mark> days.
        </p>
      </section>

      <section className="space-y-2">
        <H>Your choices and rights</H>
        <UL>
          <li><strong>Access (APP 12):</strong> download a copy of your data any time from Settings → Account → Export my data, or ask us.</li>
          <li><strong>Correction (APP 13):</strong> edit your name and photo in My Profile, or ask us to correct anything else.</li>
          <li><strong>Deletion:</strong> delete your account from Settings → Account.</li>
          <li><strong>Notifications:</strong> turn them off for any device or channel in Settings → Notifications.</li>
        </UL>
        <p>We'll respond to requests within 30 days.</p>
      </section>

      <section className="space-y-2">
        <H>Cookies and storage on your device</H>
        <p>Handover stores your sign-in session and a few settings on your device so you stay signed in. We don't use advertising or tracking cookies.</p>
      </section>

      <section className="space-y-2">
        <H>Complaints and contact</H>
        <p>
          Contact our privacy officer at <V k="privacyEmail" /> or <V k="postalAddress" />. We'll acknowledge your complaint within 7 days and aim
          to resolve it within 30 days. If you're not satisfied, you can complain to the OAIC at oaic.gov.au or on 1300 363 992.
        </p>
        <p>We may update this policy. If the changes are significant, we'll tell you in the app before they take effect.</p>
      </section>
    </Shell>
  )
}

export function Terms() {
  return (
    <Shell title="Terms of Use">
      <section className="space-y-2">
        <p>
          These terms apply to your use of Handover, provided by <V k="company" />. By creating an account you agree to them and to our{' '}
          <Link to="/privacy" className="font-medium text-teal-dark underline">Privacy Policy</Link>. If you use Handover on behalf of a business,
          you confirm you're allowed to agree for that business.
        </p>
      </section>

      <section className="space-y-2">
        <H>Your account</H>
        <UL>
          <li>You must be at least <mark className="rounded bg-amber-100 px-1 text-amber-900">[16]</mark> years old.</li>
          <li>Give accurate details, keep your password private and tell us if you think someone else has used your account.</li>
          <li>Managers are responsible for who they invite, the roles they give, and removing people who leave.</li>
        </UL>
      </section>

      <section className="space-y-2">
        <H>Using Handover properly</H>
        <p>Don't use Handover to:</p>
        <UL>
          <li>post anything unlawful, harassing, discriminatory, or that breaches someone's privacy or confidentiality;</li>
          <li>share health or other sensitive information about guests, customers or colleagues;</li>
          <li>try to access workplaces, channels or data you're not allowed to see, or disrupt the service;</li>
          <li>send spam or malware.</li>
        </UL>
        <p>We may suspend accounts that break these rules.</p>
      </section>

      <section className="space-y-2">
        <H>Your content</H>
        <p>
          You and your workplace own what you post. You give us permission to store, process and display it to run Handover, including
          processing by our AI provider to create shift briefs.
        </p>
      </section>

      <section className="space-y-2">
        <H>Shift briefs and AI</H>
        <p>
          Shift briefs are written automatically by an AI model and can be incomplete or wrong. They help with handovers but don't replace
          your workplace's own procedures. Always check safety, food safety, security and emergency matters directly. Never rely on Handover
          as your only way to report or respond to an emergency: call 000.
        </p>
      </section>

      <section className="space-y-2">
        <H>Availability and changes</H>
        <p>
          We work to keep Handover available but can't promise it will always be uninterrupted or error-free. We may change features, and we'll
          give reasonable notice of changes that significantly affect you.
        </p>
      </section>

      <section className="space-y-2">
        <H>Fees</H>
        <p><mark className="rounded bg-amber-100 px-1 text-amber-900">[Describe pricing, billing and refunds, or state that Handover is currently free.]</mark></p>
      </section>

      <section className="space-y-2">
        <H>Liability</H>
        <p>
          Nothing in these terms excludes rights you have under the Australian Consumer Law that can't be excluded. Subject to those rights, and
          to the extent the law allows, we are not liable for indirect or consequential loss, and our total liability is limited to{' '}
          <mark className="rounded bg-amber-100 px-1 text-amber-900">[the fees paid in the previous 12 months / resupplying the service]</mark>.
        </p>
      </section>

      <section className="space-y-2">
        <H>Ending your use</H>
        <p>
          You can delete your account at any time in Settings → Account. We may close accounts or workplaces that break these terms, or end the
          service with <mark className="rounded bg-amber-100 px-1 text-amber-900">[30]</mark> days' notice. You can export your data first.
        </p>
      </section>

      <section className="space-y-2">
        <H>General</H>
        <p>
          These terms are governed by the laws of <V k="governingState" />, Australia. Questions? Contact <V k="supportEmail" />.
        </p>
      </section>
    </Shell>
  )
}
