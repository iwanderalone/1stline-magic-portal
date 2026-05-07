// frontend/src/components/UI.jsx
import { createPortal } from 'react-dom';
import { Icon } from './Icons';

/* ─── Button ───────────────────────────────────────────────── */
export function Button({ children, variant = 'secondary', size = 'md', icon, iconRight, style, ...props }) {
  return (
    <button className={`btn btn-${variant} btn-${size}`} style={style} {...props}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : size === 'lg' ? 15 : 14} />}
      {children}
      {iconRight && <Icon name={iconRight} size={size === 'sm' ? 13 : size === 'lg' ? 15 : 14} />}
    </button>
  );
}

/* ─── Input ────────────────────────────────────────────────── */
export function Input({ label, style, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label className="t-eyebrow">{label}</label>}
      <input style={{
        padding: '8px 11px', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', fontSize: 13,
        background: 'var(--surface-alt)', color: 'var(--text)',
        outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
        width: '100%', ...style,
      }} {...props} />
    </div>
  );
}

/* ─── Select ───────────────────────────────────────────────── */
export function Select({ label, children, style, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {label && <label className="t-eyebrow">{label}</label>}
      <select style={{
        padding: '8px 11px', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-sm)', fontSize: 13,
        background: 'var(--surface-alt)', color: 'var(--text)',
        outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
        ...style,
      }} {...props}>{children}</select>
    </div>
  );
}

/* ─── Card ─────────────────────────────────────────────────── */
/* accent: true = iridescent stripe, string = that color stripe, omit = no stripe */
export function Card({ children, style, className = '', header, footer, accent, padding }) {
  const accentBg = accent === true
    ? 'linear-gradient(to bottom, var(--accent), var(--accent-hover))'
    : accent || null;
  return (
    <div className={className} style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius)',
      boxShadow: 'var(--shadow)',
      overflow: 'hidden',
      ...style,
    }}>
      {header && (
        <div style={{
          position: 'relative',
          padding: '14px 18px',
          borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {accentBg && (
            <span style={{
              position: 'absolute', left: 0, top: 8, bottom: 8, width: 3,
              background: accentBg, borderRadius: '0 3px 3px 0',
            }} />
          )}
          {header}
        </div>
      )}
      <div style={padding != null ? { padding } : undefined}>{children}</div>
      {footer && (
        <div style={{
          padding: '10px 18px', borderTop: '1px solid var(--border-light)',
          background: 'var(--surface-alt)', fontSize: 12, color: 'var(--text-secondary)',
        }}>{footer}</div>
      )}
    </div>
  );
}

/* ─── Badge ────────────────────────────────────────────────── */
/* tone = { fg, bg, dot } object OR color shorthand string ('blue','green','red','yellow','gray') */
export function Badge({ children, tone, color, dot, mono, style }) {
  let resolved;
  if (tone && typeof tone === 'object') {
    resolved = tone;
  } else {
    const c = color || 'gray';
    const map = {
      blue:   { fg: 'var(--accent)',   bg: 'var(--accent-light)',   dot: 'var(--accent)' },
      green:  { fg: 'var(--success)',  bg: 'var(--success-light)',  dot: 'var(--success)' },
      red:    { fg: 'var(--danger)',   bg: 'var(--danger-light)',   dot: 'var(--danger)' },
      yellow: { fg: 'var(--warning)',  bg: 'var(--warning-light)',  dot: 'var(--warning)' },
      gray:   { fg: 'var(--text-secondary)', bg: 'var(--surface-alt)', dot: 'var(--text-muted)' },
    };
    resolved = map[c] || map.gray;
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '2px 8px', borderRadius: 'var(--radius-pill)',
      fontSize: 11, fontWeight: 600, letterSpacing: 0.03, whiteSpace: 'nowrap',
      fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
      background: resolved.bg, color: resolved.fg,
      ...style,
    }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: resolved.dot, flexShrink: 0 }} />}
      {children}
    </span>
  );
}

