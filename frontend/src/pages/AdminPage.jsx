import { useState, useEffect } from 'react';
import { api, getPublicConfig } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Card, Button, Input, Badge, Select, Overlay, Toast, Tabs, EmptyState } from '../components/UI';

export default function AdminPage() {
  const { t: tr } = useLang();
  const [tab, setTab] = useState('users');
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{tr('adminPanel')}</h2>
        <Tabs tabs={[
          { id: 'users', label: tr('users') }, { id: 'groups', label: tr('groups') },
          { id: 'shifts', label: tr('shiftConfig') }, { id: 'telegram', label: tr('telegram') },
          { id: 'tg-templates', label: 'TG Templates' },
          { id: 'logs', label: tr('logs') },
        ]} active={tab} onChange={setTab} />
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'groups' && <GroupsTab />}
      {tab === 'shifts' && <ShiftConfigTab />}
      {tab === 'telegram' && <TelegramTab />}
      {tab === 'tg-templates' && <TelegramTemplatesTab />}
      {tab === 'logs' && <LogsTab />}
    </div>
  );
}

// ─── Users Tab ──────────────────────────────────────────
function UsersTab() {
  const { theme: t } = useTheme();
  const [users, setUsers] = useState([]); const [groups, setGroups] = useState([]);
  const [show, setShow] = useState(false); const [toast, setToast] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [linkCodes, setLinkCodes] = useState({});
  const [botUsername, setBotUsername] = useState('');
  const load = () => Promise.all([api('/users/'), api('/groups/')]).then(([u, g]) => { setUsers(u || []); setGroups(g || []); });
  useEffect(() => {
    load();
    getPublicConfig().then(c => setBotUsername(c.telegram_bot_username || ''));
  }, []);

  const create = async f => {
    try {
      const payload = { ...f, telegram_username: f.telegram_username || null };
      await api('/users/', { method: 'POST', body: JSON.stringify(payload) });
      setShow(false); load(); setToast({ message: 'User created', type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };
  const edit = async (id, f) => {
    try {
      const payload = { ...f, telegram_username: f.telegram_username || null };
      await api(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      setEditTarget(null); load(); setToast({ message: 'User updated', type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };
  const deactivate = async id => { try { await api(`/users/${id}`, { method: 'DELETE' }); load(); setToast({ message: 'Deactivated', type: 'info' }); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const reactivate = async id => { try { await api(`/users/${id}/reactivate`, { method: 'POST' }); load(); setToast({ message: 'Reactivated', type: 'success' }); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const hardDelete = async (id, name) => {
    if (!confirm(`Permanently delete ${name}? This cannot be undone.`)) return;
    try { await api(`/users/${id}/hard`, { method: 'DELETE' }); load(); setToast({ message: 'User permanently deleted', type: 'info' }); } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };
  const resetPw = async pw => { try { await api(`/users/${resetTarget}/reset-password`, { method: 'POST', body: JSON.stringify({ new_password: pw }) }); setResetTarget(null); setToast({ message: 'Password reset', type: 'success' }); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const resetOtp = async id => { if (!confirm('Reset 2FA for this user?')) return; try { await api(`/users/${id}/reset-otp`, { method: 'POST' }); load(); setToast({ message: '2FA reset', type: 'success' }); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const linkTg = async id => {
    try {
      const r = await api(`/users/${id}/telegram-link-code`, { method: 'POST' });
      setLinkCodes(prev => ({ ...prev, [id]: r.code }));
      try { await navigator.clipboard.writeText(`/link ${r.code}`); } catch {}
      setToast({ message: `Copied! Send to bot: /link ${r.code}`, type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };
  const copyCode = async (id) => {
    try { await navigator.clipboard.writeText(`/link ${linkCodes[id]}`); setToast({ message: `Copied! Send to bot: /link ${linkCodes[id]}`, type: 'success' }); } catch {}
  };
  const groupMap = {}; groups.forEach(g => { groupMap[g.id] = g; });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" onClick={() => setShow(true)}>+ Add user</Button></div>
      <Card style={{ padding: '4px' }}>
        {users.map((u, i) => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', gap: '12px', flexWrap: 'wrap', borderBottom: i < users.length - 1 ? `1px solid ${t.borderLight}` : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: u.name_color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: u.name_color, fontSize: '14px' }}>{u.display_name[0]}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: u.is_active ? t.text : t.textMuted }}>{u.display_name} {!u.is_active && '(inactive)'}</div>
                <div style={{ fontSize: '12px', color: t.textMuted, fontFamily: t.fontMono }}>
                  @{u.username} · gap:{u.min_shift_gap_days}d max:{u.max_shifts_per_week}/wk
                  {u.allowed_shift_types && ` · shifts: ${u.allowed_shift_types.join(',')}`}
                </div>
                {u.availability_pattern && (
                  <div style={{ fontSize: '11px', color: t.warning, marginTop: '2px' }}>
                    🔄 Cycle: {u.availability_pattern.cycle_days}d, works days {u.availability_pattern.work_days.join(',')}
                    {u.availability_pattern.blocked_weekdays?.length > 0 && ` · blocked: ${u.availability_pattern.blocked_weekdays.map(d => ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][d]).join(',')}`}
                  </div>
                )}
                {u.group_ids?.length > 0 && <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>{u.group_ids.map(gid => groupMap[gid] && <Badge key={gid} color="blue">{groupMap[gid].name}</Badge>)}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <Badge color={u.role === 'admin' ? 'blue' : 'gray'}>{u.role}</Badge>
              {u.otp_enabled && <Badge color="green">OTP</Badge>}
              {u.telegram_chat_id
                ? <Badge color="blue">TG ✓</Badge>
                : linkCodes[u.id]
                  ? <span onClick={() => copyCode(u.id)} title="Click to copy" style={{ cursor: 'pointer' }}><Badge color="yellow">📋 /link {linkCodes[u.id]}</Badge></span>
                  : <Button size="sm" variant="ghost" onClick={() => linkTg(u.id)}>Link TG</Button>}
              {u.is_active && <Button size="sm" variant="ghost" onClick={() => setEditTarget(u)}>Edit</Button>}
              {u.is_active && <Button size="sm" variant="ghost" onClick={() => setResetTarget(u.id)}>Reset PW</Button>}
              {u.is_active && u.otp_enabled && <Button size="sm" variant="ghost" onClick={() => resetOtp(u.id)}>Reset 2FA</Button>}
              {u.is_active && u.role !== 'admin' && <Button size="sm" variant="danger" onClick={() => deactivate(u.id)}>Deactivate</Button>}
              {!u.is_active && <Button size="sm" variant="ghost" onClick={() => reactivate(u.id)}>Reactivate</Button>}
              {!u.is_active && <Button size="sm" variant="danger" onClick={() => hardDelete(u.id, u.display_name)}>Delete</Button>}
            </div>
          </div>
        ))}
      </Card>
      {show && <CreateUserModal onClose={() => setShow(false)} onCreate={create} groups={groups} />}
      {editTarget && <EditUserModal user={editTarget} onClose={() => setEditTarget(null)} onSave={(f) => edit(editTarget.id, f)} groups={groups} />}
      {resetTarget && <ResetPasswordModal onClose={() => setResetTarget(null)} onReset={resetPw} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
}

const ALL_SHIFT_TYPES = [
  { value: 'day', label: '☀️ Day' },
  { value: 'night', label: '🌙 Night' },
  { value: 'office', label: '🏢 Office' },
];

function CreateUserModal({ onClose, onCreate, groups }) {
  const { theme: t } = useTheme();
  const [f, setF] = useState({ username:'', display_name:'', password:'', role:'engineer', telegram_username:'', min_shift_gap_days:2, max_shifts_per_week:3, group_ids:[] });
  const [allowedTypes, setAllowedTypes] = useState(['day','night','office']);
  const s = (k,v) => setF(p => ({...p,[k]:v}));
  const toggleGroup = id => s('group_ids', f.group_ids.includes(id) ? f.group_ids.filter(x=>x!==id) : [...f.group_ids, id]);
  const toggleType = v => setAllowedTypes(prev => prev.includes(v) ? prev.filter(x=>x!==v) : [...prev, v]);
  const handleCreate = () => {
    // null = no restriction; [] = never assign; partial list = only those types
    const types = allowedTypes.length === 3 ? null : allowedTypes;
    onCreate({ ...f, allowed_shift_types: types });
  };
  return (
    <Overlay onClose={onClose} title="Add User">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input label="Username" value={f.username} onChange={e => s('username', e.target.value)} autoFocus />
        <Input label="Display name" value={f.display_name} onChange={e => s('display_name', e.target.value)} />
        <Input label="Password" type="password" value={f.password} onChange={e => s('password', e.target.value)} />
        <Select label="Role" value={f.role} onChange={e => s('role', e.target.value)}><option value="engineer">Engineer</option><option value="admin">Admin</option></Select>
        <Input label="Telegram" value={f.telegram_username} onChange={e => s('telegram_username', e.target.value)} placeholder="@username" />
        <div style={{ display: 'flex', gap: '12px' }}>
          <Input label="Min gap (d)" type="number" value={f.min_shift_gap_days} onChange={e => s('min_shift_gap_days', parseInt(e.target.value))} style={{ width: '100px' }} />
          <Input label="Max/wk" type="number" value={f.max_shifts_per_week} onChange={e => s('max_shifts_per_week', parseInt(e.target.value))} style={{ width: '100px' }} />
        </div>
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px', display: 'block' }}>
            Allowed shift types <span style={{ fontWeight: 400, color: t.textMuted }}>(all = no restriction · none = exclude from generator)</span>
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {ALL_SHIFT_TYPES.map(st => (
              <Button key={st.value} size="sm" variant={allowedTypes.includes(st.value) ? 'primary' : 'secondary'} onClick={() => toggleType(st.value)}>{st.label}</Button>
            ))}
          </div>
        </div>
        {groups.length > 0 && <div>
          <label style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px', display: 'block' }}>Groups</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{groups.map(g => <Button key={g.id} size="sm" variant={f.group_ids.includes(g.id) ? 'primary' : 'secondary'} onClick={() => toggleGroup(g.id)}>{g.name}</Button>)}</div>
        </div>}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!f.username || !f.display_name || !f.password}>Create</Button>
        </div>
      </div>
    </Overlay>
  );
}

function EditUserModal({ user, onClose, onSave, groups }) {
  const { theme: t } = useTheme();
  const [f, setF] = useState({
    display_name: user.display_name,
    role: user.role,
    min_shift_gap_days: user.min_shift_gap_days,
    max_shifts_per_week: user.max_shifts_per_week,
    group_ids: user.group_ids || [],
    telegram_username: user.telegram_username || '',
  });
  const [allowedTypes, setAllowedTypes] = useState(user.allowed_shift_types || ['day','night','office']);
  const toggleType = v => setAllowedTypes(prev => prev.includes(v) ? prev.filter(x=>x!==v) : [...prev, v]);
  const [hasPattern, setHasPattern] = useState(!!user.availability_pattern);
  const [pattern, setPattern] = useState(user.availability_pattern || { cycle_days: 4, work_days: [2, 3, 4], blocked_weekdays: [] });
  const [anchor, setAnchor] = useState(user.availability_anchor_date || '');

  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const toggleGroup = id => s('group_ids', f.group_ids.includes(id) ? f.group_ids.filter(x => x !== id) : [...f.group_ids, id]);
  const toggleWorkDay = d => setPattern(p => ({ ...p, work_days: p.work_days.includes(d) ? p.work_days.filter(x => x !== d) : [...p.work_days, d].sort() }));
  const toggleBlockedDay = d => setPattern(p => ({ ...p, blocked_weekdays: p.blocked_weekdays.includes(d) ? p.blocked_weekdays.filter(x => x !== d) : [...p.blocked_weekdays, d].sort() }));

  const handleSave = () => {
    const data = { ...f };
    if (hasPattern) {
      data.availability_pattern = pattern;
      data.availability_anchor_date = anchor || null;
    } else {
      data.availability_pattern = null;
      data.availability_anchor_date = null;
    }
    data.allowed_shift_types = allowedTypes.length === 3 ? null : allowedTypes;
    onSave(data);
  };

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  return (
    <Overlay onClose={onClose} title={`Edit ${user.display_name}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '70vh', overflowY: 'auto' }}>
        <Input label="Display name" value={f.display_name} onChange={e => s('display_name', e.target.value)} />
        <Select label="Role" value={f.role} onChange={e => s('role', e.target.value)}><option value="engineer">Engineer</option><option value="admin">Admin</option></Select>
        <Input label="Telegram" value={f.telegram_username} onChange={e => s('telegram_username', e.target.value)} />
        <div style={{ display: 'flex', gap: '12px' }}>
          <Input label="Min gap (d)" type="number" value={f.min_shift_gap_days} onChange={e => s('min_shift_gap_days', parseInt(e.target.value))} style={{ width: '100px' }} />
          <Input label="Max/wk" type="number" value={f.max_shifts_per_week} onChange={e => s('max_shifts_per_week', parseInt(e.target.value))} style={{ width: '100px' }} />
        </div>

        {groups.length > 0 && <div>
          <label style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px', display: 'block' }}>Groups</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{groups.map(g => <Button key={g.id} size="sm" variant={f.group_ids.includes(g.id) ? 'primary' : 'secondary'} onClick={() => toggleGroup(g.id)}>{g.name}</Button>)}</div>
        </div>}

        {/* Allowed shift types */}
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px', display: 'block' }}>
            Allowed shift types <span style={{ fontWeight: 400, color: t.textMuted }}>(all = no restriction)</span>
          </label>
          <div style={{ display: 'flex', gap: '6px' }}>
            {ALL_SHIFT_TYPES.map(st => (
              <Button key={st.value} size="sm" variant={allowedTypes.includes(st.value) ? 'primary' : 'secondary'} onClick={() => toggleType(st.value)}>{st.label}</Button>
            ))}
          </div>
        </div>

        {/* Availability Pattern */}
        <div style={{ padding: '16px', background: t.surfaceAlt, borderRadius: t.radiusSm }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', marginBottom: hasPattern ? '14px' : 0 }}>
            <input type="checkbox" checked={hasPattern} onChange={e => setHasPattern(e.target.checked)} />
            Custom availability pattern
          </label>
          {!hasPattern && (
            <p style={{ fontSize: '12px', color: t.textMuted, margin: 0 }}>
              Not set — this engineer can be assigned any day without restriction. Enable only for engineers who have a <strong>fixed external schedule</strong> (e.g. another job with rotating shifts).
            </p>
          )}

          {hasPattern && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <p style={{ fontSize: '12px', color: t.textMuted, margin: 0 }}>
                For engineers with another job on a fixed rotation. Define the full cycle length and mark which days they're <em>available to you</em>.<br />
                <strong>Example:</strong> Works 24h at hospital, then 3 days free → Cycle: 4 days, available on days 2, 3, 4 (day 1 = hospital shift). Set anchor = the date their next hospital shift starts.
              </p>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary }}>Cycle length (days)</label>
                  <input type="number" value={pattern.cycle_days} onChange={e => setPattern(p => ({ ...p, cycle_days: parseInt(e.target.value) || 2 }))}
                    min="2" max="30" style={{ padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: t.radiusSm, fontSize: '14px', background: t.surface, color: t.text, width: '80px' }} />
                </div>
                <Input label="Cycle anchor date" type="date" value={anchor} onChange={e => setAnchor(e.target.value)} style={{ width: '160px' }} />
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary, display: 'block', marginBottom: '6px' }}>
                  Available on days (in cycle of {pattern.cycle_days})
                </label>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {Array.from({ length: pattern.cycle_days }, (_, i) => i + 1).map(d => (
                    <button key={d} onClick={() => toggleWorkDay(d)} style={{
                      width: '36px', height: '36px', borderRadius: '6px', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                      border: pattern.work_days.includes(d) ? `2px solid ${t.success}` : `1px solid ${t.border}`,
                      background: pattern.work_days.includes(d) ? t.successLight : t.surface,
                      color: pattern.work_days.includes(d) ? t.success : t.textMuted,
                    }}>{d}</button>
                  ))}
                </div>
                <div style={{ fontSize: '11px', color: t.textMuted, marginTop: '4px' }}>
                  Green = available for shifts. Click to toggle. Day 1 starts on anchor date.
                </div>
              </div>

              <div>
                <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary, display: 'block', marginBottom: '6px' }}>
                  Blocked weekdays (never available)
                </label>
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                  {WEEKDAYS.map((name, i) => (
                    <button key={i} onClick={() => toggleBlockedDay(i)} style={{
                      padding: '6px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 500, cursor: 'pointer',
                      border: pattern.blocked_weekdays.includes(i) ? `2px solid ${t.danger}` : `1px solid ${t.border}`,
                      background: pattern.blocked_weekdays.includes(i) ? t.dangerLight : t.surface,
                      color: pattern.blocked_weekdays.includes(i) ? t.danger : t.textMuted,
                    }}>{name}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </div>
    </Overlay>
  );
}

function ResetPasswordModal({ onClose, onReset }) {
  const [pw, setPw] = useState('');
  return (
    <Overlay onClose={onClose} title="Reset Password">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label="New password" type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onReset(pw)} disabled={pw.length < 8}>Reset</Button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Groups Tab ─────────────────────────────────────────
function GroupsTab() {
  const { theme: t } = useTheme();
  const [groups, setGroups] = useState([]); const [users, setUsers] = useState([]); const [show, setShow] = useState(false); const [toast, setToast] = useState(null);
  const load = () => Promise.all([api('/groups/'), api('/users/')]).then(([g, u]) => { setGroups(g || []); setUsers(u || []); });
  useEffect(() => { load(); }, []);
  const create = async f => { try { await api('/groups/', { method: 'POST', body: JSON.stringify(f) }); setShow(false); load(); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const del = async id => { try { await api(`/groups/${id}`, { method: 'DELETE' }); load(); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const userMap = {}; users.forEach(u => { userMap[u.id] = u; });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" onClick={() => setShow(true)}>+ Add group</Button></div>
      {groups.length === 0 ? <Card><EmptyState icon="👥" title="No groups" subtitle="Create a group to organize your team" /></Card> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {groups.map(g => (
            <Card key={g.id} style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: g.color }} />
                  <span style={{ fontWeight: 600 }}>{g.name}</span>
                  {g.description && <span style={{ fontSize: '13px', color: t.textMuted }}>— {g.description}</span>}
                </div>
                <Button size="sm" variant="danger" onClick={() => del(g.id)}>Delete</Button>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {g.member_ids?.map(uid => userMap[uid] && <Badge key={uid} color="gray">{userMap[uid].display_name}</Badge>)}
                {(!g.member_ids || g.member_ids.length === 0) && <span style={{ fontSize: '12px', color: t.textMuted }}>No members</span>}
              </div>
            </Card>
          ))}
        </div>
      }
      {show && <Overlay onClose={() => setShow(false)} title="Create Group">
        <GroupForm onSubmit={f => { create(f); }} onClose={() => setShow(false)} />
      </Overlay>}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
}

function GroupForm({ onSubmit, onClose }) {
  const [name, setName] = useState(''); const [desc, setDesc] = useState(''); const [color, setColor] = useState('#6366f1');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <Input label="Name" value={name} onChange={e => setName(e.target.value)} autoFocus />
      <Input label="Description" value={desc} onChange={e => setDesc(e.target.value)} />
      <Input label="Color" type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: '60px', height: '36px', padding: '2px' }} />
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit({ name, description: desc || null, color })} disabled={!name}>Create</Button>
      </div>
    </div>
  );
}

// ─── Shift Config Tab ───────────────────────────────────
function ShiftConfigTab() {
  const { theme: t } = useTheme();
  const [configs, setConfigs] = useState([]);
  const [toast, setToast] = useState(null);
  const [portalTz, setPortalTz] = useState('UTC');
  const load = () => api('/admin/shift-configs').then(d => setConfigs(d || []));
  useEffect(() => {
    load();
    getPublicConfig().then(c => setPortalTz(c.portal_timezone || 'UTC'));
  }, []);
  const update = async (id, data) => {
    try {
      await api(`/admin/shift-configs/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
      load();
      setToast({ message: 'Saved', type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  return (
    <>
      <p style={{ fontSize: '13px', color: t.textMuted, marginBottom: '4px' }}>
        Configure shift types, durations, and default times. Changes apply to newly generated schedules.
      </p>
      <div style={{ fontSize: '12px', padding: '8px 12px', background: t.surfaceAlt, borderRadius: t.radiusSm, marginBottom: '12px', color: t.textSecondary }}>
        Times are in <strong>{portalTz}</strong>. Users receive notifications converted to their own profile timezone.
        To change, set <code>PORTAL_TIMEZONE</code> in your <code>.env</code>.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {configs.map(c => <ShiftConfigCard key={c.id} config={c} onUpdate={data => update(c.id, data)} />)}
      </div>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
}

function ShiftConfigCard({ config: c, onUpdate }) {
  const { theme: t } = useTheme();
  const [label, setLabel] = useState(c.label);
  const [duration, setDuration] = useState(c.duration_hours);
  const [startTime, setStartTime] = useState(c.default_start_time?.slice(0, 5) || '');
  const [endTime, setEndTime] = useState(c.default_end_time?.slice(0, 5) || '');
  const [emoji, setEmoji] = useState(c.emoji);
  const [reqLoc, setReqLoc] = useState(c.requires_location);
  const emojiOptions = ['☀️', '🌙', '🏢', '🌤', '⭐', '🔥', '💼', '🎯'];

  const save = () => onUpdate({
    label, duration_hours: duration, emoji, requires_location: reqLoc,
    default_start_time: startTime || null, default_end_time: endTime || null,
  });

  return (
    <Card style={{ padding: '20px' }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '24px' }}>{emoji}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: '15px' }}>{label}</div>
            <div style={{ fontSize: '12px', color: t.textMuted, fontFamily: t.fontMono }}>
              {c.shift_type} · {duration}h · {startTime || '—'} – {endTime || '—'}
              {reqLoc && ' · 📍 location'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input type="color" value={c.color} onChange={e => onUpdate({ color: e.target.value })}
            style={{ width: '32px', height: '32px', border: 'none', cursor: 'pointer', borderRadius: '4px' }} />
          <Button size="sm" variant={c.is_active ? 'secondary' : 'danger'}
            onClick={() => onUpdate({ is_active: !c.is_active })}>
            {c.is_active ? 'Active' : 'Disabled'}
          </Button>
        </div>
      </div>

      {/* Always-visible editor */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', background: t.surfaceAlt, borderRadius: t.radiusSm }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Input label="Label" value={label} onChange={e => setLabel(e.target.value)} style={{ flex: '1', minWidth: '150px' }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary }}>Duration (h)</label>
            <input type="number" value={duration} onChange={e => setDuration(parseFloat(e.target.value))}
              min="1" max="24" step="0.5"
              style={{ padding: '9px 12px', border: `1px solid ${t.border}`, borderRadius: t.radiusSm, fontSize: '14px', background: t.surface, color: t.text, width: '90px' }} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <Input label="Start time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} style={{ width: '140px' }} />
          <Input label="End time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} style={{ width: '140px' }} />
        </div>
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary, display: 'block', marginBottom: '6px' }}>Emoji</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {emojiOptions.map(e => (
              <button key={e} onClick={() => setEmoji(e)} style={{
                width: '36px', height: '36px', borderRadius: '6px', fontSize: '18px', cursor: 'pointer',
                border: emoji === e ? `2px solid ${t.accent}` : `1px solid ${t.border}`,
                background: emoji === e ? t.accentLight : t.surface,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{e}</button>
            ))}
          </div>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={reqLoc} onChange={e => setReqLoc(e.target.checked)} />
          Requires location (onsite / remote)
        </label>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button onClick={save}>Save changes</Button>
        </div>
      </div>
    </Card>
  );
}

// ─── Telegram Chats Tab ─────────────────────────────────
function TelegramTab() {
  const { theme: t } = useTheme();
  const [chats, setChats] = useState([]);
  const [show, setShow] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [diagResult, setDiagResult] = useState(null);
  const [diagLoading, setDiagLoading] = useState(false);

  const load = () => api('/admin/telegram-chats').then(d => setChats(d || []));
  useEffect(() => { load(); }, []);

  const create = async f => { try { await api('/admin/telegram-chats', { method: 'POST', body: JSON.stringify(f) }); setShow(false); load(); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const update = async (id, data) => { try { await api(`/admin/telegram-chats/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); load(); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const del = async id => { if (!confirm('Delete this chat?')) return; try { await api(`/admin/telegram-chats/${id}`, { method: 'DELETE' }); load(); } catch (e) { setToast({ message: e.message, type: 'error' }); }};

  const runDiagnostics = async () => {
    setDiagLoading(true); setDiagResult(null);
    try { setDiagResult(await api('/admin/telegram-diagnostics')); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
    finally { setDiagLoading(false); }
  };

  const testChat = async (chatId) => {
    try {
      await api('/admin/test-notification', { method: 'POST', body: JSON.stringify({
        title: 'Test message',
        message: 'This is a test from the portal admin panel.',
        send_telegram: false,
        telegram_chat_db_ids: [chatId],
      })});
      setToast({ message: 'Test message sent to chat', type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const flags = ['notify_day_shift_start','notify_night_shift_start','notify_office_roster','notify_reminders','notify_general'];
  const flagLabels = { notify_day_shift_start: '☀️ Day', notify_night_shift_start: '🌙 Night', notify_office_roster: '🏢 Office', notify_reminders: '🔔 Reminders', notify_general: '📢 General' };

  return (
    <>
      {/* Bot diagnostics */}
      <div style={{ padding: '14px 16px', background: t.surfaceAlt, borderRadius: t.radiusSm, marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: diagResult ? '12px' : '0' }}>
          <div>
            <div style={{ fontSize: '13px', fontWeight: 600 }}>Bot diagnostics</div>
            <div style={{ fontSize: '12px', color: t.textMuted }}>Verifies token + sends a probe message to every chat and linked DM.</div>
          </div>
          <Button size="sm" variant="secondary" onClick={runDiagnostics} disabled={diagLoading} style={{ flexShrink: 0, marginLeft: '12px' }}>
            {diagLoading ? 'Running…' : 'Run diagnostics'}
          </Button>
        </div>
        {diagResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px' }}>
            {/* Bot token */}
            <div style={{ fontSize: '12px', padding: '6px 10px', borderRadius: t.radiusSm, background: diagResult.bot?.ok ? '#10b98120' : '#ef444420', color: diagResult.bot?.ok ? '#059669' : '#dc2626' }}>
              {diagResult.bot?.ok
                ? `✓ Bot token valid — @${diagResult.bot.username} (${diagResult.bot.name})`
                : `✗ Bot token error: ${diagResult.bot?.error}`}
            </div>
            {/* Group chats */}
            {diagResult.chats?.map((c, i) => (
              <div key={i} style={{ fontSize: '12px', padding: '6px 10px', borderRadius: t.radiusSm, background: c.ok ? '#10b98120' : '#ef444420', color: c.ok ? '#059669' : '#dc2626' }}>
                {c.ok ? `✓ ${c.name} (${c.chat_id}) — message delivered` : `✗ ${c.name} (${c.chat_id}) — delivery failed`}
              </div>
            ))}
            {/* Personal DMs */}
            {diagResult.personal_dms?.map((u, i) => (
              <div key={i} style={{ fontSize: '12px', padding: '6px 10px', borderRadius: t.radiusSm, background: u.ok ? '#10b98120' : '#ef444420', color: u.ok ? '#059669' : '#dc2626' }}>
                {u.ok ? `✓ DM to ${u.display_name} — delivered` : `✗ DM to ${u.display_name} — failed`}
              </div>
            ))}
            {diagResult.chats?.length === 0 && diagResult.personal_dms?.length === 0 && (
              <div style={{ fontSize: '12px', color: t.textMuted }}>No configured chats and no linked users to probe.</div>
            )}
          </div>
        )}
      </div>

      {/* Shift notification test */}
      <ShiftNotificationTest />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <Button size="sm" onClick={() => setShow(true)}>+ Add chat</Button>
      </div>

      {chats.length === 0
        ? <Card><EmptyState icon="💬" title="No Telegram chats" subtitle="Add group chats to receive notifications" /></Card>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {chats.map(c => (
              <Card key={c.id} style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>{c.name}</div>
                    <div style={{ fontSize: '12px', color: t.textMuted, fontFamily: t.fontMono, marginBottom: '10px' }}>
                      ID: {c.chat_id} · {c.chat_type}{c.topic_id ? ` · topic: ${c.topic_id}` : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {flags.map(f => (
                        <Button key={f} size="sm" variant={c[f] ? 'primary' : 'secondary'} onClick={() => update(c.id, { [f]: !c[f] })}>
                          {flagLabels[f]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                    <Button size="sm" variant="secondary" onClick={() => testChat(c.id)} title="Send a test message to this chat">Test</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditTarget(c)}>Edit</Button>
                    <Button size="sm" variant="danger" onClick={() => del(c.id)}>Delete</Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
      }

      {show && <ChatModal onClose={() => setShow(false)} onSave={create} />}
      {editTarget && <ChatModal chat={editTarget} onClose={() => setEditTarget(null)} onSave={async f => { await update(editTarget.id, f); setEditTarget(null); }} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
}

function ChatModal({ chat, onClose, onSave }) {
  const { theme: t } = useTheme();
  const [f, setF] = useState({
    chat_id:  chat?.chat_id  ?? '',
    name:     chat?.name     ?? '',
    chat_type: chat?.chat_type ?? 'group',
    topic_id: chat?.topic_id ?? '',
  });
  const [templates, setTemplates] = useState([]);
  const s = (k, v) => setF(p => ({ ...p, [k]: v }));
  const isEdit = !!chat;

  useEffect(() => {
    api('/admin/telegram-templates').then(setTemplates).catch(() => {});
  }, []);

  const selStyle = { padding: '8px 10px', borderRadius: t.radiusSm, border: `1px solid ${t.border}`, fontSize: '13px', background: t.surfaceAlt, color: t.text, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' };

  return (
    <Overlay onClose={onClose} title={isEdit ? 'Edit Telegram Chat' : 'Add Telegram Chat'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {templates.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <label style={{ fontSize: '11px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>From template</label>
            <select style={selStyle} value="" onChange={e => {
              const tpl = templates.find(tp => String(tp.id) === e.target.value);
              if (tpl) { s('chat_id', tpl.chat_id); s('topic_id', tpl.topic_id ? String(tpl.topic_id) : ''); }
            }}>
              <option value="">— pick a template to fill fields —</option>
              {templates.map(tp => (
                <option key={tp.id} value={tp.id}>{tp.name}{tp.topic_id ? ` (topic ${tp.topic_id})` : ''}</option>
              ))}
            </select>
          </div>
        )}
        <Input label="Chat / Channel ID" value={f.chat_id} onChange={e => s('chat_id', e.target.value)} placeholder="-1001234567890" />
        <Input label="Name" value={f.name} onChange={e => s('name', e.target.value)} placeholder="Support Team Chat" />
        <Select label="Type" value={f.chat_type} onChange={e => s('chat_type', e.target.value)}>
          <option value="group">Group</option>
          <option value="channel">Channel</option>
        </Select>
        <Input label="Thread / Topic ID (optional)" value={f.topic_id} onChange={e => s('topic_id', e.target.value)} placeholder="For forum topics" />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave({ ...f, topic_id: f.topic_id || null })} disabled={!f.chat_id || !f.name}>
            {isEdit ? 'Save changes' : 'Add'}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Shift Notification Test ─────────────────────────────
function ShiftNotificationTest() {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [testingShift, setTestingShift] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [toast, setToast] = useState(null);

  const loadPreview = async () => {
    setLoadingPreview(true);
    try {
      const data = await api('/admin/telegram-shift-preview');
      setPreview(data);
    } catch {}
    finally { setLoadingPreview(false); }
  };

  useEffect(() => { loadPreview(); }, []);

  const testShift = async (type) => {
    setTestingShift(type);
    setTestResult(null);
    try {
      const r = await api(`/admin/test-telegram-shift?shift_type=${type}`, { method: 'POST' });
      setTestResult({ type, ...r });
      setToast({ message: `${type} notification sent — check Telegram`, type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
    finally { setTestingShift(null); }
  };

  const nameList = (names) =>
    names?.length > 0
      ? names.map(n => `  • ${n}`).join('\n')
      : '  No one assigned';

  const previewMsg = (type) => {
    if (!preview) return tr('loading');
    if (type === 'day') {
      return [
        `☀️ Day Shift Starting`,
        preview.today,
        `━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `👥 On duty now:`,
        nameList(preview.day_today),
        ``,
        `🌙 Tonight's night shift:`,
        nameList(preview.night_today),
      ].join('\n');
    }
    return [
      `🌙 Night Shift Starting`,
      preview.today,
      `━━━━━━━━━━━━━━━━━━━━`,
      ``,
      `👥 On duty now:`,
      nameList(preview.night_today),
      ``,
      `☀️ Tomorrow's day shift (${preview.tomorrow}):`,
      nameList(preview.day_tomorrow),
    ].join('\n');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>Test shift notifications</div>
          <div style={{ fontSize: '12px', color: t.textMuted }}>Fires the real notification now — sends to all configured chats + personal DMs.</div>
        </div>
        <Button size="sm" variant="ghost" onClick={loadPreview} disabled={loadingPreview}>
          {loadingPreview ? '…' : '↻ Refresh'}
        </Button>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {['day', 'night'].map(type => (
          <div key={type} style={{ flex: '1', minWidth: '220px', padding: '14px', background: t.surfaceAlt, borderRadius: t.radiusSm, border: `1px solid ${t.border}` }}>
            <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: t.textSecondary }}>
              {type === 'day' ? '☀️ DAY SHIFT' : '🌙 NIGHT SHIFT'} PREVIEW
            </div>
            <pre style={{
              fontFamily: 'inherit', fontSize: '12px', color: t.text,
              whiteSpace: 'pre-wrap', margin: '0 0 12px 0',
              padding: '10px', background: t.surface, borderRadius: t.radiusSm,
              border: `1px solid ${t.borderLight}`, lineHeight: 1.5,
            }}>
              {previewMsg(type)}
            </pre>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <Button size="sm" disabled={testingShift === type} onClick={() => testShift(type)}
                style={{ background: type === 'day' ? '#f59e0b' : '#6366f1', color: '#fff' }}>
                {testingShift === type ? 'Sending…' : `Send ${type} notification`}
              </Button>
              {testResult?.type === type && (
                <span style={{ fontSize: '12px', color: t.success }}>
                  ✓ {testResult.chats_sent} chat(s), {testResult.dms_sent} DM(s)
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div style={{ padding: '10px 14px', background: t.surfaceAlt, borderRadius: t.radiusSm, border: `1px solid ${t.border}` }}>
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '8px', color: t.textSecondary }}>🏢 OFFICE ROSTER</div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <Button size="sm" variant="secondary" disabled={testingShift === 'office'} onClick={() => testShift('office')}>
            {testingShift === 'office' ? 'Sending…' : 'Send office roster'}
          </Button>
          {testResult?.type === 'office' && <span style={{ fontSize: '12px', color: t.success }}>✓ Sent</span>}
        </div>
      </div>
    </div>
  );
}

// ─── Logs Tab ────────────────────────────────────────────
const ACTION_LABELS = {
  login: { label: 'Login', color: 'blue' },
  time_off_requested: { label: 'Time-off request', color: 'yellow' },
  time_off_reviewed: { label: 'Time-off reviewed', color: 'green' },
  schedule_generated: { label: 'Schedule generated', color: 'blue' },
  schedule_published: { label: 'Schedule published', color: 'green' },
  test_notification_sent: { label: 'Test notification', color: 'gray' },
};

function LogsTab() {
  const { theme: t } = useTheme();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    api('/admin/audit-logs')
      .then(d => { setLogs(d || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const displayed = filter
    ? logs.filter(l => l.action === filter || l.username?.includes(filter))
    : logs;

  return (
    <>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
        <Select value={filter} onChange={e => setFilter(e.target.value)} style={{ width: '220px' }}>
          <option value="">All actions</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </Select>
        <Button size="sm" variant="ghost" onClick={() => setFilter('')}>Clear</Button>
      </div>
      <Card style={{ padding: '4px' }}>
        {loading && <div style={{ padding: '24px', textAlign: 'center', color: t.textMuted }}>Loading…</div>}
        {!loading && displayed.length === 0 && <EmptyState icon="📋" title="No log entries" subtitle="Actions will appear here as users interact with the portal" />}
        {displayed.map((log, i) => {
          const meta = ACTION_LABELS[log.action] || { label: log.action, color: 'gray' };
          return (
            <div key={log.id} style={{
              display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 18px',
              borderBottom: i < displayed.length - 1 ? `1px solid ${t.borderLight}` : 'none',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                  <Badge color={meta.color}>{meta.label}</Badge>
                  <span style={{ fontSize: '13px', fontWeight: 600 }}>{log.username || '—'}</span>
                </div>
                {log.details && <div style={{ fontSize: '12px', color: t.textSecondary, marginTop: '2px' }}>{log.details}</div>}
              </div>
              <div style={{ fontSize: '11px', color: t.textMuted, fontFamily: t.fontMono, whiteSpace: 'nowrap', flexShrink: 0 }}>
                {new Date(log.created_at).toLocaleString()}
              </div>
            </div>
          );
        })}
      </Card>
    </>
  );
}

// ─── Telegram Templates Tab ──────────────────────────────
function TelegramTemplatesTab() {
  const { theme: t } = useTheme();
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null); // template object

  const load = () => {
    api('/admin/telegram-templates')
      .then(d => setTemplates(d || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const showToast = (message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSave = async (form) => {
    try {
      if (editing) {
        await api(`/admin/telegram-templates/${editing.id}`, {
          method: 'PATCH', body: JSON.stringify(form),
        });
        showToast('Template updated', 'success');
      } else {
        await api('/admin/telegram-templates', {
          method: 'POST', body: JSON.stringify(form),
        });
        showToast('Template created', 'success');
      }
      setShowForm(false); setEditing(null); load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleDelete = async (tpl) => {
    if (!confirm(`Delete template "${tpl.name}"? Any agents using it will lose their alert.`)) return;
    try {
      await api(`/admin/telegram-templates/${tpl.id}`, { method: 'DELETE' });
      showToast('Deleted', 'info'); load();
    } catch (e) { showToast(e.message, 'error'); }
  };

  return (
    <>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '14px', fontWeight: 600 }}>Telegram Notification Templates</div>
          <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '2px' }}>
            Named presets for Telegram chat destinations. Assign them to container agents for error alerts.
          </div>
        </div>
        <Button size="sm" variant="primary" onClick={() => { setEditing(null); setShowForm(true); }}>
          + Add Template
        </Button>
      </div>

      <Card style={{ padding: '4px' }}>
        {loading && <div style={{ padding: '20px', textAlign: 'center', color: t.textMuted }}>Loading…</div>}
        {!loading && templates.length === 0 && (
          <EmptyState icon="📨" title="No templates yet"
            subtitle="Create a template to quickly assign Telegram destinations to modules" />
        )}
        {templates.map((tpl, i) => (
          <div key={tpl.id} style={{
            display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 18px',
            borderBottom: i < templates.length - 1 ? `1px solid ${t.borderLight}` : 'none',
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: '14px' }}>{tpl.name}</div>
              <div style={{ fontSize: '12px', color: t.textMuted, fontFamily: t.fontMono, marginTop: '2px' }}>
                Chat ID: {tpl.chat_id}{tpl.topic_id ? ` · Topic: ${tpl.topic_id}` : ''}
              </div>
              {tpl.description && (
                <div style={{ fontSize: '12px', color: t.textSecondary, marginTop: '2px' }}>{tpl.description}</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <Button size="sm" variant="ghost" onClick={() => { setEditing(tpl); setShowForm(true); }}>✏️</Button>
              <Button size="sm" variant="danger" onClick={() => handleDelete(tpl)}>🗑</Button>
            </div>
          </div>
        ))}
      </Card>

      {showForm && (
        <TelegramTemplateFormOverlay
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
        />
      )}
    </>
  );
}

function TelegramTemplateFormOverlay({ initial, onClose, onSave }) {
  const [name, setName] = useState(initial?.name || '');
  const [chatId, setChatId] = useState(initial?.chat_id || '');
  const [topicId, setTopicId] = useState(initial?.topic_id?.toString() || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !chatId.trim()) return;
    setSaving(true);
    const form = {
      name: name.trim(),
      chat_id: chatId.trim(),
      topic_id: topicId ? parseInt(topicId) : null,
      description: description.trim() || null,
    };
    await onSave(form);
    setSaving(false);
  };

  return (
    <Overlay title={initial ? 'Edit Template' : 'New Telegram Template'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input label="Template Name *" value={name} onChange={e => setName(e.target.value)}
          placeholder="e.g. ops-alerts-channel" />
        <Input label="Chat ID *" value={chatId} onChange={e => setChatId(e.target.value)}
          placeholder="e.g. -1001234567890" />
        <Input label="Topic ID (optional, for forum groups)" value={topicId}
          onChange={e => setTopicId(e.target.value)} placeholder="e.g. 42" type="number" />
        <Input label="Description (optional)" value={description}
          onChange={e => setDescription(e.target.value)} placeholder="What is this template for?" />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !name.trim() || !chatId.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
