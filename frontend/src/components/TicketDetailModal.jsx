import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from './ThemeContext';
import { useLang } from './LangContext';
import { Button, Badge, Overlay } from './UI';

export const BUCKET_COLOR = { open: 'blue', paused: 'orange', closed: 'green' };

export const EVENT_META = {
  ticket_opened:   { label: 'Opened',   color: 'blue'   },
  ticket_assigned: { label: 'Assigned', color: 'yellow' },
  comment_added:   { label: 'Comment',  color: 'gray'   },
  ticket_closed:   { label: 'Closed',   color: 'green'  },
  ticket_paused:   { label: 'Paused',   color: 'orange' },
  ticket_status_changed: { label: 'Status', color: 'blue' },
  ticket_sync:     { label: 'Sync',     color: 'gray'   },
};

const STATE_KEY = {
  new: 'tkStateNew', open: 'tkStateOpen', in_progress: 'tkStateInProgress',
  on_pause: 'tkStateOnPause', closed: 'tkStateClosed',
};

export function stateLabel(state, tr) {
  const key = STATE_KEY[state];
  return key ? tr(key) : (state || '—');
}

export function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Elapsed time since `iso`, compact + localized units (e.g. "2h", "3d", "5m"). */
export function fmtDuration(iso, lang) {
  if (!iso) return '—';
  const raw = String(iso);
  const d = new Date(raw.endsWith('Z') || raw.includes('+') ? raw : `${raw}Z`);
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  const u = lang === 'ru'
    ? { m: 'м', h: 'ч', d: 'д', now: 'только что' }
    : { m: 'm', h: 'h', d: 'd', now: 'just now' };
  if (sec < 60) return u.now;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}${u.m}`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}${u.h}${m % 60 ? ` ${m % 60}${u.m}` : ''}`;
  const days = Math.floor(h / 24);
  return `${days}${u.d}${h % 24 ? ` ${h % 24}${u.h}` : ''}`;
}

export default function TicketDetailModal({ ticketId, onClose, onError, onChanged }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const reload = useCallback(() => {
    return api(`/tickets/board/${ticketId}`)
      .then(d => { setData(d); return d; })
      .catch(e => { onError?.(e.message || 'Failed to load ticket'); onClose(); });
  }, [ticketId]);

  useEffect(() => { setLoading(true); reload().finally(() => setLoading(false)); }, [reload]);

  const sendReply = async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    try {
      await api(`/tickets/board/${ticketId}/reply`, { method: 'POST', body: JSON.stringify({ body: text }) });
      setReply('');
      await reload();
      onChanged?.();
    } catch (e) {
      onError?.(e.message || 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const meta = (label, value) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 11, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis' }}>{value || '—'}</div>
    </div>
  );

  return (
    <Overlay onClose={onClose} title={data ? `#${data.number || data.id} — ${data.title || ''}` : tr('tkTicket')} maxWidth={680}>
      {loading || !data ? (
        <div style={{ textAlign: 'center', padding: 30, color: t.textMuted }}>{tr('tkLoading')}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* state (read-only) + zammad link */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Badge color={BUCKET_COLOR[data.bucket] || 'gray'}>{stateLabel(data.state, tr)}</Badge>
            {data.priority && <span style={{ fontSize: 12, color: t.textMuted }}>{tr('tkPriority')}: {data.priority}</span>}
            <span style={{ flex: 1 }} />
            {data.url && (
              <a href={data.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: t.accent, textDecoration: 'none' }}>
                {tr('tkOpenInZammad')} ↗
              </a>
            )}
          </div>

          {/* meta grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            {meta(tr('tkAssignee'), data.assignee)}
            {meta(tr('tkCustomer'), data.customer)}
            {meta(tr('tkGroup'), data.group_name)}
            {meta(tr('tkCreated'), formatTime(data.zammad_created_at))}
            {meta(tr('tkUpdated'), formatTime(data.zammad_updated_at))}
            {meta(tr('tkComments'), data.comments?.length ?? 0)}
          </div>

          {/* comment thread */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textSecondary, marginBottom: 8 }}>{tr('tkComments')}</div>
            {(!data.comments || data.comments.length === 0) ? (
              <div style={{ fontSize: 13, color: t.textMuted }}>{tr('tkNoComments')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.comments.map(c => (
                  <div key={c.id} style={{
                    border: `1px solid ${c.portal_only ? (t.warning || '#caa024') : t.border}`,
                    borderRadius: t.radius, padding: '8px 12px',
                    background: c.portal_only ? 'rgba(202,160,36,0.07)' : (t.surfaceAlt || t.surface),
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>
                        {c.author || c.sender || 'Unknown'}
                        {c.portal_only
                          ? <Badge color="yellow" style={{ marginLeft: 6 }}>{tr('tkPortalOnly')}</Badge>
                          : (c.sender === 'Customer'
                              ? <span style={{ marginLeft: 6, fontSize: 10, color: t.textMuted }}>{tr('tkCustomerTag')}</span>
                              : null)}
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
              <div style={{ fontSize: 12, fontWeight: 600, color: t.textSecondary, marginBottom: 8 }}>{tr('tkEventHistory')}</div>
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

          {/* internal note composer (portal-only) */}
          <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: t.textSecondary, marginBottom: 8 }}>{tr('tkInternalNote')}</div>
            <textarea
              value={reply}
              onChange={e => setReply(e.target.value)}
              placeholder={tr('tkNotePlaceholder')}
              rows={3}
              style={{
                width: '100%', boxSizing: 'border-box', padding: '8px 12px', fontSize: 13,
                borderRadius: t.radius, border: `1px solid ${t.border}`,
                background: t.surface, color: t.text, resize: 'vertical', fontFamily: 'inherit',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <span style={{ fontSize: 11, color: t.textMuted }}>{tr('tkNoteHint')}</span>
              <Button size="sm" disabled={sending || !reply.trim()} onClick={sendReply}>
                {sending ? tr('tkSending') : tr('tkAddNote')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </Overlay>
  );
}
