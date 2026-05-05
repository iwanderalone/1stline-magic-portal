import { useState, useEffect } from 'react';
import { getTokens, clearTokens, api } from './api';
import { getGlobalCSS } from './theme';
import { useTheme } from './components/ThemeContext';
import { useLang } from './components/LangContext';
import { Icon } from './components/Icons';
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
  profile:    'user',
  schedule:   'calendar',
  mail:       'mail',
  timeoff:    'sun',
  reminders:  'bell',
  containers: 'server',
  admin:      'settings',
};

export default function App() {
  const { theme: t, mode, toggle } = useTheme();
  const { lang, toggle: toggleLang, t: tr } = useLang();
  const bp = useBreakpoint();

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

  const [showNotifs, setShowNotifs] = useState(false);
  const [unread, setUnread] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const navigate = (p) => {
    if ((p === 'admin' || p === 'containers') && !isAdmin(auth.user)) return;
    setPage(p);
    window.location.hash = p;
    setSidebarOpen(false);
  };

  useEffect(() => {
    if ((page === 'admin' || page === 'containers') && !isAdmin(auth.user)) {
      setPage('profile');
      window.location.hash = 'profile';
      setSidebarOpen(false);
    }
  }, [page, auth.user]);

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
    { id: 'profile',   label: lang === 'ru' ? 'Профиль'  : 'My Profile' },
    { id: 'schedule',  label: tr('schedule') },
    { id: 'mail',      label: lang === 'ru' ? 'Почта'    : 'Mail' },
    { id: 'timeoff',   label: tr('timeOff') },
    { id: 'reminders', label: tr('reminders') },
    ...(auth.user.role === 'admin' ? [
      { id: 'containers', label: lang === 'ru' ? 'Серверы' : 'Containers' },
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
      background: t.surface,
      borderRight: `1px solid ${t.border}`,
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
      boxShadow: isMobile && sidebarOpen ? t.shadowLg : 'none',
    }}>
      {/* Logo */}
      <div style={{
        padding: isRail ? '14px 0' : '14px 16px',
        borderBottom: `1px solid ${t.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: isRail ? 'center' : 'flex-start',
        gap: 10,
        minHeight: 56,
        flexShrink: 0,
      }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7,
          background: t.accentLight,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 800, fontSize: 14, color: t.accent, letterSpacing: '-0.05em',
          flexShrink: 0,
        }}>P</div>
        {!isRail && (
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: t.text, letterSpacing: '-0.03em', lineHeight: 1.2 }}>Portal</div>
            <div style={{ fontSize: 10, color: t.textMuted, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Operations</div>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: isRail ? '8px 4px' : '8px', overflowY: 'auto' }}>
        {nav.map(item => (
          <button
            key={item.id}
            onClick={() => navigate(item.id)}
            title={isRail ? item.label : undefined}
            className={`nav-item${page === item.id ? ' active' : ''}`}
            style={{
              marginBottom: 2,
              color: page === item.id ? t.accent : t.textSecondary,
              background: page === item.id ? t.accentLight : 'transparent',
              justifyContent: isRail ? 'center' : 'flex-start',
              padding: isRail ? '9px' : '8px 10px',
            }}
          >
            <Icon name={NAV_ICONS[item.id]} size={18} color="currentColor" />
            {!isRail && <span>{item.label}</span>}
          </button>
        ))}
      </nav>

      {/* User footer */}
      <div style={{
        padding: isRail ? '10px 4px' : '10px 12px',
        borderTop: `1px solid ${t.border}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        alignItems: isRail ? 'center' : 'stretch',
        flexShrink: 0,
      }}>
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}
          title={isRail ? `${auth.user.display_name} (${auth.user.role})` : undefined}
        >
          <div style={{
            width: 28, height: 28, borderRadius: 6, flexShrink: 0,
            background: (auth.user.name_color || t.accent) + '22',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, color: auth.user.name_color || t.accent, fontSize: 12,
            border: `1px solid ${(auth.user.name_color || t.accent)}44`,
          }}>
            {auth.user.display_name[0].toUpperCase()}
          </div>
          {!isRail && (
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {auth.user.display_name}
              </div>
              <div style={{ fontSize: 10, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {auth.user.role}
              </div>
            </div>
          )}
        </div>
        <button
          onClick={onLogout}
          title={isRail ? tr('signOut') : undefined}
          className="btn btn-ghost btn-sm"
          style={{
            width: '100%',
            justifyContent: isRail ? 'center' : 'flex-start',
            fontSize: 12,
            gap: 6,
            padding: isRail ? '5px' : '5px 10px',
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
          {/* Header */}
          <header style={{
            height: 48,
            padding: '0 20px',
            borderBottom: `1px solid ${t.border}`,
            background: t.surface,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            position: 'sticky',
            top: 0,
            zIndex: 100,
            flexShrink: 0,
          }}>
            {isMobile ? (
              <button
                onClick={() => setSidebarOpen(true)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.text, padding: 4, display: 'flex', alignItems: 'center' }}
              >
                <Icon name="menu" size={20} />
              </button>
            ) : <div />}

            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <button
                onClick={toggle}
                title={mode === 'dark' ? 'Light mode' : 'Dark mode'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textSecondary, padding: '4px 6px', borderRadius: 6, display: 'flex', alignItems: 'center' }}
              >
                <Icon name={mode === 'dark' ? 'sun' : 'moon'} size={17} />
              </button>
              <button
                onClick={toggleLang}
                title={lang === 'en' ? 'Русский' : 'English'}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textSecondary, padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}
              >
                {lang === 'en' ? 'RU' : 'EN'}
              </button>
              <button
                onClick={() => setShowNotifs(v => !v)}
                title="Notifications"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textSecondary, padding: '4px 6px', borderRadius: 6, display: 'flex', alignItems: 'center', position: 'relative' }}
              >
                <Icon name="bell" size={18} />
                {unread > 0 && (
                  <span style={{
                    position: 'absolute', top: 2, right: 2,
                    width: 7, height: 7, borderRadius: '50%',
                    background: t.danger, border: `1.5px solid ${t.surface}`,
                  }} />
                )}
              </button>
            </div>
          </header>

          {/* Page content */}
          <main style={{ flex: 1, minWidth: 0 }}>
            <div style={{ maxWidth: 1440, margin: '0 auto', height: '100%' }}>
              {page === 'schedule'   && <SchedulePage user={auth.user} />}
              {page === 'timeoff'    && <TimeOffPage user={auth.user} />}
              {page === 'profile'    && <ProfilePage user={auth.user} onUserUpdate={onUserUpdate} />}
              {page === 'admin'      && isAdmin(auth.user) && <AdminPage />}
              {page === 'mail'       && <MailReporterPage user={auth.user} />}
              {page === 'reminders'  && <RemindersPage user={auth.user} />}
              {page === 'containers' && isAdmin(auth.user) && <ContainersPage />}
            </div>
          </main>
        </div>
      </div>

      {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}
    </>
  );
}
