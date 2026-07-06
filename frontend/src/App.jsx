import { useState, useEffect, useCallback } from 'react';
import { getTokens, clearTokens, api } from './api';
import { getGlobalCSS } from './theme';
import { useTheme } from './components/ThemeContext';
import { useLang } from './components/LangContext';
import { Icon } from './components/Icons';
import { Kbd } from './components/UI';
import LoginPage from './pages/LoginPage';
import SchedulePage from './pages/SchedulePage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import MailReporterPage from './pages/MailReporterPage';
import TimeOffPage from './pages/TimeOffPage';
import RemindersPage from './pages/RemindersPage';
import HomePage from './pages/HomePage';
import RunbooksPage from './pages/RunbooksPage';
import TicketsPage from './pages/TicketsPage';
import AlertsPage from './pages/AlertsPage';
import AssistantChat from './components/AssistantChat';
import NotificationsPanel from './components/NotificationsPanel';
import CommandPalette from './components/CommandPalette';

function useBreakpoint() {
  const getBreakpoint = () => {
    const w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1280) return 'rail';
    return 'full';
  };
  const [bp, setBp] = useState(getBreakpoint);
  useEffect(() => {
    const handler = () => setBp(getBreakpoint());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return bp;
}

const NAV_ICONS = {
  home:       'grid',
  profile:    'user',
  schedule:   'calendar',
  mail:       'mail',
  tickets:    'ticket',
  alerts:     'siren',
  runbooks:   'bookmark',
  timeoff:    'sun',
  reminders:  'bell',
  admin:      'shield',
};

function TopBar({ isMobile, onMenu, mode, toggle, lang, toggleLang, unread, onNotif, onPalette }) {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const fmt = (tz) => now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz });

  return (
    <header style={{
      height: 48, flexShrink: 0,
      padding: '0 20px',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg)',
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      position: 'sticky',
      top: 0,
      zIndex: 100,
    }}>
      {/* Mobile hamburger */}
      {isMobile && (
        <button
          onClick={onMenu}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4, display: 'flex', alignItems: 'center' }}
        >
          <Icon name="menu" size={20} />
        </button>
      )}

      {/* ⌘K command palette trigger */}
      <button
        onClick={onPalette}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '5px 10px',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          minWidth: isMobile ? 'auto' : 200, height: 30, cursor: 'pointer',
          color: 'var(--text-muted)', fontSize: 12, fontFamily: 'inherit',
        }}
        title="Jump to page (⌘K)"
      >
        <Icon name="search" size={13} />
        {!isMobile && <span style={{ flex: 1, textAlign: 'left' }}>Jump to page…</span>}
        {!isMobile && <Kbd>⌘K</Kbd>}
      </button>

      <span style={{ flex: 1 }} />

      {/* Multi-timezone clocks ordered by local time from earliest to latest. */}
      {!isMobile && (
        <div style={{ display: 'flex', alignItems: 'center', fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
          {[
            ['MEX', 'Mexico City', fmt('America/Mexico_City')],
            ['BER', 'Berlin',      fmt('Europe/Berlin')],
            ['MSK', 'Moscow',      fmt('Europe/Moscow')],
            ['AUH', 'Abu Dhabi',   fmt('Asia/Dubai')],
          ].map(([city, label, time], i, clocks) => (
            <div key={city} style={{
              padding: '3px 10px',
              borderRight: i < clocks.length - 1 ? '1px solid var(--border-light)' : 'none',
              color: 'var(--text-muted)',
            }}>
              <div
                title={label}
                style={{ fontSize: 9, letterSpacing: 0.1, color: 'var(--text-muted)', fontWeight: 700 }}
              >
                {city}
              </div>
              <div style={{ color: 'var(--text)' }}>{time}</div>
            </div>
          ))}
        </div>
      )}

      {/* EN / RU language pill */}
      <div className="lang-pill-wrap">
        {['en', 'ru'].map(l => (
          <button
            key={l}
            onClick={() => l !== lang && toggleLang()}
            className={`lang-pill${lang === l ? ' active' : ''}`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Theme toggle */}
      <button
        onClick={toggle}
        title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
        className="btn btn-icon btn-sm"
        style={{ width: 32, height: 32, padding: 0 }}
      >
        <Icon name={mode === 'dark' ? 'sun' : 'moon'} size={15} />
      </button>

      {/* Notification bell */}
      <button
        onClick={onNotif}
        className="btn btn-icon btn-sm"
        style={{ width: 32, height: 32, padding: 0, position: 'relative' }}
        title="Notifications"
      >
        <Icon name="bell" size={15} />
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -3, right: -3,
            minWidth: 16, height: 16, borderRadius: 999,
            background: 'var(--danger)', color: '#fff',
            fontSize: 10, fontWeight: 700, fontFamily: 'var(--font-mono)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '0 4px', border: '2px solid var(--bg)',
          }}>{unread}</span>
        )}
      </button>
    </header>
  );
}

