import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import { Badge, Button, Input, Select } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import {
  Money, RenewalBadge, SeatsMeter, VendorPrice, bodyRow, fmtDate, headRow, tableBox, useLabels,
} from './shared';

const COLS = '2fr 1.1fr 1fr 1.1fr 1fr 0.6fr 1.1fr';

export default function SubscriptionsTab({ lookups, reloadKey, onOpen, onNew }) {
  const { lang, t: tr } = useLang();
  const L = useLabels();
  const [items, setItems] = useState([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [budget, setBudget] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(() => {
    const p = new URLSearchParams({ status });
    if (q.trim()) p.set('q', q.trim());
    if (budget) p.set('budget_id', budget);
    if (category) p.set('category', category);
    return api(`/purchases/subscriptions?${p}`).then(d => setItems(d || [])).catch(() => setItems([]));
  }, [q, status, budget, category]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load, reloadKey]);

  const totalAed = items.reduce((s, x) => s + (x.status === 'active' ? x.monthly_aed || 0 : 0), 0);
  const totalUsd = items.reduce((s, x) => s + (x.status === 'active' ? x.monthly_usd || 0 : 0), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '1 1 220px' }}>
          <Input label={tr('purSearch')} value={q} onChange={e => setQ(e.target.value)} placeholder={tr('purSearchHint')} />
        </div>
        <Select label={tr('purStatus')} value={status} onChange={e => setStatus(e.target.value)}>
          <option value="active">{tr('purActive')}</option>
          <option value="cancelled">{tr('purCancelled')}</option>
          <option value="all">{tr('purAll')}</option>
        </Select>
        <Select label={tr('purBudget')} value={budget} onChange={e => setBudget(e.target.value)}>
          <option value="">{tr('purAll')}</option>
          {lookups.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
        <Select label={tr('purCategory')} value={category} onChange={e => setCategory(e.target.value)}>
          <option value="">{tr('purAll')}</option>
          {lookups.meta.categories.map(c => <option key={c} value={c}>{L.category(c)}</option>)}
        </Select>
        <Button variant="primary" icon="plus" onClick={onNew}>{tr('purNewSub')}</Button>
      </div>

      {items.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '16px 0' }}>{tr('purNoSubs')}</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <div style={{ ...tableBox, minWidth: 820 }}>
            <div style={headRow(COLS)}>
              <span>{tr('purVendor')}</span>
              <span>{tr('purPrice')}</span>
              <span>{tr('purPerMonth')}</span>
              <span>{tr('purBudget')}</span>
              <span>{tr('purMethod')}</span>
              <span>{tr('purSeats')}</span>
              <span>{tr('purNextRenewal')}</span>
            </div>
            {items.map(s => (
              // Free rows (0.00) recede so paid ones carry the eye.
              <div key={s.id} style={{ ...bodyRow(COLS, true), opacity: s.price ? 1 : 0.55 }} onClick={() => onOpen(s.id)}>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{s.vendor}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.product || L.category(s.category)}
                  </div>
                </span>
                <span style={{ fontSize: 12 }}>
                  <VendorPrice amount={s.price} currency={s.currency} />
                  <div style={{ color: 'var(--text-muted)' }}>{L.cycle(s.cycle_months)}</div>
                </span>
                <span><Money aed={s.monthly_aed} usd={s.monthly_usd} /></span>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {s.budget?.name || '—'}
                  {s.owners.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.owners.map(o => o.display_name).join(', ')}</div>}
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {L.method(s.payment_method)}
                  {s.card && <div style={{ color: 'var(--text-muted)' }}>{L.card(s.card)}</div>}
                </span>
                <span><SeatsMeter used={s.seats_used} total={s.seats_total} /></span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
                  <RenewalBadge sub={s} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(s.next_renewal, lang)}</span>
                </span>
              </div>
            ))}
            <div style={{ ...bodyRow(COLS), background: 'var(--surface-alt)', fontWeight: 600 }}>
              <span>{tr('purTotalShown').replace('{n}', items.length)}</span>
              <span />
              <span><Money aed={totalAed} usd={totalUsd} strong /></span>
              <span /><span /><span /><span />
            </div>
          </div>
        </div>
      )}
      {items.some(s => s.monthly_aed == null) && (
        <Badge color="yellow">{tr('purUnknownFx')}</Badge>
      )}
    </div>
  );
}
