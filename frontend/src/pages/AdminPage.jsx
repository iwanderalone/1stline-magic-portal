import { useState, useEffect, useMemo } from 'react';
import { api, getPublicConfig } from '../api';
import { useLang } from '../components/LangContext';
import { Card, Button, Input, Badge, Select, Overlay, Toast, Tabs, EmptyState } from '../components/UI';
import { Icon } from '../components/Icons';

export default function AdminPage() {
  const { t: tr } = useLang();
  const [tab, setTab] = useState('users');
  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.02em', margin: 0 }}>{tr('adminPanel')}</h2>
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
  const [users, setUsers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [show, setShow] = useState(false);
  const [toast, setToast] = useState(null);
  const [resetTarget, setResetTarget] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [linkCodes, setLinkCodes] = useState({});
  const [botUsername, setBotUsername] = useState('');

  const load = () => Promise.all([
    api('/users/'),
    api('/groups/'),
    api('/schedule/shift-configs')
  ]).then(([u, g, c]) => {
    setUsers(u || []);
    setGroups(g || []);
    setConfigs(c || []);
  });

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
      setToast({ message: `Copied! Send to @${botUsername}: /link ${r.code}`, type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const copyCode = async (id) => {
    try { await navigator.clipboard.writeText(`/link ${linkCodes[id]}`); setToast({ message: `Copied! Send to @${botUsername}: /link ${linkCodes[id]}`, type: 'success' }); } catch {}
  };

  const groupMap = {}; groups.forEach(g => { groupMap[g.id] = g; });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" icon="plus" onClick={() => setShow(true)}>Add User</Button></div>
      <Card style={{ padding: '4px' }}>
        {users.map((u, i) => (
          <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', gap: '12px', flexWrap: 'wrap', borderBottom: i < users.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: u.name_color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: u.name_color, fontSize: '14px' }}>{u.display_name[0]}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: '14px', color: u.is_active ? 'var(--text)' : 'var(--text-muted)' }}>{u.display_name} {!u.is_active && '(inactive)'}</div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                  @{u.username} · gap:{u.min_shift_gap_days}d max:{u.max_shifts_per_week}/wk
                  {u.allowed_shift_types && ` · shifts: ${u.allowed_shift_types.join(',')}`}
                </div>
                {u.group_ids?.length > 0 && <div style={{ display: 'flex', gap: '4px', marginTop: '3px', flexWrap: 'wrap' }}>{u.group_ids.map(gid => groupMap[gid] && <Badge key={gid} color="blue">{groupMap[gid].name}</Badge>)}</div>}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <Badge color={u.role === 'admin' ? 'blue' : 'gray'}>{u.role}</Badge>
              {u.otp_enabled && <Badge color="green">OTP</Badge>}
              {u.telegram_chat_id
                ? <Badge color="blue"><div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>TG <Icon name="check" size={12} /></div></Badge>
                : linkCodes[u.id]
                  ? <span onClick={() => copyCode(u.id)} title="Click to copy" style={{ cursor: 'pointer' }}><Badge color="yellow"><Icon name="copy" size={12} /> /link {linkCodes[u.id]}</Badge></span>
                  : <Button size="sm" variant="ghost" onClick={() => linkTg(u.id)}>Link TG</Button>}
              {u.is_active && <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditTarget(u)}>Edit</Button>}
              {u.is_active && <Button size="sm" variant="ghost" icon="key" onClick={() => setResetTarget(u.id)}>Reset PW</Button>}
              {u.is_active && u.otp_enabled && <Button size="sm" variant="ghost" onClick={() => resetOtp(u.id)}>Reset 2FA</Button>}
              {u.is_active && u.role !== 'admin' && <Button size="sm" variant="danger" onClick={() => deactivate(u.id)}>Deactivate</Button>}
              {!u.is_active && <Button size="sm" variant="ghost" onClick={() => reactivate(u.id)}>Reactivate</Button>}
              {!u.is_active && <Button size="sm" variant="danger" icon="trash" onClick={() => hardDelete(u.id, u.display_name)}>Delete</Button>}
            </div>
          </div>
        ))}
      </Card>
      {show && <CreateUserModal onClose={() => setShow(false)} onCreate={create} groups={groups} configs={configs} />}
      {editTarget && <EditUserModal user={editTarget} onClose={() => setEditTarget(null)} onSave={(f) => edit(editTarget.id, f)} groups={groups} configs={configs} />}
      {resetTarget && <ResetPasswordModal onClose={() => setResetTarget(null)} onReset={resetPw} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
}

function CreateUserModal({ onClose, onCreate, groups, configs }) {
  const activeShiftTypes = useMemo(() => configs.filter(c => c.is_active).map(c => ({ value: c.shift_type, label: c.label })), [configs]);
  const [f, setF] = useState({ username:'', display_name:'', email: '', timezone: 'UTC', password:'', role:'engineer', telegram_username:'', min_shift_gap_days:2, max_shifts_per_week:3, group_ids:[] });
  const [allowedTypes, setAllowedTypes] = useState(activeShiftTypes.map(t => t.value));
  const s = (k,v) => setF(p => ({...p,[k]:v}));
  const toggleGroup = id => s('group_ids', f.group_ids.includes(id) ? f.group_ids.filter(x=>x!==id) : [...f.group_ids, id]);
  const toggleType = v => setAllowedTypes(prev => prev.includes(v) ? prev.filter(x=>x!==v) : [...prev, v]);

  const handleCreate = () => {
    const types = allowedTypes.length === activeShiftTypes.length ? null : allowedTypes;
    onCreate({ ...f, allowed_shift_types: types });
  };

  const TIMEZONES = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/Berlin', label: 'Berlin' },
    { value: 'Europe/Moscow', label: 'Moscow' },
    { value: 'Asia/Dubai', label: 'Abu Dhabi' },
  ];

  return (
    <Overlay onClose={onClose} title="Add User">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input label="Username *" value={f.username} onChange={e => s('username', e.target.value)} autoFocus />
        <Input label="Display name *" value={f.display_name} onChange={e => s('display_name', e.target.value)} />
        <Input label="Email" type="email" value={f.email} onChange={e => s('email', e.target.value)} />
        <Select label="Timezone" value={f.timezone} onChange={e => s('timezone', e.target.value)}>
          {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </Select>
        <Input label="Password *" type="password" value={f.password} onChange={e => s('password', e.target.value)} />
        <Select label="Role" value={f.role} onChange={e => s('role', e.target.value)}><option value="engineer">Engineer</option><option value="admin">Admin</option></Select>
        <Input label="Telegram" value={f.telegram_username} onChange={e => s('telegram_username', e.target.value)} placeholder="@username" />
        <div style={{ display: 'flex', gap: '12px' }}>
          <Input label="Min gap (d)" type="number" value={f.min_shift_gap_days} onChange={e => s('min_shift_gap_days', parseInt(e.target.value))} style={{ width: '100px' }} />
          <Input label="Max/wk" type="number" value={f.max_shifts_per_week} onChange={e => s('max_shifts_per_week', parseInt(e.target.value))} style={{ width: '100px' }} />
        </div>
        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Allowed shift types</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {activeShiftTypes.map(st => (
              <Button key={st.value} size="sm" variant={allowedTypes.includes(st.value) ? 'primary' : 'secondary'} onClick={() => toggleType(st.value)}>{st.label}</Button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!f.username || !f.display_name || f.password.length < 8}>Create</Button>
        </div>
      </div>
    </Overlay>
  );
}

function EditUserModal({ user, onClose, onSave, groups, configs }) {
  const activeShiftTypes = useMemo(() => configs.filter(c => c.is_active).map(c => ({ value: c.shift_type, label: c.label })), [configs]);
  const [f, setF] = useState({
    display_name: user.display_name,
    email: user.email || '',
    timezone: user.timezone || 'UTC',
    role: user.role,
    min_shift_gap_days: user.min_shift_gap_days,
    max_shifts_per_week: user.max_shifts_per_week,
    group_ids: user.group_ids || [],
    telegram_username: user.telegram_username || '',
  });
  const [allowedTypes, setAllowedTypes] = useState(user.allowed_shift_types || activeShiftTypes.map(t => t.value));
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
    data.allowed_shift_types = allowedTypes.length === activeShiftTypes.length ? null : allowedTypes;
    onSave(data);
  };

  const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const TIMEZONES = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/Berlin', label: 'Berlin' },
    { value: 'Europe/Moscow', label: 'Moscow' },
    { value: 'Asia/Dubai', label: 'Abu Dhabi' },
  ];

  return (
    <Overlay onClose={onClose} title={`Edit ${user.display_name}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', maxHeight: '70vh', overflowY: 'auto' }}>
        <Input label="Display name" value={f.display_name} onChange={e => s('display_name', e.target.value)} />
        <Input label="Email" type="email" value={f.email} onChange={e => s('email', e.target.value)} />
        <Select label="Timezone" value={f.timezone} onChange={e => s('timezone', e.target.value)}>
          {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </Select>
        <Select label="Role" value={f.role} onChange={e => s('role', e.target.value)}><option value="engineer">Engineer</option><option value="admin">Admin</option></Select>
        <Input label="Telegram" value={f.telegram_username} onChange={e => s('telegram_username', e.target.value)} />
        <div style={{ display: 'flex', gap: '12px' }}>
          <Input label="Min gap (d)" type="number" value={f.min_shift_gap_days} onChange={e => s('min_shift_gap_days', parseInt(e.target.value))} style={{ width: '100px' }} />
          <Input label="Max/wk" type="number" value={f.max_shifts_per_week} onChange={e => s('max_shifts_per_week', parseInt(e.target.value))} style={{ width: '100px' }} />
        </div>

        {groups.length > 0 && <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Groups</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>{groups.map(g => <Button key={g.id} size="sm" variant={f.group_ids.includes(g.id) ? 'primary' : 'secondary'} onClick={() => toggleGroup(g.id)}>{g.name}</Button>)}</div>
        </div>}

        <div>
          <label style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '6px', display: 'block' }}>Allowed shift types</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {activeShiftTypes.map(st => (
              <Button key={st.value} size="sm" variant={allowedTypes.includes(st.value) ? 'primary' : 'secondary'} onClick={() => toggleType(st.value)}>{st.label}</Button>
            ))}
          </div>
        </div>

        <div style={{ padding: '16px', background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', marginBottom: hasPattern ? '14px' : 0 }}>
            <input type="checkbox" checked={hasPattern} onChange={e => setHasPattern(e.target.checked)} />
            Custom availability pattern
          </label>
          {hasPattern && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                <Input label="Cycle length (days)" type="number" value={pattern.cycle_days} onChange={e => setPattern(p => ({ ...p, cycle_days: parseInt(e.target.value) || 2 }))} style={{ width: '80px' }} />
                <Input label="Cycle anchor date" type="date" value={anchor} onChange={e => setAnchor(e.target.value)} style={{ width: '160px' }} />
              </div>
              <div>
                <label className="t-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Available on days</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {Array.from({ length: pattern.cycle_days }, (_, i) => i + 1).map(d => (
                    <button key={d} onClick={() => toggleWorkDay(d)} style={{ width: 32, height: 32, borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer', border: pattern.work_days.includes(d) ? '2px solid var(--success)' : '1px solid var(--border)', background: pattern.work_days.includes(d) ? 'var(--success-light)' : 'var(--surface)', color: pattern.work_days.includes(d) ? 'var(--success)' : 'var(--text-muted)' }}>{d}</button>
                  ))}
                </div>
              </div>
              <div>
                <label className="t-eyebrow" style={{ display: 'block', marginBottom: 6 }}>Blocked weekdays</label>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {WEEKDAYS.map((name, i) => (
                    <button key={i} onClick={() => toggleBlockedDay(i)} style={{ padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500, cursor: 'pointer', border: pattern.blocked_weekdays.includes(i) ? '2px solid var(--danger)' : '1px solid var(--border)', background: pattern.blocked_weekdays.includes(i) ? 'var(--danger-light)' : 'var(--surface)', color: pattern.blocked_weekdays.includes(i) ? 'var(--danger)' : 'var(--text-muted)' }}>{name}</button>
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
        <Input label="New password (min 8 chars)" type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus />
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
  const [groups, setGroups] = useState([]); const [users, setUsers] = useState([]); const [show, setShow] = useState(false); const [toast, setToast] = useState(null);
  const load = () => Promise.all([api('/groups/'), api('/users/')]).then(([g, u]) => { setGroups(g || []); setUsers(u || []); });
  useEffect(() => { load(); }, []);
  const create = async f => { try { await api('/groups/', { method: 'POST', body: JSON.stringify(f) }); setShow(false); load(); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const del = async id => { try { await api(`/groups/${id}`, { method: 'DELETE' }); load(); } catch (e) { setToast({ message: e.message, type: 'error' }); }};
  const userMap = {}; users.forEach(u => { userMap[u.id] = u; });

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" icon="plus" onClick={() => setShow(true)}>Add Group</Button></div>
      {groups.length === 0 ? <Card><EmptyState icon={<Icon name="workspace" size={32} />} title="No groups" subtitle="Create a group to organize your team" /></Card> :
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {groups.map(g => (
            <Card key={g.id} style={{ padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: g.color }} />
                  <span style={{ fontWeight: 600 }}>{g.name}</span>
                  {g.description && <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>— {g.description}</span>}
                </div>
                <Button size="sm" variant="danger" icon="trash" onClick={() => del(g.id)}>Delete</Button>
              </div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {g.member_ids?.map(uid => userMap[uid] && <Badge key={uid} color="gray">{userMap[uid].display_name}</Badge>)}
                {(!g.member_ids || g.member_ids.length === 0) && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No members</span>}
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <label className="t-eyebrow">Color</label>
        <input type="color" value={color} onChange={e => setColor(e.target.value)} style={{ width: '100%', height: '36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }} />
      </div>
      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit({ name, description: desc || null, color })} disabled={!name}>Create</Button>
      </div>
    </div>
  );
}

// ─── Shift Config Tab ───────────────────────────────────
function ShiftConfigTab() {
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
      <div style={{ fontSize: '12px', padding: '12px', background: 'var(--surface-alt)', borderRadius: 'var(--radius)', marginBottom: '16px', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
        Times are in <strong>{portalTz}</strong>. Users see converted times in their profile timezone.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {configs.map(c => <ShiftConfigCard key={c.id} config={c} onUpdate={data => update(c.id, data)} />)}
      </div>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </>
  );
}

function ShiftConfigCard({ config: c, onUpdate }) {
  const [label, setLabel] = useState(c.label);
  const [duration, setDuration] = useState(c.duration_hours);
  const [startTime, setStartTime] = useState(c.default_start_time?.slice(0, 5) || '');
  const [endTime, setEndTime] = useState(c.default_end_time?.slice(0, 5) || '');
  const [reqLoc, setReqLoc] = useState(c.requires_location);

  const save = () => onUpdate({
    label, duration_hours: duration, requires_location: reqLoc,
    default_start_time: startTime || null, default_end_time: endTime || null,
  });

  return (
    <Card style={{ padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: c.color + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', color: c.color }}>
            <Icon name={c.shift_type === 'night' ? 'moon' : c.shift_type === 'office' ? 'workspace' : 'sun'} size={20} />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>{label}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
              {c.shift_type.toUpperCase()} · {duration}h · {startTime || '—'} – {endTime || '—'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input type="color" value={c.color} onChange={e => onUpdate({ color: e.target.value })}
            style={{ width: '32px', height: '32px', border: 'none', cursor: 'pointer', borderRadius: '4px', background: 'none' }} />
          <Button size="sm" variant={c.is_active ? 'secondary' : 'danger'}
            onClick={() => onUpdate({ is_active: !c.is_active })}>
            {c.is_active ? 'Active' : 'Disabled'}
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', padding: '16px', background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12 }}>
          <Input label="Label" value={label} onChange={e => setLabel(e.target.value)} />
          <Input label="Duration (h)" type="number" value={duration} onChange={e => setDuration(parseFloat(e.target.value))} style={{ width: 80 }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input label="Start time" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
          <Input label="End time" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
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

  const flags = ['notify_day_shift_start','notify_night_shift_start','notify_office_roster','notify_reminders','notify_general'];
  const flagLabels = { notify_day_shift_start: 'Day', notify_night_shift_start: 'Night', notify_office_roster: 'Office', notify_reminders: 'Reminders', notify_general: 'General' };

  return (
    <>
      <div style={{ padding: '16px', background: 'var(--surface-alt)', borderRadius: 'var(--radius)', marginBottom: '16px', border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: diagResult ? '16px' : '0' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>Bot Diagnostics</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Verifies token and probe delivery.</div>
          </div>
          <Button size="sm" variant="secondary" onClick={runDiagnostics} disabled={diagLoading} icon="zap">
            {diagLoading ? 'Running…' : 'Run Tests'}
          </Button>
        </div>
        {diagResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ fontSize: '12px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: diagResult.bot?.ok ? 'var(--success-light)' : 'var(--danger-light)', color: diagResult.bot?.ok ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={diagResult.bot?.ok ? 'check' : 'x'} size={14} />
              {diagResult.bot?.ok ? `Bot valid: @${diagResult.bot.username}` : `Bot error: ${diagResult.bot?.error}`}
            </div>
            {diagResult.chats?.map((c, i) => (
              <div key={i} style={{ fontSize: '12px', padding: '8px 12px', borderRadius: 'var(--radius-sm)', background: c.ok ? 'var(--success-light)' : 'var(--danger-light)', color: c.ok ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name={c.ok ? 'check' : 'x'} size={14} />
                {c.name}: {c.ok ? 'Delivered' : 'Failed'}
              </div>
            ))}
          </div>
        )}
      </div>

      <ShiftNotificationTest />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
        <Button size="sm" icon="plus" onClick={() => setShow(true)}>Add Chat</Button>
      </div>

      {chats.length === 0
        ? <Card><EmptyState icon={<Icon name="message" size={32} />} title="No chats" subtitle="Add group chats for notifications" /></Card>
        : <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {chats.map(c => (
              <Card key={c.id} style={{ padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, marginBottom: '4px' }}>{c.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', marginBottom: '12px' }}>
                      ID: {c.chat_id} · {c.chat_type.toUpperCase()}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                      {flags.map(f => (
                        <Button key={f} size="sm" variant={c[f] ? 'primary' : 'secondary'} onClick={() => update(c.id, { [f]: !c[f] })}>
                          {flagLabels[f]}
                        </Button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => setEditTarget(c)}>Edit</Button>
                    <Button size="sm" variant="danger" icon="trash" onClick={() => del(c.id)}>Delete</Button>
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

  return (
    <Overlay onClose={onClose} title={isEdit ? 'Edit Chat' : 'Add Chat'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input label="Chat / Channel ID" value={f.chat_id} onChange={e => s('chat_id', e.target.value)} placeholder="-100..." />
        <Input label="Name" value={f.name} onChange={e => s('name', e.target.value)} />
        <Select label="Type" value={f.chat_type} onChange={e => s('chat_type', e.target.value)}>
          <option value="group">Group</option>
          <option value="channel">Channel</option>
        </Select>
        <Input label="Topic ID (optional)" value={f.topic_id} onChange={e => s('topic_id', e.target.value)} />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSave(f)} disabled={!f.chat_id || !f.name}>Save</Button>
        </div>
      </div>
    </Overlay>
  );
}

// ─── Shift Notification Test ─────────────────────────────
function ShiftNotificationTest() {
  const { t: tr } = useLang();
  const [preview, setPreview] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [testingShift, setTestingShift] = useState(null);
  const [toast, setToast] = useState(null);

  const loadPreview = async () => {
    setLoadingPreview(true);
    try { setPreview(await api('/admin/telegram-shift-preview')); }
    catch {} finally { setLoadingPreview(false); }
  };

  useEffect(() => { loadPreview(); }, []);

  const testShift = async (type) => {
    setTestingShift(type);
    try {
      await api(`/admin/test-telegram-shift?shift_type=${type}`, { method: 'POST' });
      setToast({ message: `${type} notification sent`, type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
    finally { setTestingShift(null); }
  };

  const previewMsg = (type) => {
    if (!preview) return 'Loading...';
    const list = (names) => names?.length ? names.map(n => `  • ${n}`).join('\n') : '  None';
    if (type === 'day') return `☀️ DAY SHIFT\n${preview.today}\nOn duty:\n${list(preview.day_today)}`;
    return `🌙 NIGHT SHIFT\n${preview.today}\nOn duty:\n${list(preview.night_today)}`;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: 16 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
      <div style={{ display: 'flex', gap: 12 }}>
        {['day', 'night'].map(type => (
          <Card key={type} style={{ flex: 1, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Icon name={type === 'day' ? 'sun' : 'moon'} size={16} color={type === 'day' ? 'var(--warning)' : 'var(--accent)'} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>{type.toUpperCase()} TEST</span>
            </div>
            <pre style={{ fontSize: 11, background: 'var(--surface-alt)', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', marginBottom: 12, border: '1px solid var(--border-light)' }}>{previewMsg(type)}</pre>
            <Button size="sm" disabled={testingShift === type} onClick={() => testShift(type)} block>Send Test</Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ─── Logs Tab ────────────────────────────────────────────
function LogsTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api('/admin/audit-logs').then(d => { setLogs(d || []); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  return (
    <Card style={{ padding: '4px' }}>
      {loading && <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
      {logs.map((log, i) => (
        <div key={log.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '12px 18px', borderBottom: i < logs.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Badge color="blue">{log.action}</Badge>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{log.username}</span>
            </div>
            {log.details && <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>{log.details}</div>}
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{new Date(log.created_at).toLocaleString()}</div>
        </div>
      ))}
    </Card>
  );
}

// ─── Telegram Templates Tab ──────────────────────────────
function TelegramTemplatesTab() {
  const [templates, setTemplates] = useState([]);
  const [show, setShow] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = () => api('/admin/telegram-templates').then(d => setTemplates(d || []));
  useEffect(() => { load(); }, []);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}><Button size="sm" icon="plus" onClick={() => { setEditing(null); setShow(true); }}>Add Template</Button></div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {templates.map(tpl => (
          <Card key={tpl.id} style={{ padding: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{tpl.name}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>Chat: {tpl.chat_id}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button size="sm" variant="ghost" icon="edit" onClick={() => { setEditing(tpl); setShow(true); }} />
                <Button size="sm" variant="danger" icon="trash" onClick={() => api(`/admin/telegram-templates/${tpl.id}`, { method: 'DELETE' }).then(load)} />
              </div>
            </div>
          </Card>
        ))}
      </div>
      {show && <TelegramTemplateFormOverlay initial={editing} onClose={() => setShow(false)} onSave={() => { setShow(false); load(); }} />}
    </>
  );
}

function TelegramTemplateFormOverlay({ initial, onClose, onSave }) {
  const [f, setF] = useState({ name: initial?.name || '', chat_id: initial?.chat_id || '', topic_id: initial?.topic_id || '', description: initial?.description || '' });
  const save = async () => {
    const payload = { ...f, topic_id: f.topic_id ? parseInt(f.topic_id) : null };
    if (initial) await api(`/admin/telegram-templates/${initial.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
    else await api('/admin/telegram-templates', { method: 'POST', body: JSON.stringify(payload) });
    onSave();
  };
  return (
    <Overlay title={initial ? 'Edit Template' : 'New Template'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Input label="Name" value={f.name} onChange={e => setF({ ...f, name: e.target.value })} />
        <Input label="Chat ID" value={f.chat_id} onChange={e => setF({ ...f, chat_id: e.target.value })} />
        <Input label="Topic ID" value={f.topic_id} onChange={e => setF({ ...f, topic_id: e.target.value })} />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </div>
    </Overlay>
  );
}
