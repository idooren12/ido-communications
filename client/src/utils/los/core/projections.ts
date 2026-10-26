/**
 * Map projections used for uploaded elevation rasters, with the datum shifts to WGS84.
 *
 *   EPSG:2039  Israel 1993 / Israeli TM Grid (ITM). GRS80, Transverse Mercator.
 *              Israel 1993 -> WGS84: 7-parameter Helmert (EPSG "Israel 1993 to WGS 84 (2)",
 *              accuracy 0.5 m). Ignoring it moves points by ~78 m (about 66 m east, 41 m north).
 *   EPSG:28193 Palestine 1923 / Israeli CS Grid (ICS, the "old Israeli grid"). Clarke 1880
 *              (Benoit), Cassini-Soldner; Helmert from EPSG (accuracy ~2 m).
 *   EPSG:326zz WGS84 / UTM zone zz N.
 *   EPSG:4326  geographic WGS84 (identity).
 *
 * Parameters are the ones PROJ uses for these codes; the tests compare against PROJ output.
 * Pure functions (no DOM), safe in workers.
 */

const DEG = Math.PI / 180;
const ARCSEC = Math.PI / (180 * 3600);

export interface Ellipsoid { a: number; f: number }
const WGS84_ELL: Ellipsoid = { a: 6378137, f: 1 / 298.257223563 };
const GRS80_ELL: Ellipsoid = { a: 6378137, f: 1 / 298.257222101 };
const CLARKE1880_BENOIT: Ellipsoid = { a: 6378300.789, f: 1 - 6356566.435 / 6378300.789 };

// ---------------------------------------------------------------- geocentric + Helmert

type Vec3 = [number, number, number];

function toCartesian(latRad: number, lonRad: number, ell: Ellipsoid): Vec3 {
  const e2 = ell.f * (2 - ell.f);
  const s = Math.sin(latRad), c = Math.cos(latRad);
  const n = ell.a / Math.sqrt(1 - e2 * s * s);
  return [n * c * Math.cos(lonRad), n * c * Math.sin(lonRad), n * (1 - e2) * s];
}

function fromCartesian([x, y, z]: Vec3, ell: Ellipsoid): { lat: number; lon: number } {
  const e2 = ell.f * (2 - ell.f);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat);
    const n = ell.a / Math.sqrt(1 - e2 * s * s);
    const h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (e2 * n) / (n + h)));
  }
  return { lat, lon: Math.atan2(y, x) };
}

interface Helmert {
  t: Vec3;            // metres
  r: Vec3;            // arc-seconds
  s: number;          // ppm
  convention: 'position_vector' | 'coordinate_frame';
}

function helmertMatrix(h: Helmert): number[][] {
  const sign = h.convention === 'position_vector' ? 1 : -1;
  const [rx, ry, rz] = h.r.map(v => sign * v * ARCSEC);
  const m = 1 + h.s * 1e-6;
  return [
    [m, -m * rz, m * ry],
    [m * rz, m, -m * rx],
    [-m * ry, m * rx, m],
  ];
}

/** Source datum -> WGS84 (forward) or WGS84 -> source datum (inverse, exact 3x3 inverse). */
function applyHelmert(v: Vec3, h: Helmert, inverse: boolean): Vec3 {
  const R = helmertMatrix(h);
  if (!inverse) {
    return [
      h.t[0] + R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
      h.t[1] + R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
      h.t[2] + R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
    ];
  }
  const d: Vec3 = [v[0] - h.t[0], v[1] - h.t[1], v[2] - h.t[2]];
  const [[a, b, c], [d1, e, f], [g, hh, i]] = R;
  const det = a * (e * i - f * hh) - b * (d1 * i - f * g) + c * (d1 * hh - e * g);
  const inv = [
    [(e * i - f * hh) / det, (c * hh - b * i) / det, (b * f - c * e) / det],
    [(f * g - d1 * i) / det, (a * i - c * g) / det, (c * d1 - a * f) / det],
    [(d1 * hh - e * g) / det, (b * g - a * hh) / det, (a * e - b * d1) / det],
  ];
  return [
    inv[0][0] * d[0] + inv[0][1] * d[1] + inv[0][2] * d[2],
    inv[1][0] * d[0] + inv[1][1] * d[1] + inv[1][2] * d[2],
    inv[2][0] * d[0] + inv[2][1] * d[1] + inv[2][2] * d[2],
  ];
}

// PROJ: "+inv +proj=helmert ... convention=coordinate_frame" applied to WGS84 gives Israel 1993,
// so these parameters map Israel 1993 -> WGS84 when applied forward.
const ISRAEL1993_TO_WGS84: Helmert = {
  t: [23.772, 17.49, 17.859], r: [0.3132, 1.85274, -1.67299], s: -5.4262, convention: 'coordinate_frame',
};
const PALESTINE1923_TO_WGS84: Helmert = {
  t: [-275.7224, 94.7824, 340.8944], r: [-8.001, -4.42, -11.821], s: 1, convention: 'position_vector',
};

