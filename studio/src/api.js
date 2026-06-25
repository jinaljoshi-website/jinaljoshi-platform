// studio/src/api.js
const BASE_URL = import.meta.env.VITE_API_URL;

async function parseResponse(res) {
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
}