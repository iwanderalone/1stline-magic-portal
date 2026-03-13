import { useState, useEffect } from 'react';
import { getTokens, clearTokens, api } from './api';
import { globalCSS, theme } from './theme';
import { Button } from './components/UI';
import LoginPage from './pages/LoginPage';
import SchedulePage from './pages/SchedulePage';
import RemindersPage from './pages/RemindersPage';
import UsersPage from './pages/UsersPage';
import NotificationsPanel from './components/NotificationsPanel';

export default function App() {
  const [auth, setAuth] = useState(() => {
    const t = getTokens();
    return t ? { loggedIn: true, user: t.user } : { loggedIn: false, user: null };
  });
  const [page, setPage] = useState('schedule');
  const [showNotifs, setShowNotifs] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogin = (data) => setAuth({ loggedIn: true, user: data.user });
  const handleLogout = () => { clearTokens(); setAuth({ loggedIn: false, user: null }); };

  // Poll unread count
  useEffect(() => {
    if (!auth.loggedIn) return;
    const poll = () => api('/notifications/unread-count')
      .then(d => d && setUnreadCount(d.count))
      .catch(() => {});
    poll();
    const interval = setInterval(poll, 15000);
    return () => clearInterval(interval);
  }, [auth.loggedIn]);

  if (!auth.loggedIn) {
    return (
      <>
        <style>{globalCSS}</style>
        <LoginPage onLogin={handleLogin} />
      </>
    );
  }

  const navItems = [
    { id: 'schedule', label: 'Schedule', icon: '📅' },
    { id: 'reminders', label: 'Reminders', icon: '🔔' },
    ...(auth.user.role === 'admin' ? [{ id: 'users', label: 'Team', icon: '👥' }] : []),
  ];

  return (
    <>
      <style>{globalCSS}</style>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Mobile sidebar overlay */}
        {sidebarOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 800 }}
            onClick={() => setSidebarOpen(false)} />
        )}

        {/* Sidebar */}
        <aside className="sidebar-fixed" style={{
          width: '220px', background: theme.surface, borderRight: `1px solid ${theme.border}`,
          display: 'flex', flexDirection: 'column', flexShrink: 0,
          top: 0, bottom: 0, left: sidebarOpen ? 0 : '-220px',
          zIndex: 900, transition: 'left 0.25s ease',
        }}>
          <div style={{ padding: '20px 16px', borderBottom: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '8px', background: theme.accent,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px',
              }}>⚡</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '-0.01em' }}>Portal</div>
                <div style={{ fontSize: '11px', color: theme.textMuted }}>v1.0</div>
              </div>
            </div>
          </div>

          <nav style={{ flex: 1, padding: '12px 8px' }}>
            {navItems.map(item => (
              <button key={item.id} onClick={() => { setPage(item.id); setSidebarOpen(false); }} style={{
                display: 'flex', alignItems: 'center', gap: '10px',
                width: '100%', padding: '10px 12px', border: 'none', borderRadius: theme.radiusSm,
                background: page === item.id ? theme.accentLight : 'transparent',
                color: page === item.id ? theme.accent : theme.textSecondary,
                fontWeight: page === item.id ? 600 : 400, fontSize: '14px',
                cursor: 'pointer', transition: 'all 0.15s', marginBottom: '2px',
              }}>
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          <div style={{ padding: '16px', borderTop: `1px solid ${theme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <div style={{
                width: '32px', height: '32px', borderRadius: '8px', background: theme.accentLight,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, color: theme.accent, fontSize: '13px',
              }}>{auth.user.display_name[0]}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '13px' }}>{auth.user.display_name}</div>
                <div style={{ fontSize: '11px', color: theme.textMuted }}>{auth.user.role}</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" style={{ width: '100%', justifyContent: 'flex-start' }} onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, minWidth: 0 }}>
          <header style={{
            padding: '12px 24px', borderBottom: `1px solid ${theme.border}`,
            background: theme.surface, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 100,
          }}>
            <button className="mobile-only" onClick={() => setSidebarOpen(true)} style={{
              background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px', padding: '4px',
            }}>☰</button>
            <div className="desktop-only" />
            <button onClick={() => setShowNotifs(!showNotifs)} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              position: 'relative', fontSize: '18px', padding: '4px 8px', borderRadius: theme.radiusSm,
            }}>
              🔔
              {unreadCount > 0 && (
                <span style={{
                  position: 'absolute', top: '-2px', right: '0px',
                  background: theme.danger, color: '#fff', fontSize: '10px',
                  fontWeight: 700, borderRadius: '10px', padding: '1px 5px', minWidth: '16px', textAlign: 'center',
                }}>{unreadCount}</span>
              )}
            </button>
          </header>

          <div style={{ padding: '24px', maxWidth: '1100px', margin: '0 auto' }}>
            {page === 'schedule' && <SchedulePage user={auth.user} />}
            {page === 'reminders' && <RemindersPage />}
            {page === 'users' && <UsersPage />}
          </div>
        </main>

        {showNotifs && <NotificationsPanel onClose={() => setShowNotifs(false)} />}
      </div>
    </>
  );
}
