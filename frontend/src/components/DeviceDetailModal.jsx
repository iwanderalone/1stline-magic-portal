import { useEffect, useState } from 'react';
import { api } from '../api';
import { Badge, Button, Overlay } from './UI';
import { useLang } from './LangContext';

const STATUS_COLOR = {
  active: 'green', offline: 'gray', planned: 'blue', staged: 'blue',
  failed: 'red', inventory: 'yellow', decommissioning: 'red',
};

const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };

function Row({ label, value, mono }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px minmax(0, 1fr)', gap: 12, padding: '5px 0' }}>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', wordBreak: 'break-word', ...(mono ? MONO : null) }}>
        {value}
      </span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div className="t-eyebrow" style={{ marginBottom: 6 }}>{title}</div>
      {children}
    </section>
  );
}

/** Read view for a NetBox device: spec, procurement record, and who holds it. */
export default function DeviceDetailModal({ deviceId, onClose, onEdit, canEdit }) {
  const { t: tr } = useLang();
  const [device, setDevice] = useState(null);
  const [holders, setHolders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api(`/tools/inventory/devices/${deviceId}`),
      // Assignments are a separate NetBox call and may be forbidden on their
      // own; a device without them is still worth showing.
      api(`/tools/inventory/devices/${deviceId}/assignments`).catch(() => []),
    ])
      .then(([d, a]) => {
        if (cancelled) return;
        setDevice(d);
        setHolders(a || []);
      })
      .catch(err => !cancelled && setError(err.message || 'Failed to load device'))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [deviceId]);

  const p = device?.procurement || {};
  const title = device ? (device.name || device.display || `#${device.id}`) : tr('invDeviceTitle');

  return (
    <Overlay onClose={onClose} title={title}>
      {loading ? (
        <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>{tr('mailLoading')}</div>
      ) : error ? (
        <div style={{ padding: 16, color: 'var(--danger)', fontSize: 13 }}>{error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Badge color={STATUS_COLOR[device.status?.name] || 'gray'}>
              {device.status?.display || device.status?.name || '—'}
            </Badge>
            {device.role?.display && <Badge color="gray">{device.role.display}</Badge>}
            <span style={{ flex: 1 }} />
            {device.url && (
              <a href={device.url.replace('/api/', '/')} target="_blank" rel="noreferrer"
                 style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>
                {tr('invOpenInNetbox')} ↗
              </a>
            )}
          </div>

          <Section title={tr('invSectionDevice')}>
            <Row label={tr('invFieldSerial')} value={device.serial} mono />
            <Row label={tr('invFieldAssetTag')} value={device.asset_tag} mono />
            <Row label={tr('invFieldType')} value={device.device_type?.display} />
            <Row label={tr('invFieldManufacturer')} value={device.manufacturer?.display} />
            <Row label={tr('invFieldSite')} value={device.site?.display} />
            <Row label={tr('invFieldLocation')} value={device.location?.display} />
            <Row label={tr('invFieldRack')} value={device.rack?.display} />
            <Row label={tr('invFieldTenant')} value={device.tenant?.display} />
            <Row label={tr('invFieldPrimaryIp')} value={device.primary_ip?.address} mono />
          </Section>

          {/* NetBox is the procurement record too, not just a device list. */}
          {(p.supplier || p.invoice_no || p.delivery_date || p.net_price || p.invoice_attachment) && (
            <Section title={tr('invSectionProcurement')}>
              <Row label={tr('invFieldSupplier')} value={p.supplier} />
              <Row label={tr('invFieldInvoiceNo')} value={p.invoice_no} mono />
              <Row label={tr('invFieldDeliveryDate')} value={p.delivery_date} mono />
              <Row label={tr('invFieldNetPrice')} value={p.net_price ? `${p.net_price} AED` : null} mono />
              <Row
                label={tr('invFieldInvoice')}
                value={p.invoice_attachment?.file ? (
                  <a href={p.invoice_attachment.file} target="_blank" rel="noreferrer"
                     style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                    {p.invoice_attachment.name || tr('invOpenFile')} ↗
                  </a>
                ) : null}
              />
              <Row label={tr('invFieldKitParent')} value={p.kit_parent?.display} />
            </Section>
          )}

          <Section title={tr('invSectionHolder')}>
            {holders.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '4px 0' }}>
                {tr('invNoHolder')}
              </div>
            ) : holders.map(h => (
              <div key={h.id} style={{
                border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)',
                padding: '10px 12px', marginTop: 6,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{h.contact?.name || '—'}</span>
                  {h.status && <Badge color={h.status === 'active' ? 'green' : 'gray'}>{h.status}</Badge>}
                  {h.role?.display && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.role.display}</span>}
                </div>
                <Row label={tr('invFieldSignedBy')} value={h.signed_by?.display} />
                <Row
                  label={tr('invFieldHandover')}
                  value={h.handover_attachment?.file ? (
                    <a href={h.handover_attachment.file} target="_blank" rel="noreferrer"
                       style={{ color: 'var(--accent)', textDecoration: 'none' }}>
                      {h.handover_attachment.name || tr('invOpenFile')} ↗
                    </a>
                  ) : null}
                />
              </div>
            ))}
          </Section>

          {device.comments && (
            <Section title={tr('invSectionComments')}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                {device.comments}
              </div>
            </Section>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="ghost" onClick={onClose}>{tr('cancel')}</Button>
            {canEdit && <Button onClick={() => onEdit(device)}>{tr('invEdit')}</Button>}
          </div>
        </div>
      )}
    </Overlay>
  );
}
