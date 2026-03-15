import { useEffect } from 'react';
import { useTheme } from './ThemeContext';

export function Button({ children, variant = 'primary', size = 'md', style, ...props }) {
  const { theme: t } = useTheme();
  const base = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    border: 'none', cursor: props.disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500, borderRadius: t.radiusSm, transition: 'all 0.15s ease',
    letterSpacing: '-0.01em', whiteSpace: 'nowrap',
    fontSize: size === 'sm' ? '13px' : '14px',
    padding: size === 'sm' ? '6px 12px' : '9px 18px',
    opacity: props.disabled ? 0.5 : 1,
  };
  const v = {
    primary: { background: t.accent, color: '#fff' },
    secondary: { background: t.surfaceAlt, color: t.text, border: `1px solid ${t.border}` },
    danger: { background: t.dangerLight, color: t.danger },
    ghost: { background: 'transparent', color: t.textSecondary },
  };
  return <button style={{ ...base, ...v[variant], ...style }} {...props}>{children}</button>;
}

export function Input({ label, style, ...props }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {label && <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary }}>{label}</label>}
      <input style={{
        padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: t.radiusSm,
        fontSize: '14px', background: t.surface, color: t.text, outline: 'none',
        transition: 'border-color 0.15s', width: '100%', ...style,
      }} {...props} />
    </div>
  );
}

export function Select({ label, children, style, ...props }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {label && <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary }}>{label}</label>}
      <select style={{
        padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: t.radiusSm,
        fontSize: '14px', background: t.surface, color: t.text, ...style,
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
    blue: { bg: t.accentLight, fg: t.accent },
    green: { bg: t.successLight, fg: t.success },
    red: { bg: t.dangerLight, fg: t.danger },
    yellow: { bg: t.warningLight, fg: t.warning },
    gray: { bg: t.surfaceAlt, fg: t.textSecondary },
  }[color] || { bg: t.surfaceAlt, fg: t.textSecondary };
  return (
    <span style={{
      display: 'inline-flex', padding: '2px 8px', borderRadius: '12px',
      fontSize: '11px', fontWeight: 600, background: c.bg, color: c.fg,
      letterSpacing: '0.02em', textTransform: 'uppercase',
    }}>{children}</span>
  );
}

export function Toast({ message, type = 'info', onClose }) {
  const { theme: t } = useTheme();
  const colors = { info: t.accent, success: t.success, error: t.danger };
  useEffect(() => { const tm = setTimeout(onClose, 3500); return () => clearTimeout(tm); }, [onClose]);
  return (
    <div className="slide-in" style={{
      position: 'fixed', bottom: '24px', right: '24px', zIndex: 9999,
      background: t.surface, border: `1px solid ${t.border}`, borderRadius: t.radius,
      padding: '12px 20px', boxShadow: t.shadowLg, display: 'flex', alignItems: 'center', gap: '10px',
      borderLeft: `3px solid ${colors[type]}`, maxWidth: '380px',
    }}>
      <span style={{ fontSize: '14px', color: t.text, flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: '16px' }}>×</button>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px', color: t.textMuted }}>
      <div style={{ fontSize: '36px', marginBottom: '12px' }}>{icon}</div>
      <div style={{ fontWeight: 600, color: t.textSecondary, marginBottom: '4px' }}>{title}</div>
      {subtitle && <div style={{ fontSize: '13px' }}>{subtitle}</div>}
    </div>
  );
}

export function Overlay({ children, onClose, title }) {
  const { theme: t } = useTheme();
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <Card className="fade-in" style={{ width: '100%', maxWidth: '500px', padding: '28px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: 700 }}>{title}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: t.textMuted, padding: '4px' }}>✕</button>
        </div>
        {children}
      </Card>
    </div>
  );
}

export function Tabs({ tabs, active, onChange }) {
  const { theme: t } = useTheme();
  return (
    <div style={{ display: 'flex', gap: '2px', background: t.surfaceAlt, borderRadius: t.radiusSm, padding: '3px' }}>
      {tabs.map(tab => (
        <button key={tab.id} onClick={() => onChange(tab.id)} style={{
          padding: '7px 14px', border: 'none', borderRadius: '4px', fontSize: '13px', fontWeight: 500,
          cursor: 'pointer', transition: 'all 0.15s',
          background: active === tab.id ? t.surface : 'transparent',
          color: active === tab.id ? t.text : t.textMuted,
          boxShadow: active === tab.id ? t.shadow : 'none',
        }}>{tab.label}</button>
      ))}
    </div>
  );
}
