import { useState } from 'react';
import { apiBlob } from '../../api';
import { Button, Input, Toast, PageHeader } from '../../components/UI';
import { Icon } from '../../components/Icons';
import { useLang } from '../../components/LangContext';

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

  const canSubmit = employeeName.trim() && position.trim() && date && devices.every(d => d.description.trim());

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

      <form onSubmit={submit} style={{
        display: 'flex', flexDirection: 'column', gap: 14, padding: 18,
        border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--surface-alt)',
      }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input label={tr('handoverEmployee')} value={employeeName} onChange={e => setEmployeeName(e.target.value)} required maxLength={200} />
          <Input label={tr('handoverPosition')} value={position} onChange={e => setPosition(e.target.value)} required maxLength={200} />
          <Input label={tr('handoverPeriod')} value={period} onChange={e => setPeriod(e.target.value)} maxLength={200} placeholder={tr('handoverPeriodPlaceholder')} />
          <Input label={tr('handoverDate')} type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </div>
        <Input label={tr('handoverPurpose')} value={purpose} onChange={e => setPurpose(e.target.value)} maxLength={500} />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
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
        </div>

        <Input label={tr('handoverComments')} value={comments} onChange={e => setComments(e.target.value)} maxLength={1000} />

        <div>
          <Button type="submit" variant="primary" disabled={busy || !canSubmit} icon="fileText">
            {tr('handoverGenerate')}
          </Button>
        </div>
      </form>
    </div>
  );
}
