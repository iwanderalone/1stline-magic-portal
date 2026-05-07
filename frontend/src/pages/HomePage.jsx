import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { Avatar, Badge, Button, Card, EmptyState, Tag } from '../components/UI';
import { Icon } from '../components/Icons';

const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};

function localNow(timezone) {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: timezone || 'UTC' }));
  } catch {
    return new Date();
  }
}

function greetingFor(date) {
  const hour = date.getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtTime(value) {
  if (!value) return '';
  return String(value).slice(0, 5);
}

function fmtSince(dt) {
  if (!dt) return '';
  const raw = String(dt);
  const d = new Date(raw.endsWith('Z') || raw.includes('+') ? raw : `${raw}Z`);
  const diff = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function shiftStartMs(shift) {
  const start = shift.start_time || '00:00';
  return new Date(`${shift.date}T${start}`).getTime();
}

function shiftEndMs(shift) {
  const start = shift.start_time || '00:00';
  const end = shift.end_time || start;
  const base = new Date(`${shift.date}T${end}`);
  if (shift.end_time && shift.start_time && shift.end_time <= shift.start_time) {
    base.setDate(base.getDate() + 1);
  }
  return base.getTime();
}

function statusTone(status) {
  return {
    unchecked: 'yellow',
    on_pause: 'blue',
    blocked: 'red',
    solved: 'green',
  }[status] || 'gray';
}

function MetricCard({ label, value, detail, icon, color = 'var(--accent)' }) {
  return (
    <Card style={{ minHeight: 126 }}>
      <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div className="t-eyebrow">{label}</div>
          {icon && <Icon name={icon} size={17} color={color} />}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 34, lineHeight: 1, color: 'var(--text)' }}>{value}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', minHeight: 20 }}>{detail}</div>
      </div>
    </Card>
  );
}

function PlaceholderPanel({ title, description, icon }) {
  return (
    <Card>
      <div style={{ padding: 18, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{
          width: 34, height: 34, borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-alt)', border: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
          flexShrink: 0,
        }}>
          <Icon name={icon} size={17} />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{title}</h3>
          <p style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.5 }}>{description}</p>
        </div>
      </div>
    </Card>
  );
}