/* ─── Tag (mono pill for IDs, categories, status strings) ──── */
export function Tag({ children, style }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '1px 7px',
      background: 'var(--surface-alt)',
      border: '1px solid var(--border-light)',
      borderRadius: 'var(--radius-xs)',
      color: 'var(--text-secondary)',
      fontSize: 11, fontFamily: 'var(--font-mono)',
      whiteSpace: 'nowrap',
      ...style,
    }}>{children}</span>
  );
}

/* ─── Avatar ───────────────────────────────────────────────── */
/* name: string, color: hex/css color string */
export function Avatar({ name, color, size = 28, ring }) {
  if (!name) return (
    <div style={{
      width: size, height: size, borderRadius: 'var(--radius-sm)',
      background: 'var(--surface-alt)', color: 'var(--text-muted)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.42, border: '1px dashed var(--border-strong)', flexShrink: 0,
    }}>?</div>
  );
  const initials = name.trim().split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase();
  const bg = color || 'var(--accent)';
  return (
    <div title={name} style={{
      width: size, height: size, borderRadius: 'var(--radius-sm)',
      background: bg, color: '#fff', flexShrink: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: Math.max(10, size * 0.40), fontWeight: 600, letterSpacing: '-0.01em',
      boxShadow: ring ? `0 0 0 2px var(--surface), 0 0 0 4px ${bg}` : 'none',
    }}>{initials}</div>
  );
}

/* ─── StatusDot ────────────────────────────────────────────── */
export function StatusDot({ tone = 'var(--text-muted)', pulse, size = 8 }) {
  return (
    <span className={pulse ? 'dot-pulse' : ''} style={{
      width: size, height: size, borderRadius: '50%',
      background: tone, display: 'inline-block', flexShrink: 0,
    }} />
  );
}

/* ─── Sparkline ────────────────────────────────────────────── */
export function Sparkline({ values, w = 80, h = 24, color = 'var(--accent)' }) {
  if (!values || values.length < 2) return null;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const step = w / (values.length - 1);
  const pts = values.map((v, i) =>
    `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`
  ).join(' ');
  const area = `0,${h} ${pts} ${w},${h}`;
  return (
    <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
      <polygon points={area} fill={color} fillOpacity={0.10} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle
        cx={(values.length - 1) * step}
        cy={h - ((values[values.length - 1] - min) / span) * (h - 2) - 1}
        r={2.2} fill={color}
      />
    </svg>
  );
}

/* ─── Bar (horizontal progress bar) ────────────────────────── */
export function Bar({ value, color = 'var(--accent)', height = 4, bg, label }) {
  const pct = Math.max(0, Math.min(100, (value || 0) * 100));
  return (
    <div style={{ width: '100%' }}>
      {label && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
          {label}
        </div>
      )}
      <div style={{ height, background: bg || 'var(--surface-sunken)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          borderRadius: 999, transition: 'width 400ms var(--ease-state)',
        }} />
      </div>
    </div>
  );
}

/* ─── Kbd ──────────────────────────────────────────────────── */
export function Kbd({ children }) {
  return (
    <kbd style={{
      fontFamily: 'var(--font-mono)', fontSize: 10.5,
      padding: '1px 5px', background: 'var(--surface-alt)',
      border: '1px solid var(--border)', borderRadius: 4,
      color: 'var(--text-secondary)',
    }}>{children}</kbd>
  );
}

/* ─── SLAGauge ─────────────────────────────────────────────── */
/* value: 0..1 (0 = breached, 1 = full SLA remaining) */
export function SLAGauge({ value, w = 38 }) {
  const v = Math.max(0, Math.min(1, value || 0));
  const tone = v > 0.5 ? 'var(--success)' : v > 0.25 ? 'var(--warning)' : 'var(--danger)';
  const r = 7, c = 2 * Math.PI * r;
  const off = c * (1 - v);
  return (
    <svg width={w} height={20} viewBox="0 0 38 20">
      <circle cx="10" cy="10" r={r} stroke="var(--surface-sunken)" strokeWidth="2" fill="none" />
      <circle cx="10" cy="10" r={r} stroke={tone} strokeWidth="2" fill="none"
        strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
        transform="rotate(-90 10 10)" />
      <text x="22" y="14" fontFamily="var(--font-mono)" fontSize="10" fill={tone}>
        {Math.round(v * 100)}%
      </text>
    </svg>
  );
}

