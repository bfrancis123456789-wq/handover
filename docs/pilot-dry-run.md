# Production dry run (before the first venue)

Run this together on the **production** site, with two phones (one iPhone, one Android) and a laptop. Use real email addresses you can check. Tick each box only when you've seen it work. Afterwards, delete the dry-run venue's accounts from Account → Delete my account.

**Who's who:** *Manager* = founder on the laptop, then the iPhone. *Staff* = the Android phone. *Supervisor* = a second person or browser.

## Setup and onboarding
- [ ] The site loads at the custom domain over https, with the Handover icon in the tab.
- [ ] Manager signs up (ticking the Terms box) and creates "Dry Run Venue". The welcome dialog shows.
- [ ] The setup checklist shows on Home, at 0 of 4.
- [ ] If email confirmation is on: the confirmation email arrives within a minute, isn't in spam, and its link opens the app.

## Invite and join
- [ ] Manager copies the join code from Manage Team. The checklist link goes there.
- [ ] Staff signs up on Android and joins with the code. A wrong code first shows a clear error.
- [ ] Manager's checklist ticks "Invite your staff".
- [ ] Manager promotes the Supervisor in Manage Team. The Supervisor sees the Supervisors channel without reloading.

## Messages and photos
- [ ] Manager posts the first announcement. Staff sees it live, can't post in Announcements, and sees why.
- [ ] Staff posts in General with a **photo taken on the phone camera**. It appears for the manager within a few seconds. Tapping it opens full screen, and Save downloads it.
- [ ] Likes, unread counts and deleting your own message all work across both devices.

## Push notifications
- [ ] **Android (Chrome):** Settings → Notifications → Turn on notifications → Allow. Lock the phone. Manager posts in General: a notification arrives, and tapping it opens General.
- [ ] **iPhone:** in Safari, Share → Add to Home Screen, open Handover from the icon, sign in as Manager, turn on notifications, allow. Staff posts: the notification arrives on the lock screen and opens the right channel.
- [ ] Switching a channel off in Notifications stops notifications from it. You never get notified about your own post.

## Shift brief and issues ("shift report")
- [ ] Staff posts a problem ("Walk-in freezer door is broken") and a non-problem ("Morning all!").
- [ ] Manager taps Refresh Summary: the freezer appears under Critical Issues with "open under an hour", and "Morning all" doesn't appear. Check the wording reads well (this is real Claude, not the test stand-in).
- [ ] Manager assigns the freezer to Staff. Staff sees "Owner: …" live.
- [ ] Staff posts "Fixed the freezer door". After the next refresh, it moves to Resolved Today.
- [ ] Copy brief pastes a readable summary into a text message.
- [ ] The founder dashboard shows the venue's briefs and a small AI cost.

## Accounts and email
- [ ] **Password reset:** Staff signs out, taps Forgot password?, and the email arrives within a minute (check spam). Its link opens "Choose a new password" on the custom domain, and the new password works.
- [ ] Export my data downloads a file with your own messages.
- [ ] Send feedback from the chat screen appears on the founder dashboard with the right venue and screen.

## Founder dashboard and demo
- [ ] Founder opens `/admin`, sets up the authenticator app, and sees "Dry Run Venue" with this session's counts.
- [ ] Demo: reset from the dashboard, sign in as `demo.manager@demo.handover.test` on a phone, and check the demo banner and sample issues.

## Monitoring
- [ ] Sentry shows the release, with no unexpected errors from the dry run.
- [ ] A test alert email from Sentry reaches the founder.

**Note:** Handover doesn't have a separate "shift report" feature. The shift brief, with its tracked issues, is what venues use for handover. If "shift reports" means something else, raise it before the pilot.
