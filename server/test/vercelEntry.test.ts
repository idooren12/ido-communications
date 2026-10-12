import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';

vi.mock('../src/lib/prisma', () => ({ prisma: {} }));

describe('Vercel function entry', () => {
  it('exports the Express app as the default handler', async () => {
    const { default: handler } = await import('../api/index');
    expect(typeof handler).toBe('function');
    // The rewrite in vercel.json keeps the original path, so routing works as on Render.
    const health = await request(handler).get('/health');
    expect(health.status).toBe(200);
    const missing = await request(handler).get('/api/nope');
    expect(missing.status).toBe(404);
  });
});
