const BASE = '/api';

let _publicConfig = null;
export async function getPublicConfig() {
  if (_publicConfig) return _publicConfig;
  try { _publicConfig = await fetch('/api/config').then(r => r.json()); }
  catch { _publicConfig = {}; }
  return _publicConfig;
}

export function getTokens() {
  try { return JSON.parse(sessionStorage.getItem('tokens') || 'null'); }
  catch { return null; }
}
export function setTokens(t) { sessionStorage.setItem('tokens', JSON.stringify(t)); }
export function clearTokens() { sessionStorage.removeItem('tokens'); }

export async function api(path, opts = {}) {
  const tokens = getTokens();
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (tokens?.access_token) headers['Authorization'] = `Bearer ${tokens.access_token}`;

  let res;
  try { res = await fetch(`${BASE}${path}`, { ...opts, headers }); }
  catch { throw new Error('Cannot reach server. Is the backend running?'); }

  if (res.status === 401) { clearTokens(); window.location.reload(); return null; }

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
