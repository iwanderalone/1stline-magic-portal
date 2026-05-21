/**
 * CommandPalette — ⌘K / Ctrl+K quick-navigation overlay.
 *
 * Props:
 *   open        boolean
 *   onClose     () => void
 *   navigate    (pageId: string, runbookId?: string) => void
 *   user        { role, ... }
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api';
import { Icon } from './Icons';
import { useLang } from './LangContext';

export default function CommandPalette({ open, onClose, navigate, user }) {
  const { t: tr } = useLang();
  const [query, setQuery]       = useState('');
  const [runbooks, setRunbooks] = useState([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const isAdmin  = user?.role === 'admin';

  const NAV_ITEMS = [
    { id: 'home',      label: tr('home'),        icon: 'grid',     hint: tr('cmdHintHome') },
    { id: 'schedule',  label: tr('schedule'),    icon: 'calendar', hint: tr('cmdHintSchedule') },
    { id: 'mail',      label: tr('mailReporter'), icon: 'mail',    hint: tr('cmdHintMail') },
    { id: 'tickets',   label: 'Tickets',          icon: 'ticket',  hint: tr('cmdHintTickets') },
    { id: 'runbooks',  label: tr('cmdRunbooksSection'), icon: 'bookmark', hint: tr('cmdHintRunbooks') },
    { id: 'timeoff',   label: tr('timeOff'),      icon: 'sun',     hint: tr('cmdHintTimeoff') },
    { id: 'reminders', label: tr('reminders'),    icon: 'bell',    hint: tr('cmdHintReminders') },
    { id: 'profile',   label: tr('myProfile'),    icon: 'user',    hint: tr('cmdHintProfile') },
    { id: 'admin',     label: tr('admin'),        icon: 'shield',  hint: tr('cmdHintAdmin'), adminOnly: true },
  ];

  /* ── fetch runbooks & reset when palette opens ── */
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    // Small delay so the portal is in the DOM before focusing
    requestAnimationFrame(() => inputRef.current?.focus());
    api('/runbooks/').then(d => setRunbooks(d || [])).catch(() => {});
  }, [open]);

  /* ── filter ── */
  const q = query.toLowerCase().trim();

  const pages = NAV_ITEMS
    .filter(p => !p.adminOnly || isAdmin)
    .filter(p =>
      !q ||
      p.label.toLowerCase().includes(q) ||
      p.hint.toLowerCase().includes(q)
    );

  const matchedRunbooks = !q
    ? []
    : runbooks
        .filter(r =>
          r.title.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          (r.slug || '').includes(q) ||
          (Array.isArray(r.tags) ? r.tags : (r.tags ? JSON.parse(r.tags) : [])).some(
            tag => tag.toLowerCase().includes(q)
          )
        )
        .slice(0, 8);

  /* flat array for keyboard navigation */
  const allResults = [
    ...pages.map(p => ({ _type: 'page', ...p })),
    ...matchedRunbooks.map(r => ({ _type: 'runbook', ...r })),
  ];

  /* reset cursor when query changes */
  useEffect(() => { setActiveIdx(0); }, [query]);

  /* scroll active item into view */
  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  /* ── selection ── */
  const select = useCallback((item) => {
    if (item._type === 'page')    navigate(item.id);
    if (item._type === 'runbook') navigate('runbooks', item.id);
    onClose();
  }, [navigate, onClose]);

  /* ── keyboard ── */
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx(i => Math.min(i + 1, allResults.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (allResults[activeIdx]) select(allResults[activeIdx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, allResults, activeIdx, select, onClose]);

  if (!open) return null;

  const hasRunbooks = matchedRunbooks.length > 0;

  const palette = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000,
        background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        paddingTop: 'clamp(60px, 12vh, 140px)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          width: '100%', maxWidth: 560,
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow-lg)',
          overflow: 'hidden',
          display: 'flex', flexDirection: 'column',
          maxHeight: '70vh',
        }}
      >
        {/* ── Search input ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <Icon name="search" size={16} color="var(--text-muted)" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={tr('cmdPlaceholder')}
            style={{
              flex: 1, border: 'none', outline: 'none',
              background: 'transparent',
              color: 'var(--text)', fontSize: 15,
              fontFamily: 'inherit',
            }}
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: 'var(--text-muted)', padding: 2, lineHeight: 1,
                fontSize: 16,
              }}
              tabIndex={-1}
            >×</button>
          )}
        </div>

        {/* ── Results ── */}
        <div ref={listRef} style={{ overflowY: 'auto', flex: 1 }}>
          {allResults.length === 0 && q && (
            <div style={{
              padding: '28px 16px', textAlign: 'center',
              color: 'var(--text-muted)', fontSize: 13,
            }}>
              {tr('cmdNoResults')} <strong>"{query}"</strong>
            </div>
          )}

          {/* Pages section */}
          {pages.length > 0 && (
            <>
              <SectionHeader label={tr('cmdPages')} />
              {pages.map((item, i) => (
                <ResultItem
                  key={item.id}
                  item={item}
                  idx={i}
                  active={activeIdx === i}
                  onSelect={select}
                  onHover={() => setActiveIdx(i)}
                  icon={item.icon}
                  label={item.label}
                  hint={item.hint}
                />
              ))}
            </>
          )}

          {/* Runbooks section */}
          {hasRunbooks && (
            <>
              <SectionHeader label={tr('cmdRunbooksSection')} />
              {matchedRunbooks.map((rb, i) => {
                const idx = pages.length + i;
                return (
                  <ResultItem
                    key={rb.id}
                    item={{ _type: 'runbook', ...rb }}
                    idx={idx}
                    active={activeIdx === idx}
                    onSelect={select}
                    onHover={() => setActiveIdx(idx)}
                    icon="bookmark"
                    label={rb.title}
                    hint={`${rb.slug} · ${rb.category}`}
                    badge={rb.category}
                  />
                );
              })}
            </>
          )}
        </div>

        {/* ── Footer ── */}
        <div style={{
          display: 'flex', gap: 16, alignItems: 'center',
          padding: '8px 16px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg)',
          flexShrink: 0,
        }}>
          {[
            ['↑↓', tr('cmdNavigate')],
            ['↵', tr('cmdOpen')],
            ['Esc', tr('cmdClose')],
          ].map(([key, label]) => (
            <span key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              <kbd style={{
                padding: '1px 5px', borderRadius: 4,
                background: 'var(--surface-alt)', border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)',
              }}>{key}</kbd>
              {label}
            </span>
          ))}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
            {allResults.length} {allResults.length === 1 ? tr('cmdResultSingular') : tr('cmdResultPlural')}
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(palette, document.body);
}

