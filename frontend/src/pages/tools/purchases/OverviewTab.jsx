import { useEffect, useMemo, useState } from 'react';
import { api } from '../../../api';
import { Card } from '../../../components/UI';
import { Icon } from '../../../components/Icons';
import { useLang } from '../../../components/LangContext';
import { Money, categoryColor, categoryOrder, fmtDate, useCur, useLabels } from './shared';

// AED is pegged to USD; the summary sends per-category numbers in AED only.
const AED_PER_USD = 3.6725;
const nf0 = (v) => Math.round(v || 0).toLocaleString('en-US');
const short = (v) => (v >= 1000 ? `${Math.round(v / 100) / 10}k`.replace('.0k', 'k') : String(Math.round(v)));
const monthEnd = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  return `${iso.slice(0, 8)}${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
};

function useMonthName() {
  const { lang } = useLang();
  return (iso, opts = { month: 'short' }) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', opts);
}

const linkStyle = { color: 'var(--accent)', cursor: 'pointer', background: 'none', border: 'none', padding: 0, font: 'inherit', textAlign: 'left' };

// ─── Top row ─────────────────────────────────────────────

function Kpi({ label, children, foot }) {
  return (
    <Card padding={16} style={{ display: 'flex', flexDirection: 'column', gap: 6, minHeight: 150 }}>
      <div className="t-eyebrow">{label}</div>
      {children}
      {foot && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 'auto' }}>{foot}</div>}
    </Card>
  );
}

function MonthCard({ s }) {
  const { t: tr } = useLang();
  const monthName = useMonthName();
  const { cur } = useCur();
  const paid = cur === 'USD' ? s.month.paid.usd : s.month.paid.aed;
  const expected = cur === 'USD' ? s.month.expected.usd : s.month.expected.aed;
  const pct = expected ? Math.min(paid / expected, 1) : 0;
  return (
    <Kpi label={tr('purOvMonth').replace('{month}', monthName(s.month.start, { month: 'long' }))}
      foot={<>{tr('purOvRunRate')}: <Money aed={s.monthly_aed} usd={s.monthly_usd} /> · <Money aed={s.yearly_aed} usd={s.yearly_usd} /> {tr('purOvPerYear')}</>}>
      <div style={{ fontSize: 22 }}><Money aed={s.month.paid.aed} usd={s.month.paid.usd} strong /></div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {tr('purOvOfExpected').replace('{pct}', Math.round(pct * 100))} <Money aed={s.month.expected.aed} usd={s.month.expected.usd} />
      </div>
      <div role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}
        style={{ height: 6, background: 'var(--surface-sunken)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
      </div>
      {s.month.pending.aed > 0 && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          + <Money aed={s.month.pending.aed} usd={s.month.pending.usd} /> {tr('purOvAwaitingInvoice')}
        </div>
      )}
    </Kpi>
  );
}

function NextCard({ s }) {
  const { lang, t: tr } = useLang();
  const first = s.upcoming[0];
  return (
    <Kpi label={tr('purOvNext30')}
      foot={first && <>{tr('purOvNearest')}: <b style={{ color: 'var(--text-secondary)' }}>{first.vendor}</b> · {fmtDate(first.date, lang)}</>}>
      <div style={{ fontSize: 22 }}><Money aed={s.upcoming_total.aed} usd={s.upcoming_total.usd} strong /></div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {tr('purOvRenewalsCount').replace('{n}', s.upcoming.reduce((n, g) => n + g.sub_ids.length, 0))}
      </div>
    </Kpi>
  );
}

function AttentionCard({ s, onGo, onOpenSub }) {
  const { t: tr } = useLang();
  const a = s.attention;
  const names = (list) => {
    const shown = list.slice(0, 3).map(x => x.vendor);
    const uniq = [...new Set(shown)];
    return uniq.join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '');
  };
  const items = [];
  if (a.unconfirmed) {
    items.push({ key: 'unc', warn: true, text: tr('purOvUnconfirmed').replace('{n}', a.unconfirmed),
      sub: <Money aed={a.unconfirmed_total.aed} usd={a.unconfirmed_total.usd} />,
      go: () => onGo('payments', { status: 'unconfirmed', from: '2000-01-01' }) });
  }
  if (a.no_invoice.length) {
    items.push({ key: 'inv', text: tr('purOvNoInvoice').replace('{n}', a.no_invoice.length), sub: names(a.no_invoice),
      go: a.no_invoice.length === 1 ? () => onOpenSub(a.no_invoice[0].id) : null, list: a.no_invoice });
  }
  for (const p of a.price_up) {
    items.push({ key: `up${p.id}`, text: tr('purOvPriceUp').replace('{name}', p.vendor).replace('{pct}', p.pct),
      sub: `${p.from.toFixed(2)} → ${p.to.toFixed(2)} ${p.currency}${p.product ? ` · ${p.product}` : ''}`, go: () => onOpenSub(p.id) });
  }
  for (const x of a.lapsed) {
    items.push({ key: `lap${x.id}`, warn: true, text: tr('purLapsedItem').replace('{name}', x.vendor), go: () => onOpenSub(x.id) });
  }
  if (a.unknown_fx.length) {
    items.push({ key: 'fx', text: tr('purOvNoRate').replace('{names}', [...new Set(a.unknown_fx)].join(', ')) });
  }
  const [open, setOpen] = useState(null);

  return (
    <Kpi label={tr('purOvAttention')}>
      {items.length === 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13, marginTop: 6 }}>
          <Icon name="checkCircle" size={16} /> {tr('purOvAllClear')}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          {items.map(it => (
            <div key={it.key}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, alignSelf: 'center',
                  background: it.warn ? 'var(--warning)' : 'var(--text-muted)' }} />
                {it.go || it.list
                  ? <button type="button" style={linkStyle} onClick={it.go || (() => setOpen(o => (o === it.key ? null : it.key)))}>{it.text}</button>
                  : <span>{it.text}</span>}
              </div>
              {it.sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 14 }}>{it.sub}</div>}
              {open === it.key && it.list && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, margin: '6px 0 0 14px' }}>
                  {it.list.map(x => (
                    <button key={x.id} type="button" style={{ ...linkStyle, fontSize: 12 }} onClick={() => onOpenSub(x.id)}>
                      {x.vendor}{x.product ? ` — ${x.product}` : ''}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Kpi>
  );
}

// ─── Spend by month (stacked by category) ────────────────

const CHART_H = 180;

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function SpendChart({ months, onPick }) {
  const { t: tr } = useLang();
  const { cur } = useCur();
  const L = useLabels();
  const monthName = useMonthName();
  const [hover, setHover] = useState(null);
  const conv = (aed) => (cur === 'USD' ? aed / AED_PER_USD : aed);

  // Categories with a colour slot are their own segment; the rest fold into "other".
  const keys = useMemo(() => {
    const seen = new Set(months.flatMap(m => Object.keys(m.by_category)));
    const own = [...seen].filter(k => categoryOrder(k) < 99).sort((a, b) => categoryOrder(a) - categoryOrder(b));
    return { own, folded: [...seen].filter(k => categoryOrder(k) >= 99) };
  }, [months]);
  const segments = (m) => {
    const segs = keys.own.map(k => ({ key: k, v: conv(m.by_category[k] || 0) }));
    const rest = keys.folded.reduce((s, k) => s + (m.by_category[k] || 0), 0);
    if (rest) segs.push({ key: '__other', v: conv(rest) });
    return segs.filter(x => x.v > 0);
  };
  const totals = months.map(m => conv(m.aed));
  const max = niceMax(Math.max(...totals, 1));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const legend = [...keys.own.map(k => ({ key: k, label: L.category(k) })),
    ...(keys.folded.length ? [{ key: '__other', label: keys.folded.map(k => L.category(k)).join(', ') }] : [])];

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        {legend.map(l => (
          <span key={l.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: l.key === '__other' ? 'var(--series-other)' : categoryColor(l.key) }} />
            {l.label}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {/* y axis */}
        <div style={{ position: 'relative', width: 34, height: CHART_H, flexShrink: 0 }}>
          {ticks.map(t => (
            <span key={t} style={{ position: 'absolute', right: 0, bottom: `${(t / max) * 100}%`, transform: 'translateY(50%)',
              fontSize: 10, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{short(t)}</span>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <div style={{ position: 'relative', height: CHART_H, display: 'flex', alignItems: 'flex-end', gap: 2 }}>
            {ticks.map(t => (
              <div key={t} aria-hidden style={{ position: 'absolute', left: 0, right: 0, bottom: `${(t / max) * 100}%`,
                borderTop: `1px ${t ? 'dashed' : 'solid'} var(--border${t ? '-light' : ''})` }} />
            ))}
            {months.map((m, i) => {
              const segs = segments(m);
              return (
                <button key={m.month} type="button" onClick={() => onPick(m.month)}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  aria-label={`${monthName(m.month, { month: 'long', year: 'numeric' })}: ${nf0(totals[i])} ${cur}`}
                  style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
                    background: hover === i ? 'var(--surface-alt)' : 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                    borderRadius: 4, position: 'relative' }}>
                  <div style={{ width: '62%', maxWidth: 30, display: 'flex', flexDirection: 'column-reverse',
                    opacity: m.partial ? 0.5 : 1 }}>
                    {segs.map((sg, j) => (
                      <div key={sg.key} style={{
                        height: (sg.v / max) * CHART_H, boxSizing: 'border-box',
                        background: sg.key === '__other' ? 'var(--series-other)' : categoryColor(sg.key),
                        // 2px surface gap between stacked fills; rounded data end only on top.
                        borderTop: j < segs.length - 1 ? '2px solid var(--surface)' : 'none',
                        borderRadius: j === segs.length - 1 ? '4px 4px 0 0' : 0,
                      }} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
            {months.map(m => (
              <span key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>
                {monthName(m.month)}{m.partial ? '*' : ''}
              </span>
            ))}
          </div>
          {hover != null && (
            <div style={{
              position: 'absolute', top: 0, zIndex: 2,
              left: `${((hover + 0.5) / months.length) * 100}%`,
              transform: `translateX(${hover > months.length / 2 ? '-105%' : '5%'})`,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              boxShadow: 'var(--shadow-lg)', padding: '8px 10px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap',
              color: 'var(--text)', minWidth: 180,
            }}>
              <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>
                {monthName(months[hover].month, { month: 'long', year: 'numeric' })}{months[hover].partial ? ` · ${tr('purOvSoFar')}` : ''}
              </div>
              {Object.entries(months[hover].by_category).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'space-between' }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span aria-hidden style={{ width: 8, height: 8, borderRadius: 2, background: categoryColor(k) }} />
                    {L.category(k)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{nf0(conv(v))}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-light)', marginTop: 4, paddingTop: 4, fontWeight: 700 }}>
                <span>{tr('purOvTotal')}</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{nf0(totals[hover])} {cur}</span>
              </div>
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>{tr('purOvChartHint')}</div>
    </div>
  );
}

// ─── Breakdown & renewals ────────────────────────────────

function Breakdown({ rows, onGo }) {
  const { t: tr } = useLang();
  const L = useLabels();
  const [open, setOpen] = useState(() => new Set());
  const toggle = (k) => setOpen(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const top = Math.max(...rows.map(r => r.aed), 1);
  if (!rows.length) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tr('purNoSubs')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {rows.map(r => (
        <div key={r.key} style={{ borderTop: '1px solid var(--border-light)', padding: '8px 0' }}>
          <button type="button" onClick={() => toggle(r.key)} aria-expanded={open.has(r.key)}
            style={{ display: 'flex', width: '100%', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0,
              cursor: 'pointer', color: 'var(--text)', font: 'inherit', fontSize: 13, textAlign: 'left' }}>
            <span style={{ display: 'inline-flex', transform: open.has(r.key) ? 'rotate(90deg)' : 'none', transition: 'transform var(--dur-fast) ease', color: 'var(--text-muted)' }}>
              <Icon name="chevronRight" size={14} />
            </span>
            <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: categoryColor(r.key), flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{L.category(r.key)}</span>
            <Money aed={r.aed} usd={r.usd} />
            <span style={{ width: 40, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {Math.round(r.share * 100)}%
            </span>
          </button>
          <div style={{ height: 4, background: 'var(--surface-sunken)', borderRadius: 2, margin: '6px 0 0 36px' }}>
            <div style={{ width: `${(r.aed / top) * 100}%`, height: '100%', background: categoryColor(r.key), borderRadius: 2 }} />
          </div>
          {open.has(r.key) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '8px 0 2px 36px' }}>
              {r.vendors.map(v => (
                <div key={v.id || v.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                  <button type="button" style={{ ...linkStyle, flex: 1 }}
                    onClick={() => onGo('subscriptions', v.id ? { vendor_id: v.id } : { category: r.key })}>
                    {v.name}{v.count > 1 && <span style={{ color: 'var(--text-muted)' }}> ×{v.count}</span>}
                  </button>
                  <Money aed={v.aed} usd={v.usd} />
                  <span style={{ width: 40 }} />
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Renewals({ s, onGo, onOpenSub }) {
  const { lang, t: tr } = useLang();
  if (!s.upcoming.length) return <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tr('purNothingUpcoming')}</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {s.upcoming.map(g => {
        const n = g.sub_ids.length;
        const open = () => (n === 1 ? onOpenSub(g.sub_ids[0]) : onGo('subscriptions', g.vendor_id ? { vendor_id: g.vendor_id } : null));
        return (
          <button key={`${g.date}-${g.vendor}`} type="button" onClick={open} style={{
            display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 10, alignItems: 'center', padding: '7px 0',
            borderTop: '1px solid var(--border-light)', background: 'none', borderLeft: 'none', borderRight: 'none', borderBottom: 'none',
            cursor: 'pointer', color: 'var(--text)', font: 'inherit', fontSize: 13, textAlign: 'left', width: '100%',
          }}>
            <span style={{ fontSize: 12, color: g.days <= 3 ? 'var(--warning)' : 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}
              title={tr('purInDays').replace('{n}', g.days)}>
              {fmtDate(g.date, lang).replace(/\s?\d{4}$/, '')}
            </span>
            <span style={{ minWidth: 0 }}>
              <b>{g.vendor}</b>{n > 1 && <span style={{ color: 'var(--text-muted)' }}> ×{n}</span>}
              {g.products.length > 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {[...new Set(g.products)].join(', ')}
                </div>
              )}
            </span>
            {g.unknown_fx && !g.aed ? <span style={{ color: 'var(--text-muted)' }}>—</span> : <Money aed={g.aed} usd={g.usd} />}
          </button>
        );
      })}
      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 2, fontSize: 13, fontWeight: 600 }}>
        <span>{tr('purOvTotal')}</span>
        <Money aed={s.upcoming_total.aed} usd={s.upcoming_total.usd} strong />
      </div>
    </div>
  );
}

export default function OverviewTab({ reloadKey, onOpenSub, onGo }) {
  const { t: tr } = useLang();
  const [s, setS] = useState(null);

  useEffect(() => { api('/purchases/summary').then(setS).catch(() => setS(null)); }, [reloadKey]);
  if (!s) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
        <MonthCard s={s} />
        <NextCard s={s} />
        <AttentionCard s={s} onGo={onGo} onOpenSub={onOpenSub} />
      </div>

      <Card header={tr('purSpendByMonth')} padding="14px 18px">
        {/* Months before the log starts are not "zero spend" — leave them out (keep at least six). */}
        <SpendChart months={s.spend_by_month.slice(Math.min(Math.max(s.spend_by_month.findIndex(m => m.aed > 0), 0), 6))} onPick={(m) => onGo('payments', { from: m, to: monthEnd(m) })} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', alignItems: 'start', gap: 16 }}>
        <Card header={tr('purOvWhere')} padding="8px 18px 12px">
          <Breakdown rows={s.by_category} onGo={onGo} />
        </Card>
        <Card header={tr('purUpcoming')} padding="8px 18px 12px">
          <Renewals s={s} onGo={onGo} onOpenSub={onOpenSub} />
        </Card>
      </div>
    </div>
  );
}
