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
  if (anchor && sub.next_renewal && gridOff(sub, anchor) > 3) issues.push('grid');
  return issues;
}

// 2026-03-02 → 2026-02-03 when that is a different, valid date.
const swapDayMonth = (s) => {
  if (!s) return s;
  const [y, m, d] = s.split('-');
  return Number(d) <= 12 && d !== m ? `${y}-${d}-${m}` : s;
};

// Days between a date and the nearest renewal date of the subscription.
function gridOff(sub, d) {
  if (!d || !sub.next_renewal) return Infinity;
  const cycle = sub.cycle_months || 1;
  let off = Infinity;
  for (let k = -36; k <= 36; k++) off = Math.min(off, Math.abs(dayDiff(d, addMonths(sub.next_renewal, k * cycle))));
  return off;
}

// A pro-rated charge: seats added mid-cycle are billed from that day to the
// end of the running cycle (16–22 Apr on a plan renewing on the 23rd).
function looksProRated(sub, start, end) {
  if (!start || !end || !sub.next_renewal) return false;
  const full = dayDiff(addMonths(start, sub.cycle_months || 1), start);
  return dayDiff(end, start) + 1 < full - 3 && gridOff(sub, addDays(end, 1)) <= 3 && gridOff(sub, start) > 3;
}

// { issues: ['length'|'far'|'grid'], from, to, swap, oneTime } for one
// subscription and the period typed on an invoice line. `to` = the renewal
// date after saving (null = unchanged); `swap` = the same dates with day and
// month exchanged, offered only when that reading raises no issue at all.
// `oneTime` = a one-off charge on top of the subscription (top-up, upgrade,
// pro-rated seats): it settles no period and moves nothing, so nothing is
// checked. Pass true/false when a human decided, null to detect pro-rating.
export function periodCheck(sub, start, end, paidOn, oneTime = null) {
  const idle = { issues: [], from: sub?.next_renewal || null, to: null, swap: null, oneTime: false };
  if (!sub) return idle;
  // Detected only when the dates cannot be a day/month mix-up of a full cycle.
  const flipped = [swapDayMonth(start), swapDayMonth(end)];
  const mixUp = (flipped[0] !== start || flipped[1] !== end) && !(flipped[0] && flipped[1] && flipped[1] < flipped[0])
    && !looksProRated(sub, ...flipped) && !periodIssues(sub, ...flipped, paidOn).length;
  if (oneTime ?? (looksProRated(sub, start, end) && !mixUp)) return { ...idle, oneTime: true };
  if (!start && !end) return idle;
  const issues = periodIssues(sub, start, end, paidOn);
  let swap = null;
  if (issues.length) {
    const s = swapDayMonth(start), e = swapDayMonth(end);
    if ((s !== start || e !== end) && !(s && e && e < s) && !periodIssues(sub, s, e, paidOn).length) swap = { start: s || '', end: e || '' };
  }
  return { ...idle, issues, swap, to: renewalAfter(sub, end || (start ? addDays(addMonths(start, sub.cycle_months || 1), -1) : null)) };
}

// ─── Invoice → subscription payments ─────────────────────
export const subLabel = (s) => `${s.vendor}${s.product ? ` — ${s.product}` : ''}${s.reference ? ` · ${s.reference}` : ''}`;

// Lines that pay subscriptions take their share of the invoice total (net
// prices scaled to the VAT-inclusive total), split evenly between the line's
// subscriptions. lines: [{ key, quantity, unit, subIds, periodStart, periodEnd, text, oneTime }]
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
      const key = `${id}|${l.periodStart || ''}|${l.periodEnd || ''}|${l.oneTime ?? ''}`;
      const sp = merged.get(key);
      if (sp) {
        sp.amount = Math.round((sp.amount + each) * 100) / 100;
        sp.description = [sp.description, text].filter(Boolean).join('; ').slice(0, 500) || null;
      } else {
        merged.set(key, {
          subscription_id: id, amount: each,
          period_start: l.periodStart || null, period_end: l.periodEnd || null,
          one_time: l.oneTime ?? null,          // null = let periodCheck decide
          description: text.slice(0, 500) || null,
        });
      }
    });
  });
  // Credits. A plan change is invoiced as "new plan" + "proration credit for
  // the old one": the credit is not a payment of its own, it makes the charge
  // smaller. A negative share is folded into the largest charge for the same
  // subscription (else the largest one on the invoice); credits on lines that
  // pay no subscription come off the largest charge too, so the parts never
  // add up to more than the invoice total.
  const r2 = (n) => Math.round(n * 100) / 100;
  const all = [...merged.values()];
  const charges = all.filter(sp => sp.amount > 0);
  const biggest = (list) => list.reduce((a, b) => (b.amount > a.amount ? b : a), list[0]);
  for (const credit of all.filter(sp => sp.amount <= 0)) {
    const target = biggest(charges.filter(sp => sp.subscription_id === credit.subscription_id)) || biggest(charges);
    if (!target) return { splits: [], byLine, error: true };
    target.amount = r2(target.amount + credit.amount);
    target.description = [target.description, credit.description].filter(Boolean).join('; ').slice(0, 500) || null;
  }
  const excess = r2(charges.reduce((a, sp) => a + sp.amount, 0) - total);
  if (excess > 0.05 && charges.length) biggest(charges).amount = r2(biggest(charges).amount - excess);
  if (charges.some(sp => sp.amount <= 0)) return { splits: [], byLine, error: true };
  return { splits: charges, byLine, error: false };
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
