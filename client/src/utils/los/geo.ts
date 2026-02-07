/**
 * Unified geospatial utilities
 * All geodetic calculations should use these functions
 * Supports both spherical (fast) and ellipsoidal (accurate) calculations
 */

// WGS84 Ellipsoid Constants
export const WGS84 = {
  a: 6378137.0,           // Semi-major axis (equatorial radius) in meters
  b: 6356752.314245,      // Semi-minor axis (polar radius) in meters
  f: 1 / 298.257223563,   // Flattening
  e2: 0.00669437999014,   // First eccentricity squared
};

// Spherical approximation (faster, ~0.3% error max)
export const EARTH_RADIUS = 6371000; // meters (mean radius)
export const MAX_LATITUDE = 85.05112878; // Mercator limit
export const MIN_LATITUDE = -85.05112878;

// Types
export interface LatLon {
  lat: number;
  lon: number;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface LngRange {
  west: number;
  east: number;
}

export interface DistanceResult {
  distance: number;      // meters
  initialBearing: number; // degrees
  finalBearing: number;  // degrees
}

/**
 * Normalize longitude to [-180, 180]
 */
export function normalizeLng(lng: number): number {
  return ((lng + 180) % 360 + 360) % 360 - 180;
}

/**
 * Clamp latitude to Mercator limits
 */
export function clampLat(lat: number): number {
  return Math.max(MIN_LATITUDE, Math.min(MAX_LATITUDE, lat));
}

/**
 * Normalize a point's coordinates
 */
export function normalizePoint(point: LatLon): LatLon {
  return {
    lat: clampLat(point.lat),
    lon: normalizeLng(point.lon),
  };
}

/**
 * Check if bounds cross the antimeridian (dateline)
 */
export function crossesAntimeridian(west: number, east: number): boolean {
  return normalizeLng(west) > normalizeLng(east);
}

/**
 * Split longitude range if it crosses antimeridian
 * Returns one or two ranges that don't cross
 */
export function splitLngRanges(west: number, east: number): LngRange[] {
  const normWest = normalizeLng(west);
  const normEast = normalizeLng(east);

  if (normWest <= normEast) {
    // Normal case: doesn't cross antimeridian
    return [{ west: normWest, east: normEast }];
  }

  // Crosses antimeridian: split into two ranges
  return [
    { west: normWest, east: 180 },
    { west: -180, east: normEast },
  ];
}

/**
 * Normalize bounds, clamping latitude and handling antimeridian
 */
export function normalizeBounds(bounds: Bounds): Bounds {
  return {
    west: normalizeLng(bounds.west),
    south: clampLat(bounds.south),
    east: normalizeLng(bounds.east),
    north: clampLat(bounds.north),
  };
}

/**
 * Generate sample points within bounds, handling antimeridian crossing
 */
export function generateBoundsSamplePoints(
  bounds: Bounds,
  samplesPerAxis: number = 20
): LatLon[] {
  const points: LatLon[] = [];
  const normBounds = normalizeBounds(bounds);
  const lngRanges = splitLngRanges(normBounds.west, normBounds.east);

  const latStep = (normBounds.north - normBounds.south) / samplesPerAxis;

  for (const range of lngRanges) {
    const lngStep = (range.east - range.west) / samplesPerAxis;

    for (let i = 0; i <= samplesPerAxis; i++) {
      for (let j = 0; j <= samplesPerAxis; j++) {
        points.push({
          lat: normBounds.south + i * latStep,
          lon: range.west + j * lngStep,
        });
      }
    }
  }

  return points;
}

/**
 * Haversine distance between two points in meters
 * Fast spherical approximation (~0.3% max error)
 */
export function haversineDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
    Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Vincenty distance formula for WGS84 ellipsoid
 * Higher accuracy (~0.5mm precision) but slower
 * Returns null if iteration doesn't converge (nearly antipodal points)
 */
export function vincentyDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): DistanceResult | null {
  const { a, b, f } = WGS84;
  const maxIterations = 200;
  const tolerance = 1e-12;

  const \u03C61 = lat1 * Math.PI / 180;
  const \u03C62 = lat2 * Math.PI / 180;
  const L = (lon2 - lon1) * Math.PI / 180;

  const U1 = Math.atan((1 - f) * Math.tan(\u03C61));
  const U2 = Math.atan((1 - f) * Math.tan(\u03C62));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1);
  const sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);

  let \u03BB = L;
  let \u03BBPrev: number;
  let sin\u03C3: number, cos\u03C3: number, \u03C3: number;
  let sin\u03B1: number, cos2\u03B1: number, cos2\u03C3m: number;
  let C: number;

  for (let i = 0; i < maxIterations; i++) {
    const sin\u03BB = Math.sin(\u03BB), cos\u03BB = Math.cos(\u03BB);

    sin\u03C3 = Math.sqrt(
      (cosU2 * sin\u03BB) ** 2 +
      (cosU1 * sinU2 - sinU1 * cosU2 * cos\u03BB) ** 2
    );

    if (sin\u03C3 === 0) {
      // Coincident points
      return { distance: 0, initialBearing: 0, finalBearing: 0 };
    }

    cos\u03C3 = sinU1 * sinU2 + cosU1 * cosU2 * cos\u03BB;
    \u03C3 = Math.atan2(sin\u03C3, cos\u03C3);

    sin\u03B1 = cosU1 * cosU2 * sin\u03BB / sin\u03C3;
    cos2\u03B1 = 1 - sin\u03B1 ** 2;

    cos2\u03C3m = cos2\u03B1 !== 0 ? cos\u03C3 - 2 * sinU1 * sinU2 / cos2\u03B1 : 0;

    C = f / 16 * cos2\u03B1 * (4 + f * (4 - 3 * cos2\u03B1));

    \u03BBPrev = \u03BB;
    \u03BB = L + (1 - C) * f * sin\u03B1 * (
      \u03C3 + C * sin\u03C3 * (cos2\u03C3m + C * cos\u03C3 * (-1 + 2 * cos2\u03C3m ** 2))
    );

    if (Math.abs(\u03BB - \u03BBPrev) < tolerance) {
      break;
    }

    if (i === maxIterations - 1) {
      // Failed to converge - use haversine as fallback
      return {
        distance: haversineDistance(lat1, lon1, lat2, lon2),
        initialBearing: initialBearing(lat1, lon1, lat2, lon2),
        finalBearing: (initialBearing(lat2, lon2, lat1, lon1) + 180) % 360,
      };
    }
  }

  const u2 = cos2\u03B1 * (a ** 2 - b ** 2) / b ** 2;
  const A = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));

  const \u0394\u03C3 = B * sin\u03C3 * (
    cos2\u03C3m + B / 4 * (
      cos\u03C3 * (-1 + 2 * cos2\u03C3m ** 2) -
      B / 6 * cos2\u03C3m * (-3 + 4 * sin\u03C3 ** 2) * (-3 + 4 * cos2\u03C3m ** 2)
    )
  );

  const distance = b * A * (\u03C3 - \u0394\u03C3);

  // Calculate bearings
  const sin\u03BB = Math.sin(\u03BB), cos\u03BB = Math.cos(\u03BB);
  const initialBrg = Math.atan2(cosU2 * sin\u03BB, cosU1 * sinU2 - sinU1 * cosU2 * cos\u03BB);
  const finalBrg = Math.atan2(cosU1 * sin\u03BB, -sinU1 * cosU2 + cosU1 * sinU2 * cos\u03BB);

  return {
    distance,
    initialBearing: ((initialBrg * 180 / Math.PI) + 360) % 360,
    finalBearing: ((finalBrg * 180 / Math.PI) + 360) % 360,
  };
}

