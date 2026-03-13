import { useState } from 'react';
import { setTokens } from '../api';
import { Card, Button, Input } from '../components/UI';
import { theme } from '../theme';

const API_BASE = '/api';

export default function LoginPage({ onLogin }) {
  const [step, setStep] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      if (data.requires_otp) {
        setTempToken(data.temp_token);
        setStep('otp');
      } else {
        setTokens(data);
        onLogin(data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleOTP = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ temp_token: tempToken, otp_code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail);
      setTokens(data);
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: `linear-gradient(135deg, ${theme.bg} 0%, #e8ecf4 100%)`,
      padding: '20px',
    }}>
      <Card className="fade-in" style={{ width: '100%', maxWidth: '400px', padding: '40px 32px' }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '12px', background: theme.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px', fontSize: '22px',
          }}>⚡</div>
          <h1 style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.02em' }}>Support Portal</h1>
          <p style={{ color: theme.textMuted, fontSize: '14px', marginTop: '6px' }}>
            {step === 'otp' ? 'Enter your authenticator code' : 'Sign in to your account'}
          </p>
        </div>

        {error && (
          <div style={{
            background: theme.dangerLight, color: theme.danger, padding: '10px 14px',
            borderRadius: theme.radiusSm, fontSize: '13px', marginBottom: '16px',
          }}>{error}</div>
        )}

        {step === 'credentials' ? (
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input label="Username" value={username} onChange={e => setUsername(e.target.value)} autoFocus placeholder="admin" />
            <Input label="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" />
            <Button style={{ width: '100%', marginTop: '4px', padding: '11px' }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleOTP} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <Input
              label="6-digit code" value={otpCode} onChange={e => setOtpCode(e.target.value)}
              autoFocus maxLength={6} placeholder="000000"
              style={{ textAlign: 'center', fontSize: '20px', fontFamily: theme.fontMono, letterSpacing: '6px' }}
            />
            <Button style={{ width: '100%', marginTop: '4px', padding: '11px' }} disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </Button>
            <button type="button" onClick={() => { setStep('credentials'); setError(''); }}
              style={{ background: 'none', border: 'none', color: theme.textMuted, cursor: 'pointer', fontSize: '13px' }}>
              ← Back to login
            </button>
          </form>
        )}

        <div style={{
          marginTop: '24px', padding: '12px', background: theme.surfaceAlt, borderRadius: theme.radiusSm,
        }}>
          <div style={{ fontSize: '11px', color: theme.textMuted, fontFamily: theme.fontMono }}>
            Demo: admin / admin123 · alice / engineer123
          </div>
        </div>
      </Card>
    </div>
  );
}
