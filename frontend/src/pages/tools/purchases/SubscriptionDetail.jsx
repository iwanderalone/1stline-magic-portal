import { useCallback, useEffect, useState } from 'react';
import { api, apiBlob } from '../../../api';
import { Badge, Button, Overlay } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { Money, RenewalBadge, VendorPrice, fmtDate, useLabels } from './shared';

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <span className="t-eyebrow">{label}</span>
      <span style={{ fontSize: 13, color: 'var(--text)', overflowWrap: 'anywhere' }}>{children || '—'}</span>
    </div>
  );
}

export default function SubscriptionDetail({ subId, reloadKey, onClose, onEdit, onChanged, onToast }) {
  const { lang, t: tr } = useLang();
  const L = useLabels();
  const [sub, setSub] = useState(null);
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

  const openInvoice = async (p) => {
    try {
      const blob = await apiBlob(`/purchases/payments/${p.id}/invoice`, { method: 'GET' });
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
    }
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span className="t-h3">{tr('purPaymentHistory')}</span>
          {sub.payments.length === 0 && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('purNoPayments')}</div>}
          {sub.payments.map(p => (
            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr auto', gap: 12, fontSize: 13, alignItems: 'center', padding: '6px 0', borderTop: '1px solid var(--border-light)' }}>
              <span style={{ minWidth: 0 }}>
                <div>{p.period_start ? `${fmtDate(p.period_start, lang)} – ${fmtDate(p.period_end, lang)}` : fmtDate(p.paid_on, lang)}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.invoice_no ? `#${p.invoice_no}` : tr('purNoInvoiceNo')}
                </div>
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {p.currency !== 'AED' && <VendorPrice amount={p.amount} currency={p.currency} />}
              </span>
              <Money aed={p.amount_aed} usd={p.amount_usd} />
              <span style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end', minWidth: 32 }}>
                {p.status === 'unconfirmed' && <Badge color="yellow">{tr('purUnconfirmed')}</Badge>}
                {p.has_invoice && <Button size="sm" variant="ghost" icon="paperclip" onClick={() => openInvoice(p)} title={tr('purInvoiceFile')} />}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
