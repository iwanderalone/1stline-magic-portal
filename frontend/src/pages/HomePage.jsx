import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useLang } from '../components/LangContext';
import { Avatar, Button } from '../components/UI';
import EmailDetailModal from '../components/EmailDetailModal';
import TicketDetailModal, { stateLabel } from '../components/TicketDetailModal';

// Home shows the head of every queue and summarises the tail — nothing here
// scrolls or renders unbounded.
const CARD_ROWS = 5;
const CARD_MIN_HEIGHT = 320;
const TICKET_STALE_DAYS = 14;   // past this, a ticket's age turns red
const STATE_RANK = { new: 0, open: 0, in_progress: 1, on_pause: 2, closed: 3 };

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

/** Compact age: 45s / 12m / 3h / 22d. */
function fmtAge(seconds) {
  if (seconds == null) return '—';
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

/* ── shared bits ─────────────────────────────────────────────── */

function Eyebrow({ children, style }) {
  return (
    <div style={{
      fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em',
      color: 'var(--text-muted)', ...style,
    }}>{children}</div>
  );
}

function Mono({ children, color = 'var(--text-muted)', size = 12, weight = 500 }) {
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: size, color, fontWeight: weight, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function Dot({ color }) {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0 }} />;
}

function SectionHead({ title, count, linkLabel, onLink }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 }}>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: 'var(--text)' }}>{title}</h2>
      {count != null && <Mono>{count}</Mono>}
      <span style={{ flex: 1 }} />
      {onLink && (
        <button onClick={onLink} style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          fontFamily: 'inherit', fontSize: 12, color: 'var(--text-muted)',
        }}>{linkLabel} →</button>
      )}
    </div>
  );
}

/** One queue column: capped rows, a one-line tail summary, all-clear at full size. */
function QueueCard({ label, count, tone, allLabel, onAll, rows, footer, emptyTitle, emptyLine }) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      background: 'var(--surface)', minHeight: CARD_MIN_HEIGHT,
      display: 'flex', flexDirection: 'column', minWidth: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px',
        borderBottom: '1px solid var(--border-light)',
      }}>
        <Dot color={tone} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
        <Mono>{count}</Mono>
        <span style={{ flex: 1 }} />
        {onAll && (
          <button onClick={onAll} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 11, color: 'var(--text-muted)',
          }}>{allLabel} →</button>
        )}
      </div>

      {rows.length === 0 ? (
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', gap: 6, padding: '20px 22px', textAlign: 'center',
        }}>
          <span style={{ fontSize: 18 }}>✨</span>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)' }}>{emptyTitle}</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: '28ch', lineHeight: 1.5 }}>{emptyLine}</div>
        </div>
      ) : (
        <div style={{ flex: 1 }}>
          {rows.map(row => <QueueRow key={row.key} {...row} />)}
        </div>
      )}

      {footer && (
        <div style={{
          padding: '9px 14px', borderTop: '1px solid var(--border-light)',
          fontSize: 12, color: 'var(--text-muted)',
        }}>{footer}</div>
      )}
    </div>
  );
}

function QueueRow({ title, sub, value, valueTone, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: 10,
        alignItems: 'center', padding: '9px 14px', cursor: 'pointer',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt)'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: 500, color: 'var(--text)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{title}</div>
        <div style={{
          fontSize: 11, color: 'var(--text-muted)', marginTop: 2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sub}</div>
      </div>
      <Mono color={valueTone || 'var(--text-secondary)'} size={12} weight={600}>{value}</Mono>
    </div>
  );
}

function RailRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, padding: '5px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ flex: 1 }} />
      <span style={{
        fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '62%',
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
    api('/mail-reporter/emails?limit=100').then(d => setEmails(d || [])).catch(() => {});
    setCheckedAt(Date.now());
  };

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Tickets arrive by webhook and probe state is pushed by Prometheus, so the
  // live blocks refresh on their own; the slower context loads once.
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
      // A week back for the recap, a few days forward for "who is next".
      const start = dateKey(addDays(today, -6));
      const end = dateKey(addDays(today, 5));
      try {
        const [mailData, reminderData, shiftData, ticketData, board, summary] = await Promise.all([
          api('/mail-reporter/emails?limit=100').catch(() => []),
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
  const todayLabel = userNow.toLocaleDateString(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  /* — queues — */

  const serviceIssues = useMemo(() => {
    const targets = (statusBoard?.groups || []).flatMap(g => g.targets.map(x => ({ ...x, group: g.name })));
    const kind = x => (x.up === false ? 0 : x.stale ? 1 : 3);
    return targets
      .map(x => ({ ...x, kind: kind(x) }))
      .filter(x => x.kind < 3)
      .sort((a, b) => a.kind - b.kind || (b.in_state_seconds || 0) - (a.in_state_seconds || 0));
  }, [statusBoard]);

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

  const downCount = serviceIssues.filter(x => x.kind === 0).length;
  const attnTotal = serviceIssues.length + openTickets.length + mailQueue.length;

  /* — shift context — */

  const myShiftNow = useMemo(() => {
    const me = String(user?.id || '');
    const ts = Date.now();
    return shifts.find(s => String(s.user_id) === me && shiftStartMs(s) <= ts && shiftEndMs(s) >= ts) || null;
  }, [shifts, user?.id]);

  const myNextShift = useMemo(() => {
    const me = String(user?.id || '');
    const ts = Date.now();
    return [...shifts]
      .filter(s => String(s.user_id) === me && shiftStartMs(s) > ts)
      .sort((a, b) => shiftStartMs(a) - shiftStartMs(b))[0] || null;
  }, [shifts, user?.id]);

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

  /* — this week — */

  const weekAgo = Date.now() - 7 * 86400000;

  // "Mine" filters by whatever attribution each source actually has: Zammad
  // assignee (a display name), the username that cleared a mail item, and the
  // shift's user id.
  const isMineTicket = (tk) => {
    const who = String(tk.assignee || '').trim().toLowerCase();
    if (!who) return false;
    return who === String(user?.display_name || '').toLowerCase()
      || who === String(user?.username || '').toLowerCase();
  };

  const recap = useMemo(() => {
    const mine = weekScope === 'mine';
    const closed = tickets.filter(tk => tk.bucket === 'closed' && parseTs(tk.state_changed_at) > weekAgo);
    const handled = emails.filter(e => e.status === 'solved' && parseTs(e.solved_at || e.created_at) > weekAgo);
    const worked = shifts.filter(s => parseTs(`${s.date}T00:00:00`) > weekAgo);
    return {
      ticketsClosed: (mine ? closed.filter(isMineTicket) : closed).length,
      mailHandled: (mine
        ? handled.filter(e => String(e.solved_by || '').toLowerCase() === String(user?.username || '').toLowerCase())
        : handled).length,
      shifts: (mine ? worked.filter(s => String(s.user_id) === String(user?.id || '')) : worked).length,
    };
  }, [tickets, emails, shifts, user?.id, user?.username, user?.display_name, weekAgo, weekScope]);

  /* — the verdict line — */

  const shiftUntil = myShiftNow
    ? fmtShiftTime(myShiftNow.end_time, myShiftNow.date, user?.timezone)
    : null;

  // Russian needs three plural forms; English collapses to two.
  const pl = (n, key) => {
    if (lang !== 'ru') return tr(`${key}${n === 1 ? '1' : '2'}`);
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return tr(`${key}1`);
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return tr(`${key}2`);
    return tr(`${key}5`);
  };
  const clause = (n, key, zeroKey, danger = false) => (
    n > 0
      ? <><b style={{ color: danger ? 'var(--danger)' : 'var(--text)', fontWeight: 600 }}>{n}</b> {pl(n, key)}</>
      : tr(zeroKey)
  );

  const displayName = user?.display_name || user?.username || tr('homeEngineerFallback');

  /* — render — */

  const freshness = checkedAt ? `${tr('homeLastChecked')} ${fmtAge((Date.now() - checkedAt) / 1000)}` : '';

  const serviceRows = serviceIssues.slice(0, CARD_ROWS).map(x => ({
    key: x.instance,
    title: hostOf(x.instance),
    sub: `${prettyGroup(x.group)} · ${x.kind === 0 ? tr('homeDownFor') : tr('homeQuietFor')} ${fmtAge(x.kind === 0 ? x.in_state_seconds : x.age_seconds)}`,
    value: x.kind === 0 ? (x.http_status || tr('homeStatusNoReply')) : tr('homeStatusNoData'),
    valueTone: 'var(--danger)',
    onClick: () => onNavigate?.('status'),
  }));

  const ticketRows = openTickets.slice(0, CARD_ROWS).map(tk => {
    const age = ageSince(tk.zammad_created_at || tk.state_changed_at);
    return {
      key: tk.id,
      title: tk.title || '—',
      sub: `#${tk.number || tk.id} · ${stateLabel(tk.state, tr)} ${fmtAge(ageSince(tk.state_changed_at))}`,
      value: fmtAge(age),
      valueTone: age > TICKET_STALE_DAYS * 86400 ? 'var(--danger)' : 'var(--text-secondary)',
      onClick: () => setOpenTicketId(tk.id),
    };
  });

  const mailRows = mailQueue.slice(0, CARD_ROWS).map(email => ({
    key: email.id,
    title: email.subject || tr('homeNoSubject'),
    sub: `${email.sender || '—'} · ${fmtAge(ageSince(email.created_at))}`,
    value: fmtAge(ageSince(email.created_at)),
    onClick: () => setOpenEmailId(email.id),
  }));

  const tailFooter = (list, oldestSeconds) => {
    const rest = list.length - CARD_ROWS;
    if (rest <= 0) return null;
    const more = `${rest} ${tr('homeMore')}`;
    return oldestSeconds == null ? more : `${more} · ${tr('homeOldest')} ${fmtAge(oldestSeconds)}`;
  };

  return (
    <div className="fade-in" style={{
      maxWidth: 1240, margin: '0 auto', paddingTop: 20,
      display: 'flex', flexDirection: 'column', gap: 40,
    }}>
      {/* 1. Status hero */}
      <section style={{
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 320px',
        gap: 40, alignItems: 'start',
      }} className="home-hero">
        <div style={{ minWidth: 0 }}>
          <Eyebrow>
            {todayLabel} · {userNow.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </Eyebrow>
          <h1 style={{
            margin: '10px 0 14px', fontSize: 40, fontWeight: 400,
            letterSpacing: '-0.025em', lineHeight: 1.1, color: 'var(--text)',
          }}>
            {greetingFor(userNow, lang)}, <span style={{ color: 'var(--accent)' }}>{displayName}</span>.
          </h1>
          <p style={{
            margin: 0, fontSize: 20, lineHeight: 1.45, color: 'var(--text-secondary)', maxWidth: '30ch',
          }}>
            {clause(downCount, 'homePlSvcDown', 'homeVAllUp', true)}, {clause(openTickets.length, 'homePlTicketOpen', 'homeVNoTickets')}, {clause(mailQueue.length, 'homePlMailUnchecked', 'homeVMailClear')} — {tr('homeVAnd')} {myShiftNow
              ? `${tr('homeVOnShift')} ${shiftUntil}`
              : tr('homeVOffShift')}.
          </p>
          <div style={{ display: 'flex', gap: 10, marginTop: 22 }}>
            <Button variant="primary" icon="mail" onClick={() => onNavigate?.('mail')}>{tr('homeOpenMail')}</Button>
            <Button icon="calendar" onClick={() => onNavigate?.('schedule')}>{tr('homeMyShifts')}</Button>
          </div>
        </div>

        {/* Your shift rail */}
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          background: 'var(--surface)', padding: '14px 16px', minWidth: 0,
        }}>
          <Eyebrow>{tr('homeYourShift')}</Eyebrow>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '12px 0 14px' }}>
            <Avatar name={displayName} color={user?.name_color} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                {myShiftNow ? `${tr('homeOnShift')} · ${tr('homeUntil')} ${shiftUntil}` : tr('homeOffShiftToday')}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {myShiftNow
                  ? tr(`shift_${myShiftNow.shift_type}`)
                  : (myNextShift ? `${tr('homeNextOn')} ${myNextShift.date}` : tr('homeNoShiftNextDays'))}
              </div>
            </div>
          </div>
          <div style={{ height: 1, background: 'var(--border-light)', margin: '0 0 8px' }} />
          <RailRow
            label={tr('homeYourNextShift')}
            value={myNextShift
              ? `${myNextShift.date} · ${fmtShiftTime(myNextShift.start_time, myNextShift.date, user?.timezone)}`
              : '—'}
          />
          <RailRow
            label={tr('homeOnNow')}
            value={onNowShift ? (onNowShift.user?.display_name || tr('homeAssignedEngineer')) : '—'}
          />
          <RailRow
            label={tr('homeNextUp')}
            value={nextUpShift
              ? `${nextUpShift.user?.display_name || tr('homeAssignedEngineer')} · ${fmtShiftTime(nextUpShift.start_time, nextUpShift.date, user?.timezone)}`
              : '—'}
          />
          <div style={{ height: 1, background: 'var(--border-light)', margin: '8px 0' }} />
          <button onClick={() => onNavigate?.('schedule')} style={{
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 12, color: 'var(--text-muted)',
          }}>{tr('homeOpenSchedule')} →</button>
        </div>
      </section>

      {/* 2. Needs attention */}
      <section>
        <SectionHead title={tr('homeAttention')} count={loading ? '—' : attnTotal} />
        <div className="home-queues" style={{
          display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16, alignItems: 'stretch',
        }}>
          <QueueCard
            label={tr('homeQueueServices')}
            count={serviceIssues.length}
            tone={downCount > 0 ? 'var(--danger)' : serviceIssues.length ? 'var(--text-muted)' : 'var(--success)'}
            allLabel={`${tr('homeAll')} ${statusSummary?.total ?? ''}`.trim()}
            onAll={() => onNavigate?.('status')}
            rows={serviceRows}
            footer={tailFooter(serviceIssues, serviceIssues[serviceIssues.length - 1]?.in_state_seconds)}
            emptyTitle={tr('homeAllClear')}
            emptyLine={`${tr('homeServicesClearLine')} ${freshness}`}
          />
          <QueueCard
            label={tr('homeQueueTickets')}
            count={openTickets.length}
            tone={openTickets.length ? 'var(--text-muted)' : 'var(--success)'}
            allLabel={`${tr('homeAll')} ${tickets.length}`}
            onAll={() => onNavigate?.('tickets')}
            rows={ticketRows}
            footer={tailFooter(openTickets, ageSince(openTickets[openTickets.length - 1]?.zammad_created_at))}
            emptyTitle={tr('homeAllClear')}
            emptyLine={`${tr('homeTicketsClearLine')} ${freshness}`}
          />
          <QueueCard
            label={tr('homeQueueMail')}
            count={mailQueue.length}
            tone={mailQueue.length ? 'var(--text-muted)' : 'var(--success)'}
            allLabel={`${tr('homeAll')} ${emails.length}`}
            onAll={() => onNavigate?.('mail')}
            rows={mailRows}
            footer={tailFooter(mailQueue, ageSince(mailQueue[mailQueue.length - 1]?.created_at))}
            emptyTitle={tr('homeAllClear')}
            emptyLine={`${tr('homeMailClearLine')} ${freshness}`}
          />
        </div>
      </section>

      {/* 3. Team on shift today */}
      <section>
        <SectionHead
          title={tr('homeTeamToday')}
          count={todayShifts.length || null}
          linkLabel={tr('schedule')}
          onLink={() => onNavigate?.('schedule')}
        />
        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          background: 'var(--surface)', display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, Math.min(3, todayShifts.length || 1))}, minmax(0, 1fr))`,
        }} className="home-team">
          {todayShifts.length === 0 ? (
            <div style={{ padding: '22px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              {tr('homeNobodyToday')}
            </div>
          ) : todayShifts.slice(0, 3).map((s, i) => (
            <div key={s.id || i} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', minWidth: 0,
              borderLeft: i === 0 ? 'none' : '1px solid var(--border-light)',
            }}>
              <Avatar name={s.user?.display_name || '—'} color={s.user?.name_color} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, color: 'var(--text)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{s.user?.display_name || tr('homeAssignedEngineer')}</div>
                <Mono size={11}>
                  {fmtShiftTime(s.start_time, s.date, user?.timezone)}–{fmtShiftTime(s.end_time, s.date, user?.timezone)}
                </Mono>
              </div>
              <span style={{
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em',
                color: 'var(--text-muted)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '2px 6px', whiteSpace: 'nowrap',
              }}>{tr(`shift_${s.shift_type}`)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* 4. Reminders + this week */}
      <section className="home-bottom" style={{
        display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16, alignItems: 'stretch',
      }}>
        <QueueCard
          label={tr('reminders')}
          count={reminders.length}
          tone={reminders.length ? 'var(--text-muted)' : 'var(--success)'}
          allLabel={tr('homeAdd')}
          onAll={() => onNavigate?.('reminders')}
          rows={reminders.slice(0, CARD_ROWS).map(r => ({
            key: r.id,
            title: r.title || '—',
            sub: new Date(parseTs(r.remind_at)).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
            value: fmtAge((parseTs(r.remind_at) - Date.now()) / 1000),
            onClick: () => onNavigate?.('reminders'),
          }))}
          footer={tailFooter(reminders, null)}
          emptyTitle={tr('homeAllClear')}
          emptyLine={`${tr('homeRemindersClearLine')} ${freshness}`}
        />

        <div style={{
          border: '1px solid var(--border)', borderRadius: 'var(--radius)',
          background: 'var(--surface)', minHeight: CARD_MIN_HEIGHT,
          display: 'flex', flexDirection: 'column',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '12px 14px', borderBottom: '1px solid var(--border-light)',
          }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{tr('homeThisWeek')}</span>
            <span style={{ flex: 1 }} />
            <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              {[['mine', tr('homeScopeMine')], ['team', tr('homeScopeTeam')]].map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setWeekScope(id)}
                  style={{
                    background: weekScope === id ? 'var(--surface-alt)' : 'transparent',
                    border: 'none', padding: '3px 10px', cursor: 'pointer', fontFamily: 'inherit',
                    fontSize: 11, color: weekScope === id ? 'var(--text)' : 'var(--text-muted)',
                  }}
                >{label}</button>
              ))}
            </div>
          </div>
          <div style={{
            flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          }}>
            {[
              [recap.ticketsClosed, tr('homeRecapTickets')],
              [recap.mailHandled, tr('homeRecapMail')],
              [recap.shifts, tr('homeRecapShifts')],
            ].map(([value, label], i) => (
              <div key={label} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                gap: 6, padding: 14,
                borderLeft: i ? '1px solid var(--border-light)' : 'none',
              }}>
                <span style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 500, color: 'var(--text)', lineHeight: 1 }}>{value}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
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
