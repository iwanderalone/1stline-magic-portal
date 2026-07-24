import { Badge } from './UI';
import { useLang } from './LangContext';

const STATUS_COLOR = {
  active: 'green', offline: 'gray', planned: 'blue', staged: 'blue',
  failed: 'red', inventory: 'yellow', decommissioning: 'red',
};

export default function DeviceList({ devices, onSelect }) {
  const { t: tr } = useLang();
  if (devices.length === 0) {
    return <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{tr('invNoDevices')}</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <div style={{
        display: 'grid', gridTemplateColumns: '2fr 1.3fr 1fr 1fr 0.9fr 1.2fr', gap: 8,
        padding: '8px 14px', background: 'var(--surface-alt)', fontSize: 11,
        fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em',
      }}>
        <span>{tr('invFieldName')}</span>
        <span>{tr('invFieldType')}</span>
        <span>{tr('invFieldRole')}</span>
        <span>{tr('invFieldSite')}</span>
        <span>{tr('invFieldStatus')}</span>
        <span>{tr('invFieldSerial')}</span>
      </div>
      {devices.map(d => (
        <div
          key={d.id}
          onClick={() => onSelect(d)}
          style={{
            display: 'grid', gridTemplateColumns: '2fr 1.3fr 1fr 1fr 0.9fr 1.2fr', gap: 8,
            padding: '10px 14px', fontSize: 13, cursor: 'pointer',
            borderTop: '1px solid var(--border-light)', alignItems: 'center',
          }}
        >
          <span style={{ fontWeight: 600 }}>{d.name || d.display || `#${d.id}`}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{d.device_type?.name || '—'}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{d.role?.name || '—'}</span>
          <span style={{ color: 'var(--text-secondary)' }}>{d.site?.name || '—'}</span>
          <span>
            <Badge color={STATUS_COLOR[d.status?.name] || 'gray'}>
              {d.status?.display || d.status?.name || '—'}
            </Badge>
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{d.serial || '—'}</span>
        </div>
      ))}
    </div>
  );
}
