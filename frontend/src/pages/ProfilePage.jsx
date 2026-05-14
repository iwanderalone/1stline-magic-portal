import { useState, useEffect, useRef } from 'react';
import { api, getPublicConfig } from '../api';
import { Card, Button, Input, Badge, Toast, Select, Avatar } from '../components/UI';
import { useLang } from '../components/LangContext';
import { Icon } from '../components/Icons';

export default function ProfilePage({ user, onUserUpdate }) {
  const { t: tr } = useLang();

  // ── Identity ────────────────────────────────────────────────
  const [identity, setIdentity] = useState({ display_name: '', email: '', name_color: '' });

  // ── Avatar upload ───────────────────────────────────────────
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef(null);

  // ── Timezone ────────────────────────────────────────────────
  const [timezone, setTimezone] = useState('UTC');

  // ── Password change ─────────────────────────────────────────
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);

  // ── Telegram ────────────────────────────────────────────────
  const [telegramUsername, setTelegramUsername] = useState('');
  const [linkCode, setLinkCode] = useState('');
  const [botUsername, setBotUsername] = useState('');

  // ── 2FA ─────────────────────────────────────────────────────
  const [otpQr, setOtpQr] = useState('');
  const [otpSecret, setOtpSecret] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpDisableCode, setOtpDisableCode] = useState('');
  const [showOtpForm, setShowOtpForm] = useState(false);
  const [showDisableForm, setShowDisableForm] = useState(false);

  // ── Toast ───────────────────────────────────────────────────
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const showToast = (message, type = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  useEffect(() => {
    if (user) {
      setIdentity({ display_name: user.display_name || '', email: user.email || '', name_color: user.name_color || '#2563eb' });
      setTimezone(user.timezone || 'UTC');
      setTelegramUsername(user.telegram_username || '');
    }
    getPublicConfig().then(c => setBotUsername(c.telegram_bot_username || ''));
    return () => { if (toastTimer.current) clearTimeout(toastTimer.current); };
  }, [user]);

  // ── Handlers ────────────────────────────────────────────────
  const saveIdentity = async () => {
    try {
      const updated = await api('/auth/me', { method: 'PATCH', body: JSON.stringify({
        display_name: identity.display_name,
        email: identity.email || null,
        name_color: identity.name_color,
      })});
      onUserUpdate(updated);
      showToast('Saved');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const saveTimezone = async () => {
    try {
      const updated = await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ timezone }) });
      onUserUpdate(updated);
      showToast('Saved');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const handleAvatarSelect = e => {
    const file = e.target.files[0];
    if (!file) return;
    setAvatarFile(file);
    setAvatarPreview(URL.createObjectURL(file));
  };

  const uploadAvatar = async () => {
    if (!avatarFile) return;
    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append('file', avatarFile);
      const updated = await api('/users/me/avatar', { method: 'POST', body: formData });
      onUserUpdate(updated);
      setAvatarFile(null);
      setAvatarPreview(null);
      if (avatarInputRef.current) avatarInputRef.current.value = '';
      showToast('Avatar updated');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setUploadingAvatar(false); }
  };

  const cancelAvatarSelect = () => {
    setAvatarFile(null);
    if (avatarPreview) URL.revokeObjectURL(avatarPreview);
    setAvatarPreview(null);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  };

  const changePassword = async () => {
    if (pwForm.next !== pwForm.confirm) { showToast('Passwords do not match', 'error'); return; }
    setPwLoading(true);
    try {
      await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password: pwForm.current, new_password: pwForm.next }) });
      setPwForm({ current: '', next: '', confirm: '' });
      showToast('Password changed');
    } catch (e) { showToast(e.message, 'error'); }
    finally { setPwLoading(false); }
  };

  const saveTelegramUsername = async () => {
    try {
      const updated = await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ telegram_username: telegramUsername || null }) });
      onUserUpdate(updated);
      showToast('Saved');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const toggleNotify = async (field, value) => {
    try {
      const updated = await api('/auth/me', { method: 'PATCH', body: JSON.stringify({ [field]: value }) });
      onUserUpdate(updated);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const getCode = async () => {
    try {
      const r = await api('/users/me/telegram-link-code', { method: 'POST' });
      setLinkCode(r.code);
      try { await navigator.clipboard.writeText(`/link ${r.code}`); showToast('Link code copied to clipboard'); } catch {}
    } catch (e) { showToast(e.message, 'error'); }
  };

  const setupOtp = async () => {
    try {
      const res = await api('/auth/setup-otp', { method: 'POST' });
      setOtpQr(res.qr_svg_base64);
      setOtpSecret(res.secret);
      setShowOtpForm(true);
    } catch (e) { showToast(e.message, 'error'); }
  };

  const confirmOtp = async () => {
    try {
      await api('/auth/confirm-otp', { method: 'POST', body: JSON.stringify({ code: otpCode }) });
      onUserUpdate({ ...user, otp_enabled: true });
      setShowOtpForm(false); setOtpCode(''); showToast(tr('otpEnabled'));
    } catch (e) { showToast(e.message, 'error'); }
  };

  const disableOtp = async () => {
    try {
      await api('/auth/disable-otp', { method: 'POST', body: JSON.stringify({ code: otpDisableCode }) });
      onUserUpdate({ ...user, otp_enabled: false });
      setShowDisableForm(false); setOtpDisableCode(''); showToast(tr('otpDisabled'), 'info');
    } catch (e) { showToast(e.message, 'error'); }
  };

  const TIMEZONES = [
    { value: 'UTC',           label: 'UTC' },
    { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
    { value: 'Europe/Moscow', label: 'Moscow (MSK)' },
    { value: 'Asia/Dubai',    label: 'Abu Dhabi (GST)' },
  ];

  const pwValid = pwForm.current.length >= 1 && pwForm.next.length >= 8 && pwForm.next === pwForm.confirm;
  const currentAvatar = avatarPreview || user?.avatar_url || undefined;

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '22px', maxWidth: '800px' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 30, letterSpacing: '-0.02em', margin: 0 }}>
        {tr('myProfile')}
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>

        {/* ── Identity ─────────────────────────────────────── */}
        <Card header={<><Icon name="user" size={18} /><span>{tr('identity')}</span></>}>
          <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Live preview */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <Avatar
                name={identity.display_name || user?.display_name}
                color={identity.name_color}
                src={currentAvatar}
                size={52}
              />
              <div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{identity.display_name || user?.display_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>@{user?.username}</div>
              </div>
            </div>

            <Input label={tr('displayName')} value={identity.display_name} onChange={e => setIdentity(p => ({ ...p, display_name: e.target.value }))} />
            <Input label="Email" type="email" value={identity.email} onChange={e => setIdentity(p => ({ ...p, email: e.target.value }))} placeholder="your@email.com" />

            {/* Color picker — local state, saved with button */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <label className="t-eyebrow">{tr('nameColor')}</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="color"
                  value={identity.name_color}
                  onChange={e => setIdentity(p => ({ ...p, name_color: e.target.value }))}
                  style={{ width: '44px', height: '36px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'none', cursor: 'pointer' }}
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{identity.name_color}</span>
              </div>
            </div>

            <Button variant="primary" onClick={saveIdentity}>{tr('saveIdentity')}</Button>
          </div>
        </Card>

        {/* ── Timezone ─────────────────────────────────────── */}
        <Card header={<><Icon name="calendar" size={18} /><span>{tr('timezone')}</span></>}>
          <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{tr('timezoneDesc')}</p>
            <Select label={tr('yourTimezone')} value={timezone} onChange={e => setTimezone(e.target.value)}>
              {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
            </Select>
            <div style={{ fontSize: '13px' }}>
              <span className="t-eyebrow">{tr('currentLocalTime')}:</span>
              <div style={{ fontWeight: 700, fontSize: '18px', marginTop: 4 }}>
                {new Date().toLocaleTimeString('en-GB', { timeZone: timezone || 'UTC', hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
            <Button variant="primary" onClick={saveTimezone}>{tr('saveTimezone')}</Button>
          </div>
        </Card>
      </div>

      {/* ── Avatar upload ─────────────────────────────────── */}
      <Card header={<><Icon name="user" size={18} /><span>Profile Picture</span></>}>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 20, flexWrap: 'wrap' }}>
            <Avatar
              name={user?.display_name}
              color={user?.name_color}
              src={currentAvatar}
              size={80}
            />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  size="sm"
                  variant="secondary"
                  icon="plus"
                  onClick={() => avatarInputRef.current?.click()}
                >
                  {user?.avatar_url ? 'Replace picture' : 'Upload picture'}
                </Button>
                {avatarFile && (
                  <>
                    <Button size="sm" variant="primary" onClick={uploadAvatar} disabled={uploadingAvatar}>
                      {uploadingAvatar ? 'Uploading…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelAvatarSelect}>Cancel</Button>
                  </>
                )}
              </div>
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/png,image/gif"
                onChange={handleAvatarSelect}
                style={{ display: 'none' }}
              />
              <p style={{ margin: 0, fontSize: '11px', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                PNG or GIF only · Max 2 MB · Square crop recommended (e.g. 256×256 px) · Animated GIFs supported
              </p>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Change Password ───────────────────────────────── */}
      <Card header={<><Icon name="key" size={18} /><span>Change Password</span></>}>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input
            label="Current password"
            type="password"
            value={pwForm.current}
            onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))}
            autoComplete="current-password"
          />
          <Input
            label="New password (min 8 characters)"
            type="password"
            value={pwForm.next}
            onChange={e => setPwForm(p => ({ ...p, next: e.target.value }))}
            autoComplete="new-password"
          />
          <Input
            label="Confirm new password"
            type="password"
            value={pwForm.confirm}
            onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))}
            autoComplete="new-password"
          />
          {pwForm.confirm.length > 0 && pwForm.next !== pwForm.confirm && (
            <div style={{ fontSize: 12, color: 'var(--danger)' }}>Passwords do not match</div>
          )}
          <Button variant="primary" onClick={changePassword} disabled={!pwValid || pwLoading}>
            {pwLoading ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </Card>

      {/* ── Telegram ─────────────────────────────────────── */}
      <Card header={<><Icon name="message" size={18} /><span>{tr('telegramNotifications')}</span></>}>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Badge color={user?.telegram_chat_id ? 'green' : 'gray'}>
              {user?.telegram_chat_id ? tr('linked') : tr('notLinked')}
            </Badge>
            {user?.telegram_chat_id && (
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                ID: {user.telegram_chat_id}
              </span>
            )}
          </div>

          <Input
            label={tr('telegramUsername')}
            value={telegramUsername}
            onChange={e => setTelegramUsername(e.target.value)}
            placeholder="@username"
          />

          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!user?.telegram_notify_shifts}
                onChange={e => toggleNotify('telegram_notify_shifts', e.target.checked)}
              />
              {tr('shiftNotifications')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!user?.telegram_notify_reminders}
                onChange={e => toggleNotify('telegram_notify_reminders', e.target.checked)}
              />
              {tr('reminderNotifications')}
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <Button variant="secondary" onClick={saveTelegramUsername}>Save username</Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {!user?.telegram_chat_id && (
                <>
                  {linkCode && (
                    <div style={{ background: 'var(--surface-alt)', padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <code style={{ fontWeight: 700, color: 'var(--accent)' }}>/link {linkCode}</code>
                      {botUsername && (
                        <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer" style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                          Open @{botUsername}
                        </a>
                      )}
                    </div>
                  )}
                  <Button variant="primary" icon="send" onClick={getCode}>{tr('getLinkCode')}</Button>
                </>
              )}
              {user?.telegram_chat_id && (
                <Button variant="danger" icon="trash" onClick={() =>
                  api('/users/me/telegram-unlink', { method: 'POST' })
                    .then(updated => onUserUpdate(updated))
                    .catch(e => showToast(e.message, 'error'))
                }>
                  {tr('unlinkTelegram')}
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* ── 2FA ──────────────────────────────────────────── */}
      <Card header={<><Icon name="shield" size={18} /><span>{tr('twoFactor')}</span></>}>
        <div style={{ padding: '18px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <p style={{ margin: 0, fontSize: '13px', color: 'var(--text-muted)', lineHeight: 1.5 }}>{tr('twoFactorDesc')}</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Badge color={user?.otp_enabled ? 'green' : 'gray'}>
              {user?.otp_enabled ? tr('otpActive') : tr('otpInactive')}
            </Badge>
          </div>

          {!user?.otp_enabled && !showOtpForm && (
            <Button variant="secondary" icon="plus" onClick={setupOtp}>{tr('setupOtp')}</Button>
          )}
          {user?.otp_enabled && !showDisableForm && (
            <Button variant="danger" icon="trash" onClick={() => setShowDisableForm(true)}>{tr('otpDisable')}</Button>
          )}

          {showOtpForm && (
            <div style={{ background: 'var(--surface-alt)', padding: '18px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                {otpQr && (
                  <div style={{ background: '#fff', padding: '10px', borderRadius: '8px', flexShrink: 0 }}>
                    <img
                      src={`data:image/svg+xml;base64,${otpQr}`}
                      alt="OTP QR code"
                      style={{ width: 140, height: 140, display: 'block' }}
                    />
                  </div>
                )}
                <div style={{ flex: 1, minWidth: '200px' }}>
                  <div style={{ fontSize: '13px', marginBottom: '10px' }}>{tr('otpScanQr')}</div>
                  {otpSecret && (
                    <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                      {tr('otpManualKey')}:{' '}
                      <code style={{ color: 'var(--text)', fontWeight: 600, wordBreak: 'break-all' }}>{otpSecret}</code>
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <Input label={tr('otpEnterCode')} value={otpCode} onChange={e => setOtpCode(e.target.value)} placeholder="000000" />
                <Button variant="primary" onClick={confirmOtp} disabled={otpCode.length !== 6}>{tr('otpConfirm')}</Button>
                <Button variant="ghost" onClick={() => { setShowOtpForm(false); setOtpCode(''); }}>{tr('cancel')}</Button>
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
