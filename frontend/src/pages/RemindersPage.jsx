import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Card, Button, Input, Badge, EmptyState, Overlay, Toast, Select } from '../components/UI';

export default function RemindersPage() {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('active');

  const load = useCallback(async () => {
    setLoading(true);
    try { const d = await api(filter === 'active' ? '/reminders/active' : '/reminders/'); setReminders(d || []); }
    catch (e) { console.error(e); } finally { setLoading(false); }
  }, [filter]);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async (form) => {
    try { await api('/reminders/', { method: 'POST', body: JSON.stringify(form) }); setToast({ message: tr('create') + '!', type: 'success' }); setShowCreate(false); load(); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
  };
  const handleCancel = async (id) => {
    try { await api(`/reminders/${id}`, { method: 'DELETE' }); setToast({ message: tr('cancelReminder'), type: 'info' }); load(); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const sc = { active: 'blue', fired: 'green', cancelled: 'gray' };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{tr('reminders_title')}</h2>
          <p style={{ color: t.textMuted, fontSize: '13px' }}>{reminders.length} {filter}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant={filter === 'active' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('active')}>{tr('active')}</Button>
          <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('all')}>{tr('all')}</Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>{tr('newReminder')}</Button>
        </div>
      </div>
      <Card style={{ padding: '4px' }}>
        {loading ? <div style={{ padding: '48px', textAlign: 'center', color: t.textMuted }}>{tr('loading')}</div> :
          reminders.length === 0 ? <EmptyState icon="🔔" title={tr('noReminders')} subtitle={tr('noRemindersDesc')} /> : (
          <div>{reminders.map((r, i) => (
            <div key={r.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', gap: '12px', flexWrap: 'wrap', borderBottom: i < reminders.length - 1 ? `1px solid ${t.borderLight}` : 'none' }}>
              <div style={{ flex: 1, minWidth: '200px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                  <span style={{ fontWeight: 600, fontSize: '14px' }}>{r.title}</span>
                  <Badge color={sc[r.status]}>{r.status}</Badge>
                  {r.is_recurring && (
                    <Badge color="blue">↻ {RECURRENCE_OPTIONS.find(o => o.value === r.recurrence_minutes)?.label ?? `${r.recurrence_minutes}m`}</Badge>
                  )}
                  {r.telegram_target && r.telegram_target !== 'none' && (
                    <Badge color="gray">💬 {r.telegram_target}</Badge>
                  )}
                </div>
                {r.description && <div style={{ fontSize: '13px', color: t.textSecondary }}>{r.description}</div>}
                <div style={{ fontSize: '12px', color: t.textMuted, fontFamily: t.fontMono, marginTop: '4px' }}>
                  {new Date(r.remind_at).toLocaleString()}{r.fired_at && ` · fired ${new Date(r.fired_at).toLocaleString()}`}
                </div>
              </div>
              {r.status === 'active' && <Button size="sm" variant="danger" onClick={() => handleCancel(r.id)}>{tr('cancelReminder')}</Button>}
            </div>
          ))}</div>
        )}
      </Card>
      {showCreate && <CreateReminderModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

const RECURRENCE_OPTIONS = [
  { label: '15 minutes',  value: 15 },
  { label: '30 minutes',  value: 30 },
  { label: '1 hour',      value: 60 },
  { label: '2 hours',     value: 120 },
  { label: '6 hours',     value: 360 },
  { label: '12 hours',    value: 720 },
  { label: 'Daily',       value: 1440 },
  { label: 'Weekly',      value: 10080 },
  { label: 'Biweekly',    value: 20160 },
  { label: 'Monthly',     value: 43200 },
];

function CreateReminderModal({ onClose, onCreate }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [at, setAt] = useState('');
  const [rec, setRec] = useState(false);
  const [recMin, setRecMin] = useState(60);
  const [tgTarget, setTgTarget] = useState('personal');

  const setQuick = m => {
    if (m) {
      setAt(new Date(Date.now() + m * 60000).toISOString().slice(0, 16));
    } else {
      const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0);
      setAt(d.toISOString().slice(0, 16));
    }
  };

  return (
    <Overlay onClose={onClose} title={tr('newReminderTitle')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label={tr('title')} value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Check ticket #1234" />
        <Input label={tr('description')} value={desc} onChange={e => setDesc(e.target.value)} />

        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary, display: 'block', marginBottom: '6px' }}>{tr('quickSet')}</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[['15m', 15], ['30m', 30], ['1h', 60], ['2h', 120], [tr('tomorrow'), null]].map(([l, m]) => (
              <Button key={l} variant="secondary" size="sm" onClick={() => setQuick(m)}>{l}</Button>
            ))}
          </div>
        </div>

        <Input label={tr('remindAt')} type="datetime-local" value={at} onChange={e => setAt(e.target.value)} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer', userSelect: 'none' }}>
            <input type="checkbox" checked={rec} onChange={e => setRec(e.target.checked)}
              style={{ width: 15, height: 15, accentColor: t.accent, cursor: 'pointer' }} />
            <span style={{ fontWeight: 500, color: t.text }}>{tr('recurring')}</span>
          </label>
          {rec && (
            <Select value={String(recMin)} onChange={e => setRecMin(parseInt(e.target.value))}>
              {RECURRENCE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </Select>
          )}
        </div>

        <Select label={tr('telegram')} value={tgTarget} onChange={e => setTgTarget(e.target.value)}>
          <option value="none">None (in-app only)</option>
          <option value="personal">Personal chat</option>
          <option value="groups">Group chats</option>
          <option value="both">Both</option>
        </Select>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
          <Button
            onClick={() => onCreate({
              title,
              description: desc || null,
              remind_at: new Date(at).toISOString(),
              is_recurring: rec,
              recurrence_minutes: rec ? recMin : null,
              notify_telegram: tgTarget !== 'none',
              notify_in_app: true,
              telegram_target: tgTarget,
            })}
            disabled={!title || !at}
          >{tr('create')}</Button>
        </div>
      </div>
    </Overlay>
  );
}
