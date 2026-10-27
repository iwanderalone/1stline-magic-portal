import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { Badge, Card } from '../../../components/UI';
import { useLang } from '../../../components/LangContext';
import { Money, RenewalBadge, fmtDate, useCur, useLabels } from './shared';

function Tile({ label, children, sub, tone }) {
  return (
    <Card padding={16} style={tone ? { borderLeft: `3px solid ${tone}` } : undefined}>
      <div className="t-eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{children}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</div>}
    </Card>
  );
}

// Single-series monthly spend. One hue (accent), thin bars rounded at the
// data end only, a 2px gap between bars, value on hover; the payments tab is
// the table view of the same numbers.
function SpendChart({ months }) {
  const { lang } = useLang();
  const { cur } = useCur();
  const [hover, setHover] = useState(null);
  const vals = months.map(m => (cur === 'USD' ? m.usd : m.aed) || 0);
  const max = Math.max(...vals, 1);
  const label = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { month: 'short' });
  const fmt = (v) => v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 160, borderBottom: '1px solid var(--border)' }}>
        {months.map((m, i) => (
          <div key={m.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ flex: 1, height: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', cursor: 'default' }}>
            <div style={{
              width: '70%', maxWidth: 28, height: `${(vals[i] / max) * 100}%`, minHeight: vals[i] ? 2 : 0,
              background: 'var(--accent)', opacity: hover == null || hover === i ? 1 : 0.45,
              borderRadius: '4px 4px 0 0', transition: 'opacity var(--dur-fast) ease',
            }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 2, marginTop: 6 }}>
        {months.map(m => (
          <span key={m.month} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: 'var(--text-muted)' }}>{label(m.month)}</span>
        ))}
      </div>
      {hover != null && (
        <div style={{
          position: 'absolute', top: 0, left: `${((hover + 0.5) / months.length) * 100}%`, transform: 'translateX(-50%)',
          background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-lg)', padding: '6px 10px', fontSize: 12, pointerEvents: 'none', whiteSpace: 'nowrap',
          color: 'var(--text)',
        }}>
          <div style={{ color: 'var(--text-muted)' }}>{new Date(`${months[hover].month}T00:00:00`).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-GB', { month: 'long', year: 'numeric' })}</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{fmt(vals[hover])} {cur}</div>
        </div>
      )}
    </div>
  );
}

// Ranked share list: a bar per row, longest first, label + value in text ink.
function RankList({ rows, nameOf = (n) => n }) {
  const { cur } = useCur();
  const vals = rows.map(r => (cur === 'USD' ? r.monthly_usd : r.monthly_aed) || 0);
  const max = Math.max(...vals, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r, i) => (
        <div key={r.name} title={`${nameOf(r.name)}: ${vals[i].toFixed(2)} ${cur}`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3, gap: 8 }}>
            <span style={{ color: 'var(--text-secondary)' }}>{nameOf(r.name)}</span>
            <Money aed={r.monthly_aed} usd={r.monthly_usd} />
          </div>
          <div style={{ height: 6, background: 'var(--surface-sunken)', borderRadius: 3 }}>
            <div style={{ width: `${(vals[i] / max) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function OverviewTab({ reloadKey, netboxEnabled, onOpenSub, onGo }) {
  const { lang, t: tr } = useLang();
  const L = useLabels();
  const [s, setS] = useState(null);
  const [leavers, setLeavers] = useState(null);

  useEffect(() => { api('/purchases/summary').then(setS).catch(() => setS(null)); }, [reloadKey]);
  useEffect(() => {
    if (!netboxEnabled) return;
    api('/purchases/people?leavers_only=true').then(d => setLeavers(d || [])).catch(() => setLeavers(null));
  }, [reloadKey, netboxEnabled]);

  if (!s) return null;
  const leaverSeats = (leavers || []).reduce((n, p) => n + p.seats.length, 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <Tile label={tr('purMonthlyRunRate')} sub={tr('purActiveSubs').replace('{n}', s.active_count)}>
          <Money aed={s.monthly_aed} usd={s.monthly_usd} strong />
        </Tile>
        <Tile label={tr('purYearlyRunRate')}><Money aed={s.yearly_aed} usd={s.yearly_usd} strong /></Tile>
        <Tile label={tr('purSeats')} sub={tr('purSeatsFree').replace('{n}', Math.max(s.seats_total - s.seats_used, 0))}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.seats_used}/{s.seats_total}</span>
        </Tile>
        <Tile label={tr('purToConfirm')} tone={s.unconfirmed_payments ? 'var(--warning)' : undefined}
          sub={s.unconfirmed_payments ? <a onClick={() => onGo('payments')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>{tr('purReview')} →</a> : tr('purAllConfirmed')}>
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{s.unconfirmed_payments}</span>
        </Tile>
        {netboxEnabled && (
          <Tile label={tr('purLeaverSeats')} tone={leaverSeats ? 'var(--danger)' : undefined}
            sub={leaverSeats ? <a onClick={() => onGo('people')} style={{ color: 'var(--accent)', cursor: 'pointer' }}>{tr('purReview')} →</a> : tr('purNoLeaversShort')}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{leavers == null ? '…' : leaverSeats}</span>
          </Tile>
        )}
      </div>

      {(s.lapsed.length > 0 || s.over_assigned.length > 0 || s.unknown_fx.length > 0) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {s.lapsed.map(x => (
            <span key={x.id} onClick={() => onOpenSub(x.id)} style={{ cursor: 'pointer' }}>
              <Badge color="red" dot>{tr('purLapsedItem').replace('{name}', x.vendor)}</Badge>
            </span>
          ))}
          {s.over_assigned.map(v => <Badge key={v} color="yellow" dot>{tr('purOverAssigned').replace('{name}', v)}</Badge>)}
          {s.unknown_fx.map(v => <Badge key={v} color="yellow" dot>{tr('purNoRate').replace('{name}', v)}</Badge>)}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', alignItems: 'start', gap: 16 }}>
        <Card header={tr('purUpcoming')} padding="12px 18px">
          {s.upcoming.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tr('purNothingUpcoming')}</div>
          ) : s.upcoming.map(x => (
            <div key={x.id} onClick={() => onOpenSub(x.id)} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', fontSize: 13,
              borderTop: '1px solid var(--border-light)', cursor: 'pointer',
            }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <b>{x.vendor}</b>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> · {fmtDate(x.next_renewal, lang)}{x.card ? ` · ${L.card(x.card)}` : ''}</span>
              </span>
              <Money aed={x.price_aed} usd={x.price_usd} />
              <RenewalBadge sub={x} />
            </div>
          ))}
        </Card>
        <Card header={tr('purSpendByMonth')} padding="12px 18px">
          <SpendChart months={s.spend_by_month} />
        </Card>
        <Card header={tr('purByBudget')} padding="12px 18px">
          <RankList rows={s.by_budget} />
        </Card>
        <Card header={tr('purByCategory')} padding="12px 18px">
          <RankList rows={s.by_category} nameOf={L.category} />
        </Card>
      </div>
    </div>
  );
}
