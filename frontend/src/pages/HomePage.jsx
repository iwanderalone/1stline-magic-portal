import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useLang } from '../components/LangContext';
import EmailDetailModal from '../components/EmailDetailModal';
import TicketDetailModal, { stateLabel } from '../components/TicketDetailModal';

// Home shows the head of every queue and summarises the tail — nothing here
// scrolls or renders an unbounded list.
const CARD_ROWS = 5;
const CARD_MIN_HEIGHT = 276;
const TICKET_OVERDUE_DAYS = 14;   // past this, a ticket's age turns --danger
const STATE_RANK = { new: 0, open: 0, in_progress: 1, on_pause: 2, closed: 3 };

// Values are mono with tabular figures; words are Inter. The serif display
// family is deliberately absent here — it makes the page read as a different
// product.
const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };

const dateKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
};

function parseTs(value) {
  if (!value) return 0;
  const raw = String(value);
  return new Date(raw.endsWith('Z') || raw.includes('+') ? raw : `${raw}Z`).getTime();
}

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

/** Compact age: 45s / 12m / 3h / 22d. Null when there is nothing to show. */
function fmtAge(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return null;
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const ageSince = (value) => (value ? (Date.now() - parseTs(value)) / 1000 : null);

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

const hostOf = (url) => String(url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const prettyGroup = (name) => String(name || '').replace(/[_-]+/g, ' ');

/** Monday 00:00 of the week containing `d`. */
function weekStart(d) {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy;
}

/* ── primitives ──────────────────────────────────────────────── */

function Mono({ children, size = 12, color = 'var(--text-muted)', weight = 400, style }) {
  return (
    <span style={{ ...MONO, fontSize: size, color, fontWeight: weight, whiteSpace: 'nowrap', ...style }}>
      {children}
    </span>
  );
}

function Dot({ color }) {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />;
}

function AvatarChip({ name, color, size = 32 }) {
  return (
    <span style={{
      width: size, height: size, borderRadius: 10, flexShrink: 0,
      background: color || 'var(--accent)', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700,
    }}>{String(name || '?').trim().charAt(0).toUpperCase()}</span>
  );
}

function LinkButton({ children, onClick, size = 12, weight = 400, color = 'var(--text-muted)' }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'none', border: 'none', padding: 0, cursor: 'pointer',
        fontFamily: 'var(--font-sans)', fontSize: size, fontWeight: weight,
        color: hover ? 'var(--accent)' : color, whiteSpace: 'nowrap',
      }}
    >{children}</button>
  );
}

function HeroButton({ children, primary, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        padding: '9px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
        fontFamily: 'var(--font-sans)', borderRadius: 'var(--radius-sm)',
        transition: 'all 140ms ease',
        transform: primary && hover ? 'translateY(-1px)' : 'none',
        background: primary ? (hover ? 'var(--accent-hover)' : 'var(--accent)') : 'var(--surface)',
        color: primary ? 'var(--accent-on)' : (hover ? 'var(--accent)' : 'var(--text)'),
        border: primary ? '1px solid transparent' : `1px solid ${hover ? 'var(--accent)' : 'var(--border)'}`,
        boxShadow: primary ? '0 2px 10px var(--accent-glow)' : 'none',
      }}
    >{children}</button>
  );
}

function CardShell({ children, style }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      background: 'var(--surface)', boxShadow: 'var(--shadow)',
      display: 'flex', flexDirection: 'column', minWidth: 0, ...style,
    }}>{children}</div>
  );
}

function CardHeader({ dot, title, count, link, onLink, extra }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '14px 16px', borderBottom: '1px solid var(--border-light)',
    }}>
      {dot && <Dot color={dot} />}
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</span>
      {count != null && <Mono>{count}</Mono>}
      <span style={{ flex: 1 }} />
      {extra}
      {link && <LinkButton onClick={onLink}>{link} →</LinkButton>}
    </div>
  );
}

function AllClear({ line }) {
  const { t: tr } = useLang();
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 8, padding: 24, textAlign: 'center', minWidth: 0,
    }}>
      <span style={{ fontSize: 22 }}>✨</span>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>{tr('homeAllClear')}</div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: '22ch', lineHeight: 1.5 }}>{line}</div>
    </div>
  );
}

