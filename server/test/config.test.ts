import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('config', () => {
  it('refuses to start in production without JWT_SECRET', async () => {
    vi.stubEnv('JWT_SECRET', '');
    vi.stubEnv('RENDER', 'true');
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(import('../src/config')).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('falls back to the production frontend when FRONTEND_URL is unset', async () => {
    vi.stubEnv('FRONTEND_URL', '');
    const { isAllowedOrigin } = await import('../src/config');
    expect(isAllowedOrigin('https://ido-communications.vercel.app', true)).toBe(true);
    expect(isAllowedOrigin('https://evil.example', true)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', true)).toBe(false);
    expect(isAllowedOrigin('http://localhost:5173', false)).toBe(true);
  });

  it('accepts several comma-separated origins', async () => {
    vi.stubEnv('FRONTEND_URL', 'https://a.example/, https://b.example');
    const { isAllowedOrigin } = await import('../src/config');
    expect(isAllowedOrigin('https://a.example', true)).toBe(true);
    expect(isAllowedOrigin('https://b.example', true)).toBe(true);
  });
});
