import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useLang } from '../components/LangContext';
import { Card, Button, Input, Select, Overlay, PageHeader, Toast, EmptyState } from '../components/UI';
import { Icon } from '../components/Icons';
import { TimeOffStatus } from './SchedulePage';

// Inclusive day count for a YYYY-MM-DD range.
const spanDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;

export default function TimeOffPage({ user }) {
  const { t: tr } = useLang();
  const isAdmin = user?.role === 'admin' || user?.role === 'manager';

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

  const offTypeIcon = { vacation: 'sun', sick_leave: 'alertTriangle', day_off: 'leaf' };
  const offTypeLabel = { vacation: tr('vacation'), sick_leave: tr('sickLeave'), day_off: tr('dayOff') };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <PageHeader
        title={tr('timeOffRequests')}
        subtitle={tr('timeOffDesc')}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setShowForm(true)}>
            {tr('requestTimeOff')}
          </Button>
        }
      />

      <Card style={{ padding: '4px' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>{tr('loading')}</div>
        ) : requests.length === 0 ? (
          <EmptyState icon={<Icon name="leaf" size={32} />} title={tr('noRequests')} subtitle={tr('noRequestsDesc')} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {requests.map((r, i) => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 18px', gap: '12px', flexWrap: 'wrap',
                borderBottom: i < requests.length - 1 ? `1px solid var(--border-light)` : 'none',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                      {isAdmin && <span style={{ fontWeight: 600, fontSize: '14px' }}>{r.user?.display_name || '—'}</span>}
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: 'var(--text-secondary)' }}>
                        <Icon name={offTypeIcon[r.off_type] || 'leaf'} size={13} color="var(--text-muted)" />
                        {offTypeLabel[r.off_type] || r.off_type}
                      </span>
                      <span style={{
                        fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)',
                        textDecoration: r.status === 'rejected' ? 'line-through' : 'none',
                      }}>
                        {r.start_date} → {r.end_date}
                        <span style={{ color: 'var(--text-muted)' }}> · {spanDays(r.start_date, r.end_date)}{tr('daysShort')}</span>
                      </span>
                      <TimeOffStatus status={r.status} tr={tr} />
                    </div>
                    {r.comment && (
                      <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Icon name="message" size={12} /> {r.comment}
                      </div>
                    )}
                    {r.admin_comment && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '3px' }}>Admin: {r.admin_comment}</div>}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {isAdmin && r.status === 'pending' && (
                    <>
                      <Button size="sm" variant="primary" icon="check" onClick={() => handleReview(r.id, 'approved')}>{tr('approve')}</Button>
                      <Button size="sm" variant="secondary" icon="x" onClick={() => handleReview(r.id, 'rejected')}>{tr('reject')}</Button>
                    </>
                  )}
                  {(isAdmin || r.status === 'pending') && (
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(r.id)}>{tr('delete')}</Button>
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
          <Button variant="primary" onClick={() => onSubmit(sd, ed, ot, cm || null)}>{tr('submit')}</Button>
        </div>
      </div>
    </Overlay>
  );
}
