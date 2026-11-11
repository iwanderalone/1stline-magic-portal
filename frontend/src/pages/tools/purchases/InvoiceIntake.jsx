import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { Badge, Button, Overlay } from '../../../components/UI';
import { Icon } from '../../../components/Icons';
import { useLang } from '../../../components/LangContext';
import { fmtDate, periodCheck, planSplits, subLabel, todayISO, useLabels } from './shared';

// "Add by invoice": one invoice in → a payment in Finances, and NetBox devices
// for the lines marked as equipment (asset tags come from NetBox's own
// numbering hook) → straight into a handover.

const CTL = {
  height: 36, boxSizing: 'border-box', padding: '0 10px', width: '100%', minWidth: 0,
  border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13,
  background: 'var(--surface)', color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
};
const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };
const section = {
  display: 'flex', flexDirection: 'column', gap: 14, padding: 18,
  border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-alt)',
};
const cols = (template) => ({ display: 'grid', gridTemplateColumns: template, gap: 10, alignItems: 'end' });

/** Label + control with fixed heights, so a long label never pushes its input down. */
function Field({ label, children, hint }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
      <label className="t-eyebrow" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '16px', height: 16 }} title={label}>{label}</label>
      {children}
      {hint}
    </div>
  );
}

const Sel = ({ label, value, onChange, children, disabled }) => (
  <Field label={label}><select style={CTL} value={value} onChange={onChange} disabled={disabled}>{children}</select></Field>
);
const Inp = ({ label, hint, ...props }) => <Field label={label} hint={hint}><input style={CTL} {...props} /></Field>;

export function Spinner() {
  return <span style={{
    width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
    display: 'inline-block', animation: 'spin 0.8s linear infinite',
  }} />;
}

/** Search NetBox device types; or switch to describing a new one. Fixed header height — no jumping. */
function TypePicker({ line, onChange }) {
  const { t: tr } = useLang();
  const [q, setQ] = useState('');
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItems([]); return; }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      api(`/tools/inventory/device-types?q=${encodeURIComponent(term)}`)
        .then(d => mine === seq.current && setItems(d || []))
        .catch(() => mine === seq.current && setItems([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  const head = (title, action) => (
    <div style={{ display: 'flex', alignItems: 'center', height: 20 }}>
      <label className="t-eyebrow">{title}</label>
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
  const link = (text, onClick) => (
    <button type="button" onClick={onClick} style={{
      background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 12,
      color: 'var(--accent)', fontFamily: 'inherit',
    }}>{text}</button>
  );

  if (line.newType) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {head(tr('inNewType'), link(tr('inPickExisting'), () => onChange({ newType: false })))}
        <div style={cols('minmax(120px, 1fr) minmax(0, 3fr)')}>
          <input style={CTL} list="intake-manufacturers" placeholder={tr('inManufacturer')}
            value={line.manufacturer} onChange={e => onChange({ manufacturer: e.target.value })} />
          <input style={CTL} placeholder={tr('inModel')} value={line.model}
            onChange={e => onChange({ model: e.target.value })} title={line.model} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('inNewTypeHint')}</div>
      </div>
    );
  }

  if (line.deviceType) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {head(tr('inDeviceType'), link(tr('inChange'), () => onChange({ deviceType: null })))}
        <div style={{ ...CTL, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="checkCircle" size={14} />
          <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={line.deviceType.display || line.deviceType.name}>
            {line.deviceType.display || line.deviceType.name}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {head(tr('inDeviceType'), link(`+ ${tr('inNewType')}`, () => onChange({ newType: true })))}
      <input style={CTL} value={q} onChange={e => setQ(e.target.value)} placeholder={tr('inSearchType')} />
      {items.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)', maxHeight: 200, overflowY: 'auto' }}>
          {items.map(t => (
            <button key={t.id} type="button" onClick={() => { onChange({ deviceType: t }); setQ(''); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent',
                borderBottom: '1px solid var(--border-light)', padding: '7px 10px', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 13, color: 'var(--text)',
              }}>{t.display || t.name}</button>
          ))}
        </div>
      )}
      {q.trim().length >= 2 && items.length === 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {tr('inNoTypes')} {link(`+ ${tr('inNewType')}`, () => onChange({ newType: true, model: line.model || q.trim() }))}
        </div>
      )}
    </div>
  );
}

