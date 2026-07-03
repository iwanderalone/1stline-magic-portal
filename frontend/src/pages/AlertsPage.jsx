import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { Badge, EmptyState, Toast } from '../components/UI';
import { Icon } from '../components/Icons';

const SEVERITY_COLOR = { critical: 'red', warning: 'orange', info: 'blue' };

function formatTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtSince(iso) {
  if (!iso) return '';
  const raw = String(iso);
  const d = new Date(raw.endsWith('Z') || raw.includes('+') ? raw : `${raw}Z`);
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

export default function AlertsPage() {
  const { theme: t } = useTheme();
  const [alerts, setAlerts] = useState([]);
  const [counts, setCounts] = useState({ firing: 0, resolved: 0, total: 0 });
  const [filter, setFilter] = useState('');   // '' | firing | resolved
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const load = useCallback(async (f, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ limit: 200 });
      if (f) params.set('status', f);
      const [list, cnt] = await Promise.all([
        api(`/alerts?${params}`),
        api('/alerts/counts'),
      ]);
      setAlerts(list);
      setCounts(cnt);
    } catch (err) {
      if (!silent) setToast({ message: err.message || 'Failed to load alerts', tone: 'error' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(filter); }, [filter, load]);
  useEffect(() => {
    const id = setInterval(() => load(filter, true), 30000);
    return () => clearInterval(id);
  }, [filter, load]);

  const pills = [
    { id: '', label: `All (${counts.total})` },
    { id: 'firing', label: `Firing (${counts.firing})` },
    { id: 'resolved', label: `Resolved (${counts.resolved})` },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}

      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, color: t.text, fontSize: 20, fontWeight: 700 }}>Alerts</h2>
        <p style={{ margin: '4px 0 0', color: t.textMuted, fontSize: 13 }}>
          Grafana alerts — delivered live via the alerting webhook
        </p>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        {pills.map(p => {
          const active = filter === p.id;
          return (
            <button key={p.id || 'all'} onClick={() => setFilter(p.id)} style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 13, cursor: 'pointer',
              border: `1px solid ${active ? t.accent : t.border}`,
              background: active ? t.accent : 'transparent',
              color: active ? '#fff' : t.textSecondary,
            }}>{p.label}</button>
          );
        })}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>Loading…</div>
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={<Icon name="siren" size={36} />}
          title="No alerts"
          subtitle="Alerts appear here once Grafana's webhook contact point is configured"
        />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {alerts.map(a => {
            const firing = a.status === 'firing';
            return (
              <div key={a.id} style={{
                border: `1px solid ${firing ? (t.danger || '#d9534f') : t.border}`,
                borderRadius: t.radius, padding: '12px 16px',
                background: firing ? 'rgba(217,83,79,0.06)' : (t.surfaceAlt || t.surface),
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <Badge color={firing ? 'red' : 'green'}>{firing ? 'FIRING' : 'Resolved'}</Badge>
                  {a.severity && <Badge color={SEVERITY_COLOR[a.severity] || 'gray'}>{a.severity}</Badge>}
                  <span style={{ fontWeight: 700, fontSize: 14, color: t.text }}>{a.alertname || '(unnamed alert)'}</span>
                  {a.fire_count > 1 && <span style={{ fontSize: 11, color: t.textMuted }}>fired ×{a.fire_count}</span>}
                  <span style={{ flex: 1 }} />
                  <span style={{ fontSize: 12, color: t.textMuted, whiteSpace: 'nowrap' }}>
                    {firing
                      ? `firing for ${fmtSince(a.starts_at || a.received_at)}`
                      : `resolved ${formatTime(a.ends_at || a.updated_at)}`}
                  </span>
                  {a.generator_url && (
                    <a href={a.generator_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: t.accent, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                      Grafana ↗
                    </a>
                  )}
                </div>
                {a.summary && (
                  <div style={{ marginTop: 6, fontSize: 13, color: t.textSecondary, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {a.summary}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
