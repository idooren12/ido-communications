/**
 * The single line-of-sight model used by both the line tool and the area tool.
 *
 * Geometry: straight ray between the two antenna tips over the WGS84 ellipsoid, with the
 * Earth's curvature reduced by the refraction factor k (effective radius k*R). R is the
 * ellipsoid's radius of curvature along the path azimuth. Clearance at each sample is
 *   ray height - curvature drop - terrain elevation,   drop = d1*d2 / (2*k*R).
 * The path follows the great circle, and its length is the ellipsoidal (Vincenty) distance.
 *
 * Refraction: k = 4/3 for radio (standard atmosphere), 1.15 for visible light (refraction
 * coefficient 0.13). Callers may also pass a worst-case k (2/3, sub-refraction, the usual
 * design case for microwave links); its clearance is reported but does not change the class.
 *
 * Sampling: every half DEM pixel along the path, independent of distance.
 *
 * Endpoints: samples closer than half a DEM pixel to either end are not treated as
 * obstacles. Terrain detail inside the endpoint's own cell is below the data's resolution.
 *
 * Uncertainty band: SRTM-class terrain is accurate to several metres, so a clearance close to
 * zero does not decide anything. The ray is anchored to the DEM ground at both ends (antenna
 * heights are measured from it), and DEM errors are spatially correlated, so what matters is
 * the error of a sample relative to the endpoints: zero at the ends, largest mid-path. The band
 * is +-marginM, scaled by min(1, dmin / ENDPOINT_CORRELATION_M, dmin / (D/2)), where dmin is the
 * distance to the nearer endpoint (a heuristic: it lets a 2 m target on open flat ground stay
 * "clear" while near-zero clearances mid-path are flagged).
 *
 * Result classes:
 *   clear    - ray clears terrain by more than the band everywhere (RF: and 60 % of F1)
 *   fresnel  - RF only: clear, but 60 % of the first Fresnel zone is obstructed
 *   marginal - within the band somewhere: the answer depends on metres the data cannot resolve
 *   blocked  - blocked by more than the band somewhere
 *   nodata   - no terrain at an endpoint, or too much of the path missing
 *
 * Pure module, safe to import from workers.
 */

import { TerrainSampler, groundResolution, globalPixelToLngLat, lngLatToGlobalPixel, type TerrainSample } from './terrain';
import { geodesicDistance, greatCircleKnots, initialBearingDeg, radiusOfCurvature } from './geodesy';

export { haversineMeters } from './geodesy';

export const STANDARD_K = 4 / 3;
/** Visible light: refraction coefficient ~0.13 -> k = 1 / (1 - 0.13). */
export const OPTICAL_K = 1 / (1 - 0.13);
/** Sub-refraction worst case used in microwave link planning. */
export const WORST_K = 2 / 3;
/** Half-width of the uncertainty band at mid-path, metres. */
export const MARGINAL_CLEARANCE_M = 3;
/** Distance from an endpoint over which the band grows from 0 to its full width. */
export const ENDPOINT_CORRELATION_M = 1000;
export const FRESNEL_CLEAR_FRACTION = 0.6;
const SPEED_OF_LIGHT = 299792458;
const MAX_SAMPLES = 40000;
/** Great-circle knots at most this far apart; between knots the path is straight in pixel space. */
const KNOT_SPACING_M = 1000;
/** More than this share of path samples without terrain data -> 'nodata'. */
const MAX_MISSING_FRACTION = 0.3;

/** @deprecated Kept for imports; the model uses the ellipsoid's radius of curvature. */
export const EARTH_RADIUS_M = 6371000;

export type LosStatus = 'clear' | 'fresnel' | 'marginal' | 'blocked' | 'nodata';

export interface LosEndpoint {
  lat: number;
  lon: number;
  /** Antenna / observer height above ground, metres. */
  height: number;
}

export interface LosEvalOptions {
  frequencyMHz?: number;
  /** Refraction factor; default 4/3 with a frequency (radio), 1.15 without (optical). */
  refractionK?: number;
  /** Also report the clearance at this k (e.g. WORST_K). Does not change the class. */
  worstK?: number;
  marginM?: number;
  /** Collect every sample (for the elevation profile chart). Disables early exit. */
  collectProfile?: boolean;
}

export interface LosProfileSample {
  lat: number;
  lon: number;
  distance: number;
  groundElevation: number | null;
  /** Height of the ray at this point, after the curvature drop. */
  losHeight: number;
  clearance: number | null;
  fresnelRadius?: number;
  fresnelClearance?: number | null;
  /** True when the ground came from an uploaded DSM rather than the terrain tiles. */
  fromLayer?: boolean;
}

export interface LosObstructionPoint {
  lat: number;
  lon: number;
  distance: number;
  elevation: number;
  blockageAmount: number;
}

