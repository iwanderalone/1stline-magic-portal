import { useTheme } from './ThemeContext';

export function Button({ children, variant = 'primary', size = 'md', style, ...props }) {
  return (
    <button className={`btn btn-${variant} btn-${size}`} style={style} {...props}>
      {children}
    </button>
  );
}

export function Input({ label, style, ...props }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {label && (
        <label style={{
          fontSize: '11px', fontWeight: 600, color: t.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{label}</label>
      )}
      <input style={{
        padding: '8px 11px', border: `1px solid ${t.border}`,
        borderRadius: t.radiusSm, fontSize: '13px',
        background: t.surfaceAlt, color: t.text,
        outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
        width: '100%', ...style,
      }} {...props} />
    </div>
  );
}

export function Select({ label, children, style, ...props }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {label && (
        <label style={{
          fontSize: '11px', fontWeight: 600, color: t.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>{label}</label>
      )}
      <select style={{
        padding: '8px 11px', border: `1px solid ${t.border}`,
        borderRadius: t.radiusSm, fontSize: '13px',
        background: t.surfaceAlt, color: t.text,
        outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
        ...style,
      }} {...props}>{children}</select>
    </div>
  );
}

export function Card({ children, style, className = '' }) {
  const { theme: t } = useTheme();
  return (
    <div className={className} style={{
      background: t.surface, borderRadius: t.radius,
      border: `1px solid ${t.border}`, boxShadow: t.shadow, ...style,
    }}>{children}</div>
  );
}

export function Badge({ children, color = 'blue' }) {
  const { theme: t } = useTheme();
  const c = {
    blue:   { bg: t.accentLight,  fg: t.accent },
    green:  { bg: t.successLight, fg: t.success },
    red:    { bg: t.dangerLight,  fg: t.danger },
    yellow: { bg: t.warningLight, fg: t.warning },
    gray:   { bg: t.surfaceAlt,   fg: t.textSecondary },
  }[color] || { bg: t.surfaceAlt, fg: t.textSecondary };
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 8px',
      borderRadius: '4px', fontSize: '11px', fontWeight: 700,
      background: c.bg, color: c.fg,
      letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

export function Toast({ message, type = 'info', onClose }) {
  const { theme: t } = useTheme();
  const accent = { info: t.accent, success: t.success, error: t.danger }[type] || t.accent;
  return (
    <div className="slide-in" style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      background: t.surface, border: `1px solid ${t.border}`,
      borderLeft: `3px solid ${accent}`, borderRadius: t.radiusSm,
      padding: '12px 18px', boxShadow: t.shadowLg,
      display: 'flex', alignItems: 'center', gap: '12px',
      maxWidth: '380px', minWidth: '240px',
    }}>
      <span style={{ fontSize: '13px', color: t.text, flex: 1, lineHeight: 1.5 }}>{message}</span>
      {onClose && (
        <button onClick={onClose} style={{
          background: 'none', border: 'none',
          color: t.textMuted, fontSize: '16px', padding: '0 2px', lineHeight: 1,
        }}>×</button>
      )}
    </div>
  );
}

export function EmptyState({ icon, title, subtitle }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ textAlign: 'center', padding: '56px 24px' }}>
      <div style={{ fontSize: '32px', marginBottom: '14px', opacity: 0.6 }}>{icon}</div>
      <div style={{ fontWeight: 600, color: t.textSecondary, marginBottom: '5px', fontSize: '14px' }}>{title}</div>
      {subtitle && <div style={{ fontSize: '12px', color: t.textMuted, maxWidth: '280px', margin: '0 auto', lineHeight: 1.6 }}>{subtitle}</div>}
    </div>
  );
}

export function Overlay({ children, onClose, title }) {
  const { theme: t } = useTheme();
  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: 'fixed',
        top: 0, left: 0,
        width: '100vw', height: '100vh',
        zIndex: 9999,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        overflowY: 'auto',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '40px 20px 40px',
      }}
    >
      <div
        className="fade-up"
        style={{
          width: '100%', maxWidth: '520px',
          background: t.surface,
          borderRadius: t.radius,
          border: `1px solid ${t.border}`,
          boxShadow: t.shadowLg,
          overflow: 'hidden',
          margin: 'auto 0',
        }}
      >
        {/* Accent header */}
        <div style={{
          padding: '16px 22px',
          borderBottom: `1px solid ${t.border}`,
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          background: t.surfaceAlt,
          position: 'relative',
        }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px',
            background: `linear-gradient(to bottom, ${t.accent}, ${t.accentHover})`,
          }} />
          <h3 style={{
            fontSize: '14px', fontWeight: 700, paddingLeft: '10px',
            letterSpacing: '-0.01em', color: t.text,
          }}>{title}</h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none',
            fontSize: '17px', color: t.textMuted, padding: '2px 4px', lineHeight: 1,
            borderRadius: t.radiusSm, transition: 'color 0.15s',
          }}>✕</button>
        </div>
        <div style={{ padding: '22px' }}>{children}</div>
      </div>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  const { theme: t } = useTheme();
  return (
    <div style={{
      display: 'flex', gap: '1px',
      background: t.border, borderRadius: t.radiusSm,
      padding: '1px', overflow: 'hidden',
    }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          flex: 1, padding: '6px 14px', border: 'none',
          borderRadius: '3px', fontSize: '12px',
          fontWeight: active === tab.id ? 700 : 500,
          background: active === tab.id ? t.surface : 'transparent',
          color: active === tab.id ? t.accent : t.textMuted,
          boxShadow: active === tab.id ? t.shadow : 'none',
          transition: 'all 0.15s', fontFamily: 'inherit',
        }}>{tab.label}</button>
      ))}
    </div>
  );
}
