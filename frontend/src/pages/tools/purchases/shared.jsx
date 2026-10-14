import { createContext, useContext } from 'react';
import { Badge } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';

// Which currency the viewer reads totals in (AED is what we pay; USD is the
// fixed-peg view). Stored per browser — it is a reading preference.
export const CurrencyContext = createContext({ cur: 'AED', setCur: () => {} });
export const useCur = () => useContext(CurrencyContext);

const nf = (v) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// One amount in the chosen currency, from a {aed, usd} pair.
export function Money({ aed, usd, strong, muted }) {
  const { cur } = useCur();
  const v = cur === 'USD' ? usd : aed;
  if (v == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: strong ? 700 : 500, color: muted ? 'var(--text-muted)' : 'inherit', whiteSpace: 'nowrap' }}>
      {nf(v)} <span style={{ fontSize: '0.85em', color: 'var(--text-muted)' }}>{cur}</span>
    </span>
  );
}

// The vendor's own price, e.g. "135.92 USD".
export function VendorPrice({ amount, currency }) {
  return <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>{nf(amount)} {currency}</span>;
}

export const fmtDate = (d, lang) => d
  ? new Date(`${d}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  : '—';

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function useLabels() {
  const { t: tr } = useLang();
  return {
    category: (c) => tr(`purCat_${c}`) || c,
    method: (m) => tr(`purMethod_${m}`) || m,
    cycle: (n) => ({ 1: tr('purCycle1'), 3: tr('purCycle3'), 6: tr('purCycle6'), 12: tr('purCycle12'), 24: tr('purCycle24'), 36: tr('purCycle36') }[n]
      || tr('purCycleN').replace('{n}', n)),
    card: (c) => c ? `${c.label}${c.last4 ? ` ••${c.last4}` : ''}` : '',
  };
}

export function RenewalBadge({ sub }) {
  const { t: tr } = useLang();
  if (sub.status === 'cancelled') return <Badge color="gray">{tr('purCancelled')}</Badge>;
  if (sub.lapsed) return <Badge color="red" dot>{tr('purLapsed')}</Badge>;
  const d = sub.days_to_renewal;
  if (d == null) return <Badge color="gray">—</Badge>;
  if (d < 0) return <Badge color="yellow" dot>{tr('purOverdue')}</Badge>;
  if (d === 0) return <Badge color="yellow" dot>{tr('purToday')}</Badge>;
  return <Badge color={d <= 7 ? 'yellow' : d <= 30 ? 'blue' : 'gray'}>{tr('purInDays').replace('{n}', d)}</Badge>;
}

export function SeatsMeter({ used, total }) {
  if (!total && !used) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const over = total && used > total;
  return (
    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: over ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
      {used}{total ? `/${total}` : ''}
    </span>
  );
}

export const tableBox = { display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' };
export const headRow = (cols) => ({
  display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '8px 14px', background: 'var(--surface-alt)',
  fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em',
});
export const bodyRow = (cols, clickable) => ({
  display: 'grid', gridTemplateColumns: cols, gap: 10, padding: '10px 14px', fontSize: 13,
  borderTop: '1px solid var(--border-light)', alignItems: 'center', cursor: clickable ? 'pointer' : 'default',
});
export const textarea = {
  padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: 13,
  background: 'var(--surface-alt)', color: 'var(--text)', outline: 'none', width: '100%', resize: 'vertical', fontFamily: 'inherit',
};
export const grid2 = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 };