/**
 * Get the most accurate distance available
 * Uses Vincenty for short-medium distances, haversine as fallback
 */
export function accurateDistance(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const result = vincentyDistance(lat1, lon1, lat2, lon2);
  return result ? result.distance : haversineDistance(lat1, lon1, lat2, lon2);
}

/**
 * Initial bearing from point 1 to point 2 in degrees (0-360)
 */
export function initialBearing(
  lat1: number, lon1: number,
  lat2: number, lon2: number
): number {
  const \u03C61 = lat1 * Math.PI / 180;
  const \u03C62 = lat2 * Math.PI / 180;
  const \u0394\u03BB = (lon2 - lon1) * Math.PI / 180;

  const y = Math.sin(\u0394\u03BB) * Math.cos(\u03C62);
  const x = Math.cos(\u03C61) * Math.sin(\u03C62) - Math.sin(\u03C61) * Math.cos(\u03C62) * Math.cos(\u0394\u03BB);

  return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

/**
 * Interpolate along a great circle path
 */
export function interpolateGreatCircle(
  p1: LatLon,
  p2: LatLon,
  fraction: number
): LatLon {
  const \u03C61 = p1.lat * Math.PI / 180;
  const \u03BB1 = p1.lon * Math.PI / 180;
  const \u03C62 = p2.lat * Math.PI / 180;
  const \u03BB2 = p2.lon * Math.PI / 180;

  const d = 2 * Math.asin(Math.sqrt(
    Math.sin((\u03C62 - \u03C61) / 2) ** 2 +
    Math.cos(\u03C61) * Math.cos(\u03C62) * Math.sin((\u03BB2 - \u03BB1) / 2) ** 2
  ));

  if (d === 0) return { lat: p1.lat, lon: p1.lon };

  const A = Math.sin((1 - fraction) * d) / Math.sin(d);
  const B = Math.sin(fraction * d) / Math.sin(d);

  const x = A * Math.cos(\u03C61) * Math.cos(\u03BB1) + B * Math.cos(\u03C62) * Math.cos(\u03BB2);
  const y = A * Math.cos(\u03C61) * Math.sin(\u03BB1) + B * Math.cos(\u03C62) * Math.sin(\u03BB2);
  const z = A * Math.sin(\u03C61) + B * Math.sin(\u03C62);

  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * 180 / Math.PI,
    lon: Math.atan2(y, x) * 180 / Math.PI,
  };
}