function QueueRow({ title, sub, value, valueTone, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 8,
        alignItems: 'baseline', padding: '10px 16px', cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', marginTop: 3,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sub}</div>
      </div>
      <Mono size={12} color={valueTone || 'var(--text-muted)'} style={{ textAlign: 'right' }}>{value}</Mono>
    </div>
  );
}

function QueueCard({ dot, title, count, link, onLink, rows, footer, emptyLine }) {
  const empty = rows.length === 0;
  return (
    // The three columns are one block: equal height, headers on one line and
    // footers on another, so the eye can scan across them.
    <CardShell style={{ minHeight: CARD_MIN_HEIGHT, height: '100%' }}>
      <CardHeader dot={dot} title={title} count={count} link={link} onLink={onLink} />
      {empty ? <AllClear line={emptyLine} /> : (
        <div style={{ padding: '4px 0' }}>
          {rows.map(row => <QueueRow key={row.key} {...row} />)}
        </div>
      )}
      <div style={{ flex: 1 }} />
      {footer && (
        <div style={{
          padding: '12px 16px', borderTop: '1px solid var(--border-light)',
          fontSize: 12, color: 'var(--text-muted)',
        }}>{footer}</div>
      )}
    </CardShell>
  );
}

function RailRow({ label, value, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ flex: 1 }} />
      <span style={{
        fontSize: 12, color: 'var(--text)', textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '64%',
        ...(mono ? MONO : null),
      }}>{value}</span>
    </div>
  );
}

/* ── page ────────────────────────────────────────────────────── */

