/**
 * Israel Transverse Mercator (ITM, EPSG:2039) <-> WGS84 lat/lon.
 *
 * Transverse Mercator series on GRS80. The Israel 1993 -> WGS84 datum shift is
 * ignored; in Israel it is on the order of a metre, below DEM resolution.
 * Pure functions (no DOM), safe to use in workers.
 */

/**
 * Convert ITM (Israel Transverse Mercator) to WGS84
 * EPSG:2039 -> EPSG:4326
 */
export function itmToWgs84(easting: number, northing: number): { lat: number; lon: number } {
  // ITM parameters (EPSG:2039)
  const E0 = 219529.584; // False easting
  const N0 = 626907.390; // False northing
  const k0 = 1.0000067;  // Scale factor
  const lat0 = 31.7343936111111; // Origin latitude in degrees
  const lon0 = 35.2045169444444; // Central meridian in degrees

  // GRS80 ellipsoid
  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const e2 = 2*f - f*f;
  const ei2 = e2 / (1 - e2);
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  // Calculate M0 (meridional arc at origin latitude)
  const lat0Rad = lat0 * Math.PI / 180;
  const M0 = a * (
    (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * lat0Rad
    - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*lat0Rad)
    + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*lat0Rad)
    - (35*e2*e2*e2/3072) * Math.sin(6*lat0Rad)
  );

  // Remove false origin
  const x = easting - E0;
  const y = northing - N0;

  // Footprint latitude - add M0 to account for origin latitude
  const M = M0 + y / k0;
  const mu = M / (a * (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256));

  const fp = mu
    + (3*e1/2 - 27*e1*e1*e1/32) * Math.sin(2*mu)
    + (21*e1*e1/16 - 55*e1*e1*e1*e1/32) * Math.sin(4*mu)
    + (151*e1*e1*e1/96) * Math.sin(6*mu)
    + (1097*e1*e1*e1*e1/512) * Math.sin(8*mu);

  // Calculate latitude and longitude
  const cosFp = Math.cos(fp);
  const sinFp = Math.sin(fp);
  const tanFp = Math.tan(fp);

  const N1 = a / Math.sqrt(1 - e2 * sinFp * sinFp);
  const R1 = a * (1 - e2) / Math.pow(1 - e2 * sinFp * sinFp, 1.5);
  const T1 = tanFp * tanFp;
  const C1 = ei2 * cosFp * cosFp;
  const D = x / (N1 * k0);

  const lat = fp - (N1 * tanFp / R1) * (
    D*D/2
    - (5 + 3*T1 + 10*C1 - 4*C1*C1 - 9*ei2) * Math.pow(D, 4)/24
    + (61 + 90*T1 + 298*C1 + 45*T1*T1 - 252*ei2 - 3*C1*C1) * Math.pow(D, 6)/720
  );

  const lon = (lon0 * Math.PI / 180) + (
    D
    - (1 + 2*T1 + C1) * Math.pow(D, 3)/6
    + (5 - 2*C1 + 28*T1 - 3*C1*C1 + 8*ei2 + 24*T1*T1) * Math.pow(D, 5)/120
  ) / cosFp;

  return {
    lat: lat * 180 / Math.PI,
    lon: lon * 180 / Math.PI
  };
}

/**
 * Convert WGS84 to ITM (Israel Transverse Mercator)
 * EPSG:4326 -> EPSG:2039
 */
export function wgs84ToItm(lat: number, lon: number): { east: number; north: number } {
  const E0 = 219529.584;
  const N0 = 626907.390;
  const k0 = 1.0000067;
  const lat0 = 31.7343936111111; // Origin latitude in degrees
  const lon0 = 35.2045169444444; // Central meridian in degrees

  const a = 6378137.0;
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;
  const ei2 = e2 / (1 - e2);

  const lat0Rad = lat0 * Math.PI / 180;
  const lon0Rad = lon0 * Math.PI / 180;
  const latRad = lat * Math.PI / 180;
  const lonRad = lon * Math.PI / 180;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  const N = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const C = ei2 * cosLat * cosLat;
  const A = (lonRad - lon0Rad) * cosLat;

  // Calculate M (meridional arc from equator to lat)
  const M = a * (
    (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * latRad
    - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*latRad)
    + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*latRad)
    - (35*e2*e2*e2/3072) * Math.sin(6*latRad)
  );

  // Calculate M0 (meridional arc from equator to lat0)
  const M0 = a * (
    (1 - e2/4 - 3*e2*e2/64 - 5*e2*e2*e2/256) * lat0Rad
    - (3*e2/8 + 3*e2*e2/32 + 45*e2*e2*e2/1024) * Math.sin(2*lat0Rad)
    + (15*e2*e2/256 + 45*e2*e2*e2/1024) * Math.sin(4*lat0Rad)
    - (35*e2*e2*e2/3072) * Math.sin(6*lat0Rad)
  );

  const east = E0 + k0 * N * (
    A
    + (1 - T + C) * Math.pow(A, 3)/6
    + (5 - 18*T + T*T + 72*C - 58*ei2) * Math.pow(A, 5)/120
  );

  // Subtract M0 to get distance from origin latitude, not equator
  const north = N0 + k0 * (
    (M - M0) + N * tanLat * (
      A*A/2
      + (5 - T + 9*C + 4*C*C) * Math.pow(A, 4)/24
      + (61 - 58*T + T*T + 600*C - 330*ei2) * Math.pow(A, 6)/720
    )
  );

  return { east, north };
}
