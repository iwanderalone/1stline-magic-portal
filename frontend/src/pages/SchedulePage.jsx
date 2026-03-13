import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { Card, Button, Input, Badge, EmptyState, Overlay, Toast } from '../components/UI';
import { theme } from '../theme';

const fmt = d => d.toISOString().split('T')[0];

function getWeekDates(offset) {
  const now = new Date();
  now.setDate(now.getDate() + offset * 7);
  const start = new Date(now);
  start.setDate(start.getDate() - start.getDay() + 1);
  const dates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }
  return dates;
}

const SHIFT_EMOJI = { morning: '☀️', afternoon: '🌤', night: '🌙' };

export default function SchedulePage({ user }) {
  const [shifts, setShifts] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [weekOffset, setWeekOffset] = useState(0);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showTimeOff, setShowTimeOff] = useState(false);
  const [toast, setToast] = useState(null);

  const isAdmin = user.role === 'admin';
  const weekDates = getWeekDates(weekOffset);
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        api(`/schedule/shifts?start_date=${fmt(weekDates[0])}&end_date=${fmt(weekDates[6])}`),
        api('/schedule/time-off'),
      ]);
      setShifts(s || []);
      setTimeOff(t || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [weekOffset]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleGenerate = async (startDate, endDate) => {
    try {
      await api('/schedule/generate', {
        method: 'POST',
        body: JSON.stringify({ start_date: startDate, end_date: endDate, shift_types: ['morning', 'afternoon', 'night'] }),
      });
      setToast({ message: 'Schedule generated!', type: 'success' });
      setShowGenerate(false);
      loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handlePublish = async () => {
    try {
      const res = await api(`/schedule/publish?start_date=${fmt(weekDates[0])}&end_date=${fmt(weekDates[6])}`, { method: 'POST' });
      setToast({ message: `Published ${res.published} shifts`, type: 'success' });
      loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleTimeOffRequest = async (startDate, endDate, offType, comment) => {
    try {
      await api('/schedule/time-off', {
        method: 'POST',
        body: JSON.stringify({ start_date: startDate, end_date: endDate, off_type: offType, comment }),
      });
      setToast({ message: 'Time-off requested', type: 'success' });
      setShowTimeOff(false);
      loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleReviewTimeOff = async (id, status) => {
    try {
      await api(`/schedule/time-off/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
      setToast({ message: `Request ${status}`, type: 'success' });
      loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em' }}>Schedule</h2>
          <p style={{ color: theme.textMuted, fontSize: '13px', marginTop: '2px' }}>
            {weekDates[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {weekDates[6].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Button variant="secondary" size="sm" onClick={() => setWeekOffset(w => w - 1)}>← Prev</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekOffset(0)}>Today</Button>
          <Button variant="secondary" size="sm" onClick={() => setWeekOffset(w => w + 1)}>Next →</Button>
          <Button variant="secondary" size="sm" onClick={() => setShowTimeOff(true)}>Request time off</Button>
          {isAdmin && <Button size="sm" onClick={() => setShowGenerate(true)}>⚡ Generate</Button>}
          {isAdmin && <Button variant="secondary" size="sm" onClick={handlePublish}>Publish</Button>}
        </div>
      </div>

      {/* Calendar */}
      <Card style={{ overflow: 'auto' }}>
        {loading ? (
          <div style={{ padding: '48px', textAlign: 'center', color: theme.textMuted, animation: 'pulse 1.5s infinite' }}>Loading schedule…</div>
        ) : (
          <div style={{ minWidth: '700px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${theme.border}` }}>
              {weekDates.map((d, i) => {
                const isToday = fmt(d) === fmt(new Date());
                return (
                  <div key={i} style={{
                    padding: '12px 10px', textAlign: 'center',
                    borderRight: i < 6 ? `1px solid ${theme.borderLight}` : 'none',
                    background: isToday ? theme.accentLight : 'transparent',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: theme.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{dayNames[i]}</div>
                    <div style={{ fontSize: '18px', fontWeight: 700, color: isToday ? theme.accent : theme.text, marginTop: '2px' }}>{d.getDate()}</div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: '180px' }}>
              {weekDates.map((d, i) => {
                const dayShifts = shifts.filter(s => s.date === fmt(d));
                return (
                  <div key={i} style={{
                    padding: '8px 6px', borderRight: i < 6 ? `1px solid ${theme.borderLight}` : 'none',
                    display: 'flex', flexDirection: 'column', gap: '4px',
                  }}>
                    {dayShifts.length === 0 && <div style={{ fontSize: '11px', color: theme.textMuted, textAlign: 'center', padding: '8px 0' }}>—</div>}
                    {dayShifts.map(s => (
                      <div key={s.id} style={{
                        padding: '6px 8px', borderRadius: '6px', fontSize: '12px', lineHeight: 1.3,
                        background: s.shift_type === 'morning' ? theme.accentLight : s.shift_type === 'afternoon' ? theme.warningLight : theme.surfaceAlt,
                        border: !s.is_published ? `1px dashed ${theme.border}` : 'none',
                        opacity: s.is_published ? 1 : 0.7,
                      }}>
                        <div style={{ fontWeight: 600 }}>{SHIFT_EMOJI[s.shift_type]} {s.user?.display_name || '—'}</div>
                        <div style={{ color: theme.textMuted, fontSize: '10px', marginTop: '1px' }}>
                          {s.shift_type}{!s.is_published ? ' · draft' : ''}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {/* Time Off */}
      <Card style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>Time-off requests</h3>
        {timeOff.length === 0 ? (
          <EmptyState icon="🏖️" title="No requests" subtitle="All clear" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {timeOff.map(r => (
              <div key={r.id} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', background: theme.surfaceAlt, borderRadius: theme.radiusSm,
                gap: '12px', flexWrap: 'wrap',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500, fontSize: '14px' }}>{r.user?.display_name || 'You'}</span>
                  <span style={{ color: theme.textSecondary, fontSize: '13px' }}>{r.start_date} → {r.end_date}</span>
                  <Badge color={r.off_type === 'vacation' ? 'blue' : r.off_type === 'sick_leave' ? 'red' : 'gray'}>
                    {r.off_type.replace('_', ' ')}
                  </Badge>
                  <Badge color={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'yellow'}>
                    {r.status}
                  </Badge>
                </div>
                {isAdmin && r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Button size="sm" onClick={() => handleReviewTimeOff(r.id, 'approved')}>✓</Button>
                    <Button size="sm" variant="danger" onClick={() => handleReviewTimeOff(r.id, 'rejected')}>✗</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {showGenerate && <GenerateModal onClose={() => setShowGenerate(false)} onGenerate={handleGenerate} weekDates={weekDates} />}
      {showTimeOff && <TimeOffModal onClose={() => setShowTimeOff(false)} onSubmit={handleTimeOffRequest} />}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function GenerateModal({ onClose, onGenerate, weekDates }) {
  const [start, setStart] = useState(fmt(weekDates[0]));
  const [end, setEnd] = useState(fmt(weekDates[6]));
  return (
    <Overlay onClose={onClose} title="Generate Schedule">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label="Start date" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <Input label="End date" type="date" value={end} onChange={e => setEnd(e.target.value)} />
        <p style={{ fontSize: '12px', color: theme.textMuted }}>
          Generates shifts for all active engineers respecting their constraints. Existing shifts are kept.
        </p>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onGenerate(start, end)}>⚡ Generate</Button>
        </div>
      </div>
    </Overlay>
  );
}

function TimeOffModal({ onClose, onSubmit }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [offType, setOffType] = useState('day_off');
  const [comment, setComment] = useState('');
  return (
    <Overlay onClose={onClose} title="Request Time Off">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label="Start date" type="date" value={start} onChange={e => setStart(e.target.value)} />
        <Input label="End date" type="date" value={end} onChange={e => setEnd(e.target.value)} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <label style={{ fontSize: '13px', fontWeight: 500, color: theme.textSecondary }}>Type</label>
          <select value={offType} onChange={e => setOffType(e.target.value)} style={{
            padding: '9px 12px', border: `1px solid ${theme.border}`, borderRadius: theme.radiusSm,
            fontSize: '14px', background: theme.surface, color: theme.text,
          }}>
            <option value="day_off">Day off</option>
            <option value="vacation">Vacation</option>
            <option value="sick_leave">Sick leave</option>
          </select>
        </div>
        <Input label="Comment (optional)" value={comment} onChange={e => setComment(e.target.value)} />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(start, end, offType, comment)} disabled={!start || !end}>Submit</Button>
        </div>
      </div>
    </Overlay>
  );
}
