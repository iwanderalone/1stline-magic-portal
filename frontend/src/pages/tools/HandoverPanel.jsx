import { useState } from 'react';
import { api, apiBlob } from '../../api';
import { Button, Input, Toast, PageHeader } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useLang } from '../../components/LangContext';
import { ContactPicker, DevicePicker } from '../../components/NetboxPicker';

function todayLocal() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0, 10);
}

function emptyLine() {
  return { description: '', quantity: 1, serial_no: '', inventory_no: '', additional_info: '', accessories: '' };
}

export default function HandoverPanel() {
  const { t: tr } = useLang();
  // Two ways to produce a handover: from the inventory, which also records the
  // assignment in NetBox, or free-text, which still works with no NetBox at all.
  const [mode, setMode] = useState('netbox');   // netbox | manual
  const [employee, setEmployee] = useState(null);
  const [signedBy, setSignedBy] = useState(null);
  const [picked, setPicked] = useState([]);
  const [result, setResult] = useState(null);
  const [employeeName, setEmployeeName] = useState('');
  const [position, setPosition] = useState('');
  const [period, setPeriod] = useState('');
  const [purpose, setPurpose] = useState('');
  const [date, setDate] = useState(todayLocal());
  const [devices, setDevices] = useState([emptyLine()]);
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null);

  const setLine = (i, key) => (e) => {
    const v = key === 'quantity' ? Math.max(1, Number(e.target.value) || 1) : e.target.value;
    setDevices(ds => ds.map((d, idx) => (idx === i ? { ...d, [key]: v } : d)));
  };
  const addLine = () => setDevices(ds => (ds.length >= 50 ? ds : [...ds, emptyLine()]));
  const removeLine = (i) => setDevices(ds => (ds.length <= 1 ? ds : ds.filter((_, idx) => idx !== i)));

  const canSubmit = mode === 'netbox'
    ? !!(employee && signedBy && picked.length && position.trim() && date)
    : employeeName.trim() && position.trim() && date && devices.every(d => d.description.trim());

  const recordInNetbox = async (e) => {
    e.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await api('/tools/inventory/handover/record', {
        method: 'POST',
        body: JSON.stringify({
          employee_contact_id: employee.id,
          signed_by_contact_id: signedBy.id,
          device_ids: picked.map(d => d.id),
          position: position.trim(),
          date,
          assignment_period: period.trim() || null,
          purpose: purpose.trim() || null,
          comments: comments.trim() || null,
        }),
      });
      setResult(res);
      setToast({ message: tr('hoRecorded'), type: 'success' });
      setPicked([]);
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (busy || !canSubmit) return;
    setBusy(true);
    try {
      const payload = {
        employee_name: employeeName.trim(),
        position: position.trim(),
        assignment_period: period.trim() || null,
        purpose: purpose.trim() || null,
        date,
        devices: devices.map(d => ({
          description: d.description.trim(),
          quantity: d.quantity,
          serial_no: d.serial_no.trim() || null,
          inventory_no: d.inventory_no.trim() || null,
          additional_info: d.additional_info.trim() || null,
          accessories: d.accessories.trim() || null,
        })),
        comments: comments.trim() || null,
      };
      const blob = await apiBlob('/tools/inventory/handover', { method: 'POST', body: JSON.stringify(payload) });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `handover-${employeeName.trim().replace(/\s+/g, '_')}-${date}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setToast({ message: tr('handoverGenerated'), type: 'success' });
    } catch (err) {
      setToast({ message: err.message, type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    fontSize: 13, background: 'var(--surface-alt)', color: 'var(--text)', outline: 'none', width: '100%',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 860 }}>
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}

      <PageHeader title={tr('handoverTitle')} subtitle={tr('handoverSubtitle')} />

      <div style={{ display: 'flex', gap: 6 }}>
        {[['netbox', tr('hoModeNetbox')], ['manual', tr('hoModeManual')]].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => { setMode(id); setResult(null); }}
            style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
              borderRadius: 'var(--radius-sm)', fontFamily: 'inherit',
              border: `1px solid ${mode === id ? 'var(--accent)' : 'var(--border)'}`,
              background: mode === id ? 'var(--accent)' : 'transparent',
              color: mode === id ? 'var(--accent-on)' : 'var(--text-muted)',
            }}
          >{label}</button>
        ))}
      </div>

      {result && (
        <div style={{
          border: '1px solid var(--border)', borderLeft: '3px solid var(--success)',
          borderRadius: 'var(--radius-sm)', padding: '12px 14px', display: 'flex',
          flexDirection: 'column', gap: 6, background: 'var(--surface)',
        }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {tr('hoRecordedTitle').replace('{n}', result.assignments.length)}
          </div>
          {result.attachment_url && (
            <a href={result.attachment_url} target="_blank" rel="noreferrer"
               style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
              {tr('hoDownloadDoc')} ↗
            </a>
          )}
          {result.skipped?.length > 0 && (
            <div style={{ fontSize: 12, color: 'var(--danger)' }}>
              {tr('hoSkipped')}: {result.skipped.join('; ')}
            </div>
          )}
        </div>
      )}

      <form onSubmit={mode === 'netbox' ? recordInNetbox : submit} style={{
        display: 'flex', flexDirection: 'column', gap: 14, padding: 18,
        border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-alt)',
      }}>
        {mode === 'netbox' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <ContactPicker label={tr('hoEmployee')} value={employee} onChange={setEmployee} hint={tr('hoEmployeeHint')} />
            <ContactPicker label={tr('hoSignedBy')} value={signedBy} onChange={setSignedBy} hint={tr('hoSignedByHint')} />
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {mode === 'manual' && (
            <Input label={tr('handoverEmployee')} value={employeeName} onChange={e => setEmployeeName(e.target.value)} required maxLength={200} />
          )}
          <Input label={tr('handoverPosition')} value={position} onChange={e => setPosition(e.target.value)} required maxLength={200} />
          <Input label={tr('handoverPeriod')} value={period} onChange={e => setPeriod(e.target.value)} maxLength={200} placeholder={tr('handoverPeriodPlaceholder')} />
          <Input label={tr('handoverDate')} type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </div>
        <Input label={tr('handoverPurpose')} value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={500} />

        {mode === 'netbox' && <DevicePicker selected={picked} onChange={setPicked} />}

        {mode === 'manual' && <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label className="t-eyebrow">{tr('handoverDevices')}</label>
            <span style={{ flex: 1 }} />
            <Button type="button" variant="ghost" size="sm" icon="plus" onClick={addLine} disabled={devices.length >= 50}>
              {tr('handoverAddDevice')}
            </Button>
          </div>
          {devices.map((d, i) => (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column', gap: 8, padding: 10,
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2.4fr 0.7fr auto', gap: 8, alignItems: 'center' }}>
                <input style={inputStyle} placeholder={tr('handoverDescription')} value={d.description} onChange={setLine(i, 'description')} required />
                <input style={inputStyle} type="number" min={1} max={999} placeholder={tr('handoverQty')} value={d.quantity} onChange={setLine(i, 'quantity')} />
                <button
                  type="button" onClick={() => removeLine(i)} disabled={devices.length <= 1}
                  title={tr('handoverRemoveDevice')}
                  style={{
                    background: 'none', border: 'none', cursor: devices.length <= 1 ? 'default' : 'pointer',
                    opacity: devices.length <= 1 ? 0.3 : 1, color: 'var(--danger)', padding: 4,
                  }}
                >
                  <Icon name="x" size={16} />
                </button>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
                <input style={inputStyle} placeholder={tr('handoverSerial')} value={d.serial_no} onChange={setLine(i, 'serial_no')} />
                <input style={inputStyle} placeholder={tr('handoverInvNo')} value={d.inventory_no} onChange={setLine(i, 'inventory_no')} />
                <input style={inputStyle} placeholder={tr('handoverAdditionalInfo')} value={d.additional_info} onChange={setLine(i, 'additional_info')} />
                <input style={inputStyle} placeholder={tr('handoverAccessories')} value={d.accessories} onChange={setLine(i, 'accessories')} />
              </div>
            </div>
          ))}
        </div>}

        <Input label={tr('handoverComments')} value={comments} onChange={e => setComments(e.target.value)} maxLength={1000} />

        <div>
          <Button type="submit" variant="primary" disabled={busy || !canSubmit} icon="fileText">
            {mode === 'netbox' ? tr('hoGenerateRecord') : tr('handoverGenerate')}
          </Button>
        </div>
      </form>
    </div>
  );
}