function datumToWgs84(latRad: number, lonRad: number, ell: Ellipsoid, h: Helmert) {
  return fromCartesian(applyHelmert(toCartesian(latRad, lonRad, ell), h, false), WGS84_ELL);
}
function wgs84ToDatum(latRad: number, lonRad: number, ell: Ellipsoid, h: Helmert) {
  return fromCartesian(applyHelmert(toCartesian(latRad, lonRad, WGS84_ELL), h, true), ell);
}

// ---------------------------------------------------------------- meridian arc

function meridianArc(latRad: number, e2: number, a: number): number {
  const e4 = e2 * e2, e6 = e4 * e2;
  return a * (
    (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latRad
    - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latRad)
    + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latRad)
    - (35 * e6 / 3072) * Math.sin(6 * latRad)
  );
}

function footpointLatitude(m: number, e2: number, a: number): number {
  const e4 = e2 * e2, e6 = e4 * e2;
  const mu = m / (a * (1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256));
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  return mu
    + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu)
    + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu)
    + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
}

// ---------------------------------------------------------------- Transverse Mercator

interface TmParams { ell: Ellipsoid; lat0: number; lon0: number; k0: number; x0: number; y0: number }

function tmForward(latRad: number, lonRad: number, p: TmParams): { x: number; y: number } {
  const { a, f } = p.ell;
  const e2 = f * (2 - f), ei2 = e2 / (1 - e2);
  const s = Math.sin(latRad), c = Math.cos(latRad), t = Math.tan(latRad);
  const N = a / Math.sqrt(1 - e2 * s * s);
  const T = t * t, C = ei2 * c * c, A = (lonRad - p.lon0 * DEG) * c;
  const M = meridianArc(latRad, e2, a), M0 = meridianArc(p.lat0 * DEG, e2, a);
  return {
    x: p.x0 + p.k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ei2) * A ** 5 / 120),
    y: p.y0 + p.k0 * (M - M0 + N * t * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ei2) * A ** 6 / 720)),
  };
}

function tmInverse(x: number, y: number, p: TmParams): { lat: number; lon: number } {
  const { a, f } = p.ell;
  const e2 = f * (2 - f), ei2 = e2 / (1 - e2);
  const M = meridianArc(p.lat0 * DEG, e2, a) + (y - p.y0) / p.k0;
  const fp = footpointLatitude(M, e2, a);
  const s = Math.sin(fp), c = Math.cos(fp), t = Math.tan(fp);
  const N1 = a / Math.sqrt(1 - e2 * s * s);
  const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
  const T1 = t * t, C1 = ei2 * c * c, D = (x - p.x0) / (N1 * p.k0);
  const lat = fp - (N1 * t / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ei2) * D ** 4 / 24
    + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ei2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = p.lon0 * DEG + (D - (1 + 2 * T1 + C1) * D ** 3 / 6
    + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ei2 + 24 * T1 * T1) * D ** 5 / 120) / c;
  return { lat, lon };
}

// ---------------------------------------------------------------- Cassini-Soldner (Snyder)

interface CassParams { ell: Ellipsoid; lat0: number; lon0: number; x0: number; y0: number }

function cassForward(latRad: number, lonRad: number, p: CassParams): { x: number; y: number } {
  const { a, f } = p.ell;
  const e2 = f * (2 - f);
  const s = Math.sin(latRad), c = Math.cos(latRad), t = Math.tan(latRad);
  const N = a / Math.sqrt(1 - e2 * s * s);
  const T = t * t, A = (lonRad - p.lon0 * DEG) * c, C = (e2 * c * c) / (1 - e2);
  const M = meridianArc(latRad, e2, a), M0 = meridianArc(p.lat0 * DEG, e2, a);
  return {
    x: p.x0 + N * (A - T * A ** 3 / 6 - (8 - T + 8 * C) * T * A ** 5 / 120),
    y: p.y0 + M - M0 + N * t * (A * A / 2 + (5 - T + 6 * C) * A ** 4 / 24),
  };
}

function cassInverse(x: number, y: number, p: CassParams): { lat: number; lon: number } {
  const { a, f } = p.ell;
  const e2 = f * (2 - f);
  const fp = footpointLatitude(meridianArc(p.lat0 * DEG, e2, a) + (y - p.y0), e2, a);
  const s = Math.sin(fp), c = Math.cos(fp), t = Math.tan(fp);
  const N1 = a / Math.sqrt(1 - e2 * s * s);
  const R1 = (a * (1 - e2)) / (1 - e2 * s * s) ** 1.5;
  const T1 = t * t, D = (x - p.x0) / N1;
  const lat = fp - (N1 * t / R1) * (D * D / 2 - (1 + 3 * T1) * D ** 4 / 24);
  const lon = p.lon0 * DEG + (D - T1 * D ** 3 / 3 + (1 + 3 * T1) * T1 * D ** 5 / 15) / c;
  return { lat, lon };
}

// ---------------------------------------------------------------- CRS definitions

