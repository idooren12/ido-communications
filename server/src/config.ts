import crypto from 'crypto';

/** Render sets RENDER=true on its instances; NODE_ENV is not set there automatically. */
export const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  if (isProduction) {
    // Never fall back to a known value in production: anyone could forge tokens with it.
    console.error('FATAL: JWT_SECRET is not set. Refusing to start.');
    process.exit(1);
  }

  console.warn('JWT_SECRET is not set; using a random secret for this process (dev only). Tokens reset on restart.');
  return crypto.randomBytes(32).toString('hex');
}

export const JWT_SECRET = resolveJwtSecret();

const DEFAULT_FRONTEND_ORIGINS = ['https://ido-communications.vercel.app'];

/** Vercel preview deployments of this project (team scope idooren12s-projects). */
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/ido-communications-[a-z0-9-]+-idooren12s-projects\.vercel\.app$/;

const LOCAL_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function parseOrigins(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map(origin => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

const configuredOrigins = parseOrigins(process.env.FRONTEND_URL);
const allowedOrigins = new Set(configuredOrigins.length > 0 ? configuredOrigins : DEFAULT_FRONTEND_ORIGINS);

export function isAllowedOrigin(origin: string, production = isProduction): boolean {
  if (allowedOrigins.has(origin)) return true;
  if (VERCEL_PREVIEW_ORIGIN.test(origin)) return true;
  return !production && LOCAL_DEV_ORIGIN.test(origin);
}
