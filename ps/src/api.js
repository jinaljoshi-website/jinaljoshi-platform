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

// Reads the expiry out of the JWT without verifying it — the server does the
// verifying. This is only used to answer one question: is the token actually
// expired, or did a single endpoint return 401 for some other reason?
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

    if (tokenHasExpired()) {
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
    throw new Error(data.message || data.error || 'Request failed');
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