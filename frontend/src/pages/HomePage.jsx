import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useLang } from '../components/LangContext';
import { Avatar, Badge, Button, Card, EmptyState, Tag } from '../components/UI';
import { Icon } from '../components/Icons';
import EmailDetailModal from '../components/EmailDetailModal';
import TicketDetailModal, { stateLabel, fmtDuration } from '../components/TicketDetailModal';

// Home ticket ordering: new+open first, then in_progress, on_pause, closed.
const STATE_RANK = { new: 0, open: 0, in_progress: 1, on_pause: 2, closed: 3 };
const STATE_BADGE = { new: 'blue', open: 'blue', in_progress: 'yellow', on_pause: 'orange', closed: 'green' };
const ATTN_SECTION_MAX = 5;

function ticketTs(tk) {
  if (!tk.state_changed_at) return 0;
  const raw = `${tk.state_changed_at}`;
  return new Date(raw.endsWith('Z') || raw.includes('+') ? raw : `${raw}Z`).getTime();
}

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

function greetingFor(date, lang) {
  const hour = date.getHours();
  if (lang === 'ru') {
    if (hour < 5) return 'Доброй ночи';
    if (hour < 12) return 'Доброе утро';
    if (hour < 18) return 'Добрый день';
    return 'Добрый вечер';
  }
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function fmtShiftTime(value, date, tz) {
  if (!value) return '';
  try {
    const d = new Date(`${date}T${value}${String(value).length === 5 ? ':00' : ''}Z`);
    return d.toLocaleTimeString('en-GB', { timeZone: tz || 'UTC', hour: '2-digit', minute: '2-digit' });
  } catch {
    return String(value).slice(0, 5);
  }
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

function plural(count, one, many) {
  return count === 1 ? one : many;
}

function shiftStartMs(shift) {
  const start = shift.start_time || '00:00';
  return new Date(`${shift.date}T${start}${String(start).length === 5 ? ':00' : ''}Z`).getTime();
}

function shiftEndMs(shift) {
  const start = shift.start_time || '00:00';
  const end = shift.end_time || start;
  const base = new Date(`${shift.date}T${end}${String(end).length === 5 ? ':00' : ''}Z`);
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

function Stat({ icon, color, value, label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Icon name={icon} size={14} color={color} />
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600, color: 'var(--text)', lineHeight: 1 }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
    </div>
  );
}

function AttnSection({ icon, color, label, count, showAll, onShowAll, children }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: '1px solid var(--border-light)' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '11px 18px',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={13} color="var(--text-muted)" />
        <Icon name={icon} size={14} color={color} />
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <span style={{
          fontSize: 11, fontWeight: 700, fontFamily: 'var(--font-mono)',
          color: count > 0 ? color : 'var(--text-muted)',
          background: 'var(--surface-alt)', padding: '1px 8px', borderRadius: 10,
        }}>{count}</span>
        <span style={{ flex: 1 }} />
        {count > ATTN_SECTION_MAX && (
          <button
            onClick={(e) => { e.stopPropagation(); onShowAll?.(); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 11, color: 'var(--text-muted)', fontFamily: 'inherit',
            }}
          >{showAll} →</button>
        )}
      </div>
      {open && children}
    </div>
  );
}

export default function HomePage({ user, unread = 0, onNavigate }) {
  const { lang, t: tr } = useLang();
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [error, setError] = useState('');
  const [openEmailId, setOpenEmailId] = useState(null);
  const [openTicketId, setOpenTicketId] = useState(null);
  const [firingList, setFiringList] = useState([]);

  const loadTickets = () => api('/tickets/board?limit=50').then(d => setTickets(d || [])).catch(() => {});
  const loadAlerts = () => api('/alerts?status=firing&limit=50').then(d => setFiringList(d || [])).catch(() => {});

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Keep tickets + alerts live — both arrive via webhooks within seconds.
  useEffect(() => {
    loadAlerts();
    const timer = setInterval(() => { loadTickets(); loadAlerts(); }, 30000);
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
        const [mailData, reminderData, shiftData, ticketData] = await Promise.all([
          api('/mail-reporter/emails?limit=50').catch(() => []),
          api('/reminders/active').catch(() => []),
          api(`/schedule/shifts?start_date=${start}&end_date=${end}`).catch(() => []),
          api('/tickets/board?limit=50').catch(() => []),
        ]);
        if (cancelled) return;
        setEmails(mailData || []);
        setReminders(reminderData || []);
        setShifts(shiftData || []);
        setTickets(ticketData || []);
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
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  const todayLabel = userNow.toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  const unresolvedEmails = emails.filter(e => e.status !== 'solved');
  const blockedEmails = emails.filter(e => e.status === 'blocked').length;
  const uncheckedEmails = emails.filter(e => e.status === 'unchecked').length;

  // Unsolved tickets, ordered new+open → in_progress → on_pause, recent-first within a group.
  const attnTickets = useMemo(() => {
    return tickets
      .filter(tk => tk.bucket !== 'closed')
      .sort((a, b) => {
        const ra = STATE_RANK[a.state] ?? 1;
        const rb = STATE_RANK[b.state] ?? 1;
        if (ra !== rb) return ra - rb;
        return ticketTs(b) - ticketTs(a);
      });
  }, [tickets]);

  const uncheckedList = useMemo(() => emails.filter(e => e.status === 'unchecked'), [emails]);
  const attnTotal = firingList.length + attnTickets.length + uncheckedList.length;

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

  const nextEngineer = nextShift?.user?.display_name || (nextShift ? tr('homeAssignedEngineer') : tr('homeNoUpcomingShift'));
  const greetingPrefix = greetingFor(userNow, lang);
  const displayName = user?.display_name || user?.username || tr('homeEngineerFallback');

  const shiftDetail = currentShift
    ? `${tr(`shift_${currentShift.shift_type}`)}${currentShift.start_time ? ` · ${fmtShiftTime(currentShift.start_time, currentShift.date, user?.timezone)}-${fmtShiftTime(currentShift.end_time, currentShift.date, user?.timezone)}` : ''}`
    : tr('homeNoActiveShift');
  const mailAttention = unresolvedEmails.length > 0
    ? `${unresolvedEmails.length} ${plural(unresolvedEmails.length, tr('homeMailItem'), tr('homeMailItems'))} ${tr('homeNeedAttention')}`
    : tr('homeNoMailItems');

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
            {shiftDetail}. {mailAttention}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button icon="calendar" onClick={() => onNavigate?.('schedule')}>{tr('homeMyShifts')}</Button>
          <Button variant="primary" icon="mail" onClick={() => onNavigate?.('mail')}>{tr('homeOpenMail')}</Button>
        </div>
      </section>

      {/* Slim stat strip — replaces the old full-size metric cards */}
      <section style={{
        display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap',
        padding: '9px 16px', border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius)', background: 'var(--surface-alt)',
      }}>
        <Stat icon="mail" color="var(--accent)" value={unresolvedEmails.length} label={tr('homeMailQueue')} />
        <Stat icon="bell" color="var(--warning)" value={reminders.length} label={tr('homeActiveReminders')} />
        <Stat icon="message" color="var(--success)" value={unread} label={tr('homeUnreadNotices')} />
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {tr('homeNextEngineer')}: <b style={{ color: 'var(--text-secondary)' }}>{nextShift ? nextEngineer.split(' ')[0] : '—'}</b>
          {nextShift ? ` · ${nextShift.date} ${fmtShiftTime(nextShift.start_time, nextShift.date, user?.timezone)}` : ''}
        </span>
      </section>

      <section style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <Card
          accent="var(--warning)"
          style={{ flex: '2 1 480px', minWidth: 0 }}
          header={<><Icon name="alertTriangle" size={18} color="var(--warning)" /><h2 style={{ margin: 0, fontSize: 22 }}>{tr('homeAttention')}</h2><span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>{attnTotal}</span></>}
        >
          {loading ? (
            <div style={{ padding: 34, color: 'var(--text-muted)' }}>{tr('homeLoadingQueue')}</div>
          ) : attnTotal === 0 ? (
            <EmptyState title={tr('homeAttnEmpty')} />
          ) : (
            <div>
              {firingList.length > 0 && (
                <AttnSection icon="siren" color="var(--danger)" label={tr('homeAttnAlerts')} count={firingList.length} showAll={tr('homeShowAll')} onShowAll={() => onNavigate?.('alerts')}>
                  {firingList.slice(0, ATTN_SECTION_MAX).map(a => (
                    <div
                      key={a.id}
                      onClick={() => onNavigate?.('alerts')}
                      style={{
                        padding: '9px 18px 9px 39px', display: 'grid',
                        gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                        cursor: 'pointer', transition: 'background 120ms ease',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-alt)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <Badge color="red">{a.severity || 'firing'}</Badge>
                      <div style={{ minWidth: 0, fontWeight: 650, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {a.alertname || '(unnamed alert)'}
                        {a.summary && <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>{a.summary}</span>}
                      </div>
                      <div style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--danger)', fontWeight: 600 }}>
                        {fmtDuration(a.starts_at || a.received_at, lang)}
                      </div>
                    </div>
                  ))}
                </AttnSection>
              )}

              <AttnSection icon="ticket" color="var(--accent)" label={tr('homeAttnTickets')} count={attnTickets.length} showAll={tr('homeShowAll')} onShowAll={() => onNavigate?.('tickets')}>
                {attnTickets.slice(0, ATTN_SECTION_MAX).map(tk => (
                  <div
                    key={tk.id}
                    onClick={() => setOpenTicketId(tk.id)}
                    style={{
                      padding: '9px 18px 9px 39px', display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                      cursor: 'pointer', transition: 'background 120ms ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-alt)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <Badge color={STATE_BADGE[tk.state] || 'gray'}>{stateLabel(tk.state, tr)}</Badge>
                    <div style={{ minWidth: 0, fontWeight: 650, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <span style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginRight: 6, fontWeight: 400 }}>#{tk.number || tk.id}</span>
                      {tk.title || '—'}
                    </div>
                    <div style={{ textAlign: 'right', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' }}>
                      {fmtDuration(tk.state_changed_at, lang)} · {tr('tkInStatus')}
                    </div>
                  </div>
                ))}
              </AttnSection>

              <AttnSection icon="mail" color="var(--warning)" label={tr('homeAttnUnchecked')} count={uncheckedList.length} showAll={tr('homeShowAll')} onShowAll={() => onNavigate?.('mail')}>
                {uncheckedList.slice(0, ATTN_SECTION_MAX).map(email => (
                  <div
                    key={email.id}
                    onClick={() => setOpenEmailId(email.id)}
                    style={{
                      padding: '9px 18px 9px 39px', display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 10, alignItems: 'center',
                      cursor: 'pointer', transition: 'background 120ms ease',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-alt)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <StatusMarker status={email.status} />
                    <div style={{ minWidth: 0, fontWeight: 650, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {email.subject || '(no subject)'}
                      <span style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 400, marginLeft: 8 }}>{email.sender || ''}</span>
                    </div>
                    <div style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' }}>{fmtSince(email.created_at)}</div>
                  </div>
                ))}
              </AttnSection>

            </div>
          )}
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, flex: '1 1 300px', minWidth: 0 }}>
          <Card
            accent="var(--success)"
            header={<><Icon name="calendar" size={18} color="var(--success)" /><h2 style={{ margin: 0, fontSize: 22 }}>{tr('homeShiftContext')}</h2></>}
          >
            <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="t-eyebrow">{tr('homeYou')}</div>
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
                <div className="t-eyebrow">{tr('homeNextEngineer')}</div>
                {nextShift ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
                    <Avatar name={nextShift.user?.display_name || nextEngineer} color={nextShift.user?.name_color || 'var(--accent)'} />
                    <div>
                      <div style={{ fontWeight: 700 }}>{nextEngineer}</div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>{nextShift.date} · {tr(`shift_${nextShift.shift_type}`)} {fmtShiftTime(nextShift.start_time, nextShift.date, user?.timezone)}</div>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{tr('homeNoShiftNextDays')}</p>
                )}
              </div>
            </div>
          </Card>

        </div>
      </section>

      {error && <Tag style={{ color: 'var(--danger)' }}>{error}</Tag>}

      {openEmailId && (
        <EmailDetailModal
          emailId={openEmailId}
          onClose={() => setOpenEmailId(null)}
          onChange={(updated) => setEmails(prev => prev.map(e => e.id === updated.id ? { ...e, ...updated } : e))}
        />
      )}

      {openTicketId && (
        <TicketDetailModal
          ticketId={openTicketId}
          onClose={() => setOpenTicketId(null)}
          onError={(message) => setError(message)}
          onChanged={loadTickets}
        />
      )}
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
