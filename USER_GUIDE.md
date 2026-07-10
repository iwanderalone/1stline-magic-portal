# User Guide — 1line Portal

Internal operations portal for first-line support teams. Covers shift scheduling, time-off management, email monitoring with reply-from-portal, Zammad ticket tracking, Grafana alerts, runbooks, an AI assistant, Telegram notifications, and team management.

---

## Logging in

Open the portal URL in your browser. Enter your username and password provided by your admin.

If your account has **two-factor authentication (2FA)** enabled, you will be prompted for a 6-digit code from your authenticator app (Google Authenticator, Authy, etc.) after entering your password.

**Session:** Your session expires after 30 minutes of inactivity. The portal automatically refreshes it in the background while you are active.

---

## Navigation

The sidebar is organised into collapsible groups (click a group header to fold it — the state is remembered):

| Group / Item | Description |
|------|-------------|
| 🏠 Home | Greeting, "Needs attention" hub, today's shift |
| **Operations** | |
| 🎫 Tickets | Zammad ticket board and event feed |
| 📧 Mail | Email monitoring, replies, routing rules |
| 🚨 Alerts | Grafana alert feed |
| **Team** | |
| 📅 Schedule | Shift calendar (weekly/monthly view) |
| 🌴 Time Off | Submit and track time-off requests |
| 🔔 Reminders | Personal reminders (in-app + Telegram) |
| **Knowledge** | |
| 📚 Runbooks | Step-by-step playbook library |
| | |
| 👤 My Profile | Personal settings, timezone, Telegram linking, 2FA |
| ⚙️ Admin | Team and system administration *(admin only)* |

A floating **AI assistant** button (=^.^=) sits in the bottom-right corner on every page (when enabled by your admin).

The top bar shows multi-timezone clocks (Mexico City / Berlin / Moscow / Abu Dhabi), language toggle (EN / RU), theme toggle (light / dark), and a bell icon for unread in-app notifications.

---

## Schedule

The schedule page shows shifts for the current week or month.

### Viewing shifts

- Use the **Week / Month** tabs to switch views.
- Use **← Today →** to navigate between periods.
- Your own shifts are highlighted. Other team members' shifts are shown in their assigned colours.
- Shifts marked as **draft** (visible to admins only) are shown with reduced opacity. Published shifts are visible to everyone.

### Shift types

| Type | Default hours | Icon |
|------|--------------|------|
| Day shift | 08:00 – 20:00 | ☀️ |
| Night shift | 20:00 – 08:00 | 🌙 |
| Office shift | 09:00 – 17:00 | 🏢 |

Shift times are stored in the portal's canonical timezone (UTC) but are **always displayed converted to your own profile timezone** — on the calendar, on the home page, in Telegram notifications, and in AI assistant answers. Set your timezone in Profile → Timezone.

---

## Home

The home page is the first thing you see after login. It surfaces:

- **Greeting band** with today's date and your current/next shift.
- **Needs attention** — the main hub: firing Grafana alerts, unsolved Zammad tickets, and unchecked emails, each clickable straight into a detail view.
- **Slim stat strip** — compact counters (mail queue, reminders, notifications).
- **Operational mail** — recent unresolved emails. **Click any row to open a detail modal** where you can read the message body, change its status, and post comments without leaving the home page.
- **Shift context** — your current/upcoming shift and the next engineer on rotation (times in your profile timezone).

---

## Time Off

The Time Off page lets you submit and track leave requests.

### Submitting a request

1. Click **+ New request**.
2. Choose the type: **Day off**, **Vacation**, or **Sick leave**.
3. Select the date range.
4. Add an optional note and submit.

Your request starts as **pending**. An admin will approve or reject it. You can see the status and any admin comment on the Time Off page.

Approved time-off days are shown on the schedule calendar and are respected by the auto-schedule generator — you won't be assigned shifts on those days.

---

## Mail

The Mail page shows incoming emails captured from monitored mailboxes and forwarded to Telegram. All authenticated users can view the email log, mark emails as solved, comment, and reply.

