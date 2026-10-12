import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiErrorKey, apiGetMe } from '../api';

afterEach(() => vi.restoreAllMocks());

function mockFetch(body: string, status: number, contentType: string) {
  vi.stubGlobal('localStorage', { getItem: () => 'tok' });
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(body, { status, headers: { 'content-type': contentType } }));
}

describe('api error handling', () => {
  it('turns an HTML 502 (Render waking up) into a SERVER_UNAVAILABLE ApiError', async () => {
    mockFetch('<html>Bad gateway</html>', 502, 'text/html');
    const err = await apiGetMe().catch(e => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(502);
    expect(err.isAuthError).toBe(false);
    expect(apiErrorKey(err)).toBe('errors.serverUnavailable');
  });

  it('marks 401 as an auth error', async () => {
    mockFetch(JSON.stringify({ error: 'Invalid or expired token' }), 401, 'application/json');
    const err = await apiGetMe().catch(e => e);
    expect(err.isAuthError).toBe(true);
    expect(err.message).toBe('Invalid or expired token');
  });

  it('maps rate limiting and network failures to friendly keys', () => {
    expect(apiErrorKey(new ApiError('x', 429))).toBe('errors.tooManyAttempts');
    expect(apiErrorKey(new TypeError('Failed to fetch'))).toBe('errors.serverUnavailable');
  });
});
