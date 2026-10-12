import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';

const prismaMock = vi.hoisted(() => ({
  user: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  antenna: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  calculation: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
  $transaction: vi.fn(),
}));

vi.mock('../src/lib/prisma', () => ({ prisma: prismaMock }));

import { createApp } from '../src/app';
import { generateToken } from '../src/middleware/auth';

const FRONTEND = 'https://ido-communications.vercel.app';

function freshApp() {
  // Each test gets its own app, but the rate limiters are module singletons; tests that
  // count requests use unique IPs via X-Forwarded-For (trust proxy = 1).
  return createApp();
}

let ipCounter = 0;
const uniqueIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('auth', () => {
  it('rejects an invalid username with 400', async () => {
    const res = await request(freshApp())
      .post('/api/auth/register')
      .set('X-Forwarded-For', uniqueIp())
      .send({ username: 'a!', password: 'secret123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Username/);
    expect(prismaMock.user.create).not.toHaveBeenCalled();
  });

  it('rejects passwords longer than 72 bytes (bcrypt would truncate them)', async () => {
    const res = await request(freshApp())
      .post('/api/auth/register')
      .set('X-Forwarded-For', uniqueIp())
      .send({ username: 'ido_test', password: 'א'.repeat(40) }); // 80 bytes in UTF-8
    expect(res.status).toBe(400);
  });

  it('returns 409 when the username is taken', async () => {
    prismaMock.user.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })
    );
    const res = await request(freshApp())
      .post('/api/auth/register')
      .set('X-Forwarded-For', uniqueIp())
      .send({ username: 'ido_test', password: 'secret123' });
    expect(res.status).toBe(409);
  });

  it('registers and returns a working token', async () => {
    prismaMock.user.create.mockResolvedValueOnce({ id: 'u1', username: 'ido_test', preferredLanguage: 'he', createdAt: new Date() });
    const app = freshApp();
    const res = await request(app)
      .post('/api/auth/register')
      .set('X-Forwarded-For', uniqueIp())
      .send({ username: 'ido_test', password: 'secret123' });
    expect(res.status).toBe(201);
    expect(res.body.user).not.toHaveProperty('passwordHash');

    prismaMock.user.findUnique.mockResolvedValueOnce({ id: 'u1', username: 'ido_test', preferredLanguage: 'he', createdAt: new Date() });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.id).toBe('u1');
  });

  it('returns 401 for an unknown user and a wrong password alike', async () => {
    const app = freshApp();
    prismaMock.user.findUnique.mockResolvedValueOnce(null);
    const unknown = await request(app).post('/api/auth/login').set('X-Forwarded-For', uniqueIp()).send({ username: 'nobody', password: 'x' });
    expect(unknown.status).toBe(401);

    prismaMock.user.findUnique.mockResolvedValueOnce({
      id: 'u1', username: 'ido', passwordHash: await bcrypt.hash('right-pass', 4), preferredLanguage: 'he', createdAt: new Date(),
    });
    const wrong = await request(app).post('/api/auth/login').set('X-Forwarded-For', uniqueIp()).send({ username: 'ido', password: 'wrong-pass' });
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rate-limits repeated failed logins from one IP', async () => {
    const app = freshApp();
    const ip = uniqueIp();
    prismaMock.user.findUnique.mockResolvedValue(null);
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username: 'nobody', password: 'x' });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('rejects a forged token with 401', async () => {
    const res = await request(freshApp()).get('/api/auth/me').set('Authorization', 'Bearer not.a.token');
    expect(res.status).toBe(401);
  });

  it('only accepts he/en as preferred language', async () => {
    const res = await request(freshApp())
      .put('/api/auth/preferences')
      .set('Authorization', `Bearer ${generateToken('u1')}`)
      .send({ preferredLanguage: '<script>' });
    expect(res.status).toBe(400);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});