const ITM: TmParams = { ell: GRS80_ELL, lat0: 31.7343936111111, lon0: 35.2045169444444, k0: 1.0000067, x0: 219529.584, y0: 626907.39 };
const ICS: CassParams = { ell: CLARKE1880_BENOIT, lat0: 31.7340969444444, lon0: 35.2120805555556, x0: 170251.555, y0: 1126867.909 };
const utm = (zone: number): TmParams => ({ ell: WGS84_ELL, lat0: 0, lon0: zone * 6 - 183, k0: 0.9996, x0: 500000, y0: 0 });

/** Coordinate systems an uploaded raster can be in. Plain data, so it survives postMessage to workers. */
export type CrsCode = 'EPSG:4326' | 'EPSG:2039' | 'EPSG:28193' | `EPSG:326${number}`;

export const SUPPORTED_EPSG = [4326, 2039, 28193] as const;
export const isUtmNorth = (epsg: number) => epsg >= 32601 && epsg <= 32660;

export function crsFromEpsg(epsg: number): CrsCode | null {
  if (epsg === 4326 || epsg === 4269 || epsg === 4258) return 'EPSG:4326';
  if (epsg === 2039) return 'EPSG:2039';
  if (epsg === 28193) return 'EPSG:28193';
  if (isUtmNorth(epsg)) return `EPSG:${epsg}` as CrsCode;
  return null;
}

/** WGS84 lat/lon (degrees) -> projected x/y (metres) in `crs` (or lon/lat for EPSG:4326). */
export function fromWgs84(crs: CrsCode, lat: number, lon: number): { x: number; y: number } {
  if (crs === 'EPSG:4326') return { x: lon, y: lat };
  if (crs === 'EPSG:2039') {
    const g = wgs84ToDatum(lat * DEG, lon * DEG, GRS80_ELL, ISRAEL1993_TO_WGS84);
    return tmForward(g.lat, g.lon, ITM);
  }
  if (crs === 'EPSG:28193') {
    const g = wgs84ToDatum(lat * DEG, lon * DEG, CLARKE1880_BENOIT, PALESTINE1923_TO_WGS84);
    return cassForward(g.lat, g.lon, ICS);
  }
  return tmForward(lat * DEG, lon * DEG, utm(Number(crs.slice(5)) - 32600));
}

/** Projected x/y in `crs` -> WGS84 lat/lon (degrees). */
export function toWgs84(crs: CrsCode, x: number, y: number): { lat: number; lon: number } {
  if (crs === 'EPSG:4326') return { lat: y, lon: x };
  let g: { lat: number; lon: number };
  if (crs === 'EPSG:2039') {
    const l = tmInverse(x, y, ITM);
    g = datumToWgs84(l.lat, l.lon, GRS80_ELL, ISRAEL1993_TO_WGS84);
  } else if (crs === 'EPSG:28193') {
    const l = cassInverse(x, y, ICS);
    g = datumToWgs84(l.lat, l.lon, CLARKE1880_BENOIT, PALESTINE1923_TO_WGS84);
  } else {
    g = tmInverse(x, y, utm(Number(crs.slice(5)) - 32600));
  }
  return { lat: g.lat / DEG, lon: g.lon / DEG };
}

/**
 * Best guess of the CRS of a projected bounding box when the file carries no EPSG code.
 * Ranges of Israel and its surroundings:
 *   ITM   E 100k..320k, N 340k..840k
 *   ICS   E  50k..270k, N 840k..1,400k (or N -100k..400k when the leading million was dropped)
 *   UTM36 E 160k..840k, N 3.0M..3.9M (37N: same, further east)
 * Returns null when nothing fits (the caller should then refuse the file, not guess).
 */
export function guessProjectedCrs(west: number, south: number, east: number, north: number): { crs: CrsCode; northOffset: number } | null {
  const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  if (inRange(south, 3_000_000, 3_950_000) && inRange(north, 3_000_000, 3_950_000) && inRange(west, 160_000, 840_000) && inRange(east, 160_000, 840_000)) {
    // Israel is in zone 36 (30E-36E); a raster east of ~36E is usually 37N, which we cannot tell from numbers.
    return { crs: 'EPSG:32636', northOffset: 0 };
  }
  if (!inRange(west, 30_000, 330_000) || !inRange(east, 30_000, 330_000)) return null;
  if (inRange(south, 340_000, 840_000) && inRange(north, 340_000, 840_000)) return { crs: 'EPSG:2039', northOffset: 0 };
  if (inRange(south, 840_000, 1_400_000) && inRange(north, 840_000, 1_400_000)) return { crs: 'EPSG:28193', northOffset: 0 };
  if (inRange(south, -160_000, 400_000) && inRange(north, -160_000, 400_000)) return { crs: 'EPSG:28193', northOffset: 1_000_000 };
  return null;
}

// ---------------------------------------------------------------- legacy ITM API

/** WGS84 -> ITM (EPSG:2039), datum shift included. */
export function wgs84ToItm(lat: number, lon: number): { east: number; north: number } {
  const p = fromWgs84('EPSG:2039', lat, lon);
  return { east: p.x, north: p.y };
}

/** ITM (EPSG:2039) -> WGS84, datum shift included. */
export function itmToWgs84(easting: number, northing: number): { lat: number; lon: number } {
  return toWgs84('EPSG:2039', easting, northing);
}