### Folders

| Folder | Contents |
|--------|----------|
| Inbox | Routed incoming emails |
| Unrouted | Emails that matched no routing rule |
| Archive | Solved / closed items |
| Sent | All replies sent from the portal |

Emails you have replied to get a green **Replied** marker in the list.

### Email log

Each row shows:
- **Category badge** — the routing rule that matched (e.g. 🔴 Adobe, 🔵 Onboarding, 📩 General)
- **Subject** and **sender**
- **Received** time
- **Status** — current handling state (see below)

Use the status filter to focus on open items.

### Email statuses

| Status | Meaning |
|--------|---------|
| Unchecked | Newly arrived, not yet reviewed |
| Solved | Handled and closed |
| On pause | Waiting on something (e.g. customer reply) |
| Blocked | Requires escalation or external action |

Change an email's status from the segmented control at the top of the detail pane (**Unchecked / Paused / Blocked / Solved**) — clicking an option applies it instantly.

### Message body

Long messages collapse to the first ~12 lines with a **Show full message** button to expand. The body is plain-text rendered (HTML is stripped by the parser) and capped at 64 KB per email.

### Comments

Each email has a comment thread visible to all authenticated users. Use comments to coordinate on an issue without leaving the portal.

You can also access the email detail in modal form by clicking a row in the **Operational mail** card on the Home page — useful if you don't want to leave your shift dashboard.

### Replying

Open an email's detail view and use the **Reply** composer to answer the original sender directly from the portal. The reply is sent from the monitored mailbox itself, signed as your team's support identity with the standard signature, and threads correctly in the recipient's mail client. Sent replies appear under the email and in the **Sent** folder.

---

## Tickets (Zammad)

The Tickets page mirrors your Zammad helpdesk in real time.

- **Board view** — tickets grouped by status (New / Open / In progress / Pending / Paused / Closed) with time-in-status, assignee, and priority. Use the search box to filter.
- **Ticket detail** — click a ticket to open the full view: description, customer, state history, and the comment thread from Zammad.
- **Internal notes** — post a **portal-only note** on any ticket. These notes stay in the portal and are *never* sent to Zammad (customers see Zammad notes through the support bot, so anything you need to keep internal goes here).
- **Statuses are read-only** — change ticket states in Zammad itself; the portal reflects them within seconds via webhooks.
- **Events tab** — the raw feed of webhook events with payloads, useful for debugging.

If configured by your admin, ticket alerts also go to Telegram: new ticket opened, ticket solved, and escalation pings when a ticket sits in Open for 15/30/60 minutes.

---

## Alerts (Grafana)

The Alerts page shows monitoring alerts pushed from Grafana.

- **Firing alerts** are listed first with severity badges; resolved alerts follow.
- Each alert shows its name, summary, labels, and how many times it has fired.
- The list auto-refreshes every 30 seconds; firing alerts also appear in the Home **Needs attention** hub.

---

## Runbooks

The Runbooks page is the team's playbook library.

- Browse by **category** in the left sidebar (Access, Infra, Yandex, Website, Office, Services, General) or search by title/tags.
- Each runbook is a numbered sequence of steps; steps can include copy-ready code blocks with syntax highlighting.
- A **run counter** tracks how often each runbook is used.
- Admins can create and edit runbooks directly; anyone can ask the **AI assistant** to draft one from a solved ticket or email (see below). AI drafts are tagged `ai-draft` and should be reviewed before relying on them.

---

## AI Assistant

Click the cat button (=^.^=) in the bottom-right corner to open the assistant. It understands English and Russian and replies in the language you write in. Enter sends, Shift+Enter makes a new line.

What it can do:

- **Schedule** — "when is my next shift?", "who works nights this week?" (times shown in your timezone)
- **Time off** — check your requests or file a new one; the assistant confirms dates first, and requests still land as *pending* for normal admin approval
- **Runbooks** — list, search, and read runbooks; or say "check ticket #123 and make a runbook" / "make a runbook from that Adobe email" to get a draft
- **Mail review** — "did we miss anything today/this week?" — reviews the queue and highlights unchecked or long-paused items