export default function App() {
  const { theme: t, mode, toggle } = useTheme();
  const { lang, toggle: toggleLang, t: tr } = useLang();
  const bp = useBreakpoint();

  const [auth, setAuth] = useState(() => {
    const tk = getTokens();
    return tk ? { loggedIn: true, user: tk.user } : { loggedIn: false, user: null };
  });

  const isAdmin = (u) => u?.role === 'admin';
  const PAGES = ['home', 'schedule', 'timeoff', 'profile', 'admin', 'mail', 'reminders', 'runbooks', 'tickets', 'alerts'];
  const pageFromLocation = () => {
    const rawHash = window.location.hash.replace(/^#\/?/, '');
    const rawPath = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/')[0];
    const candidate = rawHash || rawPath;
    return PAGES.includes(candidate) ? candidate : 'home';
  };

  const [page, setPage] = useState(() => {
    const initialPage = pageFromLocation();
    if (initialPage === 'admin') {
      const tk = getTokens();
      if (tk?.user?.role !== 'admin') return 'home';
    }
    return initialPage;
  });

  const [showNotifs, setShowNotifs] = useState(false);
  const [unread, setUnread] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [initialRunbookId, setInitialRunbookId] = useState(null);

  const navigate = useCallback((p, runbookId = null) => {
    if (p === 'admin' && !isAdmin(auth.user)) return;
    setInitialRunbookId(runbookId);
    setPage(p);
    window.history.pushState(null, '', `/#${p}`);
    setSidebarOpen(false);
  }, [auth.user]);

  /* ⌘K / Ctrl+K global shortcut */
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (page === 'admin' && !isAdmin(auth.user)) {
      setPage('home');
      window.history.replaceState(null, '', '/#home');
      setSidebarOpen(false);
    }
  }, [page, auth.user]);

  useEffect(() => {
    const syncRoute = () => {
      const nextPage = pageFromLocation();
      if (nextPage === 'admin' && !isAdmin(auth.user)) {
        setPage('home');
        window.history.replaceState(null, '', '/#home');
        return;
      }
      setPage(nextPage);
    };

    window.addEventListener('hashchange', syncRoute);
    window.addEventListener('popstate', syncRoute);
    return () => {
      window.removeEventListener('hashchange', syncRoute);
      window.removeEventListener('popstate', syncRoute);
    };
  }, [auth.user]);

  useEffect(() => {
    if (bp !== 'mobile') setSidebarOpen(false);
  }, [bp]);

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

  if (!auth.loggedIn) return (
    <>
      <style>{getGlobalCSS(t)}</style>
      <LoginPage onLogin={onLogin} />
    </>
  );

  const nav = [
    { id: 'home',      label: tr('home') },
    { id: 'profile',   label: lang === 'ru' ? 'Профиль'  : 'My Profile' },
    { id: 'schedule',  label: tr('schedule') },
    { id: 'mail',      label: lang === 'ru' ? 'Почта'    : 'Mail' },
    { id: 'tickets',   label: lang === 'ru' ? 'Тикеты'   : 'Tickets' },
    { id: 'alerts',    label: lang === 'ru' ? 'Алерты'   : 'Alerts' },
    { id: 'runbooks',  label: lang === 'ru' ? 'Рунбуки'  : 'Runbooks' },
    { id: 'timeoff',   label: tr('timeOff') },
    { id: 'reminders', label: tr('reminders') },
    ...(auth.user.role === 'admin' ? [
      { id: 'admin',      label: tr('admin') },
    ] : []),
  ];

  const isRail   = bp === 'rail';
  const isMobile = bp === 'mobile';
  const sidebarWidth = isRail ? 64 : 240;

  const sidebar = (
    <aside style={{
      width: sidebarWidth,
      minWidth: sidebarWidth,
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      height: '100vh',
      position: isMobile ? 'fixed' : 'sticky',
      top: 0,
      left: isMobile ? (sidebarOpen ? 0 : -sidebarWidth) : 0,
      zIndex: isMobile ? 900 : 1,
      transition: 'left 0.25s cubic-bezier(0.4,0,0.2,1)',
      overflow: 'hidden',
      boxShadow: isMobile && sidebarOpen ? 'var(--shadow-lg)' : 'none',
      padding: '18px 12px 14px',
    }}>
      {/* Workspace identity pill */}
      {!isRail && (
        <button
          onClick={() => navigate('schedule')}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '8px 10px', marginBottom: 12,
            background: 'var(--surface-alt)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-sm)',
            cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', width: '100%',
            color: 'var(--text-secondary)',
          }}
        >
          <span style={{
            width: 22, height: 22, borderRadius: 5,
            background: 'var(--surface)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--accent)', flexShrink: 0,
          }}>
            <Icon name="workspace" size={13} />
          </span>
          <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              基盤
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontFamily: 'var(--font-mono)' }}>
              prod
            </div>
          </div>
          <Icon name="arrowUpDown" size={11} />
        </button>
      )}
      {isRail && <div style={{ marginBottom: 12 }} />}

      {/* Primary nav */}
      <nav style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {nav.map(item => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            title={isRail ? item.label : undefined}
            className={`nav-item${page === item.id ? ' active' : ''}`}
            style={{
              marginBottom: 1,
              color: page === item.id ? 'var(--accent)' : 'var(--text-secondary)',
              background: page === item.id ? 'var(--accent-light)' : 'transparent',
              justifyContent: isRail ? 'center' : 'flex-start',
              padding: isRail ? '9px' : '7px 10px 7px 14px',
            }}
          >
            <Icon name={NAV_ICONS[item.id]} size={15} color="currentColor" />
            {!isRail && <span style={{ flex: 1 }}>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User profile + logout */}
      <div style={{
        paddingTop: 12, borderTop: '1px solid var(--border-light)',
        marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4,
        flexShrink: 0,
      }}>
        <button
          onClick={() => navigate('profile')}
          title={isRail ? auth.user.display_name : undefined}
          style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: isRail ? '6px' : '6px 8px',
            background: 'transparent', border: 'none',
            borderRadius: 'var(--radius-sm)', cursor: 'pointer',
            fontFamily: 'inherit', textAlign: 'left', width: '100%',
            justifyContent: isRail ? 'center' : 'flex-start',
          }}
        >
          <div style={{
            width: 30, height: 30, borderRadius: 'var(--radius-sm)', flexShrink: 0,
            background: (auth.user.name_color || 'var(--accent)') + '22',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, color: auth.user.name_color || 'var(--accent)', fontSize: 12,
            border: `1px solid ${(auth.user.name_color || 'var(--accent)') + '44'}`,
          }}>
            {(auth.user.display_name || auth.user.username || '?')[0].toUpperCase()}
          </div>
          {!isRail && (
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>
                {auth.user.display_name}
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {auth.user.role}
              </div>
            </div>
          )}
          {!isRail && <Icon name="chevronRight" size={14} color="var(--text-muted)" />}
        </button>
        <button
          onClick={onLogout}
          title={isRail ? tr('signOut') : undefined}
          className="btn btn-ghost btn-sm"
          style={{
            width: '100%', justifyContent: isRail ? 'center' : 'flex-start',
            fontSize: 12, gap: 6, padding: isRail ? '5px' : '5px 10px',
          }}
        >
          <Icon name="logout" size={14} />
          {!isRail && tr('signOut')}
        </button>
      </div>
    </aside>
  );

  return (
    <>
      <style>{getGlobalCSS(t)}</style>

      {isMobile && sidebarOpen && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 800 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {sidebar}

        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <TopBar
            isMobile={isMobile}
            onMenu={() => setSidebarOpen(true)}
            mode={mode}
            toggle={toggle}
            lang={lang}
            toggleLang={toggleLang}
            unread={unread}
            onNotif={() => setShowNotifs(v => !v)}
            onPalette={() => setPaletteOpen(true)}
          />

          {/* Page content */}
          <main style={{ flex: 1, minWidth: 0, padding: isMobile ? '20px 16px 32px' : '28px 36px 48px' }}>
            <div style={{ width: '100%', maxWidth: 1440, margin: '0 auto' }}>
              {page === 'home'       && <HomePage user={auth.user} unread={unread} onNavigate={navigate} />}
              {page === 'schedule'   && <SchedulePage user={auth.user} />}
              {page === 'timeoff'    && <TimeOffPage user={auth.user} />}
              {page === 'profile'    && <ProfilePage user={auth.user} onUserUpdate={onUserUpdate} />}
              {page === 'admin'      && isAdmin(auth.user) && <AdminPage />}
              {page === 'mail'       && <MailReporterPage user={auth.user} />}
              {page === 'tickets'    && <TicketsPage user={auth.user} />}
              {page === 'alerts'     && <AlertsPage />}
              {page === 'runbooks'   && <RunbooksPage user={auth.user} initialRunbookId={initialRunbookId} />}
              {page === 'reminders'  && <RemindersPage user={auth.user} />}
            </div>
          </main>
        </div>
      </div>

      {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}

      <AssistantChat />

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        navigate={navigate}
        user={auth.user}
      />
    </>
  );
}
