import { Router } from 'express';
import { TtlCache } from '../lib/ttlCache';
import { weatherLimiter } from '../lib/rateLimits';
import { formatZodError, weatherQuerySchema } from '../lib/validation';

const router = Router();

export interface WeatherResponse {
  temperature: number;
  humidity: number;
  windSpeed: number;
  rainMmH: number;
  visibility: number;
  description: string;
  icon: string;
}

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;
const FETCH_TIMEOUT_MS = 8000;

const cache = new TtlCache<WeatherResponse>(CACHE_TTL_MS, CACHE_MAX_ENTRIES);

// GET /api/weather?lat=32.08&lon=34.78 — public, no auth.
router.get('/', weatherLimiter, async (req, res) => {
  const parsed = weatherQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed.error) });
    return;
  }

  // Round to ~1 km. The same rounded coordinates are used for the cache key and the
  // upstream request, so every cached answer belongs exactly to its key.
  const lat = parsed.data.lat.toFixed(2);
  const lon = parsed.data.lon.toFixed(2);
  const cacheKey = `${lat},${lon}`;

  const cached = cache.get(cacheKey);
  if (cached) {
    res.json(cached);
    return;
  }

  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: 'Weather service not configured' });
    return;
  }

  try {
    const url = new URL('https://api.openweathermap.org/data/2.5/weather');
    url.search = new URLSearchParams({ lat, lon, appid: apiKey, units: 'metric' }).toString();

    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });

    if (!response.ok) {
      console.error(`OpenWeatherMap error: HTTP ${response.status}`);
      res.status(503).json({ error: 'Weather service temporarily unavailable' });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw: any = await response.json();

    const data: WeatherResponse = {
      temperature: raw.main?.temp ?? 0,
      humidity: raw.main?.humidity ?? 0,
      windSpeed: raw.wind?.speed ?? 0,
      rainMmH: raw.rain?.['1h'] ?? 0,
      visibility: raw.visibility ?? 10000,
      description: raw.weather?.[0]?.description ?? 'unknown',
      icon: raw.weather?.[0]?.icon ?? '01d',
    };

    cache.set(cacheKey, data);
    res.json(data);
  } catch (err) {
    console.error('Weather fetch error:', err instanceof Error ? err.message : err);
    res.status(503).json({ error: 'Failed to fetch weather data' });
  }
});

export default router;