describe('antennas', () => {
  const auth = () => ({ Authorization: `Bearer ${generateToken('u1')}` });

  it('rejects non-numeric power instead of storing NaN', async () => {
    const res = await request(freshApp()).post('/api/antennas').set(auth()).send({ name: 'A', powerWatts: 'abc', gainDbi: 3 });
    expect(res.status).toBe(400);
    expect(prismaMock.antenna.create).not.toHaveBeenCalled();
  });

  it('rejects overly long names', async () => {
    const res = await request(freshApp()).post('/api/antennas').set(auth()).send({ name: 'x'.repeat(101), powerWatts: 5, gainDbi: 3 });
    expect(res.status).toBe(400);
  });

  it('creates an antenna owned by the caller', async () => {
    prismaMock.antenna.create.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'a1', ...data }));
    const res = await request(freshApp()).post('/api/antennas').set(auth()).send({ name: '  Yagi  ', powerWatts: '5', gainDbi: 9 });
    expect(res.status).toBe(201);
    expect(prismaMock.antenna.create).toHaveBeenCalledWith({ data: { name: 'Yagi', powerWatts: 5, gainDbi: 9, userId: 'u1' } });
  });

  it("returns 404 when updating someone else's antenna", async () => {
    prismaMock.antenna.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await request(freshApp()).put('/api/antennas/other').set(auth()).send({ name: 'x' });
    expect(res.status).toBe(404);
    expect(prismaMock.antenna.updateMany).toHaveBeenCalledWith({ where: { id: 'other', userId: 'u1' }, data: { name: 'x' } });
  });
});

describe('history', () => {
  it('rejects a calculation with missing fields', async () => {
    const res = await request(freshApp())
      .post('/api/history')
      .set('Authorization', `Bearer ${generateToken('u1')}`)
      .send({ mode: 'distance' });
    expect(res.status).toBe(400);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('requires authentication', async () => {
    const res = await request(freshApp()).get('/api/history');
    expect(res.status).toBe(401);
  });
});

describe('weather', () => {
  it('rejects out-of-range coordinates', async () => {
    const res = await request(freshApp()).get('/api/weather?lat=123&lon=34').set('X-Forwarded-For', uniqueIp());
    expect(res.status).toBe(400);
  });

  it('caches by rounded coordinates', async () => {
    process.env.OPENWEATHERMAP_API_KEY = 'k';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ main: { temp: 20, humidity: 50 }, wind: { speed: 3 }, weather: [{ description: 'clear', icon: '01d' }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const app = freshApp();
    const a = await request(app).get('/api/weather?lat=31.7712&lon=35.2131').set('X-Forwarded-For', uniqueIp());
    const b = await request(app).get('/api/weather?lat=31.7701&lon=35.2149').set('X-Forwarded-For', uniqueIp());
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain('lat=31.77');
    fetchMock.mockRestore();
  });
});

describe('app', () => {
  it('allows the production frontend and Vercel previews, not other origins', async () => {
    const app = freshApp();
    const ok = await request(app).get('/health').set('Origin', FRONTEND);
    expect(ok.headers['access-control-allow-origin']).toBe(FRONTEND);

    const preview = 'https://ido-communications-git-fix-idooren12s-projects.vercel.app';
    const prev = await request(app).get('/health').set('Origin', preview);
    expect(prev.headers['access-control-allow-origin']).toBe(preview);

    const evil = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers malformed JSON with a JSON 400', async () => {
    const res = await request(freshApp())
      .post('/api/auth/login')
      .set('X-Forwarded-For', uniqueIp())
      .set('Content-Type', 'application/json')
      .send('{"username":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON body' });
  });

  it('turns unexpected errors into a JSON 500', async () => {
    prismaMock.antenna.findMany.mockRejectedValueOnce(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementationOnce(() => {});
    const res = await request(freshApp()).get('/api/antennas').set('Authorization', `Bearer ${generateToken('u1')}`);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Server error' });
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await request(freshApp()).get('/api/nope');
    expect(res.status).toBe(404);
  });
});