/* ─── Toast ────────────────────────────────────────────────── */
export function Toast({ message, type = 'info', onClose }) {
  const accent = { info: 'var(--accent)', success: 'var(--success)', error: 'var(--danger)' }[type] || 'var(--accent)';
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderLeft: `3px solid ${accent}`, borderRadius: 'var(--radius-sm)',
      padding: '12px 18px', boxShadow: 'var(--shadow-lg)',
      display: 'flex', alignItems: 'center', gap: 12,
      maxWidth: 380, minWidth: 240,
    }}>
      <span style={{ fontSize: 13, color: 'var(--text)', flex: 1, lineHeight: 1.5 }}>{message}</span>
      {onClose && (
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'var(--text-muted)',
          fontSize: 16, padding: '0 2px', lineHeight: 1, cursor: 'pointer',
        }}>×</button>
      )}
    </div>
  );
}

/* ─── EmptyState ───────────────────────────────────────────── */
export function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '56px 24px' }}>
      {icon && <div style={{ marginBottom: 14, opacity: 0.5 }}>{icon}</div>}
      <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5, fontSize: 14 }}>{title}</div>
      {subtitle && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 280, margin: '0 auto', lineHeight: 1.6 }}>
          {subtitle}
        </div>
      )}
    </div>
  );
}

/* ─── Overlay (portal modal) ───────────────────────────────── */
export function Overlay({ children, onClose, title, maxWidth = 520 }) {
  const modal = (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.40)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20,
      }}
    >
      <div className="fade-up" style={{
        width: '100%', maxWidth,
        background: 'var(--surface)',
        borderRadius: 'var(--radius)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-lg)',
        overflow: 'hidden',
        maxHeight: 'calc(100vh - 40px)',
        display: 'flex', flexDirection: 'column',
      }}>
        {title && (
          <div style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'var(--surface-alt)', position: 'relative', flexShrink: 0,
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
              background: 'linear-gradient(to bottom, var(--accent), var(--accent-hover))',
            }} />
            <h3 style={{ fontSize: 14, fontWeight: 700, paddingLeft: 10, letterSpacing: '-0.01em', color: 'var(--text)' }}>
              {title}
            </h3>
            <button onClick={onClose} style={{
              background: 'none', border: 'none', fontSize: 17,
              color: 'var(--text-muted)', padding: '2px 4px', lineHeight: 1,
              borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            }}>✕</button>
          </div>
        )}
        <div style={{ padding: 22, overflowY: 'auto' }}>{children}</div>
      </div>
    </div>
  );
  return createPortal(modal, document.body);
}

/* ─── Tabs ─────────────────────────────────────────────────── */
export function Tabs({ tabs, active, onChange }) {
  return (
    <div style={{
      display: 'flex', gap: 1, padding: 3,
      background: 'var(--surface-sunken)', borderRadius: 'var(--radius-sm)',
      width: 'fit-content',
    }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          padding: '6px 14px', border: 'none', borderRadius: 'var(--radius-xs)',
          fontSize: 12, fontWeight: active === tab.id ? 600 : 500,
          background: active === tab.id ? 'var(--surface)' : 'transparent',
          color: active === tab.id ? 'var(--text)' : 'var(--text-muted)',
          boxShadow: active === tab.id ? 'var(--shadow-xs)' : 'none',
          transition: 'all var(--dur-fast) ease', fontFamily: 'inherit', cursor: 'pointer',
        }}>{tab.label}</button>
      ))}
    </div>
  );
}

/* ─── SectionHeader ────────────────────────────────────────── */
export function SectionHeader({ title, eyebrow, action, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
      {eyebrow && <div className="t-eyebrow" style={{ marginRight: 4 }}>{eyebrow}</div>}
      <h2 className="t-h3" style={{ margin: 0 }}>{title}</h2>
      {count != null && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{count}</span>
      )}
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
}
