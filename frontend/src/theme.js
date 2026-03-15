export const lightTheme = {
  bg: '#f8f9fb', surface: '#ffffff', surfaceAlt: '#f1f3f7',
  border: '#e2e5ec', borderLight: '#eef0f4',
  text: '#1a1d26', textSecondary: '#5f6578', textMuted: '#9299ab',
  accent: '#2563eb', accentHover: '#1d4ed8', accentLight: '#eff4ff',
  danger: '#dc2626', dangerLight: '#fef2f2',
  success: '#059669', successLight: '#ecfdf5',
  warning: '#d97706', warningLight: '#fffbeb',
  shadow: '0 1px 3px rgba(0,0,0,0.06)', shadowLg: '0 4px 12px rgba(0,0,0,0.08)',
};

export const darkTheme = {
  bg: '#0f1117', surface: '#1a1d28', surfaceAlt: '#222532',
  border: '#2e3244', borderLight: '#262938',
  text: '#e8eaf0', textSecondary: '#a0a6b8', textMuted: '#6b7280',
  accent: '#3b82f6', accentHover: '#60a5fa', accentLight: 'rgba(59,130,246,0.12)',
  danger: '#ef4444', dangerLight: 'rgba(239,68,68,0.12)',
  success: '#10b981', successLight: 'rgba(16,185,129,0.12)',
  warning: '#f59e0b', warningLight: 'rgba(245,158,11,0.12)',
  shadow: '0 1px 3px rgba(0,0,0,0.3)', shadowLg: '0 4px 12px rgba(0,0,0,0.4)',
};

export const shared = {
  radius: '10px', radiusSm: '6px',
  font: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
};

export function getGlobalCSS(t) {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: ${shared.font}; background: ${t.bg}; color: ${t.text}; -webkit-font-smoothing: antialiased; transition: background 0.2s, color 0.2s; }
    input, button, select, textarea { font-family: inherit; }
    ::selection { background: ${t.accentLight}; color: ${t.accent}; }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes slideIn { from { opacity: 0; transform: translateX(12px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    .fade-in { animation: fadeIn 0.3s ease-out; }
    .slide-in { animation: slideIn 0.25s ease-out; }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: ${t.border}; border-radius: 3px; }
    @media (max-width: 768px) { .desktop-only { display: none !important; } .sidebar-fixed { position: fixed !important; } }
    @media (min-width: 769px) { .mobile-only { display: none !important; } .sidebar-fixed { position: sticky !important; left: 0 !important; } }
  `;
}
