import { useState, useEffect } from 'react';
import { api } from '../api';
import { Button, EmptyState } from '../components/UI';
import { theme } from '../theme';

export default function NotificationsPanel({ onClose }) {
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/notifications/').then(d => { setNotifs(d || []); setLoading(false); });
  }, []);

  const markAllRead = async () => {
    await api('/notifications/mark-read', { method: 'POST' });
    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
  };

  return (
    <>
      {/* Backdrop */}
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 999,
      }} onClick={onClose} />

      {/* Panel */}
      <div className="slide-in" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: '400px',
        background: theme.surface, borderLeft: `1px solid ${theme.border}`, zIndex: 1000,
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.08)',
      }}>
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${theme.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>Notifications</h3>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" variant="ghost" onClick={markAllRead}>Mark all read</Button>
            <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
          {loading ? (
            <div style={{ padding: '24px', textAlign: 'center', color: theme.textMuted }}>Loading…</div>
          ) : notifs.length === 0 ? (
            <EmptyState icon="✨" title="All clear" subtitle="No notifications" />
          ) : (
            notifs.map(n => (
              <div key={n.id} style={{
                padding: '12px 14px', borderRadius: theme.radiusSm, marginBottom: '4px',
                background: n.is_read ? 'transparent' : theme.accentLight,
                borderLeft: n.is_read ? 'none' : `3px solid ${theme.accent}`,
              }}>
                <div style={{ fontWeight: n.is_read ? 400 : 600, fontSize: '13px' }}>{n.title}</div>
                <div style={{ fontSize: '12px', color: theme.textSecondary, marginTop: '2px' }}>{n.message}</div>
                <div style={{ fontSize: '11px', color: theme.textMuted, marginTop: '4px', fontFamily: theme.fontMono }}>
                  {new Date(n.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
