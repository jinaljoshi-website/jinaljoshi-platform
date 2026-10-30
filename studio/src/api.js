// studio/src/api.js
const BASE_URL = import.meta.env.VITE_API_URL;

function handleUnauthorized() {
  localStorage.removeItem('jwt');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

// The backend names its session failures, so they are matched rather than
// guessed at. Anything here means the session itself is finished.
const SESSION_ENDED = new Set([
  'SESSION_EXPIRED',      // signed in on another device
  'Not logged in',
  'Invalid login token',
]);

// Reads the expiry out of the JWT without verifying it — the server does the
// verifying. A backstop for a 401 that carries none of the labels above.
function tokenHasExpired() {
  const jwt = localStorage.getItem('jwt');
  if (!jwt) return true;
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return false;
    return Date.now() >= (payload.exp * 1000) - 60000;   // a minute of slack
  } catch {
    return true;   // unreadable token is no token
  }
}

async function parseResponse(res) {
  // Any 401 at all used to end the session and bounce to the login screen.
  //
  // Studio polls constantly — the calls list every five seconds, RingWatch
  // every four, the dashboard every five minutes — so a single unlucky
  // response from a background poll signed her out in the middle of whatever
  // she was doing. The fan app was rewritten to stop exactly this; Studio kept
  // the old behaviour.
  //
  // Now the session only ends when it is genuinely over: a named session
  // failure, or a token that has actually expired. Every other 401 is an
  // authorisation failure on one endpoint and surfaces as an ordinary error.
  if (res.status === 401) {
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }

    if (SESSION_ENDED.has(data.error) || tokenHasExpired()) {
      handleUnauthorized();
      return; // never resolves — redirect happens
    }
    const err = new Error(data.message || data.error || 'You are not allowed to do that.');
    err.code = data.error;
    err.body = data;
    throw err;
  }

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) {
    // The sentence is what she reads; the code is what the caller branches on.
    // It was being discarded whenever a friendly message existed, so nothing in
    // Studio could ever test for a specific failure.
    const err = new Error(data.message || data.error || 'Request failed');
    err.code = data.error;
    err.body = data;
    throw err;
  }
  return data;
}

export const api = {
  async get(path) {
    const jwt = localStorage.getItem('jwt');
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    });
    return parseResponse(res);
  },
  async post(path, body = {}) {
    const jwt = localStorage.getItem('jwt');
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },
  async patch(path, body = {}) {
    const jwt = localStorage.getItem('jwt');
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      body: JSON.stringify(body),
    });
    return parseResponse(res);
  },
  async delete(path, body) {
    const jwt = localStorage.getItem('jwt');
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return parseResponse(res);
  },
};

export function saveAuth(jwt, user) {
  localStorage.setItem('jwt', jwt);
  localStorage.setItem('user', JSON.stringify(user));
}

export function getUser() {
  try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
}

export function logout() {
  localStorage.removeItem('jwt');
  localStorage.removeItem('user');
  window.location.href = '/login';
}