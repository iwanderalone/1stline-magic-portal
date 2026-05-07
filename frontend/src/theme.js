export const lightTheme = {
  // Surfaces (4-layer hierarchy)
  bg:               '#f8f9fa',
  surface:          '#ffffff',
  surfaceAlt:       '#f1f3f4',
  surfaceElevated:  '#ffffff',
  surfaceSunken:    '#e8eaed',

  // Borders
  border:           '#e0e3e7',
  borderStrong:     '#c4c8cf',
  borderLight:      '#eef0f3',

  // Text
  text:             '#1f1f1f',
  textSecondary:    '#5f6368',
  textMuted:        '#80868b',

  // Accent — Google blue
  accent:           '#1a73e8',
  accentHover:      '#1967d2',
  accentActive:     '#185abc',
  accentLight:      'rgba(26,115,232,0.08)',
  accentGlow:       'rgba(26,115,232,0.20)',
  accentOn:         '#ffffff',

  // Semantic
  danger:           '#d93025',
  dangerLight:      'rgba(217,48,37,0.08)',
  success:          '#188038',
  successLight:     'rgba(24,128,56,0.08)',
  warning:          '#b06000',
  warningLight:     'rgba(176,96,0,0.08)',

  // Shadows
  shadowXs: '0 1px 2px rgba(15,17,21,0.04)',
  shadow:   '0 1px 2px rgba(15,17,21,0.06), 0 0 0 1px rgba(15,17,21,0.04)',
  shadowMd: '0 2px 6px rgba(15,17,21,0.08), 0 0 0 1px rgba(15,17,21,0.04)',
  shadowLg: '0 8px 24px rgba(15,17,21,0.12)',

  // Radii
  radius:     '8px',
  radiusSm:   '6px',
  radiusXs:   '4px',
  radiusLg:   '12px',
  radiusPill: '999px',
};

export const darkTheme = {
  bg:               '#1c2030',
  surface:          '#252a3a',
  surfaceAlt:       '#2d3346',
  surfaceElevated:  '#313851',
  surfaceSunken:    '#171a26',

  border:           '#383f56',
  borderStrong:     '#4a5170',
  borderLight:      '#2d3346',

  text:             '#e8eaed',
  textSecondary:    '#9aa0a6',
  textMuted:        '#5f6368',

  accent:           '#8ab4f8',
  accentHover:      '#aecbfa',
  accentActive:     '#d2e3fc',
  accentLight:      'rgba(138,180,248,0.12)',
  accentGlow:       'rgba(138,180,248,0.24)',
  accentOn:         '#062a5b',

  danger:           '#f28b82',
  dangerLight:      'rgba(242,139,130,0.12)',
  success:          '#81c995',
  successLight:     'rgba(129,201,149,0.12)',
  warning:          '#fdd663',
  warningLight:     'rgba(253,214,99,0.12)',

  shadowXs: '0 1px 2px rgba(0,0,0,0.45)',
  shadow:   '0 1px 3px rgba(0,0,0,0.55)',
  shadowMd: '0 4px 12px rgba(0,0,0,0.55)',
  shadowLg: '0 12px 36px rgba(0,0,0,0.65)',

  radius:     '8px',
  radiusSm:   '6px',
  radiusXs:   '4px',
  radiusLg:   '12px',
  radiusPill: '999px',
};

export const shared = {
  fontSans:    "'Inter', -apple-system, 'Segoe UI', Roboto, sans-serif",
  fontDisplay: "'Source Serif 4', 'Charter', Georgia, serif",
  fontMono:    "'JetBrains Mono', 'Roboto Mono', 'SF Mono', Consolas, monospace",
};

