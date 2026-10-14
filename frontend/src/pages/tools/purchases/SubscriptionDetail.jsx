import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../../api';
import { Badge, Button, Input, Overlay } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { Money, RenewalBadge, SeatsMeter, VendorPrice, fmtDate, useLabels } from './shared';

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span className="t-eyebrow">{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', overflowWrap: 'anywhere' }}>{children || '—'}</span>
    </div>
  );
}

// Type a name → NetBox contacts; pick one or fall back to a free-text person
// (contractors who are not in NetBox).
function SeatPicker({ onPick, onCancel, netboxEnabled }) {
  const { t: tr } = useLang();
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  const [login, setLogin] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (!netboxEnabled || q.trim().length < 2) { setResults([]); return; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api(`/tools/inventory/contacts?q=${encodeURIComponent(q.trim())}&page_size=8`)
        .then(d => setResults(d?.items || [])).catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q, netboxEnabled]);

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: 12, display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--surface-alt)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Input label={tr('purSeatPerson')} value={q} onChange={e => setQ(e.target.value)} autoFocus
          placeholder={netboxEnabled ? tr('purSeatSearchHint') : tr('purSeatNameHint')} />
        <Input label={tr('purSeatLogin')} value={login} onChange={e => setLogin(e.target.value)} placeholder={tr('purSeatLoginHint')} />
      </div>
      {results.map(c => (
        <button key={c.id} type="button" onClick={() => onPick({
          netbox_contact_id: c.id, person_name: c.name, person_email: c.email || null,
          person_department: c.description || null, login: login || null,
        })} style={{
          display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', textAlign: 'left',
          padding: '7px 10px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)',
          background: 'var(--surface)', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13,
        }}>
          <span><b>{c.name}</b> <span style={{ color: 'var(--text-muted)' }}>{c.email}</span></span>
          <span style={{ display: 'flex', gap: 6 }}>
            {c.description && <Badge color="gray">{c.description}</Badge>}
            {c.offboarded && <Badge color="red">{tr('purLeaver')}</Badge>}
          </span>
        </button>
      ))}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>{tr('cancel')}</Button>
        <Button type="button" variant="secondary" size="sm" disabled={q.trim().length < 2}
          onClick={() => onPick({ person_name: q.trim(), login: login || null })}>
          {tr('purSeatAddManual')}
        </Button>
      </div>
    </div>
  );
}

