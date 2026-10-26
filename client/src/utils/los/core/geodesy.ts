/**
 * Geodesy for LOS paths on the WGS84 ellipsoid. Pure module, safe in workers.
 *
 * - Path length: Vincenty's inverse formula (sub-millimetre; the old spherical haversine was
 *   0.1-0.2 % off, e.g. 40-100 m on a 50 km path in Israel).
 * - Path shape: great circle on the sphere (the lateral difference from the true geodesic is a
 *   few metres at 100 km, well below one DEM pixel), instead of a straight line in Web Mercator
 *   pixels (a rhumb line, 20-30 m off at 50 km and ~100 m at 100 km).
 * - Earth radius for the curvature term: the ellipsoid's radius of curvature along the path
 *   azimuth at mid-path (Euler), instead of a fixed 6,371 km.
 */

const A = 6378137;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const E2 = F * (2 - F);
const D2R = Math.PI / 180;

export const MEAN_EARTH_RADIUS_M = 6371008.8;

/** Spherical distance (haversine). Kept for cheap filtering; not used for the LOS geometry. */
export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * D2R, dLon = (lon2 - lon1) * D2R;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * MEAN_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing, degrees 0-360. */
export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}

/** Ellipsoidal distance in metres (Vincenty inverse). Falls back to haversine if it does not converge. */
export function geodesicDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const L = (lon2 - lon1) * D2R;
  const U1 = Math.atan((1 - F) * Math.tan(lat1 * D2R));
  const U2 = Math.atan((1 - F) * Math.tan(lat2 * D2R));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let lambda = L;
  let sinSigma = 0, cosSigma = 0, sigma = 0, cos2Alpha = 0, cos2SigmaM = 0;
  for (let i = 0; i < 100; i++) {
    const sinL = Math.sin(lambda), cosL = Math.cos(lambda);
    sinSigma = Math.sqrt((cosU2 * sinL) ** 2 + (cosU1 * sinU2 - sinU1 * cosU2 * cosL) ** 2);
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosL;
    sigma = Math.atan2(sinSigma, cosSigma);
    const sinAlpha = (cosU1 * cosU2 * sinL) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha !== 0 ? cosSigma - (2 * sinU1 * sinU2) / cos2Alpha : 0;
    const C = (F / 16) * cos2Alpha * (4 + F * (4 - 3 * cos2Alpha));
    const prev = lambda;
    lambda = L + (1 - C) * F * sinAlpha * (sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - prev) < 1e-12) {
      const u2 = (cos2Alpha * (A * A - B * B)) / (B * B);
      const AA = 1 + (u2 / 16384) * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
      const BB = (u2 / 1024) * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
      const dSigma = BB * sinSigma * (cos2SigmaM + (BB / 4) * (cosSigma * (-1 + 2 * cos2SigmaM ** 2)
        - (BB / 6) * cos2SigmaM * (-3 + 4 * sinSigma ** 2) * (-3 + 4 * cos2SigmaM ** 2)));
      return B * AA * (sigma - dSigma);
    }
  }
  return haversineMeters(lat1, lon1, lat2, lon2);
}

/** Radius of curvature of the ellipsoid at `latDeg` in the direction `azimuthDeg` (Euler's formula). */
export function radiusOfCurvature(latDeg: number, azimuthDeg: number): number {
  const s = Math.sin(latDeg * D2R);
  const w = 1 - E2 * s * s;
  const M = (A * (1 - E2)) / w ** 1.5; // meridian
  const N = A / Math.sqrt(w);          // prime vertical
  const a = azimuthDeg * D2R;
  return 1 / (Math.cos(a) ** 2 / M + Math.sin(a) ** 2 / N);
}

/**
 * Points along the great circle from 1 to 2 at fractions 0, 1/k, ..., 1 (k segments).
 * Returns flat arrays of lat/lon in degrees.
 */
export function greatCircleKnots(lat1: number, lon1: number, lat2: number, lon2: number, k: number): { lat: Float64Array; lon: Float64Array } {
  const lat = new Float64Array(k + 1), lon = new Float64Array(k + 1);
  const p1 = lat1 * D2R, l1 = lon1 * D2R, p2 = lat2 * D2R, l2 = lon2 * D2R;
  const x1 = Math.cos(p1) * Math.cos(l1), y1 = Math.cos(p1) * Math.sin(l1), z1 = Math.sin(p1);
  const x2 = Math.cos(p2) * Math.cos(l2), y2 = Math.cos(p2) * Math.sin(l2), z2 = Math.sin(p2);
  const d = Math.acos(Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2)));
  for (let i = 0; i <= k; i++) {
    const f = i / k;
    if (d < 1e-12) { lat[i] = lat1 + (lat2 - lat1) * f; lon[i] = lon1 + (lon2 - lon1) * f; continue; }
    const a = Math.sin((1 - f) * d) / Math.sin(d), b = Math.sin(f * d) / Math.sin(d);
    const x = a * x1 + b * x2, y = a * y1 + b * y2, z = a * z1 + b * z2;
    lat[i] = Math.atan2(z, Math.hypot(x, y)) / D2R;
    lon[i] = Math.atan2(y, x) / D2R;
  }
  lat[0] = lat1; lon[0] = lon1; lat[k] = lat2; lon[k] = lon2;
  return { lat, lon };
}