function SectionHeader({ label }) {
  return (
    <div style={{
      padding: '6px 16px 4px',
      fontSize: 10.5, fontWeight: 600, letterSpacing: '0.06em',
      textTransform: 'uppercase', color: 'var(--text-muted)',
    }}>
      {label}
    </div>
  );
}

function ResultItem({ item, idx, active, onSelect, onHover, icon, label, hint, badge }) {
  return (
    <div
      data-idx={idx}
      onMouseEnter={onHover}
      onMouseDown={() => onSelect(item)}
      style={{
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '9px 16px', cursor: 'pointer',
        background: active ? 'var(--accent-light)' : 'transparent',
        borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
        transition: 'background 0.08s',
      }}
    >
      <span style={{
        width: 28, height: 28, borderRadius: 6, flexShrink: 0,
        background: active ? 'var(--accent)' : 'var(--surface-alt)',
        border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? '#fff' : 'var(--text-secondary)',
        transition: 'background 0.08s, color 0.08s',
      }}>
        <Icon name={icon} size={13} color="currentColor" />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: active ? 'var(--accent)' : 'var(--text)', lineHeight: 1.2 }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {hint}
          </div>
        )}
      </div>
      {badge && (
        <span style={{
          fontSize: 10.5, padding: '2px 7px', borderRadius: 999,
          background: 'var(--surface-alt)', border: '1px solid var(--border)',
          color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {badge}
        </span>
      )}
      {active && (
        <Icon name="arrowRight" size={12} color="var(--accent)" />
      )}
    </div>
  );
}
