// ps/src/api.js — handles all communication with the backend
const BASE_URL = import.meta.env.VITE_API_URL;

function handleUnauthorized(message) {
  localStorage.removeItem('jwt');
  localStorage.removeItem('user');
  localStorage.removeItem('streamToken');
  // Redirect to login with a message
  const msg = encodeURIComponent(message || 'Your session has ended. Please sign in again.');
  window.location.href = `/auth?mode=login&notice=${msg}`;
}

// The backend names its session failures, so they are matched rather than
// guessed at. Anything here means the session itself is finished — expired,
// missing, malformed, or superseded by a sign-in somewhere else — and the fan
// has to sign in again.
const SESSION_ENDED = new Set([
  'SESSION_EXPIRED',      // signed in on another device
  'Not logged in',
  'Invalid login token',
]);

// Reads the expiry out of the JWT without verifying it — the server does the
// verifying. A backstop for the case where the backend returns 401 without one
// of the labels above.
function tokenHasExpired() {
  const jwt = localStorage.getItem('jwt');
  if (!jwt) return true;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return false;
    // A minute of slack, so a clock a few seconds out does not sign someone out.
    return Date.now() >= (payload.exp * 1000) - 60000;
  } catch {
    return true;   // unreadable token is no token
  }
}

async function parseResponse(response) {
  // A 401 used to sign the fan out of everything, instantly, from anywhere.
  // One misbehaving endpoint would end a session mid-purchase with nothing but
  // "your session has ended" to explain it. Now the session only ends when the
  // token is genuinely gone or expired; any other 401 surfaces as an ordinary
  // error the page can show and recover from.
  if (response.status === 401) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }

    // Signing out is right when the session is genuinely over — including when
    // it has been taken over on another device, where the token is still valid
    // but no longer the current one. Checking local expiry alone missed exactly
    // that case and left someone browsing a session the server had already
    // ended. Any other 401 is an authorisation failure on one endpoint and
    // surfaces as an ordinary error.
    if (SESSION_ENDED.has(data.error) || tokenHasExpired()) {
      handleUnauthorized(data.message || data.error);
      return; // never resolves — redirect happens
    }
    throw new Error(data.message || data.error || 'You are not allowed to do that.');
  }

  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text || 'Request failed' };
  }
  if (!response.ok) {
    // The sentence is what the fan reads, so it stays as the message. But the
    // code is what the caller branches on — and until now it was thrown away
    // whenever a friendly message existed, which is always for a token spend.
    // Fifteen places tested err.message === 'INSUFFICIENT_TOKENS' and none of
    // them could ever match, so the top-up never opened and a fan short of
    // tokens was simply told so and left there.
    const err = new Error(data.message || data.error || 'Request failed');
    err.code = data.error || null;
    // The whole body, so a caller can say how far short somebody is, or that
    // their gifted tokens do not count towards this particular thing.
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  async post(path, body = {}, token) {
    const headers = { 'Content-Type': 'application/json' };
    const saved = token || localStorage.getItem('jwt');
    if (saved) headers.Authorization = `Bearer ${saved}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    return parseResponse(response);
  },

  async get(path, token) {
    const headers = {};
    const saved = token || localStorage.getItem('jwt');
    if (saved) headers.Authorization = `Bearer ${saved}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers,
    });
    return parseResponse(response);
  },

  async patch(path, body = {}, token) {
    const headers = { 'Content-Type': 'application/json' };
    const saved = token || localStorage.getItem('jwt');
    if (saved) headers.Authorization = `Bearer ${saved}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
    });
    return parseResponse(response);
  },

  async delete(path, token) {
    const headers = {};
    const saved = token || localStorage.getItem('jwt');
    if (saved) headers.Authorization = `Bearer ${saved}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers,
    });
    return parseResponse(response);
  },
};

export function saveAuth(jwt, user) {
  localStorage.setItem('jwt', jwt);
  localStorage.setItem('user', JSON.stringify(user));
}

export function saveStreamToken(token) {
  localStorage.setItem('streamToken', token);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem('jwt');
  localStorage.removeItem('user');
  localStorage.removeItem('streamToken');
  window.location.href = '/auth?mode=login';
}