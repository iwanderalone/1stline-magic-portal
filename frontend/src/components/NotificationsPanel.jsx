import { useState, useEffect } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Button, EmptyState } from '../components/UI';

export default function NotificationsPanel({ onClose }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/notifications/')
      .then(d => { setNotifs(d || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const markAll = async () => {
    await api('/notifications/mark-read', { method: 'POST' });
    setNotifs(n => n.map(x => ({ ...x, is_read: true })));
  };

  const clearAll = async () => {
    await api('/notifications/', { method: 'DELETE' });
    setNotifs([]);
  };

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.2)', zIndex: 999 }} onClick={onClose} />
      <div className="slide-in" style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: '400px',
        background: t.surface, borderLeft: `1px solid ${t.border}`, zIndex: 1000,
        display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 24px rgba(0,0,0,0.1)',
      }}>
        <div style={{ padding: '16px 20px', borderBottom: `1px solid ${t.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ fontSize: '16px', fontWeight: 600 }}>{tr('notifications')}</h3>
          <div style={{ display: 'flex', gap: '6px' }}>
            {notifs.length > 0 && <>
              <Button size="sm" variant="ghost" onClick={markAll}>{tr('markRead')}</Button>
              <Button size="sm" variant="ghost" onClick={clearAll} style={{ color: t.danger }}>{tr('clearAll')}</Button>
            </>}
            <Button size="sm" variant="ghost" onClick={onClose}>✕</Button>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
          {loading
            ? <div style={{ padding: '24px', textAlign: 'center', color: t.textMuted }}>{tr('loading')}</div>
            : notifs.length === 0
              ? <EmptyState icon="✨" title={tr('allClear')} />
              : notifs.map(n => (
                <div key={n.id} style={{
                  padding: '12px 14px', borderRadius: t.radiusSm, marginBottom: '4px',
                  background: n.is_read ? 'transparent' : t.accentLight,
                  borderLeft: n.is_read ? 'none' : `3px solid ${t.accent}`,
                }}>
                  <div style={{ fontWeight: n.is_read ? 400 : 600, fontSize: '13px' }}>{n.title}</div>
                  <div style={{ fontSize: '12px', color: t.textSecondary, marginTop: '2px' }}>{n.message}</div>
                  <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '4px', fontFamily: t.fontMono }}>
                    {new Date(n.created_at).toLocaleString()}
                  </div>
                </div>
              ))
          }
        </div>
      </div>
    </>
  );
}
