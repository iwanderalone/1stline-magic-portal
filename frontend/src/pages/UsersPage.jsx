import { useState, useEffect } from 'react';
import { api } from '../api';
import { Card, Button, Input, Badge, Overlay, Toast } from '../components/UI';
import { theme } from '../theme';

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState(null);

  const reload = () => api('/users/').then(d => { setUsers(d || []); setLoading(false); });
  useEffect(() => { reload(); }, []);

  const handleCreate = async (form) => {
    try {
      await api('/users/', { method: 'POST', body: JSON.stringify(form) });
      setToast({ message: 'User created!', type: 'success' });
      setShowCreate(false);
      reload();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const getLinkCode = async (userId) => {
    try {
      const res = await api(`/users/${userId}/telegram-link-code`, { method: 'POST' });
      setToast({ message: `Link code: ${res.code} — send /link ${res.code} to the bot`, type: 'info' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700 }}>Team</h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>+ Add member</Button>
      </div>

      <Card style={{ padding: '4px' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: theme.textMuted }}>Loading…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {users.map((u, i) => (
              <div key={u.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '12px 18px', gap: '12px', flexWrap: 'wrap',
                borderBottom: i < users.length - 1 ? `1px solid ${theme.borderLight}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{
                    width: '36px', height: '36px', borderRadius: '8px', background: theme.accentLight,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, color: theme.accent, fontSize: '14px',
                  }}>{u.display_name[0]}</div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{u.display_name}</div>
                    <div style={{ fontSize: '12px', color: theme.textMuted, fontFamily: theme.fontMono }}>
                      @{u.username} · gap: {u.min_shift_gap_days}d · max: {u.max_shifts_per_week}/wk
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <Badge color={u.role === 'admin' ? 'blue' : 'gray'}>{u.role}</Badge>
                  {u.otp_enabled && <Badge color="green">OTP</Badge>}
                  {u.telegram_chat_id ? (
                    <Badge color="blue">TG ✓</Badge>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => getLinkCode(u.id)}>Link TG</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function CreateUserModal({ onClose, onCreate }) {
  const [form, setForm] = useState({
    username: '', display_name: '', password: '', role: 'engineer',
    telegram_username: '', min_shift_gap_days: 2, max_shifts_per_week: 3,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <Overlay onClose={onClose} title="Add team member">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input label="Username" value={form.username} onChange={e => set('username', e.target.value)} autoFocus />
        <Input label="Display name" value={form.display_name} onChange={e => set('display_name', e.target.value)} />
        <Input label="Password" type="password" value={form.password} onChange={e => set('password', e.target.value)} />
        <Input label="Telegram username" value={form.telegram_username} onChange={e => set('telegram_username', e.target.value)} placeholder="@username" />
        <div style={{ display: 'flex', gap: '12px' }}>
          <Input label="Min gap (days)" type="number" value={form.min_shift_gap_days} onChange={e => set('min_shift_gap_days', parseInt(e.target.value))} style={{ width: '100px' }} />
          <Input label="Max shifts/week" type="number" value={form.max_shifts_per_week} onChange={e => set('max_shifts_per_week', parseInt(e.target.value))} style={{ width: '100px' }} />
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onCreate(form)} disabled={!form.username || !form.display_name || !form.password}>Create</Button>
        </div>
      </div>
    </Overlay>
  );
}
