import { Router } from 'express';

const router = Router();

// In-memory cache: key = "lat,lon" (rounded to 2 decimals), value = { data, timestamp }
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const cache = new Map<string, { data: WeatherResponse; timestamp: number }>();

interface WeatherResponse {
  temperature: number;
  humidity: number;
  windSpeed: number;
  rainMmH: number;
  visibility: number;
  description: string;
  icon: string;
}

// GET /api/weather?lat=32.08&lon=34.78
// Public endpoint — no auth required
router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat as string);
  const lon = parseFloat(req.query.lon as string);

  if (isNaN(lat) || isNaN(lon)) {
    return res.status(400).json({ error: 'lat and lon query parameters are required' });
  }

  // Round to 2 decimals for cache key
  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;

  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return res.json(cached.data);
  }

  // Fetch from OpenWeatherMap
  const apiKey = process.env.OPENWEATHERMAP_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'Weather service not configured' });
  }

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const response = await fetch(url);

    if (!response.ok) {
      const text = await response.text();
      console.error(`OpenWeatherMap error: ${response.status} ${text}`);
      return res.status(503).json({ error: 'Weather service temporarily unavailable' });
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

    // Store in cache
    cache.set(cacheKey, { data, timestamp: Date.now() });

    return res.json(data);
  } catch (err) {
    console.error('Weather fetch error:', err);
    return res.status(503).json({ error: 'Failed to fetch weather data' });
  }
});

export default router;
