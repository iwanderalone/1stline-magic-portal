import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Badge, EmptyState, PageHeader, Toast } from '../components/UI';
import { Icon } from '../components/Icons';

const REFRESH_MS = 30000;

function fmtAge(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function fmtSeconds(v) {
  return v == null ? '—' : `${v.toFixed(2)}s`;
}

function Tile({ label, value, tone, unit }) {
  const { theme: t } = useTheme();
  const tones = {
    ok:   { bg: 'rgba(34,197,94,0.12)',  fg: '#16a34a', border: 'rgba(34,197,94,0.35)' },
    bad:  { bg: 'rgba(217,83,79,0.12)',  fg: t.danger || '#d9534f', border: 'rgba(217,83,79,0.4)' },
    warn: { bg: 'rgba(234,179,8,0.12)',  fg: '#b45309', border: 'rgba(234,179,8,0.4)' },
    none: { bg: t.surfaceAlt || t.surface, fg: t.text, border: t.border },
  };
  const c = tones[tone] || tones.none;
  return (
    <div style={{
      flex: '1 1 150px', minWidth: 140, padding: '14px 16px',
      borderRadius: t.radius, border: `1px solid ${c.border}`, background: c.bg,
    }}>
      <div style={{ fontSize: 12, color: t.textSecondary, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 30, fontWeight: 700, color: c.fg, lineHeight: 1 }}>
        {value}
        {unit && <span style={{ fontSize: 14, fontWeight: 500, marginLeft: 4 }}>{unit}</span>}
      </div>
    </div>
  );
}

function StatusCell({ target, tr }) {
  if (target.stale) return <Badge color="gray">{tr('stStale')}</Badge>;
  if (target.up === false) return <Badge color="red">{tr('stDown')}</Badge>;
  if (target.up === true) return <Badge color="green">{tr('stUp')}</Badge>;
  return <Badge color="gray">—</Badge>;
}

function CertCell({ days }) {
  const { theme: t } = useTheme();
  if (days == null) return <span style={{ color: t.textMuted }}>—</span>;
  const d = Math.floor(days);
  const color = d < 7 ? (t.danger || '#d9534f') : d < 21 ? '#b45309' : t.textSecondary;
  return <span style={{ color, fontWeight: d < 21 ? 700 : 400 }}>{d}d</span>;
}

function GroupTable({ group, tr }) {
  const { theme: t } = useTheme();
  const th = {
    textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600,
    color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4,
    borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap',
  };
  const td = { padding: '8px 10px', fontSize: 13, color: t.text, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' };
  const problems = group.targets.filter(x => x.up === false || x.stale).length;

  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 className="t-h2" style={{ fontSize: 16, margin: 0, color: t.text }}>{group.name}</h2>
        <span style={{ fontSize: 12, color: t.textMuted }}>{group.targets.length}</span>
        {problems > 0 && <Badge color="red">{problems}</Badge>}
      </div>
      <div style={{ overflowX: 'auto', border: `1px solid ${t.border}`, borderRadius: t.radius }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={th}>{tr('stInstance')}</th>
              <th style={th}>{tr('stStatus')}</th>
              <th style={th}>{tr('stCode')}</th>
              <th style={th}>{tr('stTls')}</th>
              <th style={th}>{tr('stCert')}</th>
              <th style={th}>{tr('stProbe')}</th>
              <th style={th}>{tr('stDns')}</th>
              <th style={th}>{tr('stAge')}</th>
            </tr>
          </thead>
          <tbody>
            {group.targets.map(x => {
              const bad = x.up === false;
              const codeBad = x.http_status && x.http_status >= 400;
              return (
                <tr key={x.instance} style={{ background: bad ? 'rgba(217,83,79,0.06)' : 'transparent' }}>
                  <td style={{ ...td, whiteSpace: 'normal', wordBreak: 'break-all' }}>
                    <a href={x.instance} target="_blank" rel="noreferrer"
                       style={{ color: t.accent, textDecoration: 'none' }}>{x.instance}</a>
                  </td>
                  <td style={td}><StatusCell target={x} tr={tr} /></td>
                  <td style={{ ...td, color: codeBad ? (t.danger || '#d9534f') : t.text, fontWeight: codeBad ? 700 : 400 }}>
                    {x.http_status || '—'}
                  </td>
                  <td style={{ ...td, color: t.textSecondary }}>{x.tls_version || '—'}</td>
                  <td style={td}><CertCell days={x.ssl_expiry_days} /></td>
                  <td style={{ ...td, color: t.textSecondary }}>{fmtSeconds(x.probe_duration)}</td>
                  <td style={{ ...td, color: t.textSecondary }}>{fmtSeconds(x.dns_lookup)}</td>
                  <td style={{ ...td, color: x.stale ? (t.danger || '#d9534f') : t.textMuted }}>{fmtAge(x.age_seconds)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function StatusPage() {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [board, setBoard] = useState(null);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [b, s] = await Promise.all([api('/status'), api('/status/summary')]);
      setBoard(b);
      setSummary(s);
    } catch (err) {
      if (!silent) setToast({ message: err.message || 'Failed to load status', tone: 'error' });
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const id = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const groups = board?.groups || [];
  const empty = !loading && groups.length === 0;

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}

      <PageHeader title={tr('stTitle')} subtitle={tr('stSubtitle')} />

      {summary && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 22 }}>
          <Tile label={tr('stDownTile')} value={summary.down} tone={summary.down ? 'bad' : 'ok'} />
          <Tile label={tr('st5xx')} value={summary.http_5xx} tone={summary.http_5xx ? 'bad' : 'ok'} />
          <Tile label={tr('stCerts7d')} value={summary.certs_expiring} tone={summary.certs_expiring ? 'warn' : 'ok'} />
          <Tile label={tr('stStaleTile')} value={summary.stale} tone={summary.stale ? 'warn' : 'ok'} />
          <Tile label={tr('stAvgLatency')} value={summary.avg_latency_ms ?? '—'} unit={summary.avg_latency_ms != null ? 'ms' : ''} tone="none" />
        </div>
      )}

      {summary && summary.stale > 0 && summary.stale === summary.total && (
        <div style={{
          marginBottom: 18, padding: '10px 14px', borderRadius: t.radius, fontSize: 13,
          border: `1px solid ${t.danger || '#d9534f'}`, background: 'rgba(217,83,79,0.08)', color: t.text,
        }}>
          {tr('stAllStale')}
        </div>
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: t.textMuted }}>{tr('mailLoading')}</div>
      ) : empty ? (
        <EmptyState
          icon={<Icon name="server" size={36} />}
          title={tr('stNoData')}
          subtitle={tr('stNoDataDesc')}
        />
      ) : (
        groups.map(g => <GroupTable key={g.name} group={g} tr={tr} />)
      )}
    </div>
  );
}
