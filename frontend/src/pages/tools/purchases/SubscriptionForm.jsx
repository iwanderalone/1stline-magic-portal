import { useState } from 'react';
import { api } from '../../../api';
import { Button, Input, Overlay, Select } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { grid2, textarea, useLabels } from './shared';

const CYCLES = [1, 3, 6, 12, 24, 36];

export default function SubscriptionForm({ sub, lookups, onClose, onSaved }) {
  const { t: tr } = useLang();
  const L = useLabels();
  const isEdit = !!sub;
  const [form, setForm] = useState({
    vendor: sub?.vendor || '',
    product: sub?.product || '',
    category: sub?.category || 'software',
    seller: sub?.seller || '',
    owner_user_ids: sub?.owners?.map(o => o.id) || [],
    budget_id: sub?.budget?.id ?? (lookups.departments.find(d => d.name === 'IT')?.id || ''),
    account_email: sub?.account_email || '',
    billing_url: sub?.billing_url || '',
    reference: sub?.reference || '',
    payment_method: sub?.payment_method || 'card',
    card_id: sub?.card?.id || '',
    cycle_months: sub?.cycle_months || 1,
    price: sub?.price ?? '',
    currency: sub?.currency || 'AED',
    seats_total: sub?.seats_total ?? '',
    next_renewal: sub?.next_renewal || '',
    auto_renew: sub?.auto_renew ?? true,
    status: sub?.status || 'active',
    notify_days_before: sub?.notify_days_before ?? '',
    notes: sub?.notes || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const toggleOwner = (id) => setForm(f => ({
    ...f, owner_user_ids: f.owner_user_ids.includes(id) ? f.owner_user_ids.filter(x => x !== id) : [...f.owner_user_ids, id],
  }));

  const submit = async (e) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const payload = {
      ...form,
      product: form.product || null,
      seller: form.seller || null,
      account_email: form.account_email || null,
      billing_url: form.billing_url || null,
      reference: form.reference || null,
      notes: form.notes || null,
      budget_id: num(form.budget_id),
      card_id: form.payment_method === 'card' ? num(form.card_id) : null,
      cycle_months: Number(form.cycle_months),
      price: Number(form.price || 0),
      seats_total: num(form.seats_total),
      next_renewal: form.next_renewal || null,
      notify_days_before: num(form.notify_days_before),
    };
    try {
      const saved = isEdit
        ? await api(`/purchases/subscriptions/${sub.id}`, { method: 'PATCH', body: JSON.stringify(payload) })
        : await api('/purchases/subscriptions', { method: 'POST', body: JSON.stringify(payload) });
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const activeCards = lookups.cards.filter(c => c.is_active || c.id === form.card_id);
  const activeDepts = lookups.departments.filter(d => d.is_active || d.id === form.budget_id);

  return (
    <Overlay title={isEdit ? tr('purEditSub') : tr('purNewSub')} onClose={onClose} maxWidth={760}>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={grid2}>
          <Input label={tr('purVendor')} value={form.vendor} onChange={set('vendor')} required placeholder="Adobe" />
          <Input label={tr('purProduct')} value={form.product} onChange={set('product')} placeholder="Creative Cloud — 12 seats" />
          <Select label={tr('purCategory')} value={form.category} onChange={set('category')}>
            {lookups.meta.categories.map(c => <option key={c} value={c}>{L.category(c)}</option>)}
          </Select>
          <Input label={tr('purSeller')} value={form.seller} onChange={set('seller')} placeholder={tr('purSellerHint')} />
        </div>

        <div className="t-eyebrow" style={{ marginTop: 4 }}>{tr('purWhoSection')}</div>
        <div style={grid2}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label className="t-eyebrow">{tr('purOwner')}</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {lookups.users.map(u => {
                const on = form.owner_user_ids.includes(u.id);
                return (
                  <button type="button" key={u.id} onClick={() => toggleOwner(u.id)} style={{
                    padding: '4px 10px', borderRadius: 'var(--radius-pill)', fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                    background: on ? 'var(--accent-light)' : 'var(--surface-alt)',
                    color: on ? 'var(--accent)' : 'var(--text-secondary)', fontFamily: 'inherit',
                  }}>{u.display_name || u.username}</button>
                );
              })}
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('purOwnerHint')}</span>
          </div>
          <Select label={tr('purBudget')} value={form.budget_id} onChange={set('budget_id')}>
            <option value="">—</option>
            {activeDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Input label={tr('purAccountEmail')} type="email" value={form.account_email} onChange={set('account_email')} placeholder="it@company.com" />
          <Input label={tr('purBillingUrl')} value={form.billing_url} onChange={set('billing_url')} placeholder="https://" />
          <Input label={tr('purReference')} value={form.reference} onChange={set('reference')} placeholder={tr('purReferenceHint')} />
        </div>

        <div className="t-eyebrow" style={{ marginTop: 4 }}>{tr('purMoneySection')}</div>
        <div style={grid2}>
          <Input label={tr('purPrice')} type="number" step="0.01" min="0" value={form.price} onChange={set('price')} required />
          <Select label={tr('purCurrency')} value={form.currency} onChange={set('currency')}>
            {lookups.meta.currencies.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select label={tr('purCycle')} value={form.cycle_months} onChange={set('cycle_months')}>
            {CYCLES.map(n => <option key={n} value={n}>{L.cycle(n)}</option>)}
          </Select>
          <Input label={tr('purNextRenewal')} type="date" value={form.next_renewal} onChange={set('next_renewal')} />
          <Select label={tr('purMethod')} value={form.payment_method} onChange={set('payment_method')}>
            {lookups.meta.payment_methods.map(m => <option key={m} value={m}>{L.method(m)}</option>)}
          </Select>
          {form.payment_method === 'card' && (
            <Select label={tr('purCard')} value={form.card_id} onChange={set('card_id')}>
              <option value="">—</option>
              {activeCards.map(c => <option key={c.id} value={c.id}>{L.card(c)}</option>)}
            </Select>
          )}
          <Input label={tr('purSeatsTotal')} type="number" min="0" value={form.seats_total} onChange={set('seats_total')} placeholder={tr('purSeatsTotalHint')} />
          <Input label={tr('purNotifyDays')} type="number" min="0" value={form.notify_days_before} onChange={set('notify_days_before')} placeholder={tr('purNotifyDaysHint')} />
        </div>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={form.auto_renew} onChange={set('auto_renew')} /> {tr('purAutoRenew')}
          </label>
          {isEdit && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.status === 'cancelled'}
                onChange={e => setForm(f => ({ ...f, status: e.target.checked ? 'cancelled' : 'active' }))} /> {tr('purMarkCancelled')}
            </label>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <label className="t-eyebrow">{tr('purNotes')}</label>
          <textarea rows={3} value={form.notes} onChange={set('notes')} style={textarea} />
        </div>

        {error && <div style={{ fontSize: 12, color: 'var(--danger)' }}>{error}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="button" variant="ghost" onClick={onClose}>{tr('cancel')}</Button>
          <Button type="submit" variant="primary" disabled={saving}>{saving ? tr('purSaving') : tr('save')}</Button>
        </div>
      </form>
    </Overlay>
  );
}