export interface LosCoreResult {
  status: LosStatus;
  distance: number;
  bearing: number;
  startGround: number | null;
  endGround: number | null;
  /** Lowest clearance along the path (negative = blocked by that many metres). */
  minClearance: number | null;
  minClearanceDistance: number;
  /** Width of the uncertainty band at the point of minimum clearance. */
  uncertaintyAtMin: number;
  /** RF only: lowest (clearance - required Fresnel clearance). */
  minFresnelClearance: number | null;
  /** RF only: lowest clearance / F1 radius along the path (>= 0.6 means the Fresnel criterion holds). */
  minFresnelRatio: number | null;
  /** Lowest clearance with `worstK`, when requested. */
  minClearanceWorstK: number | null;
  refractionK: number;
  obstruction?: LosObstructionPoint;
  samples: number;
  missingSamples: number;
  /** Ground from both an uploaded DSM and the terrain tiles along the path (possible datum step). */
  mixedSources: boolean;
  /** DEM pixel size at mid-path, metres. */
  pixelM: number;
  profile?: LosProfileSample[];
}

/** Uncertainty half-width at distances d1, d2 from the endpoints. */
export function uncertaintyBand(d1: number, d2: number, marginM = MARGINAL_CLEARANCE_M): number {
  const dmin = Math.min(d1, d2);
  return marginM * Math.min(1, dmin / ENDPOINT_CORRELATION_M, (2 * dmin) / (d1 + d2));
}

/**
 * Class from the extreme clearances along the path.
 * @param minUpper lowest (clearance + band): < 0 means blocked even at the favourable end of the band
 * @param minLower lowest (clearance - band): < 0 means not clear at the unfavourable end
 */
export function classify(minUpper: number | null, minLower: number | null, minFresnelClearance: number | null, rf: boolean): LosStatus {
  if (minUpper === null || minLower === null) return 'clear';
  if (minUpper < 0) return 'blocked';
  if (minLower < 0) return 'marginal';
  if (rf && minFresnelClearance !== null && minFresnelClearance < 0) return 'fresnel';
  return 'clear';
}

/** True for the classes a user would call "has line of sight". */
export const hasLineOfSight = (status: LosStatus) => status === 'clear' || status === 'fresnel';

