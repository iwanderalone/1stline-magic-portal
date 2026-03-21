import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Card, Button, Badge, Input, Select, Overlay, Toast, EmptyState } from '../components/UI';

export default function TimeOffPage({ user }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const isAdmin = user?.role === 'admin';

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api('/schedule/time-off');
      setRequests(data || []);
    } catch (e) {
      setToast({ message: e.message || 'Failed to load', type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleRequest = async (sd, ed, ot, cm) => {
    try {
      await api('/schedule/time-off', { method: 'POST', body: JSON.stringify({ start_date: sd, end_date: ed, off_type: ot, comment: cm }) });
      setToast({ message: tr('timeOffRequested'), type: 'success' });
      setShowForm(false);
      load();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleReview = async (id, status) => {
    try {
      await api(`/schedule/time-off/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setToast({ message: `Request ${status}`, type: 'success' });
      load();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this request?')) return;
    try {
      await api(`/schedule/time-off/${id}`, { method: 'DELETE' });
      setToast({ message: 'Deleted', type: 'success' });
      load();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const offTypeEmoji = { vacation: '🏖️', sick_leave: '🤒', day_off: '🌿' };
  const statusColors = { approved: 'green', rejected: 'red', pending: 'yellow' };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{tr('timeOffRequests')}</h2>
          <p style={{ fontSize: '13px', color: t.textMuted, marginTop: '2px' }}>{tr('timeOffDesc')}</p>
        </div>
        <Button
          onClick={() => setShowForm(true)}
          style={{ background: '#10b981', color: '#fff' }}
        >
          🌴 {tr('requestTimeOff')}
        </Button>
      </div>

      <Card style={{ padding: '4px' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: t.textMuted }}>{tr('loading')}</div>
        ) : requests.length === 0 ? (
          <EmptyState icon="🌴" title={tr('noRequests')} subtitle={tr('noRequestsDesc')} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {requests.map((r, i) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', gap: '12px', flexWrap: 'wrap',
                borderBottom: i < requests.length - 1 ? `1px solid ${t.borderLight}` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '24px' }}>{offTypeEmoji[r.off_type] || '🏖️'}</span>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      {isAdmin && <span style={{ fontWeight: 600, fontSize: '14px' }}>{r.user?.display_name || '—'}</span>}
                      <span style={{ fontSize: '13px', color: t.textSecondary }}>{r.start_date} → {r.end_date}</span>
                      <Badge color={r.off_type === 'vacation' ? 'blue' : r.off_type === 'sick_leave' ? 'red' : 'gray'}>
                        {r.off_type.replace('_', ' ')}
                      </Badge>
                      <Badge color={statusColors[r.status] || 'gray'}>{r.status}</Badge>
                    </div>
                    {r.comment && <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '3px' }}>💬 {r.comment}</div>}
                    {r.admin_comment && <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '3px' }}>Admin: {r.admin_comment}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {isAdmin && r.status === 'pending' && (
                    <>
                      <Button size="sm" onClick={() => handleReview(r.id, 'approved')} style={{ background: '#10b981', color: '#fff' }}>✓ Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => handleReview(r.id, 'rejected')}>✗ Reject</Button>
                    </>
                  )}
                  {(isAdmin || r.status === 'pending') && (
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}>Delete</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showForm && (
        <TimeOffFormModal onClose={() => setShowForm(false)} onSubmit={handleRequest} />
      )}
    </div>
  );
}

function TimeOffFormModal({ onClose, onSubmit }) {
  const { t: tr } = useLang();
  const fmt = d => d.toISOString().slice(0, 10);
  const today = fmt(new Date());
  const [sd, setSd] = useState(today);
  const [ed, setEd] = useState(today);
  const [ot, setOt] = useState('day_off');
  const [cm, setCm] = useState('');
  return (
    <Overlay onClose={onClose} title={tr('requestTimeOff')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Input label={tr('start')} type="date" value={sd} onChange={e => setSd(e.target.value)} />
        <Input label={tr('end')} type="date" value={ed} onChange={e => setEd(e.target.value)} />
        <Select label={tr('type')} value={ot} onChange={e => setOt(e.target.value)}>
          <option value="day_off">{tr('dayOff')}</option>
          <option value="vacation">{tr('vacation')}</option>
          <option value="sick_leave">{tr('sickLeave')}</option>
        </Select>
        <Input label={tr('comment')} value={cm} onChange={e => setCm(e.target.value)} placeholder="Optional note" />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
          <Button onClick={() => onSubmit(sd, ed, ot, cm || null)} style={{ background: '#10b981', color: '#fff' }}>{tr('submit')}</Button>
        </div>
      </div>
    </Overlay>
  );
}