export default function HomePage({ user, unread = 0, onNavigate }) {
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      const today = new Date();
      const start = dateKey(today);
      const end = dateKey(addDays(today, 5));
      try {
        const [mailData, reminderData, shiftData] = await Promise.all([
          api('/mail-reporter/emails?limit=8').catch(() => []),
          api('/reminders/active').catch(() => []),
          api(`/schedule/shifts?start_date=${start}&end_date=${end}`).catch(() => []),
        ]);
        if (cancelled) return;
        setEmails(mailData || []);
        setReminders(reminderData || []);
        setShifts(shiftData || []);
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load home data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const userNow = useMemo(() => localNow(user?.timezone), [now, user?.timezone]);
  const todayLabel = userNow.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const unresolvedEmails = emails.filter(e => e.status !== 'solved');
  const blockedEmails = emails.filter(e => e.status === 'blocked').length;
  const uncheckedEmails = emails.filter(e => e.status === 'unchecked').length;

  const currentShift = useMemo(() => {
    const currentUserId = String(user?.id || '');
    const ts = Date.now();
    return shifts.find(s => String(s.user_id) === currentUserId && shiftStartMs(s) <= ts && shiftEndMs(s) >= ts)
      || shifts.find(s => String(s.user_id) === currentUserId && s.date === dateKey(new Date()))
      || null;
  }, [shifts, user?.id]);

  const nextShift = useMemo(() => {
    const ts = Date.now();
    return [...shifts]
      .filter(s => shiftStartMs(s) > ts)
      .sort((a, b) => shiftStartMs(a) - shiftStartMs(b))[0] || null;
  }, [shifts]);

  const nextEngineer = nextShift?.user?.display_name || (nextShift ? 'Assigned engineer' : 'No upcoming shift');
  const greetingPrefix = greetingFor(userNow);
  const displayName = user?.display_name || user?.username || 'engineer';

  const shiftDetail = currentShift
    ? `${currentShift.shift_type} shift${currentShift.start_time ? ` · ${fmtTime(currentShift.start_time)}-${fmtTime(currentShift.end_time)}` : ''}`
    : 'No active shift found for you today';

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        gap: 18, flexWrap: 'wrap', paddingBottom: 10, borderBottom: '1px solid var(--border-light)',
      }}>
        <div style={{ maxWidth: 900 }}>
          <div className="t-eyebrow">{todayLabel} · {userNow.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
          <h1 style={{
            margin: '8px 0 8px',
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(34px, 5vw, 58px)',
            fontWeight: 600,
            letterSpacing: '-0.045em',
            lineHeight: 0.98,
          }}>
            {greetingPrefix},{' '}
            <span style={{ color: 'var(--accent)' }}>{displayName}</span>.
          </h1>
          <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 17, lineHeight: 1.45 }}>
            {shiftDetail}. {unresolvedEmails.length > 0
              ? `${unresolvedEmails.length} mail item${unresolvedEmails.length === 1 ? '' : 's'} need attention.`
              : 'No unresolved mail items in the latest queue.'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button icon="calendar" onClick={() => onNavigate?.('schedule')}>My shifts</Button>
          <Button variant="primary" icon="mail" onClick={() => onNavigate?.('mail')}>Open mail</Button>
        </div>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
        <MetricCard label="Mail queue" value={unresolvedEmails.length} detail={`${uncheckedEmails} unchecked · ${blockedEmails} blocked`} icon="mail" color="var(--accent)" />
        <MetricCard label="Active reminders" value={reminders.length} detail={reminders[0] ? `Next: ${reminders[0].title}` : 'Nothing scheduled'} icon="bell" color="var(--warning)" />
        <MetricCard label="Unread notices" value={unread} detail={unread > 0 ? 'Check notification panel' : 'All clear'} icon="message" color="var(--success)" />
        <MetricCard label="Next engineer" value={nextShift ? nextEngineer.split(' ')[0] : '—'} detail={nextShift ? `${nextShift.date} · ${fmtTime(nextShift.start_time) || nextShift.shift_type}` : 'No shift in next 5 days'} icon="user" color="var(--accent)" />
      </section>

      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))',
        gap: 16,
      }}>
        <Card
          accent="var(--accent)"
          header={<><Icon name="mail" size={18} color="var(--accent)" /><h2 style={{ margin: 0, fontSize: 22 }}>Operational mail</h2><span style={{ flex: 1 }} /><Button size="sm" variant="ghost" iconRight="arrowRight" onClick={() => onNavigate?.('mail')}>Open</Button></>}
        >
          {loading ? (
            <div style={{ padding: 34, color: 'var(--text-muted)' }}>Loading operational queue…</div>
          ) : unresolvedEmails.length === 0 ? (
            <EmptyState title="Mail queue is clear" subtitle="Latest synced emails do not need triage." />
          ) : (
            <div>
              {unresolvedEmails.slice(0, 5).map(email => (
                <div key={email.id} style={{
                  padding: '14px 18px',
                  display: 'grid',
                  gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                  gap: 12,
                  alignItems: 'center',
                  borderBottom: '1px solid var(--border-light)',
                }}>
                  <StatusMarker status={email.status} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 650, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.subject || '(no subject)'}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.sender || 'unknown sender'} · {email.mailbox_email || 'mailbox'} · {fmtSince(email.created_at)}
                    </div>
                  </div>
                  <Badge color={statusTone(email.status)}>{email.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card
            accent="var(--success)"
            header={<><Icon name="calendar" size={18} color="var(--success)" /><h2 style={{ margin: 0, fontSize: 22 }}>Shift context</h2></>}
          >
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="t-eyebrow">You</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                  <Avatar name={user?.display_name || user?.username} color={user?.name_color} />
                  <div>
                    <div style={{ fontWeight: 700 }}>{user?.display_name || user?.username}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{shiftDetail}</div>
                  </div>
                </div>
              </div>
              <div style={{ height: 1, background: 'var(--border-light)' }} />
              <div>
                <div className="t-eyebrow">Next engineer</div>
                {nextShift ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <Avatar name={nextShift.user?.display_name || nextEngineer} color={nextShift.user?.name_color || 'var(--accent)'} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{nextEngineer}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{nextShift.date} · {nextShift.shift_type} {fmtTime(nextShift.start_time)}</div>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>No upcoming shift found in the next few days.</p>
                )}
              </div>
            </div>
          </Card>

          <PlaceholderPanel title="Incidents:" icon="flame" description="Grafana alert webhook integration will surface active incidents here." />
          <PlaceholderPanel title="Tickets:" icon="ticket" description="Zammad sync will show active ticket load, SLA risk, and Telegram-linked cases." />
          <PlaceholderPanel title="Runbooks:" icon="bookmark" description="Runbook recommendations will appear here once the knowledge module is connected." />
        </div>
      </section>

      {error && <Tag style={{ color: 'var(--danger)' }}>{error}</Tag>}
    </div>
  );
}

function StatusMarker({ status }) {
  const color = {
    unchecked: 'var(--warning)',
    on_pause: 'var(--accent)',
    blocked: 'var(--danger)',
    solved: 'var(--success)',
  }[status] || 'var(--text-muted)';
  return <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'block' }} />;
}