export function getGlobalCSS(t) {
  return `
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500&display=swap');

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:               ${t.bg};
      --surface:          ${t.surface};
      --surface-alt:      ${t.surfaceAlt};
      --surface-elevated: ${t.surfaceElevated};
      --surface-sunken:   ${t.surfaceSunken};

      --border:           ${t.border};
      --border-strong:    ${t.borderStrong};
      --border-light:     ${t.borderLight};

      --text:             ${t.text};
      --text-secondary:   ${t.textSecondary};
      --text-muted:       ${t.textMuted};

      --accent:           ${t.accent};
      --accent-hover:     ${t.accentHover};
      --accent-active:    ${t.accentActive};
      --accent-light:     ${t.accentLight};
      --accent-glow:      ${t.accentGlow};
      --accent-on:        ${t.accentOn};

      --danger:           ${t.danger};
      --danger-light:     ${t.dangerLight};
      --success:          ${t.success};
      --success-light:    ${t.successLight};
      --warning:          ${t.warning};
      --warning-light:    ${t.warningLight};

      --shadow-xs: ${t.shadowXs};
      --shadow:    ${t.shadow};
      --shadow-md: ${t.shadowMd};
      --shadow-lg: ${t.shadowLg};

      --radius:      ${t.radius};
      --radius-sm:   ${t.radiusSm};
      --radius-xs:   ${t.radiusXs};
      --radius-lg:   ${t.radiusLg};
      --radius-pill: ${t.radiusPill};

      --font-sans:    ${shared.fontSans};
      --font-display: ${shared.fontDisplay};
      --font-mono:    ${shared.fontMono};
      --font:         var(--font-sans);

      --fs-eyebrow:  11px;
      --fs-label:    12px;
      --fs-body-sm:  13px;
      --fs-body:     14px;
      --fs-body-lg:  15px;
      --fs-h4:       16px;
      --fs-h3:       18px;
      --fs-h2:       24px;
      --fs-h1:       32px;

      --ease-entry: cubic-bezier(0.16, 1, 0.3, 1);
      --ease-state: cubic-bezier(0.4, 0, 0.2, 1);
      --dur-fast:   120ms;
      --dur-base:   180ms;
    }

    html, body { height: 100%; }
    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      font-size: var(--fs-body);
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    input, button, select, textarea { font-family: inherit; }
    ::selection { background: var(--accent-light); color: var(--accent); }

    /* ── Type utility classes ───────────────────────────────── */
    .t-eyebrow {
      font-size: var(--fs-eyebrow); font-weight: 600;
      color: var(--text-muted); text-transform: uppercase;
      letter-spacing: 0.08em; font-family: var(--font-sans);
    }
    .t-label {
      font-size: var(--fs-label); font-weight: 600;
      color: var(--text-secondary); font-family: var(--font-sans);
    }
    .t-body-sm {
      font-size: var(--fs-body-sm); color: var(--text-secondary);
      line-height: 1.55; font-family: var(--font-sans);
    }
    .t-muted {
      font-size: var(--fs-body-sm); color: var(--text-muted);
      line-height: 1.55; font-family: var(--font-sans);
    }
    .t-mono {
      font-family: var(--font-mono); font-size: var(--fs-body-sm);
      color: var(--text);
    }
    .t-code {
      font-family: var(--font-mono); font-size: 0.88em;
      background: var(--surface-alt); border: 1px solid var(--border);
      border-radius: var(--radius-xs); padding: 1px 6px; color: var(--text);
    }
    .t-h3 {
      font-family: var(--font-sans); font-size: var(--fs-h3);
      font-weight: 600; letter-spacing: -0.01em;
      line-height: 1.25; color: var(--text);
    }
    .t-h2 {
      font-family: var(--font-sans); font-size: var(--fs-h2);
      font-weight: 600; letter-spacing: -0.015em;
      line-height: 1.25; color: var(--text);
    }

    /* ── Buttons ────────────────────────────────────────────── */
    .btn {
      display: inline-flex; align-items: center; justify-content: center; gap: 6px;
      border: none; font-family: var(--font-sans); font-weight: 500;
      border-radius: var(--radius-sm); white-space: nowrap;
      position: relative; cursor: pointer; transition: all var(--dur-fast) var(--ease-state);
      letter-spacing: -0.01em;
    }
    .btn:disabled { opacity: 0.4; pointer-events: none; }
    .btn-primary {
      background: var(--accent); color: var(--accent-on);
      box-shadow: 0 1px 2px var(--accent-glow);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
      transform: translateY(-1px);
      box-shadow: 0 2px 8px var(--accent-glow);
    }
    .btn-primary:active:not(:disabled) { transform: translateY(0); }
    .btn-secondary {
      background: var(--surface); color: var(--text);
      border: 1px solid var(--border); box-shadow: var(--shadow-xs);
    }
    .btn-secondary:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); background: var(--surface-alt); }
    .btn-danger { background: var(--danger-light); color: var(--danger); border: 1px solid transparent; }
    .btn-danger:hover:not(:disabled) { background: var(--danger); color: #fff; }
    .btn-ghost { background: transparent; color: var(--text-secondary); border: 1px solid transparent; }
    .btn-ghost:hover:not(:disabled) { background: var(--surface-alt); color: var(--text); }
    .btn-sm  { font-size: 12px; padding: 4px 10px; gap: 5px; }
    .btn-md  { font-size: 13px; padding: 7px 14px; gap: 7px; }
    .btn-lg  { font-size: 14px; padding: 10px 18px; gap: 8px; }
    .btn-icon { padding: 6px; border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-sm); }
    .btn-icon:hover:not(:disabled) { background: var(--surface-alt); }

    /* ── Nav items ──────────────────────────────────────────── */
    .nav-item {
      display: flex; align-items: center; gap: 10px;
      width: 100%; padding: 7px 10px 7px 14px; border: none;
      border-radius: var(--radius-sm); font-size: 13px;
      font-weight: 500; position: relative; font-family: var(--font-sans);
      transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
      cursor: pointer; text-align: left;
    }
    .nav-item.active {
      background: var(--accent-light); color: var(--accent); font-weight: 600;
    }
    .nav-item.active::before {
      content: ''; position: absolute; left: 0; top: 6px; bottom: 6px;
      width: 3px; background: var(--accent); border-radius: 0 3px 3px 0;
    }
    .nav-item:not(.active):hover { background: var(--surface-alt); color: var(--text); }

    /* ── Language pill ──────────────────────────────────────── */
    .lang-pill-wrap {
      display: flex; gap: 1px; background: var(--surface-sunken);
      padding: 2px; border-radius: 6px;
    }
    .lang-pill {
      border: none; padding: 4px 9px; border-radius: 4px;
      font-size: 11px; font-weight: 700; cursor: pointer;
      font-family: var(--font-sans); transition: all var(--dur-fast) ease;
    }
    .lang-pill.active {
      background: var(--surface); color: var(--text); box-shadow: var(--shadow-xs);
    }
    .lang-pill:not(.active) { background: transparent; color: var(--text-muted); }

    /* ── Toggle pill (enabled/disabled) ────────────────────── */
    .toggle-pill {
      border: none; border-radius: 20px; padding: 2px 10px;
      font-size: 11px; font-weight: 700; letter-spacing: 0.03em;
      transition: all var(--dur-base) ease; font-family: var(--font-sans); cursor: pointer;
    }
    .toggle-on  { background: var(--success); color: #fff; }
    .toggle-off { background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }
    .toggle-on:hover:not(:disabled)  { opacity: 0.82; }
    .toggle-off:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }

    /* ── Table rows ─────────────────────────────────────────── */
    tbody tr { transition: background var(--dur-fast) ease; }
    tbody tr:hover { background: var(--surface-alt) !important; }

    /* ── Scrollbars ─────────────────────────────────────────── */
    *::-webkit-scrollbar { width: 8px; height: 8px; }
    *::-webkit-scrollbar-thumb {
      background: var(--border-strong); border-radius: 999px;
      border: 2px solid var(--bg);
    }
    *::-webkit-scrollbar-thumb:hover { background: var(--text-muted); }
    *::-webkit-scrollbar-track { background: transparent; }

    /* ── Focus ring ─────────────────────────────────────────── */
    button:focus-visible, a:focus-visible, input:focus-visible,
    select:focus-visible, textarea:focus-visible {
      outline: none;
      box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--accent) !important;
      box-shadow: 0 0 0 3px var(--accent-glow) !important;
    }

    /* ── Animations ─────────────────────────────────────────── */
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(6px); }
      to   { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeIn {
      from { opacity: 0; } to { opacity: 1; }
    }
    @keyframes dotPulse {
      0%, 100% { opacity: 0.55; } 50% { opacity: 1; }
    }
    @keyframes shimmer {
      0%   { background-position: -400px 0; }
      100% { background-position:  400px 0; }
    }
    .fade-up  { animation: fadeUp  280ms var(--ease-entry) both; }
    .fade-in  { animation: fadeIn  200ms var(--ease-entry) both; }
    .dot-pulse { animation: dotPulse 1.8s ease-in-out infinite; }

    /* ── Misc ───────────────────────────────────────────────── */
    code {
      font-family: var(--font-mono); font-size: 0.85em;
      background: var(--surface-alt); border: 1px solid var(--border);
      border-radius: var(--radius-xs); padding: 1px 5px;
    }
    input[type=checkbox] { accent-color: var(--accent); width: 14px; height: 14px; }

    /* ── Responsive ─────────────────────────────────────────── */
    @media (max-width: 767px)  { .desktop-only { display: none !important; } }
    @media (min-width: 768px)  { .mobile-only  { display: none !important; } }
  `;
}