/**
 * Destination point given start, bearing, and distance
 */
export function destinationPoint(
  lat: number, lon: number,
  bearing: number,
  distance: number
): LatLon {
  const \u03C61 = lat * Math.PI / 180;
  const \u03BB1 = lon * Math.PI / 180;
  const \u03B8 = bearing * Math.PI / 180;
  const \u03B4 = distance / EARTH_RADIUS;

  const \u03C62 = Math.asin(
    Math.sin(\u03C61) * Math.cos(\u03B4) +
    Math.cos(\u03C61) * Math.sin(\u03B4) * Math.cos(\u03B8)
  );
  const \u03BB2 = \u03BB1 + Math.atan2(
    Math.sin(\u03B8) * Math.sin(\u03B4) * Math.cos(\u03C61),
    Math.cos(\u03B4) - Math.sin(\u03C61) * Math.sin(\u03C62)
  );

  return {
    lat: \u03C62 * 180 / Math.PI,
    lon: normalizeLng(\u03BB2 * 180 / Math.PI),
  };
}

/**
 * Point in polygon test (ray casting algorithm)
 */
export function pointInPolygon(
  lat: number, lon: number,
  polygon: LatLon[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lon, yi = polygon[i].lat;
    const xj = polygon[j].lon, yj = polygon[j].lat;

    if (((yi > lat) !== (yj > lat)) &&
        (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Spherical polygon area in square meters
 * Uses the spherical excess formula
 */
export function sphericalPolygonArea(polygon: LatLon[]): number {
  if (polygon.length < 3) return 0;

  let total = 0;

  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    const p1 = polygon[i];
    const p2 = polygon[j];

    const lat1 = p1.lat * Math.PI / 180;
    const lat2 = p2.lat * Math.PI / 180;
    const dLon = (p2.lon - p1.lon) * Math.PI / 180;

    total += dLon * (2 + Math.sin(lat1) + Math.sin(lat2));
  }

  return Math.abs(total * EARTH_RADIUS * EARTH_RADIUS / 2);
}

/**
 * Polygon perimeter in meters
 */
export function polygonPerimeter(polygon: LatLon[]): number {
  if (polygon.length < 2) return 0;

  let total = 0;
  for (let i = 0; i < polygon.length; i++) {
    const j = (i + 1) % polygon.length;
    total += haversineDistance(
      polygon[i].lat, polygon[i].lon,
      polygon[j].lat, polygon[j].lon
    );
  }
  return total;
}

/**
 * Convert meters to degrees latitude (constant)
 */
export function metersToDegreesLat(meters: number): number {
  return meters / 111000;
}

/**
 * Convert meters to degrees longitude (varies with latitude)
 */
export function metersToDegreesLon(meters: number, latitude: number): number {
  return meters / (111000 * Math.cos(latitude * Math.PI / 180));
}

/**
 * Format distance for display
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} \u05DE'`;
  }
  return `${(meters / 1000).toFixed(2)} \u05E7"\u05DE`;
}

/**
 * Format area for display
 */
export function formatArea(squareMeters: number): string {
  if (squareMeters < 10000) {
    return `${Math.round(squareMeters)} \u05DE"\u05E8`;
  }
  if (squareMeters < 1000000) {
    return `${(squareMeters / 10000).toFixed(2)} \u05D3\u05D5\u05E0\u05DD`;
  }
  return `${(squareMeters / 1000000).toFixed(2)} \u05E7\u05DE"\u05E8`;
}
