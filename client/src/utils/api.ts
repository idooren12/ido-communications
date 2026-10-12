const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api';

export function readToken(): string | null {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
}

function getHeaders(): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = readToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }

  /** True when the server rejected the credentials (token missing, invalid or expired). */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

/** Maps an API error to a translation key for the generic (non-field) cases. */
export function apiErrorKey(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'errors.tooManyAttempts';
    if (err.status >= 500 || err.message === 'SERVER_UNAVAILABLE') return 'errors.serverUnavailable';
  } else if (err instanceof TypeError) {
    // fetch() rejects with a TypeError when the server can't be reached at all.
    return 'errors.serverUnavailable';
  }
  return 'errors.serverError';
}

async function handleResponse(res: Response) {
  const contentType = res.headers.get('content-type') || '';
  let data: { error?: string } & Record<string, unknown> = {};

  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = {};
    }
  }

  if (!res.ok) {
    // A non-JSON error (e.g. an HTML 502 page while Render wakes up) has no message for the user.
    const message = data.error || (res.status >= 500 ? 'SERVER_UNAVAILABLE' : 'Request failed');
    throw new ApiError(message, res.status);
  }

  if (!contentType.includes('application/json')) {
    throw new ApiError('SERVER_UNAVAILABLE', res.status);
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
  const res = await fetch(`${API_BASE}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
  return handleResponse(res);
}
