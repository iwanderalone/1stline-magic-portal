export const lightTheme = {
  bg: '#f0f3f9',
  surface: '#ffffff',
  surfaceAlt: '#f5f7fd',
  surfaceElevated: '#fafbfe',
  border: '#d8dff0',
  borderLight: '#eaecf8',
  text: '#0f1523',
  textSecondary: '#4a5578',
  textMuted: '#8a96b8',
  accent: '#2563eb',
  accentHover: '#1d4ed8',
  accentLight: 'rgba(37,99,235,0.10)',
  accentGlow: 'rgba(37,99,235,0.18)',
  danger: '#dc2626',
  dangerLight: 'rgba(220,38,38,0.10)',
  success: '#059669',
  successLight: 'rgba(5,150,105,0.10)',
  warning: '#d97706',
  warningLight: 'rgba(217,119,6,0.10)',
  shadow: '0 1px 3px rgba(15,21,35,0.07), 0 0 0 1px rgba(15,21,35,0.04)',
  shadowLg: '0 8px 28px rgba(15,21,35,0.12)',
  radius: '8px',
  radiusSm: '4px',
};

export const darkTheme = {
  bg: '#07090f',
  surface: '#0c1020',
  surfaceAlt: '#111726',
  surfaceElevated: '#161d2e',
  border: '#1c2640',
  borderLight: '#152035',
  text: '#dde5f5',
  textSecondary: '#7d8fb0',
  textMuted: '#445070',
  accent: '#4f9eff',
  accentHover: '#75b8ff',
  accentLight: 'rgba(79,158,255,0.12)',
  accentGlow: 'rgba(79,158,255,0.22)',
  danger: '#f85149',
  dangerLight: 'rgba(248,81,73,0.13)',
  success: '#3fb950',
  successLight: 'rgba(63,185,80,0.12)',
  warning: '#f0a830',
  warningLight: 'rgba(240,168,48,0.12)',
  shadow: '0 1px 4px rgba(0,0,0,0.55)',
  shadowLg: '0 8px 36px rgba(0,0,0,0.65)',
  radius: '8px',
  radiusSm: '4px',
};

export const shared = {
  radius: '8px',
  radiusSm: '4px',
  font: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontMono: "'JetBrains Mono', 'SF Mono', Consolas, monospace",
};

export function getGlobalCSS(t) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300..900;1,14..32,300..700&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: ${t.bg};
      --surface: ${t.surface};
      --surface-alt: ${t.surfaceAlt};
      --surface-elevated: ${t.surfaceElevated || t.surfaceAlt};
      --border: ${t.border};
      --border-light: ${t.borderLight};
      --text: ${t.text};
      --text-secondary: ${t.textSecondary};
      --text-muted: ${t.textMuted};
      --accent: ${t.accent};
      --accent-hover: ${t.accentHover};
      --accent-light: ${t.accentLight};
      --accent-glow: ${t.accentGlow};
      --danger: ${t.danger};
      --danger-light: ${t.dangerLight};
      --success: ${t.success};
      --success-light: ${t.successLight};
      --warning: ${t.warning};
      --warning-light: ${t.warningLight};
      --shadow: ${t.shadow};
      --shadow-lg: ${t.shadowLg};
      --radius: ${t.radius};
      --radius-sm: ${t.radiusSm};
      --font: ${shared.font};
      --font-mono: ${shared.fontMono};
    }

    html, body { height: 100%; }

    body {
      font-family: var(--font);
      background: var(--bg);
      color: var(--text);
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      font-feature-settings: 'kern' 1, 'liga' 1, 'calt' 1;
      transition: background 0.25s ease, color 0.25s ease;
      font-size: 14px;
      line-height: 1.5;
    }
    input, button, select, textarea { font-family: inherit; }
    ::selection { background: var(--accent-light); color: var(--accent); }

    /* ── Buttons ────────────────────────────────────────────── */
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      border: none; font-family: var(--font); font-weight: 500;
      border-radius: var(--radius-sm);
      transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
      letter-spacing: -0.01em; white-space: nowrap; position: relative;
      -webkit-user-select: none; user-select: none; cursor: pointer;
    }
    .btn:disabled { opacity: 0.4; pointer-events: none; }
    .btn-primary { background: var(--accent); color: #fff; }
    .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
    .btn-secondary { background: var(--surface-alt); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
    .btn-danger { background: var(--danger-light); color: var(--danger); }
    .btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
    .btn-ghost { background: transparent; color: var(--text-secondary); }
    .btn-ghost:hover:not(:disabled) { background: var(--surface-alt); color: var(--text); }
    .btn-sm { font-size: 12px; padding: 5px 10px; }
    .btn-md { font-size: 13px; padding: 8px 16px; }

    /* ── Nav items ──────────────────────────────────────────── */
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 8px 10px; border: none;
      border-radius: var(--radius-sm); font-size: 13px;
      font-weight: 450; position: relative; font-family: var(--font);
      overflow: hidden; transition: all 0.16s ease; cursor: pointer;
    }
    .nav-item::before {
      content: ''; position: absolute; left: 0; top: 20%; bottom: 20%;
      width: 2.5px; background: var(--accent); border-radius: 0 2px 2px 0;
      transform: scaleY(0);
      transition: transform 0.2s cubic-bezier(0.4,0,0.2,1);
    }
    .nav-item.active::before { transform: scaleY(1); }
    .nav-item.active { font-weight: 600; }
    .nav-item:not(.active):hover { background: var(--surface-alt) !important; color: var(--text) !important; }

    /* ── Toggle pill ────────────────────────────────────────── */
    .toggle-pill {
      border: none; border-radius: 20px; padding: 2px 10px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
      transition: all 0.18s ease; font-family: var(--font); cursor: pointer;
    }
    .toggle-on  { background: var(--success); color: #fff; }
    .toggle-off { background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }
    .toggle-on:hover:not(:disabled)  { opacity: 0.82; }
    .toggle-off:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

    /* ── Table rows ─────────────────────────────────────────── */
    tbody tr { transition: background 0.12s ease; }
    tbody tr:hover { background: var(--surface-alt) !important; }

    /* ── Scrollbar ──────────────────────────────────────────── */
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: var(--accent); }

    /* ── Focus ring ─────────────────────────────────────────── */
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent) !important;
      box-shadow: 0 0 0 3px var(--accent-glow) !important;
    }

    /* ── Responsive ─────────────────────────────────────────── */
    @media (max-width: 767px) {
      .desktop-only { display: none !important; }
    }
    @media (min-width: 768px) {
      .mobile-only { display: none !important; }
    }

    /* ── Misc ───────────────────────────────────────────────── */
    input[type=checkbox] { accent-color: var(--accent); width: 14px; height: 14px; }
    code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--surface-alt);
      border: 1px solid var(--border);
      border-radius: 3px;
      padding: 1px 5px;
    }
  `;
}