const serialList = (text) => text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);
// Same idea as the server's vendor match, only to order the picker: ours first.
const vendorWords = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sameVendor = (supplier, s) => {
  const a = vendorWords(supplier);
  return !!a && [s.vendor, s.seller].some(v => {
    const b = vendorWords(v);
    return b && (`${a} `.startsWith(`${b} `) || `${b} `.startsWith(`${a} `));
  });
};

// `initial` = { file, parsed } handed over by the bulk queue: the form opens
// already filled, without reading the file a second time.
export default function InvoiceIntake({ lookups, navigate, onCancel, onDone, onToast, initial }) {
  const { t: tr, lang } = useLang();
  const L = useLabels();
  const [nb, setNb] = useState(null);           // NetBox lookups
  const [status, setStatus] = useState({ netbox: false, ai: false });
  const [subs, setSubs] = useState([]);         // active subscriptions a line can pay for
  const [file, setFile] = useState(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null);   // what the AI said, for notes
  const [supplier, setSupplier] = useState('');
  const [addSupplier, setAddSupplier] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [delivery, setDelivery] = useState(todayISO());
  const [lines, setLines] = useState([]);
  const itDept = lookups.departments.find(d => d.name === 'IT' && d.is_active);
  const [pay, setPay] = useState({
    amount: '', currency: 'AED', amount_aed: '', paid_on: todayISO(),
    budget_id: itDept?.id || '', payment_method: 'card', card_id: '', category: '',
  });
  const [confirm, setConfirm] = useState(false);
  const [datesOk, setDatesOk] = useState(false);   // ticked in the confirm dialog when a period looks off
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    api('/tools/inventory/intake/status').then(st => {
      setStatus(st);
      if (!st.netbox) { setNb({ roles: [], tenants: [], sites: [], manufacturers: [], suppliers: [] }); return; }
      return Promise.all([
        api('/tools/inventory/device-roles'), api('/tools/inventory/tenants'), api('/tools/inventory/sites'),
        api('/tools/inventory/manufacturers'), api('/tools/inventory/suppliers'),
      ]).then(([roles, tenants, sites, manufacturers, suppliers]) => setNb({ roles, tenants, sites, manufacturers, suppliers }));
    }).catch(err => onToast({ message: err.message, type: 'error' }));
    api('/purchases/subscriptions').then(d => setSubs(d || [])).catch(() => {});
  }, [onToast]);

  const defaults = (prev) => {
    const byName = (list, name) => list.find(x => x.name.toLowerCase() === name)?.id || '';
    return {
      roleId: prev?.roleId || byName(nb.roles, 'laptop'),
      tenantId: prev?.tenantId || byName(nb.tenants, 'it'),
      siteId: prev?.siteId || byName(nb.sites, 'viory') || nb.sites[0]?.id || '',
    };
  };
  const blankLine = (prev, over = {}) => ({
    key: Math.random().toString(36).slice(2),
    text: '', toNetbox: status.netbox, quantity: 1, price: '',
    deviceType: null, newType: false, manufacturer: '', model: '', serials: '',
    net: null, subIds: [], periodStart: '', periodEnd: '',
    ...defaults(prev), ...over,
  });

  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const setP = (k) => (e) => setPay(p => ({ ...p, [k]: e.target.value }));

  const netboxLines = lines.filter(l => l.toNetbox);
  const supplierInNetbox = useMemo(() => {
    const s = supplier.trim().toLowerCase();
    return !!s && (nb?.suppliers || []).find(x => x.toLowerCase() === s);
  }, [supplier, nb]);
  const supplierNeedsDecision = netboxLines.length > 0 && supplier.trim() && !supplierInNetbox && !addSupplier;

  // AI reads the invoice as soon as it is attached.
  const pickFile = async (f) => {
    setFile(f);
    setParsed(null);
    if (!f || !status.ai) return;
    setParsing(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      applyParsed(await api('/tools/inventory/intake/parse', { method: 'POST', body: fd }));
    } catch (err) {
      onToast({ message: `${tr('inReadFailed')}: ${err.message}`, type: 'error' });
    } finally {
      setParsing(false);
    }
  };

  const applyParsed = (r) => {
    {
      setParsed(r);
      setSupplier(r.supplier || r.supplier_raw || '');
      setAddSupplier(false);
      if (r.invoice_no) setInvoiceNo(r.invoice_no);
      if (r.invoice_date) setDelivery(r.invoice_date);
      setPay(p => ({
        ...p,
        amount: r.total != null ? String(r.total) : p.amount,
        currency: r.currency && lookups.meta.currencies.includes(r.currency) ? r.currency : p.currency,
        paid_on: r.invoice_date || p.paid_on,
        category: r.items?.some(i => i.is_device) ? '' : 'software',
      }));
      if (r.items?.length) {
        let prev = null;
        setLines(r.items.map(it => {
          const l = blankLine(prev, {
            text: it.description || [it.manufacturer, it.model].filter(Boolean).join(' '),
            toNetbox: status.netbox && it.is_device,
            quantity: it.quantity || 1,
            // NetBox keeps AED excl. VAT; a foreign-currency price is not copied.
            price: it.unit_price_net != null && (!r.currency || r.currency === 'AED') ? String(it.unit_price_net) : '',
            deviceType: it.device_type || null,
            newType: !it.device_type && !!it.model,
            manufacturer: it.manufacturer || '', model: it.model || '',
            serials: (it.serials || []).join('\n'),
            // Unit price in the invoice's own currency — what the split is computed from.
            net: it.unit_price_net ?? null,
            subIds: it.is_device ? [] : (it.subscription_ids || []),
            periodStart: it.period_start || '', periodEnd: it.period_end || '',
          });
          prev = l;
          return l;
        }));
      }
    }
  };

  useEffect(() => {
    if (!nb || lines.length) return;
    setLines([blankLine(null)]);
    if (initial?.file) {
      if (initial.parsed) { setFile(initial.file); applyParsed(initial.parsed); } else pickFile(initial.file);
    }
  }, [nb]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineError = (l) => {
    if (!l.toNetbox) return null;
    if (!l.deviceType && !(l.newType && l.manufacturer.trim() && l.model.trim())) return tr('inErrType');
    if (!l.roleId || !l.tenantId || !l.siteId) return tr('inErrRefs');
    if (serialList(l.serials).length > Number(l.quantity)) return tr('inErrSerials');
    return null;
  };
  const units = netboxLines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);

  // Lines that pay subscriptions take their share of the invoice total (net
  // prices scaled to the VAT-inclusive total); the rest stays one plain payment.
  const splitPlan = useMemo(() => {
    const plan = planSplits(lines.map(l => ({
      key: l.key, quantity: l.quantity, unit: l.price !== '' ? Number(l.price) : l.net,
      subIds: l.toNetbox ? [] : l.subIds, periodStart: l.periodStart, periodEnd: l.periodEnd, text: l.text,
    })), Number(pay.amount) || 0);
    return { ...plan, error: plan.error ? tr('inErrSplit') : null };
  }, [lines, pay.amount, tr]);
  const periodDoubt = splitPlan.splits.some(sp => {
    const s = subs.find(x => x.id === sp.subscription_id);
    return s && periodCheck(s, sp.period_start, sp.period_end, pay.paid_on).issues.length > 0;
  });
  const periodError = lines.some(l => l.periodStart && l.periodEnd && l.periodEnd < l.periodStart);
  const alreadyLogged = parsed?.logged_payment_ids?.length > 0 && invoiceNo.trim() === (parsed.invoice_no || '');

  const ready = nb && file && !parsing && supplier.trim() && invoiceNo.trim() && delivery
    && lines.every(l => !lineError(l)) && !supplierNeedsDecision
    && !splitPlan.error && !periodError && !alreadyLogged
    && pay.amount !== '' && pay.paid_on
    && (pay.currency === 'AED' || pay.amount_aed !== '' || lookups.meta.fx_to_aed[pay.currency]);

  const submit = async () => {
    setBusy(true);
    try {
      const description = lines.filter(l => l.text.trim())
        .map(l => `${l.quantity}× ${l.text.trim()}`).join('; ').slice(0, 500) || null;
      const payload = {
        supplier: supplier.trim(), add_supplier: addSupplier, invoice_no: invoiceNo.trim(), delivery_date: delivery,
        items: netboxLines.map(l => ({
          device_type_id: l.deviceType && !l.newType ? l.deviceType.id : null,
          new_type: l.newType ? { manufacturer: l.manufacturer.trim(), model: l.model.trim() } : null,
          role_id: Number(l.roleId), tenant_id: Number(l.tenantId), site_id: Number(l.siteId),
          quantity: Number(l.quantity) || 1,
          serials: serialList(l.serials),
          unit_price_net: l.price === '' ? null : Number(l.price),
        })),
        payment: {
          paid_on: pay.paid_on, amount: Number(pay.amount), currency: pay.currency,
          amount_aed: pay.amount_aed === '' ? null : Number(pay.amount_aed),
          budget_id: pay.budget_id ? Number(pay.budget_id) : null,
          category: pay.category || null,
          payment_method: pay.payment_method,
          card_id: pay.payment_method === 'card' && pay.card_id ? Number(pay.card_id) : null,
          description,
          splits: splitPlan.splits,
        },
      };
      const fd = new FormData();
      fd.append('file', file);
      fd.append('payload', JSON.stringify(payload));
      const r = await api('/tools/inventory/intake', { method: 'POST', body: fd });
      setResult(r);
      setConfirm(false);
      onDone?.();
      if (r.error) onToast({ message: r.error, type: 'error' });
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  if (!nb) return <div style={{ padding: 20, display: 'flex', gap: 8, alignItems: 'center', color: 'var(--text-muted)' }}><Spinner /></div>;

  // ── Result ──────────────────────────────────────────────
  if (result) {
    const tagged = result.devices.filter(d => d.asset_tag).length;
    return (
      <div style={{ ...section, borderLeft: `3px solid ${result.error ? 'var(--danger)' : 'var(--success)'}`, maxWidth: 900 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          {result.error ? tr('inPartial') : tr('inDone')}
          {result.payment_id && <> · {tr('inPaymentLogged')} {(result.payment_ids?.length ? result.payment_ids : [result.payment_id]).map(i => `#${i}`).join(', ')}</>}
          {result.confirmed_expected > 0 && <> · {tr('inExpectedConfirmed').replace('{n}', result.confirmed_expected)}</>}
          {result.devices.length > 0 && <> · {tr('inDevicesCreated').replace('{n}', result.devices.length)}</>}
        </div>
        {result.error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{result.error}</div>}
        {result.devices.length > 0 && (
          <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface)' }}>
            {result.devices.map((d, i) => (
              <div key={d.id} style={{
                display: 'grid', gridTemplateColumns: '90px minmax(0,1fr) auto', gap: 12, alignItems: 'center',
                padding: '9px 12px', borderTop: i ? '1px solid var(--border-light)' : 'none',
              }}>
                <span style={{ ...MONO, fontSize: 15, fontWeight: 700 }}>
                  {d.asset_tag || <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text-muted)' }}>{tr('inTagPending')}</span>}
                </span>
                <span style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.label}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', ...MONO }}>
                    {d.serial ? `S/N ${d.serial}` : tr('inNoSerial')}{d.reused ? ` · ${tr('inReused')}` : ''}
                  </div>
                </span>
                {d.url && <a href={d.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'none' }}>NetBox ↗</a>}
              </div>
            ))}
          </div>
        )}
        {result.warnings.map(w => <div key={w} style={{ display: 'flex', gap: 6, fontSize: 12, color: 'var(--warning)' }}><Icon name="alertTriangle" size={13} style={{ marginTop: 2 }} /> {w}</div>)}
        {tagged < result.devices.length && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('inTagHint')}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {result.devices.length > 0 && (
            <Button variant="primary" icon="fileText" onClick={() => navigate(`inventory/handover/devices/${result.devices.map(d => d.id).join(',')}`)}>
              {tr('inToHandover')}
            </Button>
          )}
          <Button onClick={onCancel}>{tr('inBackToPayments')}</Button>
        </div>
      </div>
    );
  }

  // ── Form ────────────────────────────────────────────────
  const currencies = lookups.meta.currencies || ['AED', 'USD'];
  const newTypes = netboxLines.filter(l => l.newType).length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
      <datalist id="intake-manufacturers">{nb.manufacturers.map(m => <option key={m.id} value={m.name} />)}</datalist>
      <datalist id="intake-suppliers">{nb.suppliers.map(s => <option key={s} value={s} />)}</datalist>

      {/* Invoice + payment */}
      <div style={section}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-secondary btn-md" style={{ cursor: 'pointer' }}>
            <Icon name="paperclip" size={14} /> {file ? tr('inChangeFile') : tr('inChooseFile')}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
              onChange={e => { pickFile(e.target.files?.[0] || null); e.target.value = ''; }} />
          </label>
          {file && <span style={{ fontSize: 13, ...MONO, overflow: 'hidden', textOverflow: 'ellipsis' }}>{file.name}</span>}
          <span style={{ flex: 1 }} />
          {parsing && <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}><Spinner /> {tr('inReading')}</span>}
          {!parsing && parsed && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}><Icon name="sparkles" size={13} /> {tr('inParsedCheck')}</span>}
          {!parsing && file && status.ai && !parsed && (
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => pickFile(file)}>{tr('inReadAgain')}</Button>
          )}
        </div>
        {!status.ai && <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('inNoAi')}</div>}
        {alreadyLogged && (
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', padding: '10px 12px', fontSize: 13,
            border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', background: 'var(--warning-light)',
          }}>
            <Icon name="alertTriangle" size={14} />
            {tr('inAlreadyLogged').replace('{no}', invoiceNo.trim()).replace('{ids}', parsed.logged_payment_ids.map(i => `#${i}`).join(', '))}
          </div>
        )}

        <div style={{ opacity: parsing ? 0.5 : 1, pointerEvents: parsing ? 'none' : 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={cols('minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)')}>
            <Inp label={tr('inSupplier')} list="intake-suppliers" value={supplier}
              onChange={e => { setSupplier(e.target.value); setAddSupplier(false); }} />
            <Inp label={tr('inInvoiceNo')} value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} maxLength={100} />
            <Inp label={tr('inDelivery')} type="date" value={delivery} onChange={e => setDelivery(e.target.value)} />
          </div>

          {netboxLines.length > 0 && supplier.trim() && (
            supplierInNetbox ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}><Icon name="check" size={12} color="var(--success)" /> {tr('inSupplierKnown')}</div>
            ) : addSupplier ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                <Icon name="check" size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />{tr('inSupplierWillAdd').replace('{s}', supplier.trim())}{' '}
                <button type="button" onClick={() => setAddSupplier(false)} style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12, padding: 0 }}>{tr('cancel')}</button>
              </div>
            ) : (
              <div style={{
                display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '10px 12px',
                border: '1px solid var(--warning)', borderRadius: 'var(--radius-sm)', background: 'var(--warning-light)', fontSize: 13,
              }}>
                <span style={{ flex: '1 1 260px' }}>{tr('inSupplierMissing').replace('{s}', supplier.trim())}</span>
                <Button size="sm" variant="primary" onClick={() => setAddSupplier(true)}>{tr('inSupplierAdd')}</Button>
                <select style={{ ...CTL, width: 220 }} value="" onChange={e => e.target.value && setSupplier(e.target.value)}>
                  <option value="">{tr('inSupplierPick')}</option>
                  {nb.suppliers.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )
          )}

          <div style={cols('repeat(auto-fit, minmax(150px, 1fr))')}>
            <Inp label={tr('inTotal')} type="number" min={0} step="0.01" value={pay.amount} onChange={setP('amount')} />
            <Sel label={tr('purCurrency')} value={pay.currency} onChange={setP('currency')}>
              {currencies.map(c => <option key={c} value={c}>{c}</option>)}
            </Sel>
            {pay.currency !== 'AED' && (
              <Inp label={tr('inAmountAed')} type="number" min={0} step="0.01" value={pay.amount_aed} onChange={setP('amount_aed')}
                placeholder={lookups.meta.fx_to_aed[pay.currency] ? tr('inAutoConvert') : ''} />
            )}
            <Inp label={tr('inPaidOn')} type="date" value={pay.paid_on} onChange={setP('paid_on')} />
          </div>
          <div style={cols('repeat(auto-fit, minmax(150px, 1fr))')}>
            <Sel label={tr('purBudget')} value={pay.budget_id} onChange={setP('budget_id')}>
              <option value="">—</option>
              {lookups.departments.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Sel>
            <Sel label={tr('purCategory')} value={pay.category} onChange={setP('category')}>
              <option value="">{netboxLines.length ? L.category('hardware') : L.category('other')} ({tr('inAuto')})</option>
              {lookups.meta.categories.map(c => <option key={c} value={c}>{L.category(c)}</option>)}
            </Sel>
            <Sel label={tr('purMethod')} value={pay.payment_method} onChange={setP('payment_method')}>
              {lookups.meta.payment_methods.map(m => <option key={m} value={m}>{L.method(m)}</option>)}
            </Sel>
            {pay.payment_method === 'card' && (
              <Sel label={tr('purCard')} value={pay.card_id} onChange={setP('card_id')}>
                <option value="">—</option>
                {lookups.cards.filter(c => c.is_active).map(c => <option key={c.id} value={c.id}>{L.card(c)}</option>)}
              </Sel>
            )}
          </div>
        </div>
      </div>

      {/* Lines */}
      <div style={{ ...section, opacity: parsing ? 0.5 : 1, pointerEvents: parsing ? 'none' : 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{tr('inItems')}</span>
          {status.netbox && <Badge color="blue">{tr('inUnitsToNetbox').replace('{n}', units)}</Badge>}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" icon="plus" disabled={lines.length >= 20}
            onClick={() => setLines(ls => [...ls, blankLine(ls[ls.length - 1])])}>{tr('inAddLine')}</Button>
        </div>
        {lines.map((l, idx) => {
          const err = lineError(l);
          const serials = serialList(l.serials);
          return (
            <div key={l.key} style={{
              display: 'flex', flexDirection: 'column', gap: 12, padding: 12, background: 'var(--surface)',
              border: `1px solid ${l.toNetbox ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius-sm)',
            }}>
              <div style={cols('minmax(0, 1fr) 80px 150px auto')}>
                <Inp label={`${idx + 1}. ${tr('inLine')}`} value={l.text} onChange={e => setLine(l.key, { text: e.target.value })} title={l.text} />
                <Inp label={tr('inQty')} type="number" min={1} max={50} value={l.quantity}
                  onChange={e => setLine(l.key, { quantity: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
                <Inp label={tr('inUnitPrice')} type="number" min={0} step="0.01" value={l.price}
                  onChange={e => setLine(l.key, { price: e.target.value })} />
                <button type="button" title={tr('delete')} disabled={lines.length <= 1}
                  onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
                  style={{ height: 36, background: 'none', border: 'none', cursor: lines.length <= 1 ? 'default' : 'pointer', color: 'var(--danger)', opacity: lines.length <= 1 ? 0.3 : 1 }}>
                  <Icon name="x" size={16} />
                </button>
              </div>

              {status.netbox && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', width: 'fit-content' }}>
                  <input type="checkbox" checked={l.toNetbox} onChange={e => setLine(l.key, { toNetbox: e.target.checked })} />
                  <span style={{ fontWeight: 600 }}>{tr('inToNetbox')}</span>
                  {!l.toNetbox && <span style={{ color: 'var(--text-muted)' }}>{tr('inPaymentOnly')}</span>}
                </label>
              )}

              {!l.toNetbox && subs.length > 0 && (() => {
                const chosen = l.subIds.map(id => subs.find(s => s.id === id)).filter(Boolean);
                const free = subs.filter(s => !l.subIds.includes(s.id));
                const ours = free.filter(s => sameVendor(supplier, s));
                const rest = free.filter(s => !ours.includes(s));
                const opt = (s) => <option key={s.id} value={s.id}>{subLabel(s)}</option>;
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {chosen.map(s => (
                      <div key={s.id} style={{ ...CTL, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Icon name="checkCircle" size={14} />
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={subLabel(s)}>{subLabel(s)}</span>
                        {splitPlan.byLine[l.key] != null && <span style={{ ...MONO, fontSize: 12, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{splitPlan.byLine[l.key].toFixed(2)} {pay.currency}</span>}
                        <button type="button" title={tr('delete')} onClick={() => setLine(l.key, { subIds: l.subIds.filter(x => x !== s.id) })}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}>
                          <Icon name="x" size={14} />
                        </button>
                      </div>
                    ))}
                    <div style={cols('minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)')}>
                      <Sel label={tr('inSubscription')} value=""
                        onChange={e => e.target.value && setLine(l.key, { subIds: [...l.subIds, Number(e.target.value)] })}>
                        <option value="">{chosen.length ? tr('inAddSubscription') : tr('inNoSubscription')}</option>
                        {ours.length > 0 && <optgroup label={supplier.trim()}>{ours.map(opt)}</optgroup>}
                        {rest.length > 0 && <optgroup label={tr('inOtherSubs')}>{rest.map(opt)}</optgroup>}
                      </Sel>
                      {chosen.length > 0 && <>
                        <Inp label={tr('inPeriodFrom')} type="date" value={l.periodStart} onChange={e => setLine(l.key, { periodStart: e.target.value })} />
                        <Inp label={tr('inPeriodTo')} type="date" value={l.periodEnd} onChange={e => setLine(l.key, { periodEnd: e.target.value })} />
                      </>}
                    </div>
                    {chosen.map(s => {
                      const c = periodCheck(s, l.periodStart, l.periodEnd, pay.paid_on);
                      if (!c.issues.length && !c.to) return null;
                      return (
                        <div key={`chk${s.id}`} style={{ fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: c.issues.length ? 'var(--warning)' : 'var(--text-muted)' }}>
                          {c.issues.length > 0 && <Icon name="alertTriangle" size={14} />}
                          <span>
                            {chosen.length > 1 && <b>{s.reference || s.product || s.vendor}: </b>}
                            {c.issues.map(i => tr(`inPeriod_${i}`)).join(' ')}
                            {c.issues.length > 0 && ' '}
                            {c.to ? tr('inRenewalMoves').replace('{from}', fmtDate(c.from, lang)).replace('{to}', fmtDate(c.to, lang)) : tr('inRenewalStays').replace('{from}', fmtDate(c.from, lang))}
                          </span>
                          {c.swap && (
                            <Button size="sm" variant="ghost" onClick={() => setLine(l.key, { periodStart: c.swap.start, periodEnd: c.swap.end })}>
                              {tr('inPeriodSwap').replace('{from}', fmtDate(c.swap.start, lang))}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                    {chosen.length > 0 && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('inSubscriptionHint')}</div>}
                  </div>
                );
              })()}

              {l.toNetbox && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingLeft: 12, borderLeft: '2px solid var(--border)' }}>
                  <TypePicker line={l} onChange={(patch) => setLine(l.key, patch)} />
                  <div style={cols('repeat(3, minmax(0, 1fr))')}>
                    <Sel label={tr('inRole')} value={l.roleId} onChange={e => setLine(l.key, { roleId: e.target.value })}>
                      <option value="">—</option>
                      {nb.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </Sel>
                    <Sel label={tr('inTenant')} value={l.tenantId} onChange={e => setLine(l.key, { tenantId: e.target.value })}>
                      <option value="">—</option>
                      {nb.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </Sel>
                    <Sel label={tr('inSite')} value={l.siteId} onChange={e => setLine(l.key, { siteId: e.target.value })}>
                      {nb.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Sel>
                  </div>
                  <Field label={`${tr('inSerials')} · ${serials.length}/${l.quantity}`}
                    hint={parsed && serials.length === 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('inNoSerialOnInvoice')}</span>}>
                    <textarea rows={Math.min(5, Math.max(1, Number(l.quantity)))} value={l.serials}
                      onChange={e => setLine(l.key, { serials: e.target.value })}
                      placeholder={tr('inSerialsHint')}
                      style={{ ...CTL, height: 'auto', minHeight: 36, padding: '8px 10px', ...MONO, resize: 'vertical' }} />
                  </Field>
                  {err && <div style={{ fontSize: 11, color: 'var(--warning)' }}>{err}</div>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button variant="primary" icon="check" disabled={!ready || busy} onClick={() => { setDatesOk(false); setConfirm(true); }}>
          {units ? tr('inSubmitDevices').replace('{n}', units) : tr('inSubmitPayment')}
        </Button>
        <Button variant="ghost" onClick={onCancel}>{tr('cancel')}</Button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {!file ? tr('inNeedFile') : supplierNeedsDecision ? tr('inNeedSupplier') : splitPlan.error || (periodError ? tr('inErrPeriod') : '')}
        </span>
      </div>

      {confirm && (
        <Overlay title={units ? tr('inConfirmTitle') : tr('inConfirmPaymentTitle')} onClose={() => !busy && setConfirm(false)} maxWidth={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div>{tr('inConfirmPayment')}: <b>{pay.amount} {pay.currency}</b> · {supplier} · #{invoiceNo}</div>
            {splitPlan.splits.length > 0 && (
              <>
                <div>{tr('inConfirmSubs')}</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {splitPlan.splits.map((sp, i) => {
                    const s = subs.find(x => x.id === sp.subscription_id);
                    return (
                      <li key={i}>
                        <b style={MONO}>{sp.amount.toFixed(2)} {pay.currency}</b> {s ? subLabel(s) : `#${sp.subscription_id}`}
                        {sp.period_start && <span style={{ color: 'var(--text-muted)' }}> · {fmtDate(sp.period_start, lang)}{sp.period_end ? ` – ${fmtDate(sp.period_end, lang)}` : ''}</span>}
                        {(() => {
                          const c = s && periodCheck(s, sp.period_start, sp.period_end, pay.paid_on);
                          if (!c || (!c.issues.length && !c.to)) return null;
                          return (
                            <div style={{ fontSize: 12, color: c.issues.length ? 'var(--warning)' : 'var(--text-muted)' }}>
                              {c.issues.map(i => tr(`inPeriod_${i}`)).join(' ')}{c.issues.length > 0 && ' '}
                              {c.to ? tr('inRenewalMoves').replace('{from}', fmtDate(c.from, lang)).replace('{to}', fmtDate(c.to, lang)) : tr('inRenewalStays').replace('{from}', fmtDate(c.from, lang))}
                            </div>
                          );
                        })()}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {units > 0 && (
              <>
                <div>{tr('inConfirmDevices').replace('{n}', units)}</div>
                <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {netboxLines.map(l => (
                    <li key={l.key}>
                      <b>{l.quantity}×</b> {l.newType ? `${l.manufacturer} ${l.model}` : (l.deviceType.display || l.deviceType.name)}
                      <span style={{ color: 'var(--text-muted)' }}>
                        {' '}· {nb.tenants.find(t => String(t.id) === String(l.tenantId))?.name}
                        {' '}· {nb.roles.find(r => String(r.id) === String(l.roleId))?.name}
                        {' '}· {serialList(l.serials).length ? serialList(l.serials).join(', ') : tr('inNoSerial')}
                      </span>
                    </li>
                  ))}
                </ul>
                {newTypes > 0 && <div style={{ color: 'var(--warning)' }}>+ {tr('inConfirmNewTypes').replace('{n}', newTypes)}</div>}
                {addSupplier && <div style={{ color: 'var(--warning)' }}>+ {tr('inConfirmNewSupplier').replace('{s}', supplier.trim())}</div>}
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('inConfirmNoUndo')}</div>
              </>
            )}
            {periodDoubt && (
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <input type="checkbox" checked={datesOk} onChange={e => setDatesOk(e.target.checked)} />
                <span>{tr('inDatesChecked')}</span>
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button onClick={() => setConfirm(false)} disabled={busy}>{tr('cancel')}</Button>
              <Button variant="primary" icon="check" onClick={submit} disabled={busy || (periodDoubt && !datesOk)}>{busy ? tr('inCreating') : tr('inCreate')}</Button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
