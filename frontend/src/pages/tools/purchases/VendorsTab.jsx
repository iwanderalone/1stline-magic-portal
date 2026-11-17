import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import { Badge, Button, Input, Overlay, Select } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { CategoryOptions, Money, bodyRow, fmtDate, grid2, headRow, tableBox, textarea, useLabels } from './shared';

const COLS = '2fr 1.2fr 0.8fr 1.1fr 1fr 0.4fr';

// Who we pay. Rows are created on their own the first time a name shows up
// (a subscription, a payment, an invoice); here they are renamed, given the
// legal names their invoices carry, and merged when one company got two rows.
function VendorForm({ vendor, vendors, onClose, onSaved, onToast }) {
  const { t: tr } = useLang();
  const isEdit = !!vendor;
  const [form, setForm] = useState({
    name: vendor?.name || '',
    aliases: (vendor?.aliases || []).join('\n'),
    category: vendor?.category || '',
    website: vendor?.website || '',
    notes: vendor?.notes || '',
    is_active: vendor?.is_active ?? true,
  });
  const [mergeInto, setMergeInto] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      aliases: form.aliases.split('\n').map(a => a.trim()).filter(Boolean),
      category: form.category || null,
      website: form.website.trim() || null,
      notes: form.notes.trim() || null,
      is_active: form.is_active,
    };
    try {
      await (isEdit
        ? api(`/purchases/vendors/${vendor.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : api('/purchases/vendors', { method: 'POST', body: JSON.stringify(payload) }));
      onSaved(tr('purSaved'));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const merge = async () => {
    const target = vendors.find(v => String(v.id) === mergeInto);
    if (!target || !window.confirm(tr('purVendorMergeConfirm').replace('{from}', vendor.name).replace('{to}', target.name))) return;
    try {
      await api(`/purchases/vendors/${vendor.id}/merge`, { method: 'POST', body: JSON.stringify({ into_id: target.id }) });
      onSaved(tr('purVendorMerged').replace('{to}', target.name));
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
    }
  };

  return (
    <Overlay title={isEdit ? tr('purVendorEdit') : tr('purVendorNew')} onClose={onClose} maxWidth={620}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={grid2}>
          <Input label={tr('purVendor')} value={form.name} onChange={set('name')} required />
          <Select label={tr('purVendorCategory')} value={form.category} onChange={set('category')}>
            <option value="">—</option>
            <CategoryOptions current={form.category} />
          </Select>
          <Input label={tr('purVendorWebsite')} value={form.website} onChange={set('website')} placeholder="https://" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label className="t-eyebrow">{tr('purVendorAliases')}</label>
          <textarea rows={3} value={form.aliases} onChange={set('aliases')} style={textarea}
            placeholder="RealtimeBoard Inc. dba Miro" />
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('purVendorAliasesHint')}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label className="t-eyebrow">{tr('purNotes')}</label>
          <textarea rows={2} value={form.notes} onChange={set('notes')} style={textarea} />
        </div>
        {isEdit && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={!form.is_active} onChange={e => setForm(f => ({ ...f, is_active: !e.target.checked }))} />
            {tr('purVendorArchived')}
          </label>
        )}
        {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? tr('purSaving') : tr('save')}</Button>
        </div>

        {isEdit && (
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="t-eyebrow">{tr('purVendorMerge')}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('purVendorMergeHint')}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <Select value={mergeInto} onChange={e => setMergeInto(e.target.value)}>
                  <option value="">{tr('purVendorMergePick')}</option>
                  {vendors.filter(v => v.id !== vendor.id).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              </div>
              <Button type="button" variant="secondary" disabled={!mergeInto} onClick={merge}>{tr('purVendorMergeBtn')}</Button>
            </div>
          </div>
        )}
      </form>
    </Overlay>
  );
}

export default function VendorsTab({ lookups, reloadKey, onGo, onChanged, onToast }) {
  const { lang, t: tr } = useLang();
  const L = useLabels();
  const [vendors, setVendors] = useState(lookups.vendors);
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState(null); // null | 'new' | vendor

  useEffect(() => { api('/purchases/vendors').then(d => setVendors(d || [])).catch(() => {}); }, [reloadKey]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return vendors
      .filter(v => archived || v.is_active)
      .filter(v => !needle || [v.name, ...v.aliases].some(n => n.toLowerCase().includes(needle)))
      // Who costs the most first; one-off suppliers after, by last payment.
      .sort((a, b) => (b.monthly_aed - a.monthly_aed) || String(b.last_paid_on || '').localeCompare(String(a.last_paid_on || '')));
  }, [vendors, q, archived]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {editing && (
        <VendorForm
          vendor={editing === 'new' ? null : editing}
          vendors={vendors}
          onClose={() => setEditing(null)}
          onToast={onToast}
          onSaved={(msg) => { setEditing(null); onChanged(); onToast({ message: msg, type: 'success' }); }}
        />
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 240px' }}>
          <Input label={tr('purSearch')} value={q} onChange={e => setQ(e.target.value)} placeholder={tr('purVendorSearchHint')} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer', height: 36 }}>
          <input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} /> {tr('purShowArchived')}
        </label>
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>{tr('purVendorNew')}</Button>
      </div>

      {shown.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{tr('purNoVendors')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ ...tableBox, minWidth: 720 }}>
            <div style={headRow(COLS)}>
              <span>{tr('purVendor')}</span>
              <span>{tr('purCategory')}</span>
              <span>{tr('purTab_subscriptions')}</span>
              <span>{tr('purPerMonth')}</span>
              <span>{tr('purLastPayment')}</span>
              <span />
            </div>
            {shown.map(v => (
              <div key={v.id} style={{ ...bodyRow(COLS, true), opacity: v.is_active ? 1 : 0.55 }} onClick={() => setEditing(v)}>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, display: 'flex', gap: 6, alignItems: 'center' }}>
                    {v.name}
                    {!v.is_active && <Badge color="gray">{tr('purArchived')}</Badge>}
                  </div>
                  {v.aliases.length > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      title={v.aliases.join('\n')}>
                      {v.aliases.join(' · ')}
                    </div>
                  )}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{v.category ? L.category(v.category) : '—'}</span>
                <span onClick={e => e.stopPropagation()}>
                  {v.subscriptions > 0
                    ? <a onClick={() => onGo('subscriptions', { vendor_id: v.id })} style={{ color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font-mono)' }}>{v.subscriptions}</a>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </span>
                <span>{v.monthly_aed ? <Money aed={v.monthly_aed} usd={v.monthly_usd} /> : <span style={{ color: 'var(--text-muted)' }}>—</span>}</span>
                <span style={{ fontSize: 12 }} onClick={e => e.stopPropagation()}>
                  {v.last_paid_on
                    ? <a onClick={() => onGo('payments', { vendor_id: v.id, from: '2000-01-01' })} style={{ color: 'var(--accent)', cursor: 'pointer' }}>
                        {fmtDate(v.last_paid_on, lang)}
                      </a>
                    : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  {v.payments > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('purPaymentsCount').replace('{n}', v.payments)}</div>}
                </span>
                <span style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button size="sm" variant="ghost" icon="edit" title={tr('edit')} onClick={(e) => { e.stopPropagation(); setEditing(v); }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
