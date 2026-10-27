import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Badge, CountChip, EmptyState, PageHeader, Toast } from '../components/UI';
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

// Section names come from a Prometheus label ("internal", "external_sites"), so
// tidy them for display without touching the value used for ordering.
function sectionName(raw) {
  return String(raw)
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Only an "up" target is quiet text; stale and down are the exceptions.
function StatusCell({ target, tr }) {
  if (target.stale) return <Badge color="yellow">{tr('stStale')}</Badge>;
  if (target.up === false) return <Badge color="red">{tr('stDown')}</Badge>;
  if (target.up === true) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{tr('stUp').toLowerCase()}</span>;
  return <span style={{ color: 'var(--text-muted)' }}>—</span>;
}

/* One summary line instead of KPI tiles: alarm counts go red only when non-zero. */
function SummaryLine({ summary, tr }) {
  const items = [
    [summary.down, tr('stDownTile'), true],
    [summary.http_5xx, tr('st5xx'), true],
    [summary.certs_expiring, tr('stCerts7d'), true],
    [summary.stale, tr('stStaleTile'), true],
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 0', fontSize: 13, color: 'var(--text-secondary)', marginBottom: 22 }}>
      {items.map(([n, label, alarm], i) => (
        <span key={label}>
          {i > 0 && <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>·</span>}
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: n && alarm ? 600 : 400, color: n && alarm ? 'var(--danger)' : 'var(--text)' }}>{n ?? 0}</span>
          {' '}<span style={{ color: n && alarm ? 'var(--danger)' : 'var(--text-secondary)' }}>{label.toLowerCase()}</span>
        </span>
      ))}
      <span>
        <span style={{ color: 'var(--text-muted)', margin: '0 8px' }}>·</span>
        {tr('stAvgLatency').toLowerCase()}{' '}
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{summary.avg_latency_ms != null ? `${summary.avg_latency_ms} ms` : '—'}</span>
      </span>
    </div>
  );
}

function CertCell({ days }) {
  const { theme: t } = useTheme();
  if (days == null) return <span style={{ color: t.textMuted }}>—</span>;
  const d = Math.floor(days);
  const color = d < 7 ? 'var(--danger)' : d < 21 ? 'var(--warning)' : t.textMuted;
  return <span style={{ color, fontWeight: d < 21 ? 600 : 400 }}>{d}d</span>;
}

function GroupTable({ group, tr, showDns }) {
  const { theme: t } = useTheme();
  const th = {
    textAlign: 'left', padding: '8px 10px', fontSize: 11, fontWeight: 600,
    color: t.textMuted, textTransform: 'uppercase', letterSpacing: 0.4,
    borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap',
  };
  const td = { padding: '8px 10px', fontSize: 13, color: t.text, borderBottom: `1px solid ${t.border}`, whiteSpace: 'nowrap' };
  const num = { ...td, fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums' };
  const problems = group.targets.filter(x => x.up === false || x.stale).length;

  return (
    <section style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <h2 className="t-h2" style={{ fontSize: 16, margin: 0, color: t.text }}>{sectionName(group.name)}</h2>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: t.textMuted }}>{group.targets.length}</span>
        {problems > 0 && <CountChip value={problems} tone="danger" />}
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
              {showDns && <th style={th}>{tr('stDns')}</th>}
              <th style={th}>{tr('stAge')}</th>
            </tr>
          </thead>
          <tbody>
            {group.targets.map(x => {
              const bad = x.up === false;
              const codeBad = x.http_status && x.http_status >= 400;
              return (
                <tr key={x.instance} style={{ background: bad ? 'var(--danger-light)' : 'transparent' }}>
                  <td style={{ ...td, whiteSpace: 'normal', wordBreak: 'break-all' }}>
                    <a href={x.instance} target="_blank" rel="noreferrer"
                       style={{ color: t.accent, textDecoration: 'none' }}>{x.instance}</a>
                  </td>
                  <td style={td}><StatusCell target={x} tr={tr} /></td>
                  <td style={{ ...num, color: codeBad ? 'var(--danger)' : t.textSecondary, fontWeight: codeBad ? 600 : 400 }}>
                    {x.http_status || '—'}
                  </td>
                  <td style={{ ...num, color: t.textMuted }}>{x.tls_version || '—'}</td>
                  <td style={num}><CertCell days={x.ssl_expiry_days} /></td>
                  <td style={{ ...num, color: t.textSecondary }}>{fmtSeconds(x.probe_duration)}</td>
                  {showDns && <td style={{ ...num, color: t.textSecondary }}>{fmtSeconds(x.dns_lookup)}</td>}
                  <td style={{ ...num, color: x.stale ? 'var(--danger)' : t.textMuted }}>{fmtAge(x.age_seconds)}</td>
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
  // A column of 0.00s says nothing; show DNS only when some lookup took time.
  const showDns = groups.some(g => g.targets.some(x => x.dns_lookup != null && x.dns_lookup >= 0.005));

  return (
    <div>
      {toast && <Toast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />}

      <PageHeader title={tr('stTitle')} subtitle={tr('stSubtitle')} />

      {summary && <SummaryLine summary={summary} tr={tr} />}

      {summary && summary.stale > 0 && summary.stale === summary.total && (
        <div style={{
          marginBottom: 18, padding: '10px 14px', borderRadius: t.radius, fontSize: 13,
          border: '1px solid var(--danger)', background: 'var(--danger-light)', color: t.text,
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
        groups.map(g => <GroupTable key={g.name} group={g} tr={tr} showDns={showDns} />)
      )}
    </div>
  );
}