Privacy: the assistant sees team schedule data and email metadata (subjects/senders/statuses). Full email or ticket content is only read when you explicitly point it at a specific case.

---

## Reminders

Personal reminders fire as in-app notifications and (optionally) as Telegram messages.

### Creating a reminder

1. Click **+ New reminder**.
2. Enter a title and optional description.
3. Pick a time using the quick-set buttons (15m / 30m / 1h / 2h / Tomorrow 9am) or the datetime field.
4. Optionally enable **Recurring** and choose an interval (15 min, 30 min, 1h, 2h, 6h, 12h, daily, weekly, biweekly, monthly).
5. Choose where to deliver: **None** (in-app only), **Personal chat**, **Group chats**, or **Both**.

### Editing or cancelling

Each active reminder has an edit button (pencil icon) to adjust title, time, recurrence, or delivery target, and a **Cancel** button to mark it cancelled. Fired and cancelled reminders are visible by switching the filter to **All**.

---

## Notifications

The bell icon (🔔) in the top bar shows your unread notification count, updated every 15 seconds.

Click the bell to open the notification panel. From there you can:
- **Click an unread notification to mark it read** (one-by-one).
- **Mark all read** at once.
- **Clear all** notifications.

---

## Profile

Access your profile from the left sidebar.

### Identity

Change your **display name**, **name colour** (used in shift cards and the sidebar), and **avatar URL** (must be a publicly accessible image URL).

### Timezone

Set your IANA timezone (e.g. `Europe/Moscow`, `Asia/Dubai`). All shift times across the portal — the schedule calendar, home page, Telegram notifications, and AI assistant answers — are displayed converted to this timezone.

### Telegram notifications

Link your Telegram account to receive shift notifications.

**How to link:**

1. Enter your Telegram username (e.g. `@yourname`) and click **Save Telegram settings**.
2. Click **Get link code**. The command `/link XXXXXXXX` is copied to your clipboard.
3. Click **Open @botname →** to open the bot in Telegram.
4. Paste and send the command in the bot chat.
5. The portal detects the link automatically within a few seconds — the status badge changes to **Linked**.

**Unlinking:** Once linked, an **Unlink Telegram** button is shown — click it to disconnect your Telegram account from the portal (e.g. before linking a different account).

**Notification toggles:**
- **Shift notifications** — receive a DM when your shift starts today.
- **Reminder notifications** — receive a DM when a reminder fires.

### Two-factor authentication (2FA)

Enable TOTP 2FA for extra account security.

**Setup:**
1. Click **Set up 2FA**.
2. Scan the QR code with Google Authenticator, Authy, or any TOTP app.
3. Enter the 6-digit code shown in the app and click **Confirm**.

**Disable:** Click **Disable 2FA** and enter your current 6-digit code to confirm.

If you lose access to your authenticator app, ask an admin to reset your 2FA.

---

## Admin panel (admin role only)

Accessible from the sidebar for admin accounts.

### Users tab

- **Create user**: set username, display name, password, role, Telegram username, and shift rules (min gap, max per week).
- **Edit user**: change any field including availability pattern and allowed shift types.
- **Reset password**: set a new password for any user.
- **Reset 2FA**: disable a user's 2FA (e.g. if they lost their authenticator).
- **Link TG**: generate a Telegram link code for a user (same flow as self-service, but admin-initiated).
- **Deactivate / reactivate** users.

### Groups tab

Create named groups with a colour. Assign members to groups. Groups are used as labels visible on shift cards.

### Shift config tab

Configure the three shift types (Day, Night, Office):
- Label, emoji, colour
- Default start and end times
- Duration in hours
- Whether the shift requires a location (onsite / remote)

Times are interpreted in the portal timezone shown in the banner at the top of this tab. Changing a shift type's default start time automatically adjusts when Telegram notifications fire for that shift type.

### Telegram Templates tab

Named presets for Telegram destinations (chat + optional topic). Templates are referenced by mailbox routing rules and reminders so you can define a destination once and reuse it.

