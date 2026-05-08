// Stroke-based SVG icons, 18×18, stroke-width 1.75
// Usage: <Icon name="user" size={18} color="currentColor" />

const PATHS = {
  user: (
    <>
      <circle cx="9" cy="6" r="3.5" />
      <path d="M2 18c0-3.866 3.134-7 7-7s7 3.134 7 7" strokeLinecap="round" />
    </>
  ),
  calendar: (
    <>
      <rect x="2" y="4" width="14" height="13" rx="2" />
      <path d="M6 2v4M12 2v4M2 9h14" strokeLinecap="round" />
    </>
  ),
  mail: (
    <>
      <rect x="2" y="5" width="14" height="11" rx="2" />
      <path d="M2 5l7 6 7-6" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  sun: (
    <>
      <circle cx="9" cy="9" r="3.5" />
      <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.22 3.22l1.42 1.42M13.36 13.36l1.42 1.42M3.22 14.78l1.42-1.42M13.36 4.64l1.42-1.42" strokeLinecap="round" />
    </>
  ),
  bell: (
    <>
      <path d="M9 2a5 5 0 0 1 5 5v3l1.5 2.5H2.5L4 10V7a5 5 0 0 1 5-5z" />
      <path d="M7 15a2 2 0 0 0 4 0" strokeLinecap="round" />
    </>
  ),
  server: (
    <>
      <rect x="2" y="3" width="14" height="4" rx="1" />
      <rect x="2" y="10" width="14" height="4" rx="1" />
      <circle cx="13.5" cy="5" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="12" r="0.75" fill="currentColor" stroke="none" />
    </>
  ),
  settings: (
    <>
      <circle cx="9" cy="9" r="2.5" />
      <path d="M9 1v2M9 15v2M1 9h2M15 9h2M3.05 3.05l1.41 1.41M13.54 13.54l1.41 1.41M3.05 14.95l1.41-1.41M13.54 4.46l1.41-1.41" strokeLinecap="round" />
    </>
  ),
  moon: (
    <path d="M13.5 10.5A6 6 0 0 1 5.5 3.5a6.5 6.5 0 1 0 8 7z" strokeLinecap="round" strokeLinejoin="round" />
  ),
  logout: (
    <>
      <path d="M10 2H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h6" strokeLinecap="round" />
      <path d="M13 12l3-3-3-3M16 9H7" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  menu: (
    <path d="M2 4h14M2 9h14M2 14h14" strokeLinecap="round" />
  ),
  chevronLeft: (
    <path d="M11 14L5 9l6-5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  chevronRight: (
    <path d="M6 4l6 5-6 5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  chevronDown: (
    <path d="M4 6.5l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
  ),
  message: (
    <path d="M2 3h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z" />
  ),
  workspace: (
    <>
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="10" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="10" width="6" height="6" rx="1" />
      <rect x="10" y="10" width="6" height="6" rx="1" />
    </>
  ),
  grid: (
    <>
      <rect x="2" y="2" width="6" height="6" rx="1" />
      <rect x="10" y="2" width="6" height="6" rx="1" />
      <rect x="2" y="10" width="6" height="6" rx="1" />
      <rect x="10" y="10" width="6" height="6" rx="1" />
    </>
  ),
  ticket: (
    <>
      <path d="M2 6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V6z" />
    </>
  ),
  zap: (
    <path d="M13 2L4.5 9.5H9l-2 6.5L16 8h-4.5L13 2z" strokeLinejoin="round" />
  ),
  flame: (
    <path d="M9 2c0 3-3 4-3 7a3 3 0 0 0 6 0c0-1-.5-2-1-2.5.5 1.5-1 2-1 2C10 6 12 4 9 2z" strokeLinejoin="round" />
  ),
  hash: (
    <path d="M4 8h10M4 12h10M7 4l-1 10M11 4l-1 10" strokeLinecap="round" />
  ),
  send: (
    <path d="M2 9l14-7-7 14-2-5-5-2z" strokeLinejoin="round" strokeLinecap="round" />
  ),
  refresh: (
    <>
      <path d="M3 12a6 6 0 0 1 10.4-4" strokeLinecap="round" />
      <path d="M13 8l1-4-4 1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 6a6 6 0 0 1-10.4 4" strokeLinecap="round" />
      <path d="M5 10l-1 4 4-1" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  checkCircle: (
    <>
      <circle cx="9" cy="9" r="7" />
      <path d="M6 9l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  alertTriangle: (
    <>
      <path d="M9 2L1.5 15.5h15L9 2z" strokeLinejoin="round" />
      <path d="M9 7v4M9 13.5h.01" strokeLinecap="round" />
    </>
  ),
  clock: (
    <>
      <circle cx="9" cy="9" r="7" />
      <path d="M9 5v4l2.5 2.5" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  arrowRight: (
    <path d="M3 9h12M11 5l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
  ),
  arrowUpDown: (
    <path d="M5 7l3-3 3 3M5 11l3 3 3-3M8 4v10" strokeLinecap="round" strokeLinejoin="round" />
  ),
  moreHorizontal: (
    <>
      <circle cx="4"  cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9"  cy="9" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="14" cy="9" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  bookmark: (
    <path d="M4 2h10a1 1 0 0 1 1 1v13l-6-3.5L4 16V3a1 1 0 0 1 0-1z" strokeLinejoin="round" />
  ),
  externalLink: (
    <>
      <path d="M10 3H3v12h12V8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 10L15 3M11 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  paperclip: (
    <path d="M14 8l-6 6a3 3 0 0 1-4-4l7-7a2 2 0 0 1 3 3l-7 7a1 1 0 0 1-1-1l6-6" strokeLinecap="round" strokeLinejoin="round" />
  ),
  thumbsUp: (
    <>
      <path d="M7 10V17H4a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h3z" />
      <path d="M7 10l3-7a2 2 0 0 1 2 2V8h3a1 1 0 0 1 1 1.09l-.84 5.6A1 1 0 0 1 14.18 15H7" strokeLinejoin="round" />
    </>
  ),
  thumbsDown: (
    <>
      <path d="M11 8V1H14a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-3z" />
      <path d="M11 8L8 15a2 2 0 0 1-2-2V10H3a1 1 0 0 1-1-1.09l.84-5.6A1 1 0 0 1 3.82 3H11" strokeLinejoin="round" />
    </>
  ),
  play: (
    <path d="M5 3l11 6-11 6V3z" strokeLinejoin="round" />
  ),
  copy: (
    <>
      <rect x="6" y="6" width="9" height="9" rx="1" />
      <path d="M12 6V4a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2" strokeLinecap="round" />
    </>
  ),
  edit: (
    <>
      <path d="M11 2.5l3.5 3.5-9.5 9.5H2V12l9.5-9.5z" />
      <path d="M9.5 4l3.5 3.5" strokeLinecap="round" />
    </>
  ),
  trash: (
    <>
      <path d="M2 4h14M6 4V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 4v11a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V4M7 8v5M11 8v5" strokeLinecap="round" />
    </>
  ),
  star: (
    <path d="M9 2l1.9 5.8H17l-5 3.6 1.9 5.8L9 13.6l-4.9 3.6 1.9-5.8-5-3.6h6.1L9 2z" strokeLinejoin="round" />
  ),
  leaf: (
    <path d="M2 14s2-8 10-10c0 4-2 8-8 10M2 14c2-1 4-2 6-3" strokeLinecap="round" strokeLinejoin="round" />
  ),
  shield: (
    <path d="M9 2L3 5v5c0 4 2.7 7.3 6 8 3.3-.7 6-4 6-8V5L9 2z" strokeLinejoin="round" />
  ),
  siren: (
    <>
      <path d="M9 3a5 5 0 0 1 5 5v2H4V8a5 5 0 0 1 5-5z" />
      <rect x="3" y="10" width="12" height="3" rx="1" />
      <path d="M9 1V0M2.5 4.5L1.8 3.8M15.5 4.5l.7-.7" strokeLinecap="round" />
    </>
  ),
  key: (
    <>
      <circle cx="6.5" cy="11.5" r="3.5" />
      <path d="M10 8l7 7M15 8l2 2" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  plus: (
    <path d="M9 3v12M3 9h12" strokeLinecap="round" />
  ),
  x: (
    <path d="M3 3l12 12M15 3L3 15" strokeLinecap="round" />
  ),
  check: (
    <path d="M2.5 9l4 4 9-9" strokeLinecap="round" strokeLinejoin="round" />
  ),
  info: (
    <>
      <circle cx="9" cy="9" r="7" />
      <path d="M9 8v4M9 6h.01" strokeLinecap="round" />
    </>
  ),
  search: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M13 13l3 3" strokeLinecap="round" />
    </>
  ),
  inbox: (
    <>
      <path d="M15 10H11a2 2 0 0 0-4 0H3" strokeLinecap="round" />
      <path d="M2.5 10l1.5-6h10l1.5 6M16 10v4a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-4" strokeLinejoin="round" />
    </>
  ),
  archive: (
    <>
      <path d="M15 5H3v3h12V5z" strokeLinejoin="round" />
      <path d="M14 8v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8" strokeLinejoin="round" />
      <path d="M8 11h2" strokeLinecap="round" />
    </>
  ),
};

export function Icon({ name, size = 18, color = 'currentColor', style }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 18 18"
      fill="none"
      stroke={color}
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      {paths}
    </svg>
  );
}
