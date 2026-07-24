import { useEffect, useState } from 'react';
import { api } from '../api';
import { Button, Input, Overlay, Select } from './UI';
import { useLang } from './LangContext';

// Create/edit only — there is deliberately no delete action anywhere in this
// component or the API it calls.
export default function DeviceFormModal({ device, lookups, onClose, onSaved }) {
  const { t: tr } = useLang();
  const isEdit = !!device;
  const [form, setForm] = useState({
    name: device?.name || '',
    device_type: device?.device_type?.id || '',
    role: device?.role?.id || '',
    site: device?.site?.id || '',
    status: device?.status?.name || 'active',
    serial: device?.serial || '',
    asset_tag: device?.asset_tag || '',
    comments: device?.comments || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name,
      device_type: Number(form.device_type),
      role: Number(form.role),
      site: Number(form.site),
      status: form.status,
      serial: form.serial || null,
      asset_tag: form.asset_tag || null,
      comments: form.comments || null,
    };
    try {
      if (isEdit) {
        await api(`/tools/inventory/devices/${device.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        await api('/tools/inventory/devices', { method: 'POST', body: JSON.stringify(payload) });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay onClose={onClose} title={isEdit ? tr('invEditDevice') : tr('invNewDevice')} maxWidth={480}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Input label={tr('invFieldName')} value={form.name} onChange={set('name')} required maxLength={64} />
        <Select label={tr('invFieldType')} value={form.device_type} onChange={set('device_type')} required>
          <option value="" disabled>{tr('invSelectPlaceholder')}</option>
          {lookups.deviceTypes.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select label={tr('invFieldRole')} value={form.role} onChange={set('role')} required>
          <option value="" disabled>{tr('invSelectPlaceholder')}</option>
          {lookups.roles.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select label={tr('invFieldSite')} value={form.site} onChange={set('site')} required>
          <option value="" disabled>{tr('invSelectPlaceholder')}</option>
          {lookups.sites.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select label={tr('invFieldStatus')} value={form.status} onChange={set('status')}>
          <option value="active">Active</option>
          <option value="offline">Offline</option>
          <option value="planned">Planned</option>
          <option value="staged">Staged</option>
          <option value="failed">Failed</option>
          <option value="inventory">Inventory</option>
          <option value="decommissioning">Decommissioning</option>
        </Select>
        <Input label={tr('invFieldSerial')} value={form.serial} onChange={set('serial')} maxLength={50} />
        <Input label={tr('invFieldAssetTag')} value={form.asset_tag} onChange={set('asset_tag')} maxLength={50} />
        <Input label={tr('invFieldComments')} value={form.comments} onChange={set('comments')} />
        {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={saving}>{tr('save')}</Button>
        </div>
      </form>
    </Overlay>
  );
}
