import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../../api';
import { Badge, Button } from '../../../components/UI';
import { Icon } from '../../../components/Icons';
import { useLang } from '../../../components/LangContext';
import InvoiceIntake, { Spinner } from './InvoiceIntake';
import { VendorPrice, bodyRow, fmtDate, headRow, periodCheck, planSplits, splitInvoiceFile, subLabel, tableBox } from './shared';

const COLS = 'minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 2fr) 150px';
const READERS = 2;                       // invoices read by the model at once
const ACCEPT = /\.(pdf|png|jpe?g)$/i;
const MONO = { fontFamily: 'var(--font-mono)' };

// The queue survives a reload: files and what was read from them are kept in
// this browser's IndexedDB until each invoice is saved or removed from the list.
const QUEUE_DB = 'portal-invoice-queue';
const openQueue = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(QUEUE_DB, 1);
  req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' });
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function loadQueue() {
  try {
    const db = await openQueue();
    const rows = await new Promise((resolve, reject) => {
      const req = db.transaction('items').objectStore('items').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return rows.sort((a, b) => a.n - b.n).map(r => ({
      id: r.id, state: r.state, parsed: r.parsed, error: r.error,
      file: new File([r.blob], r.name, { type: r.type }),
    }));
  } catch {
    return [];              // private window, storage blocked — the queue just lives in memory
  }
}
async function saveQueue(items) {
  // In-flight states are stored as the step to redo after a reload.
  const still = { reading: 'queued', direct: 'queued', saving: 'read' };
  try {
    const db = await openQueue();
    const store = db.transaction('items', 'readwrite').objectStore('items');
    store.clear();
    items.filter(it => it.state !== 'saved').forEach((it, n) => store.put({
      id: it.id, n, state: still[it.state] || it.state, parsed: it.parsed || null, error: it.error || null,
      blob: it.file, name: it.file.name, type: it.file.type,
    }));
    db.close();
  } catch { /* see loadQueue */ }
}

/**
 * What saving an invoice without opening it would do, and whether that is
 * safe. Only the plain case is: every line pays a known subscription, the
 * amounts split cleanly and no period looks misread. Anything else is opened
 * in the full form by a human.
 */
function judge(parsed, subs, meta) {
  const why = [];
  const supplier = parsed.supplier || parsed.supplier_raw;
  const items = parsed.items || [];
  if (parsed.logged_payment_ids?.length) return { ready: false, logged: true, why: ['bulkWhyLogged'], splits: [] };
  if (!supplier || !parsed.invoice_no || !parsed.invoice_date || parsed.total == null) why.push('bulkWhyHeader');
  if (parsed.currency && parsed.currency !== 'AED' && !meta.fx_to_aed?.[parsed.currency]) why.push('bulkWhyCurrency');
  if (items.some(i => i.is_device)) why.push('bulkWhyDevice');
  if (!items.length || items.some(i => !i.is_device && !(i.subscription_ids || []).length)) why.push('bulkWhyNoSub');
  const plan = planSplits(items.map((i, n) => ({
    key: n, quantity: i.quantity || 1, unit: i.unit_price_net ?? null,
    subIds: i.is_device ? [] : (i.subscription_ids || []),
    periodStart: i.period_start || '', periodEnd: i.period_end || '', text: i.description || '',
  })), Number(parsed.total) || 0);
  if (plan.error) why.push('bulkWhySplit');
  const rows = plan.splits.map(sp => {
    const sub = subs.find(s => s.id === sp.subscription_id);
    return { ...sp, sub, check: sub ? periodCheck(sub, sp.period_start, sp.period_end, parsed.invoice_date) : null };
  });
  if (rows.some(r => !r.sub)) why.push('bulkWhyNoSub');
  if (rows.some(r => r.check?.issues.length)) why.push('bulkWhyPeriod');
  return { ready: !why.length, why: [...new Set(why)], splits: rows };
}

export default function InvoiceBulk({ lookups, navigate, onCancel, onDone, onToast }) {
  const { t: tr, lang } = useLang();
  const [subs, setSubs] = useState(null);
  // { id, file, state, parsed, error, paymentIds, merged }
  const [items, setItems] = useState([]);
  const [cutting, setCutting] = useState(0);    // files being checked for several invoices inside
  const [reviewing, setReviewing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [over, setOver] = useState(false);
  const active = useRef(0);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const loadSubs = useCallback(() => api('/purchases/subscriptions').then(d => setSubs(d || [])).catch(() => setSubs([])), []);
  useEffect(() => { loadSubs(); }, [loadSubs]);

  const [restored, setRestored] = useState(false);
  useEffect(() => {
    loadQueue().then(rows => {
      if (!alive.current) return;
      if (rows.length) setItems(list => [...rows, ...list]);
      setRestored(true);
    });
  }, []);
  useEffect(() => { if (restored) saveQueue(items); }, [items, restored]);

  const patch = (id, p) => setItems(list => list.map(it => (it.id === id ? { ...it, ...p } : it)));

  // Read queued files, a couple at a time.
  useEffect(() => {
    const next = items.filter(it => it.state === 'queued').slice(0, Math.max(0, READERS - active.current));
    next.forEach(it => {
      active.current += 1;
      patch(it.id, { state: 'reading' });
      const fd = new FormData();
      fd.append('file', it.file);
      api('/tools/inventory/intake/parse', { method: 'POST', body: fd })
        .then(parsed => alive.current && patch(it.id, { state: 'read', parsed }))
        .catch(err => alive.current && patch(it.id, { state: 'failed', error: err.message }))
        .finally(() => { active.current -= 1; if (alive.current) setItems(l => [...l]); });
    });
  }, [items]);

  const addFiles = async (files) => {
    const good = [...files].filter(f => ACCEPT.test(f.name));
    if (good.length < files.length) onToast({ message: tr('bulkBadType'), type: 'error' });
    setCutting(n => n + 1);
    // One PDF may hold a year of invoices — each becomes its own row.
    const pieces = (await Promise.all(good.map(f => splitInvoiceFile(api, f)))).flat();
    if (!alive.current) return;
    setCutting(n => n - 1);
    const have = new Set(items.map(it => `${it.file.name}:${it.file.size}`));
    const fresh = pieces.filter(f => !have.has(`${f.name}:${f.size}`))
      .map(f => ({ id: Math.random().toString(36).slice(2), file: f, state: 'queued' }));
    // A single invoice on an empty list goes straight to the full form
    // ('direct' = the form reads it itself; queued only if the user comes back).
    if (!items.length && fresh.length === 1) {
      fresh[0].state = 'direct';
      setReviewing(fresh[0].id);
    }
    setItems(list => [...list, ...fresh]);
  };
  const backToList = () => {
    setItems(list => list.map(it => (it.state === 'direct' ? { ...it, state: 'queued' } : it)));
    setReviewing(null);
    loadSubs();
  };

  const verdicts = useMemo(() => {
    const out = {};
    const seen = new Set();
    items.forEach(it => {
      if (it.state !== 'read' || !subs) return;
      const v = judge(it.parsed, subs, lookups.meta);
      // The same invoice dropped twice (two scans, two file names).
      const key = `${(it.parsed.supplier || it.parsed.supplier_raw || '').toLowerCase()}#${(it.parsed.invoice_no || '').toLowerCase()}`;
      if (it.parsed.invoice_no && seen.has(key)) { v.ready = false; v.why = ['bulkWhyTwice']; }
      seen.add(key);
      out[it.id] = v;
    });
    return out;
  }, [items, subs, lookups.meta]);

  const ready = items.filter(it => verdicts[it.id]?.ready);
  const reading = cutting > 0 || items.some(it => it.state === 'queued' || it.state === 'reading');

  const saveReady = async () => {
    setSaving(true);
    let saved = 0;
    // Oldest first, so each one meets the payments and dates the earlier ones left.
    const queue = [...ready].sort((x, y) => String(x.parsed.invoice_date).localeCompare(String(y.parsed.invoice_date)));
    for (const it of queue) {
      const p = it.parsed, v = verdicts[it.id];
      patch(it.id, { state: 'saving' });
      const payload = {
        supplier: p.supplier || p.supplier_raw, add_supplier: false, invoice_no: p.invoice_no,
        delivery_date: p.invoice_date, items: [],
        payment: {
          paid_on: p.invoice_date, amount: Number(p.total), currency: p.currency || 'AED', amount_aed: null,
          budget_id: null, category: null, payment_method: null, card_id: null,
          description: (p.items || []).map(i => `${i.quantity || 1}× ${i.description || ''}`).join('; ').slice(0, 500) || null,
          splits: v.splits.map(({ sub, check, ...sp }) => ({ ...sp, one_time: !!check?.oneTime })),
        },
      };
      const fd = new FormData();
      fd.append('file', it.file);
      fd.append('payload', JSON.stringify(payload));
      try {
        const r = await api('/tools/inventory/intake', { method: 'POST', body: fd });
        if (r.error) throw new Error(r.error);
        patch(it.id, { state: 'saved', paymentIds: r.payment_ids || [], merged: r.confirmed_expected || 0 });
        saved += 1;
      } catch (err) {
        patch(it.id, { state: 'failed', error: err.message, parsed: it.parsed });
      }
    }
    await loadSubs();          // renewal dates moved — the remaining rows are judged against the new ones
    setSaving(false);
    if (saved) { onDone?.(); onToast({ message: tr('bulkSaved').replace('{n}', saved), type: 'success' }); }
  };

  if (reviewing) {
    const it = items.find(x => x.id === reviewing);
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><Button size="sm" variant="ghost" icon="chevronLeft" onClick={backToList}>{tr(items.length > 1 ? 'bulkBack' : 'bulkBackDrop')}</Button></div>
        <InvoiceIntake key={it.id} lookups={lookups} navigate={navigate} onToast={onToast}
          initial={{ file: it.file, parsed: it.parsed }}
          onDone={() => { patch(it.id, { state: 'saved', paymentIds: [], merged: 0 }); onDone?.(); }}
          onCancel={items.length > 1 ? backToList : onCancel} />
      </div>
    );
  }

  const statusCell = (it) => {
    const v = verdicts[it.id];
    if (it.state === 'queued') return <span style={{ color: 'var(--text-muted)' }}>{tr('bulkQueued')}</span>;
    if (it.state === 'reading' || it.state === 'saving') return <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--text-secondary)' }}><Spinner /> {tr(it.state === 'reading' ? 'inReading' : 'bulkSaving')}</span>;
    if (it.state === 'saved') return <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', color: 'var(--text-secondary)' }}><Icon name="checkCircle" size={14} /> {tr('bulkDone')}</span>;
    if (it.state === 'failed') return <Badge color="red">{tr('bulkFailed')}</Badge>;
    if (!v) return null;
    if (v.ready) return <span style={{ color: 'var(--text-secondary)' }}>{tr('bulkReady')}</span>;
    return <Badge color="yellow">{tr(v.logged ? 'bulkLogged' : 'bulkReview')}</Badge>;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{tr('bulkIntro')}</div>
      <label
        onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        style={{
          display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', padding: '22px 16px', cursor: 'pointer',
          border: `1px dashed ${over ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 'var(--radius)',
          background: over ? 'var(--accent-light)' : 'var(--surface-alt)', fontSize: 13, color: 'var(--text-secondary)',
        }}>
        <Icon name="paperclip" size={18} />
        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{tr('bulkDrop')}</span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('bulkDropHint')}</span>
        <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg" style={{ display: 'none' }}
          onChange={e => { addFiles(e.target.files); e.target.value = ''; }} />
      </label>

      {items.length === 0 && cutting > 0 ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}><Spinner /> {tr('bulkStillReading')}</div>
        : items.length === 0 ? null : (
        <>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <Button variant="primary" icon="check" disabled={!ready.length || saving || reading} onClick={saveReady}>
              {tr('bulkSaveReady').replace('{n}', ready.length)}
            </Button>
            <Button variant="ghost" onClick={onCancel}>{tr('inBackToPayments')}</Button>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {reading ? tr('bulkStillReading') : ready.length ? tr('bulkSaveHint') : ''}
            </span>
          </div>
          <div style={tableBox}>
            <div style={headRow(COLS)}>
              <span>{tr('bulkColInvoice')}</span><span>{tr('purAmount')}</span><span>{tr('bulkColWhat')}</span><span />
            </div>
            {items.map(it => {
              const p = it.parsed, v = verdicts[it.id];
              const open = it.state === 'read' && !v?.ready || (it.state === 'failed' && p);
              return (
                <div key={it.id} style={{ ...bodyRow(COLS), alignItems: 'start' }}>
                  <span style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p ? (p.supplier || p.supplier_raw || '—') : it.file.name}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.file.name}>
                      {p ? <>#{p.invoice_no || '—'} · {fmtDate(p.invoice_date, lang)}</> : null}
                    </div>
                  </span>
                  <span style={{ fontSize: 12 }}>{p?.total != null ? <VendorPrice amount={p.total} currency={p.currency || 'AED'} /> : '—'}</span>
                  <span style={{ minWidth: 0, fontSize: 12, display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {v?.splits.map((sp, i) => (
                      <div key={i} style={{ minWidth: 0 }}>
                        <span style={MONO}>{sp.amount.toFixed(2)}</span> {sp.sub ? subLabel(sp.sub) : `#${sp.subscription_id}`}
                        {sp.check?.oneTime && <span style={{ color: 'var(--text-muted)' }}> · {tr('inOneTime')}</span>}
                        {sp.check?.to && <span style={{ color: 'var(--text-muted)' }}> · {tr('inRenewalMoves').replace('{from}', fmtDate(sp.check.from, lang)).replace('{to}', fmtDate(sp.check.to, lang))}</span>}
                      </div>
                    ))}
                    {it.state === 'read' && v && !v.ready && <div style={{ color: 'var(--warning)' }}>{v.why.map(k => tr(k)).join(' ')}</div>}
                    {it.state === 'failed' && <div style={{ color: 'var(--danger)' }}>{it.error}</div>}
                    {it.state === 'saved' && it.paymentIds?.length > 0 && (
                      <div style={{ color: 'var(--text-muted)' }}>
                        {tr('inPaymentLogged')} {it.paymentIds.map(i => `#${i}`).join(', ')}
                        {it.merged > 0 && <> · {tr('inExpectedConfirmed').replace('{n}', it.merged)}</>}
                      </div>
                    )}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end', fontSize: 12 }}>
                    {statusCell(it)}
                    <span style={{ display: 'flex', gap: 2 }}>
                      {open && !v?.logged && <Button size="sm" variant="secondary" onClick={() => setReviewing(it.id)}>{tr('bulkOpen')}</Button>}
                      {it.state === 'failed' && !p && <Button size="sm" variant="ghost" icon="refresh" onClick={() => patch(it.id, { state: 'queued', error: null })} title={tr('inReadAgain')} />}
                      {!['saving', 'reading'].includes(it.state) && <Button size="sm" variant="ghost" icon="x" onClick={() => setItems(l => l.filter(x => x.id !== it.id))} title={tr('bulkRemove')} />}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
