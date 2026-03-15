import { useState } from 'react';
import { setTokens } from '../api';
import { Card, Button, Input } from '../components/UI';
import { useTheme } from '../components/ThemeContext';
import { useLang } from '../components/LangContext';

export default function LoginPage({ onLogin }) {
  const { theme: t } = useTheme();
  const { t: tr } = useLang();
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const doFetch = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { throw new Error('Server returned invalid response. Is the backend running?'); }
    if (!res.ok) throw new Error(data.detail || 'Request failed');
    return data;
  };

  const handleLogin = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const data = await doFetch('/api/auth/login', { username, password });
      if (data.requires_otp) { setTempToken(data.temp_token); setStep('otp'); }
      else { setTokens(data); onLogin(data); }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const handleOTP = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      const data = await doFetch('/api/auth/verify-otp', { temp_token: tempToken, otp_code: otpCode });
      setTokens(data); onLogin(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: t.bg, padding: '20px' }}>
      <Card className="fade-in" style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: t.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '22px', color: '#fff' }}>⚡</div>
          <h1 style={{ fontSize: '22px', fontWeight: 700 }}>Support Portal</h1>
          <p style={{ color: t.textMuted, fontSize: '14px', marginTop: '6px' }}>{step === 'otp' ? tr('enterCode') : tr('signIn')}</p>
        </div>
        {error && <div style={{ background: t.dangerLight, color: t.danger, padding: '10px 14px', borderRadius: t.radiusSm, fontSize: '13px', marginBottom: '16px' }}>{error}</div>}
        {step === 'credentials' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input label={tr('username')} value={username} onChange={e => setUsername(e.target.value)} autoFocus />
            <Input label={tr('password')} type="password" value={password} onChange={e => setPassword(e.target.value)} />
            <Button style={{ width: '100%', padding: '11px' }} disabled={loading}>{loading ? tr('signingIn') : tr('signIn')}</Button>
          </form>
        ) : (
          <form onSubmit={handleOTP} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input label={tr('sixDigitCode')} value={otpCode} onChange={e => setOtpCode(e.target.value)} autoFocus maxLength={6} placeholder="000000"
              style={{ textAlign: 'center', fontSize: '20px', fontFamily: t.fontMono, letterSpacing: '6px' }} />
            <Button style={{ width: '100%', padding: '11px' }} disabled={loading}>{loading ? tr('verifying') : tr('verify')}</Button>
            <button type="button" onClick={() => { setStep('credentials'); setError(''); }}
              style={{ background: 'none', border: 'none', color: t.textMuted, cursor: 'pointer', fontSize: '13px' }}>{tr('back')}</button>
          </form>
        )}
      </Card>
    </div>
  );
}
