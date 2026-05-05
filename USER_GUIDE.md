# User Guide — 1line Portal

Internal operations portal for first-line support teams. Covers shift scheduling, time-off management, email monitoring, Telegram notifications, and team management.

---

## Logging in

Open the portal URL in your browser. Enter your username and password provided by your admin.

If your account has **two-factor authentication (2FA)** enabled, you will be prompted for a 6-digit code from your authenticator app (Google Authenticator, Authy, etc.) after entering your password.

**Session:** Your session expires after 30 minutes of inactivity. The portal automatically refreshes it in the background while you are active.

---

## Navigation

The sidebar contains:

| Item | Description |
|------|-------------|
| 👤 My Profile | Personal settings, timezone, Telegram linking, 2FA |
| 📅 Schedule | Shift calendar (weekly/monthly view) |
| 📧 Mail | Email monitoring and routing rules |
| 🌴 Time Off | Submit and track time-off requests |
| 🖥️ Containers | VPS monitoring dashboard |
| ⚙️ Admin | Team and system administration *(admin only)* |

The bell icon 🔔 in the top bar shows your unread in-app notification count.

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

Times are in your admin's configured portal timezone. Telegram notifications you receive will show times converted to **your own profile timezone**.

### World clock

A live clock bar above the calendar shows current time in multiple timezones. Columns with night hours (before 07:00 or after 20:00) are shaded.

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

The Mail page shows incoming emails captured from monitored mailboxes and forwarded to Telegram. All authenticated users can view the email log and mark emails as solved.

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

Change an email's status using the dropdown on its row. You can add a comment when changing status to document what was done or why it is blocked.

### Comments

Each email has a comment thread visible to all authenticated users. Use comments to coordinate on an issue without leaving the portal.

---

## Containers

The Containers page shows a live view of all registered VPS nodes and their Docker containers. It is read-only — you can observe but not control services from here.

### Agent cards

Each registered VPS is shown as an agent card with:
- **System metrics**: CPU %, RAM usage, disk usage, load average, uptime
- **Pending OS updates** and **failed systemd services** (if any)
- **Recent SSH logins**
- **Last seen** timestamp — goes red if the agent has been silent for more than 5 minutes

### Container grid

Below each agent card, all Docker containers on that VPS are listed with:
- Status badge (running / exited / error)
- CPU % and memory usage
- Last log lines (expandable)

Containers that are absent from the latest report (e.g. removed from Docker) are shown as dimmed.

### Alerts

VPS agents can send Telegram alerts for notable events (CPU spike, disk full, container stopped, SSH login, etc.). Alerts are configured per agent by an admin under **Edit Agent**.

---

## Notifications

The bell icon (🔔) in the top bar shows your unread notification count, updated every 15 seconds.

Click it to open the notification panel. You can:
- Mark individual notifications as read.
- Mark all as read.
- Clear all notifications.

---

## Profile

Access your profile from the left sidebar.

### Identity

Change your **display name**, **name colour** (used in shift cards and the sidebar), and **avatar URL** (must be a publicly accessible image URL).

### Timezone

Set your IANA timezone (e.g. `Europe/Moscow`, `Asia/Dubai`). This affects how shift start times are displayed in your Telegram notifications. It does not change how shifts appear on the calendar — the calendar always uses the portal's configured timezone.

### Telegram notifications

Link your Telegram account to receive shift notifications.

**How to link:**

1. Enter your Telegram username (e.g. `@yourname`) and click **Save Telegram settings**.
2. Click **Get link code**. The command `/link XXXXXXXX` is copied to your clipboard.
3. Click **Open @botname →** to open the bot in Telegram.
4. Paste and send the command in the bot chat.
5. The portal detects the link automatically within a few seconds — the status badge changes to **Linked**.

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

Named presets for Telegram destinations (chat + optional topic). Templates are referenced by mailbox routing rules, VPS agents, and reminders so you can define a destination once and reuse it.

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