export default function SubscriptionDetail({ subId, reloadKey, netboxEnabled, onClose, onEdit, onChanged, onToast }) {
  const { lang, t: tr } = useLang();
  const L = useLabels();
  const [sub, setSub] = useState(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => api(`/purchases/subscriptions/${subId}`).then(setSub)
    .catch(err => onToast({ message: err.message, type: 'error' })), [subId, onToast]);
  useEffect(() => { load(); }, [load, reloadKey]);

  const act = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      if (okMsg) onToast({ message: okMsg, type: 'success' });
      await load();
      onChanged();
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const addSeat = (seat) => act(async () => {
    await api(`/purchases/subscriptions/${subId}/seats`, { method: 'POST', body: JSON.stringify(seat) });
    setPicking(false);
  });
  const removeSeat = (seat) => {
    if (!window.confirm(tr('purSeatRemoveConfirm').replace('{name}', seat.person_name))) return;
    act(() => api(`/purchases/seats/${seat.id}`, { method: 'DELETE' }));
  };
  const renew = () => {
    if (!window.confirm(tr('purRenewConfirm').replace('{date}', fmtDate(sub.next_renewal, lang)))) return;
    act(() => api(`/purchases/subscriptions/${subId}/renew`, { method: 'POST' }), tr('purRenewed'));
  };
  const remove = async () => {
    if (!window.confirm(tr('purDeleteConfirm').replace('{name}', sub.vendor))) return;
    try {
      await api(`/purchases/subscriptions/${subId}`, { method: 'DELETE' });
      onChanged();
      onClose();
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
    }
  };

  if (!sub) return null;

  return (
    <Overlay title={`${sub.vendor}${sub.product ? ` — ${sub.product}` : ''}`} onClose={onClose} maxWidth={820}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <RenewalBadge sub={sub} />
          <Badge color="gray">{L.category(sub.category)}</Badge>
          {!sub.auto_renew && <Badge color="yellow">{tr('purNoAutoRenew')}</Badge>}
          <span style={{ flex: 1 }} />
          {sub.status === 'active' && sub.next_renewal && (
            <Button size="sm" variant="secondary" icon="check" onClick={renew} disabled={busy}>{tr('purRenewBtn')}</Button>
          )}
          <Button size="sm" variant="secondary" icon="edit" onClick={() => onEdit(sub)}>{tr('edit')}</Button>
          <Button size="sm" variant="ghost" icon="trash" onClick={remove}>{tr('delete')}</Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <Field label={tr('purPrice')}>
            <VendorPrice amount={sub.price} currency={sub.currency} /> · {L.cycle(sub.cycle_months)}
          </Field>
          <Field label={tr('purPerMonth')}><Money aed={sub.monthly_aed} usd={sub.monthly_usd} /></Field>
          <Field label={tr('purNextRenewal')}>{fmtDate(sub.next_renewal, lang)}</Field>
          <Field label={tr('purOwner')}>{sub.owners.map(o => o.display_name).join(', ') || tr('purOwnerNone')}</Field>
          <Field label={tr('purBudget')}>{sub.budget?.name}</Field>
          <Field label={tr('purAccountEmail')}>{sub.account_email}</Field>
          <Field label={tr('purMethod')}>
            {L.method(sub.payment_method)}{sub.card ? ` · ${L.card(sub.card)}` : ''}
          </Field>
          <Field label={tr('purSeller')}>{sub.seller}</Field>
          <Field label={tr('purReference')}>{sub.reference}</Field>
          {sub.billing_url && (
            <Field label={tr('purBillingUrl')}>
              <a href={sub.billing_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{tr('purOpen')} ↗</a>
            </Field>
          )}
        </div>
        {sub.notes && <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{sub.notes}</div>}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="t-h3">{tr('purSeats')}</span>
            <SeatsMeter used={sub.seats_used} total={sub.seats_total} />
            <span style={{ flex: 1 }} />
            {!picking && <Button size="sm" variant="secondary" icon="plus" onClick={() => setPicking(true)}>{tr('purSeatAdd')}</Button>}
          </div>
          {picking && <SeatPicker netboxEnabled={netboxEnabled} onPick={addSeat} onCancel={() => setPicking(false)} />}
          {sub.seats.length === 0 && !picking && (
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('purSeatsEmpty')}</div>
          )}
          {sub.seats.map(s => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, padding: '6px 0', borderTop: '1px solid var(--border-light)' }}>
              <span style={{ fontWeight: 600 }}>{s.person_name}</span>
              {s.person_department && <Badge color="gray">{s.person_department}</Badge>}
              {!s.netbox_contact_id && <Badge color="yellow">{tr('purNotInNetbox')}</Badge>}
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{s.login || s.person_email}</span>
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmtDate(s.assigned_on, lang)}</span>
              <Button size="sm" variant="ghost" icon="x" onClick={() => removeSeat(s)} title={tr('purSeatRemove')} />
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="t-h3">{tr('purPaymentHistory')}</span>
          {sub.payments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('purNoPayments')}</div>}
          {sub.payments.map(p => (
            <div key={p.id} style={{ display: 'flex', gap: 12, fontSize: 13, alignItems: 'center', padding: '5px 0', borderTop: '1px solid var(--border-light)' }}>
              <span style={{ width: 110 }}>{fmtDate(p.paid_on, lang)}</span>
              <Money aed={p.amount_aed} usd={p.amount_usd} />
              {p.currency !== 'AED' && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}><VendorPrice amount={p.amount} currency={p.currency} /></span>}
              <span style={{ flex: 1 }} />
              {p.status === 'unconfirmed' && <Badge color="yellow">{tr('purUnconfirmed')}</Badge>}
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