export default function HomePage({ user, onNavigate }) {
  const { lang, t: tr } = useLang();
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [emails, setEmails] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [shifts, setShifts] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [statusBoard, setStatusBoard] = useState(null);
  const [statusSummary, setStatusSummary] = useState(null);
  const [checkedAt, setCheckedAt] = useState(null);
  const [error, setError] = useState('');
  const [openTicketId, setOpenTicketId] = useState(null);
  const [openEmailId, setOpenEmailId] = useState(null);
  const [weekScope, setWeekScope] = useState('mine');   // mine | team

  const loadLive = () => {
    api('/tickets/board?limit=100').then(d => setTickets(d || [])).catch(() => {});
    api('/status').then(d => setStatusBoard(d)).catch(() => {});
    api('/status/summary').then(d => setStatusSummary(d)).catch(() => {});
    api('/mail-reporter/emails?limit=200').then(d => setEmails(d || [])).catch(() => {});
    setCheckedAt(Date.now());
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Tickets arrive by webhook and probe state is pushed by Prometheus, so the
  // live blocks refresh on their own.
  useEffect(() => {
    const timer = setInterval(loadLive, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError('');
      const today = new Date();
      // Two weeks back so the recap can compare with last week, a few days
      // forward for "next engineer".
      const start = dateKey(addDays(today, -13));
      const end = dateKey(addDays(today, 5));
      try {
        const [mailData, reminderData, shiftData, ticketData, board, summary] = await Promise.all([
          api('/mail-reporter/emails?limit=200').catch(() => []),
          api('/reminders/active').catch(() => []),
          api(`/schedule/shifts?start_date=${start}&end_date=${end}`).catch(() => []),
          api('/tickets/board?limit=100').catch(() => []),
          api('/status').catch(() => null),
          api('/status/summary').catch(() => null),
        ]);
        if (cancelled) return;
        setEmails(mailData || []);
        setReminders(reminderData || []);
        setShifts(shiftData || []);
        setTickets(ticketData || []);
        setStatusBoard(board);
        setStatusSummary(summary);
        setCheckedAt(Date.now());
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

  /* — queues — */

  const allTargets = useMemo(() => (
    (statusBoard?.groups || []).flatMap(g => g.targets.map(x => ({ ...x, group: g.name })))
  ), [statusBoard]);

  // The card counts down targets only, so the verdict sentence and the card
  // can never disagree; targets nobody has heard from go in the footer line.
  const downTargets = useMemo(() => (
    allTargets
      .filter(x => x.up === false)
      .sort((a, b) => (b.in_state_seconds || 0) - (a.in_state_seconds || 0))
  ), [allTargets]);
  const staleTargets = useMemo(() => allTargets.filter(x => x.up !== false && x.stale), [allTargets]);

  const openTickets = useMemo(() => (
    tickets
      .filter(tk => tk.bucket !== 'closed')
      .sort((a, b) => {
        const ra = STATE_RANK[a.state] ?? 1;
        const rb = STATE_RANK[b.state] ?? 1;
        if (ra !== rb) return ra - rb;
        return parseTs(b.state_changed_at) - parseTs(a.state_changed_at);
      })
  ), [tickets]);

  const mailQueue = useMemo(() => (
    emails
      .filter(e => e.status === 'unchecked')
      .sort((a, b) => parseTs(b.created_at) - parseTs(a.created_at))
  ), [emails]);

  const attnTotal = downTargets.length + openTickets.length + mailQueue.length;

  /* — shift context — */

  const me = String(user?.id || '');
  const myShiftNow = useMemo(() => {
    const ts = Date.now();
    return shifts.find(s => String(s.user_id) === me && shiftStartMs(s) <= ts && shiftEndMs(s) >= ts) || null;
  }, [shifts, me]);

  const myNextShift = useMemo(() => {
    const ts = Date.now();
    return [...shifts].filter(s => String(s.user_id) === me && shiftStartMs(s) > ts)
      .sort((a, b) => shiftStartMs(a) - shiftStartMs(b))[0] || null;
  }, [shifts, me]);

  const onNowShift = useMemo(() => {
    const ts = Date.now();
    return shifts.find(s => shiftStartMs(s) <= ts && shiftEndMs(s) >= ts) || null;
  }, [shifts]);

  const nextUpShift = useMemo(() => {
    const ts = Date.now();
    return [...shifts].filter(s => shiftStartMs(s) > ts).sort((a, b) => shiftStartMs(a) - shiftStartMs(b))[0] || null;
  }, [shifts]);

  const todayShifts = useMemo(() => {
    const today = dateKey(new Date());
    return shifts.filter(s => s.date === today).sort((a, b) => shiftStartMs(a) - shiftStartMs(b));
  }, [shifts]);

  /* — this week, against the same slice of last week — */

  const thisWeekStart = useMemo(() => weekStart(new Date()), [now]);
  const lastWeekStart = useMemo(() => addDays(thisWeekStart, -7), [thisWeekStart]);
  const lastWeekCutoff = useMemo(() => addDays(new Date(), -7), [now]);

  const recap = useMemo(() => {
    const mine = weekScope === 'mine';
    const isMineTicket = (tk) => {
      const who = String(tk.assignee || '').trim().toLowerCase();
      return !!who && (who === String(user?.display_name || '').toLowerCase()
        || who === String(user?.username || '').toLowerCase());
    };
    const isMineMail = (e) => (
      !!e.solved_by && String(e.solved_by).toLowerCase() === String(user?.username || '').toLowerCase()
    );
    const count = (list, tsOf, isMine, from, to) => list.filter(x => {
      const ts = tsOf(x);
      return ts >= from.getTime() && ts <= to.getTime() && (!mine || isMine(x));
    }).length;

    const solved = emails.filter(e => e.status === 'solved' && e.solved_at);
    const closed = tickets.filter(tk => tk.bucket === 'closed' && tk.state_changed_at);
    const worked = shifts.filter(s => parseTs(`${s.date}T00:00:00`) <= Date.now());
    const nowDate = new Date();

    return [
      {
        key: 'mail',
        label: tr('homeRecapMail'),
        value: count(solved, e => parseTs(e.solved_at), isMineMail, thisWeekStart, nowDate),
        prev: count(solved, e => parseTs(e.solved_at), isMineMail, lastWeekStart, lastWeekCutoff),
      },
      {
        key: 'tickets',
        label: tr('homeRecapTickets'),
        value: count(closed, tk => parseTs(tk.state_changed_at), isMineTicket, thisWeekStart, nowDate),
        prev: count(closed, tk => parseTs(tk.state_changed_at), isMineTicket, lastWeekStart, lastWeekCutoff),
      },
      {
        key: 'shifts',
        label: tr('homeRecapShifts'),
        value: count(worked, s => parseTs(`${s.date}T00:00:00`), s => String(s.user_id) === me, thisWeekStart, nowDate),
        prev: count(worked, s => parseTs(`${s.date}T00:00:00`), s => String(s.user_id) === me, lastWeekStart, lastWeekCutoff),
      },
    ];
  }, [emails, tickets, shifts, weekScope, me, user?.username, user?.display_name, thisWeekStart, lastWeekStart, lastWeekCutoff, tr]);

  const weekRange = `${thisWeekStart.toLocaleDateString(locale, { weekday: 'short' })}–${userNow.toLocaleDateString(locale, { weekday: 'short' })}`;

  /* — verdict line — */

  const pl = (n, key) => {
    if (lang !== 'ru') return tr(`${key}${n === 1 ? '1' : '2'}`);
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return tr(`${key}1`);
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return tr(`${key}2`);
    return tr(`${key}5`);
  };
  // The whole fact is bold and coloured — "3 services down", not a red 3
  // followed by grey words, which reads like a typo.
  const clause = (n, key, zeroKey, danger = false) => (
    n > 0
      ? <b style={{ color: danger ? 'var(--danger)' : 'var(--text)', fontWeight: 600 }}>{n} {pl(n, key)}</b>
      : tr(zeroKey)
  );

  const displayName = user?.display_name || user?.username || tr('homeEngineerFallback');
  const shiftUntil = myShiftNow ? fmtShiftTime(myShiftNow.end_time, myShiftNow.date, user?.timezone) : null;
  const daysToNextShift = myNextShift
    ? Math.max(0, Math.round((parseTs(`${myNextShift.date}T00:00:00`) - Date.now()) / 86400000))
    : null;

  /* — card contents — */

  // "Checked 2 min ago" / "Checked just now" — never a raw "0s".
  const checkedAgo = checkedAt ? (Date.now() - checkedAt) / 1000 : null;
  const freshness = checkedAgo == null
    ? ''
    : `${tr('homeChecked')} ${checkedAgo < 60 ? tr('homeJustNow') : fmtAge(checkedAgo)}.`;

  // A link to zero things reads as a bug; fall back to the module name.
  const allLink = (total, fallbackKey) => (total > 0 ? `${tr('homeAll')} ${total}` : tr(fallbackKey));

  // in_state_seconds is time since the probe last flipped — the length of the
  // outage. Never fall back to the sample age: that is the age of the last
  // poll, which is identical for every target and says nothing about the
  // incident. Unknown means the duration is simply omitted.
  const serviceRows = downTargets.slice(0, CARD_ROWS).map(x => {
    const outage = fmtAge(x.in_state_seconds);
    return {
      key: x.instance,
      title: hostOf(x.instance),
      sub: `${prettyGroup(x.group)} · ${tr('homeDownFor')}${outage ? ` ${outage}` : ''}`,
      value: x.http_status || tr('homeStatusNoReply'),
      valueTone: 'var(--danger)',
      onClick: () => onNavigate?.('status'),
    };
  });

  const ticketRows = openTickets.slice(0, CARD_ROWS).map(tk => {
    const age = ageSince(tk.zammad_created_at || tk.state_changed_at);
    return {
      key: tk.id,
      title: tk.title || tr('homeNoSubject'),
      // Duration appears exactly once per row — here it is the right column.
      sub: <>
        <span style={MONO}>#{tk.number || tk.id}</span>
        {` · ${String(stateLabel(tk.state, tr)).toLowerCase()}`}
      </>,
      value: fmtAge(age) || '',
      valueTone: age > TICKET_OVERDUE_DAYS * 86400 ? 'var(--danger)' : 'var(--text-muted)',
      onClick: () => setOpenTicketId(tk.id),
    };
  });

  const mailRows = mailQueue.slice(0, CARD_ROWS).map(email => ({
    key: email.id,
    title: email.subject || tr('homeNoSubject'),
    sub: email.sender || '',
    value: fmtAge(ageSince(email.created_at)) || '',
    onClick: () => setOpenEmailId(email.id),
  }));

  const totalTargets = statusSummary?.total ?? allTargets.length;
  const upTargets = Math.max(0, totalTargets - downTargets.length - staleTargets.length);
  const serviceFooter = [
    downTargets.length > CARD_ROWS ? `${downTargets.length - CARD_ROWS} ${tr('homeMoreDown')}` : null,
    `${upTargets} ${tr('homeOf')} ${totalTargets} ${tr('homeUpTail')}`,
    staleTargets.length ? `${staleTargets.length} ${tr('homeNoDataTail')}` : null,
  ].filter(Boolean).join(' · ');

  const oldestTicketAge = fmtAge(ageSince(openTickets[openTickets.length - 1]?.zammad_created_at));
  const ticketFooter = [
    openTickets.length > CARD_ROWS ? `${openTickets.length - CARD_ROWS} ${tr('homeMore')}` : null,
    oldestTicketAge ? `${tr('homeOldest')} ${oldestTicketAge}` : null,
  ].filter(Boolean).join(' · ');

  const todayKey = dateKey(new Date());
  const solvedToday = emails.filter(e => (
    e.status === 'solved' && e.solved_at && dateKey(new Date(parseTs(e.solved_at))) === todayKey
  )).length;
  const onPause = emails.filter(e => e.status === 'on_pause').length;
  const mailFooter = [
    mailQueue.length > CARD_ROWS ? `${mailQueue.length - CARD_ROWS} ${tr('homeMore')}` : null,
    `${solvedToday} ${tr('homeSolvedToday')}`,
    onPause ? `${onPause} ${tr('homeOnPause')}` : null,
  ].filter(Boolean).join(' · ');

  /* — render — */

  return (
    <div className="fade-in" style={{
      maxWidth: 1240, margin: '0 auto', padding: '28px 32px 72px',
      display: 'flex', flexDirection: 'column', gap: 28, fontFamily: 'var(--font-sans)',
    }}>
      {/* 1. Status hero */}
      <section className="home-hero" style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px 300px', gap: 24, alignItems: 'start',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '.08em', color: 'var(--text-muted)',
          }}>
            {userNow.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}
            <span style={MONO}>{userNow.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>

          <h1 style={{
            margin: '6px 0 0', fontFamily: 'var(--font-sans)', fontSize: 28, fontWeight: 600,
            letterSpacing: '-0.02em', lineHeight: 1.2, color: 'var(--text)',
          }}>
            {greetingFor(userNow, lang)}, <span style={{ color: 'var(--accent)' }}>{displayName}</span>.
          </h1>

          <p style={{
            margin: '10px 0 0', fontSize: 17, lineHeight: 1.5,
            color: 'var(--text-secondary)', maxWidth: '54ch', textWrap: 'pretty',
          }}>
            {clause(downTargets.length, 'homePlSvcDown', 'homeVAllUp', true)}, {clause(openTickets.length, 'homePlTicketOpen', 'homeVNoTickets')}, {clause(mailQueue.length, 'homePlMailUnchecked', 'homeVMailClear')} — {tr('homeVAnd')} {myShiftNow
              ? `${tr('homeVOnShift')} ${shiftUntil}`
              : tr('homeVOffShift')}.
          </p>

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <HeroButton primary onClick={() => onNavigate?.('mail')}>📧 {tr('homeOpenMail')}</HeroButton>
            <HeroButton onClick={() => onNavigate?.('schedule')}>📅 {tr('homeMyShifts')}</HeroButton>
          </div>
        </div>

        {/* Your shift rail */}
        <CardShell>
          <div style={{
            padding: '10px 14px', borderBottom: '1px solid var(--border-light)',
            fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
            letterSpacing: '.1em', color: 'var(--text-muted)',
          }}>{tr('homeYourShift')}</div>

          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AvatarChip name={displayName} color={user?.name_color} size={30} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                  {myShiftNow ? `${tr('homeOnShift')} · ${tr('homeUntil')} ${shiftUntil}` : tr('homeOffShiftToday')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {myShiftNow
                    ? tr(`shift_${myShiftNow.shift_type}`)
                    : (daysToNextShift != null
                      ? `${tr('homeNextIn')} ${daysToNextShift} ${daysToNextShift === 1 ? tr('homeDay') : tr('homeDays')}`
                      : tr('homeNoShiftNextDays'))}
                </div>
              </div>
            </div>

            {/* Only rows whose value is actually known — never a column of em dashes. */}
            {(myNextShift || onNowShift || nextUpShift) && <>
              <div style={{ height: 1, background: 'var(--border-light)' }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {myNextShift && (
                  <RailRow
                    label={tr('homeYourNextShift')}
                    mono
                    value={`${myNextShift.date} ${fmtShiftTime(myNextShift.start_time, myNextShift.date, user?.timezone)}`}
                  />
                )}
                {onNowShift && (
                  <RailRow label={tr('homeOnNow')} value={onNowShift.user?.display_name || tr('homeAssignedEngineer')} />
                )}
                {nextUpShift && (
                  <RailRow label={tr('homeNextUp')} value={nextUpShift.user?.display_name || tr('homeAssignedEngineer')} />
                )}
              </div>
            </>}

            <LinkButton size={12} weight={600} color="var(--accent)" onClick={() => onNavigate?.('schedule')}>
              {tr('homeOpenSchedule')} →
            </LinkButton>
          </div>
        </CardShell>

        <CardShell>
          <CardHeader
            title={tr('homeThisWeek')}
            extra={<>
              <Mono size={12}>{weekRange}</Mono>
              <div style={{
                display: 'flex', gap: 2, padding: 2, marginLeft: 10,
                background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)',
              }}>
                {[['mine', tr('homeScopeMine')], ['team', tr('homeScopeTeam')]].map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => setWeekScope(id)}
                    style={{
                      background: weekScope === id ? 'var(--surface)' : 'transparent',
                      border: 'none', borderRadius: 'var(--radius-sm)', padding: '3px 9px',
                      cursor: 'pointer', fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 600,
                      color: weekScope === id ? 'var(--text)' : 'var(--text-muted)',
                    }}
                  >{label}</button>
                ))}
              </div>
            </>}
          />
          <div style={{ padding: '8px 0' }}>
            {recap.map(row => {
              const delta = row.value - row.prev;
              return (
                <div key={row.key} style={{
                  display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr) auto',
                  gap: 12, alignItems: 'center', padding: '8px 16px',
                }}>
                  <span style={{ ...MONO, fontSize: 17, fontWeight: 500, color: 'var(--text)', textAlign: 'left' }}>
                    {row.value}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.label}</span>
                  <Mono size={11}>
                    {delta === 0 ? tr('homeOnTrack') : `${delta > 0 ? '+' : '−'}${Math.abs(delta)} ${tr('homeVsLastWk')}`}
                  </Mono>
                </div>
              );
            })}
          </div>
        </CardShell>
      </section>

      {/* 2. Needs attention */}
      <section>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--text)' }}>
            {tr('homeAttention')}
          </h2>
          <Mono size={13}>{loading ? '' : `${attnTotal} ${tr('homeItems')}`}</Mono>
        </div>

        <div className="home-queues" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16, alignItems: 'stretch',
        }}>
          <QueueCard
            dot={downTargets.length ? 'var(--danger)' : 'var(--success)'}
            title={tr('homeQueueServices')}
            count={downTargets.length}
            link={allLink(totalTargets, 'homeOpenMonitor')}
            onLink={() => onNavigate?.('status')}
            rows={serviceRows}
            footer={serviceFooter}
            emptyLine={`${tr('homeServicesClearLine')} ${freshness}`}
          />
          <QueueCard
            dot={openTickets.length ? 'var(--text-muted)' : 'var(--success)'}
            title={tr('homeQueueTickets')}
            count={openTickets.length}
            link={allLink(tickets.length, 'homeOpenTickets')}
            onLink={() => onNavigate?.('tickets')}
            rows={ticketRows}
            footer={ticketFooter}
            emptyLine={`${tr('homeTicketsClearLine')} ${freshness}`}
          />
          <QueueCard
            dot={mailQueue.length ? 'var(--text-muted)' : 'var(--success)'}
            title={tr('homeQueueMail')}
            count={mailQueue.length}
            link={allLink(emails.length, 'homeOpenMailLink')}
            onLink={() => onNavigate?.('mail')}
            rows={mailRows}
            footer={mailFooter}
            emptyLine={`${tr('homeMailClearLine')} ${freshness}`}
          />
        </div>
      </section>

      {/* 3. Reminders + team on shift today */}
      <section className="home-bottom" style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'stretch',
      }}>
        <CardShell>
          <CardHeader
            dot="var(--success)"
            title={tr('reminders')}
            count={reminders.length}
            link={tr('homeAdd')}
            onLink={() => onNavigate?.('reminders')}
          />
          {reminders.length === 0 ? (
            <div style={{ padding: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <span style={{ fontSize: 16, lineHeight: 1.2 }}>✨</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tr('homeAllClear')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{tr('homeRemindersClearLine')}</div>
              </div>
            </div>
          ) : (
            <div style={{ padding: '4px 0' }}>
              {reminders.slice(0, CARD_ROWS).map(r => (
                <QueueRow
                  key={r.id}
                  title={r.title || ''}
                  sub={new Date(parseTs(r.remind_at)).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  value={fmtAge((parseTs(r.remind_at) - Date.now()) / 1000) || ''}
                  onClick={() => onNavigate?.('reminders')}
                />
              ))}
            </div>
          )}
        </CardShell>

        <CardShell>
          <CardHeader
            title={tr('homeTeamToday')}
            count={todayShifts.length || null}
            link={tr('schedule')}
            onLink={() => onNavigate?.('schedule')}
          />
          {todayShifts.length === 0 ? (
            <div style={{ padding: '14px 16px', fontSize: 13, color: 'var(--text-muted)' }}>
              {tr('homeNobodyToday')}
            </div>
          ) : (
          <div className="home-team" style={{
            display: 'grid', gridTemplateColumns: `repeat(${todayShifts.length}, minmax(0, 1fr))`,
          }}>
            {todayShifts.map((s, i) => (
              <div key={s.id || i} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: 18, minWidth: 0,
                borderLeft: i === 0 ? 'none' : '1px solid var(--border-light)',
              }}>
                <AvatarChip name={s.user?.display_name} color={s.user?.name_color} size={32} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13, fontWeight: 600, color: 'var(--text)',
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>{s.user?.display_name || tr('homeAssignedEngineer')}</div>
                  <Mono size={11}>
                    {fmtShiftTime(s.start_time, s.date, user?.timezone)}–{fmtShiftTime(s.end_time, s.date, user?.timezone)}
                  </Mono>
                </div>
                <span style={{ flex: 1 }} />
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.06em',
                  color: 'var(--text-muted)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '3px 7px', whiteSpace: 'nowrap',
                }}>{tr(`shift_${s.shift_type}`)}</span>
              </div>
            ))}
          </div>
          )}
        </CardShell>
      </section>

      {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}

      {openTicketId && (
        <TicketDetailModal
          ticketId={openTicketId}
          onClose={() => setOpenTicketId(null)}
          onError={(message) => setError(message)}
          onChanged={loadLive}
          user={user}
        />
      )}

      {openEmailId && (
        <EmailDetailModal
          emailId={openEmailId}
          onClose={() => setOpenEmailId(null)}
          onChange={(updated) => setEmails(prev => prev.map(e => (e.id === updated.id ? { ...e, ...updated } : e)))}
          user={user}
        />
      )}

      <style>{`
        @media (max-width: 1180px) {
          .home-hero { grid-template-columns: minmax(0, 1fr) 300px !important; }
        }
        @media (max-width: 1000px) {
          .home-hero { grid-template-columns: minmax(0, 1fr) !important; gap: 24px !important; }
          .home-queues { grid-template-columns: minmax(0, 1fr) !important; }
          .home-bottom { grid-template-columns: minmax(0, 1fr) !important; }
          .home-team { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
