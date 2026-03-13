/**
 * API client with JWT auth, auto-refresh, and session management.
 */

// In dev, Vite proxy handles /api -> backend.
// In production, set this to your backend URL.
const BASE = '/api';

export function getTokens() {
  try {
    return JSON.parse(sessionStorage.getItem('tokens') || 'null');
  } catch {
    return null;
  }
}

export function setTokens(t) {
  sessionStorage.setItem('tokens', JSON.stringify(t));
}

export function clearTokens() {
  sessionStorage.removeItem('tokens');
}

export async function api(path, opts = {}) {
  const tokens = getTokens();
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (tokens?.access_token) {
    headers['Authorization'] = `Bearer ${tokens.access_token}`;
  }

  const res = await fetch(`${BASE}${path}`, { ...headers, ...opts, headers });

  if (res.status === 401) {
    clearTokens();
    window.location.reload();
    return null;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Request failed' }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}
