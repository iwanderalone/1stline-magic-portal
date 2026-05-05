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
  message: (
    <path d="M2 3h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5l-3 2V4a1 1 0 0 1 1-1z" />
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
