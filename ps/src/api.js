// ps/src/api.js — handles all communication with the backend
const BASE_URL = import.meta.env.VITE_API_URL;

function handleUnauthorized(message) {
  sessionStorage.removeItem('jwt');
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('streamToken');
  // Redirect to login with a message
  const msg = encodeURIComponent(message || 'Your session has ended. Please sign in again.');
  window.location.href = `/auth?mode=login&notice=${msg}`;
}

async function parseResponse(response) {
  // Handle session errors globally — redirect to login
  if (response.status === 401) {
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
    handleUnauthorized(data.message || data.error);
    return; // never resolves — redirect happens
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
    const saved = token || sessionStorage.getItem('jwt');
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
    const saved = token || sessionStorage.getItem('jwt');
    if (saved) headers.Authorization = `Bearer ${saved}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'GET',
      headers,
    });
    return parseResponse(response);
  },

  async patch(path, body = {}, token) {
    const headers = { 'Content-Type': 'application/json' };
    const saved = token || sessionStorage.getItem('jwt');
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
    const saved = token || sessionStorage.getItem('jwt');
    if (saved) headers.Authorization = `Bearer ${saved}`;
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers,
    });
    return parseResponse(response);
  },
};

export function saveAuth(jwt, user) {
  sessionStorage.setItem('jwt', jwt);
  sessionStorage.setItem('user', JSON.stringify(user));
}

export function saveStreamToken(token) {
  sessionStorage.setItem('streamToken', token);
}

export function getUser() {
  try {
    return JSON.parse(sessionStorage.getItem('user') || 'null');
  } catch {
    return null;
  }
}

export function logout() {
  sessionStorage.removeItem('jwt');
  sessionStorage.removeItem('user');
  sessionStorage.removeItem('streamToken');
  window.location.href = '/auth?mode=login';
}