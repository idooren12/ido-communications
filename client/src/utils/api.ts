const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

function getHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse(res: Response) {
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

// Auth
export async function apiRegister(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return handleResponse(res);
}

export async function apiLogin(username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return handleResponse(res);
}

export async function apiGetMe() {
  const res = await fetch(`${API_BASE}/auth/me`, { headers: getHeaders() });
  return handleResponse(res);
}

export async function apiUpdatePreferences(preferredLanguage: string) {
  const res = await fetch(`${API_BASE}/auth/preferences`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ preferredLanguage })
  });
  return handleResponse(res);
}

export async function apiChangePassword(currentPassword: string, newPassword: string) {
  const res = await fetch(`${API_BASE}/auth/password`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify({ currentPassword, newPassword })
  });
  return handleResponse(res);
}

// Antennas
export async function apiGetAntennas() {
  const res = await fetch(`${API_BASE}/antennas`, { headers: getHeaders() });
  return handleResponse(res);
}

export async function apiCreateAntenna(name: string, powerWatts: number, gainDbi: number, frequencyMhz?: number, notes?: string) {
  const res = await fetch(`${API_BASE}/antennas`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ name, powerWatts, gainDbi, frequencyMhz, notes })
  });
  return handleResponse(res);
}

export async function apiUpdateAntenna(id: string, data: { name?: string; powerWatts?: number; gainDbi?: number; frequencyMhz?: number | null; notes?: string | null }) {
  const res = await fetch(`${API_BASE}/antennas/${id}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(data)
  });
  return handleResponse(res);
}

export async function apiDeleteAntenna(id: string) {
  const res = await fetch(`${API_BASE}/antennas/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  return handleResponse(res);
}

// History
export interface CalculationRecord {
  id: string;
  mode: string;
  txPowerWatts: number;
  txGainDbi: number;
  rxGainDbi: number;
  frequencyMhz: number;
  sensitivity: number | null;
  distance: number | null;
  resultValue: number;
  createdAt: string;
}

export async function apiGetHistory() {
  const res = await fetch(`${API_BASE}/history`, { headers: getHeaders() });
  return handleResponse(res);
}

export async function apiSaveCalculation(data: {
  mode: string;
  txPowerWatts: number;
  txGainDbi: number;
  rxGainDbi: number;
  frequencyMhz: number;
  sensitivity?: number;
  distance?: number;
  resultValue: number;
}) {
  const res = await fetch(`${API_BASE}/history`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(data)
  });
  return handleResponse(res);
}

export async function apiDeleteCalculation(id: string) {
  const res = await fetch(`${API_BASE}/history/${id}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  return handleResponse(res);
}

export async function apiClearHistory() {
  const res = await fetch(`${API_BASE}/history`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  return handleResponse(res);
}

// Weather (public endpoint — no auth required)
export async function apiGetWeather(lat: number, lon: number) {
  const res = await fetch(`${API_BASE}/weather?lat=${lat}&lon=${lon}`);
  return handleResponse(res);
}
