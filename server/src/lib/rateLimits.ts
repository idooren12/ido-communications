import rateLimit from 'express-rate-limit';

const message = (text: string) => ({ error: text });

/** Login / register / change-password: slows down password guessing. */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: message('Too many attempts, please try again later'),
});

/** Public weather proxy: protects the OpenWeatherMap quota. */
export const weatherLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many requests, please try again later'),
});

/** Everything else under /api. */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: message('Too many requests, please try again later'),
});
