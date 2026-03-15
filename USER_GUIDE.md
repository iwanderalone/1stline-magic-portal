# User Guide — 1line Portal

Internal operations portal for first-line support teams. Covers shift scheduling, reminders, Telegram notifications, and team management.

---

## Logging in

Open the portal URL in your browser. Enter your username and password provided by your admin.

If your account has **two-factor authentication (2FA)** enabled, you will be prompted for a 6-digit code from your authenticator app (Google Authenticator, Authy, etc.) after entering your password.

**Session:** Your session expires after 30 minutes of inactivity. The portal automatically refreshes it in the background while you are active.

---

## Schedule

The schedule page is the main page. It shows shifts for the current week or month.

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

A live clock bar above the calendar shows current time in Berlin, Moscow, Abu Dhabi, Mexico City, and Bishkek. Columns with night hours (before 07:00 or after 20:00) are shaded.

### Time-off requests

Click **Time off** to submit a request. Choose the type (Day off / Vacation / Sick leave), date range, and an optional note.

Your request starts as **pending**. An admin will approve or reject it. Approved time-off days are shown on the calendar and respected by the auto-schedule generator.

---

## Reminders

Create personal reminders that fire as in-app notifications and optionally as Telegram DMs.

### Creating a reminder

1. Click **+ New reminder**.
2. Enter a title and optional description.
3. Set the date and time. Quick buttons: **15 min / 30 min / 1 h / 2 h / Tomorrow 09:00**.
4. Choose notification channels: **In-app**, **Telegram** (requires linked account).
5. For Telegram, choose where to send: personal DM, configured group chats, or both.
6. Toggle **Recurring** and set an interval (e.g. every 60 minutes) for repeating reminders.

Reminders fire within 30 seconds of their scheduled time.

---

## Notifications

The bell icon (🔔) in the top-right corner shows your unread notification count, updated every 15 seconds.

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

Link your Telegram account to receive shift and reminder notifications.

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

Times are interpreted in the portal timezone shown in the banner at the top of this tab.

### Telegram tab

Add Telegram group chats or channels to receive automatic roster notifications.

**Adding a chat:**
1. Add the bot to your group/channel and make it an admin (so it can post).
2. Get the chat ID (e.g. use `@userinfobot` or the Telegram API).
3. Click **+ Add chat**, enter the chat ID, name, and toggle which notification types it should receive.

**Notification types:**
| Toggle | When it fires |
|--------|--------------|
| ☀️ Day | 07:45 in portal timezone — posts today's day shift roster |
| 🌙 Night | 19:45 — posts today's night shift roster |
| 🏢 Office | 08:50 — posts today's office roster |
| 🔔 Reminders | When any reminder with "groups" target fires |
| 📢 General | Manual test notifications from the Notifications tab |

### Notifications tab

Send a manual in-app notification (and optionally a Telegram DM) to selected users or group chats. Useful for announcements.

### Logs tab

Last 200 audit log entries: logins, schedule generation/publish, time-off approvals, password resets, etc.

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

**My shift appears on the wrong day.** This was a known timezone bug, fixed in v0.1. If you still see it, hard-refresh the page (Ctrl+Shift+R).

**I'm not receiving Telegram notifications.** Check:
1. Your Telegram account is linked (Profile → Telegram → status shows Linked).
2. The relevant notification toggle is on (Shift notifications / Reminder notifications).
3. You haven't blocked the bot.

**Reminders are not firing.** Reminders fire within 30 seconds. Check that the reminder status is Active (not Fired or Cancelled) on the Reminders page.
