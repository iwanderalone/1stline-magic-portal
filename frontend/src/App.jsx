import { useState, useEffect, useRef } from 'react';
import { getTokens, clearTokens, api } from './api';
import { getGlobalCSS } from './theme';
import { useTheme } from './components/ThemeContext';
import { useLang } from './components/LangContext';
import { Button } from './components/UI';
import LoginPage from './pages/LoginPage';
import SchedulePage from './pages/SchedulePage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import MailReporterPage from './pages/MailReporterPage';
import TimeOffPage from './pages/TimeOffPage';
import RemindersPage from './pages/RemindersPage';
import ContainersPage from './pages/ContainersPage';
import NotificationsPanel from './components/NotificationsPanel';

// ─── Triangular SVG cursor ───────────────────────────────────────────────────

function CustomCursor() {
  const { theme: t } = useTheme();
  const elRef = useRef(null);
  const [state, setState] = useState('default'); // 'default' | 'hover' | 'click'

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;

    const onMove = (e) => {
      el.style.left = e.clientX + 'px';
      el.style.top  = e.clientY + 'px';
    };
    const isInteractive = (e) =>
      !!e.target.closest('button, a, input, select, textarea, label, [role="button"]');
    const onOver  = (e) => setState(isInteractive(e) ? 'hover' : 'default');
    const onDown  = () => setState('click');
    const onUp    = (e) => setState(isInteractive(e) ? 'hover' : 'default');

    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('mouseover', onOver);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup',   onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseover', onOver);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup',   onUp);
    };
  }, []);

  const scale   = state === 'click' ? 0.78 : state === 'hover' ? 1.15 : 1;
  const opacity = state === 'click' ? 0.7  : 1;

  return (
    <div
      ref={elRef}
      style={{
        position: 'fixed', top: -60, left: -60,
        zIndex: 99999, pointerEvents: 'none',
        transform: `scale(${scale})`,
        transformOrigin: '0.5px 0.5px',
        transition: 'transform 0.13s cubic-bezier(0.4,0,0.2,1), opacity 0.1s ease',
        opacity,
      }}
    >
      {/* Clean triangle cursor — tip at (0.5, 0.5) */}
      <svg width="11" height="13" viewBox="0 0 11 13" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="cur-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%"   stopColor={t.accent} />
            <stop offset="100%" stopColor={t.accentHover} />
          </linearGradient>
          <filter id="cur-shadow" x="-40%" y="-30%" width="180%" height="180%">
            <feDropShadow dx="0" dy="1" stdDeviation="1.2"
              floodColor="#000820" floodOpacity="0.5" />
          </filter>
        </defs>
        <path
          d="M 0.5,0.5 L 0.5,12 L 10,7 Z"
          fill="url(#cur-g)"
          stroke="rgba(255,255,255,0.15)"
          strokeWidth="0.6"
          strokeLinejoin="round"
          filter="url(#cur-shadow)"
        />
      </svg>
    </div>
  );
}

// ─── PC monitor logo SVG ─────────────────────────────────────────────────────

function PCLogo({ accent, accentHover }) {
  return (
    <svg width="34" height="30" viewBox="0 0 34 30" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%"   stopColor={accent} />
          <stop offset="100%" stopColor={accentHover} />
        </linearGradient>
        <filter id="logo-glow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5"
            floodColor={accent} floodOpacity="0.35" />
        </filter>
      </defs>

      {/* Monitor outer frame */}
      <rect x="1" y="1" width="30" height="19" rx="2.5" fill="url(#logo-g)" filter="url(#logo-glow)" />

      {/* Screen dark area */}
      <rect x="2.5" y="2.5" width="27" height="16" rx="1.5" fill="rgba(0,5,25,0.65)" />

      {/* Header bar */}
      <rect x="4" y="4" width="24" height="2.2" rx="0.7" fill="rgba(255,255,255,0.10)" />
      {/* Three dots — like window controls */}
      <circle cx="5.5"  cy="5.1" r="0.7" fill="rgba(255,255,255,0.35)" />
      <circle cx="7.8"  cy="5.1" r="0.7" fill="rgba(255,255,255,0.22)" />
      <circle cx="10.1" cy="5.1" r="0.7" fill="rgba(255,255,255,0.16)" />

      {/* Sidebar panel */}
      <rect x="4" y="7.5" width="5.5" height="9" rx="0.5" fill="rgba(255,255,255,0.07)" />

      {/* Content rows */}
      <rect x="11" y="8"    width="16" height="1.1" rx="0.5" fill="rgba(255,255,255,0.55)" />
      <rect x="11" y="11"   width="12" height="0.8" rx="0.4" fill="rgba(255,255,255,0.22)" />
      <rect x="11" y="12.8" width="14" height="0.8" rx="0.4" fill="rgba(255,255,255,0.17)" />
      <rect x="11" y="14.6" width="9"  height="0.8" rx="0.4" fill="rgba(255,255,255,0.14)" />

      {/* Stand neck */}
      <rect x="14" y="20" width="5" height="4.5" rx="0.6" fill="url(#logo-g)" opacity="0.65" />

      {/* Stand base */}
      <rect x="10.5" y="24" width="12" height="2" rx="1" fill="url(#logo-g)" opacity="0.55" />
    </svg>
  );
}

