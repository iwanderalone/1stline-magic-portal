import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useLang } from './LangContext';

const MONO = { fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' };

const FIELD = {
  padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
  fontSize: 13, background: 'var(--surface-alt)', color: 'var(--text)', outline: 'none',
  width: '100%',
};

/** Type-ahead over a NetBox collection, debounced and cancel-safe. */
function useSearch(path, query, { minChars = 2, extraParams = '' } = {}) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < minChars) { setItems([]); return; }
    const mine = ++seq.current;
    const timer = setTimeout(() => {
      setLoading(true);
      api(`${path}?q=${encodeURIComponent(term)}&page_size=8${extraParams}`)
        .then(d => {
          // Ignore anything but the newest query — otherwise a slow early
          // response overwrites the results for what the user is typing now.
          if (mine === seq.current) setItems(d.items || []);
        })
        .catch(() => mine === seq.current && setItems([]))
        .finally(() => mine === seq.current && setLoading(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [path, query, minChars, extraParams]);

  return { items, loading };
}

function Results({ items, loading, empty, render, onPick }) {
  if (loading) return <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 2px' }}>…</div>;
  if (!items.length) return empty ? <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '6px 2px' }}>{empty}</div> : null;
  return (
    <div style={{
      border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
      background: 'var(--surface)', maxHeight: 210, overflowY: 'auto',
    }}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          onClick={() => onPick(item)}
          style={{
            display: 'block', width: '100%', textAlign: 'left', border: 'none',
            borderBottom: '1px solid var(--border-light)', background: 'transparent',
            padding: '8px 10px', cursor: 'pointer', fontFamily: 'inherit', color: 'var(--text)',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--surface-alt)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >{render(item)}</button>
      ))}
    </div>
  );
}

/** Pick one NetBox contact — employees and the person signing are both contacts. */
export function ContactPicker({ label, value, onChange, hint }) {
  const { t: tr } = useLang();
  const [query, setQuery] = useState('');
  const { items, loading } = useSearch('/tools/inventory/contacts', query);

  if (value) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label className="t-eyebrow">{label}</label>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 11px',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--surface-alt)',
        }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{value.name}</span>
          {value.description && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{value.description}</span>}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={() => onChange(null)} style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15,
          }}>×</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <label className="t-eyebrow">{label}</label>
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={tr('hoSearchContact')}
        style={FIELD}
      />
      {hint && !query && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>}
      <Results
        items={items}
        loading={loading}
        empty={query.trim().length >= 2 ? tr('hoNoContacts') : null}
        onPick={c => { onChange(c); setQuery(''); }}
        render={c => (
          <>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
            {(c.description || c.email) && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                {[c.description, c.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </>
        )}
      />
    </div>
  );
}

/** Pick NetBox devices for the handover — the lines come from the inventory. */
export function DevicePicker({ selected, onChange }) {
  const { t: tr } = useLang();
  const [query, setQuery] = useState('');
  const { items, loading } = useSearch('/tools/inventory/devices', query);

  const add = (d) => {
    if (!selected.some(x => x.id === d.id)) onChange([...selected, d]);
    setQuery('');
  };
  const remove = (id) => onChange(selected.filter(x => x.id !== id));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label className="t-eyebrow">{tr('hoDevices')}</label>

      {selected.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
          {selected.map((d, i) => (
            <div key={d.id} style={{
              display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 10,
              alignItems: 'center', padding: '8px 11px',
              borderTop: i === 0 ? 'none' : '1px solid var(--border-light)',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 13, fontWeight: 500, overflow: 'hidden',
                  textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{d.device_type?.display || d.name || `#${d.id}`}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', ...MONO }}>
                  {[d.serial && `S/N ${d.serial}`, d.asset_tag && `#${d.asset_tag}`].filter(Boolean).join(' · ') || '—'}
                </div>
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.role?.display}</span>
              <button type="button" onClick={() => remove(d.id)} style={{
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 15,
              }}>×</button>
            </div>
          ))}
        </div>
      )}

      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={tr('hoSearchDevice')}
        style={FIELD}
      />
      <Results
        items={items}
        loading={loading}
        empty={query.trim().length >= 2 ? tr('hoNoDevices') : null}
        onPick={add}
        render={d => (
          <>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{d.name || d.display || `#${d.id}`}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', ...MONO }}>
              {[d.serial && `S/N ${d.serial}`, d.asset_tag && `#${d.asset_tag}`, d.role?.display]
                .filter(Boolean).join(' · ')}
            </div>
          </>
        )}
      />
    </div>
  );
}
