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
  if (sub.status === 'cancelled') return <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{tr('purCancelled')}</span>;
  if (sub.lapsed) return <Badge color="red" dot>{tr('purLapsed')}</Badge>;
  const d = sub.days_to_renewal;
  if (d == null) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  if (d < 0) return <Badge color="yellow">{tr('purOverdue')}</Badge>;
  if (d === 0) return <Badge color="yellow">{tr('purToday')}</Badge>;
  // Amber only when it is genuinely close; everything further out is plain text.
  if (d <= 3) return <Badge color="yellow">{tr('purInDays').replace('{n}', d)}</Badge>;
  return <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{tr('purInDays').replace('{n}', d)}</span>;
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

// ─── Invoice period sanity ───────────────────────────────
// The period on an invoice is read by a model and then moves the renewal
// date, so a misread date (03/02 taken as 2 March) has to be visible before
// saving. Mirrors purchases_service.advance_past / add_months.
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const toISO = (d) => d.toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((toDate(a) - toDate(b)) / 864e5);
const addDays = (s, n) => toISO(new Date(toDate(s).getTime() + n * 864e5));
export function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number);
  const idx = m - 1 + n;
  const year = y + Math.floor(idx / 12), month = ((idx % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return toISO(new Date(Date.UTC(year, month, Math.min(d, last))));
}

// Where next_renewal lands once this period is paid (null = stays).
export function renewalAfter(sub, end) {
  if (!end) return null;
  const after = addDays(end, 1);
  if (!sub.next_renewal) return after;
  if (dayDiff(sub.next_renewal, end) > -3) return null;
  let nxt = sub.next_renewal;
  for (let i = 0; i < 120 && dayDiff(nxt, end) <= -3; i++) nxt = addMonths(nxt, sub.cycle_months || 1);
  return Math.abs(dayDiff(nxt, after)) <= 3 ? nxt : after;
}

function periodIssues(sub, start, end, paidOn) {
  const cycle = sub.cycle_months || 1;
  const issues = [];
  if (start && end) {
    const expected = addDays(addMonths(start, cycle), -1);
    if (Math.abs(dayDiff(end, expected)) > Math.max(3, cycle)) issues.push('length');
  }
  if (start && paidOn) {
    const lead = dayDiff(start, paidOn);
    if (lead > 100 || lead < -45) issues.push('far');
  }
  const anchor = start || (end ? addDays(end, 1) : null);
  if (anchor && sub.next_renewal) {
    let off = Infinity;
    for (let k = -36; k <= 36; k++) off = Math.min(off, Math.abs(dayDiff(anchor, addMonths(sub.next_renewal, k * cycle))));
    if (off > 3) issues.push('grid');
  }
  return issues;
}

// 2026-03-02 → 2026-02-03 when that is a different, valid date.
const swapDayMonth = (s) => {
  if (!s) return s;
  const [y, m, d] = s.split('-');
  return Number(d) <= 12 && d !== m ? `${y}-${d}-${m}` : s;
};

// { issues: ['length'|'far'|'grid'], from, to, swap } for one subscription and
// the period typed on an invoice line. `to` = the renewal date after saving
// (null = unchanged); `swap` = the same dates with day and month exchanged,
// offered only when that reading raises no issue at all.
export function periodCheck(sub, start, end, paidOn) {
  if (!sub || (!start && !end)) return { issues: [], from: sub?.next_renewal || null, to: null, swap: null };
  const issues = periodIssues(sub, start, end, paidOn);
  let swap = null;
  if (issues.length) {
    const s = swapDayMonth(start), e = swapDayMonth(end);
    if ((s !== start || e !== end) && !(s && e && e < s) && !periodIssues(sub, s, e, paidOn).length) swap = { start: s || '', end: e || '' };
  }
  return { issues, from: sub.next_renewal || null, to: renewalAfter(sub, end || (start ? addDays(addMonths(start, sub.cycle_months || 1), -1) : null)), swap };
}

// ─── Invoice → subscription payments ─────────────────────
export const subLabel = (s) => `${s.vendor}${s.product ? ` — ${s.product}` : ''}${s.reference ? ` · ${s.reference}` : ''}`;

// Lines that pay subscriptions take their share of the invoice total (net
// prices scaled to the VAT-inclusive total), split evenly between the line's
// subscriptions. lines: [{ key, quantity, unit, subIds, periodStart, periodEnd, text }]
// — `unit` is the net unit price or null; a line with no subIds is not split.
// error = the shares cannot be worked out (a price is missing).
export function planSplits(lines, total) {
  const linked = lines.filter(l => l.subIds.length);
  if (!linked.length) return { splits: [], byLine: {}, error: false };
  const net = (l) => (l.unit == null || Number.isNaN(l.unit) ? null : l.unit * (Number(l.quantity) || 1));
  const nets = lines.map(net);
  const sum = nets.reduce((a, n) => a + (n || 0), 0);
  let share;
  if (nets.every(n => n != null) && sum > 0) share = (l) => net(l) * (total / sum);
  else if (lines.length === 1) share = () => total;
  else return { splits: [], byLine: {}, error: true };
  const byLine = {};
  // Several lines for the same subscription and period (Adobe: Creative Cloud,
  // Acrobat, Premiere on one plan) are one payment, not one per line.
  const merged = new Map();
  linked.forEach(l => {
    const each = Math.round((share(l) / l.subIds.length) * 100) / 100;
    byLine[l.key] = each;
    const text = `${Number(l.quantity) > 1 ? `${l.quantity}× ` : ''}${(l.text || '').trim()}`.trim();
    l.subIds.forEach(id => {
      const key = `${id}|${l.periodStart || ''}|${l.periodEnd || ''}`;
      const sp = merged.get(key);
      if (sp) {
        sp.amount = Math.round((sp.amount + each) * 100) / 100;
        sp.description = [sp.description, text].filter(Boolean).join('; ').slice(0, 500) || null;
      } else {
        merged.set(key, {
          subscription_id: id, amount: each,
          period_start: l.periodStart || null, period_end: l.periodEnd || null,
          description: text.slice(0, 500) || null,
        });
      }
    });
  });
  return { splits: [...merged.values()], byLine, error: false };
}

// A PDF exported as "all invoices for the year" → one File per invoice (cut on
// the server by invoice number). A single invoice comes back as [file].
export async function splitInvoiceFile(api, file) {
  if (!/\.pdf$/i.test(file.name)) return [file];
  try {
    const fd = new FormData();
    fd.append('file', file);
    const { parts } = await api('/tools/inventory/intake/split', { method: 'POST', body: fd });
    if (!parts?.length) return [file];
    return parts.map(p => {
      const bytes = Uint8Array.from(atob(p.data), c => c.charCodeAt(0));
      return new File([bytes], p.name, { type: 'application/pdf' });
    });
  } catch {
    return [file];          // the reader will say what is wrong with it
  }
}
