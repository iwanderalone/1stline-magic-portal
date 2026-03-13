export const theme = {
  bg: '#f8f9fb',
  surface: '#ffffff',
  surfaceAlt: '#f1f3f7',
  border: '#e2e5ec',
  borderLight: '#eef0f4',
  text: '#1a1d26',
  textSecondary: '#5f6578',
  textMuted: '#9299ab',
  accent: '#2563eb',
  accentHover: '#1d4ed8',
  accentLight: '#eff4ff',
  danger: '#dc2626',
  dangerLight: '#fef2f2',
  success: '#059669',
  successLight: '#ecfdf5',
  warning: '#d97706',
  warningLight: '#fffbeb',
  shadow: '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
  shadowLg: '0 4px 12px rgba(0,0,0,0.08)',
  radius: '10px',
  radiusSm: '6px',
  font: "'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', monospace",
};

export const globalCSS = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: ${theme.font};
    background: ${theme.bg};
    color: ${theme.text};
    -webkit-font-smoothing: antialiased;
  }
  input, button, select, textarea { font-family: inherit; }
  ::selection { background: ${theme.accentLight}; color: ${theme.accent}; }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(12px); }
    to { opacity: 1; transform: translateX(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  .fade-in { animation: fadeIn 0.35s ease-out; }
  .slide-in { animation: slideIn 0.3s ease-out; }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${theme.border}; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: ${theme.textMuted}; }

  /* Mobile-first responsive */
  @media (max-width: 768px) {
    .desktop-only { display: none !important; }
    .sidebar-fixed { position: fixed !important; }
  }
  @media (min-width: 769px) {
    .mobile-only { display: none !important; }
    .sidebar-fixed { position: sticky !important; left: 0 !important; }
  }
`;
