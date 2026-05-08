import { useState, useEffect, useCallback, useMemo } from 'react';
import { api, getPublicConfig } from '../api';
import { useLang } from '../components/LangContext';
import { Card, Button, Input, Badge, EmptyState, Overlay, Toast, Tabs, Select } from '../components/UI';
import { Icon } from '../components/Icons';

// --- Helpers ---

const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

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
  const [showAddShift, setShowAddShift] = useState(false);
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
      const portalTz = portalConfig.portal_timezone || 'UTC';
      // Since we don't have a robust timezone library, we assume Portal Timezone is UTC for now
      // as it's the default. If it's not UTC, conversion without a library is extremely complex.
      // But we can at least show it in the user's timezone if we assume DB stores UTC.
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
    const draftCount = shifts.filter(s => !s.is_published).length;
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
      setToast({ message: `Published ${r.published} shifts`, type: 'success' }); loadData();
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const handleAddShift = async (data) => {
    try {
      await api('/schedule/shifts', { method: 'POST', body: JSON.stringify(data) });
      setToast({ message: tr('scheduleShiftAdded'), type: 'success' }); setShowAddShift(false); loadData();
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
  const published = shifts.length > 0 && shifts.every(s => s.is_published);
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

    if (dayShifts.length === 0 && offItems.length === 0)
      return <div style={{ fontSize: '11px', color: 'var(--text-muted)', textAlign: 'center' }}>—</div>;

    return [...offItems, ...dayShifts.map(s => {
      const cfg = configMap[s.shift_type];
      const bgColor = cfg ? `${cfg.color}18` : 'var(--surface-alt)';
      const textColor = cfg ? cfg.color : 'var(--text-secondary)';
      const label = cfg ? cfg.label : s.shift_type;
      const uName = s.user?.display_name || 'Unassigned';

      return (
        <div key={s.id} onClick={() => setSelectedShift(s)}
          style={{
            padding: compact ? '1px 4px' : '5px 8px', borderRadius: '5px', fontSize: compact ? '10px' : '11px',
            background: bgColor, border: `1px solid ${textColor}30`,
            color: textColor, lineHeight: 1.3, cursor: 'pointer',
            display: 'flex', flexDirection: 'column', gap: '1px', opacity: s.is_published ? 1 : 0.65,
            borderStyle: s.is_published ? 'solid' : 'dashed',
          }}>
          <div style={{ fontWeight: 700, fontSize: compact ? '9px' : '10px', textTransform: 'uppercase', letterSpacing: '0.02em', display: 'flex', justifyContent: 'space-between' }}>
            <span>{label}</span>
            {!s.is_published && <span>DRAFT</span>}
          </div>
          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{compact ? uName.split(' ')[0] : uName}</div>
          {s.start_time && !compact && <div style={{ fontSize: '9px', opacity: 0.8 }}>{fmtTime(s.start_time, s.date)} – {fmtTime(s.end_time, s.date)}</div>}
        </div>
      );
    })];
  };

  const todayStr = fmt(localNow(userTz));

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Header & Controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.02em', margin: 0 }}>{tr('schedule')}</h1>
          <Tabs tabs={[{ id: 'weekly', label: tr('weekly') }, { id: 'monthly', label: tr('monthly') }]} active={view} onChange={v => { setView(v); setOffset(0); }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'var(--surface-alt)', padding: '4px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
            <Button size="sm" variant="ghost" icon="chevronLeft" onClick={() => setOffset(o => o - 1)} />
            <div style={{ padding: '0 12px', fontSize: '14px', fontWeight: 600, minWidth: '160px', textAlign: 'center' }}>{headerLabel}</div>
            <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => setOffset(o => o + 1)} />
            <Button size="sm" variant="ghost" onClick={() => setOffset(0)} style={{ marginLeft: '4px', fontSize: '12px' }}>{tr('today')}</Button>
          </div>
          <Button size="sm" variant="secondary" icon="sun" onClick={() => setShowTimeOff(true)}>{tr('requestTimeOff')}</Button>
          {isAdmin && (
            <div style={{ display: 'flex', gap: '8px', borderLeft: '1px solid var(--border)', paddingLeft: '8px', marginLeft: '4px' }}>
              <Button size="sm" variant="secondary" icon="zap" onClick={() => setShowGenerate(true)}>{tr('generate')}</Button>
              {!published && shifts.length > 0 && <Button size="sm" variant="primary" icon="check" onClick={handlePublish}>{tr('publish')}</Button>}
              {!published && shifts.length > 0 && <Button size="sm" variant="danger" icon="trash" onClick={handleClearDrafts}>{tr('clearDrafts')}</Button>}
              <Button size="sm" variant="secondary" icon="plus" onClick={() => setShowAddShift(true)} />
            </div>
          )}
        </div>
      </div>

      {/* Conflict Banner */}
      {isAdmin && firstConflict && (
        <div style={{
          background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 'var(--radius)',
          padding: '12px 18px', display: 'flex', alignItems: 'center', gap: '14px', color: 'var(--danger)',
        }}>
          <Icon name="alertTriangle" size={20} />
          <div style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{conflictCopy}</div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button size="sm" variant="danger" onClick={() => {}}>Resolve</Button>
          </div>
        </div>
      )}

      {/* Grid */}
      <Card style={{ padding: '0', overflow: 'hidden' }}>
        {view === 'weekly' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', minHeight: '400px' }}>
            {weekDates.map((d, i) => {
              const isToday = fmt(d) === todayStr;
              return (
                <div key={i} style={{
                  display: 'flex', flexDirection: 'column',
                  borderRight: i < 6 ? '1px solid var(--border-light)' : 'none',
                  background: isToday ? 'var(--accent-light)' : 'transparent',
                }}>
                  <div style={{
                    padding: '12px', borderBottom: '1px solid var(--border-light)', textAlign: 'center',
                    background: isToday ? 'var(--accent)' : 'var(--surface-alt)',
                    color: isToday ? '#fff' : 'var(--text-secondary)',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{DAY_NAMES[i]}</div>
                    <div style={{ fontSize: '18px', fontWeight: 800 }}>{d.getDate()}</div>
                  </div>
                  <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
                    {renderShiftCell(d)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 'minmax(100px, auto)' }}>
            {DAY_NAMES.map(n => (
              <div key={n} style={{ padding: '8px', textAlign: 'center', fontSize: '11px', fontWeight: 700, color: 'var(--text-muted)', borderBottom: '1px solid var(--border-light)', background: 'var(--surface-alt)' }}>{n.toUpperCase()}</div>
            ))}
            {monthData.dates.map((d, i) => {
              const isToday = fmt(d) === todayStr;
              const isOtherMonth = d.getMonth() !== monthData.month;
              return (
                <div key={i} style={{
                  minHeight: '120px', borderRight: (i + 1) % 7 !== 0 ? '1px solid var(--border-light)' : 'none',
                  borderBottom: '1px solid var(--border-light)', padding: '8px',
                  background: isToday ? 'var(--accent-light)' : isOtherMonth ? 'var(--bg)' : 'transparent',
                  opacity: isOtherMonth ? 0.4 : 1,
                }}>
                  <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '6px', color: isToday ? 'var(--accent)' : 'var(--text-muted)' }}>{d.getDate()}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {renderShiftCell(d, true)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modals */}
      {showGenerate && <GenerateModal onClose={() => setShowGenerate(false)} onGenerate={handleGenerate} activeShiftTypes={activeShiftTypes} />}
      {showTimeOff && <TimeOffModal onClose={() => setShowTimeOff(false)} onSubmit={handleTimeOff} />}
      {showAddShift && <AddShiftModal onClose={() => setShowAddShift(false)} onAdd={handleAddShift} users={users} configs={activeShiftTypes} />}
      {selectedShift && (
        <ShiftDetailModal
          shift={selectedShift}
          isAdmin={isAdmin}
          users={users}
          configs={configs}
          onClose={() => setSelectedShift(null)}
          onDelete={handleDeleteShift}
          onEdit={handleEditShift}
          fmtTime={fmtTime}
        />
      )}
      {selectedTimeOff && (
        <TimeOffDetailModal
          request={selectedTimeOff}
          isAdmin={isAdmin}
          onClose={() => setSelectedTimeOff(null)}
          onDelete={handleDeleteTimeOff}
          onReview={handleReview}
        />
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}

// --- Sub-Modals ---

function GenerateModal({ onClose, onGenerate, activeShiftTypes }) {
  const [sd, setSd] = useState(fmt(new Date()));
  const [ed, setEd] = useState(fmt(new Date(Date.now() + 14 * 86400000)));
  const [types, setTypes] = useState(activeShiftTypes.map(c => c.shift_type));

  const toggle = t => setTypes(p => p.includes(t) ? p.filter(x => x !== t) : [...p, t]);

  return (
    <Overlay onClose={onClose} title="Auto-Generate Schedule">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input label="Start Date" type="date" value={sd} onChange={e => setSd(e.target.value)} />
          <Input label="End Date" type="date" value={ed} onChange={e => setEd(e.target.value)} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <label className="t-eyebrow">Shift Types to Include</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {activeShiftTypes.map(c => (
              <Button key={c.shift_type} size="sm" variant={types.includes(c.shift_type) ? 'primary' : 'secondary'} onClick={() => toggle(c.shift_type)}>
                {c.label}
              </Button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onGenerate(sd, ed, types)} disabled={!sd || !ed || types.length === 0}>Generate</Button>
        </div>
      </div>
    </Overlay>
  );
}

function TimeOffModal({ onClose, onSubmit }) {
  const [sd, setSd] = useState(fmt(new Date()));
  const [ed, setEd] = useState(fmt(new Date()));
  const [ot, setOt] = useState('vacation');
  const [cm, setCm] = useState('');

  return (
    <Overlay onClose={onClose} title="Request Time Off">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <Input label="Start Date" type="date" value={sd} onChange={e => setSd(e.target.value)} />
          <Input label="End Date" type="date" value={ed} onChange={e => setEd(e.target.value)} />
        </div>
        <Select label="Type" value={ot} onChange={e => setOt(e.target.value)}>
          <option value="vacation">Vacation</option>
          <option value="sick_leave">Sick Leave</option>
          <option value="day_off">Day Off / Other</option>
        </Select>
        <Input label="Comment (optional)" value={cm} onChange={e => setCm(e.target.value)} />
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(sd, ed, ot, cm)}>Submit Request</Button>
        </div>
      </div>
    </Overlay>
  );
}

function AddShiftModal({ onClose, onAdd, users, configs }) {
  const [f, setF] = useState({ date: fmt(new Date()), user_id: '', shift_type: configs[0]?.shift_type || 'day' });
  return (
    <Overlay onClose={onClose} title="Add Manual Shift">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <Input label="Date" type="date" value={f.date} onChange={e => setF({ ...f, date: e.target.value })} />
        <Select label="Engineer" value={f.user_id} onChange={e => setF({ ...f, user_id: e.target.value })}>
          <option value="">Select engineer…</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
        </Select>
        <Select label="Shift Type" value={f.shift_type} onChange={e => setF({ ...f, shift_type: e.target.value })}>
          {configs.map(c => <option key={c.shift_type} value={c.shift_type}>{c.label}</option>)}
        </Select>
        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onAdd({ ...f, user_id: Number(f.user_id), is_published: true })} disabled={!f.user_id}>Add Shift</Button>
        </div>
      </div>
    </Overlay>
  );
}

function ShiftDetailModal({ shift, isAdmin, users, configs, onClose, onDelete, onEdit, fmtTime }) {
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ user_id: shift.user_id, shift_type: shift.shift_type });
  const cfg = configs.find(c => c.shift_type === shift.shift_type);

  return (
    <Overlay onClose={onClose} title="Shift Details">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: (shift.user?.name_color || '#6b7280') + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 700, color: shift.user?.name_color || '#6b7280' }}>
            {shift.user?.display_name?.[0] || '?'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px' }}>{shift.user?.display_name || 'Unassigned'}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{new Date(`${shift.date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          </div>
        </div>

        <div style={{ padding: '14px', background: 'var(--surface-alt)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span className="t-eyebrow">Shift Type</span>
            <Badge color={cfg?.color || 'gray'}>{cfg?.label || shift.shift_type}</Badge>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="t-eyebrow">Time</span>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{fmtTime(shift.start_time, shift.date)} – {fmtTime(shift.end_time, shift.date)}</span>
          </div>
        </div>

        {edit && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '14px', border: '1px solid var(--accent)', borderRadius: 'var(--radius)' }}>
            <Select label="Reassign To" value={f.user_id} onChange={e => setF({ ...f, user_id: e.target.value })}>
              {users.map(u => <option key={u.id} value={u.id}>{u.display_name}</option>)}
            </Select>
            <Select label="Change Type" value={f.shift_type} onChange={e => setF({ ...f, shift_type: e.target.value })}>
              {configs.map(c => <option key={c.shift_type} value={c.shift_type}>{c.label}</option>)}
            </Select>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
              <Button size="sm" variant="ghost" onClick={() => setEdit(false)}>Cancel</Button>
              <Button size="sm" onClick={() => onEdit(shift.id, { ...f, user_id: Number(f.user_id) })}>Save Changes</Button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {isAdmin && !edit && <Button variant="secondary" icon="edit" onClick={() => setEdit(true)}>Edit</Button>}
          {isAdmin && <Button variant="danger" icon="trash" onClick={() => { if (confirm('Delete this shift?')) onDelete(shift.id); }}>Delete</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Overlay>
  );
}

function TimeOffDetailModal({ request, isAdmin, onClose, onDelete, onReview }) {
  const isMine = !isAdmin; // Simplified
  const status = request.status;

  return (
    <Overlay onClose={onClose} title="Time Off Details">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: (request.user?.name_color || '#6b7280') + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 700, color: request.user?.name_color || '#6b7280' }}>
            {request.user?.display_name?.[0] || '?'}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '16px' }}>{request.user?.display_name || 'Engineer'}</div>
            <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{request.off_type.replace('_', ' ')}</div>
          </div>
        </div>

        <div style={{ padding: '14px', background: 'var(--surface-alt)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span className="t-eyebrow">Period</span>
            <span style={{ fontSize: '13px', fontWeight: 600 }}>{request.start_date} to {request.end_date}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="t-eyebrow">Status</span>
            <Badge color={statusColor(status)}>{status}</Badge>
          </div>
          {request.comment && (
            <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-light)', fontSize: '13px', fontStyle: 'italic' }}>
              &ldquo;{request.comment}&rdquo;
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          {isAdmin && status === 'pending' && (
            <>
              <Button variant="primary" icon="check" onClick={() => onReview(request.id, 'approved')}>Approve</Button>
              <Button variant="danger" icon="x" onClick={() => onReview(request.id, 'rejected')}>Reject</Button>
            </>
          )}
          {isAdmin && status !== 'pending' && <Button variant="secondary" onClick={() => onReview(request.id, 'pending')}>Mark Pending</Button>}
          {(isAdmin || status === 'pending') && <Button variant="danger" icon="trash" onClick={() => { if (confirm('Delete this request?')) onDelete(request.id); }}>Delete</Button>}
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Overlay>
  );
}
