import { useEffect } from 'react';
import { theme } from '../theme';

// ─── Button ─────────────────────────────────────────────
export function Button({ children, variant = 'primary', size = 'md', style, ...props }) {
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    border: 'none', cursor: props.disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500, borderRadius: theme.radiusSm,
    transition: 'all 0.15s ease', letterSpacing: '-0.01em', whiteSpace: 'nowrap',
    fontSize: size === 'sm' ? '13px' : '14px',
    padding: size === 'sm' ? '6px 12px' : '9px 18px',
    opacity: props.disabled ? 0.5 : 1,
  };
  const variants = {
    primary: { background: theme.accent, color: '#fff' },
    secondary: { background: theme.surfaceAlt, color: theme.text, border: `1px solid ${theme.border}` },
    danger: { background: theme.dangerLight, color: theme.danger },
    ghost: { background: 'transparent', color: theme.textSecondary },
  };
  return <button style={{ ...base, ...variants[variant], ...style }} {...props}>{children}</button>;
}

// ─── Input ──────────────────────────────────────────────
export function Input({ label, style, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {label && <label style={{ fontSize: '13px', fontWeight: 500, color: theme.textSecondary }}>{label}</label>}
      <input style={{
        padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm,
        fontSize: '14px', background: theme.surface, color: theme.text, outline: 'none',
        transition: 'border-color 0.15s', width: '100%', ...style,
      }} {...props} />
    </div>
  );
}

// ─── Select ─────────────────────────────────────────────
export function Select({ label, children, style, ...props }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {label && <label style={{ fontSize: '13px', fontWeight: 500, color: theme.textSecondary }}>{label}</label>}
      <select style={{
        padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm,
        fontSize: '14px', background: theme.surface, color: theme.text, ...style,
      }} {...props}>{children}</select>
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────
export function Card({ children, style, className = '' }) {
  return (
    <div className={className} style={{
      background: theme.surface, borderRadius: theme.radius,
      border: `1px solid ${theme.border}`, boxShadow: theme.shadow, ...style,
    }}>{children}</div>
  );
}

// ─── Badge ──────────────────────────────────────────────
export function Badge({ children, color = 'blue' }) {
  const colors = {
    blue: { bg: theme.accentLight, fg: theme.accent },
    green: { bg: theme.successLight, fg: theme.success },
    red: { bg: theme.dangerLight, fg: theme.danger },
    yellow: { bg: theme.warningLight, fg: theme.warning },
    gray: { bg: theme.surfaceAlt, fg: theme.textSecondary },
  };
  const c = colors[color] || colors.gray;
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 8px', borderRadius: '12px',
      fontSize: '11px', fontWeight: 600, background: c.bg, color: c.fg,
      letterSpacing: '0.02em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

// ─── Toast ──────────────────────────────────────────────
export function Toast({ message, type = 'info', onClose }) {
  const colors = { info: theme.accent, success: theme.success, error: theme.danger };
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, [onClose]);
  return (
    <div className="slide-in" style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      background: theme.surface, border: `1px solid ${theme.border}`, borderRadius: theme.radius,
      padding: '12px 20px', boxShadow: theme.shadowLg,
      display: 'flex', alignItems: 'center', gap: '10px',
      borderLeft: `3px solid ${colors[type]}`, maxWidth: '380px',
    }}>
      <span style={{ fontSize: '14px', color: theme.text, flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: theme.textMuted, fontSize: '16px',
      }}>×</button>
    </div>
  );
}

// ─── EmptyState ─────────────────────────────────────────
export function EmptyState({ icon, title, subtitle }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: theme.textMuted }}>
      <div style={{ fontSize: '36px', marginBottom: '12px' }}>{icon}</div>
      <div style={{ fontWeight: 600, color: theme.textSecondary, marginBottom: '4px' }}>{title}</div>
      {subtitle && <div style={{ fontSize: '13px' }}>{subtitle}</div>}
    </div>
  );
}

// ─── Overlay (Modal wrapper) ────────────────────────────
export function Overlay({ children, onClose, title }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="fade-in" style={{ width: '100%', maxWidth: '460px', padding: '28px' }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px',
        }}>
          <h3 style={{ fontSize: '17px', fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontSize: '18px', color: theme.textMuted, padding: '4px',
          }}>✕</button>
        </div>
        {children}
      </Card>
    </div>
  );
}