export function evaluateLOS(sampler: TerrainSampler, a: LosEndpoint, b: LosEndpoint, options: LosEvalOptions = {}): LosCoreResult {
  const z = sampler.zoom;
  const lambda = options.frequencyMHz ? SPEED_OF_LIGHT / (options.frequencyMHz * 1e6) : null;
  const k = options.refractionK ?? (lambda ? STANDARD_K : OPTICAL_K);
  const marginM = options.marginM ?? MARGINAL_CLEARANCE_M;
  const collect = options.collectProfile === true;

  const distance = geodesicDistance(a.lat, a.lon, b.lat, b.lon);
  const bearing = initialBearingDeg(a.lat, a.lon, b.lat, b.lon);
  const pa = lngLatToGlobalPixel(a.lon, a.lat, z);
  const pb = lngLatToGlobalPixel(b.lon, b.lat, z);
  const s: TerrainSample = { value: null, fromLayer: false };
  const startGround = sampler.sample(pa.x, pa.y, s).value;
  const startFromLayer = s.fromLayer;
  const endGround = sampler.sample(pb.x, pb.y, s).value;
  const endFromLayer = s.fromLayer;
  const midLat = (a.lat + b.lat) / 2;
  const pixelM = groundResolution(midLat, z);

  const base = {
    distance, bearing, startGround, endGround, minFresnelClearance: null, minFresnelRatio: null,
    minClearanceWorstK: null, refractionK: k, samples: 0, missingSamples: 0, mixedSources: false, pixelM, uncertaintyAtMin: 0,
  };
  if (startGround === null || endGround === null) {
    return { ...base, status: 'nodata', minClearance: null, minClearanceDistance: 0 };
  }

  const h1 = startGround + a.height;
  const h2 = endGround + b.height;
  const n = Math.min(MAX_SAMPLES, Math.max(2, Math.ceil(distance / (pixelM / 2))));
  const exclude = pixelM / 2;
  const R = radiusOfCurvature(midLat, bearing);
  const curvatureDenominator = 2 * R * k;
  const worstDenominator = options.worstK ? 2 * R * options.worstK : 0;

  // Great-circle knots in global pixel space; samples interpolate linearly between them.
  const segments = Math.max(1, Math.ceil(distance / KNOT_SPACING_M));
  const knots = greatCircleKnots(a.lat, a.lon, b.lat, b.lon, segments);
  const kx = new Float64Array(segments + 1), ky = new Float64Array(segments + 1);
  for (let i = 0; i <= segments; i++) {
    if (i === 0) { kx[0] = pa.x; ky[0] = pa.y; continue; }
    if (i === segments) { kx[i] = pb.x; ky[i] = pb.y; continue; }
    const p = lngLatToGlobalPixel(knots.lon[i], knots.lat[i], z);
    kx[i] = p.x; ky[i] = p.y;
  }

  const profile: LosProfileSample[] | undefined = collect ? [] : undefined;
  if (profile) {
    profile.push({ lat: a.lat, lon: a.lon, distance: 0, groundElevation: startGround, losHeight: h1, clearance: a.height, fresnelRadius: lambda ? 0 : undefined, fresnelClearance: lambda ? a.height : undefined, fromLayer: startFromLayer });
  }

  let minClearance = Infinity;
  let minClearanceDistance = 0;
  let uncertaintyAtMin = 0;
  let minUpper = Infinity;
  let minLower = Infinity;
  let minFresnel = Infinity;
  let minFresnelRatio = Infinity;
  let minWorst = Infinity;
  let obstruction: LosObstructionPoint | undefined;
  let missing = 0;
  let earlyBlocked = false;
  let sawLayer = startFromLayer || endFromLayer;
  let sawTiles = !startFromLayer || !endFromLayer;

  for (let i = 1; i < n; i++) {
    const f = i / n;
    const d1 = distance * f;
    const d2 = distance - d1;
    const u = f * segments;
    const seg = Math.min(segments - 1, Math.floor(u));
    const t = u - seg;
    const gx = kx[seg] + (kx[seg + 1] - kx[seg]) * t;
    const gy = ky[seg] + (ky[seg + 1] - ky[seg]) * t;
    const ground = sampler.sample(gx, gy, s).value;
    const bulge = d1 * d2;
    const losHeight = h1 + (h2 - h1) * f - bulge / curvatureDenominator;
    const fresnelRadius = lambda ? (distance > 0 ? Math.sqrt((lambda * bulge) / distance) : 0) : undefined;

    if (ground === null) {
      missing++;
      if (profile) {
        const ll = globalPixelToLngLat(gx, gy, z);
        profile.push({ lat: ll.lat, lon: ll.lng, distance: d1, groundElevation: null, losHeight, clearance: null, fresnelRadius, fresnelClearance: null });
      }
      continue;
    }
    if (s.fromLayer) sawLayer = true; else sawTiles = true;

    const clearance = losHeight - ground;
    const fresnelClearance = fresnelRadius !== undefined ? clearance - FRESNEL_CLEAR_FRACTION * fresnelRadius : undefined;

    if (profile) {
      const ll = globalPixelToLngLat(gx, gy, z);
      profile.push({ lat: ll.lat, lon: ll.lng, distance: d1, groundElevation: ground, losHeight, clearance, fresnelRadius, fresnelClearance, fromLayer: s.fromLayer });
    }

    if (d1 < exclude || d2 < exclude) continue;

    const band = uncertaintyBand(d1, d2, marginM);
    if (clearance + band < minUpper) minUpper = clearance + band;
    if (clearance - band < minLower) minLower = clearance - band;
    if (clearance < minClearance) {
      minClearance = clearance;
      minClearanceDistance = d1;
      uncertaintyAtMin = band;
      if (clearance < 0) {
        const ll = globalPixelToLngLat(gx, gy, z);
        obstruction = { lat: ll.lat, lon: ll.lng, distance: d1, elevation: ground, blockageAmount: -clearance };
      }
    }
    if (fresnelClearance !== undefined && fresnelClearance < minFresnel) minFresnel = fresnelClearance;
    if (fresnelRadius !== undefined && fresnelRadius > 0) {
      const ratio = clearance / fresnelRadius;
      if (ratio < minFresnelRatio) minFresnelRatio = ratio;
    }
    if (worstDenominator) {
      const cw = clearance + bulge / curvatureDenominator - bulge / worstDenominator;
      if (cw < minWorst) minWorst = cw;
    }

    // Definitely blocked: nothing later on the path can change the class.
    if (!collect && clearance + band < 0) {
      earlyBlocked = true;
      break;
    }
  }

  if (profile) {
    profile.push({ lat: b.lat, lon: b.lon, distance, groundElevation: endGround, losHeight: h2, clearance: b.height, fresnelRadius: lambda ? 0 : undefined, fresnelClearance: lambda ? b.height : undefined, fromLayer: endFromLayer });
  }

  const interior = n - 1;
  const fin = (v: number) => (v === Infinity ? null : v);
  let status: LosStatus;
  if (!earlyBlocked && interior > 0 && missing / interior > MAX_MISSING_FRACTION) status = 'nodata';
  else status = classify(fin(minUpper), fin(minLower), fin(minFresnel), lambda !== null);

  return {
    status,
    distance,
    bearing,
    startGround,
    endGround,
    minClearance: fin(minClearance),
    minClearanceDistance,
    uncertaintyAtMin,
    minFresnelClearance: fin(minFresnel),
    minFresnelRatio: fin(minFresnelRatio),
    minClearanceWorstK: earlyBlocked ? null : fin(minWorst),
    refractionK: k,
    obstruction,
    samples: interior,
    missingSamples: missing,
    mixedSources: sawLayer && sawTiles,
    pixelM,
    profile,
  };
}