1. Click **+ Add template**.
2. Give it a name (e.g. "Alerts channel", "On-call thread").
3. Enter the chat ID and optional topic/thread ID.

### Telegram tab

Add Telegram group chats or channels to receive automatic roster notifications.

**Adding a chat:**
1. Add the bot to your group/channel and make it an admin (so it can post).
2. Get the chat ID (e.g. use `@userinfobot` or the Telegram API).
3. Click **+ Add chat**, enter the chat ID, name, and toggle which notification types it should receive.

**Notification types:**
| Toggle | When it fires |
|--------|--------------|
| ☀️ Day | At day shift start time (portal timezone) — posts today's day shift roster |
| 🌙 Night | At night shift start time — posts today's night shift roster |
| 🏢 Office | At office shift start time — posts today's office roster |
| 🔔 Reminders | When any reminder with "groups" target fires |
| 📢 General | Manual test notifications |

### Logs tab

Last 200 audit log entries: logins, schedule generation/publish, time-off approvals, password resets, etc.

---

## Mail Reporter (admin setup)

The mail reporter monitors IMAP mailboxes and delivers categorised emails to Telegram.

### Mailboxes tab

Add the mailboxes you want to monitor:
1. Click **+ Add mailbox**.
2. Enter the email address and password (app password if 2FA is enabled on the mail account).
3. Set **Monitor since** — emails older than this date are ignored.
4. Set the **Telegram target** — a chat ID, or `chat_id:thread_id` for forum channels.
5. Optionally set a **Subject filter** keyword to only forward matching emails.
6. Click **Test connection** to verify IMAP credentials before saving.

The portal polls each enabled mailbox on the configured interval (default: every 30 seconds).

### Routing rules tab

Rules determine how emails are categorised and where they are delivered.

**Built-in rules** (cannot be deleted):
| Rule | Matches |
|------|---------|
| 🔴 Adobe | Emails from Adobe with verification codes — extracts the numeric code |
| 🟡 Yandex Support | Emails from `support-team@360.yandex.ru` |
| 🔵 Onboarding | Emails containing onboarding-related keywords |
| 🔵 Offboarding | Emails containing offboarding/termination keywords |
| 📩 General | Catch-all for everything else |

Built-in rules' **display config** (label, colour, hashtag, @mentions, include body) can be edited. Their match logic is hardcoded but you can add custom `match_values` to extend detection.

**Custom rules** are checked first (by priority), before built-in classification runs:
1. Click **+ Add rule**.
2. Choose a **match type**: keyword (subject + body), subject keyword, sender address, or sender domain.
3. Enter **match values** (comma-separated).
4. Set the display config and optionally a Telegram target override.
5. Lower priority number = checked first.

### Email log

The email log is visible to all authenticated users (not just admins). Each entry shows the category, sender, subject, delivery status, and solve state. Admins can clear the log from this tab.

---

## Telegram bot commands

Once your account is linked, you can use these commands in the bot:

| Command | Description |
|---------|-------------|
| `/link <code>` | Link your portal account (one-time setup) |
| `/myshift` | Show your next 5 upcoming shifts |

---

## Frequently asked questions

**I forgot my password.** Ask an admin to reset it via the Users tab.

**I lost access to my 2FA app.** Ask an admin to click Reset 2FA on your account.

**I'm not receiving Telegram notifications.** Check:
1. Your Telegram account is linked (Profile → Telegram → status shows Linked).
2. The relevant notification toggle is on (Shift notifications / Reminder notifications).
3. You haven't blocked the bot.

**An email was not forwarded to Telegram.** Check the Mail page — if the row shows the email but `telegram_sent` is false, there may be a Telegram target misconfiguration. If the email doesn't appear at all, check the subject filter on the mailbox config.

**Shift notifications are not arriving on time.** Shift start notifications are scheduled based on the default start time set in Admin → Shift Config. Notifications are registered when shifts are published — if you changed a shift config time after publishing, ask an admin to re-publish.
