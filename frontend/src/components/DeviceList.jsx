import { Badge } from './UI';
import { useLang } from './LangContext';

// Only non-normal states get a pill; "active" is the default and stays quiet.
const STATUS_COLOR = {
  offline: 'gray', planned: 'gray', staged: 'gray',
  failed: 'red', inventory: 'yellow', decommissioning: 'red',
};

const typeName = (d) => d.device_type?.model || d.device_type?.display || d.device_type?.name || '';

export default function DeviceList({ devices, onSelect }) {
  const { t: tr } = useLang();
  if (devices.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{tr('invNoDevices')}</div>;
  }
  // Columns that are empty for every row on this page are dropped (re-evaluated per page).
  const cols = [
    { key: 'name',   label: tr('invFieldName'),     w: '1.6fr', get: d => d.name || d.display || `#${d.id}`, always: true,
      render: v => <span style={{ fontWeight: 600 }}>{v}</span> },
    { key: 'type',   label: tr('invFieldType'),     w: '1.8fr', get: typeName,
      render: v => <span style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v}>{v || '—'}</span> },
    { key: 'role',   label: tr('invFieldRole'),     w: '1fr',   get: d => d.role?.name || '',
      render: v => <span style={{ color: 'var(--text-secondary)' }}>{v || '—'}</span> },
    { key: 'site',   label: tr('invFieldSite'),     w: '0.7fr', get: d => d.site?.name || '',
      render: v => <span style={{ color: 'var(--text-secondary)' }}>{v || '—'}</span> },
    { key: 'status', label: tr('invFieldStatus'),   w: '0.9fr', get: d => (d.status?.name && d.status.name !== 'active') ? d.status.name : '',
      render: (v, d) => v ? <Badge color={STATUS_COLOR[v] || 'gray'}>{d.status?.display || v}</Badge> : <span /> },
    { key: 'serial', label: tr('invFieldSerial'),   w: '1.1fr', get: d => d.serial || '',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)' }}>{v || '—'}</span> },
    { key: 'tag',    label: tr('invFieldAssetTag'), w: '0.7fr', get: d => d.asset_tag || '',
      render: v => <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{v || '—'}</span> },
  ].filter(c => c.always || devices.some(d => c.get(d)));
  const grid = cols.map(c => c.w).join(' ');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: grid, gap: 8,
        padding: '8px 14px', background: 'var(--surface-alt)', fontSize: 11,
        fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em',
      }}>
        {cols.map(c => <span key={c.key}>{c.label}</span>)}
      </div>
      {devices.map(d => (
        <div
          key={d.id}
          onClick={() => onSelect(d)}
          style={{
            display: 'grid', gridTemplateColumns: grid, gap: 8,
            padding: '10px 14px', fontSize: 13, cursor: 'pointer',
            borderTop: '1px solid var(--border-light)', alignItems: 'center',
          }}
        >
          {cols.map(c => <span key={c.key} style={{ minWidth: 0, display: 'flex' }}>{c.render(c.get(d), d)}</span>)}
        </div>
      ))}
    </div>
  );
}
