export interface GeocodingResult {
  lat: number;
  lon: number;
  displayName: string;
  type: 'coordinates' | 'place';
}

// Parse coordinate string
export function parseCoordinates(input: string): { lat: number; lon: number } | null {
  const cleaned = input.trim();

  // Match patterns like "31.778, 35.235" or "31.778 35.235"
  const match = cleaned.match(/^\s*(-?\d+\.?\d*)\s*[,\s]\s*(-?\d+\.?\d*)\s*$/);

  if (!match) return null;

  const lat = parseFloat(match[1]);
  const lon = parseFloat(match[2]);

  // Validate ranges
  if (isNaN(lat) || isNaN(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;

  return { lat, lon };
}

// Check if input looks like coordinates
export function isCoordinateInput(input: string): boolean {
  return /^\s*-?\d+\.?\d*\s*[,\s]\s*-?\d+\.?\d*\s*$/.test(input);
}

// Rate limiter for Nominatim
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 1000;

async function rateLimitedFetch(url: string, options?: RequestInit): Promise<Response> {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise(resolve => setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest));
  }

  lastRequestTime = Date.now();
  return fetch(url, options);
}

// Geocode a place name
export async function geocodePlace(query: string): Promise<GeocodingResult[]> {
  // First check if it's coordinates
  const coords = parseCoordinates(query);
  if (coords) {
    return [{
      lat: coords.lat,
      lon: coords.lon,
      displayName: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`,
      type: 'coordinates',
    }];
  }

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '5',
    viewbox: '34.0,29.0,36.0,34.0',
    bounded: '0',
    'accept-language': 'he,en',
  });

  try {
    const response = await rateLimitedFetch(
      `https://nominatim.openstreetmap.org/search?${params}`,
      {
        headers: { 'User-Agent': 'IsraelElevationMap/3.0' },
      }
    );

    if (!response.ok) {
      throw new Error('GEOCODING_ERROR');
    }

    const data = await response.json();

    return data.map((item: any) => ({
      lat: parseFloat(item.lat),
      lon: parseFloat(item.lon),
      displayName: item.display_name,
      type: 'place' as const,
    }));
  } catch (error) {
    console.error('Geocoding error:', error);
    throw error;
  }
}

// Reverse geocode
export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  const params = new URLSearchParams({
    lat: String(lat),
    lon: String(lon),
    format: 'json',
    'accept-language': 'he,en',
  });

  try {
    const response = await rateLimitedFetch(
      `https://nominatim.openstreetmap.org/reverse?${params}`,
      {
        headers: { 'User-Agent': 'IsraelElevationMap/3.0' },
      }
    );

    if (!response.ok) return null;

    const data = await response.json();
    return data.display_name || null;
  } catch {
    return null;
  }
}
