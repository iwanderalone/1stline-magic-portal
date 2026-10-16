import { useCallback, useEffect, useState } from 'react';
import { api, apiBlob } from '../../../api';
import { Button, Input, Overlay, PageHeader, Tabs, Toast } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { CurrencyContext, todayISO } from './shared';
import OverviewTab from './OverviewTab';
import SubscriptionsTab from './SubscriptionsTab';
import SubscriptionDetail from './SubscriptionDetail';
import SubscriptionForm from './SubscriptionForm';
import PaymentsTab from './PaymentsTab';
import PeopleTab from './PeopleTab';
import SettingsTab from './SettingsTab';
import InvoiceIntake from './InvoiceIntake';

const TABS = ['overview', 'subscriptions', 'payments', 'people', 'settings'];

function ReportModal({ onClose, onToast }) {
  const { t: tr } = useLang();
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [to, setTo] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try {
      const blob = await apiBlob(`/purchases/report.xlsx?from=${from}&to=${to}`, { method: 'GET' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `it-purchases_${from}_${to}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      onToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Overlay title={tr('purReport')} onClose={onClose} maxWidth={440}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{tr('purReportHint')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Input label={tr('purFrom')} type="date" value={from} onChange={e => setFrom(e.target.value)} />
          <Input label={tr('purTo')} type="date" value={to} onChange={e => setTo(e.target.value)} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>{tr('cancel')}</Button>
          <Button variant="primary" icon="fileText" disabled={busy || !from || !to} onClick={download}>{tr('purDownload')}</Button>
        </div>
      </div>
    </Overlay>
  );
}

export default function PurchasesPage({ subPath, navigate }) {
  const { t: tr } = useLang();
  // Deep links: #purchases/<tab> or #purchases/sub/<id>.
  const [first, second] = (subPath || '').split('/');
  const [tab, setTab] = useState(TABS.includes(first) ? first : first === 'invoice' ? 'payments' : 'overview');
  const [invoiceOpen, setInvoiceOpen] = useState(first === 'invoice');
  const [openSub, setOpenSub] = useState(first === 'sub' && second ? Number(second) : null);
  const [editing, setEditing] = useState(null); // null | 'new' | subscription
  const [reportOpen, setReportOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState(null);
  const [lookups, setLookups] = useState(null);
  const [netboxEnabled, setNetboxEnabled] = useState(false);
  const [cur, setCurState] = useState(() => {
    try { return localStorage.getItem('purchasesCurrency') === 'USD' ? 'USD' : 'AED'; } catch { return 'AED'; }
  });
  const setCur = (c) => { setCurState(c); try { localStorage.setItem('purchasesCurrency', c); } catch { /* private mode */ } };

  const loadLookups = useCallback(() => Promise.all([
    api('/purchases/meta'), api('/purchases/departments'), api('/purchases/cards'), api('/users/'),
  ]).then(([meta, departments, cards, users]) => setLookups({
    meta, departments, cards,
    users: (users || []).filter(u => u.is_active !== false && ['admin', 'manager', 'engineer'].includes(u.role))
      .sort((a, b) => (a.display_name || a.username).localeCompare(b.display_name || b.username)),
  })).catch(err => setToast({ message: err.message, type: 'error' })), []);

  useEffect(() => { loadLookups(); }, [loadLookups]);
  useEffect(() => { api('/tools/status').then(d => setNetboxEnabled(!!d?.netbox)).catch(() => {}); }, []);

  const changed = useCallback(() => setReloadKey(k => k + 1), []);
  const showToast = useCallback((t) => setToast(t), []);
  const go = (t) => { setTab(t); setInvoiceOpen(false); navigate?.(t === 'overview' ? 'purchases' : `purchases/${t}`); };
  const openInvoice = () => { setInvoiceOpen(true); navigate?.('purchases/invoice'); };
  useEffect(() => { if (first === 'invoice') setInvoiceOpen(true); }, [first]);

  if (!lookups) return toast ? <Toast {...toast} onClose={() => setToast(null)} /> : null;

  return (
    <CurrencyContext.Provider value={{ cur, setCur }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      {openSub && (
        <SubscriptionDetail
          subId={openSub} reloadKey={reloadKey} netboxEnabled={netboxEnabled}
          onClose={() => setOpenSub(null)}
          onEdit={(s) => setEditing(s)}
          onChanged={changed}
          onToast={showToast}
        />
      )}
      {editing && (
        <SubscriptionForm
          sub={editing === 'new' ? null : editing}
          lookups={lookups}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            changed();
            setToast({ message: tr('purSaved'), type: 'success' });
            if (saved?.id) setOpenSub(saved.id);
          }}
        />
      )}
      {reportOpen && <ReportModal onClose={() => setReportOpen(false)} onToast={showToast} />}

      <PageHeader
        title={tr('purTitle')}
        subtitle={tr('purSubtitle')}
        actions={<>
          <Tabs tabs={[{ id: 'AED', label: 'AED' }, { id: 'USD', label: 'USD' }]} active={cur} onChange={setCur} />
          <Button variant="secondary" icon="fileText" onClick={() => setReportOpen(true)}>{tr('purReportBtn')}</Button>
          {!invoiceOpen && <Button variant="primary" icon="paperclip" onClick={openInvoice}>{tr('purAddInvoice')}</Button>}
        </>}
      >
        <Tabs tabs={TABS.map(id => ({ id, label: tr(`purTab_${id}`) }))} active={invoiceOpen ? null : tab} onChange={go} />
      </PageHeader>

      {invoiceOpen && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{tr('purInvoiceIntro')}</div>
          <InvoiceIntake lookups={lookups} navigate={navigate} onToast={showToast}
            onDone={changed} onCancel={() => go('payments')} />
        </div>
      )}

      {!invoiceOpen && tab === 'overview' && <OverviewTab reloadKey={reloadKey} netboxEnabled={netboxEnabled} onOpenSub={setOpenSub} onGo={go} />}
      {!invoiceOpen && tab === 'subscriptions' && <SubscriptionsTab lookups={lookups} reloadKey={reloadKey} onOpen={setOpenSub} onNew={() => setEditing('new')} />}
      {!invoiceOpen && tab === 'payments' && <PaymentsTab lookups={lookups} reloadKey={reloadKey} onChanged={changed} onToast={showToast} onInvoice={openInvoice} />}
      {!invoiceOpen && tab === 'people' && <PeopleTab reloadKey={reloadKey} onOpenSub={setOpenSub} onToast={showToast} />}
      {!invoiceOpen && tab === 'settings' && <SettingsTab lookups={lookups} onChanged={() => { loadLookups(); changed(); }} onToast={showToast} />}
    </CurrencyContext.Provider>
  );
}
