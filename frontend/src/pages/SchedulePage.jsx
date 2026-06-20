import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, getPublicConfig } from '../api';
import { useLang } from '../components/LangContext';
import { Card, Button, Input, Badge, EmptyState, Overlay, Toast, Tabs, Select } from '../components/UI';
import { Icon } from '../components/Icons';

// --- Helpers ---

const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function localNow(timezone) {
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: timezone || 'UTC' }));
  } catch {
    return new Date();
  }
}

function getWeekDates(offset, timezone) {
  const n = localNow(timezone);
  n.setDate(n.getDate() + offset * 7);
  const s = new Date(n);
  // Adjust to Monday
  const day = s.getDay();
  const diff = s.getDate() - day + (day === 0 ? -6 : 1);
  s.setDate(diff);
  return Array.from({ length: 7 }, (_, i) => { const d = new Date(s); d.setDate(d.getDate() + i); return d; });
}

function getMonthDates(offset, timezone) {
  const n = localNow(timezone);
  n.setMonth(n.getMonth() + offset, 1);
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

function text(template, vars = {}) {
  return Object.entries(vars).reduce((out, [key, value]) => out.replaceAll(`{{${key}}}`, String(value)), template);
}

function shiftLabel(tr, type) {
  return tr(`shift_${type}`);
}

function statusColor(status) {
  return status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'yellow';
}

// --- Page Component ---

export default function SchedulePage({ user }) {
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
  const [addShiftPrefill, setAddShiftPrefill] = useState(null);
  const [selectedShift, setSelectedShift] = useState(null);
  const [selectedTimeOff, setSelectedTimeOff] = useState(null);
  const [toast, setToast] = useState(null);
  const [portalConfig, setPortalConfig] = useState({});
  const isAdmin = user.role === 'admin';

  const userTz = user?.timezone || 'UTC';

  const weekDates = useMemo(() => getWeekDates(offset, userTz), [offset, userTz]);
  const monthData = useMemo(() => getMonthDates(offset, userTz), [offset, userTz]);
  const activeDates = view === 'weekly' ? weekDates : monthData.dates;
  const rangeStart = activeDates[0];
  const rangeEnd = activeDates[activeDates.length - 1];

  const configMap = useMemo(() => {
    const m = {};
    configs.forEach(c => { m[c.shift_type] = c; });
    return m;
  }, [configs]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [s, c, u, to, pc] = await Promise.all([
        api(`/schedule/shifts?start_date=${fmt(rangeStart)}&end_date=${fmt(rangeEnd)}`),
        api('/schedule/shift-configs'),
        api('/users/'),
        api('/schedule/time-off'),
        getPublicConfig(),
      ]);
      setShifts(s || []); setConfigs(c || []); setUsers(u || []); setTimeOff(to || []); setPortalConfig(pc || {});
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  // Convert time stored in Portal Timezone to User Timezone for display
  const fmtTime = (value, date) => {
    if (!value) return '';
    try {
      const d = new Date(`${date}T${value}${value.length === 5 ? ':00' : ''}Z`);
      return d.toLocaleTimeString('en-GB', { timeZone: userTz, hour: '2-digit', minute: '2-digit' });
    } catch {
      return String(value).slice(0, 5);
    }
  };

  const handleGenerate = async (startDate, endDate, types) => {
    try {
      await api('/schedule/generate', { method: 'POST', body: JSON.stringify({ start_date: startDate, end_date: endDate, shift_types: types }) });
      setToast({ message: tr('scheduleGenerated'), type: 'success' }); setShowGenerate(false); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleClearDrafts = async () => {
    const draftCount = shifts.filter(s => !s.is_published && !s.pending_delete).length;
  const pendingRemoveCount = shifts.filter(s => s.pending_delete).length;
    if (draftCount === 0) { setToast({ message: tr('scheduleNoDrafts'), type: 'info' }); return; }
    if (!confirm(text(tr('scheduleDeleteDraftsConfirm'), { count: draftCount }))) return;
    try {
      const r = await api(`/schedule/shifts/drafts?start_date=${fmt(rangeStart)}&end_date=${fmt(rangeEnd)}`, { method: 'DELETE' });
      setToast({ message: text(tr('scheduleClearedDrafts'), { count: r.deleted }), type: 'success' }); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handlePublish = async () => {
    try {
      const r = await api(`/schedule/publish?start_date=${fmt(rangeStart)}&end_date=${fmt(rangeEnd)}`, { method: 'POST' });
      const parts = [];
      if (r.published) parts.push(`${r.published} published`);
      if (r.removed) parts.push(`${r.removed} removed`);
      setToast({ message: parts.length ? parts.join(', ') : 'Nothing to publish', type: 'success' }); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleAddShift = async (data) => {
    try {
      await api('/schedule/shifts', { method: 'POST', body: JSON.stringify(data) });
      setToast({ message: tr('scheduleShiftAdded'), type: 'success' }); setAddShiftPrefill(null); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleDeleteShift = async (id) => {
    try { await api(`/schedule/shifts/${id}`, { method: 'DELETE' }); setSelectedShift(null); loadData(); }
    catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleUndoDelete = async (id) => {
    try { await api(`/schedule/shifts/${id}`, { method: 'PATCH', body: JSON.stringify({ pending_delete: false }) }); setSelectedShift(null); loadData(); }
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
      setToast({ message: tr('scheduleTimeOffRequested'), type: 'success' }); setShowTimeOff(false); loadData();
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
  const published = shifts.length > 0 && shifts.every(s => s.is_published && !s.pending_delete);
  const activeShiftTypes = configs.filter(c => c.is_active);

  const leaveConflicts = shifts.filter(s => timeOff.some(r =>
    r.status === 'approved' &&
    String(r.user_id) === String(s.user_id) &&
    r.start_date <= s.date && r.end_date >= s.date
  ));
  const firstConflict = leaveConflicts[0];
  const firstConflictDate = firstConflict
    ? new Date(`${firstConflict.date}T00:00:00`).toLocaleDateString(locale, { weekday: 'long' })
    : '';
  const conflictCopy = firstConflict ? text(
    tr(leaveConflicts.length === 1 ? 'scheduleConflictBanner' : 'scheduleConflictBannerMany'),
    {
      count: leaveConflicts.length,
      date: firstConflictDate,
      shift: shiftLabel(tr, firstConflict.shift_type).toLowerCase(),
    },
  ) : '';

  const renderShiftCell = (d, compact = false) => {
    const dayStr = fmt(d);
    const dayShifts = shifts.filter(s => s.date === dayStr);
    const dayOff = timeOff.filter(r =>
      r.status === 'approved' && r.start_date <= dayStr && r.end_date >= dayStr
    );

    const offTypeColors = { vacation: '#2563eb', sick_leave: 'var(--danger)', day_off: '#6b7280' };
    const offTypeIcon = { vacation: 'leaf', sick_leave: 'alertTriangle', day_off: 'leaf' };

    const offItems = dayOff.map(r => (
      <div key={`off-${r.id}`} onClick={() => setSelectedTimeOff(r)}
        style={{
          padding: compact ? '1px 4px' : '4px 7px', borderRadius: '5px', fontSize: compact ? '10px' : '11px',
          background: `${offTypeColors[r.off_type] || '#6b7280'}15`,
          border: `1px solid ${offTypeColors[r.off_type] || '#6b7280'}40`,
          color: offTypeColors[r.off_type] || '#6b7280', lineHeight: 1.3,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '3px',
        }}>
        <Icon name={offTypeIcon[r.off_type] || 'leaf'} size={13} /> {compact ? (r.user?.display_name || '—').split(' ')[0] : (r.user?.display_name || '—')}
      </div>
    ));

    if (dayShifts.length === 0 && offItems.length === 0) {
      if (isAdmin) {
        return (
          <button type="button" className="schedule-cell-add-more" style={{ padding: '2px 4px', fontSize: '10px' }}
            title={tr('addShiftManually')}
            onClick={() => setAddShiftPrefill({ date: dayStr })}>
            <Icon name="plus" size={11} />
          </button>
        );
      }
      return <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>—</div>;
    }

    return [...offItems, ...dayShifts.map(s => {
      const cfg = configMap[s.shift_type];
      const isPendingDelete = s.pending_delete;
      const bgColor = isPendingDelete ? 'var(--danger-light)' : (cfg ? `${cfg.color}18` : 'var(--surface-alt)');
      const textColor = isPendingDelete ? 'var(--danger)' : (cfg ? cfg.color : 'var(--text-secondary)');
      const label = cfg ? cfg.label : s.shift_type;
      const uName = s.user?.display_name || 'Unassigned';

      return (
        <div key={s.id} onClick={() => setSelectedShift(s)}
          style={{
            padding: compact ? '1px 4px' : '5px 8px', borderRadius: '5px', fontSize: compact ? '10px' : '11px',
            background: bgColor, border: `1px solid ${textColor}30`,
            color: textColor, lineHeight: 1.3, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: '1px',
            opacity: isPendingDelete ? 0.6 : (s.is_published ? 1 : 0.65),
            borderStyle: isPendingDelete ? 'solid' : (s.is_published ? 'solid' : 'dashed'),
          }}>
          <div style={{ fontWeight: 700, fontSize: compact ? '9px' : '10px', textTransform: 'uppercase', letterSpacing: '0.02em', display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ textDecoration: isPendingDelete ? 'line-through' : 'none' }}>{label}</span>
            {isPendingDelete && <span>🗑</span>}
            {!s.is_published && !isPendingDelete && <span>DRAFT</span>}
          </div>
          <div style={{ fontWeight: 600, color: isPendingDelete ? 'var(--danger)' : 'var(--text)', textDecoration: isPendingDelete ? 'line-through' : 'none' }}>{compact ? uName.split(' ')[0] : uName}</div>
          {s.start_time && !compact && <div style={{ fontSize: '9px', opacity: 0.8 }}>{fmtTime(s.start_time, s.date)} – {fmtTime(s.end_time, s.date)}</div>}
        </div>
      );
    })];
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 42, letterSpacing: '-0.04em', lineHeight: 1, color: 'var(--text)', margin: 0 }}>{tr('schedule_title')}</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '15px', marginTop: '8px' }}>
            {view === 'weekly' ? `${tr('scheduleWeekOf')} ${headerLabel}` : headerLabel} · {published ? tr('schedulePublished') : tr('scheduleDraft')}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <Tabs tabs={[{ id: 'weekly', label: tr('week') }, { id: 'monthly', label: tr('month') }]} active={view} onChange={v => { setView(v); setOffset(0); }} />
          <Button variant="secondary" size="sm" icon="chevronLeft" onClick={() => setOffset(o => o - 1)} />
          <Button variant="secondary" size="sm" onClick={() => setOffset(0)}>{tr('today')}</Button>
          <Button variant="secondary" size="sm" icon="chevronRight" onClick={() => setOffset(o => o + 1)} />
          <Button variant="secondary" size="sm" icon="sun" onClick={() => setShowTimeOff(true)}>{tr('timeOff')}</Button>
          {isAdmin && <Button variant="secondary" size="sm" icon="plus" onClick={() => setAddShiftPrefill({})}>{tr('addShift')}</Button>}
          {isAdmin && <Button size="sm" icon="zap" onClick={() => setShowGenerate(true)}>{tr('generate')}</Button>}
          {isAdmin && <Button variant="secondary" size="sm" icon="check" onClick={handlePublish}>{tr('publish')}</Button>}
          {isAdmin && <Button variant="danger" size="sm" icon="trash" onClick={handleClearDrafts}>{tr('scheduleClearDrafts')}</Button>}
        </div>
      </div>

      {conflictCopy && (
        <Card style={{ borderColor: 'color-mix(in srgb, var(--warning) 45%, var(--border))', background: 'color-mix(in srgb, var(--warning) 9%, var(--surface))' }}>
          <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Icon name="alertTriangle" size={18} color="var(--warning)" />
            <div style={{ flex: 1, fontSize: 15, color: 'var(--text)' }}>{conflictCopy}</div>
            <Button size="sm" variant="ghost">{tr('scheduleSuggest')}</Button>
            <Button size="sm">{tr('scheduleResolve')}</Button>
          </div>
        </Card>
      )}

      <Card style={{ overflow: 'auto' }}>
        {loading ? <div style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)', animation: 'pulse 1.5s infinite' }}>{tr('loading')}</div> : (
          view === 'weekly' ? (
            <WeeklyScheduleBoard
              weekDates={weekDates}
              shiftTypes={activeShiftTypes}
              shifts={shifts}
              timeOff={timeOff}
              isAdmin={isAdmin}
              locale={locale}
              tr={tr}
              onShiftClick={setSelectedShift}
              onCellAdd={(date, shiftType) => setAddShiftPrefill({ date, shift_type: shiftType })}
              fmtTime={fmtTime}
            />
          ) : (
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border)' }}>
                {DAY_KEYS.map((_, i) => (
                  <div key={i} style={{ padding: '8px', textAlign: 'center' }}>
                    <span className="t-eyebrow">{new Date(2026, 4, 4 + i).toLocaleDateString(locale, { weekday: 'short' })}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
                {monthData.dates.map((d, i) => {
                  const isCurrentMonth = d.getMonth() === monthData.month;
                  const isToday = fmt(d) === fmt(localNow(userTz));
                  return (
                    <div key={i} style={{
                      padding: '4px', minHeight: '80px', borderRight: (i % 7) < 6 ? '1px solid var(--border-light)' : 'none',
                      borderBottom: i < 35 ? '1px solid var(--border-light)' : 'none',
                      opacity: isCurrentMonth ? 1 : 0.35, background: isToday ? 'var(--accent-light)' : 'transparent',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: 600, color: isToday ? 'var(--accent)' : 'var(--text-muted)', marginBottom: '2px', padding: '2px 4px' }}>{d.getDate()}</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>{renderShiftCell(d, true)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )
        )}
      </Card>

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 420px), 1fr))', gap: 16 }}>
          <CoveragePanel shifts={shifts} users={users} configs={configs} tr={tr} />
          <TimeOffPanel timeOff={timeOff} locale={locale} tr={tr} onRequest={() => setShowTimeOff(true)} onSelect={setSelectedTimeOff} />
        </div>
      )}

      {showGenerate && <GenerateModal onClose={() => setShowGenerate(false)} onGenerate={handleGenerate} dates={weekDates} configs={configs} />}
      {showTimeOff && <TimeOffModal onClose={() => setShowTimeOff(false)} onSubmit={handleTimeOff} />}
      {addShiftPrefill && <AddShiftModal onClose={() => setAddShiftPrefill(null)} onSubmit={handleAddShift} users={users} configs={configs} prefill={addShiftPrefill} />}
      {selectedShift && isAdmin && (
        <ShiftDetailModal
          shift={selectedShift}
          configs={configs}
          onClose={() => setSelectedShift(null)}
          onSave={data => handleEditShift(selectedShift.id, data)}
          onDelete={() => {
            if (selectedShift.pending_delete) { handleUndoDelete(selectedShift.id); return; }
            const msg = selectedShift.is_published ? tr('scheduleStageForRemovalConfirm') : tr('scheduleDeleteShiftConfirm');
            confirm(msg) && handleDeleteShift(selectedShift.id);
          }}
        />
      )}
      {selectedTimeOff && (
        <TimeOffDetailModal
          entry={selectedTimeOff}
          isAdmin={isAdmin}
          onClose={() => setSelectedTimeOff(null)}
          onReview={async (status) => { await handleReview(selectedTimeOff.id, status); setSelectedTimeOff(null); }}
          onDelete={() => confirm(tr('scheduleDeleteTimeOffConfirm')) && handleDeleteTimeOff(selectedTimeOff.id)}
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
                <Icon name={c.shift_type === 'night' ? 'moon' : c.shift_type === 'office' ? 'workspace' : 'sun'} size={14} style={{ marginRight: 6 }} />
                {shiftLabel(tr, c.shift_type)}
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

function AddShiftModal({ onClose, onSubmit, users, configs, prefill = {} }) {
  const { t: tr } = useLang();
  const [userId, setUserId] = useState('');
  const [date, setDate] = useState(prefill.date || '');
  const activeConfigs = configs.filter(c => c.is_active);
  const [shiftType, setShiftType] = useState(prefill.shift_type || activeConfigs[0]?.shift_type || '');
  const [location, setLocation] = useState('');
  const cfg = configs.find(c => c.shift_type === shiftType);
  useEffect(() => {
    const nextConfigs = configs.filter(c => c.is_active);
    if (nextConfigs.length === 0) return;
    if (!nextConfigs.some(c => c.shift_type === shiftType)) {
      setShiftType(nextConfigs[0].shift_type);
    }
  }, [configs, shiftType]);

  return (
    <Overlay onClose={onClose} title={tr('addShiftManually')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Select label={tr('engineer')} value={userId} onChange={e => setUserId(e.target.value)}>
          <option value="">{tr('select')}</option>
          {users.filter(u => u.role === 'engineer' && u.is_active).map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </Select>
        <Input label={tr('date')} type="date" value={date} onChange={e => setDate(e.target.value)} />
        <Select label={tr('shiftType')} value={shiftType} onChange={e => setShiftType(e.target.value)}>
          {activeConfigs.map(c => <option key={c.shift_type} value={c.shift_type}>{shiftLabel(tr, c.shift_type)} ({c.duration_hours}h)</option>)}
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
          <Button
            onClick={() => onSubmit({ user_id: userId, date, shift_type: shiftType, location: location || null })}
            disabled={!userId || !date || !shiftType || (cfg?.requires_location && !location)}
          >
            {tr('add')}
          </Button>
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
  const { t: tr } = useLang();
  const [shiftType, setShiftType] = useState(shift.shift_type);
  const [location, setLocation] = useState(shift.location || '');
  const [notes, setNotes] = useState(shift.notes || '');
  const [isPublished, setIsPublished] = useState(shift.is_published);
  const cfg = configs.find(c => c.shift_type === shiftType);

  return (
    <Overlay onClose={onClose} title={tr('scheduleEditShift')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'var(--surface-alt)', borderRadius: 'var(--radius-sm)' }}>
          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: (shift.user?.name_color || 'var(--accent)') + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, color: shift.user?.name_color || 'var(--accent)' }}>
            {(shift.user?.display_name || '?')[0]}
          </div>
          <div>
            <div style={{ fontWeight: 600 }}>{shift.user?.display_name || '—'}</div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{shift.date} · {shift.start_time?.slice(0,5) || '—'}–{shift.end_time?.slice(0,5) || '—'}</div>
          </div>
          <Badge color={shift.pending_delete ? 'red' : (isPublished ? 'green' : 'yellow')} style={{ marginLeft: 'auto' }}>
            {shift.pending_delete ? tr('scheduleStagedForRemoval') : (isPublished ? tr('schedulePublished') : tr('scheduleDraft'))}
          </Badge>
        </div>

        {shift.pending_delete && (
          <div style={{ padding: '10px 14px', background: 'var(--danger-light)', border: '1px solid color-mix(in srgb, var(--danger) 30%, transparent)', borderRadius: 'var(--radius-sm)', color: 'var(--danger)', fontSize: 13 }}>
            🗑 {tr('scheduleStagedForRemoval')} — will be deleted on next Publish
          </div>
        )}

        <Select label={tr('shiftType')} value={shiftType} onChange={e => setShiftType(e.target.value)}>
          {configs.filter(c => c.is_active).map(c => (
            <option key={c.shift_type} value={c.shift_type}>{shiftLabel(tr, c.shift_type)} ({c.duration_hours}h)</option>
          ))}
        </Select>

        {cfg?.requires_location && (
          <Select label={tr('location')} value={location} onChange={e => setLocation(e.target.value)}>
            <option value="">{tr('select')}</option>
            <option value="onsite">{tr('inOffice')}</option>
            <option value="remote">{tr('remote')}</option>
          </Select>
        )}

        <Input label={tr('scheduleNotes')} value={notes} onChange={e => setNotes(e.target.value)} placeholder={tr('scheduleNotesPlaceholder')} />

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
          <input type="checkbox" checked={isPublished} onChange={e => setIsPublished(e.target.checked)} />
          {tr('schedulePublishedVisible')}
        </label>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '4px' }}>
          <Button variant={shift.pending_delete ? 'secondary' : 'danger'} onClick={onDelete}>
            {shift.pending_delete ? tr('scheduleUndoRemoval') : tr('delete')}
          </Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
            <Button onClick={() => onSave({ shift_type: shiftType, location: location || null, notes: notes || null, is_published: isPublished })}>{tr('save')}</Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function TimeOffDetailModal({ entry, isAdmin, onClose, onReview, onDelete }) {
  const { t: tr } = useLang();
  const offTypeColors = { vacation: '#2563eb', sick_leave: 'var(--danger)', day_off: '#6b7280' };
  const offTypeIcon = { vacation: 'leaf', sick_leave: 'alertTriangle', day_off: 'leaf' };
  const color = offTypeColors[entry.off_type] || '#6b7280';

  return (
    <Overlay onClose={onClose} title={tr('requestTimeOff')}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '12px 16px', background: `${color}10`, borderRadius: 'var(--radius-sm)', borderLeft: `3px solid ${color}` }}>
          <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Icon name={offTypeIcon[entry.off_type] || 'leaf'} size={15} /> {entry.user?.display_name || 'You'}
          </div>
          <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{entry.start_date} → {entry.end_date}</div>
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' }}>
            <Badge color={entry.off_type === 'vacation' ? 'blue' : entry.off_type === 'sick_leave' ? 'red' : 'gray'}>
              {entry.off_type === 'vacation' ? tr('vacation') : entry.off_type === 'sick_leave' ? tr('sickLeave') : tr('dayOff')}
            </Badge>
            <Badge color={entry.status === 'approved' ? 'green' : entry.status === 'rejected' ? 'red' : 'yellow'}>{entry.status}</Badge>
          </div>
          {entry.comment && <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '8px' }}>{entry.comment}</div>}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          <Button variant="danger" onClick={onDelete}>{tr('delete')}</Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            {isAdmin && entry.status === 'pending' && (
              <>
                <Button variant="danger" onClick={() => onReview('rejected')}>{tr('reject')}</Button>
                <Button onClick={() => onReview('approved')}>{tr('approve')}</Button>
              </>
            )}
            {isAdmin && entry.status !== 'pending' && (
              <Button variant="secondary" onClick={() => onReview('pending')}>{tr('scheduleResetPending')}</Button>
            )}
            <Button variant="secondary" onClick={onClose}>{tr('cancel')}</Button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}

function WeeklyScheduleBoard({ weekDates, shiftTypes, shifts, timeOff, isAdmin, locale, tr, onShiftClick, onCellAdd, fmtTime }) {
  const todayKey = fmt(new Date());
  return (
    <div style={{ minWidth: 960 }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '128px repeat(7, minmax(112px, 1fr))',
        borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ background: 'var(--surface-alt)' }} />
        {weekDates.map((d, i) => {
          const key = fmt(d);
          const isToday = key === todayKey;
          return (
            <div key={key} style={{
              padding: '15px 12px',
              textAlign: 'center',
              borderLeft: '1px solid var(--border-light)',
              background: isToday ? 'var(--accent-light)' : 'transparent',
            }}>
              <div className="t-eyebrow" style={{ color: isToday ? 'var(--accent)' : 'var(--text-muted)' }}>
                {d.toLocaleDateString(locale, { weekday: 'short' })}
              </div>
              <div style={{
                marginTop: 3,
                fontFamily: 'var(--font-display)',
                fontSize: 28,
                fontWeight: 600,
                lineHeight: 1,
                color: isToday ? 'var(--accent)' : 'var(--text)',
              }}>
                {String(d.getDate()).padStart(2, '0')}
              </div>
            </div>
          );
        })}
      </div>

      {shiftTypes.map((cfg, rowIndex) => (
        <div key={cfg.shift_type} style={{
          display: 'grid',
          gridTemplateColumns: '128px repeat(7, minmax(112px, 1fr))',
          minHeight: 132,
          borderBottom: rowIndex < shiftTypes.length - 1 ? '1px solid var(--border-light)' : 'none',
        }}>
          <div style={{
            padding: '20px 16px',
            background: 'var(--surface-alt)',
            borderRight: '1px solid var(--border-light)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <Icon name={cfg.shift_type === 'night' ? 'moon' : cfg.shift_type === 'office' ? 'workspace' : 'sun'} size={18} color={cfg.color || 'var(--accent)'} />
            <div style={{ fontSize: 16, fontWeight: 700 }}>{shiftLabel(tr, cfg.shift_type)}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {cfg.default_start_time?.slice(0,5)} – {cfg.default_end_time?.slice(0,5)}
            </div>
          </div>

          {weekDates.map((day) => {
            const dayKey = fmt(day);
            const dayShifts = shifts.filter(s => s.date === dayKey && s.shift_type === cfg.shift_type);
            return (
              <div key={`${cfg.shift_type}-${dayKey}`} style={{
                padding: 10,
                borderLeft: '1px solid var(--border-light)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                minHeight: 132,
              }}>
                {dayShifts.length > 0 ? dayShifts.map(shift => (
                  <ShiftPill
                    key={shift.id}
                    shift={shift}
                    config={cfg}
                    timeOff={timeOff}
                    isAdmin={isAdmin}
                    tr={tr}
                    onClick={() => isAdmin && onShiftClick(shift)}
                  />
                )) : (
                  isAdmin ? (
                    <button type="button" className="schedule-cell-add" title={tr('addShiftManually')}
                      style={{ margin: 'auto' }}
                      onClick={() => onCellAdd(dayKey, cfg.shift_type)}>
                      <Icon name="plus" size={15} />
                    </button>
                  ) : (
                    <div style={{ margin: 'auto', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>—</div>
                  )
                )}
                {isAdmin && dayShifts.length > 0 && (
                  <button type="button" className="schedule-cell-add-more" onClick={() => onCellAdd(dayKey, cfg.shift_type)}>
                    <Icon name="plus" size={11} /> {tr('add')}
                  </button>
                )}
                {dayShifts.some(s => timeOff.some(r => r.status === 'approved' && String(r.user_id) === String(s.user_id) && r.start_date <= s.date && r.end_date >= s.date)) && (
                  <div style={{ marginTop: 'auto', color: 'var(--warning)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700 }}>
                    <Icon name="alertTriangle" size={12} style={{ display: 'inline-block', verticalAlign: '-2px', marginRight: 4 }} />
                    {tr('scheduleShortStaffed')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function ShiftPill({ shift, config, timeOff, isAdmin, tr, onClick }) {
  const userName = shift.user?.display_name || '—';
  const isPendingDelete = shift.pending_delete;
  const color = isPendingDelete ? 'var(--danger)' : (shift.user?.name_color || config?.color || 'var(--accent)');
  const onLeave = !isPendingDelete && timeOff.some(r =>
    r.status === 'approved' &&
    String(r.user_id) === String(shift.user_id) &&
    r.start_date <= shift.date && r.end_date >= shift.date
  );
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!isAdmin}
      title={isPendingDelete ? tr('scheduleStagedForRemoval') : (onLeave ? tr('scheduleShortStaffed') : userName)}
      style={{
        border: `1px solid ${isPendingDelete ? 'color-mix(in srgb, var(--danger) 30%, transparent)' : 'var(--border-light)'}`,
        borderLeft: `4px solid ${isPendingDelete ? 'var(--danger)' : (onLeave ? 'var(--danger)' : color)}`,
        borderRadius: 'var(--radius-sm)',
        background: isPendingDelete ? 'var(--danger-light)' : (onLeave ? 'var(--danger-light)' : `color-mix(in srgb, ${color} 14%, var(--surface-alt))`),
        color: 'var(--text)',
        padding: '9px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        cursor: isAdmin ? 'pointer' : 'default',
        textAlign: 'left',
        opacity: isPendingDelete ? 0.6 : (shift.is_published ? 1 : 0.65),
      }}
    >
      <span style={{
        width: 26,
        height: 26,
        borderRadius: 'var(--radius-sm)',
        background: color,
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 11,
        fontWeight: 700,
        flexShrink: 0,
      }}>
        {isPendingDelete ? '🗑' : userName.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase()}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: isPendingDelete ? 'line-through' : 'none', color: isPendingDelete ? 'var(--danger)' : 'inherit' }}>{userName}</span>
        {isPendingDelete
          ? <span style={{ display: 'block', color: 'var(--danger)', fontSize: 11, fontWeight: 600 }}>{tr('scheduleStagedForRemoval')}</span>
          : shift.location && <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: 11 }}>{shift.location}</span>
        }
      </span>
    </button>
  );
}

function CoveragePanel({ shifts, users, configs, tr }) {
  const hoursByUser = new Map();
  const configMap = Object.fromEntries(configs.map(c => [c.shift_type, c]));
  shifts.forEach(shift => {
    const hours = configMap[shift.shift_type]?.duration_hours || (shift.shift_type === 'office' ? 8 : 12);
    const key = String(shift.user_id);
    const existing = hoursByUser.get(key) || {
      id: key,
      name: shift.user?.display_name || users.find(u => String(u.id) === key)?.display_name || '—',
      color: shift.user?.name_color || users.find(u => String(u.id) === key)?.name_color || 'var(--accent)',
      hours: 0,
    };
    existing.hours += hours;
    hoursByUser.set(key, existing);
  });
  const rows = [...hoursByUser.values()].sort((a, b) => b.hours - a.hours);

  return (
    <Card
      accent="var(--accent)"
      header={<><Icon name="clock" size={18} color="var(--accent)" /><h2 style={{ margin: 0, fontSize: 22 }}>{tr('scheduleCoverageThisWeek')}</h2></>}
    >
      {rows.length === 0 ? (
        <EmptyState title={tr('scheduleNoCoverage')} />
      ) : (
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {rows.map(row => {
            const pct = Math.min(100, (row.hours / 40) * 100);
            return (
              <div key={row.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 220px) 1fr auto', gap: 14, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                  <span style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: row.color, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                    {row.name.split(/\s+/).map(s => s[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</strong>
                </div>
                <div style={{ height: 7, borderRadius: 999, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: row.color, borderRadius: 999 }} />
                </div>
                <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>{row.hours}/40h</div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function TimeOffPanel({ timeOff, locale, tr, onRequest, onSelect }) {
  const items = [...timeOff].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date))).slice(0, 6);
  return (
    <Card
      accent="var(--accent)"
      header={<><Icon name="calendar" size={18} color="var(--accent)" /><h2 style={{ margin: 0, fontSize: 22 }}>{tr('scheduleTimeOffPanel')}</h2><span style={{ flex: 1 }} /><Button size="sm" variant="ghost" icon="plus" onClick={onRequest}>{tr('scheduleRequest')}</Button></>}
    >
      {items.length === 0 ? (
        <EmptyState title={tr('scheduleNoTimeOff')} />
      ) : (
        <div>
          {items.map(item => {
            const label = item.off_type === 'vacation' ? tr('vacation') : item.off_type === 'sick_leave' ? tr('sickLeave') : tr('dayOff');
            const range = item.start_date === item.end_date
              ? new Date(`${item.start_date}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })
              : `${new Date(`${item.start_date}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} – ${new Date(`${item.end_date}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item)}
                style={{
                  width: '100%',
                  border: 'none',
                  borderBottom: '1px solid var(--border-light)',
                  background: 'transparent',
                  color: 'var(--text)',
                  padding: '14px 18px',
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr) auto',
                  gap: 12,
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.user?.display_name || '—'} — {label}</strong>
                  <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{range}</span>
                </span>
                <Badge color={statusColor(item.status)} dot>{item.status}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );
}
