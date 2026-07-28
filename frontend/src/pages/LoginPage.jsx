import { useState, useEffect } from 'react';
import { setTokens, getPublicConfig } from '../api';
import { Card, Button, Input } from '../components/UI';
import { useLang } from '../components/LangContext';
import { Icon } from '../components/Icons';

const SSO_ERROR_KEYS = {
  no_access_group: 'ssoErrorNoGroup',
  account_deactivated: 'ssoErrorDeactivated',
};

export default function LoginPage({ onLogin, ssoError }) {
  const { t: tr } = useLang();
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState(ssoError ? tr(SSO_ERROR_KEYS[ssoError] || 'ssoErrorGeneric') : '');
  const [loading, setLoading] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);

  useEffect(() => { getPublicConfig().then(c => setSsoEnabled(!!c.sso_enabled)); }, []);

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
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '20px' }}>
      <Card className="fade-in" style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', color: '#fff' }}><Icon name="zap" size={22} /></div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 28, letterSpacing: '-0.02em', color: 'var(--text)', marginBottom: 6 }}>Viory IT Portal</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '14px', marginTop: '6px' }}>{step === 'otp' ? tr('enterCode') : tr('signIn')}</p>
        </div>
        {error && <div style={{ background: 'var(--danger-light)', color: 'var(--danger)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: '13px', marginBottom: '16px' }}>{error}</div>}
        {step === 'credentials' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input label={tr('username')} value={username} onChange={e => setUsername(e.target.value)} autoFocus />
            <Input label={tr('password')} type="password" value={password} onChange={e => setPassword(e.target.value)} />
            <Button style={{ width: '100%', padding: '11px' }} disabled={loading}>{loading ? tr('signingIn') : tr('signIn')}</Button>
            {ssoEnabled && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: '2px 0', color: 'var(--text-muted)', fontSize: '12px' }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  {tr('orDivider')}
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
                <Button type="button" variant="secondary" style={{ width: '100%', padding: '11px' }}
                  onClick={() => { window.location.href = '/api/auth/sso/start'; }}>
                  {tr('signInSso')}
                </Button>
              </>
            )}
          </form>
        ) : (
          <form onSubmit={handleOTP} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input label={tr('sixDigitCode')} value={otpCode} onChange={e => setOtpCode(e.target.value)} autoFocus maxLength={6} placeholder="000000"
              style={{ textAlign: 'center', fontSize: '24px', fontFamily: 'var(--font-mono)', letterSpacing: '0.2em' }} />
            <Button style={{ width: '100%', padding: '11px' }} disabled={loading}>{loading ? tr('verifying') : tr('verify')}</Button>
            <button type="button" onClick={() => { setStep('credentials'); setError(''); }}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '13px' }}>{tr('back')}</button>
          </form>
        )}
      </Card>
    </div>
  );
}
