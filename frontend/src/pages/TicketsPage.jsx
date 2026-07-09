import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Button, Badge, EmptyState, Toast, Overlay, Tabs } from '../components/UI';
import { Icon } from '../components/Icons';
import TicketDetailModal, { BUCKET_COLOR, EVENT_META, eventLabel, formatTime } from '../components/TicketDetailModal';

const ALL_TYPES = Object.keys(EVENT_META);

const BUCKETS = [
  { id: '', key: 'tpAll' },
  { id: 'open', key: 'tpOpen' },
  { id: 'paused', key: 'tpPaused' },
  { id: 'closed', key: 'tpClosed' },
];

/* ─── Ticket board ─────────────────────────────────────── */
function TicketBoardView({ onError }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [tickets, setTickets] = useState([]);
  const [counts, setCounts] = useState({ all: 0, open: 0, paused: 0, closed: 0 });
  const [loading, setLoading] = useState(true);
  const [bucket, setBucket] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback(async (b, s, silent = false) => {
    if (!silent) setLoading(true);
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
      if (!silent) onError?.(err.message || 'Failed to load tickets');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    const id = setTimeout(() => load(bucket, search), search ? 300 : 0);
    return () => clearTimeout(id);
  }, [bucket, search, load]);

  // Background refresh so new webhook-delivered tickets show up without a reload.
  useEffect(() => {
    const id = setInterval(() => load(bucket, search, true), 30000);
    return () => clearInterval(id);
  }, [bucket, search, load]);

  return (
    <div>
      {selected && <TicketDetailModal ticketId={selected} onClose={() => setSelected(null)} onError={onError} onChanged={() => load(bucket, search)} />}

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
            }}>{tr(b.key)} ({n ?? 0})</button>
          );
        })}
        <span style={{ flex: 1 }} />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tr('tpSearch')}
          style={{
            padding: '6px 12px', borderRadius: t.radius, fontSize: 13,
            border: `1px solid ${t.border}`, background: t.surface, color: t.text, minWidth: 260,
          }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>{tr('mailLoading')}</div>
      ) : tickets.length === 0 ? (
        <EmptyState icon={<Icon name="inbox" size={36} />} title={tr('tpNoTickets')} subtitle={tr('tpNoTicketsDesc')} />
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
                {[tr('tpColTicket'), tr('tpColTitle'), tr('tpColState'), tr('tpColAssignee'), tr('tpColCustomer'), tr('tpColComments'), tr('tpColUpdated')].map(h => (
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
  const { t: tr } = useLang();
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
        }}>{tr('tpAll')} ({total})</button>
        {ALL_TYPES.map(type => {
          const active = filter === type;
          return (
            <button key={type} onClick={() => { setFilter(type); setOffset(0); }} style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${active ? t.accent : t.border}`,
              background: active ? t.accent : 'transparent', color: active ? '#fff' : t.textSecondary,
            }}>{eventLabel(EVENT_META[type], tr)}</button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>{tr('mailLoading')}</div>
      ) : events.length === 0 ? (
        <EmptyState icon={<Icon name="inbox" size={36} />} title={tr('tpNoEvents')} subtitle={tr('tpNoEventsDesc')} />
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
                  {[tr('tpColEvent'), tr('tpColTicket'), tr('tpColTitle'), tr('tpColAssignee'), tr('tpColState'), tr('tpColReceived'), ''].map(h => (
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
                      <td style={{ padding: '10px 12px' }}><Badge color={m.color}>{eventLabel(m, tr)}</Badge></td>
                      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: t.textMuted }}>{ev.ticket_number ? `#${ev.ticket_number}` : '—'}</td>
                      <td style={{ padding: '10px 12px', color: t.text, fontSize: 14 }}>{ev.ticket_title || '—'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary }}>{ev.assignee || '—'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary }}>{ev.ticket_state || '—'}</td>
                      <td style={{ padding: '10px 12px', fontSize: 12, color: t.textMuted, whiteSpace: 'nowrap' }}>{formatTime(ev.received_at)}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontSize: 12, color: t.textMuted }}>{tr('tpViewJson')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {total > LIMIT && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>{tr('tpShowing')} {offset + 1}–{Math.min(offset + LIMIT, total)} {tr('tpOf')} {total}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>{tr('tpPrev')}</Button>
                <Button size="sm" variant="ghost" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>{tr('tpNext')}</Button>
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
  const { t: tr } = useLang();
  const [tab, setTab] = useState('board');
  const [toast, setToast] = useState(null);
  const onError = useCallback((message) => setToast({ message, tone: 'error' }), []);

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: t.text, fontSize: 20, fontWeight: 700 }}>{tr('tpTabBoard')}</h2>
          <p style={{ margin: '4px 0 0', color: t.textMuted, fontSize: 13 }}>
            {tr('tpSubtitle')}
          </p>
        </div>
        <Tabs
          tabs={[{ id: 'board', label: tr('tpTabBoard') }, { id: 'events', label: tr('tpTabEvents') }]}
          active={tab}
          onChange={setTab}
        />
      </div>

      {tab === 'board' ? <TicketBoardView onError={onError} /> : <EventLogView onError={onError} />}
    </div>
  );
}
