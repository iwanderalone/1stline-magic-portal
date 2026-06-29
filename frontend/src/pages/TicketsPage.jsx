import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { Button, Badge, EmptyState, Toast, Overlay, Tabs } from '../components/UI';
import { Icon } from '../components/Icons';

const EVENT_META = {
  ticket_opened:   { label: 'Opened',   color: 'blue'   },
  ticket_assigned: { label: 'Assigned', color: 'yellow' },
  comment_added:   { label: 'Comment',  color: 'gray'   },
  ticket_closed:   { label: 'Closed',   color: 'green'  },
  ticket_paused:   { label: 'Paused',   color: 'orange' },
  ticket_status_changed: { label: 'Status', color: 'blue' },
  ticket_sync:     { label: 'Sync',     color: 'gray'   },
};
const ALL_TYPES = Object.keys(EVENT_META);

const BUCKET_COLOR = { open: 'blue', paused: 'orange', closed: 'green' };
const BUCKETS = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'paused', label: 'Paused' },
  { id: 'closed', label: 'Closed' },
];

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/* ─── Ticket detail modal ──────────────────────────────── */
function TicketDetailModal({ ticketId, onClose, onError }) {
  const { theme: t } = useTheme();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api(`/tickets/board/${ticketId}`)
      .then(d => { if (alive) setData(d); })
      .catch(e => { onError?.(e.message || 'Failed to load ticket'); onClose(); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [ticketId]);

  const meta = (label, value) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '—'}</div>
    </div>
  );

  return (
    <Overlay onClose={onClose} title={data ? `#${data.number || data.id} — ${data.title || ''}` : 'Ticket'} maxWidth={680}>
      {loading || !data ? (
        <div style={{ textAlign: 'center', padding: 30, color: t.textMuted }}>Loading…</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* state + zammad link */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Badge color={BUCKET_COLOR[data.bucket] || 'gray'}>{data.state || data.bucket}</Badge>
            {data.priority && <span style={{ fontSize: 12, color: t.textMuted }}>Priority: {data.priority}</span>}
            <span style={{ flex: 1 }} />
            {data.url && (
              <a href={data.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: t.accent, textDecoration: 'none' }}>
                Open in Zammad ↗
              </a>
            )}
          </div>

          {/* meta grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {meta('Assignee', data.assignee)}
            {meta('Customer', data.customer)}
            {meta('Group', data.group_name)}
            {meta('Created', formatTime(data.zammad_created_at))}
            {meta('Updated', formatTime(data.zammad_updated_at))}
            {meta('Comments', data.comments?.length ?? 0)}
          </div>

          {/* comment thread */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textSecondary, marginBottom: 8 }}>Comments</div>
            {(!data.comments || data.comments.length === 0) ? (
              <div style={{ fontSize: 13, color: t.textMuted }}>No comments captured yet.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.comments.map(c => (
                  <div key={c.id} style={{ border: `1px solid ${t.border}`, borderRadius: t.radius, padding: '8px 12px', background: t.surfaceAlt || t.surface }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
                        {c.author || c.sender || 'Unknown'}
                        {c.internal ? <span style={{ marginLeft: 6, fontSize: 10, color: t.textMuted }}>internal</span> : null}
                      </span>
                      <span style={{ fontSize: 11, color: t.textMuted, whiteSpace: 'nowrap' }}>{formatTime(c.zammad_created_at || c.created_at)}</span>
                    </div>
                    <div style={{ fontSize: 13, color: t.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* event history */}
          {data.events?.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textSecondary, marginBottom: 8 }}>Event history</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {data.events.map(ev => {
                  const m = EVENT_META[ev.event_type] || { label: ev.event_type, color: 'gray' };
                  return (
                    <div key={ev.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <Badge color={m.color}>{m.label}</Badge>
                      <span style={{ color: t.textMuted }}>{formatTime(ev.received_at)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Overlay>
  );
}

/* ─── Ticket board ─────────────────────────────────────── */
function TicketBoardView({ onError }) {
  const { theme: t } = useTheme();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ all: 0, open: 0, paused: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (b, s) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (b) params.set('bucket', b);
      if (s) params.set('search', s);
      const [list, cnt] = await Promise.all([
        api(`/tickets/board?${params}`),
        api('/tickets/board/counts'),
      ]);
      setTickets(list);
      setCounts(cnt);
    } catch (err) {
      onError?.(err.message || 'Failed to load tickets');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    const id = setTimeout(() => load(bucket, search), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [bucket, search, load]);

  return (
    <div>
      {selected && <TicketDetailModal ticketId={selected} onClose={() => setSelected(null)} onError={onError} />}

      {/* filters + search */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>
        {BUCKETS.map(b => {
          const active = bucket === b.id;
          const n = b.id === '' ? counts.all : counts[b.id];
          return (
            <button key={b.id || 'all'} onClick={() => setBucket(b.id)} style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${active ? t.accent : t.border}`,
              background: active ? t.accent : 'transparent',
              color: active ? '#fff' : t.textSecondary,
            }}>{b.label} ({n ?? 0})</button>
          );
        })}
        <span style={{ flex: 1 }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search #, title, assignee, customer…"
          style={{
            padding: '6px 12px', borderRadius: t.radius, fontSize: 13,
            border: `1px solid ${t.border}`, background: t.surface, color: t.text, minWidth: 260,
          }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>Loading…</div>
      ) : tickets.length === 0 ? (
        <EmptyState icon={<Icon name="inbox" size={36} />} title="No tickets" subtitle="Tickets appear here from Zammad webhooks and periodic sync" />
      ) : (
        <div style={{ border: `1px solid ${t.border}`, borderRadius: t.radius, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 80 }} /><col /><col style={{ width: 110 }} />
              <col style={{ width: 150 }} /><col style={{ width: 150 }} />
              <col style={{ width: 70 }} /><col style={{ width: 130 }} />
            </colgroup>
            <thead>
              <tr style={{ background: t.surfaceAlt || t.surface, borderBottom: `1px solid ${t.border}` }}>
                {['Ticket', 'Title', 'State', 'Assignee', 'Customer', 'Cmts', 'Updated'].map(h => (
                  <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map((tk, i) => (
                <tr key={tk.id}
                  onClick={() => setSelected(tk.id)}
                  style={{ borderTop: i === 0 ? 'none' : `1px solid ${t.border}`, cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-alt)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: t.textMuted }}>#{tk.number || tk.id}</td>
                  <td style={{ padding: '10px 12px', color: t.text, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.title || '—'}</td>
                  <td style={{ padding: '10px 12px' }}><Badge color={BUCKET_COLOR[tk.bucket] || 'gray'}>{tk.state || tk.bucket}</Badge></td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.assignee || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tk.customer || '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 13, color: t.textMuted }}>{tk.article_count ?? '—'}</td>
                  <td style={{ padding: '10px 12px', fontSize: 12, color: t.textMuted, whiteSpace: 'nowrap' }}>{formatTime(tk.last_event_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Event log (raw webhook feed, for debugging) ──────── */
function EventLogView({ onError }) {
  const { theme: t } = useTheme();
  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const LIMIT = 50;

  const load = useCallback(async (type, off) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: off });
      if (type) params.set('event_type', type);
      const [evs, cnt] = await Promise.all([
        api(`/tickets/events?${params}`),
        api(`/tickets/events/count${type ? `?event_type=${type}` : ''}`),
      ]);
      setEvents(evs);
      setTotal(cnt.count);
    } catch (err) {
      onError?.(err.message || 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { load(filter, offset); }, [filter, offset, load]);

  let pretty = selected?.payload;
  try { pretty = JSON.stringify(JSON.parse(selected.payload), null, 2); } catch (_) {}

  return (
    <div>
      {selected && (
        <Overlay onClose={() => setSelected(null)} title={`${(EVENT_META[selected.event_type] || {}).label || selected.event_type} — ${selected.ticket_number ? `#${selected.ticket_number}` : `Event #${selected.id}`}`} maxWidth={720}>
          <pre style={{ margin: 0, fontSize: 12, fontFamily: 'var(--font-mono)', color: t.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{pretty}</pre>
        </Overlay>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button onClick={() => { setFilter(''); setOffset(0); }} style={{
          padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
          border: `1px solid ${filter === '' ? t.accent : t.border}`,
          background: filter === '' ? t.accent : 'transparent', color: filter === '' ? '#fff' : t.textSecondary,
        }}>All ({total})</button>
        {ALL_TYPES.map(type => {
          const active = filter === type;
          return (
            <button key={type} onClick={() => { setFilter(type); setOffset(0); }} style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${active ? t.accent : t.border}`,
              background: active ? t.accent : 'transparent', color: active ? '#fff' : t.textSecondary,
            }}>{EVENT_META[type].label}</button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>Loading…</div>
      ) : events.length === 0 ? (
        <EmptyState icon={<Icon name="inbox" size={36} />} title="No events yet" subtitle="Events appear once Zammad sends webhooks" />
      ) : (
        <>
          <div style={{ border: `1px solid ${t.border}`, borderRadius: t.radius, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 120 }} /><col style={{ width: 80 }} /><col />
                <col style={{ width: 140 }} /><col style={{ width: 120 }} /><col style={{ width: 140 }} /><col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr style={{ background: t.surfaceAlt || t.surface, borderBottom: `1px solid ${t.border}` }}>
                  {['Event', 'Ticket', 'Title', 'Assignee', 'State', 'Received', ''].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => {
                  const m = EVENT_META[ev.event_type] || { label: ev.event_type, color: 'gray' };
                  return (
                    <tr key={ev.id} onClick={() => setSelected(ev)}
                      style={{ borderTop: i === 0 ? 'none' : `1px solid ${t.border}`, cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-alt)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                      <td style={{ padding: '10px 12px' }}><Badge color={m.color}>{m.label}</Badge></td>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: t.textMuted }}>{ev.ticket_number ? `#${ev.ticket_number}` : '—'}</td>
                      <td style={{ padding: '10px 12px', color: t.text, fontSize: 14 }}>{ev.ticket_title || '—'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary }}>{ev.assignee || '—'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary }}>{ev.ticket_state || '—'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: t.textMuted, whiteSpace: 'nowrap' }}>{formatTime(ev.received_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: t.textMuted }}>View JSON →</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>← Prev</Button>
                <Button size="sm" variant="ghost" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Next →</Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────── */
export default function TicketsPage() {
  const { theme: t } = useTheme();
  const [tab, setTab] = useState('board');
  const [toast, setToast] = useState(null);
  const onError = useCallback((message) => setToast({ message, tone: 'error' }), []);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: t.text, fontSize: 20, fontWeight: 700 }}>Tickets</h2>
          <p style={{ margin: '4px 0 0', color: t.textMuted, fontSize: 13 }}>
            Zammad tickets, statuses and comments — synced live via webhooks
          </p>
        </div>
        <Tabs
          tabs={[{ id: 'board', label: 'Tickets' }, { id: 'events', label: 'Event log' }]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'board' ? <TicketBoardView onError={onError} /> : <EventLogView onError={onError} />}
    </div>
  );
}