// ─── Constellation background ─────────────────────────────────────────────────
// Floating particles that connect when near, react to the mouse cursor.

function ConstellationBackground({ t }) {
  const canvasRef = useRef(null);
  const mouseRef  = useRef({ x: -9999, y: -9999 });

  // Track mouse for particle repulsion — ref avoids re-renders
  useEffect(() => {
    const onMove  = (e) => { mouseRef.current = { x: e.clientX, y: e.clientY }; };
    const onLeave = ()  => { mouseRef.current = { x: -9999, y: -9999 }; };
    window.addEventListener('mousemove',  onMove,  { passive: true });
    window.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove',  onMove);
      window.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  // Canvas animation — re-initialize on accent color change (theme switch)
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    let animId;
    let W = 0, H = 0;
    let particles = [];

    const N    = 68;
    const LINK = 155;  // px — max connection distance

    function hexRGB(hex) {
      return [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
    }
    const [ar, ag, ab] = hexRGB(t.accent);

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function makeParticle() {
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.10 + Math.random() * 0.20;
      return {
        x:  Math.random() * W,
        y:  Math.random() * H,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        r:  0.7 + Math.random() * 1.5,   // visual radius
        phase: Math.random() * Math.PI * 2,
        ps:    0.005 + Math.random() * 0.009, // pulse speed
      };
    }

    resize();
    particles = Array.from({ length: N }, makeParticle);

    const onResize = () => {
      resize();
      for (const p of particles) {
        if (p.x > W) p.x = Math.random() * W;
        if (p.y > H) p.y = Math.random() * H;
      }
    };
    window.addEventListener('resize', onResize);

    function draw() {
      ctx.clearRect(0, 0, W, H);

      const { x: mx, y: my } = mouseRef.current;

      // ── Update positions ──────────────────────────────────
      for (const p of particles) {
        // Gentle mouse repulsion inside 95px radius
        const mdx = p.x - mx;
        const mdy = p.y - my;
        const md2 = mdx * mdx + mdy * mdy;
        if (md2 < 95 * 95 && md2 > 0) {
          const md    = Math.sqrt(md2);
          const force = (95 - md) / 95 * 0.35;
          p.vx += (mdx / md) * force;
          p.vy += (mdy / md) * force;
        }

        // Speed cap + damping back toward natural drift
        const sp    = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        const maxSp = 0.65;
        if (sp > maxSp) {
          p.vx = (p.vx / sp) * maxSp;
          p.vy = (p.vy / sp) * maxSp;
        }
        p.vx *= 0.996;
        p.vy *= 0.996;

        p.x += p.vx;
        p.y += p.vy;
        p.phase += p.ps;

        // Seamless edge wrap
        if (p.x < -70) p.x = W + 70;
        else if (p.x > W + 70) p.x = -70;
        if (p.y < -70) p.y = H + 70;
        else if (p.y > H + 70) p.y = -70;
      }

      // ── Draw connections ──────────────────────────────────
      ctx.lineWidth = 0.65;
      for (let i = 0; i < N; i++) {
        for (let j = i + 1; j < N; j++) {
          const a = particles[i], b = particles[j];
          const dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < LINK * LINK) {
            const d     = Math.sqrt(d2);
            const alpha = (1 - d / LINK) * 0.16;
            ctx.strokeStyle = `rgba(${ar},${ag},${ab},${alpha})`;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }
      }

      // ── Draw particles ────────────────────────────────────
      for (const p of particles) {
        const alpha = 0.38 + Math.sin(p.phase) * 0.20; // breathes 0.18–0.58
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${ar},${ag},${ab},${alpha})`;
        ctx.fill();
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', onResize);
    };
  }, [t.accent]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', top: 0, left: 0,
        width: '100%', height: '100%',
        zIndex: 0, pointerEvents: 'none', display: 'block',
        opacity: 0.72,
      }}
    />
  );
}

// ─── Main App ────────────────────────────────────────────────────────────────

export default function App() {
  const { theme: t, mode, toggle, isLite, toggleLite } = useTheme();
  const { lang, toggle: toggleLang, t: tr } = useLang();
  const [auth, setAuth] = useState(() => {
    const tk = getTokens();
    return tk ? { loggedIn: true, user: tk.user } : { loggedIn: false, user: null };
  });

  const isAdmin = (u) => u?.role === 'admin';
  const PAGES = ['schedule', 'timeoff', 'profile', 'admin', 'mail', 'reminders', 'containers'];
  const [page, setPage] = useState(() => {
    const hash = window.location.hash.slice(1);
    if (!PAGES.includes(hash)) return 'profile';
    if (hash === 'admin') {
      const tk = getTokens();
      if (tk?.user?.role !== 'admin') return 'profile';
    }
    return hash;
  });

  const navigate = (p) => {
    if ((p === 'admin' || p === 'containers') && !isAdmin(auth.user)) return;
    setPage(p); window.location.hash = p; setSidebarOpen(false);
  };

  useEffect(() => {
    if ((page === 'admin' || page === 'containers') && !isAdmin(auth.user)) navigate('profile');
  }, [page, auth.user]);

  const [showNotifs, setShowNotifs] = useState(false);
  const [unread, setUnread] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const onLogin      = (data) => setAuth({ loggedIn: true, user: data.user });
  const onLogout     = () => { clearTokens(); setAuth({ loggedIn: false, user: null }); };
  const onUserUpdate = (u) => setAuth(a => ({ ...a, user: { ...a.user, ...u } }));

  useEffect(() => {
    if (!auth.loggedIn) return;
    const poll = () => api('/notifications/unread-count').then(d => d && setUnread(d.count)).catch(() => {});
    poll();
    const i = setInterval(poll, 15000);
    return () => clearInterval(i);
  }, [auth.loggedIn]);

  // Login screen — cursor + constellation work before auth too
  if (!auth.loggedIn) return (
    <>
      <style>{getGlobalCSS(t, isLite)}</style>
      {!isLite && <CustomCursor />}
      {!isLite && <ConstellationBackground t={t} />}
      <div style={{ position: 'relative', zIndex: 1 }}>
        <LoginPage onLogin={onLogin} />
      </div>
    </>
  );

  const nav = [
    { id: 'profile',  label: lang === 'ru' ? 'Профиль' : 'My Profile', icon: '👤' },
    { id: 'schedule', label: tr('schedule'),                             icon: '📅' },
    { id: 'mail',     label: lang === 'ru' ? 'Почта'   : 'Mail',        icon: '📧' },
    { id: 'timeoff',  label: tr('timeOff'),                              icon: '🌴', color: '#10b981' },
    { id: 'reminders', label: tr('reminders'),                            icon: '🔔' },
    ...(auth.user.role === 'admin' ? [
      { id: 'containers', label: lang === 'ru' ? 'Серверы' : 'Containers', icon: '🖥️' },
      { id: 'admin',  label: tr('admin'),                                icon: '⚙️' },
    ] : []),
  ];

  return (
    <>
      <style>{getGlobalCSS(t, isLite)}</style>
      {!isLite && <CustomCursor />}
      {!isLite && <ConstellationBackground t={t} />}

      <div style={{ display: 'flex', minHeight: '100vh', position: 'relative', zIndex: 1 }}>
        {sidebarOpen && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 800 }}
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* ── Sidebar ──────────────────────────────────────────── */}
        <aside className="sidebar-fixed" style={{
          width: '220px',
          background: t.surface,
          borderRight: `1px solid ${t.border}`,
          display: 'flex', flexDirection: 'column', flexShrink: 0,
          top: 0, bottom: 0, left: sidebarOpen ? 0 : '-220px',
          zIndex: 900, transition: 'left 0.28s cubic-bezier(0.4,0,0.2,1)',
          boxShadow: sidebarOpen ? t.shadowLg : 'none',
        }}>

          {/* Logo */}
          <div style={{
            padding: '16px 14px',
            borderBottom: `1px solid ${t.border}`,
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0, width: '3px',
              background: `linear-gradient(to bottom, ${t.accent}, ${t.accentHover})`,
            }} />
            <div style={{
              display: 'flex', alignItems: 'center', gap: '11px', paddingLeft: '8px',
            }}>
              <PCLogo accent={t.accent} accentHover={t.accentHover} />
              <div>
                <div style={{
                  fontWeight: 800, fontSize: '16px', letterSpacing: '-0.03em',
                  color: t.accent,
                }}>Portal</div>
                <div style={{
                  fontSize: '9px', color: t.textMuted,
                  letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: '1px',
                }}>Operations</div>
              </div>
            </div>
          </div>

          {/* Nav */}
          <nav style={{ flex: 1, padding: '10px 8px', overflowY: 'auto' }}>
            {nav.map(item => (
              <button
                key={item.id}
                onClick={() => navigate(item.id)}
                className={`nav-item${page === item.id ? ' active' : ''}`}
                style={{
                  marginBottom: '2px',
                  color: page === item.id
                    ? (item.color || t.accent)
                    : (item.color ? item.color + 'aa' : t.textSecondary),
                  background: page === item.id
                    ? (item.color ? item.color + '18' : t.accentLight)
                    : 'transparent',
                }}
              >
                <span style={{ fontSize: '15px', lineHeight: 1 }}>{item.icon}</span>
                <span style={{ fontSize: '13px' }}>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* User footer */}
          <div style={{ padding: '12px 14px', borderTop: `1px solid ${t.border}` }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px',
            }}>
              <div style={{
                width: '30px', height: '30px', borderRadius: t.radiusSm, flexShrink: 0,
                background: (auth.user.name_color || t.accent) + '22',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, color: auth.user.name_color || t.accent, fontSize: '13px',
                border: `1px solid ${(auth.user.name_color || t.accent)}44`,
              }}>
                {auth.user.display_name[0].toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: '12px',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {auth.user.display_name}
                </div>
                <div style={{
                  fontSize: '10px', color: t.textMuted,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                }}>
                  {auth.user.role}
                </div>
              </div>
            </div>
            <Button
              variant="ghost" size="sm"
              style={{ width: '100%', justifyContent: 'flex-start', fontSize: '12px' }}
              onClick={onLogout}
            >
              {tr('signOut')}
            </Button>
          </div>
        </aside>

        {/* ── Main content ─────────────────────────────────────── */}
        <main style={{ flex: 1, minWidth: 0 }}>
          <header style={{
            padding: '11px 24px',
            borderBottom: `1px solid ${t.border}`,
            background: t.surface,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 100,
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: `0 1px 0 ${t.border}`,
          }}>
            <button
              className="mobile-only"
              onClick={() => setSidebarOpen(true)}
              style={{ background: 'none', border: 'none', fontSize: '20px', padding: '4px', color: t.text }}
            >☰</button>
            <div className="desktop-only" />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button onClick={toggleLite} title={isLite ? 'Full mode (effects on)' : 'Lite mode (no effects)'} style={{
                background: 'none', border: `1px solid ${isLite ? t.accent : t.border}`,
                fontSize: '10px', padding: '3px 7px', borderRadius: t.radiusSm,
                color: isLite ? t.accent : t.textMuted, fontWeight: 700,
                letterSpacing: '0.06em', lineHeight: 1.4,
              }}>{isLite ? 'FULL' : 'LITE'}</button>
              <button onClick={toggle} title={mode === 'dark' ? 'Light mode' : 'Dark mode'} style={{
                background: 'none', border: 'none',
                fontSize: '17px', padding: '4px 8px', borderRadius: t.radiusSm,
                color: t.textSecondary, lineHeight: 1,
              }}>{mode === 'dark' ? '☀️' : '🌙'}</button>
              <button onClick={toggleLang} title={lang === 'en' ? 'Switch to Russian' : 'Switch to English'} style={{
                background: 'none', border: 'none',
                fontSize: '11px', padding: '4px 8px', borderRadius: t.radiusSm,
                color: t.textSecondary, fontWeight: 700, letterSpacing: '0.08em',
              }}>{lang === 'en' ? 'RU' : 'EN'}</button>
              <button onClick={() => setShowNotifs(!showNotifs)} style={{
                background: 'none', border: 'none',
                position: 'relative', fontSize: '17px', padding: '4px 8px', borderRadius: t.radiusSm,
              }}>
                🔔
                {unread > 0 && (
                  <span style={{
                    position: 'absolute', top: '-2px', right: '0px',
                    background: t.danger, color: '#fff', fontSize: '10px',
                    fontWeight: 700, borderRadius: '10px', padding: '1px 5px',
                    minWidth: '16px', textAlign: 'center',
                  }}>{unread}</span>
                )}
              </button>
            </div>
          </header>

          <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            {page === 'profile' && (
              <div style={{ maxWidth: '780px', margin: '0 auto' }}>
                <ProfilePage user={auth.user} onUserUpdate={onUserUpdate} />
              </div>
            )}
            {page === 'schedule' && <SchedulePage user={auth.user} />}
            {page === 'mail'     && <MailReporterPage user={auth.user} />}
            {page === 'timeoff'   && <TimeOffPage user={auth.user} />}
            {page === 'reminders' && <RemindersPage user={auth.user} />}
            {page === 'containers' && isAdmin(auth.user) && <ContainersPage />}
            {page === 'admin'     && isAdmin(auth.user) && <AdminPage />}
          </div>
        </main>

        {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}
      </div>
    </>
  );
}
