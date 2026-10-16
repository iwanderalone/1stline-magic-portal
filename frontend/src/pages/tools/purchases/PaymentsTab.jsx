import { useCallback, useEffect, useRef, useState } from 'react';
import { api, apiBlob } from '../../../api';
import { Badge, Button, Input, Overlay, Select } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import {
  Money, VendorPrice, bodyRow, fmtDate, grid2, headRow, tableBox, textarea, todayISO, useLabels,
} from './shared';

const COLS = '0.9fr 1.8fr 1fr 1.1fr 1.1fr 0.9fr 0.5fr';

function PaymentForm({ payment, lookups, subs, onClose, onSaved }) {
  const { t: tr } = useLang();
  const L = useLabels();
  const isEdit = !!payment;
  const confirming = payment?.status === 'unconfirmed';
  const [form, setForm] = useState({
    subscription_id: payment?.subscription_id || '',
    paid_on: payment?.paid_on || todayISO(),
    vendor: payment?.vendor || '',
    description: payment?.description || '',
    category: payment?.category || 'hardware',
    budget_id: payment?.budget?.id || '',
    payment_method: payment?.payment_method || 'card',
    card_id: payment?.card?.id || '',
    amount: payment?.amount ?? '',
    currency: payment?.currency || 'AED',
    amount_aed: payment?.amount_aed ?? '',
    invoice_no: payment?.invoice_no || '',
    notes: payment?.notes || '',
  });
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  // Picking a subscription pre-fills the rest; the server does the same for
  // anything left empty, this just shows it.
  const pickSub = (e) => {
    const id = e.target.value;
    const s = subs.find(x => String(x.id) === id);
    setForm(f => ({
      ...f, subscription_id: id,
      ...(s ? {
        vendor: s.vendor, description: s.product || '', category: s.category, budget_id: s.budget?.id || '',
        payment_method: s.payment_method, card_id: s.card?.id || '', amount: s.price, currency: s.currency, amount_aed: '',
      } : {}),
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const payload = {
      subscription_id: num(form.subscription_id),
      paid_on: form.paid_on,
      vendor: form.vendor || null,
      description: form.description || null,
      category: form.category,
      budget_id: num(form.budget_id),
      payment_method: form.payment_method,
      card_id: form.payment_method === 'card' ? num(form.card_id) : null,
      amount: Number(form.amount || 0),
      currency: form.currency,
      amount_aed: num(form.amount_aed),
      invoice_no: form.invoice_no || null,
      notes: form.notes || null,
      status: 'confirmed',
    };
    try {
      const saved = isEdit
        ? await api(`/purchases/payments/${payment.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/purchases/payments', { method: 'POST', body: JSON.stringify(payload) });
      if (file) {
        const fd = new FormData();
        fd.append('file', file);
        await api(`/purchases/payments/${saved.id}/invoice`, { method: 'POST', body: fd });
      }
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Overlay title={confirming ? tr('purConfirmPayment') : isEdit ? tr('purEditPayment') : tr('purNewPayment')} onClose={onClose} maxWidth={720}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {confirming && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tr('purConfirmHint')}</div>}
        <div style={grid2}>
          <Select label={tr('purSubscription')} value={form.subscription_id} onChange={pickSub}>
            <option value="">{tr('purOneOff')}</option>
            {subs.map(s => <option key={s.id} value={s.id}>{s.vendor}{s.product ? ` — ${s.product}` : ''}</option>)}
          </Select>
          <Input label={tr('purPaidOn')} type="date" value={form.paid_on} onChange={set('paid_on')} required />
          <Input label={tr('purVendor')} value={form.vendor} onChange={set('vendor')} required={!form.subscription_id} />
          <Input label={tr('purDescription')} value={form.description} onChange={set('description')} />
          <Select label={tr('purCategory')} value={form.category} onChange={set('category')}>
            {lookups.meta.categories.map(c => <option key={c} value={c}>{L.category(c)}</option>)}
          </Select>
          <Select label={tr('purBudget')} value={form.budget_id} onChange={set('budget_id')}>
            <option value="">—</option>
            {lookups.departments.filter(d => d.is_active || d.id === form.budget_id).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Input label={tr('purAmount')} type="number" step="0.01" min="0" value={form.amount} onChange={set('amount')} required />
          <Select label={tr('purCurrency')} value={form.currency} onChange={set('currency')}>
            {lookups.meta.currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Input label={tr('purAmountAed')} type="number" step="0.01" min="0" value={form.amount_aed} onChange={set('amount_aed')}
            placeholder={tr('purAmountAedHint')} />
          <Select label={tr('purMethod')} value={form.payment_method} onChange={set('payment_method')}>
            {lookups.meta.payment_methods.map(m => <option key={m} value={m}>{L.method(m)}</option>)}
          </Select>
          {form.payment_method === 'card' && (
            <Select label={tr('purCard')} value={form.card_id} onChange={set('card_id')}>
              <option value="">—</option>
              {lookups.cards.filter(c => c.is_active || c.id === form.card_id).map(c => <option key={c.id} value={c.id}>{L.card(c)}</option>)}
            </Select>
          )}
          <Input label={tr('purInvoiceNo')} value={form.invoice_no} onChange={set('invoice_no')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label className="t-eyebrow">{tr('purInvoiceFile')}{payment?.has_invoice ? ` (${tr('purAttached')})` : ''}</label>
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={e => setFile(e.target.files?.[0] || null)} style={{ fontSize: 12 }} />
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label className="t-eyebrow">{tr('purNotes')}</label>
          <textarea rows={2} value={form.notes} onChange={set('notes')} style={textarea} />
        </div>
        {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? tr('purSaving') : confirming ? tr('purConfirmBtn') : tr('save')}
          </Button>
        </div>
      </form>
    </Overlay>
  );
}

export default function PaymentsTab({ lookups, reloadKey, onChanged, onToast }) {
  const { lang, t: tr } = useLang();
  const L = useLabels();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [data, setData] = useState({ items: [], total: 0, total_aed: 0, total_usd: 0 });
  const [subs, setSubs] = useState([]);
  const [editing, setEditing] = useState(null); // null | 'new' | payment
  const first = useRef(true);

  const load = useCallback(() => {
    const p = new URLSearchParams({ page_size: 500 });
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    if (status) p.set('status', status);
    if (q.trim()) p.set('q', q.trim());
    return api(`/purchases/payments?${p}`).then(d => d && setData(d)).catch(err => onToast({ message: err.message, type: 'error' }));
  }, [from, to, status, q, onToast]);

  useEffect(() => {
    const t = setTimeout(load, first.current ? 0 : 250);
    first.current = false;
    return () => clearTimeout(t);
  }, [load, reloadKey]);
  useEffect(() => { api('/purchases/subscriptions?status=all').then(d => setSubs(d || [])).catch(() => {}); }, [reloadKey]);

  const remove = async (p) => {
    if (!window.confirm(tr('purPaymentDeleteConfirm').replace('{name}', p.vendor).replace('{date}', fmtDate(p.paid_on, lang)))) return;
    try {
      await api(`/purchases/payments/${p.id}`, { method: 'DELETE' });
      setEditing(null);
      load();
      onChanged();
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
    }
  };

  const openInvoice = async (p, e) => {
    e.stopPropagation();
    try {
      const blob = await apiBlob(`/purchases/payments/${p.id}/invoice`, { method: 'GET' });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {editing && (
        <PaymentForm
          payment={editing === 'new' ? null : editing}
          lookups={lookups} subs={subs}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); onChanged(); onToast({ message: tr('purSaved'), type: 'success' }); }}
        />
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Input label={tr('purFrom')} type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <Input label={tr('purTo')} type="date" value={to} onChange={e => setTo(e.target.value)} />
        <Select label={tr('purStatus')} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">{tr('purAll')}</option>
          <option value="unconfirmed">{tr('purUnconfirmed')}</option>
          <option value="confirmed">{tr('purConfirmed')}</option>
        </Select>
        <div style={{ flex: '1 1 200px' }}>
          <Input label={tr('purSearch')} value={q} onChange={e => setQ(e.target.value)} placeholder={tr('purPaymentSearchHint')} />
        </div>
        <Button variant="primary" icon="plus" onClick={() => setEditing('new')}>{tr('purNewPayment')}</Button>
      </div>

      {data.items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{tr('purNoPayments')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ ...tableBox, minWidth: 780 }}>
            <div style={headRow(COLS)}>
              <span>{tr('purPaidOn')}</span>
              <span>{tr('purVendor')}</span>
              <span>{tr('purAmount')}</span>
              <span>{tr('purInAccounting')}</span>
              <span>{tr('purMethod')}</span>
              <span>{tr('purBudget')}</span>
              <span />
            </div>
            {data.items.map(p => (
              <div key={p.id} style={{ ...bodyRow(COLS, true), background: p.status === 'unconfirmed' ? 'var(--warning-light)' : undefined }}
                onClick={() => setEditing(p)}>
                <span style={{ fontSize: 12 }}>{fmtDate(p.paid_on, lang)}</span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{p.vendor}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.description || L.category(p.category)}
                  </div>
                  {p.netbox_device_ids?.length > 0 && lookups.meta.netbox_url && (
                    <div style={{ fontSize: 11, display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
                      <span style={{ color: 'var(--text-muted)' }}>{tr('purDevices')}:</span>
                      {p.netbox_device_ids.map(id => (
                        <a key={id} href={`${lookups.meta.netbox_url}/dcim/devices/${id}/`} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--accent)', textDecoration: 'none' }}>#{id}</a>
                      ))}
                    </div>
                  )}
                </span>
                <span style={{ fontSize: 12 }}><VendorPrice amount={p.amount} currency={p.currency} /></span>
                <span><Money aed={p.amount_aed} usd={p.amount_usd} /></span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {L.method(p.payment_method)}
                  {p.card && <div style={{ color: 'var(--text-muted)' }}>{L.card(p.card)}</div>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {p.budget?.name || '—'}
                  {p.status === 'unconfirmed' && <div><Badge color="yellow">{tr('purUnconfirmed')}</Badge></div>}
                </span>
                <span style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                  {p.has_invoice && <Button size="sm" variant="ghost" icon="paperclip" onClick={(e) => openInvoice(p, e)} title={tr('purInvoiceFile')} />}
                  <Button size="sm" variant="ghost" icon="trash" onClick={(e) => { e.stopPropagation(); remove(p); }} title={tr('delete')} />
                </span>
              </div>
            ))}
            <div style={{ ...bodyRow(COLS), background: 'var(--surface-alt)', fontWeight: 600 }}>
              <span />
              <span>{tr('purPaymentsCount').replace('{n}', data.total)}</span>
              <span />
              <span><Money aed={data.total_aed} usd={data.total_usd} strong /></span>
              <span /><span /><span />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
