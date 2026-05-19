import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { Button, Badge, EmptyState, Toast } from '../components/UI';
import { Icon } from '../components/Icons';

const EVENT_META = {
  ticket_opened:   { label: 'Opened',   color: 'blue'   },
  ticket_assigned: { label: 'Assigned', color: 'yellow' },
  comment_added:   { label: 'Comment',  color: 'gray'   },
  ticket_closed:   { label: 'Closed',   color: 'green'  },
  ticket_paused:   { label: 'Paused',   color: 'orange' },
};

const ALL_TYPES = Object.keys(EVENT_META);

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/* ─── Payload modal ────────────────────────────────────── */
function PayloadModal({ event, onClose }) {
  const { theme: t } = useTheme();
  const [copied, setCopied] = useState(false);

  let pretty = event.payload;
  try { pretty = JSON.stringify(JSON.parse(event.payload), null, 2); } catch (_) {}

  const copy = () => {
    navigator.clipboard.writeText(pretty).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 1000, padding: 16,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{
        background: t.surface, border: `1px solid ${t.border}`,
        borderRadius: t.radius, width: '100%', maxWidth: 720,
        maxHeight: '80vh', display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: `1px solid ${t.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Badge color={(EVENT_META[event.event_type] || {}).color || 'gray'}>
              {(EVENT_META[event.event_type] || {}).label || event.event_type}
            </Badge>
            <span style={{ fontWeight: 600, color: t.text }}>
              {event.ticket_number ? `#${event.ticket_number}` : `Event #${event.id}`}
              {event.ticket_title ? ` — ${event.ticket_title}` : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? 'Copied!' : 'Copy JSON'}
            </Button>
            <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
          </div>
        </div>
        {/* payload */}
        <pre style={{
          flex: 1, overflow: 'auto', margin: 0,
          padding: 16, fontSize: 12,
          fontFamily: 'var(--font-mono)',
          color: t.textSecondary,
          background: t.surfaceAlt || t.surface,
          whiteSpace: 'pre-wrap', wordBreak: 'break-all',
        }}>{pretty}</pre>
      </div>
    </div>
  );
}

/* ─── Event row ─────────────────────────────────────────── */
function EventRow({ ev, onClick }) {
  const { theme: t } = useTheme();
  const meta = EVENT_META[ev.event_type] || { label: ev.event_type, color: 'gray' };

  return (
    <>
      <td style={{ padding: '10px 12px' }}>
        <Badge color={meta.color}>{meta.label}</Badge>
      </td>
      <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: t.textMuted }}>
        {ev.ticket_number ? `#${ev.ticket_number}` : '—'}
      </td>
      <td style={{ padding: '10px 12px', color: t.text, fontSize: 14 }}>
        {ev.ticket_title || <span style={{ color: t.textMuted }}>—</span>}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary }}>
        {ev.assignee || <span style={{ color: t.textMuted }}>—</span>}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 13, color: t.textSecondary }}>
        {ev.ticket_state || <span style={{ color: t.textMuted }}>—</span>}
      </td>
      <td style={{ padding: '10px 12px', fontSize: 12, color: t.textMuted, whiteSpace: 'nowrap' }}>
        {formatTime(ev.received_at)}
      </td>
      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
        <button
          onClick={() => onClick(ev)}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: 12, color: t.textMuted, padding: '2px 6px',
          }}
        >View JSON →</button>
      </td>
    </>
  );
}

/* ─── Main page ─────────────────────────────────────────── */
export default function TicketsPage() {
  const { theme: t } = useTheme();

  const [events, setEvents] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');        // '' = all
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState(null);
  const [toast, setToast] = useState(null);

  const LIMIT = 50;

  const load = useCallback(async (type, off) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: LIMIT, offset: off });
      if (type) params.set('event_type', type);
      const [evs, cnt] = await Promise.all([
        api.get(`/tickets/events?${params}`),
        api.get(`/tickets/events/count${type ? `?event_type=${type}` : ''}`),
      ]);
      setEvents(evs);
      setTotal(cnt.count);
    } catch (err) {
      setToast({ message: err.message || 'Failed to load events', tone: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(filter, offset); }, [filter, offset, load]);

  const applyFilter = (type) => { setFilter(type); setOffset(0); };

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}
      {selected && <PayloadModal event={selected} onClose={() => setSelected(null)} />}

      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: t.text, fontSize: 20, fontWeight: 700 }}>Ticket Events</h2>
          <p style={{ margin: '4px 0 0', color: t.textMuted, fontSize: 13 }}>
            Incoming Zammad webhook events — click any row to see the raw payload
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => load(filter, offset)}>
          <Icon name="refresh" size={14} /> Refresh
        </Button>
      </div>

      {/* filter pills */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <button
          onClick={() => applyFilter('')}
          style={{
            padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
            border: `1px solid ${filter === '' ? t.accent : t.border}`,
            background: filter === '' ? t.accent : 'transparent',
            color: filter === '' ? '#fff' : t.textSecondary,
          }}
        >All ({total})</button>
        {ALL_TYPES.map(type => {
          const meta = EVENT_META[type];
          const active = filter === type;
          return (
            <button
              key={type}
              onClick={() => applyFilter(type)}
              style={{
                padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
                border: `1px solid ${active ? t.accent : t.border}`,
                background: active ? t.accent : 'transparent',
                color: active ? '#fff' : t.textSecondary,
              }}
            >{meta.label}</button>
          );
        })}
      </div>

      {/* webhook URL hint */}
      <div style={{
        background: t.surfaceAlt || t.surface,
        border: `1px solid ${t.border}`,
        borderRadius: t.radius,
        padding: '10px 14px',
        marginBottom: 20,
        fontSize: 12,
        color: t.textMuted,
      }}>
        <strong style={{ color: t.textSecondary }}>Zammad webhook URLs</strong>
        {' — configure one trigger per event type:'}
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {ALL_TYPES.map(type => (
            <code key={type} style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              POST /api/tickets/webhook?event={type}
            </code>
          ))}
        </div>
      </div>

      {/* table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>Loading…</div>
      ) : events.length === 0 ? (
        <EmptyState
          icon={<Icon name="inbox" size={36} />}
          title="No events yet"
          subtitle="Events will appear here once Zammad starts sending webhooks"
        />
      ) : (
        <>
          <div style={{ border: `1px solid ${t.border}`, borderRadius: t.radius, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 120 }} />
                <col style={{ width: 80 }} />
                <col />
                <col style={{ width: 140 }} />
                <col style={{ width: 120 }} />
                <col style={{ width: 140 }} />
                <col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr style={{ background: t.surfaceAlt || t.surface, borderBottom: `1px solid ${t.border}` }}>
                  {['Event', 'Ticket', 'Title', 'Assignee', 'State', 'Received', ''].map(h => (
                    <th key={h} style={{
                      padding: '8px 12px', textAlign: 'left',
                      fontSize: 11, fontWeight: 600,
                      color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((ev, i) => (
                  <tr
                    key={ev.id}
                    style={{ borderTop: i === 0 ? 'none' : `1px solid ${t.border}`, cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-alt)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <EventRow ev={ev} onClick={setSelected} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* pagination */}
          {total > LIMIT && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 }}>
              <span style={{ fontSize: 13, color: t.textMuted }}>
                Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
              </span>
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
