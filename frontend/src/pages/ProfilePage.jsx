import { useState, useEffect } from 'react';
import { api, getPublicConfig } from '../api';
import { Card, Button, Input, Badge, Toast, Select } from '../components/UI';
import { useLang } from '../components/LangContext';
import { Icon } from '../components/Icons';

export default function ProfilePage({ user, onUpdate }) {
  const { t: tr } = useLang();
  const [f, setF] = useState({ display_name: '', name_color: '', avatar_url: '', timezone: '', telegram_username: '' });
  const [otpQr, setOtpQr] = useState('');
  const [otpManual, setOtpManual] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpDisableCode, setOtpDisableCode] = useState('');
  const [showOtpForm, setShowOtpForm] = useState(false);
  const [showDisableForm, setShowDisableForm] = useState(false);
  const [toast, setToast] = useState(null);
  const [linkCode, setLinkCode] = useState('');
  const [botUsername, setBotUsername] = useState('');

  useEffect(() => {
    if (user) setF({ ...user, telegram_username: user.telegram_username || '' });
    getPublicConfig().then(c => setBotUsername(c.telegram_bot_username || ''));
  }, [user]);

  const showToast = (message, type = 'success') => { setToast({ message, type }); setTimeout(() => setToast(null), 3000); };

  const save = async (data) => {
    try {
      const payload = { ...data };
      if (payload.telegram_username === '') payload.telegram_username = null;
      const updated = await api('/auth/me', { method: 'PATCH', body: JSON.stringify(payload) });
      onUpdate(updated);
      showToast(tr('saveIdentity'));
    } catch (e) { showToast(e.message, 'error'); }
  };

  const setupOtp = async () => {
    try {
      const res = await api('/auth/setup-otp', { method: 'POST' });
      setOtpQr(res.qr_code); setOtpManual(res.manual_key); setShowOtpForm(true);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const confirmOtp = async () => {
    try {
      await api('/auth/confirm-otp', { method: 'POST', body: JSON.stringify({ code: otpCode }) });
      onUpdate({ ...user, otp_enabled: true });
      setShowOtpForm(false); setOtpCode(''); showToast(tr('otpEnabled'));
    } catch (e) { showToast(e.message, 'error'); }
  };

  const disableOtp = async () => {
    try {
      await api('/auth/disable-otp', { method: 'POST', body: JSON.stringify({ code: otpDisableCode }) });
      onUpdate({ ...user, otp_enabled: false });
      setShowDisableForm(false); setOtpDisableCode(''); showToast(tr('otpDisabled'), 'info');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const getCode = async () => {
    try {
      const r = await api('/auth/telegram-link-code', { method: 'POST' });
      setLinkCode(r.code);
      try { await navigator.clipboard.writeText(`/link ${r.code}`); showToast('Code copied to clipboard'); } catch {}
    } catch (e) { showToast(e.message, 'error'); }
  };

  const TIMEZONES = [
    { value: 'UTC', label: 'UTC' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
    { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
    { value: 'Asia/Dubai', label: 'Abu Dhabi (GST)' },
    { value: 'Asia/Almaty', label: 'Almaty' },
    { value: 'Asia/Singapore', label: 'Singapore' },
    { value: 'America/New_York', label: 'New York (EST/EDT)' },
  ];

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '800px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.02em', margin: 0 }}>{tr('myProfile')}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
        {/* Identity */}
        <Card header={<><Icon name="user" size={18} /><span>{tr('identity')}</span></>}>
          <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Input label={tr('displayName')} value={f.display_name} onChange={e => setF({ ...f, display_name: e.target.value })} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="t-eyebrow">{tr('nameColor')}</label>
              <input type="color" value={f.name_color} onChange={e => setF({ ...f, name_color: e.target.value })} style={{ width: '100%', height: '36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }} />
            </div>
            <Input label={tr('avatarUrl')} value={f.avatar_url} onChange={e => setF({ ...f, avatar_url: e.target.value })} placeholder="https://..." />
            <Button variant="primary" onClick={() => save({ display_name: f.display_name, name_color: f.name_color, avatar_url: f.avatar_url })}>{tr('saveIdentity')}</Button>
          </div>
        </Card>

        {/* Timezone */}
        <Card header={<><Icon name="calendar" size={18} /><span>{tr('timezone')}</span></>}>
          <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{tr('timezoneDesc')}</p>
            <Select label={tr('yourTimezone')} value={f.timezone} onChange={e => setF({ ...f, timezone: e.target.value })}>
              {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </Select>
            <div style={{ fontSize: '13px' }}>
              <span className="t-eyebrow">{tr('currentLocalTime')}:</span>
              <div style={{ fontWeight: 700, fontSize: '18px', marginTop: 4 }}>{new Date().toLocaleTimeString('en-GB', { timeZone: f.timezone || 'UTC', hour: '2-digit', minute: '2-digit' })}</div>
            </div>
            <Button variant="primary" onClick={() => save({ timezone: f.timezone })}>{tr('saveTimezone')}</Button>
          </div>
        </Card>
      </div>

      {/* Telegram */}
      <Card header={<><Icon name="message" size={18} /><span>{tr('telegramNotifications')}</span></>}>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Badge color={user?.telegram_chat_id ? 'green' : 'gray'}>{user?.telegram_chat_id ? tr('linked') : tr('notLinked')}</Badge>
            {user?.telegram_chat_id && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>ID: {user.telegram_chat_id}</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <Input label={tr('telegramUsername')} value={f.telegram_username} onChange={e => setF({ ...f, telegram_username: e.target.value })} placeholder="@username" />
          </div>

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={user?.notify_shifts} onChange={e => save({ notify_shifts: e.target.checked })} />
              {tr('shiftNotifications')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={user?.notify_reminders} onChange={e => save({ notify_reminders: e.target.checked })} />
              {tr('reminderNotifications')}
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', flexWrap: 'wrap', gap: 12 }}>
            <Button variant="secondary" onClick={() => save({ telegram_username: f.telegram_username })}>{tr('saveTelegramSettings')}</Button>
            {!user?.telegram_chat_id && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {linkCode && (
                  <div style={{ background: 'var(--surface-alt)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <code style={{ fontWeight: 700, color: 'var(--accent)' }}>/link {linkCode}</code>
                    {botUsername && <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Open @{botUsername}</a>}
                  </div>
                )}
                <Button variant="primary" icon="send" onClick={getCode}>{tr('getLinkCode')}</Button>
              </div>
            )}
            {user?.telegram_chat_id && <Button variant="danger" icon="trash" onClick={() => api('/auth/telegram-unlink', { method: 'POST' }).then(() => onUpdate({ ...user, telegram_chat_id: null }))}>{tr('unlinkTelegram')}</Button>}
          </div>
        </div>
      </Card>

      {/* 2FA */}
      <Card header={<><Icon name="key" size={18} /><span>{tr('twoFactor')}</span></>}>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{tr('twoFactorDesc')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Badge color={user?.otp_enabled ? 'green' : 'gray'}>{user?.otp_enabled ? tr('otpActive') : tr('otpInactive')}</Badge>
          </div>

          {!user?.otp_enabled && !showOtpForm && <Button variant="secondary" icon="plus" onClick={setupOtp}>{tr('setupOtp')}</Button>}
          {user?.otp_enabled && !showDisableForm && <Button variant="danger" icon="trash" onClick={() => setShowDisableForm(true)}>{tr('otpDisable')}</Button>}

          {showOtpForm && (
            <div style={{ background: 'var(--surface-alt)', padding: '18px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', display: 'flex' }} dangerouslySetInnerHTML={{ __html: otpQr }} />
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '13px', marginBottom: '10px' }}>{tr('otpScanQr')}</div>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{tr('otpManualKey')}: <code style={{ color: 'var(--text)', fontWeight: 600 }}>{otpManual}</code></div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <Input label={tr('otpEnterCode')} value={otpCode} onChange={e => setOtpCode(e.target.value)} placeholder="000000" />
                <Button variant="primary" onClick={confirmOtp} disabled={otpCode.length !== 6}>{tr('otpConfirm')}</Button>
                <Button variant="ghost" onClick={() => setShowOtpForm(false)}>{tr('cancel')}</Button>
              </div>
            </div>
          )}

          {showDisableForm && (
            <div style={{ background: 'var(--surface-alt)', padding: '18px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '13px' }}>{tr('otpDisableDesc')}</div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <Input label={tr('otpEnterCode')} value={otpDisableCode} onChange={e => setOtpDisableCode(e.target.value)} placeholder="000000" />
                <Button variant="danger" onClick={disableOtp} disabled={otpDisableCode.length !== 6}>{tr('otpDisable')}</Button>
                <Button variant="ghost" onClick={() => { setShowDisableForm(false); setOtpDisableCode(''); }}>{tr('cancel')}</Button>
              </div>
            </div>
          )}
        </div>
      </Card>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
