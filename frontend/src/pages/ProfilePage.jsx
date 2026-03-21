import { useState, useEffect } from 'react';
import { api, getPublicConfig } from '../api';
import { useTheme } from '../components/ThemeContext';
import { Card, Button, Input, Badge, Toast, Select } from '../components/UI';
import { useLang } from '../components/LangContext';

const TIMEZONES = [
  { value: 'Europe/Berlin',  label: 'Berlin (UTC+1/+2)' },
  { value: 'Europe/Moscow',  label: 'Moscow (UTC+3)' },
  { value: 'Asia/Dubai',     label: 'Abu Dhabi (UTC+4)' },
];

export default function ProfilePage({ user, onUserUpdate }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [profile, setProfile] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [toast, setToast] = useState(null);
  const [linkCode, setLinkCode] = useState(null);
  const [botUsername, setBotUsername] = useState('');

  useEffect(() => {
    api('/users/me/profile')
      .then(d => setProfile(d))
      .catch(() => setLoadError(true));
    getPublicConfig().then(c => setBotUsername(c.telegram_bot_username || ''));
  }, []);

  const save = async (data) => {
    try {
      const updated = await api('/users/me/profile', { method: 'PATCH', body: JSON.stringify(data) });
      setProfile(updated);
      if (onUserUpdate) onUserUpdate(updated);
      setToast({ message: 'Profile updated', type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const getLinkCode = async () => {
    if (!profile.telegram_username) {
      setToast({ message: 'Enter your Telegram username first', type: 'error' });
      return;
    }
    try {
      const r = await api('/users/me/telegram-link-code', { method: 'POST' });
      setLinkCode(r.code);
      try { await navigator.clipboard.writeText(`/link ${r.code}`); } catch {}
      setToast({ message: `Copied! Now open the bot and send: /link ${r.code}`, type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  // Auto-poll profile after link code is shown — detect when bot linking completes
  useEffect(() => {
    if (!linkCode || profile?.telegram_chat_id) return;
    const interval = setInterval(async () => {
      try {
        const updated = await api('/users/me/profile');
        if (updated?.telegram_chat_id) {
          setProfile(updated);
          setLinkCode(null);
          setToast({ message: 'Telegram linked successfully!', type: 'success' });
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [linkCode, profile?.telegram_chat_id]);

  const [otpSetup, setOtpSetup] = useState(null); // { qr_svg_base64, secret }
  const [otpCode, setOtpCode] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);

  const startOtpSetup = async () => {
    try {
      const r = await api('/auth/setup-otp', { method: 'POST' });
      setOtpSetup(r);
      setOtpCode('');
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
  };

  const confirmOtp = async () => {
    setOtpLoading(true);
    try {
      await api('/auth/confirm-otp', { method: 'POST', body: JSON.stringify({ otp_code: otpCode }) });
      setProfile(p => ({ ...p, otp_enabled: true }));
      setOtpSetup(null);
      setOtpCode('');
      setToast({ message: tr('otpEnabled'), type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
    finally { setOtpLoading(false); }
  };

  const [otpDisableCode, setOtpDisableCode] = useState('');
  const [showDisableForm, setShowDisableForm] = useState(false);

  const disableOtp = async () => {
    if (!otpDisableCode) return;
    setOtpLoading(true);
    try {
      await api('/auth/disable-otp', { method: 'POST', body: JSON.stringify({ otp_code: otpDisableCode }) });
      setProfile(p => ({ ...p, otp_enabled: false }));
      setShowDisableForm(false);
      setOtpDisableCode('');
      setToast({ message: tr('otpDisabled'), type: 'success' });
    } catch (e) { setToast({ message: e.message, type: 'error' }); }
    finally { setOtpLoading(false); }
  };

  if (loadError) return <div style={{ padding: '48px', textAlign: 'center', color: t.danger }}>{tr('failedToLoad')}</div>;
  if (!profile) return <div style={{ padding: '48px', textAlign: 'center', color: t.textMuted }}>{tr('loading')}</div>;

  // Show user's current local time as preview
  const localTimePreview = () => {
    try {
      return new Date().toLocaleTimeString('en-GB', { timeZone: profile.timezone, hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });
    } catch { return '—'; }
  };

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '20px', maxWidth: '600px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 700 }}>{tr('myProfile')}</h2>

      {/* Identity */}
      <Card style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>{tr('identity')}</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '20px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '16px',
            background: profile.avatar_url ? `url(${profile.avatar_url}) center/cover` : `${profile.name_color}20`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontWeight: 700, color: profile.name_color, fontSize: '24px',
            border: `2px solid ${profile.name_color}40`,
          }}>{!profile.avatar_url && (profile.display_name?.[0] ?? '?')}</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: '16px' }}>{profile.display_name}</div>
            <div style={{ fontSize: '13px', color: t.textMuted }}>@{profile.username} · {profile.role}</div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Input label={tr('displayName')} value={profile.display_name}
            onChange={e => setProfile(p => ({ ...p, display_name: e.target.value }))} />

          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontSize: '13px', fontWeight: 500, color: t.textSecondary }}>Name color</label>
              <input type="color" value={profile.name_color}
                onChange={e => setProfile(p => ({ ...p, name_color: e.target.value }))}
                style={{ width: '48px', height: '36px', border: `1px solid ${t.border}`, borderRadius: t.radiusSm, cursor: 'pointer' }} />
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {['#2563eb','#dc2626','#059669','#d97706','#7c3aed','#ec4899','#06b6d4','#84cc16'].map(c => (
                <button key={c} onClick={() => setProfile(p => ({ ...p, name_color: c }))}
                  style={{ width: '28px', height: '28px', borderRadius: '6px', background: c, border: profile.name_color === c ? '2px solid ' + t.text : '2px solid transparent', cursor: 'pointer' }} />
              ))}
            </div>
          </div>

          <Input label="Avatar URL (optional)" value={profile.avatar_url || ''}
            onChange={e => setProfile(p => ({ ...p, avatar_url: e.target.value || null }))}
            placeholder="https://..." />

          <Button onClick={() => save({ display_name: profile.display_name, name_color: profile.name_color, avatar_url: profile.avatar_url })}>
            {tr('saveIdentity')}
          </Button>
        </div>
      </Card>

      {/* Timezone */}
      <Card style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{tr('timezone')}</h3>
        <p style={{ fontSize: '13px', color: t.textMuted, marginBottom: '16px' }}>{tr('timezoneDesc')}</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Select label={tr('yourTimezone')} value={profile.timezone || 'Europe/Moscow'}
            onChange={e => setProfile(p => ({ ...p, timezone: e.target.value }))}>
            {TIMEZONES.map(tz => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
          </Select>

          <div style={{ fontSize: '13px', color: t.textSecondary, padding: '10px 14px', background: t.surfaceAlt, borderRadius: t.radiusSm }}>
            {tr('currentLocalTime')}: <strong>{localTimePreview()}</strong>
          </div>

          <Button onClick={() => save({ timezone: profile.timezone })}>{tr('saveTimezone')}</Button>
        </div>
      </Card>

      {/* Telegram */}
      <Card style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '16px' }}>{tr('telegramNotifications')}</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <Badge color={profile.telegram_chat_id ? 'green' : 'yellow'}>
              {profile.telegram_chat_id ? tr('linked') : tr('notLinked')}
            </Badge>
            {profile.telegram_username && <span style={{ fontSize: '13px', color: t.textSecondary }}>@{profile.telegram_username}</span>}
            {profile.telegram_chat_id && (
              <Button size="sm" variant="danger" onClick={async () => {
                try {
                  const updated = await api('/users/me/telegram-unlink', { method: 'POST' });
                  setProfile(updated);
                  if (onUserUpdate) onUserUpdate(updated);
                  setToast({ message: tr('telegramUnlinked'), type: 'success' });
                } catch (e) { setToast({ message: e.message, type: 'error' }); }
              }}>
                {tr('unlinkTelegram')}
              </Button>
            )}
          </div>

          <Input label="Telegram username" value={profile.telegram_username || ''}
            onChange={e => setProfile(p => ({ ...p, telegram_username: e.target.value }))} placeholder="@username" />

          <div style={{ display: 'flex', gap: '16px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={profile.telegram_notify_shifts}
                onChange={e => setProfile(p => ({ ...p, telegram_notify_shifts: e.target.checked }))} />
              Shift notifications
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', cursor: 'pointer' }}>
              <input type="checkbox" checked={profile.telegram_notify_reminders}
                onChange={e => setProfile(p => ({ ...p, telegram_notify_reminders: e.target.checked }))} />
              Reminder notifications
            </label>
          </div>

          <Button
            disabled={!profile.telegram_username}
            title={!profile.telegram_username ? 'Enter your Telegram username first' : ''}
            onClick={() => save({
              telegram_username: profile.telegram_username,
              telegram_notify_shifts: profile.telegram_notify_shifts,
              telegram_notify_reminders: profile.telegram_notify_reminders,
            })}>{tr('saveTelegramSettings')}</Button>

          {!profile.telegram_chat_id && (
            <div style={{ padding: '14px', background: t.surfaceAlt, borderRadius: t.radiusSm, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ fontSize: '13px', fontWeight: 600 }}>Link your Telegram account</div>
              <div style={{ fontSize: '13px', color: t.textSecondary }}>
                1. Click <strong>Get link code</strong> — the command is copied to your clipboard.<br />
                2. Open the bot and paste the command.
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                <Button variant="secondary" onClick={getLinkCode}>
                  {linkCode ? `📋 /link ${linkCode} — copied!` : tr('getLinkCode')}
                </Button>
                {botUsername && (
                  <a href={`https://t.me/${botUsername}`} target="_blank" rel="noreferrer"
                    style={{ fontSize: '13px', color: t.accent, textDecoration: 'none' }}>
                    Open @{botUsername} →
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* OTP / 2FA */}
      <Card style={{ padding: '24px' }}>
        <h3 style={{ fontSize: '15px', fontWeight: 600, marginBottom: '4px' }}>{tr('twoFactor')}</h3>
        <p style={{ fontSize: '13px', color: t.textMuted, marginBottom: '16px' }}>{tr('twoFactorDesc')}</p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
          <Badge color={profile.otp_enabled ? 'green' : 'gray'}>
            {profile.otp_enabled ? tr('otpActive') : tr('otpInactive')}
          </Badge>
        </div>

        {!profile.otp_enabled && !otpSetup && (
          <Button onClick={startOtpSetup}>{tr('setupOtp')}</Button>
        )}

        {otpSetup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <p style={{ fontSize: '13px', color: t.textSecondary }}>{tr('otpScanQr')}</p>
            <img src={`data:image/svg+xml;base64,${otpSetup.qr_svg_base64}`} alt="QR Code"
              style={{ width: '180px', height: '180px', borderRadius: t.radiusSm, border: `1px solid ${t.border}` }} />
            <div style={{ fontSize: '12px', color: t.textMuted, padding: '8px 12px', background: t.surfaceAlt, borderRadius: t.radiusSm, fontFamily: t.fontMono }}>
              {tr('otpManualKey')}: {otpSetup.secret}
            </div>
            <Input label={tr('otpEnterCode')} value={otpCode} onChange={e => setOtpCode(e.target.value)}
              maxLength={6} placeholder="000000" style={{ textAlign: 'center', fontSize: '20px', fontFamily: t.fontMono, letterSpacing: '6px' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button onClick={confirmOtp} disabled={otpLoading || otpCode.length !== 6}>{tr('otpConfirm')}</Button>
              <Button variant="secondary" onClick={() => { setOtpSetup(null); setOtpCode(''); }}>{tr('cancel')}</Button>
            </div>
          </div>
        )}

        {profile.otp_enabled && !showDisableForm && (
          <Button variant="secondary" onClick={() => setShowDisableForm(true)}>{tr('otpDisable')}</Button>
        )}

        {profile.otp_enabled && showDisableForm && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ fontSize: '13px', color: t.textSecondary }}>{tr('otpDisableDesc')}</p>
            <Input label={tr('otpEnterCode')} value={otpDisableCode} onChange={e => setOtpDisableCode(e.target.value)}
              maxLength={6} placeholder="000000" style={{ textAlign: 'center', fontSize: '20px', fontFamily: t.fontMono, letterSpacing: '6px' }} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <Button variant="danger" onClick={disableOtp} disabled={otpLoading || otpDisableCode.length !== 6}>{tr('otpDisable')}</Button>
              <Button variant="secondary" onClick={() => { setShowDisableForm(false); setOtpDisableCode(''); }}>{tr('cancel')}</Button>
            </div>
          </div>
        )}
      </Card>

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
