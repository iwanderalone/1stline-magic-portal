import { useState, useEffect } from 'react';
import { getTokens, clearTokens, api } from './api';
import { getGlobalCSS } from './theme';
import { useTheme } from './components/ThemeContext';
import { useLang } from './components/LangContext';
import { Button } from './components/UI';
import LoginPage from './pages/LoginPage';
import SchedulePage from './pages/SchedulePage';
import RemindersPage from './pages/RemindersPage';
import AdminPage from './pages/AdminPage';
import ProfilePage from './pages/ProfilePage';
import MailReporterPage from './pages/MailReporterPage';
import NotificationsPanel from './components/NotificationsPanel';

export default function App() {
  const { theme: t, mode, toggle } = useTheme();
  const { lang, toggle: toggleLang, t: tr } = useLang();
  const [auth, setAuth] = useState(() => {
    const tk = getTokens();
    return tk ? { loggedIn: true, user: tk.user } : { loggedIn: false, user: null };
  });
  const isAdmin = (u) => u?.role === 'admin';
<<<<<<< HEAD
  const PAGES = ['schedule', 'reminders', 'profile', 'admin', 'mail'];
=======
  const PAGES = ['schedule', 'reminders', 'profile', 'admin'];
>>>>>>> cc9536b15cdb2019b0580a9ce9f2eadb1f8acd57
  const [page, setPage] = useState(() => {
    const hash = window.location.hash.slice(1);
    if (!PAGES.includes(hash)) return 'schedule';
    // Don't let the hash pre-select admin for non-admins — resolved after login
    return hash;
  });
  const navigate = (p) => { setPage(p); window.location.hash = p; setSidebarOpen(false); };

  // Kick non-admins off the admin page if they somehow navigate there
  useEffect(() => {
    if (page === 'admin' && !isAdmin(auth.user)) navigate('schedule');
  }, [page, auth.user]);
  const [showNotifs, setShowNotifs] = useState(false);
  const [unread, setUnread] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const onLogin = (data) => setAuth({ loggedIn: true, user: data.user });
  const onLogout = () => { clearTokens(); setAuth({ loggedIn: false, user: null }); };
  const onUserUpdate = (u) => setAuth(a => ({ ...a, user: { ...a.user, ...u } }));

  useEffect(() => {
    if (!auth.loggedIn) return;
    const poll = () => api('/notifications/unread-count').then(d => d && setUnread(d.count)).catch(() => {});
    poll();
    const i = setInterval(poll, 15000);
    return () => clearInterval(i);
  }, [auth.loggedIn]);

  if (!auth.loggedIn) return <><style>{getGlobalCSS(t)}</style><LoginPage onLogin={onLogin} /></>;

  const nav = [
    { id: 'schedule', label: tr('schedule'), icon: '📅' },
    { id: 'reminders', label: tr('reminders'), icon: '🔔' },
    { id: 'profile', label: tr('profile'), icon: '👤' },
    ...(auth.user.role === 'admin' ? [
      { id: 'admin', label: tr('admin'), icon: '⚙️' },
      { id: 'mail', label: tr('mailReporter'), icon: '📧' },
    ] : []),
  ];

  return (
    <>
      <style>{getGlobalCSS(t)}</style>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {sidebarOpen && <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 800 }} onClick={() => setSidebarOpen(false)} />}

        <aside className="sidebar-fixed" style={{
          width: '220px', background: t.surface, borderRight: `1px solid ${t.border}`,
          display: 'flex', flexDirection: 'column', flexShrink: 0,
          top: 0, bottom: 0, left: sidebarOpen ? 0 : '-220px',
          zIndex: 900, transition: 'left 0.25s ease',
        }}>
          <div style={{ padding: '20px 16px', borderBottom: `1px solid ${t.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', color: '#fff' }}>⚡</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px' }}>Portal</div>
                <div style={{ fontSize: '11px', color: t.textMuted }}>v0.1</div>
              </div>
            </div>
          </div>

          <nav style={{ flex: 1, padding: '12px 8px' }}>
            {nav.map(item => (
              <button key={item.id} onClick={() => navigate(item.id)} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '10px 12px', border: 'none', borderRadius: t.radiusSm,
                background: page === item.id ? t.accentLight : 'transparent',
                color: page === item.id ? t.accent : t.textSecondary,
                fontWeight: page === item.id ? 600 : 400, fontSize: '14px',
                cursor: 'pointer', transition: 'all 0.15s', marginBottom: '2px',
              }}>
                <span>{item.icon}</span><span>{item.label}</span>
              </button>
            ))}
          </nav>


          <div style={{ padding: '16px', borderTop: `1px solid ${t.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '8px',
                background: (auth.user.name_color || t.accent) + '20',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, color: auth.user.name_color || t.accent, fontSize: '13px',
              }}>{auth.user.display_name[0]}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px' }}>{auth.user.display_name}</div>
                <div style={{ fontSize: '11px', color: t.textMuted }}>{auth.user.role}</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={onLogout}>{tr('signOut')}</Button>
          </div>
        </aside>

        <main style={{ flex: 1, minWidth: 0 }}>
          <header style={{
            padding: '12px 24px', borderBottom: `1px solid ${t.border}`, background: t.surface,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 100,
          }}>
            <button className="mobile-only" onClick={() => setSidebarOpen(true)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '4px', color: t.text }}>☰</button>
            <div className="desktop-only" />
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button onClick={toggle} title={mode === 'dark' ? 'Light mode' : 'Dark mode'} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '18px', padding: '4px 8px', borderRadius: t.radiusSm,
                color: t.textSecondary, lineHeight: 1,
              }}>{mode === 'dark' ? '☀️' : '🌙'}</button>
              <button onClick={toggleLang} title={lang === 'en' ? 'Switch to Russian' : 'Switch to English'} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontSize: '12px', padding: '4px 8px', borderRadius: t.radiusSm,
                color: t.textSecondary, lineHeight: 1, fontWeight: 700, letterSpacing: '0.5px',
              }}>{lang === 'en' ? 'RU' : 'EN'}</button>
              <button onClick={() => setShowNotifs(!showNotifs)} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                position: 'relative', fontSize: '18px', padding: '4px 8px', borderRadius: t.radiusSm,
              }}>
                🔔
                {unread > 0 && <span style={{
                  position: 'absolute', top: '-2px', right: '0px',
                  background: t.danger, color: '#fff', fontSize: '10px',
                  fontWeight: 700, borderRadius: '10px', padding: '1px 5px', minWidth: '16px', textAlign: 'center',
                }}>{unread}</span>}
              </button>
            </div>
          </header>

          <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
            {page === 'schedule' && <SchedulePage user={auth.user} />}
            {page === 'reminders' && <RemindersPage />}
            {page === 'profile' && <ProfilePage user={auth.user} onUserUpdate={onUserUpdate} />}
            {page === 'admin' && isAdmin(auth.user) && <AdminPage />}
<<<<<<< HEAD
            {page === 'mail' && isAdmin(auth.user) && <MailReporterPage />}
=======
>>>>>>> cc9536b15cdb2019b0580a9ce9f2eadb1f8acd57
          </div>
        </main>

        {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}
      </div>
    </>
  );
}
