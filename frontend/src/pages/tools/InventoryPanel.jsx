import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import { Button, EmptyState, Select, Toast, PageHeader } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useLang } from '../../components/LangContext';
import DeviceList from '../../components/DeviceList';
import DeviceFormModal from '../../components/DeviceFormModal';

const PAGE_SIZE = 20;

export default function InventoryPanel({ user }) {
  const { lang, t: tr } = useLang();
  const canEdit = user?.role === 'admin' || user?.role === 'manager';
  const [enabled, setEnabled] = useState(null); // null = loading
  const [q, setQ] = useState('');
  const [site, setSite] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const [devices, setDevices] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [lookups, setLookups] = useState({ deviceTypes: [], sites: [], roles: [] });
  const [editing, setEditing] = useState(null); // null | 'new' | device object
  const [toast, setToast] = useState(null);

  useEffect(() => {
    api('/tools/status').then(d => setEnabled(!!d?.netbox)).catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    Promise.all([
      api('/tools/inventory/device-types'),
      api('/tools/inventory/sites'),
      api('/tools/inventory/device-roles'),
    ]).then(([deviceTypes, sites, roles]) => setLookups({ deviceTypes, sites, roles })).catch(() => {});
  }, [enabled]);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: PAGE_SIZE });
      if (q) params.set('q', q);
      if (site) params.set('site', site);
      if (role) params.set('role', role);
      if (status) params.set('status', status);
      const d = await api(`/tools/inventory/devices?${params}`);
      setDevices(d.items);
      setTotal(d.total);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [enabled, page, q, site, role, status]);

  useEffect(() => { load(); }, [load]);

  const onSearchSubmit = (e) => { e.preventDefault(); setPage(1); load(); };

  const onSaved = () => {
    setEditing(null);
    setToast({ message: tr('invSaved'), type: 'success' });
    load();
  };

  if (enabled === null) return null;

  if (enabled === false) {
    return (
      <EmptyState
        icon={<Icon name="box" size={40} />}
        title={tr('invNotConfigured')}
        subtitle={tr('invNotConfiguredDesc')}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {editing && (
        <DeviceFormModal
          device={editing === 'new' ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      <PageHeader title={tr('invTitle')} subtitle={tr('invSubtitle')} />

      <form onSubmit={onSearchSubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <label className="t-eyebrow" style={{ marginBottom: 0 }}>{tr('invSearch')}</label>
            <span 
              title={lang === 'ru' ? "Поиск сопоставляет название, серийный номер или инвентарную метку" : "Search matches name, serial number, or asset tag"} 
              style={{ 
                cursor: 'help', 
                fontSize: 10, 
                color: 'var(--text-muted)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 14,
                height: 14,
                borderRadius: '50%',
                background: 'var(--surface-alt)',
                border: '1px solid var(--border-light)',
                fontWeight: 'bold',
                lineHeight: 1
              }}
            >
              ?
            </span>
          </div>
          <input
            value={q} onChange={e => setQ(e.target.value)}
            placeholder={tr('invSearchPlaceholder')}
            style={{
              padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontSize: 13, background: 'var(--surface-alt)', color: 'var(--text)', outline: 'none',
            }}
          />
        </div>
        <Select label={tr('invFieldSite')} value={site} onChange={e => setSite(e.target.value)} style={{ minWidth: 140 }}>
          <option value="">{tr('invFilterAll')}</option>
          {lookups.sites.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select label={tr('invFieldRole')} value={role} onChange={e => setRole(e.target.value)} style={{ minWidth: 140 }}>
          <option value="">{tr('invFilterAll')}</option>
          {lookups.roles.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        <Select label={tr('invFieldStatus')} value={status} onChange={e => setStatus(e.target.value)} style={{ minWidth: 130 }}>
          <option value="">{tr('invFilterAll')}</option>
          <option value="active">Active</option>
          <option value="offline">Offline</option>
          <option value="planned">Planned</option>
          <option value="staged">Staged</option>
          <option value="failed">Failed</option>
          <option value="inventory">Inventory</option>
          <option value="decommissioning">Decommissioning</option>
        </Select>
        <Button type="submit" variant="secondary" icon="search">{tr('invSearchBtn')}</Button>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <Button type="button" variant="primary" icon="plus" onClick={() => setEditing('new')}>
            {tr('invNewDevice')}
          </Button>
        )}
      </form>

      <DeviceList devices={devices} onSelect={(d) => canEdit && setEditing(d)} />

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
          <Button variant="ghost" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(p => p - 1)}>
            {tr('toolPrev')}
          </Button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {tr('toolPageOf').replace('{page}', page).replace('{total}', Math.max(1, Math.ceil(total / PAGE_SIZE)))}
          </span>
          <Button variant="ghost" size="sm" disabled={page >= Math.ceil(total / PAGE_SIZE) || loading} onClick={() => setPage(p => p + 1)}>
            {tr('toolNext')}
          </Button>
        </div>
      )}
    </div>
  );
}
