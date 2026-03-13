import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { Card, Button, Input, Badge, EmptyState, Overlay, Toast } from '../components/UI';
import { theme } from '../theme';

export default function RemindersPage() {
  const [reminders, setReminders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('active');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = filter === 'active' ? '/reminders/active' : '/reminders/';
      const data = await api(endpoint);
      setReminders(data || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleCreate = async (form) => {
    try {
      await api('/reminders/', { method: 'POST', body: JSON.stringify(form) });
      setToast({ message: 'Reminder created!', type: 'success' });
      setShowCreate(false);
      loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleCancel = async (id) => {
    try {
      await api(`/reminders/${id}`, { method: 'DELETE' });
      setToast({ message: 'Reminder cancelled', type: 'info' });
      loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const statusColor = { active: 'blue', fired: 'green', cancelled: 'gray' };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>Reminders</h2>
          <p style={{ color: theme.textMuted, fontSize: '13px', marginTop: '2px' }}>
            {reminders.length} {filter} reminder{reminders.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button variant={filter === 'active' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('active')}>Active</Button>
          <Button variant={filter === 'all' ? 'primary' : 'secondary'} size="sm" onClick={() => setFilter('all')}>All</Button>
          <Button size="sm" onClick={() => setShowCreate(true)}>+ New reminder</Button>
        </div>
      </div>

      <Card style={{ padding: '4px' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: theme.textMuted, animation: 'pulse 1.5s infinite' }}>Loading…</div>
        ) : reminders.length === 0 ? (
          <EmptyState icon="🔔" title="No reminders" subtitle={filter === 'active' ? 'Create one to get started' : 'Nothing here yet'} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {reminders.map((r, i) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', gap: '12px', flexWrap: 'wrap',
                borderBottom: i < reminders.length - 1 ? `1px solid ${theme.borderLight}` : 'none',
              }}>
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>{r.title}</span>
                    <Badge color={statusColor[r.status]}>{r.status}</Badge>
                    {r.is_recurring && <Badge color="blue">↻ recurring</Badge>}
                    {r.notify_telegram && <Badge color="gray">💬 tg</Badge>}
                  </div>
                  {r.description && <div style={{ fontSize: '13px', color: theme.textSecondary }}>{r.description}</div>}
                  <div style={{ fontSize: '12px', color: theme.textMuted, marginTop: '4px', fontFamily: theme.fontMono }}>
                    {new Date(r.remind_at).toLocaleString()}
                    {r.fired_at && ` · fired ${new Date(r.fired_at).toLocaleString()}`}
                  </div>
                </div>
                {r.status === 'active' && (
                  <Button size="sm" variant="danger" onClick={() => handleCancel(r.id)}>Cancel</Button>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {showCreate && <CreateReminderModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function CreateReminderModal({ onClose, onCreate }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [remindAt, setRemindAt] = useState('');
  const [recurring, setRecurring] = useState(false);
  const [recurrenceMin, setRecurrenceMin] = useState(60);
  const [notifyTg, setNotifyTg] = useState(true);

  const quickSets = [
    { label: '15 min', mins: 15 },
    { label: '30 min', mins: 30 },
    { label: '1 hour', mins: 60 },
    { label: '2 hours', mins: 120 },
    { label: 'Tomorrow 9am', mins: null },
  ];

  const setQuick = (mins) => {
    if (mins !== null) {
      const d = new Date(Date.now() + mins * 60000);
      setRemindAt(d.toISOString().slice(0, 16));
    } else {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      setRemindAt(d.toISOString().slice(0, 16));
    }
  };

  return (
    <Overlay onClose={onClose} title="New Reminder">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label="Title" value={title} onChange={e => setTitle(e.target.value)} autoFocus placeholder="Check ticket #1234" />
        <Input label="Description (optional)" value={description} onChange={e => setDescription(e.target.value)} placeholder="Follow up on…" />
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, color: theme.textSecondary, display: 'block', marginBottom: '6px' }}>Quick set</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {quickSets.map(q => (
              <Button key={q.label} variant="secondary" size="sm" onClick={() => setQuick(q.mins)}>{q.label}</Button>
            ))}
          </div>
        </div>
        <Input label="Remind at" type="datetime-local" value={remindAt} onChange={e => setRemindAt(e.target.value)} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
            <input type="checkbox" checked={recurring} onChange={e => setRecurring(e.target.checked)} />
            Recurring
          </label>
          {recurring && (
            <>
              <Input type="number" value={recurrenceMin} onChange={e => setRecurrenceMin(e.target.value)} style={{ width: '80px' }} />
              <span style={{ fontSize: '12px', color: theme.textMuted }}>minutes</span>
            </>
          )}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={notifyTg} onChange={e => setNotifyTg(e.target.checked)} />
          Notify via Telegram
        </label>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onCreate({
            title, description: description || null,
            remind_at: new Date(remindAt).toISOString(),
            is_recurring: recurring,
            recurrence_minutes: recurring ? parseInt(recurrenceMin) : null,
            notify_telegram: notifyTg, notify_in_app: true,
          })} disabled={!title || !remindAt}>Create</Button>
        </div>
      </div>
    </Overlay>
  );
}
