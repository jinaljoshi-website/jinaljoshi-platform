// studio/src/api.js
const BASE_URL = import.meta.env.VITE_API_URL;

function handleUnauthorized() {
  sessionStorage.removeItem('jwt');
  sessionStorage.removeItem('user');
  window.location.href = '/login';
}

async function parseResponse(res) {
  if (res.status === 401) {
    handleUnauthorized();
    return; // never resolves — redirect happens
  }
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!res.ok) throw new Error(data.message || data.error || 'Request failed');
  return data;
}

export const api = {
  async get(path) {
    const jwt = sessionStorage.getItem('jwt');
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: jwt ? { Authorization: `Bearer ${jwt}` } : {},
    });
    return parseResponse(res);
  },
  async post(path, body = {}) {
    const jwt = sessionStorage.getItem('jwt');
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
    const jwt = sessionStorage.getItem('jwt');
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
    const jwt = sessionStorage.getItem('jwt');
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
  sessionStorage.setItem('jwt', jwt);
  sessionStorage.setItem('user', JSON.stringify(user));
}

export function getUser() {
  try { return JSON.parse(sessionStorage.getItem('user') || 'null'); } catch { return null; }
}

export function logout() {
  sessionStorage.removeItem('jwt');
  sessionStorage.removeItem('user');
  window.location.href = '/login';
}