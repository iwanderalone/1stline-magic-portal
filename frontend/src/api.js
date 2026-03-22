const BASE = '/api';

let _publicConfig = null;
export async function getPublicConfig() {
  if (_publicConfig) return _publicConfig;
  try { _publicConfig = await fetch('/api/config').then(r => r.json()); }
  catch { _publicConfig = {}; }
  return _publicConfig;
}

export function getTokens() {
  try { return JSON.parse(localStorage.getItem('tokens') || 'null'); }
  catch { return null; }
}
export function setTokens(t) { localStorage.setItem('tokens', JSON.stringify(t)); }
export function clearTokens() { localStorage.removeItem('tokens'); }

async function tryRefresh() {
  const tokens = getTokens();
  if (!tokens?.refresh_token) return false;
  try {
    const res = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data);
    return true;
  } catch {
    return false;
  }
}

export async function api(path, opts = {}, _retry = true) {
  const tokens = getTokens();
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (tokens?.access_token) headers['Authorization'] = `Bearer ${tokens.access_token}`;

  let res;
  try { res = await fetch(`${BASE}${path}`, { ...opts, headers }); }
  catch { throw new Error('Cannot reach server. Is the backend running?'); }

  if (res.status === 401) {
    if (_retry && await tryRefresh()) return api(path, opts, false);
    clearTokens(); window.location.reload(); return null;
  }

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; }
  catch { throw new Error(`Server returned invalid JSON (${res.status})`); }

  if (!res.ok) {
    const detail = data?.detail;
    let msg;
    if (Array.isArray(detail)) {
      msg = detail.map(e => e.msg || String(e)).join('; ');
    } else if (typeof detail === 'string') {
      msg = detail;
    } else {
      msg = `HTTP ${res.status}`;
    }
    throw new Error(msg);
  }
  return data;
}
