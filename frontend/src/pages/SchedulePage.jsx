import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../api';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';
import { Card, Button, Input, Badge, EmptyState, Overlay, Toast, Tabs, Select } from '../components/UI';

const fmt = d => d.toISOString().split('T')[0];
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

function getWeekDates(offset) {
  const n = new Date(); n.setDate(n.getDate() + offset * 7);
  const s = new Date(n); s.setDate(s.getDate() - s.getDay() + 1);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d; });
}

function getMonthDates(offset) {
  const n = new Date(); n.setMonth(n.getMonth() + offset, 1);
  const year = n.getFullYear(), month = n.getMonth();
  const first = new Date(year, month, 1);
  const startDay = (first.getDay() + 6) % 7;
  const dates = [];
  for (let i = -startDay; i < 42 - startDay; i++) {
    const d = new Date(year, month, 1 + i);
    dates.push(d);
  }
  return { dates, year, month };
}

export default function SchedulePage({ user }) {
  const { theme: t } = useTheme();
  const { t: tr, lang } = useLang();
  const [shifts, setShifts] = useState([]);
  const [configs, setConfigs] = useState([]);
  const [users, setUsers] = useState([]);
  const [timeOff, setTimeOff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('weekly');
  const [offset, setOffset] = useState(0);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showTimeOff, setShowTimeOff] = useState(false);
  const [showAddShift, setShowAddShift] = useState(false);
  const [selectedShift, setSelectedShift] = useState(null);
  const [selectedTimeOff, setSelectedTimeOff] = useState(null);
  const [toast, setToast] = useState(null);
  const isAdmin = user.role === 'admin';

  const weekDates = getWeekDates(offset);
  const monthData = getMonthDates(offset);
  const activeDates = view === 'weekly' ? weekDates : monthData.dates;
  const rangeStart = activeDates[0];
  const rangeEnd = activeDates[activeDates.length - 1];

  const configMap = {};
  configs.forEach(c => { configMap[c.shift_type] = c; });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, u, to] = await Promise.all([
        api(`/schedule/shifts?start_date=${fmt(rangeStart)}&end_date=${fmt(rangeEnd)}`),
        api('/schedule/shift-configs'),
        api('/users/'),
        api('/schedule/time-off'),
      ]);
      setShifts(s || []); setConfigs(c || []); setUsers(u || []); setTimeOff(to || []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [offset, view]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleGenerate = async (startDate, endDate, types) => {
    try {
      await api('/schedule/generate', { method: 'POST', body: JSON.stringify({ start_date: startDate, end_date: endDate, shift_types: types }) });
      setToast({ message: 'Schedule generated!', type: 'success' }); setShowGenerate(false); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleClearDrafts = async () => {
    const draftCount = shifts.filter(s => !s.is_published).length;
    if (draftCount === 0) { setToast({ message: 'No drafts in this range', type: 'info' }); return; }
    if (!confirm(`Delete ${draftCount} draft shift(s) from this view?`)) return;
    try {
      const r = await api(`/schedule/shifts/drafts?start_date=${fmt(rangeStart)}&end_date=${fmt(rangeEnd)}`, { method: 'DELETE' });
      setToast({ message: `Cleared ${r.deleted} draft(s)`, type: 'success' }); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handlePublish = async () => {
    try {
      const r = await api(`/schedule/publish?start_date=${fmt(rangeStart)}&end_date=${fmt(rangeEnd)}`, { method: 'POST' });
      setToast({ message: `Published ${r.published} shifts`, type: 'success' }); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleAddShift = async (data) => {
    try {
      await api('/schedule/shifts', { method: 'POST', body: JSON.stringify(data) });
      setToast({ message: 'Shift added', type: 'success' }); setShowAddShift(false); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleDeleteShift = async (id) => {
    try { await api(`/schedule/shifts/${id}`, { method: 'DELETE' }); setSelectedShift(null); loadData(); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleEditShift = async (id, data) => {
    try { await api(`/schedule/shifts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); setSelectedShift(null); loadData(); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleDeleteTimeOff = async (id) => {
    try { await api(`/schedule/time-off/${id}`, { method: 'DELETE' }); setSelectedTimeOff(null); loadData(); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleTimeOff = async (sd, ed, ot, cm) => {
    try {
      await api('/schedule/time-off', { method: 'POST', body: JSON.stringify({ start_date: sd, end_date: ed, off_type: ot, comment: cm }) });
      setToast({ message: 'Time-off requested', type: 'success' }); setShowTimeOff(false); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleReview = async (id, status) => {
    try { await api(`/schedule/time-off/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); setToast({ message: `Request ${status}`, type: 'success' }); loadData(); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
  const headerLabel = view === 'weekly'
    ? `${weekDates[0].toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${weekDates[6].toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' })}`
    : new Date(monthData.year, monthData.month).toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const renderShiftCell = (d, compact = false) => {
    const dayStr = fmt(d);
    const dayShifts = shifts.filter(s => s.date === dayStr);
    const dayOff = timeOff.filter(r =>
      r.status === 'approved' && r.start_date <= dayStr && r.end_date >= dayStr
    );

    const offTypeColors = { vacation: '#2563eb', sick_leave: '#dc2626', day_off: '#6b7280' };
    const offTypeEmoji = { vacation: '🏖️', sick_leave: '🤒', day_off: '🌿' };

    const offItems = dayOff.map(r => (
      <div key={`off-${r.id}`} onClick={() => setSelectedTimeOff(r)}
        style={{
          padding: compact ? '1px 4px' : '4px 7px', borderRadius: '5px', fontSize: compact ? '10px' : '11px',
          background: `${offTypeColors[r.off_type] || '#6b7280'}15`,
          border: `1px solid ${offTypeColors[r.off_type] || '#6b7280'}40`,
          color: offTypeColors[r.off_type] || '#6b7280', lineHeight: 1.3,
          cursor: 'pointer',
        }}>
        {offTypeEmoji[r.off_type] || '🏖️'} {compact ? (r.user?.display_name || '—').split(' ')[0] : (r.user?.display_name || '—')}
      </div>
    ));

    if (dayShifts.length === 0 && offItems.length === 0)
      return <div style={{ fontSize: '11px', color: t.textMuted, textAlign: 'center' }}>—</div>;

    return [...offItems, ...dayShifts.map(s => {
      const cfg = configMap[s.shift_type];
      const bgColor = cfg ? `${cfg.color}18` : t.surfaceAlt;
      const emoji = cfg?.emoji || '📋';
      const userName = s.user?.display_name || '—';
      const nameColor = s.user?.name_color || t.text;
      // Red alert: engineer has approved time-off on this day
      const onLeave = timeOff.some(r =>
        r.status === 'approved' &&
        String(r.user_id) === String(s.user_id) &&
        r.start_date <= dayStr && r.end_date >= dayStr
      );
      return (
        <div key={s.id} style={{
          padding: compact ? '2px 4px' : '5px 7px', borderRadius: '5px', fontSize: compact ? '10px' : '12px',
          background: onLeave ? `${t.danger}18` : bgColor,
          border: onLeave ? `2px solid ${t.danger}` : (!s.is_published ? `1px dashed ${t.border}` : `1px solid ${bgColor}`),
          opacity: s.is_published ? 1 : 0.7, lineHeight: 1.3, position: 'relative',
          cursor: isAdmin ? 'pointer' : 'default',
        }} title={onLeave ? '⚠️ Engineer is on approved leave — consider reassigning' : (isAdmin ? 'Click to edit' : '')}
          onClick={() => isAdmin && setSelectedShift(s)}>
          <div style={{ fontWeight: 600, color: onLeave ? t.danger : nameColor }}>
            {onLeave ? '⚠️' : emoji} {compact ? userName.split(' ')[0] : userName}
          </div>
          {!compact && <div style={{ color: onLeave ? t.danger : t.textMuted, fontSize: '10px' }}>
            {s.shift_type}{s.location ? ` · ${s.location}` : ''}{!s.is_published ? ' · draft' : ''}{onLeave ? ' · on leave!' : ''}
          </div>}
        </div>
      );
    })];
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{tr('schedule_title')}</h2>
          <p style={{ color: t.textMuted, fontSize: '13px', marginTop: '2px' }}>{headerLabel}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Tabs tabs={[{ id: 'weekly', label: tr('week') }, { id: 'monthly', label: tr('month') }]} active={view} onChange={v => { setView(v); setOffset(0); }} />
          <Button variant="secondary" size="sm" onClick={() => setOffset(o => o - 1)}>←</Button>
          <Button variant="secondary" size="sm" onClick={() => setOffset(0)}>{tr('today')}</Button>
          <Button variant="secondary" size="sm" onClick={() => setOffset(o => o + 1)}>→</Button>
          <Button variant="secondary" size="sm" onClick={() => setShowTimeOff(true)}>{tr('timeOff')}</Button>
          {isAdmin && <Button variant="secondary" size="sm" onClick={() => setShowAddShift(true)}>{tr('addShift')}</Button>}
          {isAdmin && <Button size="sm" onClick={() => setShowGenerate(true)}>{tr('generate')}</Button>}
          {isAdmin && <Button variant="secondary" size="sm" onClick={handlePublish}>{tr('publish')}</Button>}
          {isAdmin && <Button variant="danger" size="sm" onClick={handleClearDrafts}>Clear drafts</Button>}
        </div>
      </div>

      <WorldClock />

      <Card style={{ overflow: 'auto' }}>
        {loading ? <div style={{ padding: '48px', textAlign: 'center', color: t.textMuted, animation: 'pulse 1.5s infinite' }}>{tr('loading')}</div> : (
          view === 'weekly' ? (
            <div style={{ minWidth: '700px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${t.border}` }}>
                {weekDates.map((d, i) => {
                  const isToday = fmt(d) === fmt(new Date());
                  return (
                    <div key={i} style={{ padding: '12px 10px', textAlign: 'center', borderRight: i < 6 ? `1px solid ${t.borderLight}` : 'none', background: isToday ? t.accentLight : 'transparent' }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{DAY_NAMES[i]}</div>
                      <div style={{ fontSize: '18px', fontWeight: 700, color: isToday ? t.accent : t.text }}>{d.getDate()}</div>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: '200px' }}>
                {weekDates.map((d, i) => (
                  <div key={i} style={{ padding: '8px 6px', borderRight: i < 6 ? `1px solid ${t.borderLight}` : 'none', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {renderShiftCell(d)}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: `1px solid ${t.border}` }}>
                {DAY_NAMES.map(d => <div key={d} style={{ padding: '8px', textAlign: 'center', fontSize: '11px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase' }}>{d}</div>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {monthData.dates.map((d, i) => {
                  const isCurrentMonth = d.getMonth() === monthData.month;
                  const isToday = fmt(d) === fmt(new Date());
                  return (
                    <div key={i} style={{
                      padding: '4px', minHeight: '80px', borderRight: (i % 7) < 6 ? `1px solid ${t.borderLight}` : 'none',
                      borderBottom: i < 35 ? `1px solid ${t.borderLight}` : 'none',
                      opacity: isCurrentMonth ? 1 : 0.35, background: isToday ? t.accentLight : 'transparent',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: isToday ? t.accent : t.textMuted, marginBottom: '2px', padding: '2px 4px' }}>{d.getDate()}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>{renderShiftCell(d, true)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </Card>

      {/* Time Off Requests */}
      <Card style={{ padding: '20px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '12px' }}>{tr('timeOffRequests')}</h3>
        {timeOff.length === 0 ? <EmptyState icon="🏖️" title={tr('noRequests')} /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {timeOff.map(r => (
              <div key={r.id} onClick={() => setSelectedTimeOff(r)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: t.surfaceAlt, borderRadius: t.radiusSm, gap: '12px', flexWrap: 'wrap', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 500, fontSize: '14px' }}>{r.user?.display_name || 'You'}</span>
                  <span style={{ color: t.textSecondary, fontSize: '13px' }}>{r.start_date} → {r.end_date}</span>
                  <Badge color={r.off_type === 'vacation' ? 'blue' : r.off_type === 'sick_leave' ? 'red' : 'gray'}>{r.off_type.replace('_',' ')}</Badge>
                  <Badge color={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'yellow'}>{r.status}</Badge>
                </div>
                {isAdmin && r.status === 'pending' && (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <Button size="sm" onClick={() => handleReview(r.id, 'approved')}>✓</Button>
                    <Button size="sm" variant="danger" onClick={() => handleReview(r.id, 'rejected')}>✗</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {showGenerate && <GenerateModal onClose={() => setShowGenerate(false)} onGenerate={handleGenerate} dates={weekDates} configs={configs} />}
      {showTimeOff && <TimeOffModal onClose={() => setShowTimeOff(false)} onSubmit={handleTimeOff} />}
      {showAddShift && <AddShiftModal onClose={() => setShowAddShift(false)} onSubmit={handleAddShift} users={users} configs={configs} />}
      {selectedShift && isAdmin && (
        <ShiftDetailModal
          shift={selectedShift}
          configs={configs}
          onClose={() => setSelectedShift(null)}
          onSave={data => handleEditShift(selectedShift.id, data)}
          onDelete={() => confirm('Delete this shift?') && handleDeleteShift(selectedShift.id)}
        />
      )}
      {selectedTimeOff && (
        <TimeOffDetailModal
          entry={selectedTimeOff}
          isAdmin={isAdmin}
          onClose={() => setSelectedTimeOff(null)}
          onReview={async (status) => { await handleReview(selectedTimeOff.id, status); setSelectedTimeOff(null); }}
          onDelete={() => confirm('Delete this time-off request?') && handleDeleteTimeOff(selectedTimeOff.id)}
        />
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

function GenerateModal({ onClose, onGenerate, dates, configs }) {
  const { t: tr } = useLang();
  const [start, setStart] = useState(fmt(dates[0]));
  const [end, setEnd] = useState(fmt(dates[dates.length - 1]));
  const [types, setTypes] = useState(configs.filter(c => c.is_active).map(c => c.shift_type));
  const toggle = t => setTypes(ts => ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]);
  return (
    <Overlay onClose={onClose} title={tr('generateSchedule')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label={tr('start')} type="date" value={start} onChange={e => setStart(e.target.value)} />
        <Input label={tr('end')} type="date" value={end} onChange={e => setEnd(e.target.value)} />
        <div>
          <label style={{ fontSize: '13px', fontWeight: 500, marginBottom: '6px', display: 'block' }}>{tr('shiftTypes')}</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {configs.filter(c => c.is_active).map(c => (
              <Button key={c.shift_type} variant={types.includes(c.shift_type) ? 'primary' : 'secondary'} size="sm" onClick={() => toggle(c.shift_type)}>
                {c.emoji} {c.label}
              </Button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
          <Button onClick={() => onGenerate(start, end, types)} disabled={types.length === 0}>{tr('generate')}</Button>
        </div>
      </div>
    </Overlay>
  );
}

function AddShiftModal({ onClose, onSubmit, users, configs }) {
  const { t: tr } = useLang();
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState('');
  const [shiftType, setShiftType] = useState('day');
  const [location, setLocation] = useState('');
  const cfg = configs.find(c => c.shift_type === shiftType);
  return (
    <Overlay onClose={onClose} title={tr('addShiftManually')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Select label={tr('engineer')} value={userId} onChange={e => setUserId(e.target.value)}>
          <option value="">{tr('select')}</option>
          {users.filter(u => u.role === 'engineer' && u.is_active).map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </Select>
        <Input label={tr('date')} type="date" value={date} onChange={e => setDate(e.target.value)} />
        <Select label={tr('shiftType')} value={shiftType} onChange={e => setShiftType(e.target.value)}>
          {configs.filter(c => c.is_active).map(c => <option key={c.shift_type} value={c.shift_type}>{c.emoji} {c.label} ({c.duration_hours}h)</option>)}
        </Select>
        {cfg?.requires_location && (
          <Select label={tr('location')} value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">{tr('select')}</option>
            <option value="onsite">{tr('inOffice')}</option>
            <option value="remote">{tr('remote')}</option>
          </Select>
        )}
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
          <Button onClick={() => onSubmit({ user_id: userId, date, shift_type: shiftType, location: location || null })} disabled={!userId || !date}>{tr('add')}</Button>
        </div>
      </div>
    </Overlay>
  );
}

function TimeOffModal({ onClose, onSubmit }) {
  const { t: tr } = useLang();
  const [s, setS] = useState(''); const [e, setE] = useState(''); const [ot, setOt] = useState('day_off'); const [c, setC] = useState('');
  return (
    <Overlay onClose={onClose} title={tr('requestTimeOff')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label={tr('start')} type="date" value={s} onChange={ev => setS(ev.target.value)} />
        <Input label={tr('end')} type="date" value={e} onChange={ev => setE(ev.target.value)} />
        <Select label={tr('type')} value={ot} onChange={ev => setOt(ev.target.value)}>
          <option value="day_off">{tr('dayOff')}</option><option value="vacation">{tr('vacation')}</option><option value="sick_leave">{tr('sickLeave')}</option>
        </Select>
        <Input label={tr('comment')} value={c} onChange={ev => setC(ev.target.value)} />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
          <Button onClick={() => onSubmit(s, e, ot, c)} disabled={!s || !e}>{tr('submit')}</Button>
        </div>
      </div>
    </Overlay>
  );
}

function ShiftDetailModal({ shift, configs, onClose, onSave, onDelete }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [shiftType, setShiftType] = useState(shift.shift_type);
  const [location, setLocation] = useState(shift.location || '');
  const [notes, setNotes] = useState(shift.notes || '');
  const [isPublished, setIsPublished] = useState(shift.is_published);
  const cfg = configs.find(c => c.shift_type === shiftType);

  return (
    <Overlay onClose={onClose} title="Edit Shift">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: t.surfaceAlt, borderRadius: t.radiusSm }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: (shift.user?.name_color || t.accent) + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: shift.user?.name_color || t.accent }}>
            {(shift.user?.display_name || '?')[0]}
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{shift.user?.display_name || '—'}</div>
            <div style={{ fontSize: '12px', color: t.textMuted }}>{shift.date} · {shift.start_time?.slice(0,5) || '—'}–{shift.end_time?.slice(0,5) || '—'}</div>
          </div>
          <Badge color={isPublished ? 'green' : 'yellow'} style={{ marginLeft: 'auto' }}>{isPublished ? 'published' : 'draft'}</Badge>
        </div>

        <Select label="Shift type" value={shiftType} onChange={e => setShiftType(e.target.value)}>
          {configs.filter(c => c.is_active).map(c => (
            <option key={c.shift_type} value={c.shift_type}>{c.emoji} {c.label} ({c.duration_hours}h)</option>
          ))}
        </Select>

        {cfg?.requires_location && (
          <Select label="Location" value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">Not set</option>
            <option value="onsite">Onsite</option>
            <option value="remote">Remote</option>
          </Select>
        )}

        <Input label="Notes" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes…" />

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} />
          Published (visible to engineers)
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
          <Button variant="danger" onClick={onDelete}>Delete</Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
            <Button onClick={() => onSave({ shift_type: shiftType, location: location || null, notes: notes || null, is_published: isPublished })}>Save</Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function TimeOffDetailModal({ entry, isAdmin, onClose, onReview, onDelete }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const offTypeColors = { vacation: '#2563eb', sick_leave: '#dc2626', day_off: '#6b7280' };
  const offTypeEmoji = { vacation: '🏖️', sick_leave: '🤒', day_off: '🌿' };
  const color = offTypeColors[entry.off_type] || '#6b7280';

  return (
    <Overlay onClose={onClose} title="Time-off Request">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '12px 16px', background: `${color}10`, borderRadius: t.radiusSm, borderLeft: `3px solid ${color}` }}>
          <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
            {offTypeEmoji[entry.off_type]} {entry.user?.display_name || 'You'}
          </div>
          <div style={{ fontSize: '13px', color: t.textSecondary }}>{entry.start_date} → {entry.end_date}</div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
            <Badge color={entry.off_type === 'vacation' ? 'blue' : entry.off_type === 'sick_leave' ? 'red' : 'gray'}>{entry.off_type.replace('_',' ')}</Badge>
            <Badge color={entry.status === 'approved' ? 'green' : entry.status === 'rejected' ? 'red' : 'yellow'}>{entry.status}</Badge>
          </div>
          {entry.comment && <div style={{ fontSize: '12px', color: t.textMuted, marginTop: '8px' }}>{entry.comment}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <Button variant="danger" onClick={onDelete}>Delete</Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {isAdmin && entry.status === 'pending' && (
              <>
                <Button variant="danger" onClick={() => onReview('rejected')}>Reject</Button>
                <Button onClick={() => onReview('approved')}>Approve</Button>
              </>
            )}
            {isAdmin && entry.status !== 'pending' && (
              <Button variant="secondary" onClick={() => onReview('pending')}>Reset to pending</Button>
            )}
            <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

// ─── World Clock ─────────────────────────────────────────
const CLOCKS = [
  { label: 'Berlin',      tz: 'Europe/Berlin'       },
  { label: 'Moscow',      tz: 'Europe/Moscow'       },
  { label: 'Abu Dhabi',   tz: 'Asia/Dubai'          },
  { label: 'Mexico City', tz: 'America/Mexico_City' },
  { label: 'Bishkek',     tz: 'Asia/Bishkek'        },
];

export function WorldClock() {
  const { theme: t } = useTheme();
  const [now, setNow] = useState(new Date());
  const timerRef = useRef(null);

  useEffect(() => {
    const msToNext = 1000 - (Date.now() % 1000);
    const timeout = setTimeout(() => {
      setNow(new Date());
      timerRef.current = setInterval(() => setNow(new Date()), 1000);
    }, msToNext);
    return () => { clearTimeout(timeout); clearInterval(timerRef.current); };
  }, []);

  return (
    <div style={{
      display: 'flex', overflow: 'hidden',
      borderRadius: t.radius, border: `1px solid ${t.border}`,
      background: t.surface,
    }}>
      {CLOCKS.map((c, i) => {
        const time = now.toLocaleTimeString('en-GB', { timeZone: c.tz, hour: '2-digit', minute: '2-digit' });
        const h = parseInt(now.toLocaleString('en-GB', { timeZone: c.tz, hour: 'numeric', hour12: false }));
        const isNight = h < 7 || h >= 20;
        return (
          <div key={c.tz} style={{
            flex: 1, padding: '10px 12px', textAlign: 'center',
            borderRight: i < CLOCKS.length - 1 ? `1px solid ${t.borderLight}` : 'none',
            background: isNight ? t.surfaceAlt : 'transparent',
          }}>
            <div style={{ fontSize: '10px', fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '3px' }}>
              {isNight ? '🌙' : '☀️'} {c.label}
            </div>
            <div style={{ fontSize: '16px', fontWeight: 700, fontFamily: t.fontMono, color: t.text, letterSpacing: '1px' }}>
              {time}
            </div>
          </div>
        );
      })}
    </div>
  );
}
