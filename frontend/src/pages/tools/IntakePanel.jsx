import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Badge, Button, Input, Overlay, PageHeader, Select, Toast } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useLang } from '../../components/LangContext';

// Equipment intake: invoice → NetBox devices (asset tags from NetBox's own
// numbering hook) → payment in Purchases → straight into a handover.

const todayLocal = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const box = {
  display: 'flex', flexDirection: 'column', gap: 14, padding: 18,
  border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-alt)',
};
const grid = (min = 180) => ({ display: 'grid', gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`, gap: 12 });
const field = {
  padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  fontSize: 13, background: 'var(--surface)', color: 'var(--text)', outline: 'none', width: '100%',
  fontFamily: 'inherit',
};
const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };

function SectionTitle({ n, children, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{
        width: 22, height: 22, borderRadius: '50%', background: 'var(--accent)', color: 'var(--accent-on)',
        fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      }}>{n}</span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{children}</span>
      <span style={{ flex: 1 }} />
      {right}
    </div>
  );
}

/** Search NetBox device types; or switch to describing a new one. */
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

  if (line.newType) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <label className="t-eyebrow">{tr('inNewType')}</label>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ newType: false })}>{tr('inPickExisting')}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8 }}>
          <input style={field} list="intake-manufacturers" placeholder={tr('inManufacturer')}
            value={line.manufacturer} onChange={e => onChange({ manufacturer: e.target.value })} />
          <input style={field} placeholder={tr('inModel')} value={line.model}
            onChange={e => onChange({ model: e.target.value })} />
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('inNewTypeHint')}</div>
      </div>
    );
  }

  if (line.deviceType) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label className="t-eyebrow">{tr('inDeviceType')}</label>
        <div style={{ ...field, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {line.deviceType.display || line.deviceType.name}
          </span>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => onChange({ deviceType: null })}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15 }}>×</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <label className="t-eyebrow">{tr('inDeviceType')}</label>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ newType: true, model: line.model || q })}>
          + {tr('inNewType')}
        </button>
      </div>
      <input style={field} value={q} onChange={e => setQ(e.target.value)} placeholder={tr('inSearchType')} />
      {(line.invoiceText || line.model) && !q && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {tr('inFromInvoice')}: {line.invoiceText || `${line.manufacturer} ${line.model}`}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setQ(line.model || line.invoiceText)}>{tr('inSearch')}</button>
        </div>
      )}
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
          {tr('inNoTypes')}{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange({ newType: true, model: q.trim() })}>
            + {tr('inNewType')}
          </button>
        </div>
      )}
    </div>
  );
}

function newLine(prev, look) {
  const byName = (list, name) => list.find(x => x.name.toLowerCase() === name)?.id || '';
  return {
    key: Math.random().toString(36).slice(2),
    deviceType: null, newType: false, manufacturer: '', model: '',
    roleId: prev?.roleId || byName(look.roles, 'laptop'),
    tenantId: prev?.tenantId || byName(look.tenants, 'it'),
    siteId: prev?.siteId || byName(look.sites, 'viory') || look.sites[0]?.id || '',
    quantity: 1, serials: '', price: '',
  };
}

const serialList = (text) => text.split(/[\n,;]+/).map(s => s.trim()).filter(Boolean);

export default function IntakePanel({ navigate }) {
  const { t: tr } = useLang();
  const [look, setLook] = useState(null);
  const [status, setStatus] = useState({ netbox: false, gemini: false });
  const [file, setFile] = useState(null);
  const [supplier, setSupplier] = useState('');
  const [invoiceNo, setInvoiceNo] = useState('');
  const [delivery, setDelivery] = useState(todayLocal());
  const [lines, setLines] = useState([]);
  const [withPayment, setWithPayment] = useState(true);
  const [pay, setPay] = useState({ amount: '', currency: 'AED', amount_aed: '', paid_on: todayLocal(), budget_id: '', payment_method: 'card', card_id: '' });
  const [parsing, setParsing] = useState(false);
  const [parsedNote, setParsedNote] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [toast, setToast] = useState(null);

  useEffect(() => {
    Promise.all([
      api('/tools/inventory/intake/status'),
      api('/tools/inventory/device-roles'), api('/tools/inventory/tenants'), api('/tools/inventory/sites'),
      api('/tools/inventory/manufacturers'), api('/tools/inventory/suppliers'),
      api('/purchases/meta'), api('/purchases/departments'), api('/purchases/cards'),
    ]).then(([st, roles, tenants, sites, manufacturers, suppliers, meta, departments, cards]) => {
      const l = { roles, tenants, sites, manufacturers, suppliers, meta,
        departments: departments.filter(d => d.is_active), cards: cards.filter(c => c.is_active) };
      setStatus(st);
      setLook(l);
      setLines([newLine(null, l)]);
      const it = l.departments.find(d => d.name === 'IT');
      if (it) setPay(p => ({ ...p, budget_id: it.id }));
    }).catch(err => setToast({ message: err.message, type: 'error' }));
  }, []);

  const setLine = (key, patch) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)));
  const setP = (k) => (e) => setPay(p => ({ ...p, [k]: e.target.value }));

  const knownSupplier = useMemo(
    () => !supplier.trim() || (look?.suppliers || []).some(s => s.toLowerCase() === supplier.trim().toLowerCase()),
    [supplier, look],
  );

  const parse = async () => {
    if (!file) return;
    setParsing(true);
    setParsedNote(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api('/tools/inventory/intake/parse', { method: 'POST', body: fd });
      if (r.supplier || r.supplier_raw) setSupplier(r.supplier || r.supplier_raw);
      if (r.invoice_no) setInvoiceNo(r.invoice_no);
      if (r.invoice_date) { setDelivery(r.invoice_date); setPay(p => ({ ...p, paid_on: r.invoice_date })); }
      if (r.total != null) setPay(p => ({ ...p, amount: String(r.total), currency: r.currency || p.currency }));
      if (r.items?.length) {
        let prev = null;
        setLines(r.items.map(it => {
          const l = {
            ...newLine(prev, look),
            deviceType: it.device_type || null,
            manufacturer: it.manufacturer || '', model: it.model || '', invoiceText: it.description || '',
            quantity: it.quantity || 1, serials: (it.serials || []).join('\n'),
            price: it.unit_price_net != null && (!r.currency || r.currency === 'AED') ? String(it.unit_price_net) : '',
          };
          prev = l;
          return l;
        }));
      }
      setParsedNote({
        supplierRaw: r.supplier_raw, supplierMatched: !!r.supplier,
        nonAed: r.currency && r.currency !== 'AED' ? r.currency : null,
      });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setParsing(false);
    }
  };

  const lineError = (l) => {
    if (!l.deviceType && !(l.newType && l.manufacturer.trim() && l.model.trim())) return tr('inErrType');
    if (!l.roleId || !l.tenantId || !l.siteId) return tr('inErrRefs');
    const s = serialList(l.serials);
    if (s.length > Number(l.quantity)) return tr('inErrSerials');
    return null;
  };
  const totalUnits = lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);
  const ready = look && file && supplier.trim() && invoiceNo.trim() && delivery && lines.length > 0
    && lines.every(l => !lineError(l))
    && (!withPayment || (pay.amount !== '' && pay.paid_on && (pay.currency === 'AED' || pay.amount_aed !== '' || look.meta.fx_to_aed[pay.currency])));

  const submit = async () => {
    setBusy(true);
    try {
      const payload = {
        supplier: supplier.trim(), invoice_no: invoiceNo.trim(), delivery_date: delivery,
        items: lines.map(l => ({
          device_type_id: l.deviceType && !l.newType ? l.deviceType.id : null,
          new_type: l.newType ? { manufacturer: l.manufacturer.trim(), model: l.model.trim() } : null,
          role_id: Number(l.roleId), tenant_id: Number(l.tenantId), site_id: Number(l.siteId),
          quantity: Number(l.quantity) || 1,
          serials: serialList(l.serials),
          unit_price_net: l.price === '' ? null : Number(l.price),
        })),
        payment: withPayment ? {
          paid_on: pay.paid_on, amount: Number(pay.amount), currency: pay.currency,
          amount_aed: pay.amount_aed === '' ? null : Number(pay.amount_aed),
          budget_id: pay.budget_id ? Number(pay.budget_id) : null,
          payment_method: pay.payment_method, card_id: pay.card_id ? Number(pay.card_id) : null,
        } : null,
      };
      const fd = new FormData();
      fd.append('file', file);
      fd.append('payload', JSON.stringify(payload));
      const r = await api('/tools/inventory/intake', { method: 'POST', body: fd });
      setResult(r);
      setConfirm(false);
      if (r.error) setToast({ message: r.error, type: 'error' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null); setFile(null); setSupplier(''); setInvoiceNo(''); setParsedNote(null);
    setDelivery(todayLocal()); setLines([newLine(null, look)]);
    setPay(p => ({ ...p, amount: '', amount_aed: '', currency: 'AED', paid_on: todayLocal() }));
  };

  if (!look) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        <PageHeader title={tr('inTitle')} subtitle={tr('inSubtitle')} />
      </div>
    );
  }

  if (result) {
    const tagged = result.devices.filter(d => d.asset_tag).length;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 900 }}>
        {toast && <Toast {...toast} onClose={() => setToast(null)} />}
        <PageHeader title={tr('inTitle')} subtitle={tr('inSubtitle')} />
        <div style={{ ...box, borderLeft: `3px solid ${result.error ? 'var(--danger)' : 'var(--success)'}` }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {result.error ? tr('inPartial') : tr('inDone')} — {tr('inDevicesCreated').replace('{n}', result.devices.length)}
          </div>
          {result.error && <div style={{ fontSize: 13, color: 'var(--danger)' }}>{result.error}</div>}
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
          {result.warnings.map(w => <div key={w} style={{ fontSize: 12, color: 'var(--warning)' }}>⚠ {w}</div>)}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-secondary)' }}>
            {result.invoice_url && <a href={result.invoice_url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{tr('inInvoiceInNetbox')} ↗</a>}
            {result.payment_id && <span>· {tr('inPaymentLogged')} <a href="#purchases/payments" onClick={(e) => { e.preventDefault(); navigate('purchases/payments'); }} style={{ color: 'var(--accent)' }}>#{result.payment_id}</a></span>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {result.devices.length > 0 && (
              <Button variant="primary" icon="fileText" onClick={() => navigate(`handover/devices/${result.devices.map(d => d.id).join(',')}`)}>
                {tr('inToHandover')}
              </Button>
            )}
            <Button icon="plus" onClick={reset}>{tr('inAnother')}</Button>
          </div>
          {tagged < result.devices.length && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('inTagHint')}</div>}
        </div>
      </div>
    );
  }

  const newTypes = lines.filter(l => l.newType);
  const currencies = look.meta.currencies || ['AED', 'USD'];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 900 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <PageHeader title={tr('inTitle')} subtitle={tr('inSubtitle')} />
      {!status.netbox && <Badge color="red">{tr('inNoNetbox')}</Badge>}

      <datalist id="intake-manufacturers">{look.manufacturers.map(m => <option key={m.id} value={m.name} />)}</datalist>
      <datalist id="intake-suppliers">{look.suppliers.map(s => <option key={s} value={s} />)}</datalist>

      {/* 1 — invoice */}
      <div style={box}>
        <SectionTitle n={1}>{tr('inInvoice')}</SectionTitle>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="btn btn-secondary btn-md" style={{ cursor: 'pointer' }}>
            <Icon name="paperclip" size={14} /> {file ? tr('inChangeFile') : tr('inChooseFile')}
            <input type="file" accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
              onChange={e => { setFile(e.target.files?.[0] || null); setParsedNote(null); }} />
          </label>
          {file && <span style={{ fontSize: 13, ...MONO }}>{file.name}</span>}
          <span style={{ flex: 1 }} />
          {status.gemini && (
            <Button icon="zap" onClick={parse} disabled={!file || parsing}>
              {parsing ? tr('inReading') : tr('inReadInvoice')}
            </Button>
          )}
        </div>
        {parsedNote && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span>✨ {tr('inParsedCheck')}</span>
            {parsedNote.supplierRaw && !parsedNote.supplierMatched && <span>{tr('inSupplierUnmatched').replace('{s}', parsedNote.supplierRaw)}</span>}
            {parsedNote.nonAed && <span>{tr('inNonAedPrices').replace('{c}', parsedNote.nonAed)}</span>}
          </div>
        )}
        <div style={grid(200)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label className="t-eyebrow">{tr('inSupplier')}</label>
            <input style={field} list="intake-suppliers" value={supplier} onChange={e => setSupplier(e.target.value)} />
            {!knownSupplier && <span style={{ fontSize: 11, color: 'var(--warning)' }}>{tr('inNewSupplier')}</span>}
          </div>
          <Input label={tr('inInvoiceNo')} value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} maxLength={100} />
          <Input label={tr('inDelivery')} type="date" value={delivery} onChange={e => setDelivery(e.target.value)} />
        </div>
      </div>

      {/* 2 — items */}
      <div style={box}>
        <SectionTitle n={2} right={
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setLines(ls => [...ls, newLine(ls[ls.length - 1], look)])} disabled={lines.length >= 20}>
            {tr('inAddLine')}
          </Button>
        }>{tr('inItems')} · {totalUnits}</SectionTitle>
        {lines.map((l, idx) => {
          const err = lineError(l);
          const serials = serialList(l.serials);
          return (
            <div key={l.key} style={{
              display: 'flex', flexDirection: 'column', gap: 10, padding: 12, background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}><TypePicker line={l} onChange={(patch) => setLine(l.key, patch)} /></div>
                {lines.length > 1 && (
                  <button type="button" title={tr('delete')} onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4, marginTop: 18 }}>
                    <Icon name="x" size={16} />
                  </button>
                )}
              </div>
              <div style={grid(140)}>
                <Select label={tr('inRole')} value={l.roleId} onChange={e => setLine(l.key, { roleId: e.target.value })}>
                  <option value="">—</option>
                  {look.roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
                <Select label={tr('inTenant')} value={l.tenantId} onChange={e => setLine(l.key, { tenantId: e.target.value })}>
                  <option value="">—</option>
                  {look.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
                <Select label={tr('inSite')} value={l.siteId} onChange={e => setLine(l.key, { siteId: e.target.value })}>
                  {look.sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
                <Input label={tr('inQty')} type="number" min={1} max={50} value={l.quantity}
                  onChange={e => setLine(l.key, { quantity: Math.max(1, Math.min(50, Number(e.target.value) || 1)) })} />
                <Input label={tr('inUnitPrice')} type="number" min={0} step="0.01" value={l.price}
                  onChange={e => setLine(l.key, { price: e.target.value })} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <label className="t-eyebrow">{tr('inSerials')} · {serials.length}/{l.quantity}</label>
                <textarea rows={Math.min(5, Math.max(1, Number(l.quantity)))} value={l.serials}
                  onChange={e => setLine(l.key, { serials: e.target.value })}
                  placeholder={tr('inSerialsHint')} style={{ ...field, ...MONO, resize: 'vertical' }} />
              </div>
              {err && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{idx + 1}: {err}</div>}
            </div>
          );
        })}
      </div>

      {/* 3 — payment */}
      <div style={box}>
        <SectionTitle n={3} right={
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={withPayment} onChange={e => setWithPayment(e.target.checked)} />
            {tr('inLogPayment')}
          </label>
        }>{tr('inPayment')}</SectionTitle>
        {withPayment && (
          <>
            <div style={grid(150)}>
              <Input label={tr('inTotal')} type="number" min={0} step="0.01" value={pay.amount} onChange={setP('amount')} />
              <Select label={tr('purCurrency')} value={pay.currency} onChange={setP('currency')}>
                {currencies.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
              {pay.currency !== 'AED' && (
                <Input label={tr('inAmountAed')} type="number" min={0} step="0.01" value={pay.amount_aed} onChange={setP('amount_aed')}
                  placeholder={look.meta.fx_to_aed[pay.currency] ? tr('inAutoConvert') : ''} />
              )}
              <Input label={tr('inPaidOn')} type="date" value={pay.paid_on} onChange={setP('paid_on')} />
            </div>
            <div style={grid(150)}>
              <Select label={tr('purBudget')} value={pay.budget_id} onChange={setP('budget_id')}>
                <option value="">—</option>
                {look.departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
              <Select label={tr('purMethod')} value={pay.payment_method} onChange={setP('payment_method')}>
                {look.meta.payment_methods.map(m => <option key={m} value={m}>{tr(`purMethod_${m}`)}</option>)}
              </Select>
              <Select label={tr('purCard')} value={pay.card_id} onChange={setP('card_id')}>
                <option value="">—</option>
                {look.cards.map(c => <option key={c.id} value={c.id}>{c.label}{c.last4 ? ` ••${c.last4}` : ''}</option>)}
              </Select>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{tr('inPaymentHint')}</div>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Button variant="primary" icon="check" disabled={!ready || busy || !status.netbox} onClick={() => setConfirm(true)}>
          {tr('inReview')}
        </Button>
        {!file && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('inNeedFile')}</span>}
      </div>

      {confirm && (
        <Overlay title={tr('inConfirmTitle')} onClose={() => !busy && setConfirm(false)} maxWidth={560}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
            <div>{tr('inConfirmDevices').replace('{n}', totalUnits)}</div>
            <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {lines.map(l => (
                <li key={l.key}>
                  <b>{l.quantity}×</b> {l.newType ? `${l.manufacturer} ${l.model}` : (l.deviceType.display || l.deviceType.name)}
                  <span style={{ color: 'var(--text-muted)' }}>
                    {' '}· {look.tenants.find(t => String(t.id) === String(l.tenantId))?.name}
                    {' '}· {look.roles.find(r => String(r.id) === String(l.roleId))?.name}
                    {l.price !== '' ? ` · ${l.price} AED` : ''}
                  </span>
                </li>
              ))}
            </ul>
            {newTypes.length > 0 && <div style={{ color: 'var(--warning)' }}>+ {tr('inConfirmNewTypes').replace('{n}', newTypes.length)}</div>}
            {!knownSupplier && <div style={{ color: 'var(--warning)' }}>+ {tr('inConfirmNewSupplier').replace('{s}', supplier.trim())}</div>}
            <div>{tr('inConfirmInvoice')}: <b>{invoiceNo}</b> · {supplier} · {delivery}</div>
            {withPayment && <div>{tr('inConfirmPayment')}: <b>{pay.amount} {pay.currency}</b></div>}
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('inConfirmNoUndo')}</div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button onClick={() => setConfirm(false)} disabled={busy}>{tr('cancel')}</Button>
              <Button variant="primary" icon="check" onClick={submit} disabled={busy}>{busy ? tr('inCreating') : tr('inCreate')}</Button>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
